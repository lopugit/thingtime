import { getHomeThingsCollection } from '../mongodb/collections';
import { RECORDING_JOB_KIND } from './recordingsCore';
import { recordingId, recordingJobState } from './recordingsStore';
import { canReadRecordingTranscript, projectRecordingTranscript } from './recordingTranscriptProjection';

export const readRecordingTranscripts = async (ownerId: string, attachmentIds: string[]) => {
	const things = await getHomeThingsCollection();
	const attachments = await things.find({ ownerId, shareId: { $in: attachmentIds }, thingtime: 'attachment' }).toArray();
	const targets = attachments.map((attachment: any) => attachment.targetId || attachment.shareId);
	const jobIds = attachments.map((attachment: any, index: number) => recordingId('job', ownerId, targets[index], attachment.shareId));
	const [parents, jobs] = await Promise.all([
		things.find({ ownerId, shareId: { $in: targets } }).toArray(),
		things.find({ ownerId, shareId: { $in: jobIds }, thingtime: RECORDING_JOB_KIND }).toArray()
	]);
	const byId = new Map([...attachments, ...parents].map((row: any) => [row.shareId, row]));
	const eligible = jobs.filter((job: any) => canReadRecordingTranscript(ownerId, byId.get(job.crystal?.attachmentId), byId.get(job.targetId)));
	const selections = eligible.map((job: any) => {
		const state = recordingJobState(job);
		return { job, ids: state.commentIds.slice(0, Math.min(state.commentIndex, 100)) };
	});
	const ids = [...new Set(selections.flatMap(({ ids }) => ids))];
	if (!ids.length) return [];
	const comments = await things.find({ ownerId, shareId: { $in: ids }, thingtime: 'comment' }).toArray();
	const commentMap = new Map<string, any>(comments.map((row: any) => [row.shareId, row]));
	return selections.flatMap(({ job, ids }) => {
		const text = projectRecordingTranscript(ownerId, job.targetId, ids, commentMap);
		return text ? [{ attachmentId: job.crystal.attachmentId, text }] : [];
	});
};
