import { json } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { registerUser } from '~/api/utils/auth/registerUser';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { prepareUnboundAttachmentCleanupForSessionReplacement } from '~/api/utils/attachments/attachments';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/auth/register — { username, password, email, displayName? }
// On success: creates the user, logs them in (sets the httpOnly auth cookie),
// and kicks off email verification. emailVerified starts false. Registering
// while other accounts are signed in ADDS the new account to the switcher
// roster (Mongo-backed, unlimited) and makes it active — it never signs the
// others out.
//
// SECURITY: whitelist fields — never spread the raw body. `meta` (which holds
// meta.admin, storage flags, etc.) must NOT be settable by a public signup, or
// a caller could mass-assign themselves admin. Legit meta is set later via its
// own authenticated endpoints.
export const action = async ({ request }: { request: Request }) => {
  // anonymous by definition — throttle by IP before the bcrypt + insert +
  // verification-email work (and before the awaited ensureIndexes bootstrap)
  const limit = await enforceRateLimit(request, 'auth.register', null);
  if (!limit.allowed) {
		return json({ ok: false, error: 'Too many sign-up attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await request.json().catch(() => ({}));
  const origin = resolveTrustedOrigin(request);

  // (Env-allowlist admin usernames are reserved in createUserAccount — the
  // single chokepoint covering this route, service-account, and seeding.)
  const result = await registerUser({
    username: body?.username,
    password: body?.password,
    email: body?.email,
    displayName: body?.displayName,
    origin
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  // Surface the link only in local + Vercel preview so production never returns
  // raw verification tokens to the browser.
  const showLink = shouldShowDevVerificationLink();

	const outgoingUser = await getCurrentUser(request).catch(() => null);
	if (outgoingUser && outgoingUser.id !== result.user.id) {
		await prepareUnboundAttachmentCleanupForSessionReplacement(outgoingUser.id).catch(() => null);
	}

  const rosterCookies = await mergeAccountSession(request, { userId: result.user.id, jti: result.jti });

  const headers = new Headers();
  headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
  for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

  return json(
    {
      ok: true,
      user: result.user,
      verificationLink: showLink ? result.verificationLink : undefined
    },
    { headers }
  );
};
