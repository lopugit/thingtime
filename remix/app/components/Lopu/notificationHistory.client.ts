import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { v4 as uuid } from 'uuid';

export const NOTIFICATION_HISTORY_REQUIREMENTS = { 'api.notifications-record': '1.0.0' } as const;

export type HistoryMessage = {
  title?: string;
  description?: string;
  status?: 'success' | 'error' | 'info' | 'warning';
  link?: { href: string };
};

const bound = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 14)}… [truncated]` : text;

// Each invocation is a real event. Only transport retries reuse its id; never
// coalesce equal text (two successful actions must remain two history records).
export const saveLopuHistory = async (userId: string | undefined, message: HistoryMessage) => {
  if (!userId || typeof window === 'undefined') return;
  const payload = { userId, eventId: uuid(),
    title: bound(message.title || 'Lopu message', 400),
    description: bound((message.title?.length || 0) > 400 ? [message.title, message.description].filter(Boolean).join('\n\n') : message.description || '', 48000), status: message.status || 'info',
    ...(message.link && message.link.href.length <= 300 ? { href: message.link.href } : {}) };
  let body = JSON.stringify(payload);
  // The endpoint and keepalive transport are byte-bounded, not character-bounded.
  // Emoji and JSON-escaped control characters must not turn a valid message into
  // an unsavable request. Retain an explicit truncation marker when necessary.
  while (new TextEncoder().encode(body).byteLength > 60000 && payload.description.length > 100) {
    payload.description = bound(payload.description, Math.floor(payload.description.length * 0.75));
    body = JSON.stringify(payload);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await requireThingtimeCapability('api.notifications-record', NOTIFICATION_HISTORY_REQUIREMENTS['api.notifications-record']);
      const response = await fetch('/api/v1/notifications/record', {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body
      });
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('thingtime:notification-recorded', { detail: { userId } }));
        return;
      }
      // Never deliver this account's message into a newly active account.
      if ([400, 401, 403].includes(response.status)) return;
    } catch { /* transient network failures retry with the exact same event id */ }
    if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 1000 * (attempt + 1)));
  }
  // No Lopu error toast here: that would recursively try to record itself.
  console.warn('[notifications] Could not save a Lopu message to history');
  window.dispatchEvent(new CustomEvent('thingtime:notification-save-failed', { detail: { userId } }));
};
