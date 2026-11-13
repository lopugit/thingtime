import { setTimeout as delay } from 'node:timers/promises';

const integer = value => /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;
// Fixed route labels only: never include branch/path/query data or provider text
// in errors. This client cannot send its read token to arbitrary origins/routes.
function endpointClass(path, repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) return null;
  const prefix = `/repos/${repository}/`;
  if (!path.startsWith(prefix)) return null;
  const route = path.slice(prefix.length);
  if (route === 'git/ref/heads/main') return 'main-ref';
  if (/^compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}$/.test(route)) return 'ancestry';
  if (/^contents\/ops\/preview-maintenance\/[a-z0-9][a-z0-9-]*\/(?:manifest\.json|protection\.patch)\?ref=[a-f0-9]{40}$/.test(route)) return 'artifact';
  return null;
}
function providerFailure(response, parsed, now) {
  const remaining = integer(response.headers.get('x-ratelimit-remaining'));
  const reset = integer(response.headers.get('x-ratelimit-reset'));
  const retry = response.headers.get('retry-after');
  const date = retry && !/^\d+$/.test(retry) ? Date.parse(retry) : NaN;
  const retryAfter = integer(retry) ?? (Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : null);
  const message = typeof parsed?.message === 'string' ? parsed.message.toLowerCase() : '';
  let code = 'http-error', retryable = false;
  if (response.status === 403) {
    if (message.includes('resource not accessible')) code = 'permission-denied';
    else if (remaining === 0 || message.includes('api rate limit exceeded')) { code = 'primary-rate-limit'; retryable = true; }
    else if (retryAfter !== null || message.includes('secondary rate limit') || message.includes('abuse detection')) { code = 'secondary-rate-limit'; retryable = true; }
    else code = message.includes('resource not accessible') ? 'permission-denied' : 'forbidden';
  } else if (response.status === 429) { code = 'rate-limit'; retryable = true; }
  else if (response.status >= 500) { code = 'service-unavailable'; retryable = true; }
  else if (response.status === 401) code = 'unauthorized';
  else if (response.status >= 300 && response.status < 400) code = 'redirect-refused';
  return { status: response.status, code, retryable, remaining, reset, retryAfter };
}
function failure(endpoint, diagnostic, suffix = '') {
  const numbers = ['remaining', 'reset', 'retryAfter'].filter(key => diagnostic[key] !== null && diagnostic[key] !== undefined).map(key => ` ${key}=${diagnostic[key]}`).join('');
  const error = new Error(`GitHub maintenance read failed (endpoint=${endpoint} status=${diagnostic.status ?? 0} code=${diagnostic.code}${numbers}${suffix ? ` recovery=${suffix}` : ''})`);
  error.diagnostic = { endpoint, ...diagnostic, ...(suffix ? { recovery: suffix } : {}) };
  return error;
}
async function abortable(work, signal) {
  if (signal.aborted) throw new Error('read-aborted');
  let listener;
  const cancelled = new Promise((_, reject) => { listener = () => reject(new Error('read-aborted')); signal.addEventListener('abort', listener, { once: true }); });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', listener); }
}

/** One absolute budget covers all provenance reads, waits and body consumption. */
export function createGithubMaintenanceRead({ repository, token, fetcher = fetch, signal, now = Date.now,
  wait = (ms, selectedSignal) => delay(ms, undefined, { signal: selectedSignal }), budgetMs = 120_000, maxAttempts = 4 } = {}) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid GitHub read budget');
  const deadline = now() + budgetMs;
  const budgetSignal = AbortSignal.timeout(budgetMs);
  const sharedSignal = signal ? AbortSignal.any([signal, budgetSignal]) : budgetSignal;
  return async path => {
    const endpoint = endpointClass(path, repository);
    if (!endpoint) throw failure('refused', { code: 'route-refused' });
    let diagnostic = { status: 0, code: 'network-error', retryable: true };
    const check = () => {
      if (signal?.aborted) throw failure(endpoint, { status: 0, code: 'aborted' });
      if (budgetSignal.aborted || now() >= deadline) throw failure(endpoint, diagnostic.status ? diagnostic : { status:0, code:'deadline-exceeded' }, 'budget-exhausted');
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      check();
      const requestSignal = AbortSignal.any([sharedSignal, AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - now())))]);
      let response, parsed;
      try {
        response = await abortable(fetcher(`https://api.github.com${path}`, { method: 'GET', headers: {
          Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'thingtime-preview-maintenance', 'X-GitHub-Api-Version': '2022-11-28'
        }, redirect: 'manual', signal: requestSignal }), requestSignal);
        if (response.status >= 300 && response.status < 400) {
          response.body?.cancel().catch(() => {});
          parsed = null;
        } else {
          const text = await abortable(response.text(), requestSignal);
          try { parsed = JSON.parse(text); } catch { parsed = null; }
        }
      } catch {
        response = undefined;
        check();
        diagnostic = { status: 0, code: requestSignal.aborted ? 'request-timeout' : 'network-error', retryable: true };
      }
      if (response) {
        if (response.ok) {
          if (parsed === null) throw failure(endpoint, { status: response.status, code: 'invalid-json' });
          check();
          return parsed;
        }
        diagnostic = providerFailure(response, parsed, now());
      }
      if (!diagnostic.retryable || attempt + 1 === maxAttempts) throw failure(endpoint, diagnostic);
      // The same header-aware rule as the protected CodeQL waits: never retry
      // before Retry-After/reset, and never exceed the finite operation budget.
      const resetDelay = diagnostic.remaining === 0 && diagnostic.reset !== null && diagnostic.reset !== undefined ? Math.max(0, diagnostic.reset * 1000 - now() + 1000) : 0;
      const waitMs = Math.max(1000 * 2 ** attempt, (diagnostic.retryAfter ?? 0) * 1000, resetDelay);
      if (waitMs >= deadline - now()) throw failure(endpoint, diagnostic, 'wait-exceeds-budget');
      try { await wait(waitMs, sharedSignal); } catch { check(); throw failure(endpoint, { status: 0, code: 'aborted' }); }
    }
  };
}
