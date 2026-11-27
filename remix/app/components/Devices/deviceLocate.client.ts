import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import type { DeviceLocationScope } from './deviceLocation.client';

export type LocateKind = 'notification.show' | 'media.play' | 'media.prepare';
export type LocateAttempt = { requestId: string; kind: LocateKind; input: Record<string, unknown> };
/** Only explicit pre-admission refusals may release the immutable attempt. */
export class LocateRequestRefused extends Error {}

export function locateResponseError(status: number, result: { ok?: unknown; error?: unknown }): Error {
	const message = typeof result.error === 'string' ? result.error : 'Could not confirm this device action.';
	return result.ok === false && [400, 401, 403, 404, 429].includes(status)
		? new LocateRequestRefused(message)
		: new Error(message);
}
export type LocateReceipt = {
	command: { id: string; requestId: string; status: string; error?: string | null } | null;
	preparedSound?: { id: string; attachmentId: string; versionId: string; filename: string; status: 'ready' | 'preparing' | 'failed' };
	delivery?: { channel: 'node' | 'apns'; status: string; played: 'not-observed' };
};

export async function requestDeviceLocate(scope: DeviceLocationScope, attempt: LocateAttempt, signal: AbortSignal, readOnly = false): Promise<LocateReceipt> {
	if (window.location.origin !== scope.origin) throw new Error('Device origin changed.');
	await requireThingtimeCapability('api.devices-alerts', '1.0.0', scope.origin);
	signal.throwIfAborted();
	const query = new URLSearchParams({ deviceId: scope.deviceId, requestId: attempt.requestId });
	const response = await fetch(`${scope.origin}/api/v1/devices/alerts${readOnly ? `?${query}` : ''}`, {
		method: readOnly ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
		headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': scope.ownerId },
		...(readOnly ? {} : { body: JSON.stringify({ deviceId: scope.deviceId, ...attempt }) }),
	});
	const result = await response.json();
	if (!response.ok || result.ok !== true) throw locateResponseError(response.status, result);
	if (!result.command || typeof result.command.id !== 'string' || result.command.requestId !== attempt.requestId) throw new Error('Invalid device action receipt. Check its delivery status before trying again.');
	return result;
}

export function locateReceiptLabel(receipt: LocateReceipt | null): string {
	if (!receipt) return '';
	if (receipt.delivery?.channel === 'apns') {
		if (receipt.delivery.status === 'provider-accepted') return 'Sent to Apple for delivery. Playback has not been confirmed.';
		if (receipt.delivery.status === 'unconfirmed') return 'Delivery is unconfirmed. Check status before sending another alert.';
		if (receipt.delivery.status === 'rejected') return 'The notification could not be delivered.';
		return 'Notification queued for delivery.';
	}
	if (receipt.preparedSound?.status === 'ready') return 'Custom notification tone is ready on this device.';
	if (receipt.preparedSound?.status === 'preparing') return 'Preparing the custom tone on the device.';
	if (receipt.command?.status === 'needs-review') return 'The device action needs review; it will not play again automatically.';
	if (receipt.command?.status === 'succeeded') return 'The device completed the action.';
	if (receipt.command?.status === 'failed') return 'The device could not complete the action.';
	if (receipt.command?.status === 'needs-approval') return 'Waiting for approval on the device.';
	return 'Queued for the device. Open Thingtime there if it is asleep.';
}
