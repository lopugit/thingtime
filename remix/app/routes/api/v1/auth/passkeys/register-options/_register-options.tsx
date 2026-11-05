import { passwordVerification } from '~/api/utils/passwords/verification';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { validPasswordId } from '~/passwords/model';
import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { confirmCurrentPassword } from '~/api/utils/auth/passwordConfirmation';
import { startPasskeyRegistration } from '~/api/utils/auth/passkeys';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/passkeys/register-options — { password } → WebAuthn
// creation options + a signed challenge cookie. Adding a passkey mints a
// durable credential, so it re-confirms the current password first (same
// "re-authenticate for sensitive changes" bar as the token minter); the
// browser then runs navigator.credentials.create and POSTs the attestation to
// /api/v1/auth/passkeys/register.
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}

	const limit = await enforceRateLimit(request, 'auth.passkeyManage', user.id);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many passkey attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	const origin = resolvePublicOrigin(request).origin;
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.get('Origin') && request.headers.get('Origin') !== origin)) return json({ok:false,error:'Use the same Thingtime origin.'},{status:403});
  const token = await getAuthToken(request);
  const remembered = body?.verificationRequestId !== undefined;
  if (remembered && (!validPasswordId(body.verificationRequestId) || !token || request.headers.has('Authorization'))) return json({ok:false,error:'Use your current browser session.'},{status:400});
  const context = {purpose:'account-create' as const,rp:new URL(origin).hostname};
  let cookie:string|null=null;
  const confirmation = remembered && !body?.password ? null : await confirmCurrentPassword(user.id, body?.password);
	if (confirmation === 'unavailable') {
		return json({ ok: false, error: 'This account has no password to confirm — contact support' }, { status: 400 });
	}
	if ((!remembered || body?.password) && confirmation !== 'confirmed') {
		return json({ ok: false, error: 'Wrong password' }, { status: 403 });
	}

	try {
    if (remembered) { const who=await passwordVerification.identity(user.id,origin,token!); cookie=await passwordVerification.verify(request,who,context,body.verificationRequestId,confirmation==='confirmed'); }
  } catch { return json({ok:false,error:'Verify your Thingtime password for this device.'},{status:403}); }
  if ((await getCurrentUser(request))?.id !== user.id || await getAuthToken(request) !== token) return json({ok:false,error:'Your account session changed.'},{status:401});
  const result = await startPasskeyRegistration(user, request, remembered ? {requestId:body.verificationRequestId,context} : undefined);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}

	const headers = new Headers();
	headers.set('Cache-Control','private, no-store');
  if(cookie) headers.append('Set-Cookie',cookie);
	for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);
	return json({ ok: true, options: result.options }, { headers });
};
