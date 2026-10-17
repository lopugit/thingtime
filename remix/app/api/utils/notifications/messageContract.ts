import { redactNotificationText } from '../errors/adminDiagnostic';
import { safeInternalHref } from './safeInternalHref';

// Client messages are explicitly NOT authoritative action/login audit events.
// Account + event UUID fences retries, including retries after an account switch.
export const validateNotificationMessage = (userId: string, body: any) => {
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
    eventId: body.eventId as string };
};
