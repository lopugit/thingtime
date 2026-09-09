import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection } from '../mongodb/collections';
import { updateThing } from '../things/things';
import { emitSystemNotificationOnce } from '../notifications/notifications';
import { RECORDING_REMINDER_KIND, RECORDING_LEASE_MS, recordingReminderWindow, recordingSettingsOf } from './recordingsCore';
import { getRecordingSettings, recordingId } from './recordingsStore';

export const updateRecordingTodo = async (ownerId: string, id: string, input: { completed?: unknown; reminders?: unknown }) => {
	if (input.completed !== undefined && typeof input.completed !== 'boolean')
		return { ok: false as const, status: 400, error: 'completed must be true or false.' };
	if (input.reminders !== undefined && typeof input.reminders !== 'boolean')
		return { ok: false as const, status: 400, error: 'reminders must be true or false.' };
	const things = await getHomeThingsCollection();
	const reminder = await things.findOne({ ownerId, thingtime: RECORDING_REMINDER_KIND, targetId: id });
	if (!reminder) return { ok: false as const, status: 404, error: 'Recording todo not found.' };
	if (input.completed !== undefined) {
		if (typeof input.completed !== 'boolean') return { ok: false as const, status: 400, error: 'completed must be true or false.' };
		const result = await updateThing({ id: ownerId }, id, { crystal: { completed: input.completed } });
		if (!result.ok) return result;
	}
	if (input.reminders !== undefined) {
		if (typeof input.reminders !== 'boolean') return { ok: false as const, status: 400, error: 'reminders must be true or false.' };
		await things.updateOne(
			{ _id: reminder._id, ownerId },
			{ $set: { 'crystal.enabled': input.reminders, nextRunAt: new Date(), updatedAt: new Date() } }
		);
	}
	return { ok: true as const };
};

// One durable bell entry per (todo, local date), even across cron overlap,
// retries, restarts and DST. Read the live todo, not a stale extracted copy.
// Completion/privatization and emission serialize through the notification
// transaction's callback; stopped/deleted/public todos never emit content.
export const sendRecordingReminders = async () => {
	const things = await getHomeThingsCollection();
	let sent = 0;
	let failed = 0;
	const deadline = Date.now() + 30_000;
	for (let index = 0; index < 100 && Date.now() < deadline; index++) {
		const now = new Date();
		const lease = randomUUID();
		const reminder = await things.findOneAndUpdate(
			{
				thingtime: RECORDING_REMINDER_KIND,
				'crystal.enabled': true,
				nextRunAt: { $lte: now },
				$or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }]
			},
			{ $set: { lease, leaseUntil: new Date(now.getTime() + RECORDING_LEASE_MS) } },
			{ sort: { nextRunAt: 1, shareId: 1 }, returnDocument: 'after' }
		);
		if (!reminder) break;
		try {
			const settings = await getRecordingSettings(reminder.ownerId);
			const window = recordingReminderWindow(now, settings);
			if (!settings.enabled || !settings.dailyReminders || !window.due || reminder.crystal.lastDay === window.day) continue;
			const todo = await things.findOne({ shareId: reminder.targetId, ownerId: reminder.ownerId, thingtime: 'data' });
			if (!todo) {
				await things.deleteOne({ _id: reminder._id, lease });
				continue;
			}
			if (todo.crystal?.completed === true || todo.appId || !Array.isArray(todo.acl) || todo.acl.length !== 1 || todo.acl[0] !== 'tt:user') continue;
			const emitted = await emitSystemNotificationOnce(
				{
					recipientId: reminder.ownerId,
					type: 'recording-reminder',
					title: 'A little reminder from Lopu 🦄',
					preview: String(todo.crystal?.title || 'Your recording todo').slice(0, 140),
					href: '/lopu/recordings',
					targetId: todo.shareId,
					outcome: 'ok'
				},
				recordingId('notification', reminder.ownerId, todo.shareId, window.day),
				async (session: any) => {
					const active = await things.findOne({ shareId: recordingId('settings', reminder.ownerId), ownerId: reminder.ownerId }, { session });
					if (!active?.crystal?.enabled || active.crystal.dailyReminders === false) return false;
					const liveWindow = recordingReminderWindow(now, recordingSettingsOf(active.crystal));
					if (!liveWindow.due || liveWindow.day !== window.day) return false;
					await things.updateOne({ _id: active._id }, { $inc: { recordingWriteFence: 1 } }, { session });
					const checked = await things.updateOne(
						{
							_id: todo._id,
							ownerId: reminder.ownerId,
							'crystal.completed': { $ne: true },
							acl: ['tt:user'],
							updatedAt: todo.updatedAt
						},
						{ $inc: { recordingWriteFence: 1 } },
						{ session }
					);
					if (!checked.matchedCount) return false;
					const current = await things.updateOne(
						{
							_id: reminder._id,
							lease,
							'crystal.enabled': true,
							'crystal.lastDay': { $ne: window.day }
						},
						{ $set: { 'crystal.lastDay': window.day, updatedAt: now } },
						{ session }
					);
					return current.matchedCount > 0;
				}
			);
			if (emitted) sent++;
		} catch {
			// One unavailable account must not starve the other due reminders.
			// No provider error or private content is logged by the scheduler.
			failed++;
		} finally {
			await things.updateOne(
				{ _id: reminder._id, lease },
				{ $set: { nextRunAt: new Date(Date.now() + 30 * 60_000) }, $unset: { lease: '', leaseUntil: '' } }
			);
		}
	}
	return { sent, failed };
};
