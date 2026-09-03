import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { streamLopuVoiceReply, type LopuVoiceEvent } from '~/api/utils/lopu/voice';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const STREAM_HEADERS = {
	'Content-Type': 'application/x-ndjson; charset=utf-8',
	'Cache-Control': 'no-store',
	'X-Accel-Buffering': 'no'
};
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'lopu.voiceReply', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Lopu voice replies are rate limited.' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 96 * 1024);
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: LopuVoiceEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			try {
				for await (const event of streamLopuVoiceReply(user.id, body)) send(event);
			} catch (error) {
				send({ type: 'error', error: error instanceof Error ? error.message : 'Lopu could not complete this turn.' });
				send({ type: 'done' });
			} finally {
				controller.close();
			}
		}
	});
	return new Response(stream, { headers: STREAM_HEADERS });
};
