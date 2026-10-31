import { json, readJsonBody } from '~/api/http';
import { markNotificationsRead, listNotifications } from '~/api/utils/notifications/notifications';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { recordWatchSync, resolveWatchDevice } from '~/api/utils/watch/watchPairing';

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: noStore });
	const context = await resolveWatchDevice(request, 'watch.notifications.read');
	if (!context) return json({ ok: false, error: 'Unauthorized Watch credential' }, { status: 401, headers: noStore });
	const limit = await enforceRateLimit(request, 'notifications.list', `device:${context.actor.sessionId}`);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		return json(
			{ ok: false, error: 'The Watch is refreshing too quickly' },
			{ ...init, headers: { ...(init.headers || {}), ...noStore } }
		);
	}
	const body = await readJsonBody(request, 64 * 1024);

	if (body?.op === 'mark-read') {
		if (!context.actor.capabilities.includes('watch.notifications.write')) {
			return json({ ok: false, error: 'This Watch cannot change notifications' }, { status: 403, headers: noStore });
		}
		const result = await markNotificationsRead(context.user.id, { ids: body?.ids, all: body?.all });
		if (result.ok === false) return json(result, { status: result.status, headers: noStore });
		await recordWatchSync(context.actor, { status: 'healthy', batteryLevel: body?.batteryLevel, lowPowerMode: body?.lowPowerMode });
		return json({ ok: true, updated: result.updated, serverTime: new Date().toISOString() }, { headers: noStore });
	}

	const result = await listNotifications(context.user.id, {
		limit: body?.limit,
		cursor: body?.cursor,
		from: body?.from,
		to: body?.to
	});
	if (result.ok === false) {
		await recordWatchSync(context.actor, { status: 'error', error: result.error, batteryLevel: body?.batteryLevel, lowPowerMode: body?.lowPowerMode });
		return json(result, { status: result.status, headers: noStore });
	}
	await recordWatchSync(context.actor, { status: 'healthy', batteryLevel: body?.batteryLevel, lowPowerMode: body?.lowPowerMode });
	return json(
		{
			ok: true,
			account: {
				id: context.user.id,
				username: context.user.username,
				displayName: context.user.displayName,
				avatarUrl: context.user.avatarUrl
			},
			device: { id: context.actor.deviceId },
			notifications: result.notifications,
			unreadCount: result.unreadCount,
			nextCursor: result.nextCursor,
			serverTime: new Date().toISOString()
		},
		{ headers: noStore }
	);
};

export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...noStore, Allow: 'POST' } });
