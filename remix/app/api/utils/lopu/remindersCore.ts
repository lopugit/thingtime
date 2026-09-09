export const LOPU_REMINDER_KIND = 'lopu-reminder';
export const REMINDER_MIN_INTERVAL_MINUTES = 5;
export const NOTIFICATION_DELIVERIES = ['quiet', 'normal', 'urgent'] as const;
export type NotificationDelivery = typeof NOTIFICATION_DELIVERIES[number];
export type ReminderInput = { title: string; description: string; at: string; everyMinutes: number | null; timeZone: string; delivery: NotificationDelivery };

export function parseReminderInput(raw: any, now = new Date()): ReminderInput {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Provide a reminder.');
	const title = typeof raw.title === 'string' ? raw.title.trim() : '';
	const description = typeof raw.description === 'string' ? raw.description.trim() : '';
	if (!title || title.length > 140 || description.length > 2000) throw new TypeError('Use a title up to 140 characters and a description up to 2000.');
	const timeZone = raw.timeZone ?? 'UTC';
	if (typeof timeZone !== 'string' || timeZone.length > 100) throw new TypeError('Choose a valid time zone.');
	try { new Intl.DateTimeFormat('en', { timeZone }).format(now); } catch { throw new TypeError('Choose a valid time zone.'); }
	// Absolute timestamps only: never interpret a user's local time in the server zone.
	if (typeof raw.at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(raw.at) || !Number.isFinite(Date.parse(raw.at))) throw new TypeError('Specify an ISO timestamp with a UTC offset.');
	const at = new Date(raw.at);
	if (at.getTime() < now.getTime() - 60_000 || at.getTime() > now.getTime() + 366 * 86_400_000) throw new TypeError('Choose a time from now to one year ahead.');
	const everyMinutes = raw.everyMinutes ?? null;
	if (everyMinutes !== null && (!Number.isSafeInteger(everyMinutes) || everyMinutes < REMINDER_MIN_INTERVAL_MINUTES || everyMinutes > 525_600)) throw new TypeError('Repeat intervals must be whole minutes, at least five minutes.');
	const delivery = raw.delivery ?? 'normal';
	if (!NOTIFICATION_DELIVERIES.includes(delivery)) throw new TypeError('Choose quiet, normal or urgent delivery.');
	return { title, description, at: at.toISOString(), everyMinutes, timeZone, delivery };
}

// Skip missed occurrences after downtime; do not flood someone with a backlog.
export function nextReminderTime(due: Date, everyMinutes: number | null, now: Date): Date | null {
	if (everyMinutes === null) return null;
	const interval = everyMinutes * 60_000;
	return new Date(due.getTime() + Math.max(1, Math.floor((now.getTime() - due.getTime()) / interval) + 1) * interval);
}
