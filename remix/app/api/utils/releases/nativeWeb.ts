import releaseContract from '../../../../../native-bundles/release.cjs';
import hostContract from '../../../../../native-bundles/host.cjs';
import githubCatalogue from '../../../../../electron/lib/github-release-catalog.cjs';
import shippedPolicy from '../../../../../electron/native-web-policy.json';
import { planStoredZip } from '../../../utils/thingTransfer/storedZip';
import { MAX_ATTACHMENT_RANGE_BYTES, readExactRange } from '../attachments/attachmentRanges';

export const NATIVE_WEB_CATALOGUE_PATH = '/api/v1/releases/native-web';
export const NATIVE_WEB_CONTENT_PATH = '/api/v1/releases/native-web/content';
export const NATIVE_WEB_REQUIREMENTS = { 'api.releases-native-web': '1.0.0', 'api.releases-native-web-content': '1.0.0' } as const;
export const NATIVE_WEB_METADATA_BUDGETS = Object.freeze({ cataloguePageBytes: 8 * 1024 * 1024, envelopeBytes: 16 * 1024 * 1024 });
const DEADLINES = { catalogueMs: 30_000, envelopeMs: 20_000, operationMs: 30_000 };
const CATALOGUE = 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100';
const CATALOGUE_PATH = '/repos/lopugit/thingtime/releases';
const STORAGE_HOSTS = new Set(['objects.githubusercontent.com', 'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com']);
const HEADERS = { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'Thingtime-native-web' };
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export class NativeWebReleaseError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) { super(message); }
}
const invalid = () => { throw new NativeWebReleaseError(400, 'invalid_request', 'Invalid native release request.'); };
const unavailable = () => new NativeWebReleaseError(503, 'release_unavailable', 'Native release publication is temporarily unavailable.');
const changed = () => new NativeWebReleaseError(502, 'release_content_invalid', 'Published release bytes did not match the requested range.');
function discard(response: Response) { try { void response.body?.cancel().catch(() => {}); } catch { /* best-effort upstream cancellation */ } }
function whileActive<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: (value: any) => void, value: any) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', aborted); callback(value);
    };
    const aborted = () => finish(reject, signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    work.then(value => {
      if (settled && signal.aborted && value instanceof Response) discard(value);
      finish(resolve, value);
    }, error => finish(reject, error));
  });
}
async function boundedJson(response: Response, budget: number, signal: AbortSignal, failure: () => NativeWebReleaseError, expected?: number, check = () => signal.throwIfAborted()) {
  const length = response.headers.get('Content-Length');
  if ((expected !== undefined && expected > budget) || (length !== null &&
      (!/^(0|[1-9][0-9]*)$/.test(length) || /[^0-9]/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > budget || (expected !== undefined && Number(length) !== expected)))) {
    discard(response); throw failure();
  }
  if (!response.body) throw failure();
  const reader = response.body.getReader();
  const maximum = Math.min(budget, expected ?? budget);
  let bytes = new Uint8Array(Math.min(maximum, 64 * 1024));
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let total = 0;
  try {
    check();
    for (;;) {
      const part = await whileActive(reader.read(), signal);
      check();
      if (part.done) break;
      if (part.value.byteLength > maximum - total) throw failure();
      const required = total + part.value.byteLength;
      if (required > bytes.length) {
        const grown = new Uint8Array(Math.min(maximum, Math.max(required, bytes.length * 2)));
        grown.set(bytes.subarray(0, total)); bytes = grown;
      }
      bytes.set(part.value, total); total = required;
    }
    if (expected !== undefined && total !== expected) throw failure();
    check();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
  } catch { if (signal.aborted) throw unavailable(); throw failure(); }
  finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
// The shared exact-range validator owns its reader. This adapter makes abort
// cancel the actual provider reader too, including a stalled response body.
function cancellableBody(response: Response, signal: AbortSignal) {
  if (!response.body) return response;
  const reader = response.body.getReader(); let stopped = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const release = () => { signal.removeEventListener('abort', cancel); reader.releaseLock(); };
  signal.addEventListener('abort', cancel, { once: true });
  const body = new ReadableStream<Uint8Array>({
    async pull(output) {
      if (stopped) return;
      try {
        signal.throwIfAborted();
        const part = await whileActive(reader.read(), signal);
        signal.throwIfAborted();
        if (part.done) { stopped = true; release(); output.close(); }
        else output.enqueue(part.value);
      } catch (error) { stopped = true; cancel(); release(); output.error(error); }
    },
    cancel() { stopped = true; cancel(); release(); }
  }, { highWaterMark: 0 });
  if (signal.aborted) cancel();
  return new Response(body, { status: response.status, headers: response.headers });
}
function identifier(value: string) { if (!ID.test(value) || /[^A-Za-z0-9._-]/.test(value)) invalid(); return value; }
function fields(url: URL, names: string[]) {
  if ([...url.searchParams.keys()].some(name => !names.includes(name)) || names.some(name => url.searchParams.getAll(name).length !== 1)) invalid();
  return Object.fromEntries(names.map(name => [name, url.searchParams.get(name)!]));
}
export function parseNativeWebHost(url: URL) {
  const value = fields(url, ['platform', 'arch', 'runtimeId', 'nativeAbi', 'shellVersion', 'channel', 'minimumSequence']);
  if (!['darwin', 'linux', 'win32', 'ios'].includes(value.platform) || !['arm64', 'x64'].includes(value.arch) ||
      (!/^(0|[1-9][0-9]*)$/.test(value.minimumSequence) || /[^0-9]/.test(value.minimumSequence)) || !Number.isSafeInteger(Number(value.minimumSequence))) invalid();
  try { releaseContract.parseVersion(value.shellVersion); } catch { invalid(); }
  return { platform: value.platform, arch: value.arch, runtimeId: identifier(value.runtimeId), nativeAbi: identifier(value.nativeAbi),
    shellVersion: value.shellVersion, channel: identifier(value.channel), minimumSequence: Number(value.minimumSequence) };
}
function catalogueUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.port || url.username || url.password || url.hash || url.pathname !== CATALOGUE_PATH ||
      [...url.searchParams.keys()].some(key => !['page', 'per_page'].includes(key)) || url.searchParams.getAll('per_page').length !== 1 || url.searchParams.get('per_page') !== '100' ||
      url.searchParams.getAll('page').length > 1 || (url.searchParams.has('page') && (!/^[1-9][0-9]*$/.test(url.searchParams.get('page')!) || /[^0-9]/.test(url.searchParams.get('page')!)))) throw unavailable();
  return url;
}
function assetUrl(asset: any, tag: string) {
  if (!Number.isSafeInteger(asset?.id) || asset.id < 1 || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.state !== 'uploaded') return null;
  try {
    const url = new URL(asset.browser_download_url);
    const expected = `/lopugit/thingtime/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== expected) return null;
    return url.href;
  } catch { return null; }
}
function range(request: Request, size: number) {
  const header = request.headers.get('Range');
  if (!header) throw new NativeWebReleaseError(400, 'range_required', 'An explicit byte range is required.');
  const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(header);
  const start = Number(match?.[1]), end = Number(match?.[2]);
  if (!match || match[0] !== header || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end >= size || end - start + 1 > MAX_ATTACHMENT_RANGE_BYTES) {
    throw new NativeWebReleaseError(416, 'range_invalid', 'The byte range is outside the declared file or processing window.', { 'Content-Range': `bytes */${size}` });
  }
  return { start, end, length: end - start + 1 };
}
type ServiceOptions = { policy?: any; request?: typeof fetch; now?: () => number; cacheMs?: number; deadlines?: Partial<typeof DEADLINES> };
export function createNativeWebReleaseService({ policy = shippedPolicy, request = fetch, now = Date.now, cacheMs = 300_000, deadlines = {} }: ServiceOptions = {}) {
  const timeouts = { ...DEADLINES, ...deadlines };
  if (Object.values(timeouts).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid release processing deadline.');
  const operation = (caller?: AbortSignal) => {
    const deadline = AbortSignal.timeout(timeouts.operationMs), expires = performance.now() + timeouts.operationMs;
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
    const check = () => { caller?.throwIfAborted(); if (signal.aborted || performance.now() >= expires) throw unavailable(); };
    return { signal, check, async wait<T>(work: Promise<T>) { try { const value = await whileActive(work, signal); check(); return value; } catch (error) { check(); throw error; } } };
  };
  const trusted = hostContract.validateTrustPolicy(policy);
  let cataloguePromise: Promise<any[]> | null = null, checkedAt = 0;
  const envelopes = new Map<string, Promise<any>>();
  async function assetResponse(url: string, signal?: AbortSignal, byteRange?: string): Promise<Response> {
    const original = url;
    const deadline = AbortSignal.timeout(timeouts.envelopeMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    for (let redirects = 0; redirects <= 5; redirects++) {
      combined.throwIfAborted();
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password || target.port || target.hash ||
          (target.hostname === 'github.com' ? target.href !== original : !STORAGE_HOSTS.has(target.hostname))) throw changed();
      let response: Response;
      try { response = await whileActive(request(target.href, { method: 'GET', headers: { ...HEADERS, ...(byteRange ? { Range: byteRange } : {}) }, credentials: 'omit', redirect: 'manual', signal: combined }), combined); }
      catch { signal?.throwIfAborted(); throw unavailable(); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        discard(response);
        const location = response.headers.get('location');
        if (!location || redirects === 5) throw changed();
        url = new URL(location, target).href; continue;
      }
      return response;
    }
    throw changed();
  }
  async function catalogue(): Promise<any[]> {
    if (cataloguePromise && now() - checkedAt < cacheMs) return cataloguePromise;
    const pending = (async () => {
      const signal = AbortSignal.timeout(timeouts.catalogueMs), expires = performance.now() + timeouts.catalogueMs;
      const check = () => { signal.throwIfAborted(); if (performance.now() >= expires) throw unavailable(); };
      const result = await githubCatalogue.fetchGithubReleaseCatalog(CATALOGUE, async (url: string) => {
        check();
        const target = catalogueUrl(url);
        let response: Response;
        try { response = await whileActive(request(target.href, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': HEADERS['User-Agent'] }, credentials: 'omit', redirect: 'error', signal }), signal); }
        catch { throw unavailable(); }
        if (response.status !== 200 || response.redirected) { discard(response); throw unavailable(); }
        const link = response.headers.get('link');
        if (link?.includes('rel="next"')) {
          const next = githubCatalogue.githubNextPage(link);
          if (!next) throw unavailable();
          catalogueUrl(next);
        }
        const value = await boundedJson(response, NATIVE_WEB_METADATA_BUDGETS.cataloguePageBytes, signal, unavailable, undefined, check);
        return { value, headers: { link } };
      });
      check();
      if (result.truncated) throw unavailable();
      const candidates: any[] = [];
      for (const release of result.releases) {
        if ((trusted.channel === 'stable' && release?.prerelease === true) || release?.draft !== false || typeof release.published_at !== 'string' || !release.published_at || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) continue;
        check();
        const assets = new Map<string, any[]>();
        for (const asset of release.assets) {
          check();
          const list = assets.get(asset?.name) || []; list.push(asset); assets.set(asset?.name, list);
        }
        for (const json of release.assets) {
          check();
          const match = typeof json?.name === 'string' && /^native-web-([a-f0-9]{64})\.json$/.exec(json.name);
          if (!match || match[0] !== json.name) continue;
          const zip = assets.get(`native-web-${match[1]}.zip`) || [];
          if (zip.length !== 1 || assets.get(json.name)?.length !== 1) continue;
          const jsonUrl = assetUrl(json, release.tag_name), zipUrl = assetUrl(zip[0], release.tag_name);
          if (jsonUrl && zipUrl) candidates.push({ releaseId: match[1], json, zip: zip[0], jsonUrl, zipUrl, cacheKey: `${json.id}:${json.size}:${json.updated_at || ''}:${zip[0].id}:${zip[0].size}` });
        }
      }
      const keys = new Set(candidates.map(item => item.cacheKey));
      for (const key of envelopes.keys()) if (!keys.has(key)) envelopes.delete(key);
      return candidates;
    })();
    cataloguePromise = pending; checkedAt = now();
    try { return await pending; }
    catch (error) { if (cataloguePromise === pending) cataloguePromise = null; throw error; }
  }
  async function published(candidate: any) {
    const cached = envelopes.get(candidate.cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      if (candidate.json.size > NATIVE_WEB_METADATA_BUDGETS.envelopeBytes) throw changed();
      const signal = AbortSignal.timeout(timeouts.envelopeMs), expires = performance.now() + timeouts.envelopeMs;
      const check = () => { signal.throwIfAborted(); if (performance.now() >= expires) throw unavailable(); };
      let response: Response;
      try { response = await assetResponse(candidate.jsonUrl, signal); }
      catch (error) { if (signal.aborted) throw unavailable(); throw error; }
      if (response.status !== 200 || (response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding') !== 'identity') ||
          (response.headers.has('Content-Length') && response.headers.get('Content-Length') !== String(candidate.json.size))) { discard(response); throw changed(); }
      const envelope = await boundedJson(response, NATIVE_WEB_METADATA_BUDGETS.envelopeBytes, signal, changed, candidate.json.size, check);
      try {
        if (envelope.releaseId !== candidate.releaseId) return null;
        const descriptor = envelope.descriptor;
        releaseContract.verifyEnvelope(envelope, { trustedKeys: trusted.trustedKeys, host: {
          platform: descriptor.target.platform, arch: descriptor.target.arch, runtimeId: descriptor.runtime.id, nativeAbi: descriptor.runtime.nativeAbi,
          shellVersion: descriptor.runtime.minShellVersion, channel: trusted.channel, minimumSequence: trusted.minimumSequence
        } });
        const plan = planStoredZip(descriptor.files);
        if (plan.size !== candidate.zip.size) return null;
        return { envelope: JSON.parse(releaseContract.canonical(envelope)), plan, candidate };
      } catch { return null; }
    })();
    envelopes.set(candidate.cacheKey, pending);
    try { return await pending; }
    catch (error) { if (envelopes.get(candidate.cacheKey) === pending) envelopes.delete(candidate.cacheKey); throw error; }
  }
  return {
    async select(url: URL, signal?: AbortSignal) {
      const active = operation(signal); active.check();
      const host = parseNativeWebHost(url);
      if (!trusted.trustedKeys.length || host.channel !== trusted.channel) return null;
      host.minimumSequence = Math.max(host.minimumSequence, trusted.minimumSequence);
      const matches: any[] = [];
      for (const candidate of await active.wait(catalogue())) {
        active.check();
        const publication = await active.wait(published(candidate));
        if (!publication) continue;
        try { releaseContract.assertCompatible(publication.envelope.descriptor, host); } catch { continue; }
        matches.push(publication.envelope);
      }
      active.check();
      matches.sort((a, b) => b.descriptor.sequence - a.descriptor.sequence);
      if (matches.length > 1 && matches[1].descriptor.sequence === matches[0].descriptor.sequence && matches[1].releaseId !== matches[0].releaseId) throw unavailable();
      return matches[0] || null;
    },
    async content(request: Request) {
      const active = operation(request.signal); active.check();
      const { releaseId, path } = fields(new URL(request.url), ['releaseId', 'path']);
      if (!HASH.test(releaseId) || releaseId.length !== 64) invalid();
      try { releaseContract.safePath(path); } catch { invalid(); }
      const missing = () => new NativeWebReleaseError(404, 'release_not_found', 'Published native release or file was not found.');
      if (!trusted.trustedKeys.length) throw missing();
      const candidates = (await active.wait(catalogue())).filter(candidate => candidate.releaseId === releaseId);
      let publication: any = null;
      for (const candidate of candidates) { active.check(); publication = await active.wait(published(candidate)); if (publication) break; }
      active.check();
      if (!publication) throw missing();
      const descriptor = publication.envelope.descriptor;
      const fileIndex = descriptor.files.findIndex((file: any) => file.path === path);
      if (fileIndex < 0) throw missing();
      const file = descriptor.files[fileIndex], etag = `"${file.sha256}"`;
      if (!request.headers.has('If-Match')) throw new NativeWebReleaseError(428, 'precondition_required', 'The signed file hash is required in If-Match.');
      if (request.headers.get('If-Match') !== etag) throw new NativeWebReleaseError(412, 'release_changed', 'The file hash did not match the signed release.');
      const part = range(request, file.bytes), entry = publication.plan.files[fileIndex];
      const offset = entry.offset + entry.localSize + part.start;
      const response = await active.wait(assetResponse(publication.candidate.zipUrl, active.signal, `bytes=${offset}-${offset + part.length - 1}`));
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = await active.wait(readExactRange(cancellableBody(response, active.signal), { version: releaseId, offset, length: part.length }, publication.candidate.zip.size, active.check)); }
      catch { active.check(); throw changed(); }
      return new Response(bytes, { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength),
        'Content-Range': `bytes ${part.start}-${part.end}/${file.bytes}`, ETag: etag, 'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
  };
}
export const nativeWebReleaseService = createNativeWebReleaseService();
