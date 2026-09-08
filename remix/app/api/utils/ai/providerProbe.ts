import { AI_MODEL_PROVIDER_IDS, AI_PROVIDER_ENV_HINTS, type AiModelProviderId, type AiProviderProbeOutcome } from './modelsCore';

// Bounded, cached liveness check of the server-side provider keys (design
// note §1.1 "verified keys").
//
// A key that was merely CONFIGURED used to list every model of its provider
// as available, so a stale or wrong key (OPENAI_API_KEY set on a deployment
// whose only real key is Anthropic's, say) sent every chat on it to the
// canned fallback. The probe asks each provider's cheapest authenticated
// endpoint — GET /v1/models — once, with a 5 s timeout and no retries, and
// caches the verdict in-process: 10 minutes after a success, 2 minutes after
// anything else. The verdict is deliberately three-valued:
//
//   verified: true   the provider answered 2xx — the key works
//   verified: false  the provider answered 401/403 — the key is invalid
//   verified: null   nothing can be concluded (unreachable, timeout, redirect,
//                    5xx, 429, malformed base URL) — models stay available
//
// The probe never throws, never retries, never follows a redirect (a key must
// not travel to a host the operator did not name), and never logs, returns,
// or echoes a key or a provider response body. Base URLs follow the SDKs:
// ANTHROPIC_BASE_URL (default https://api.anthropic.com) and OPENAI_BASE_URL
// (default https://api.openai.com/v1), so the probe dials exactly what chat
// dials. The Anthropic auth-token alias (ANTHROPIC_AUTH_TOKEN → Bearer) is
// honoured beside x-api-key.

export const AI_PROVIDER_PROBE_TIMEOUT_MS = 5_000;
export const AI_PROVIDER_PROBE_OK_TTL_MS = 10 * 60_000;
export const AI_PROVIDER_PROBE_FAIL_TTL_MS = 2 * 60_000;
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export type AiProviderProbeResult = AiProviderProbeOutcome & {
  // the provider answered 2xx
  ok: boolean;
  // the HTTP status when the provider answered at all
  status: number | null;
};

export type AiProviderProbeOptions = { force?: boolean };

export type AiProviderProbeRequest = { url: string; headers: Record<string, string> };

// The subset of fetch the probe uses — a seam for the unit tests' fake.
export type AiProviderProbeFetchInit = { method: 'GET'; headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' };
export type AiProviderProbeResponse = { status: number; body?: { cancel?: () => Promise<void> } | null };
export type AiProviderProbeFetch = (url: string, init: AiProviderProbeFetchInit) => Promise<AiProviderProbeResponse>;

export type AiProviderProbeDependencies = {
  fetch?: AiProviderProbeFetch;
  env?: () => Readonly<Record<string, string | undefined>>;
  now?: () => number;
  timeoutMs?: number;
  okTtlMs?: number;
  failTtlMs?: number;
  log?: (message: string) => void;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const trimSlashes = (value: string): string => value.replace(/\/+$/, '');

// The request each provider gets: URL + auth headers. Null when no credential
// is configured (nothing to verify). Exported for the unit tests only —
// callers never see headers.
export const buildAiProviderProbeRequest = (
  provider: AiModelProviderId,
  env: Readonly<Record<string, string | undefined>>
): AiProviderProbeRequest | null => {
  if (provider === 'anthropic') {
    const apiKey = text(env.ANTHROPIC_API_KEY);
    const authToken = text(env.ANTHROPIC_AUTH_TOKEN);
    if (!apiKey && !authToken) return null;
    const headers: Record<string, string> = { accept: 'application/json', 'anthropic-version': ANTHROPIC_VERSION };
    if (apiKey) headers['x-api-key'] = apiKey;
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    return { url: `${trimSlashes(text(env.ANTHROPIC_BASE_URL) || ANTHROPIC_DEFAULT_BASE_URL)}/v1/models`, headers };
  }
  const apiKey = text(env.OPENAI_API_KEY);
  if (!apiKey) return null;
  return {
    url: `${trimSlashes(text(env.OPENAI_BASE_URL) || OPENAI_DEFAULT_BASE_URL)}/models`,
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` }
  };
};

const discardBody = async (response: AiProviderProbeResponse): Promise<void> => {
  try {
    await response.body?.cancel?.();
  } catch {
    // the verdict is the status; the body is never read
  }
};

const errorCode = (error: unknown): string => {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause && typeof cause.code === 'string' ? cause.code : (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,32}$/.test(code) ? code : '';
};

export const createAiProviderProbe = (dependencies: AiProviderProbeDependencies = {}) => {
  const fetchImpl: AiProviderProbeFetch =
    dependencies.fetch ?? ((url, init) => globalThis.fetch(url, init) as unknown as Promise<AiProviderProbeResponse>);
  const env = dependencies.env ?? (() => process.env);
  const now = dependencies.now ?? (() => Date.now());
  const timeoutMs = dependencies.timeoutMs ?? AI_PROVIDER_PROBE_TIMEOUT_MS;
  const okTtlMs = dependencies.okTtlMs ?? AI_PROVIDER_PROBE_OK_TTL_MS;
  const failTtlMs = dependencies.failTtlMs ?? AI_PROVIDER_PROBE_FAIL_TTL_MS;
  const log = dependencies.log ?? ((message: string) => console.warn(message));

  const cache = new Map<AiModelProviderId, { result: AiProviderProbeResult; expiresAt: number }>();
  const inflight = new Map<AiModelProviderId, Promise<AiProviderProbeResult>>();

  const verdict = (partial: Omit<AiProviderProbeResult, 'checkedAt'>): AiProviderProbeResult => ({
    ...partial,
    checkedAt: new Date(now()).toISOString()
  });

  const unknown = (status: number | null, error: string): AiProviderProbeResult => verdict({ ok: false, verified: null, status, error });

  // One request, one verdict. Nothing here throws.
  const runProbe = async (provider: AiModelProviderId): Promise<AiProviderProbeResult> => {
    const request = buildAiProviderProbeRequest(provider, env());
    if (!request) return unknown(null, `${AI_PROVIDER_ENV_HINTS[provider]} is not configured`);

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return unknown(null, 'the provider base URL is not a valid URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return unknown(null, 'the provider base URL must be http(s)');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), { method: 'GET', headers: request.headers, signal: controller.signal, redirect: 'manual' });
      const status = typeof response?.status === 'number' ? response.status : 0;
      await discardBody(response);
      if (status >= 200 && status < 300) return verdict({ ok: true, verified: true, status });
      if (status === 401 || status === 403) {
        return verdict({ ok: false, verified: false, status, error: `the provider rejected the key (HTTP ${status})` });
      }
      if (status >= 300 && status < 400) return unknown(status, `the provider redirected the check (HTTP ${status}); redirects are not followed`);
      if (status === 429) return unknown(status, 'the provider is rate-limiting this deployment (HTTP 429)');
      return unknown(status || null, status ? `unexpected HTTP ${status} from the provider` : 'the provider gave no HTTP status');
    } catch (error) {
      if (timedOut) return unknown(null, `no answer from the provider within ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`}`);
      const code = errorCode(error);
      return unknown(null, code ? `could not reach the provider (${code})` : 'could not reach the provider');
    } finally {
      clearTimeout(timer);
    }
  };

  const describe = (result: AiProviderProbeResult): string =>
    result.ok ? `key verified (HTTP ${result.status})` : `${result.error ?? 'unverified'}${result.verified === false ? ' — models hidden' : ' — left unverified'}`;

  const probe = (provider: AiModelProviderId, options: AiProviderProbeOptions = {}): Promise<AiProviderProbeResult> => {
    const pending = inflight.get(provider);
    if (pending) return pending;
    if (!options.force) {
      const hit = cache.get(provider);
      if (hit && hit.expiresAt > now()) return Promise.resolve(hit.result);
    }
    const previous = cache.get(provider)?.result ?? null;
    const run: Promise<AiProviderProbeResult> = runProbe(provider)
      .catch(() => unknown(null, 'the key check failed unexpectedly'))
      .then((result) => {
        cache.set(provider, { result, expiresAt: now() + (result.ok ? okTtlMs : failTtlMs) });
        // audible, bounded (at most one line per probe), never a key or a URL
        if (!result.ok || (previous && !previous.ok)) log(`[ai-provider-probe] ${provider}: ${describe(result)}`);
        return result;
      })
      .finally(() => {
        if (inflight.get(provider) === run) inflight.delete(provider);
      });
    inflight.set(provider, run);
    return run;
  };

  // Every configured provider in parallel; null for an unconfigured one.
  const probeAll = async (options: AiProviderProbeOptions = {}): Promise<Record<AiModelProviderId, AiProviderProbeResult | null>> => {
    const current = env();
    const entries = await Promise.all(
      AI_MODEL_PROVIDER_IDS.map(async (provider) => [provider, buildAiProviderProbeRequest(provider, current) ? await probe(provider, options) : null] as const)
    );
    return Object.fromEntries(entries) as Record<AiModelProviderId, AiProviderProbeResult | null>;
  };

  // The cached verdict without dialing anything (null when none, or expired).
  const peek = (provider: AiModelProviderId): AiProviderProbeResult | null => {
    const hit = cache.get(provider);
    return hit && hit.expiresAt > now() ? hit.result : null;
  };

  const reset = () => {
    cache.clear();
    inflight.clear();
  };

  return { probe, probeAll, peek, reset };
};

const defaultProbe = createAiProviderProbe();

export const probeAiProvider = defaultProbe.probe;
export const probeAiProviders = defaultProbe.probeAll;
export const peekAiProviderProbe = defaultProbe.peek;
export const resetAiProviderProbeCache = defaultProbe.reset;
