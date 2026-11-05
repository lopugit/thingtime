import { createHash } from 'node:crypto';
import { getHomeThingsCollection } from '../mongodb/collections';
import { validateNotificationMessage } from './messageContract';
import { notificationDoc, SYSTEM_NOTIFICATION_ACTOR } from './notifications';

export const parseNotificationMessage = (userId: string, body: unknown) => {
  const parsed = validateNotificationMessage(userId, body);
  if (!parsed) return null;
  const { eventId, ...message } = parsed;
  return { ...message, id: `notification-message-${createHash('sha256').update(JSON.stringify([userId, eventId])).digest('hex')}` };
};

export const recordNotificationMessage = async (userId: string, body: unknown) => {
  const parsed = parseNotificationMessage(userId, body);
  if (!parsed) return { ok: false as const, status: 400, error: 'Invalid notification message or account changed' };
  const doc = { ...notificationDoc({ recipientId: userId, actor: SYSTEM_NOTIFICATION_ACTOR, type: 'system-message', historyOnly: true,
    title: parsed.title, preview: parsed.description, detail: parsed.description,
    href: parsed.href, outcome: parsed.status === 'success' ? 'ok' : parsed.status === 'error' ? 'error' : null }, new Date()), shareId: parsed.id, readAt: new Date() };
  doc.crystal.title = parsed.title;
  const things = await getHomeThingsCollection();
  try {
    await things.updateOne({ shareId: parsed.id, ownerId: userId, thingtime: 'notification' } as any, { $setOnInsert: doc }, { upsert: true });
  } catch (error: any) {
    // Concurrent delivery of the same event is already recorded, never reset readAt.
    if (error?.code !== 11000 || !await things.findOne({ shareId: parsed.id, ownerId: userId, thingtime: 'notification' } as any)) throw error;
  }
  return { ok: true as const, id: parsed.id };
};
