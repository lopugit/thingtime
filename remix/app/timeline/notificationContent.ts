import { NOTIFICATION_TYPES } from '../schemas/registry';
import type { TimelineSnapshot } from './contract';

export const NOTIFICATION_CONTENT_ADAPTER = 'notification-content';
export type NotificationContent = { id: string; ownerId: string; crystal: Record<string, string | null>; targetId: string | null; createdAt: string; updatedAt: string | null; readAt: string | null; historyOnly: boolean | null };
const fields = ['type', 'actorId', 'actorName', 'actorUsername', 'postId', 'preview', 'title', 'detail', 'href', 'outcome', 'richText', 'image', 'delivery'] as const;
const iso = (value: unknown, optional = false) => {
	if (value == null && optional) return null;
	const date = value instanceof Date ? value.toISOString() : value;
	if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) throw Error('Invalid notification content timestamp');
	return date;
};
/** Approved stored history only. Actor names are the stored snapshot, never a
 * later live-profile lookup. Delivery attempt state, provider details, unique
 * keys, notification dedupe keys, grants and secret envelopes are excluded.
 * Strings retain their exact stored bytes; no preview/truncation policy runs. */
export function notificationContentSnapshot(input: unknown): TimelineSnapshot {
	const v = input as any;
	if (!v || Object.keys(v).sort().join(',') !== 'createdAt,crystal,historyOnly,id,ownerId,readAt,targetId,updatedAt' || typeof v.id !== 'string' || !v.id || typeof v.ownerId !== 'string' || !v.ownerId || !v.crystal || typeof v.crystal !== 'object' || Array.isArray(v.crystal) || (v.targetId !== null && typeof v.targetId !== 'string') || (v.historyOnly !== null && typeof v.historyOnly !== 'boolean')) throw Error('Invalid notification content');
	if (!NOTIFICATION_TYPES.includes(v.crystal.type) || typeof v.crystal.actorId !== 'string' || !v.crystal.actorId || Object.keys(v.crystal).some(key => !(fields as readonly string[]).includes(key))) throw Error('Invalid notification content fields');
	const crystal: NotificationContent['crystal'] = {};
	for (const key of fields) if (Object.prototype.hasOwnProperty.call(v.crystal, key)) {
		if (v.crystal[key] !== null && typeof v.crystal[key] !== 'string') throw Error('Invalid notification content scalar');
		crystal[key] = v.crystal[key];
	}
	return { adapter: NOTIFICATION_CONTENT_ADAPTER, version: 1, value: { id: v.id, ownerId: v.ownerId, crystal, targetId: v.targetId, createdAt: iso(v.createdAt), updatedAt: iso(v.updatedAt, true), readAt: iso(v.readAt, true), historyOnly: v.historyOnly } };
}
export function notificationContentValue(snapshot: TimelineSnapshot): NotificationContent {
	if (snapshot.adapter !== NOTIFICATION_CONTENT_ADAPTER || snapshot.version !== 1) throw Error('Invalid notification content adapter');
	return notificationContentSnapshot(snapshot.value).value as unknown as NotificationContent;
}
export const NOTIFICATION_CONTENT_FIELDS = fields;
