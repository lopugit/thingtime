// API-layer broker for the outbound personal worker. Not exposed until its
// route, manifest, device-selection UI and integration tests ship together.
import { randomUUID } from 'node:crypto';
import type { DeviceActor } from '../devices/deviceAuth';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { runWithMongoEndpoint } from '../mongodb/endpoint';
import { assertPersonalRecordingAuthority, assertPersonalRecordingJob, PersonalRecordingUnavailable } from './personalRecordingAuth';
import {
	PERSONAL_RECORDING_HEARTBEAT_MS, PERSONAL_RECORDING_MAX_RUN_MS,
	PersonalRecordingCompletionPending,
	parsePersonalRecordingRequest, personalRecordingAudioIsSupported, personalRecordingReceiptHash
} from './personalRecordingCore';
import { parseRecordingInsights, RECORDING_JOB_KIND, RECORDING_MAX_ATTEMPTS, recordingRetryAt } from './recordingsCore';
import { discoverRecordingUploads, getRecordingSettings, recordingJobState, recordingSource, recordingStateBlob } from './recordingsStore';
import { readRecordingBytes } from './recordingsProvider';
import { processRecordingJob, recordingTranscriptState } from './recordingsWorker';

const scope = (actor: DeviceActor) => ({ ownerId: actor.userId, thingtime: RECORDING_JOB_KIND, runtimeDeviceId: actor.deviceId });
const identity = (actor: DeviceActor, request: { jobId: string; leaseId: string }) => ({
	...scope(actor), shareId: request.jobId, lease: request.leaseId, runtimeSessionId: actor.sessionId
});
const lifetime = (now: Date, started: Date) => new Date(Math.min(
	now.getTime() + PERSONAL_RECORDING_HEARTBEAT_MS * 3, started.getTime() + PERSONAL_RECORDING_MAX_RUN_MS
));

export const claimPersonalRecording = async (actor: DeviceActor) => {
	await assertPersonalRecordingAuthority(actor);
	// Also works on origins without a hosted cron. A paired device may discover
	// only its own account's explicitly opted-in new uploads, never other users'.
	await discoverRecordingUploads(actor.userId);
	const things = await getHomeThingsCollection();
	const job = await withHomeMongoTransaction(async (session) => {
		await assertPersonalRecordingAuthority(actor, session);
		const now = new Date();
		// One live job per selected device. Touching the selected settings above
		// serializes concurrent claims, including requests from two sessions.
		if (await things.findOne({ ...scope(actor), leaseUntil: { $gt: now } }, { session })) return null;
		return things.findOneAndUpdate({
			...scope(actor), nextRunAt: { $lte: now },
			'crystal.status': { $in: ['queued', 'retry', 'processing'] }, 'crystal.attempts': { $lt: RECORDING_MAX_ATTEMPTS },
			$or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }]
		}, {
			$set: {
				lease: randomUUID(), leaseUntil: lifetime(now, now), runtimeStartedAt: now,
				runtimeSessionId: actor.sessionId, 'crystal.status': 'processing', updatedAt: now
			},
			$inc: { 'crystal.attempts': 1 },
			$unset: { runtimeCompleting: '', runtimeReceiptHash: '', runtimeReceiptLease: '' }
		}, { session, sort: { nextRunAt: 1, shareId: 1 }, returnDocument: 'after' });
	});
	if (!job) return { ok: true as const, job: null };
	try {
		const source = await recordingSource(job);
		if (!source || !personalRecordingAudioIsSupported(source.attachment.crystal?.contentType, source.attachment.objectSizeBytes))
			throw new PersonalRecordingUnavailable();
		const settings = await getRecordingSettings(actor.userId);
		const state = recordingJobState(job);
		await assertPersonalRecordingJob(job);
		// The worker receives no object URL, account id, tool program or prompt.
		return { ok: true as const, job: {
			jobId: job.shareId, leaseId: job.lease,
			type: source.attachment.crystal.contentType, bytes: source.attachment.objectSizeBytes,
			...(state.transcript ? { transcript: state.transcript } : {}),
			organize: !state.insights && (settings.createNotes || settings.createTodos)
		} };
	} catch {
		await things.updateOne({ ...scope(actor), shareId: job.shareId, lease: job.lease }, {
			$set: { 'crystal.status': 'paused', 'crystal.error': 'Check the selected device and private recording before retrying.', updatedAt: new Date() },
			$unset: { lease: '', leaseUntil: '' }
		});
		throw new PersonalRecordingUnavailable();
	}
};

const leasedJob = async (actor: DeviceActor, request: { jobId: string; leaseId: string }, session?: any) => {
	const job = await (await getHomeThingsCollection()).findOne(identity(actor, request), { session });
	if (!job) throw new PersonalRecordingUnavailable();
	await assertPersonalRecordingJob(job, session);
	if (!(await recordingSource(job))) throw new PersonalRecordingUnavailable();
	return job;
};

export const readPersonalRecordingAudio = async (actor: DeviceActor, input: unknown) => runWithMongoEndpoint(null, async () => {
	const request = parsePersonalRecordingRequest(input);
	if (request.op !== 'heartbeat') throw new TypeError('Choose a recording lease.');
	const job = await leasedJob(actor, request);
	const audio = await readRecordingBytes(actor.userId, job.crystal.attachmentId);
	// Downloads can outlive a revocation or a privacy change. Recheck before
	// returning bytes rather than disclosing a signed storage URL to the worker.
	await leasedJob(actor, request);
	return audio;
});

export const heartbeatPersonalRecording = async (actor: DeviceActor, input: unknown) => {
	const request = parsePersonalRecordingRequest(input);
	if (request.op !== 'heartbeat') throw new TypeError('Choose a recording lease.');
	return withHomeMongoTransaction(async (session) => {
		await assertPersonalRecordingAuthority(actor, session);
		// Completion clears the active lease. An in-flight heartbeat must not
		// abort the client's already committed completion response in that race.
		if (await (await getHomeThingsCollection()).findOne({
			...scope(actor), shareId: request.jobId, runtimeSessionId: actor.sessionId,
			runtimeReceiptLease: request.leaseId, 'crystal.status': 'done'
		}, { session })) return { ok: true as const };
		const job = await leasedJob(actor, request, session);
		const now = new Date();
		await (await getHomeThingsCollection()).updateOne(identity(actor, request), {
			$set: { leaseUntil: lifetime(now, new Date(job.runtimeStartedAt)), updatedAt: now }
		}, { session });
		return { ok: true as const };
	});
};

export const completePersonalRecording = async (actor: DeviceActor, input: unknown) => runWithMongoEndpoint(null, async () => {
	const request = parsePersonalRecordingRequest(input);
	if (request.op !== 'complete') throw new TypeError('Choose a completed recording.');
	const hash = personalRecordingReceiptHash(request);
	const things = await getHomeThingsCollection();
	const receipt = { ok: true as const, jobId: request.jobId, leaseId: request.leaseId, status: 'done' as const };
	const accepted = await withHomeMongoTransaction(async (session) => {
		await assertPersonalRecordingAuthority(actor, session);
		const prior = await things.findOne({ ...scope(actor), shareId: request.jobId, runtimeSessionId: actor.sessionId }, { session });
		// A lost HTTP response may be retried after completion cleared the lease.
		// Exact owner/device/session/lease/result must still match the receipt.
		if (prior?.crystal.status === 'done' && prior.runtimeReceiptHash === hash && prior.runtimeReceiptLease === request.leaseId)
			return { done: true as const };
		const job = await leasedJob(actor, request, session);
		if (job.runtimeCompleting) {
			if (job.runtimeReceiptHash === hash && job.runtimeReceiptLease === request.leaseId)
				throw new PersonalRecordingCompletionPending();
			throw new PersonalRecordingUnavailable();
		}
		const state = recordingTranscriptState(recordingJobState(job), request.transcript);
		// Preserve checkpoint ids on retry. The shared content writer, not the
		// device, chooses every output id, ACL, parent and quota charge.
		const secure = recordingStateBlob({ ...state,
			...(!state.insights ? { insights: parseRecordingInsights(request.analysis, request.transcript).map((item) => ({ ...item, id: randomUUID() })) } : {})
		});
		await things.updateOne(identity(actor, request), { $set: {
			secure, runtimeCompleting: true, runtimeReceiptHash: hash, runtimeReceiptLease: request.leaseId
		} }, { session });
		return { done: false as const, job: { ...job, secure } };
	});
	if (accepted.done) return receipt;
	const outcome = await processRecordingJob(accepted.job, {
		transcribe: async () => request.transcript,
		analyze: async () => { throw new Error('Personal results must not call a cloud provider.'); }
	});
	if (outcome !== 'done') throw new PersonalRecordingUnavailable();
	return receipt;
});

export const failPersonalRecording = async (actor: DeviceActor, input: unknown) => {
	const request = parsePersonalRecordingRequest(input);
	if (request.op !== 'failed') throw new TypeError('Choose a recording failure.');
	return withHomeMongoTransaction(async (session) => {
		const job = await leasedJob(actor, request, session);
		// A late client failure must not overwrite a completion being persisted.
		if (job.runtimeCompleting) throw new PersonalRecordingUnavailable();
		const now = new Date();
		await (await getHomeThingsCollection()).updateOne(identity(actor, request), {
			$set: {
				'crystal.status': job.crystal.attempts >= RECORDING_MAX_ATTEMPTS ? 'failed' : 'retry',
				'crystal.error': 'The personal recording runtime could not finish. Check that device and retry.',
				nextRunAt: recordingRetryAt(job.crystal.attempts, now), updatedAt: now
			}, $unset: { lease: '', leaseUntil: '' }
		}, { session });
		return { ok: true as const };
	});
};
