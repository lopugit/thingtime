import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection } from '../mongodb/collections';
import { runWithMongoEndpoint } from '../mongodb/endpoint';
import { createThing } from '../things/things';
import { MAX_COMMENT_CHARS } from '~/schemas/registry';
import {
	RECORDING_JOB_KIND,
	RECORDING_SETTINGS_KIND,
	RECORDING_REMINDER_KIND,
	RECORDING_LEASE_MS,
	RECORDING_MAX_ATTEMPTS,
	recordingRetryAt
} from './recordingsCore';
import {
	discoverRecordingUploads,
	getRecordingSettings,
	isPrivateRecordingPost,
	recordingControlDoc,
	recordingId,
	recordingJobState,
	recordingSource,
	recordingStateBlob,
	type RecordingJobState
} from './recordingsStore';
import { analyzeRecording, recordingProviderStatus, transcribeRecording } from './recordingsProvider';

class RecordingPaused extends Error {}

const assertActive = async (job: any) => {
	if (!(await getRecordingSettings(job.ownerId)).enabled) throw new RecordingPaused('Recording automation is switched off.');
	if (!(await recordingSource(job))) throw new RecordingPaused('The recording is unavailable or no longer private.');
};

// This hook commits the content, quota charge, and job checkpoint together.
// A process dying after commit cannot recreate a comment/todo on its next run.
const checkpointHook = (job: any, state: RecordingJobState, reminder?: { id: string; title: string }) => async (_doc: unknown, session: any) => {
	const things = await getHomeThingsCollection();
	const post = await things.findOne({ shareId: job.targetId, ownerId: job.ownerId }, { session });
	if (!isPrivateRecordingPost(post, job.ownerId)) throw new RecordingPaused('The source recording is no longer private.');
	const active = await things.updateOne(
		{
			shareId: recordingId('settings', job.ownerId),
			ownerId: job.ownerId,
			thingtime: RECORDING_SETTINGS_KIND,
			'crystal.enabled': true
		},
		{ $inc: { recordingWriteFence: 1 } },
		{ session }
	);
	if (!active.matchedCount) throw new RecordingPaused('Recording automation is switched off.');
	// Touch the source inside the same transaction to serialize against deletion
	// or ACL changes, rather than authorizing a private write from an old snapshot.
	await things.updateOne({ _id: post._id }, { $inc: { recordingWriteFence: 1 } }, { session });
	const updated = await things.updateOne(
		{ shareId: job.shareId, lease: job.lease },
		{
			$set: { secure: recordingStateBlob(state), updatedAt: new Date() }
		},
		{ session }
	);
	if (!updated.matchedCount) throw new RecordingPaused('Another worker owns this recording.');
	if (reminder) {
		const id = recordingId('reminder', job.ownerId, reminder.id);
		await things.updateOne(
			{ shareId: id, ownerId: job.ownerId, thingtime: RECORDING_REMINDER_KIND },
			{
				$setOnInsert: {
					...recordingControlDoc(RECORDING_REMINDER_KIND, id, job.ownerId, { enabled: true, sourcePostId: job.targetId }, reminder.id),
					nextRunAt: new Date()
				}
			},
			{ session, upsert: true }
		);
	}
};

const saveState = async (job: any, state: RecordingJobState, stage: string) => {
	const result = await (
		await getHomeThingsCollection()
	).updateOne(
		{ shareId: job.shareId, lease: job.lease },
		{
			$set: { secure: recordingStateBlob(state), 'crystal.stage': stage, updatedAt: new Date() }
		}
	);
	if (!result.matchedCount) throw new RecordingPaused('Another worker owns this recording.');
};

const transcriptParts = (text: string) => {
	const chars = MAX_COMMENT_CHARS - 70;
	// Split by code points so surrogate pairs cannot be broken at a boundary.
	const characters = Array.from(text);
	const chunks: string[] = [];
	let chunk = '';
	for (const character of characters) {
		if (chunk.length + character.length > chars) {
			chunks.push(chunk);
			chunk = '';
		}
		chunk += character;
	}
	if (chunk) chunks.push(chunk);
	return chunks;
};

export type RecordingWorkerDependencies = { transcribe: typeof transcribeRecording; analyze: typeof analyzeRecording };

export const processRecordingJob = async (
	job: any,
	deps: RecordingWorkerDependencies = { transcribe: transcribeRecording, analyze: analyzeRecording }
) => {
	const things = await getHomeThingsCollection();
	let state = recordingJobState(job);
	try {
		if (Number(job.crystal.attempts) > RECORDING_MAX_ATTEMPTS) throw new Error('Retry limit reached.');
		await assertActive(job);
		if (!state.transcript) {
			state.transcript = await deps.transcribe(job.ownerId, job.crystal.attachmentId, () => assertActive(job));
			state.commentIds = transcriptParts(state.transcript).map(() => randomUUID());
			await assertActive(job);
			await saveState(job, state, 'transcribed');
		}
		const parts = transcriptParts(state.transcript);
		while (state.commentIndex < parts.length) {
			await assertActive(job);
			const index = state.commentIndex;
			const next = { ...state, commentIndex: index + 1 };
			const created = await createThing(
				job.ownerId,
				{
					shareId: state.commentIds[index],
					thingtime: ['comment'],
					targetId: job.targetId,
					crystal: { text: `🦄 Lopu transcription${parts.length > 1 ? ` (${index + 1}/${parts.length})` : ''}\n\n${parts[index]}` }
				},
				{ id: job.ownerId },
				null,
				{ afterInsert: checkpointHook(job, next) }
			);
			if (created.ok === false) {
				// createThing returns transaction failures as result unions. Recheck
				// consent/privacy so a rolled-back opt-out is visibly paused.
				await assertActive(job);
				throw new Error(created.error);
			}
			state = next;
		}
		let settings = await getRecordingSettings(job.ownerId);
		if (!state.insights) {
			await assertActive(job);
			state.insights =
				settings.createNotes || settings.createTodos
					? (await deps.analyze(state.transcript, () => assertActive(job))).map((item) => ({ ...item, id: randomUUID() }))
					: [];
			await assertActive(job);
			await saveState(job, state, 'organized');
		}
		while (state.insightIndex < state.insights.length) {
			await assertActive(job);
			settings = await getRecordingSettings(job.ownerId);
			const item = state.insights[state.insightIndex];
			const selected = item.kind === 'todo' ? settings.createTodos : settings.createNotes;
			const next = { ...state, insightIndex: state.insightIndex + 1, resultIds: selected ? [...state.resultIds, item.id] : state.resultIds };
			if (selected) {
				const created = await createThing(
					job.ownerId,
					{
						shareId: item.id,
						thingtime: ['data'],
						acl: ['tt:user'],
						tags: ['apple-watch', 'lopu', item.kind],
						crystal: {
							systemType: 'lopu-recording-insight',
							type: item.kind,
							title: item.title,
							name: item.title,
							description: item.description,
							sourcePostId: job.targetId,
							evidence: item.evidence,
							...(item.kind === 'todo' ? { completed: false } : {})
						}
					},
					{ id: job.ownerId },
					null,
					{ afterInsert: checkpointHook(job, next, item.kind === 'todo' ? item : undefined) }
				);
				if (created.ok === false) {
					await assertActive(job);
					throw new Error(created.error);
				}
			} else await saveState(job, next, 'organizing');
			state = next;
		}
		// The durable, quota-billed comments/Things are the long-term content.
		// Drop private scratch text from operational state once no retry needs it.
		const receipt = { commentIds: state.commentIds, commentIndex: state.commentIndex, insightIndex: state.insightIndex, resultIds: state.resultIds };
		const completed = await things.updateOne(
			{ shareId: job.shareId, lease: job.lease },
			{
				$set: { 'crystal.status': 'done', 'crystal.stage': 'done', secure: recordingStateBlob(receipt), updatedAt: new Date() },
				$unset: { lease: '', leaseUntil: '', nextRunAt: '', 'crystal.error': '' }
			}
		);
		if (!completed.matchedCount) throw new RecordingPaused('Another worker owns this recording.');
		return 'done';
	} catch (error) {
		const paused = error instanceof RecordingPaused;
		const failed = Number(job.crystal.attempts) >= RECORDING_MAX_ATTEMPTS;
		const status = paused ? 'paused' : failed ? 'failed' : 'retry';
		// Provider/S3 exceptions can include signed URLs. Only our own fixed,
		// actionable error text leaves the worker; no raw exception is persisted.
		await things.updateOne(
			{ shareId: job.shareId, lease: job.lease },
			{
				$set: {
					'crystal.status': status,
					'crystal.error': paused
						? 'Paused: enable automation and keep the source recording private to retry.'
						: 'Processing could not finish. Check your provider, recording size and available storage, then retry.',
					updatedAt: new Date(),
					nextRunAt: recordingRetryAt(Number(job.crystal.attempts), new Date())
				},
				$unset: { lease: '', leaseUntil: '' }
			}
		);
		return status;
	}
};

export const runRecordingAutomation = async () =>
	runWithMongoEndpoint(null, async () => {
		const queued = await discoverRecordingUploads();
		if (!recordingProviderStatus().configured) return { queued, processed: 0, providerConfigured: false };
		const things = await getHomeThingsCollection();
		const outcomes: string[] = [];
		// One bounded job per invocation: a worst-case provider turn cannot exceed
		// the serverless request budget by starting a second long job near its end.
		for (let index = 0; index < 1; index++) {
			const now = new Date();
			const job = await things.findOneAndUpdate(
				{
					thingtime: RECORDING_JOB_KIND,
					nextRunAt: { $lte: now },
					'crystal.status': { $in: ['queued', 'retry', 'processing'] },
					$or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }]
				},
				{
					$set: { lease: randomUUID(), leaseUntil: new Date(now.getTime() + RECORDING_LEASE_MS), 'crystal.status': 'processing', updatedAt: now },
					$inc: { 'crystal.attempts': 1 }
				},
				{ sort: { nextRunAt: 1, shareId: 1 }, returnDocument: 'after' }
			);
			if (!job) break;
			outcomes.push(await processRecordingJob(job));
		}
		return { queued, processed: outcomes.length, outcomes, providerConfigured: true };
	});
