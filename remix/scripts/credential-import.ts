#!/usr/bin/env node
/** A write-only, origin-bound handoff. Secret input is read only after approval. */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../app/api/utils/capabilities/capabilityContract';
import {
  CREDENTIAL_IMPORT_API_PATH, CREDENTIAL_IMPORT_FEATURE, CREDENTIAL_IMPORT_VERSION,
  CREDENTIAL_IMPORT_PAGE_PATH, CREDENTIAL_IMPORT_HEADERS, GOOGLE_OAUTH_CREDENTIAL_LABEL,
  GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH,
  type CredentialImportTarget, type CredentialImportReceipt
} from '../app/credentials/importContract';

type Event = { status: string; requestId?: string; verificationUrl?: string; expiresAt?: string; receipt?: CredentialImportReceipt };
type Options = {
  origin: string;
  expectedAccountId: string;
  target: CredentialImportTarget;
  readInput: () => Promise<Buffer>;
  emit?: (event: Event) => void;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export class ImportFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new ImportFailure(code); };

export function importOrigin(input: string) {
  try {
    const url = new URL(input);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return fail('INVALID_ORIGIN');
    return url.origin;
  } catch { return fail('INVALID_ORIGIN'); }
}

function receipt(value: unknown, target: CredentialImportTarget): CredentialImportReceipt {
  const data = value as Partial<CredentialImportReceipt> | undefined;
  if (!data || typeof data.credentialId !== 'string' || !/^secret_[a-zA-Z0-9_-]{24}$/.test(data.credentialId) ||
    data.label !== target.label || data.environment !== target.environment || data.format !== target.format ||
    (target.overwrite.mode === 'replace' && data.credentialId !== target.overwrite.expectedId) ||
    typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) return fail('INVALID_RECEIPT');
  // Never spread a remote response: added server fields cannot leak through stdout.
  return { credentialId: data.credentialId, label: target.label, environment: target.environment, format: target.format, updatedAt: new Date(data.updatedAt).toISOString() };
}

/** Reads only the selected input; cancellation closes this local input, never another process. */
export async function readCredentialInput(file: string | undefined, stdin: Readable, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) return fail('CANCELLED');
  let stream = stdin;
  if (file) {
    const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    if (!(await handle.stat()).isFile()) { await handle.close(); return fail('INPUT_REQUIRES_REGULAR_FILE'); }
    stream = handle.createReadStream({ autoClose: true });
  }
  const abort = () => stream.destroy(new ImportFailure('CANCELLED'));
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Buffer[] = [];
  try {
    if (signal.aborted) abort();
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (signal.aborted) return fail('CANCELLED');
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', abort);
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function transferCredential(options: Options): Promise<CredentialImportReceipt> {
  const origin = importOrigin(options.origin);
  if (!options.expectedAccountId || !options.target.label || !options.target.environment) return fail('INVALID_TARGET');
  const emit = options.emit ?? (() => {});
  const fetcher = options.fetch ?? fetch;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const requestId = randomUUID();
  const verifierBytes = randomBytes(32);
  const verifier = verifierBytes.toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const proof = { requestId, verifier };
  let bytes: Buffer | undefined;
  const request = async (path: string, init: RequestInit = {}) => {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
    let response: Response;
    try {
      response = await fetcher(origin + path, {
        ...init, credentials: 'omit', redirect: 'manual', cache: 'no-store', signal,
        headers: { Accept: 'application/json', Origin: origin, ...init.headers }
      });
    } catch { return fail(options.signal?.aborted ? 'CANCELLED' : 'NETWORK_ERROR'); }
    if (response.redirected || (response.status >= 300 && response.status < 400) ||
      (response.url && new URL(response.url).origin !== origin)) return fail('REDIRECT_REFUSED');
    if (!response.ok) return fail(`HTTP_${response.status}`);
    if (!response.headers.get('content-type')?.includes('application/json')) return fail('INVALID_RESPONSE');
    try { return await response.json(); } catch { return fail('INVALID_RESPONSE'); }
  };
  const post = (operation: string, body: unknown) => request(`${CREDENTIAL_IMPORT_API_PATH}/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const transient = (error: unknown) => error instanceof ImportFailure && ['NETWORK_ERROR', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'].includes(error.code);
  const retryOnce = async <T>(operation: () => Promise<T>) => {
    try { return await operation(); } catch (error) {
      if (!transient(error) || options.signal?.aborted) throw error;
      await wait(1000, options.signal);
      return operation();
    }
  };
  try {
    const manifest = await request(THINGTIME_CAPABILITY_MANIFEST_PATH);
    if (manifest?.schemaVersion !== 1 || manifest.origin !== origin ||
      typeof manifest.features?.[CREDENTIAL_IMPORT_FEATURE]?.version !== 'string' ||
      !capabilitySatisfies(manifest.features[CREDENTIAL_IMPORT_FEATURE].version, CREDENTIAL_IMPORT_VERSION)) return fail('INCOMPATIBLE_CAPABILITY');
    const started = await retryOnce(() => post('start', { requestId, target: options.target, expectedAccountId: options.expectedAccountId, challenge }));
    const expectedUrl = new URL(CREDENTIAL_IMPORT_PAGE_PATH, origin);
    expectedUrl.searchParams.set('requestId', requestId);
    const deadline = Date.parse(started?.expiresAt);
    if (started?.ok !== true || started.requestId !== requestId || started.verificationUrl !== expectedUrl.href || !Number.isFinite(deadline) || deadline <= Date.now()) return fail('INVALID_HANDOFF');
    emit({ status: 'approval_required', requestId, verificationUrl: expectedUrl.href, expiresAt: new Date(deadline).toISOString() });
    let poll = 0;
    while (true) {
      if (options.signal?.aborted) return fail('CANCELLED');
      if (Date.now() >= deadline) return fail('EXPIRED');
      const state = await retryOnce(() => post('status', proof));
      if (state?.ok !== true) return fail('INVALID_RESPONSE');
      if (state.status === 'approved') break;
      if (state.status === 'revoked' || state.status === 'expired') return fail(state.status.toUpperCase());
      if (state.status !== 'pending') return fail('UNEXPECTED_STATUS');
      await wait(Math.min(1000 * 2 ** Math.min(poll++, 3), Math.max(1, deadline - Date.now())), options.signal);
    }
    emit({ status: 'transferring', requestId });
    // A local input error is reported without a filename, file contents or stack.
    try { bytes = await options.readInput(); } catch { return fail(options.signal?.aborted ? 'CANCELLED' : 'INPUT_UNAVAILABLE'); }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return fail('EMPTY_INPUT');
    if (Date.now() >= deadline) return fail('EXPIRED');
    const upload = async () => {
      const result = await request(`${CREDENTIAL_IMPORT_API_PATH}/upload`, {
        method: 'POST', headers: {
          'Content-Type': 'application/octet-stream',
          [CREDENTIAL_IMPORT_HEADERS.request]: requestId,
          [CREDENTIAL_IMPORT_HEADERS.verifier]: verifier
        }, body: new Uint8Array(bytes!)
      });
      if (result?.ok !== true) return fail('INVALID_RESPONSE');
      return { ok: true, receipt: receipt(result.receipt, options.target) };
    };
    let result;
    try { result = await upload(); } catch (error) {
      if (options.signal?.aborted) return fail('TRANSFER_UNCONFIRMED');
      if (!transient(error) && !(error instanceof ImportFailure && ['INVALID_RESPONSE', 'INVALID_RECEIPT'].includes(error.code))) throw error;
      // Uncertain write: inspect the same operation before one exact-byte retry.
      let state;
      try { state = await retryOnce(() => post('status', proof)); } catch { return fail('TRANSFER_UNCONFIRMED'); }
      if (state?.ok === true && state.status === 'completed') result = state;
      else if (state?.ok === true && state.status === 'approved' && Date.now() < deadline) {
        try { result = await upload(); } catch {
          if (options.signal?.aborted) return fail('TRANSFER_UNCONFIRMED');
          // The exact retry may also commit and lose its response. Inspect once;
          // do not create a second intent or repeat the mutation again.
          try { state = await post('status', proof); } catch { return fail('TRANSFER_UNCONFIRMED'); }
          if (state.ok === true && state.status === 'completed') result = state;
          else return fail('TRANSFER_UNCONFIRMED');
        }
      }
      else return fail('TRANSFER_UNCONFIRMED');
    }
    let saved: CredentialImportReceipt;
    try {
      if (result?.ok !== true) return fail('INVALID_RESPONSE');
      saved = receipt(result.receipt, options.target);
    } catch { return fail('TRANSFER_UNCONFIRMED'); }
    emit({ status: 'saved', requestId, receipt: saved });
    return saved;
  } finally {
    bytes?.fill(0);
    verifierBytes.fill(0);
    // JS strings/HTTP internals are garbage-collected; zeroization is best effort.
  }
}

const usage = `Import a selected credential file directly into Thingtime's encrypted provider vault.
Usage: npm --prefix remix run credentials:import -- --origin https://thingtime.com
  --account <expected-admin-id> --environment production --format google-oauth
  --file <downloaded-client.json>

Formats: google-oauth, text, json. Generic formats require --label <vault-label>.
Use --stdin instead of --file for a protected pipe. Never pass a secret as an argument.
Google defaults to the selected origin's Connections callback; --callback may name it explicitly.
Replacing a saved label requires BOTH --replace-id <secret-id> and --replace-updated-at <ISO-date>.
The command prints an approval URL for the assigned, authenticated browser. No browser is opened
automatically. Input is read after approval and never printed. Ctrl-C ends the local handoff.
Requires Node 22+ and a selected origin advertising api.credentials-import 1.0.0 or compatible.
This saves provider configuration, not personal passwords, session cookies or passkey keys.`;

export function parseImportArgs(args: string[]) {
  const values: Record<string, string> = {};
  const flags = new Set(['--origin', '--account', '--environment', '--format', '--file', '--label', '--callback', '--replace-id', '--replace-updated-at']);
  let stdin = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--stdin') { if (stdin) return fail('INVALID_ARGUMENTS'); stdin = true; continue; }
    if (!flags.has(key) || values[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) return fail('INVALID_ARGUMENTS');
    values[key] = args[++i];
  }
  const origin = importOrigin(values['--origin']);
  const format = values['--format'];
  if (!['google-oauth', 'text', 'json'].includes(format) || !values['--account'] || !values['--environment'] ||
    (stdin === Boolean(values['--file'])) || Boolean(values['--replace-id']) !== Boolean(values['--replace-updated-at'])) return fail('INVALID_ARGUMENTS');
  if (format !== 'google-oauth' && (!values['--label'] || values['--callback'])) return fail('INVALID_ARGUMENTS');
  if (format === 'google-oauth' && values['--label'] && values['--label'] !== GOOGLE_OAUTH_CREDENTIAL_LABEL) return fail('INVALID_ARGUMENTS');
  const target: CredentialImportTarget = {
    destination: 'admin-provider-vault', format: format as CredentialImportTarget['format'],
    label: format === 'google-oauth' ? GOOGLE_OAUTH_CREDENTIAL_LABEL : values['--label'],
    environment: values['--environment'],
    ...(format === 'google-oauth' ? { callbackUrl: values['--callback'] || origin + GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH } : {}),
    overwrite: values['--replace-id'] ? { mode: 'replace', expectedId: values['--replace-id'], expectedUpdatedAt: values['--replace-updated-at'] } : { mode: 'create' }
  };
  return { origin, expectedAccountId: values['--account'], target, file: values['--file'], stdin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg === '--help' || arg === '-h')) console.log(usage);
  else {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    void (async () => {
      try {
        const args = parseImportArgs(process.argv.slice(2));
        if (args.stdin && process.stdin.isTTY) return fail('STDIN_REQUIRES_PIPE');
        await transferCredential({ ...args, signal: controller.signal, emit: event => console.log(JSON.stringify(event)),
          readInput: () => readCredentialInput(args.file, process.stdin, controller.signal) });
      } catch (error) {
        console.error(JSON.stringify({ status: 'failed', code: error instanceof ImportFailure ? error.code : 'IMPORT_FAILED' }));
        process.exitCode = 1;
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    })();
  }
}
