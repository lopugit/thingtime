import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createLopuVoiceRealtimeSession } from '~/api/utils/lopu/voice';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/lopu/voice/session — the direct-voice credential (design note
// §6.1): session → full account only (a guest session has no vault) → the
// JSON-only CSRF fence → the voice bucket, fail-closed → mint. The server
// decrypts the caller's own provider key for the exchange only and answers
// with the provider-minted five-minute secret; every refusal is a 400 error
// shape that names the rule, never the key or the provider's raw body.
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (user.temporary) return json({ ok: false, error: 'Create an account to talk to Lopu — direct voice uses your own Secure Vault provider' }, { status: 403, headers: NO_STORE });
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const limit = await enforceRateLimit(request, 'lopu.voiceReply', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'Lopu voice sessions are rate limited.' }, { ...init, headers: { ...init.headers, ...NO_STORE } });
	}
	const body = await readJsonBody(request, MAX_BODY_BYTES);
	try {
		const session = await createLopuVoiceRealtimeSession(user.id, body && typeof body === 'object' && !Array.isArray(body) ? body : {});
		return json({ ok: true, session }, { headers: NO_STORE });
	} catch (error) {
		return json({ ok: false, error: error instanceof Error && error.message ? error.message : 'Lopu could not start a direct voice session.' }, { status: 400, headers: NO_STORE });
	}
};
