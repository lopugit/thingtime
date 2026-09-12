import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getScopedUser } from '~/api/utils/auth/scopedUser';
import { assertLopuAccess, lopuAccessResponse } from '~/api/utils/lopu/access';
import { streamLopuVoiceReply, type LopuVoiceEvent } from '~/api/utils/lopu/voice';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const STREAM_HEADERS = {
	'Content-Type': 'application/x-ndjson; charset=utf-8',
	'Cache-Control': 'no-store',
	'X-Accel-Buffering': 'no'
};
// POST /api/v1/lopu/voice/reply — session → full account only (a guest
// session has no vault and must not mint transcript pages) → the JSON-only
// CSRF fence → fail-closed rate limit → the access gate (a conversation turn
// runs on the viewer's own provider: billing byo, so an unverified account
// passes only when Thingtime.LopuAccess allows BYO; transcribe mode makes no
// provider call and is not gated) → the stream.
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
	const user = await getScopedUser(request, 'lopu.voice');
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	if (user.temporary) return json({ ok: false, error: 'Create an account to talk to Lopu — voice turns are saved to your account' }, { status: 403 });
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const limit = await enforceRateLimit(request, 'lopu.voiceReply', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Lopu voice replies are rate limited.' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 96 * 1024);
	const transcribeOnly = !!body && typeof body === 'object' && !Array.isArray(body) && body.transcribeMode === true;
	if (!transcribeOnly) {
		const access = await assertLopuAccess(user, { billing: 'byo' });
		if (access.ok === false) return lopuAccessResponse(access);
	}
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
