import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listDeviceEvents } from '~/api/utils/devices/devices';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'devices.events', `user:${user.id}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device event streams are reconnecting too quickly' }, rateLimitedResponseInit(limit));
	const params = new URL(request.url).searchParams;
	const deviceId = params.get('deviceId');
	const cursor = params.get('cursor');
	const waitMs = Math.max(0, Math.min(20_000, Math.floor(Number(params.get('waitMs')) || 0)));
	const deadline = Date.now() + waitMs;
	let result = await listDeviceEvents(user.id, deviceId, cursor, params.get('limit'));
	while (result.ok && result.events.length === 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
		result = await listDeviceEvents(user.id, deviceId, cursor, params.get('limit'));
	}
	if (result.ok === false) return json(result, { status: result.status });
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'hello', deviceId, serverTime: new Date().toISOString() })}\n`));
			for (const event of result.events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'cursor', cursor: result.nextCursor })}\n`));
			controller.close();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Accel-Buffering': 'no'
		}
	});
};
