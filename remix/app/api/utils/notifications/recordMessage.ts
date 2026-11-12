import { createHash } from 'node:crypto';
import { getHomeThingsCollection } from '../mongodb/collections';
import { redactNotificationText } from '../errors/adminDiagnostic';
import { notificationDoc, safeInternalHref, SYSTEM_NOTIFICATION_ACTOR } from './notifications';

// Client messages are explicitly NOT authoritative action/login audit events.
// Account + event UUID fences retries, including retries after an account switch.
export const parseNotificationMessage = (userId: string, body: any) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(key => !['userId', 'eventId', 'title', 'description', 'status', 'href'].includes(key))) return null;
  if (body.userId !== userId || typeof body.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId)) return null;
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 400) return null;
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 48000)) return null;
  if (!['success', 'error', 'info', 'warning'].includes(body.status)) return null;
  if (body.href !== undefined && typeof body.href !== 'string') return null;
  const title = redactNotificationText(body.title);
  const description = body.description ? redactNotificationText(body.description) : '';
  // Never retain a URL's bearer key, auth return code or fragment in history.
  const href = safeInternalHref(body.href?.split(/[?#]/, 1)[0]);
  return { title, description, href, status: body.status as 'success' | 'error' | 'info' | 'warning',
    id: `notification-message-${createHash('sha256').update(JSON.stringify([userId, body.eventId])).digest('hex')}` };
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
