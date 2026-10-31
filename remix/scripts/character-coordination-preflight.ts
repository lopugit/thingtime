import { pathToFileURL } from 'node:url';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../app/api/utils/capabilities/capabilityContract';

const feature = 'api.auth-characters';
const minimumVersion = '1.0.0';

async function diagnosticPrefix(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: number[] = [];
  try {
    while (chunks.length < 2048) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(...value.subarray(0, 2048 - chunks.length));
    }
    return new TextDecoder().decode(new Uint8Array(chunks));
  } finally { await reader.cancel(); }
}

/** Public discovery only: never accepts credentials or changes identity/membership. */
export async function characterCoordinationPreflight(
  input: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {}
) {
  let origin: string;
  try {
    const url = new URL(input);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new Error();
    origin = url.origin;
  } catch {
    return { ok: false as const, code: 'INVALID_ORIGIN', message: 'Supply an HTTPS origin (or HTTP loopback for local tests), without credentials, a path, query or fragment.' };
  }

  const base = { origin, feature, minimumVersion };
  const fail = (code: string, message: string, status?: number) => ({ ok: false as const, ...base, code, message, ...(status === undefined ? {} : { status }) });
  const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  try {
    const response = await (options.fetch ?? fetch)(new URL(THINGTIME_CAPABILITY_MANIFEST_PATH, origin), {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-store', redirect: 'manual', signal
    });
    if ((response.status >= 300 && response.status < 400) || response.redirected ||
      (response.url && new URL(response.url).origin !== origin)) {
      return fail('REDIRECT_REFUSED', 'Discovery must stay on the selected origin; no redirect was followed.', response.status);
    }
    if (!response.ok) {
      const cloudflare = response.headers.get('server')?.toLowerCase() === 'cloudflare';
      // Do not include remote bodies, headers or provider identifiers in task logs.
      const edgeRefusal = response.status === 403 && cloudflare && (
        response.headers.get('cf-mitigated') === 'challenge' ||
        /\berror\s+code:\s*1010\b/i.test(await diagnosticPrefix(response))
      );
      if (edgeRefusal) {
        return fail('EDGE_REFUSED', 'Cloudflare refused this discovery request before capability negotiation. This does not prove Characters are missing. Use the assigned Chrome session for authorized coordination or resolve the edge policy; do not spoof a browser, change origins, copy cookies or weaken isolation.', 403);
      }
      return fail('HTTP_ERROR', 'Capability discovery failed. Authentication and private-subspace membership have not been checked.', response.status);
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      return fail('INVALID_MANIFEST', 'Expected a JSON capability manifest, not an HTML page or challenge.');
    }
    let manifest;
    try { manifest = await response.json(); } catch {
      if (signal.aborted) throw new Error('timeout');
      return fail('INVALID_MANIFEST', 'The capability response is not valid JSON.');
    }
    if (manifest?.schemaVersion !== 1 || manifest.origin !== origin ||
      !manifest.features || typeof manifest.features !== 'object' || Array.isArray(manifest.features)) {
      return fail('INVALID_MANIFEST', 'The manifest schema or selected origin does not match.');
    }
    const version = manifest.features[feature]?.version;
    if (typeof version !== 'string' || !capabilitySatisfies(version, minimumVersion)) {
      return fail('INCOMPATIBLE_CAPABILITY', 'The selected origin does not advertise a compatible Characters capability.');
    }
    return {
      ok: true as const, ...base, version, code: 'CAPABILITY_READY',
      authentication: 'not_checked', membership: 'not_checked',
      next: 'Use an authorized session to claim or reuse your task Character, verify its identity and private Thingtime Agents membership, then read and update the task thread. Public discovery does not grant access.'
    };
  } catch {
    return fail(signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 'Discovery could not complete. Continue independent work; keep the selected origin and network boundary unchanged.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--origin') {
    console.error('Usage: npm --prefix remix run characters:preflight -- --origin https://thingtime.com');
    process.exitCode = 2;
  } else {
    void characterCoordinationPreflight(args[1]).then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    });
  }
}
