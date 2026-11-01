import { json, readJsonBody } from '~/api/http';
import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { provisionServiceAccount } from '~/api/utils/auth/serviceAccounts';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/service-account
// Provisions a service-owned Thingtime account and returns a non-expiring
// bearer token. The account must verify its email within seven days.
//
// The endpoint stays public self-service (documented contract in apiDocs.ts),
// but every request mints a permanent bearer token + a 5 GiB-allowance account,
// so it is rate limited fail-closed per IP and the body is size-capped — the
// same posture as the other anonymous minting endpoints (password reset,
// resend-verification). Provisioning is a rare developer action; a burst past
// the window is abuse, not traffic.
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  const limit = await enforceRateLimit(request, 'auth.serviceAccount', null, { failClosed: true });
  if (!limit.allowed) {
    if (limit.unavailable) {
      return json(
        { ok: false, error: 'Service-account provisioning is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }
    return json(
      { ok: false, error: 'Too many service accounts from this address — please wait before provisioning more 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);

  // SECURITY: whitelist fields — never spread the raw body. Privileged meta
  // keys are also stripped at the createUserAccount chokepoint, but the input
  // type may grow fields (e.g. storage overrides) that must never be
  // caller-settable from this public route.
  const result = await provisionServiceAccount({
    username: body?.username,
    serviceName: body?.serviceName,
    email: body?.email,
    displayName: body?.displayName,
    password: body?.password,
    meta: body?.meta,
    origin: resolveTrustedOrigin(request)
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  return json({
    ok: true,
    user: result.user,
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresAt: result.expiresAt,
    verificationRequiredBy: result.verificationRequiredBy,
    verificationLink: shouldShowDevVerificationLink() ? result.verificationLink : undefined,
    storageAllowanceBytes: result.storageAllowanceBytes
  });
};
