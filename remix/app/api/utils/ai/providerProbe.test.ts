import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_PROVIDER_PROBE_FAIL_TTL_MS,
  AI_PROVIDER_PROBE_OK_TTL_MS,
  buildAiProviderProbeRequest,
  createAiProviderProbe,
  type AiProviderProbeFetch
  // @ts-ignore Node executes TypeScript through the repo's tsx test loader.
} from './providerProbe.ts';

const ANTHROPIC_KEY = 'sk-ant-api03-super-secret-anthropic-key';
const ANTHROPIC_TOKEN = 'oauth-super-secret-anthropic-token';
const OPENAI_KEY = 'sk-proj-super-secret-openai-key';
const BOTH = { ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: OPENAI_KEY };
const START = Date.parse('2026-09-04T00:00:00.000Z');

type Call = { url: string; init: Parameters<AiProviderProbeFetch>[1] };
type Respond = (call: Call) => ReturnType<AiProviderProbeFetch> | Awaited<ReturnType<AiProviderProbeFetch>>;

// A probe wired to a scripted fetch and a controllable clock.
const createHarness = (options: { env?: Record<string, string | undefined>; respond?: Respond; timeoutMs?: number } = {}) => {
  const calls: Call[] = [];
  const logs: string[] = [];
  let now = START;
  let respond: Respond = options.respond ?? (() => ({ status: 200 }));
  const cancelled: number[] = [];
  const probe = createAiProviderProbe({
    env: () => options.env ?? BOTH,
    now: () => now,
    timeoutMs: options.timeoutMs ?? 40,
    log: (message) => logs.push(message),
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      const response = await respond(call);
      return { ...response, body: { cancel: async () => void cancelled.push(response.status) } };
    }
  });
  return {
    ...probe,
    calls,
    logs,
    cancelled,
    advance: (ms: number) => {
      now += ms;
    },
    respondWith: (next: Respond) => {
      respond = next;
    }
  };
};

// A fetch that never answers: it rejects only when the probe aborts it.
const hang: Respond = ({ init }) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
  });

test('the probe request is the SDKs’ cheapest authenticated call, built from the same env the SDKs read', () => {
  const anthropic = buildAiProviderProbeRequest('anthropic', { ANTHROPIC_API_KEY: ` ${ANTHROPIC_KEY} ` })!;
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/models');
  assert.deepEqual(anthropic.headers, { accept: 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': ANTHROPIC_KEY });

  // the auth-token alias rides Authorization: Bearer; both together send both (like the SDK)
  assert.deepEqual(buildAiProviderProbeRequest('anthropic', { ANTHROPIC_AUTH_TOKEN: ANTHROPIC_TOKEN })!.headers, {
    accept: 'application/json',
    'anthropic-version': '2023-06-01',
    authorization: `Bearer ${ANTHROPIC_TOKEN}`
  });
  const both = buildAiProviderProbeRequest('anthropic', { ANTHROPIC_API_KEY: ANTHROPIC_KEY, ANTHROPIC_AUTH_TOKEN: ANTHROPIC_TOKEN })!.headers;
  assert.equal(both['x-api-key'], ANTHROPIC_KEY);
  assert.equal(both.authorization, `Bearer ${ANTHROPIC_TOKEN}`);

  // base URLs follow the SDK env vars (trailing slashes tolerated)
  assert.equal(buildAiProviderProbeRequest('anthropic', { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://claude.example.test/' })!.url, 'https://claude.example.test/v1/models');
  const openai = buildAiProviderProbeRequest('openai', { OPENAI_API_KEY: OPENAI_KEY })!;
  assert.equal(openai.url, 'https://api.openai.com/v1/models');
  assert.deepEqual(openai.headers, { accept: 'application/json', authorization: `Bearer ${OPENAI_KEY}` });
  assert.equal(buildAiProviderProbeRequest('openai', { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://127.0.0.1:4768/v1/' })!.url, 'http://127.0.0.1:4768/v1/models');

  // nothing configured → nothing to verify
  assert.equal(buildAiProviderProbeRequest('anthropic', {}), null);
  assert.equal(buildAiProviderProbeRequest('anthropic', { ANTHROPIC_API_KEY: '   ' }), null);
  assert.equal(buildAiProviderProbeRequest('openai', { ANTHROPIC_API_KEY: 'k' }), null);
});

test('a 2xx answer verifies the key; the request is a bounded GET that never follows redirects and never reads the body', async () => {
  const harness = createHarness();
  const result = await harness.probe('anthropic');
  assert.deepEqual(result, { ok: true, verified: true, status: 200, checkedAt: '2026-09-04T00:00:00.000Z' });
  assert.equal(harness.calls.length, 1);
  const [{ url, init }] = harness.calls;
  assert.equal(url, 'https://api.anthropic.com/v1/models');
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'manual');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers['x-api-key'], ANTHROPIC_KEY);
  assert.deepEqual(harness.cancelled, [200]);
  // a healthy key is silent
  assert.deepEqual(harness.logs, []);
});

test('401 and 403 mean the key is invalid; the log line and the result carry no key, base URL, or response body', async () => {
  for (const status of [401, 403]) {
    const harness = createHarness({ respond: () => ({ status }) });
    const result = await harness.probe('openai');
    assert.equal(result.ok, false);
    assert.equal(result.verified, false);
    assert.equal(result.status, status);
    assert.equal(result.error, `the provider rejected the key (HTTP ${status})`);
    assert.equal(harness.logs.length, 1);
    assert.match(harness.logs[0], /^\[ai-provider-probe\] openai: the provider rejected the key \(HTTP 40[13]\) — models hidden$/);
    const everything = JSON.stringify({ result, logs: harness.logs });
    assert.doesNotMatch(everything, /sk-|secret|api\.openai\.com|Bearer/);
  }
});

test('a timeout, a network error, a redirect, a 429, or a 5xx leaves the key UNKNOWN — never invalid', async () => {
  const timeout = createHarness({ respond: hang, timeoutMs: 30 });
  const timedOut = await timeout.probe('anthropic');
  assert.deepEqual(timedOut, { ok: false, verified: null, status: null, checkedAt: '2026-09-04T00:00:00.000Z', error: 'no answer from the provider within 30ms' });
  assert.equal(timeout.calls[0].init.signal.aborted, true);

  const refused = createHarness({
    respond: () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
  });
  const unreachable = await refused.probe('openai');
  assert.equal(unreachable.verified, null);
  assert.equal(unreachable.status, null);
  assert.equal(unreachable.error, 'could not reach the provider (ECONNREFUSED)');
  assert.match(refused.logs[0], /openai: could not reach the provider \(ECONNREFUSED\) — left unverified/);

  for (const [status, pattern] of [
    [302, /redirected the check \(HTTP 302\)/],
    [429, /rate-limiting this deployment \(HTTP 429\)/],
    [503, /unexpected HTTP 503/],
    [404, /unexpected HTTP 404/]
  ] as const) {
    const harness = createHarness({ respond: () => ({ status }) });
    const result = await harness.probe('openai');
    assert.equal(result.ok, false);
    assert.equal(result.verified, null);
    assert.equal(result.status, status);
    assert.match(result.error ?? '', pattern);
  }

  // a malformed base URL cannot even be dialed
  const malformed = createHarness({ env: { OPENAI_API_KEY: OPENAI_KEY, OPENAI_BASE_URL: 'not a url' } });
  const bad = await malformed.probe('openai');
  assert.equal(bad.verified, null);
  assert.equal(bad.error, 'the provider base URL is not a valid URL');
  assert.equal(malformed.calls.length, 0);
  const scheme = createHarness({ env: { OPENAI_API_KEY: OPENAI_KEY, OPENAI_BASE_URL: 'ftp://files.example.test/v1' } });
  assert.equal((await scheme.probe('openai')).error, 'the provider base URL must be http(s)');
});

test('verdicts are cached in-process: 10 minutes after a success, 2 minutes after anything else; force bypasses the cache', async () => {
  const harness = createHarness();
  await harness.probe('anthropic');
  await harness.probe('anthropic');
  harness.advance(AI_PROVIDER_PROBE_OK_TTL_MS - 1);
  await harness.probe('anthropic');
  assert.equal(harness.calls.length, 1, 'a fresh success is served from the cache');
  assert.equal(harness.peek('anthropic')?.verified, true);
  harness.advance(2);
  await harness.probe('anthropic');
  assert.equal(harness.calls.length, 2, 'an expired success is re-checked');

  harness.respondWith(() => ({ status: 401 }));
  await harness.probe('anthropic', { force: true });
  assert.equal(harness.calls.length, 3, 'force dials the provider even with a fresh verdict cached');
  assert.equal(harness.peek('anthropic')?.verified, false);
  harness.advance(AI_PROVIDER_PROBE_FAIL_TTL_MS - 1);
  assert.equal((await harness.probe('anthropic')).verified, false);
  assert.equal(harness.calls.length, 3, 'a failure is cached for the short TTL');
  harness.advance(2);
  harness.respondWith(() => ({ status: 200 }));
  const recovered = await harness.probe('anthropic');
  assert.equal(recovered.verified, true);
  assert.equal(harness.calls.length, 4);
  // a recovery after a failure is logged once, a steady success never
  assert.deepEqual(harness.logs, ['[ai-provider-probe] anthropic: the provider rejected the key (HTTP 401) — models hidden', '[ai-provider-probe] anthropic: key verified (HTTP 200)']);

  // caches are per provider
  assert.equal(harness.peek('openai'), null);
  harness.reset();
  assert.equal(harness.peek('anthropic'), null);
});

test('concurrent callers share one in-flight probe per provider; probeAll skips unconfigured providers', async () => {
  const harness = createHarness({ respond: hang, timeoutMs: 25 });
  const [first, second, third] = await Promise.all([harness.probe('openai'), harness.probe('openai'), harness.probe('openai', { force: true })]);
  assert.equal(harness.calls.length, 1);
  assert.equal(first, second);
  assert.equal(first, third);
  assert.equal(first.verified, null);

  const partial = createHarness({ env: { OPENAI_API_KEY: OPENAI_KEY } });
  const all = await partial.probeAll();
  assert.equal(all.anthropic, null);
  assert.equal(all.openai?.verified, true);
  assert.deepEqual(partial.calls.map((call) => call.url), ['https://api.openai.com/v1/models']);

  const none = createHarness({ env: {} });
  assert.deepEqual(await none.probeAll(), { anthropic: null, openai: null });
  assert.equal(none.calls.length, 0);
  // a direct probe of an unconfigured provider is an unknown verdict, not a dial
  assert.equal((await none.probe('anthropic')).error, 'ANTHROPIC_API_KEY is not configured');
});

test('the probe never throws: a fetch that returns garbage or throws synchronously still yields an unknown verdict', async () => {
  const garbage = createHarness({ respond: () => undefined as any });
  const result = await garbage.probe('openai');
  assert.equal(result.ok, false);
  assert.equal(result.verified, null);
  assert.equal(result.error, 'the provider gave no HTTP status');

  const boom = createAiProviderProbe({
    env: () => BOTH,
    now: () => START,
    timeoutMs: 20,
    log: () => {},
    fetch: () => {
      throw new Error('boom');
    }
  });
  const thrown = await boom.probe('anthropic');
  assert.equal(thrown.verified, null);
  assert.equal(thrown.error, 'could not reach the provider');
});
