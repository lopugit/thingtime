import { isNotificationType, type NotificationType } from '~/schemas/registry';
import type { NotificationDelivery } from '../lopu/remindersCore';

export const NOTIFICATION_TESTS = [
	{ id: 'quiet', label: '🌙 Quiet', delivery: 'quiet', title: '🌙 Quiet notification test', preview: 'A gentle update without a sound.' },
	{ id: 'normal', label: '🔔 Normal', delivery: 'normal', title: '🔔 Normal notification test', preview: 'A simple message from Thingtime.' },
	{ id: 'urgent', label: '🚨 Urgent', delivery: 'urgent', title: '🚨 Time-sensitive notification test', preview: 'A test only. Time-sensitive delivery depends on your device settings.' },
	{ id: 'rich', label: '✨ Rich text', delivery: 'normal', title: '✨ Rich text notification test', preview: 'Your notes are ready: one important idea and two next steps.', richText: '**Your notes are ready**\n\n- One important idea\n- Two *next steps*' },
	{ id: 'image', label: '🖼️ Image', delivery: 'normal', title: '🖼️ Illustrated notification test', preview: 'A title, description and illustration in Thingtime.', image: '/notification-test.svg' }
] as const;
export function notificationTestInput(raw: any): { type: NotificationType; delivery: NotificationDelivery; title: string; preview: string; richText?: string; image?: string } {
	if (raw?.type !== undefined && !isNotificationType(raw.type)) throw new TypeError('Choose a known notification type.');
	const preset = NOTIFICATION_TESTS.find((item) => item.id === (raw?.preset || 'normal'));
	if (!preset) throw new TypeError('Choose a notification test.');
	return { ...preset, type: raw?.type || 'lopu-reminder' };
}
