import { createHash } from 'node:crypto';
import { getHomeThingsCollection } from '../mongodb/collections';
import { createThing, getThing, updateThing } from '../things/things';
import { createLopuChat, getLopuChat, persistLopuAssistantTurn } from '../messenger/lopuChats';
import { findUserById, toPublicUserWithStorage } from '../auth/users';
import { emitSystemNotificationOnce } from '../notifications/notifications';
import { ACL_OWNER } from '~/schemas/registry';

// A durable execution claim precedes inference. An ambiguous interrupted run
// is stopped for owner review, never blindly repeated (tools may have acted).
export async function deliverScheduledLopuMessage(row: any, source: any, lease: string): Promise<boolean> {
	const things = await getHomeThingsCollection();
	const occurrence = row.nextRunAt.toISOString();
	const requestId = `scheduled-${createHash('sha256').update(`${row.shareId}:${occurrence}`).digest('hex')}`;
	const claimed = await things.updateOne({ _id: row._id, lease, 'crystal.enabled': true, 'crystal.activeOccurrence': { $ne: occurrence } }, { $set: { 'crystal.activeOccurrence': occurrence, 'crystal.runStatus': 'running' } });
	if (!claimed.matchedCount) {
		if (row.crystal.activeOccurrence === occurrence && row.crystal.runStatus === 'done') return true;
		await things.updateOne({ _id: row._id, lease }, { $set: { 'crystal.enabled': false, 'crystal.runStatus': 'needs-attention' } });
		return false;
	}
	let runId: string | null = null;
	try {
		const viewerDoc = await findUserById(row.ownerId);
		if (!viewerDoc) throw new Error('Account unavailable');
		const viewer = await toPublicUserWithStorage(viewerDoc);
		for (const id of row.crystal.relatedThingIds ?? []) {
			const linked = await getThing(viewer, id);
			if (!linked.ok) throw new Error('Linked Thing unavailable');
			if ((linked.thing.crystal as any)?.completed === true) throw new Error('Linked todo completed');
		}
		const destination = row.crystal.chatId || (!row.crystal.newChatEachRun && row.crystal.destinationChatId);
		const chat = destination ? await getLopuChat(row.ownerId, destination) : await createLopuChat(row.ownerId, { title: row.crystal.title });
		if (!chat.ok) throw new Error('Conversation unavailable');
		const chatId = chat.chat.id;
		const held = await things.updateOne({ _id: row._id, lease, 'crystal.enabled': true }, { $set: { 'crystal.destinationChatId': chatId } });
		if (!held.matchedCount) throw new Error('Schedule paused');
		const run = await createThing(row.ownerId, { thingtime: ['scheduled-task-run'], targetId: source.shareId, acl: [ACL_OWNER], tags: ['scheduled-task-run'], crystal: {
			title: `${row.crystal.title} · ${occurrence}`, chatId, scheduledAt: occurrence, status: 'running'
		} }, viewer);
		if (!run.ok) throw new Error('Run unavailable');
		runId = run.doc.shareId;
		let preview = row.crystal.description || row.crystal.title;
		if (row.crystal.mode === 'assistant') {
			const { replyAsUser } = await import('~/routes/api/v1/lopu/chats/reply/_reply');
			const text = `Scheduled task: ${row.crystal.title}\n${row.crystal.description}\n\nTask: /thing/${source.shareId}\nRun: /thing/${runId}\nProduce the requested update now. Be explicit about sources and unavailable information; do not invent live updates. Do not create further schedules. Retain all confirmation requirements.`;
			const response = await replyAsUser(new Request('https://thingtime.internal/api/v1/lopu/chats/reply', { method: 'POST', signal: AbortSignal.timeout(120_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, requestId, text, thingIds: row.crystal.relatedThingIds ?? [] }) }), viewer, { scheduled: true });
			const body = await response.text();
			if (!response.ok) throw new Error('Scheduled reply unavailable');
			const events = body.trim().split('\n').map(line => JSON.parse(line));
			if (events.some(event => event.type === 'error') || !events.some(event => event.type === 'done')) throw new Error('Scheduled reply incomplete');
			preview = events.filter(event => event.type === 'delta').map(event => event.text).join('').slice(0, 300) || preview;
		} else {
			const saved = await persistLopuAssistantTurn(row.ownerId, { chatId, requestId, text: `${preview}\n\n[Scheduled task](/thing/${source.shareId}) · [Run details](/thing/${runId})`, unread: true });
			if (!saved.ok) throw new Error('Message unavailable');
		}
		const completed = await updateThing(viewer, runId, { crystal: { status: 'done' } });
		if (completed.ok === false) throw new Error('Could not save run status');
		await things.updateOne({ _id: row._id, lease }, { $set: { 'crystal.runStatus': 'done', 'crystal.lastRunThingId': runId } });
		try {
			await emitSystemNotificationOnce({ recipientId: row.ownerId, type: 'lopu-message', title: row.crystal.title, preview, targetId: source.shareId, href: `/lopu/${chatId}`, delivery: row.crystal.delivery }, `lopu-recording-notification-${requestId}`, async () => true);
		} catch {
			await updateThing(viewer, runId, { crystal: { notificationStatus: 'unavailable' } }).catch(() => null);
		}
		return true;
	} catch {
		if (runId) await updateThing({ id: row.ownerId }, runId, { crystal: { status: 'needs-attention' } }).catch(() => null);
		await things.updateOne({ _id: row._id, lease }, { $set: { 'crystal.enabled': false, 'crystal.runStatus': 'needs-attention', ...(runId ? { 'crystal.lastRunThingId': runId } : {}) } });
		return false;
	}
}
