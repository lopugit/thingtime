import { createHash, randomUUID } from 'node:crypto';
import { getHomeThingsCollection } from '../mongodb/collections';
import { createThing, getThing } from '../things/things';
import { emitSystemNotificationOnce } from '../notifications/notifications';
import { getUserNotificationPrefs } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, normalizeNotificationPrefs } from '~/schemas/registry';
import { LOPU_REMINDER_KIND, nextReminderTime, parseReminderInput } from './remindersCore';

const receipt = (doc: any) => ({ id: doc.shareId, thingId: doc.targetId, ...doc.crystal, nextRunAt: doc.nextRunAt?.toISOString() ?? null });
export const listLopuReminders = async (ownerId: string) => {
	const rows = await (await getHomeThingsCollection()).find({ ownerId, thingtime: LOPU_REMINDER_KIND }).sort({ createdAt: -1 }).limit(100).toArray();
	return rows.map(receipt);
};
export const getLopuScheduledTask = async (ownerId: string, thingId: string) => {
	const things = await getHomeThingsCollection();
	const task = await getThing({ id: ownerId }, thingId);
	if (task.ok === false || task.thing.author?.id !== ownerId) return { ok: false as const, status: 404, error: 'Scheduled task not found.' };
	const row = await things.findOne({ ownerId, targetId: thingId, thingtime: LOPU_REMINDER_KIND });
	if (!row) return { ok: false as const, status: 404, error: 'Scheduled task not found.' };
	const runDocs = await things.find({ ownerId, thingtime: 'scheduled-task-run', targetId: thingId, acl: [ACL_OWNER] }, { projection: { shareId: 1, crystal: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(30).toArray();
	const linked = await Promise.all((row.crystal.relatedThingIds ?? []).map(async (id: string) => {
		const result = await getThing({ id: ownerId }, id);
		return result.ok ? { id: result.thing.id, title: String(result.thing.crystal.title || result.thing.crystal.name || id) } : null;
	}));
	return { ok: true as const, reminder: receipt(row), relatedThings: linked.filter(Boolean), runs: runDocs.map(run => ({ id: run.shareId, title: run.crystal.title, status: run.crystal.status, chatId: run.crystal.chatId, scheduledAt: run.crystal.scheduledAt })) };
};
export const createLopuReminder = async (ownerId: string, raw: unknown) => {
	const input = parseReminderInput(raw);
	if (input.chatId) {
		const { getLopuChat } = await import('../messenger/lopuChats');
		const chat = await getLopuChat(ownerId, input.chatId);
		if (chat.ok === false) return chat;
	}
	for (const relatedId of input.relatedThingIds ?? []) {
		if (!(await getThing({ id: ownerId }, relatedId)).ok) return { ok: false as const, status: 404, error: 'A linked Thing is unavailable.' };
	}
	const things = await getHomeThingsCollection();
	const id = `lopu-recording-schedule-${randomUUID()}`;
	const now = new Date();
	const control: any = { shareId: id, ownerId, thingtime: [LOPU_REMINDER_KIND], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		storageClass: 'control', acl: [ACL_OWNER], tags: [], crystal: { ...input, enabled: true }, nextRunAt: new Date(input.at), createdAt: now, updatedAt: now };
	const result = await createThing(ownerId, { thingtime: ['data'], crystal: { type: 'scheduled-task', title: input.title, description: input.description, scheduleId: id, schedule: input }, tags: ['scheduled-task'], acl: [ACL_OWNER] }, { id: ownerId }, null, {
		afterInsert: async (doc, session) => { control.targetId = doc.shareId; await things.insertOne(control, { session }); }
	});
	if (result.ok === false) return result;
	return { ok: true as const, reminder: receipt(control) };
};
export const setLopuReminderEnabled = async (ownerId: string, id: string, enabled: boolean) => {
	const doc = await (await getHomeThingsCollection()).findOneAndUpdate({ ownerId, shareId: id, thingtime: LOPU_REMINDER_KIND, ...(enabled ? { nextRunAt: { $type: 'date' }, 'crystal.runStatus': { $ne: 'needs-attention' } } : {}) },
		{ $set: { 'crystal.enabled': enabled, updatedAt: new Date() }, $unset: { lease: '', leaseUntil: '' } }, { returnDocument: 'after' });
	return doc ? { ok: true as const, reminder: receipt(doc) } : { ok: false as const, status: 404, error: 'Reminder not found, or already completed. Create a new reminder to schedule it again.' };
};

export const runLopuReminders = async () => {
	const things = await getHomeThingsCollection();
	let sent = 0, failed = 0;
	const deadline = Date.now() + 20_000;
	for (let n = 0; n < 100 && Date.now() < deadline; n++) {
		const now = new Date(), lease = randomUUID();
		const row = await things.findOneAndUpdate({ thingtime: LOPU_REMINDER_KIND, 'crystal.enabled': true, nextRunAt: { $type: 'date', $lte: now },
			$or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] },
			{ $set: { lease, leaseUntil: new Date(now.getTime() + 300_000) } }, { sort: { nextRunAt: 1 }, returnDocument: 'after' });
		if (!row) break;
		try {
			const source = await things.findOne({ shareId: row.targetId, ownerId: row.ownerId, thingtime: 'data', acl: [ACL_OWNER], appId: { $exists: false } });
			if (!source || source.crystal?.completed === true) { await things.updateOne({ _id: row._id, lease }, { $set: { 'crystal.enabled': false } }); continue; }
			const next = nextReminderTime(row.nextRunAt, row.crystal.everyMinutes, now, row.crystal);
			const advance = { nextRunAt: next, 'crystal.enabled': next !== null, 'crystal.lastRunAt': now.toISOString(), updatedAt: now };
			if (row.crystal.mode === 'message' || row.crystal.mode === 'assistant') {
				const { deliverScheduledLopuMessage } = await import('./scheduledMessages');
				const delivered = await deliverScheduledLopuMessage(row, source, lease);
				if (delivered) { await things.updateOne({ _id: row._id, lease, 'crystal.enabled': true }, { $set: advance }); sent++; }
				else failed++;
				continue;
			}
			const prefs = normalizeNotificationPrefs(await getUserNotificationPrefs(row.ownerId));
			if (!prefs.masters.push || prefs.push['lopu-reminder'] === false) {
				await things.updateOne({ _id: row._id, lease }, { $set: advance }); continue;
			}
			const notificationId = `lopu-recording-notification-${createHash('sha256').update(`${row.shareId}:${row.nextRunAt.toISOString()}`).digest('hex')}`;
			const emitted = await emitSystemNotificationOnce({ recipientId: row.ownerId, type: 'lopu-reminder', title: row.crystal.title,
				preview: row.crystal.description, href: `/thing/${encodeURIComponent(row.targetId)}`, targetId: row.targetId, delivery: row.crystal.delivery }, notificationId, async (session) => {
				const sourceWrite = await things.updateOne({ _id: source._id, ownerId: row.ownerId, acl: [ACL_OWNER], updatedAt: source.updatedAt, 'crystal.completed': { $ne: true } }, { $inc: { recordingWriteFence: 1 } }, { session });
				if (!sourceWrite.matchedCount) return false;
				const updated = await things.updateOne({ _id: row._id, lease, 'crystal.enabled': true, nextRunAt: row.nextRunAt }, { $set: advance }, { session });
				return updated.matchedCount > 0;
			});
			if (emitted) sent++;
		} catch { failed++; }
		finally { await things.updateOne({ _id: row._id, lease }, { $unset: { lease: '' }, $set: { leaseUntil: new Date(Date.now() + 60_000) } }); }
	}
	return { sent, failed };
};
