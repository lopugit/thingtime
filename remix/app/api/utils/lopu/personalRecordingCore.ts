import { createHash } from 'node:crypto';
import { parseRecordingInsights, RECORDING_MAX_AUDIO_BYTES, RECORDING_MAX_TRANSCRIPT_CHARS } from './recordingsCore';

// An already paired device still needs explicit selection in recording settings.
// This capability never grants access to another account or arbitrary tasks.
export const PERSONAL_RECORDING_CAPABILITY = 'recordings.personal.v1';
export const PERSONAL_RECORDING_HEARTBEAT_MS = 30_000;
export const PERSONAL_RECORDING_MAX_RUN_MS = 10 * 60_000;
export const PERSONAL_RECORDING_PATH = '/api/v1/lopu/recordings/personal';
export const PERSONAL_RECORDING_REQUIREMENTS = { 'api.lopu-recordings-personal': '1.0.0' } as const;

const AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'video/mp4', 'audio/webm']);
export const personalRecordingAudioIsSupported = (type: unknown, bytes: unknown): boolean =>
	typeof type === 'string' && AUDIO_TYPES.has(type) && typeof bytes === 'number' && Number.isSafeInteger(bytes) &&
	bytes > 0 && bytes <= RECORDING_MAX_AUDIO_BYTES;

type LeaseIdentity = { jobId: string; leaseId: string };
export type PersonalRecordingRequest =
	| { op: 'claim' }
	| ({ op: 'heartbeat' } & LeaseIdentity)
	| ({ op: 'complete'; transcript: string; analysis: string } & LeaseIdentity)
	| ({ op: 'failed'; stage: 'transcription' | 'analysis' | 'runtime' } & LeaseIdentity);

const identity = (input: Record<string, unknown>): LeaseIdentity => {
	if (typeof input.jobId !== 'string' || !/^lopu-recording-job-[a-f0-9]{64}$/.test(input.jobId) ||
		typeof input.leaseId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.leaseId))
		throw new TypeError('Choose a valid recording lease.');
	return { jobId: input.jobId, leaseId: input.leaseId };
};

export const parsePersonalRecordingRequest = (input: unknown): PersonalRecordingRequest => {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Choose a recording operation.');
	const value = input as Record<string, unknown>;
	if (value.op === 'claim') return { op: 'claim' };
	const lease = identity(value);
	if (value.op === 'heartbeat') return { op: 'heartbeat', ...lease };
	if (value.op === 'failed') {
		if (value.stage !== 'transcription' && value.stage !== 'analysis' && value.stage !== 'runtime')
			throw new TypeError('Choose a recording failure stage.');
		return { op: 'failed', ...lease, stage: value.stage };
	}
	if (value.op === 'complete') {
		if (typeof value.transcript !== 'string' || !value.transcript.trim() || value.transcript.length > RECORDING_MAX_TRANSCRIPT_CHARS ||
			typeof value.analysis !== 'string' || value.analysis.length > 64 * 1024)
			throw new TypeError('Recording results exceed their limits.');
		// Validate against the exact transcript before accepting a result. The
		// same canonical parser is applied again before server-side persistence.
		try { parseRecordingInsights(value.analysis, value.transcript); }
		catch { throw new TypeError('Recording analysis must contain bounded, transcript-grounded notes or todos.'); }
		return { op: 'complete', ...lease, transcript: value.transcript, analysis: value.analysis };
	}
	throw new TypeError('Choose a recording operation.');
};

export const personalRecordingReceiptHash = (input: Extract<PersonalRecordingRequest, { op: 'complete' }>) =>
	createHash('sha256').update(JSON.stringify([
		'thingtime-personal-recording-result-v1', input.jobId, input.leaseId, input.transcript, input.analysis
	])).digest('hex');

export const personalRecordingLeaseIsLive = (
	job: { lease?: unknown; leaseUntil?: unknown; runtimeStartedAt?: unknown },
	leaseId: string,
	now: Date
) => {
	const expiry = new Date(job.leaseUntil as string).getTime();
	const started = new Date(job.runtimeStartedAt as string).getTime();
	return job.lease === leaseId && Number.isFinite(expiry) && Number.isFinite(started) &&
		started <= now.getTime() && expiry > now.getTime() && now.getTime() - started < PERSONAL_RECORDING_MAX_RUN_MS;
};
