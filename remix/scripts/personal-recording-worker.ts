// Outbound-only transport. Device pairing and explicit owner selection happen
// separately; this module neither issues credentials nor activates automation.
import { setTimeout as sleep } from 'node:timers/promises';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../app/api/utils/capabilities/capabilityContract';
import {
  PERSONAL_RECORDING_PATH, PERSONAL_RECORDING_REQUIREMENTS,
  PERSONAL_RECORDING_HEARTBEAT_MS, PERSONAL_RECORDING_MAX_RUN_MS,
  parsePersonalRecordingRequest, personalRecordingAudioIsSupported
} from '../app/api/utils/lopu/personalRecordingCore';
import { RECORDING_INSIGHTS_PROMPT, RECORDING_MAX_AUDIO_BYTES, RECORDING_MAX_TRANSCRIPT_CHARS } from '../app/api/utils/lopu/recordingsCore';

type Runtime = {
  transcribe(input: { bytes: Uint8Array; type: string; signal: AbortSignal }): Promise<string>;
  complete(input: { system: string; prompt: string; signal: AbortSignal }): Promise<string>;
};
type Claim = { jobId: string; leaseId: string; type: string; bytes: number; transcript?: string; organize: boolean };
type WorkerOptions = {
  origin: string;
  credential: string;
  runtime: Runtime;
  fetch?: typeof fetch;
  // Clock/interval injection is local test infrastructure, never remote input.
  heartbeatMs?: number;
  retryMs?: number;
};

class TransportFailure extends Error {
  constructor(readonly retryable = false) { super('The paired recording connection is unavailable.'); }
}

export const parsePersonalRecordingClaim = (input: unknown): Claim | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input as any).ok !== true) throw new TransportFailure();
  const job = (input as any).job;
  if (job === null) return null;
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new TransportFailure();
  const lease = parsePersonalRecordingRequest({ op: 'heartbeat', jobId: job.jobId, leaseId: job.leaseId });
  if (!('jobId' in lease) || !personalRecordingAudioIsSupported(job.type, job.bytes) || typeof job.organize !== 'boolean' ||
      (job.transcript !== undefined && (typeof job.transcript !== 'string' || !job.transcript.trim() || job.transcript.length > RECORDING_MAX_TRANSCRIPT_CHARS)))
    throw new TransportFailure();
  // Do not accept endpoint URLs, prompts, commands or account IDs from a job.
  return { jobId: lease.jobId, leaseId: lease.leaseId, type: job.type, bytes: job.bytes,
    organize: job.organize, ...(job.transcript === undefined ? {} : { transcript: job.transcript }) };
};

const readBounded = async (response: Response, max: number, signal: AbortSignal) => {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) {
    await response.body?.cancel();
    throw new TransportFailure();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TransportFailure();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) throw new TransportFailure();
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

export const createPersonalRecordingWorker = (options: WorkerOptions) => {
  const origin = new URL(options.origin);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash || !/^ttnode_[A-Za-z0-9_-]{43}$/.test(options.credential))
    throw new Error('Configure a Thingtime origin and an existing paired-device credential.');
  const fetcher = options.fetch || fetch;
  let running = false;
  const request = async (path: string, signal: AbortSignal, payload?: unknown, authenticated = true) => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    try {
      const response = await fetcher(new URL(path, origin), {
        method: payload === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: requestSignal,
        headers: { ...(authenticated ? { Authorization: `Bearer ${options.credential}` } : {}),
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
      });
      if (!response.ok) { await response.body?.cancel(); throw new TransportFailure(response.status >= 500 || response.status === 429); }
      return { response, signal: requestSignal };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TransportFailure) throw error;
      // Network exceptions can include credentials and request URLs.
      throw new TransportFailure(true);
    }
  };
  const json = async (path: string, signal: AbortSignal, payload?: unknown, authenticated = true) => {
    const result = await request(path, signal, payload, authenticated);
    try { return JSON.parse((await readBounded(result.response, 512 * 1024, result.signal)).toString('utf8')); }
    catch { signal.throwIfAborted(); throw new TransportFailure(true); }
  };
  const negotiate = async (signal: AbortSignal) => {
    const manifest = await json(THINGTIME_CAPABILITY_MANIFEST_PATH, signal, undefined, false);
    if (manifest?.schemaVersion !== 1 || manifest.origin !== origin.origin ||
        !Object.entries(PERSONAL_RECORDING_REQUIREMENTS).every(([feature, version]) =>
          typeof manifest.features?.[feature]?.version === 'string' && capabilitySatisfies(manifest.features[feature].version, version)) ||
        !Array.isArray(manifest.operations) || !['GET', 'POST'].every(method => manifest.operations.some((op: any) =>
          op?.feature === 'api.lopu-recordings-personal' && op.path === PERSONAL_RECORDING_PATH && Array.isArray(op.methods) && op.methods.includes(method))))
      throw new Error('This Thingtime origin does not support the personal recording worker yet.');
  };
  return {
    async runOnce({ signal = new AbortController().signal }: { signal?: AbortSignal } = {}) {
      if (running) throw new Error('This recording worker is already running.');
      running = true;
      const stopped = new AbortController();
      const jobSignal = AbortSignal.any([signal, stopped.signal, AbortSignal.timeout(PERSONAL_RECORDING_MAX_RUN_MS)]);
      let heartbeat: Promise<void> | undefined;
      let claim: Claim | null = null;
      let stage: 'transcription' | 'analysis' | 'runtime' = 'runtime';
      let submitting = false;
      try {
        await negotiate(jobSignal);
        claim = parsePersonalRecordingClaim(await json(PERSONAL_RECORDING_PATH, jobSignal, { op: 'claim' }));
        if (!claim) return { status: 'idle' as const };
        const identity = { jobId: claim.jobId, leaseId: claim.leaseId };
        heartbeat = (async () => {
          try {
            for (;;) {
              await sleep(options.heartbeatMs ?? PERSONAL_RECORDING_HEARTBEAT_MS, undefined, { signal: jobSignal });
              const reply = await json(PERSONAL_RECORDING_PATH, jobSignal, { op: 'heartbeat', ...identity });
              if (reply?.ok !== true) throw new TransportFailure();
            }
          } catch { if (!jobSignal.aborted) stopped.abort(); }
        })();
        let transcript = claim.transcript;
        if (!transcript) {
          stage = 'transcription';
          const result = await request(`${PERSONAL_RECORDING_PATH}?${new URLSearchParams(identity)}`, jobSignal);
          if (result.response.headers.get('content-type')?.split(';')[0].trim() !== claim.type) {
            await result.response.body?.cancel(); throw new TransportFailure();
          }
          const bytes = await readBounded(result.response, claim.bytes, result.signal);
          if (bytes.byteLength !== claim.bytes) throw new TransportFailure();
          transcript = await options.runtime.transcribe({ bytes, type: claim.type, signal: jobSignal });
        }
        jobSignal.throwIfAborted();
        if (!transcript.trim() || transcript.length > RECORDING_MAX_TRANSCRIPT_CHARS) throw new TransportFailure();
        stage = 'analysis';
        const analysis = claim.organize
          ? await options.runtime.complete({ system: RECORDING_INSIGHTS_PROMPT, prompt: transcript, signal: jobSignal })
          : '{"items":[]}';
        jobSignal.throwIfAborted();
        const payload = parsePersonalRecordingRequest({ op: 'complete', ...identity, transcript, analysis });
        // Retry the exact result, not inference. The server must commit/check a
        // receipt bound to this lease before returning success.
        submitting = true;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const reply = await json(PERSONAL_RECORDING_PATH, jobSignal, payload);
            if (reply?.ok !== true || reply.jobId !== claim.jobId || reply.leaseId !== claim.leaseId || reply.status !== 'done')
              throw new TransportFailure();
            return { status: 'done' as const, jobId: claim.jobId };
          } catch (error) {
            if (jobSignal.aborted || !(error instanceof TransportFailure) || !error.retryable || attempt === 2) throw error;
            await sleep((options.retryMs ?? 1000) * (attempt + 1), undefined, { signal: jobSignal });
          }
        }
        throw new TransportFailure();
      } catch {
        // Never mark an uncertain completion failed: its server commit may
        // already have succeeded. Revoked/aborted work sends no more requests.
        if (claim && !submitting && !jobSignal.aborted) {
          await json(PERSONAL_RECORDING_PATH, jobSignal, { op: 'failed', jobId: claim.jobId, leaseId: claim.leaseId, stage }).catch(() => {});
        }
        throw new Error('Personal recording processing stopped. Check the paired device, consent, runtime and connection.');
      } finally {
        stopped.abort();
        await heartbeat;
        running = false;
      }
    }
  };
};
