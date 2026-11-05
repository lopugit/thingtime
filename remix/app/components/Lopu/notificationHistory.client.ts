import { workspaceStorageBinding } from '~/local-workspace/storageStatus.client';
import { LocalNotificationHistory } from '~/local-workspace/notifications';
import { workspaceDatabase } from '~/local-workspace/runtime.client';
import { notifyHistoryChanged, startNotificationHistorySync } from '~/local-workspace/notifications.client';
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
  if (typeof window === 'undefined') return;
  const binding = workspaceStorageBinding();
  if (!binding) return;
  const ownerId = binding.scope.kind === 'account' ? binding.scope.ownerId : 'local-workspace';
  if (userId !== ownerId && !(binding.scope.kind === 'anonymous' && !userId)) return;
  const payload = { userId: ownerId, eventId: uuid(),
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
  try {
    await new LocalNotificationHistory(workspaceDatabase(), binding.scope, binding.lease).save(payload);
    notifyHistoryChanged(binding.scope);
    if (binding.scope.kind === 'account') startNotificationHistorySync(binding.scope);
  } catch {
    // Keep toast/action completion independent, and do not recursively toast.
    console.warn('[notifications] Could not save a Lopu message on this device');
    try { binding.lease.assertCurrent(); } catch { return; }
    window.dispatchEvent(new CustomEvent('thingtime:notification-save-failed', { detail: { userId: ownerId } }));
  }
};
