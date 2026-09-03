import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createLopuVoiceRealtimeSession } from '~/api/utils/lopu/voice';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	const limit = await enforceRateLimit(request, 'lopu.voiceReply', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Lopu voice sessions are rate limited.' }, rateLimitedResponseInit(limit));
	try {
		const body = await readJsonBody(request, 16 * 1024);
		return json({ ok: true, session: await createLopuVoiceRealtimeSession(user.id, body) }, { headers: NO_STORE });
	} catch (error) {
		return json({ ok: false, error: error instanceof Error ? error.message : 'Lopu could not start a realtime audio session.' }, { status: 400, headers: NO_STORE });
	}
};
