import { createHash, randomUUID } from 'node:crypto';
import { packSecure, unpackSecure } from '../auth/users';
import { getHomeThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
	parseRecordingSettingsPatch,
	recordingSettingsOf,
	RECORDING_JOB_KIND,
	RECORDING_SETTINGS_KIND,
	RECORDING_REMINDER_KIND,
	RECORDING_LEASE_MS,
	type RecordingInsight
} from './recordingsCore';

export const recordingId = (scope: string, ...parts: string[]) =>
	`lopu-recording-${scope}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;

export const recordingControlDoc = (
	kind: string,
	shareId: string,
	ownerId: string,
	crystal: Record<string, unknown>,
	targetId: string | null = null
) => ({
	shareId,
	ownerId,
	thingtime: [kind],
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
	acl: [ACL_OWNER],
	storageClass: 'control',
	tags: [],
	targetId,
	crystal,
	createdAt: new Date(),
	updatedAt: new Date()
});

export const readRecordingSettingsDoc = async (ownerId: string) =>
	(await getHomeThingsCollection()).findOne({ shareId: recordingId('settings', ownerId), ownerId, thingtime: RECORDING_SETTINGS_KIND });

export const getRecordingSettings = async (ownerId: string) => recordingSettingsOf((await readRecordingSettingsDoc(ownerId))?.crystal);

export const setRecordingSettings = async (ownerId: string, input: unknown) => {
	const patch = parseRecordingSettingsPatch(input);
	const things = await getHomeThingsCollection();
	const shareId = recordingId('settings', ownerId);
	const now = new Date();
	// Insert only once, then patch just requested keys; concurrent switches cannot
	// replace one another. The first opt-in is the discovery watermark, not a
	// request to process the user's entire historical recording library.
	await things.updateOne(
		{ shareId, ownerId, thingtime: RECORDING_SETTINGS_KIND },
		{
			$setOnInsert: { ...recordingControlDoc(RECORDING_SETTINGS_KIND, shareId, ownerId, {}), scanAfter: now, scanId: '', nextRunAt: now }
		},
		{ upsert: true }
	);
	const sets: Record<string, unknown> = { updatedAt: now };
	for (const [key, value] of Object.entries(patch)) sets[`crystal.${key}`] = value;
	if (patch.enabled === true) {
		sets.nextRunAt = now;
		sets.scanAfter = { $cond: [{ $eq: ['$crystal.enabled', true] }, '$scanAfter', now] };
		sets.scanId = { $cond: [{ $eq: ['$crystal.enabled', true] }, '$scanId', ''] };
	}
	// Revoke an in-flight discovery cursor whenever opt-in changes. Its old
	// lease must never overwrite the new opt-in watermark after re-enabling.
	if (patch.enabled !== undefined) {
		sets.scanLease = '$$REMOVE';
		sets.scanLeaseUntil = '$$REMOVE';
	}
	await things.updateOne({ shareId, ownerId, thingtime: RECORDING_SETTINGS_KIND }, [{ $set: sets }]);
	return getRecordingSettings(ownerId);
};

export type RecordingJobState = {
	transcript?: string;
	commentIds: string[];
	commentIndex: number;
	insights?: Array<RecordingInsight & { id: string }>;
	insightIndex: number;
	resultIds: string[];
};

export const recordingJobState = (job: any): RecordingJobState => {
	const state = unpackSecure(job.secure).meta?.recording as RecordingJobState | undefined;
	return state || { commentIds: [], commentIndex: 0, insightIndex: 0, resultIds: [] };
};

export const recordingStateBlob = (state: RecordingJobState) => packSecure({ meta: { recording: state } } as any);

export const isPrivateRecordingPost = (post: any, ownerId: string) =>
	post &&
	post.ownerId === ownerId &&
	!post.appId &&
	!post.deletedAt &&
	Array.isArray(post.thingtime) &&
	post.thingtime.includes('post') &&
	!post.thingtime.includes('comment') &&
	Array.isArray(post.acl) &&
	post.acl.length === 1 &&
	post.acl[0] === ACL_OWNER &&
	Array.isArray(post.tags) &&
	post.tags.includes('apple-watch') &&
	/^watch-upload-/.test(post.shareId);

export const recordingSource = async (job: any) => {
	const things = await getHomeThingsCollection();
	const [post, attachment] = await Promise.all([
		things.findOne({ shareId: job.targetId, ownerId: job.ownerId }),
		things.findOne({
			shareId: job.crystal.attachmentId,
			ownerId: job.ownerId,
			thingtime: 'attachment',
			targetId: job.targetId,
			attachmentState: 'ready'
		})
	]);
	if (
		!isPrivateRecordingPost(post, job.ownerId) ||
		!attachment ||
		attachment.attachmentLinked ||
		attachment.crystal?.mediaKind !== 'audio' ||
		attachment.moderation?.status === 'blocked'
	)
		return null;
	return { post, attachment };
};

export const queueRecordingPost = async (ownerId: string, postId: string) => {
	const things = await getHomeThingsCollection();
	const post = await things.findOne({ ownerId, shareId: postId });
	if (!isPrivateRecordingPost(post, ownerId)) throw new TypeError('Choose one of your private Apple Watch recording posts.');
	const attachments = await things
		.find({
			ownerId,
			thingtime: 'attachment',
			targetId: postId,
			attachmentState: 'ready',
			'crystal.mediaKind': 'audio',
			attachmentLinked: { $ne: true }
		})
		.limit(10)
		.toArray();
	for (const attachment of attachments) {
		const shareId = recordingId('job', ownerId, postId, attachment.shareId);
		await things.updateOne(
			{ shareId, ownerId, thingtime: RECORDING_JOB_KIND },
			{
				$setOnInsert: {
					...recordingControlDoc(
						RECORDING_JOB_KIND,
						shareId,
						ownerId,
						{
							status: 'queued',
							attachmentId: attachment.shareId,
							filename: String(attachment.crystal?.name || 'Watch recording').slice(0, 200),
							attempts: 0
						},
						postId
					),
					nextRunAt: new Date(),
					secure: recordingStateBlob({ commentIds: [], commentIndex: 0, insightIndex: 0, resultIds: [] })
				}
			},
			{ upsert: true }
		);
	}
	return attachments.length;
};

// Fair, bounded discovery with a durable (createdAt, shareId) cursor. The cursor
// advances only after all matching audio attachments have durable job rows.
// This covers both native direct uploads and older iPhone-relayed uploads.
export const discoverRecordingUploads = async () => {
	const things = await getHomeThingsCollection();
	let queued = 0;
	for (let account = 0; account < 20; account++) {
		const now = new Date();
		const token = randomUUID();
		const settings = await things.findOneAndUpdate(
			{
				thingtime: RECORDING_SETTINGS_KIND,
				'crystal.enabled': true,
				nextRunAt: { $lte: now },
				$or: [{ scanLeaseUntil: { $exists: false } }, { scanLeaseUntil: { $lte: now } }]
			},
			{ $set: { scanLeaseUntil: new Date(now.getTime() + RECORDING_LEASE_MS), scanLease: token } },
			{ sort: { nextRunAt: 1, shareId: 1 }, returnDocument: 'after' }
		);
		if (!settings) break;
		try {
			const after = settings.scanAfter || settings.createdAt;
			const posts = await things
				.find({
					ownerId: settings.ownerId,
					thingtime: 'post',
					tags: 'apple-watch',
					$or: [{ createdAt: { $gt: after } }, { createdAt: after, shareId: { $gt: settings.scanId || '' } }]
				})
				.sort({ createdAt: 1, shareId: 1 })
				.limit(50)
				.toArray();
			for (const post of posts) {
				if (!(await things.findOne({ shareId: settings.shareId, scanLease: token, 'crystal.enabled': true }, { projection: { _id: 1 } }))) break;
				if (isPrivateRecordingPost(post, settings.ownerId)) queued += await queueRecordingPost(settings.ownerId, post.shareId);
				await things.updateOne({ shareId: settings.shareId, scanLease: token }, { $set: { scanAfter: post.createdAt, scanId: post.shareId } });
			}
		} finally {
			await things.updateOne(
				{ shareId: settings.shareId, scanLease: token },
				{
					$set: { nextRunAt: new Date(Date.now() + 5 * 60_000) },
					$unset: { scanLeaseUntil: '', scanLease: '' }
				}
			);
		}
	}
	return queued;
};

export const listRecordingAutomation = async (ownerId: string) => {
	const things = await getHomeThingsCollection();
	const [settings, jobs, reminders] = await Promise.all([
		getRecordingSettings(ownerId),
		things.find({ ownerId, thingtime: RECORDING_JOB_KIND }).sort({ createdAt: -1, shareId: 1 }).limit(50).toArray(),
		things.find({ ownerId, thingtime: RECORDING_REMINDER_KIND }).sort({ createdAt: -1, shareId: 1 }).limit(100).toArray()
	]);
	const ids = reminders.map((row: any) => row.targetId);
	const todos = ids.length ? await things.find({ ownerId, shareId: { $in: ids }, thingtime: 'data' }).toArray() : [];
	const byId = new Map(todos.map((todo: any) => [todo.shareId, todo]));
	return {
		settings,
		jobs: jobs.map((job: any) => ({
			id: job.shareId,
			postId: job.targetId,
			filename: job.crystal.filename,
			status: job.crystal.status,
			attempts: job.crystal.attempts,
			error: job.crystal.error || null,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			nextRunAt: job.nextRunAt || null,
			commentIds: recordingJobState(job).commentIds.slice(0, recordingJobState(job).commentIndex),
			resultIds: recordingJobState(job).resultIds
		})),
		todos: reminders.flatMap((row: any) => {
			const todo: any = byId.get(row.targetId);
			return todo
				? [
						{
							id: todo.shareId,
							title: String(todo.crystal?.title || 'Recording todo').slice(0, 200),
							completed: todo.crystal?.completed === true,
							reminders: row.crystal.enabled !== false,
							sourcePostId: row.crystal.sourcePostId
						}
				  ]
				: [];
		})
	};
};

export const retryRecordingJob = async (ownerId: string, jobId: string) => {
	const result = await (
		await getHomeThingsCollection()
	).updateOne(
		{
			ownerId,
			shareId: jobId,
			thingtime: RECORDING_JOB_KIND,
			'crystal.status': { $in: ['failed', 'retry', 'paused'] }
		},
		{
			$set: { 'crystal.status': 'queued', 'crystal.attempts': 0, updatedAt: new Date(), nextRunAt: new Date() },
			$unset: { 'crystal.error': '', lease: '', leaseUntil: '' }
		}
	);
	return result.matchedCount > 0;
};
