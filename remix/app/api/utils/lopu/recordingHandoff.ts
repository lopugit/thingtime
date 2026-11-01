import { getHomeThingsCollection } from '../mongodb/collections';
import { findUserById, toPublicUserWithStorage } from '../auth/users';
import { createLopuChat } from '../messenger/lopuChats';
import { RECORDING_JOB_KIND } from './recordingsCore';
import { getRecordingSettings, queueRecordingPost, recordingJobState, recordingSource } from './recordingsStore';

export async function requestRecordingHandoff(ownerId: string, postId: string) {
	if (!(await getRecordingSettings(ownerId)).enabled) return { ok: false as const, status: 409, error: 'Enable recording AI in Thingtime’s recording settings first, then Send to Lopu.' };
	if (!(await queueRecordingPost(ownerId, postId))) return { ok: false as const, status: 404, error: 'Choose your own private recording with ready audio.' };
	const things = await getHomeThingsCollection();
	await things.updateMany({ ownerId, targetId: postId, thingtime: RECORDING_JOB_KIND, 'crystal.handoffStatus': { $exists: false } },
		{ $set: { 'crystal.handoffStatus': 'queued', updatedAt: new Date() } });
	return { ok: true as const, message: 'Queued for Lopu. Once the transcript is ready, Lopu will act on it in a private conversation. Check Lopu for results or confirmation requests.' };
}

// An at-most-once dispatch marker precedes tool execution. After an ambiguous
// interruption, never silently rerun actions: the saved conversation is the
// recovery surface. This is separate from automatic notes/todos opt-in.
export async function runRecordingHandoffs() {
	const things = await getHomeThingsCollection();
	const jobs = await things.find({ thingtime: RECORDING_JOB_KIND, 'crystal.status': 'done', 'crystal.handoffStatus': 'queued' }).sort({ updatedAt: 1 }).limit(10).toArray();
	let sent = 0;
	for (const job of jobs) {
		if (sent >= 1) break;
		if (!(await getRecordingSettings(job.ownerId)).enabled || !(await recordingSource(job))) {
			await things.updateOne({ _id: job._id, 'crystal.handoffStatus': 'queued' }, { $set: { 'crystal.handoffStatus': 'cancelled', updatedAt: new Date() } });
			continue;
		}
		const userDoc = await findUserById(job.ownerId);
		if (!userDoc) { await things.updateOne({ _id: job._id }, { $set: { 'crystal.handoffStatus': 'cancelled' } }); continue; }
		const user = await toPublicUserWithStorage(userDoc);
		const ids = recordingJobState(job).commentIds;
		const comments = await things.find({ shareId: { $in: ids }, ownerId: job.ownerId, targetId: job.targetId, thingtime: 'comment' }).limit(20).toArray();
		if (comments.length !== ids.length || !ids.length) { await things.updateOne({ _id: job._id }, { $set: { 'crystal.handoffStatus': 'needs-attention' } }); continue; }
		const byId = new Map<string, any>(comments.map((row: any) => [row.shareId, row]));
		const transcript = ids.map((id) => String(byId.get(id)?.crystal?.text || '')).join('\n\n');
		const claimed = await things.updateOne({ _id: job._id, 'crystal.handoffStatus': 'queued' }, { $set: { 'crystal.handoffStatus': 'started', updatedAt: new Date() } });
		if (!claimed.matchedCount) continue;
		try {
			const chat = await createLopuChat(job.ownerId, { title: `Recording: ${String(job.crystal.filename).slice(0, 90)}` });
			if (chat.ok === false) throw new Error('Chat unavailable');
			const chatId = chat.chat.id;
			await things.updateOne({ _id: job._id }, { $set: { 'crystal.handoffChatId': chatId } });
			if (!(await getRecordingSettings(job.ownerId)).enabled || !(await recordingSource(job))) throw new Error('Recording consent changed');
			const existing = recordingJobState(job).resultIds || [];
			const text = `I selected Send to Lopu for my private recording ${job.targetId}. Please act on my instructions in its transcript using your available tools. Ask me about ambiguities and retain confirmation requirements. Never say an action succeeded without a tool receipt. Existing generated Things: ${existing.join(', ') || 'none'} — inspect and reuse these instead of duplicating notes/todos.\n\n${transcript.length <= 6500 ? transcript : `Read the full transcript comments with get_thing first, in this order: ${ids.join(', ')}`}`;
			const { replyAsUser } = await import('~/routes/api/v1/lopu/chats/reply/_reply');
			const response = await replyAsUser(new Request('https://thingtime.internal/api/v1/lopu/chats/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, text, requestId: `recording-${job.shareId}` }) }), user);
			// Drain the standard stream so persistence, billing, tool checks and
			// confirmation cards finish through the same path as typed chat.
			const output = await response.text();
			if (!response.ok || output.includes('"type":"error"')) throw new Error('Handoff needs attention');
			await things.updateOne({ _id: job._id }, { $set: { 'crystal.handoffStatus': 'sent', updatedAt: new Date() } });
			sent++;
		} catch {
			await things.updateOne({ _id: job._id }, { $set: { 'crystal.handoffStatus': 'needs-attention', updatedAt: new Date() } });
		}
	}
	return { sent };
}
