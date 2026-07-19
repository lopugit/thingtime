import { json } from '~/api/http';
import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { provisionServiceAccount } from '~/api/utils/auth/serviceAccounts';

// POST /api/v1/auth/service-account
// Provisions a service-owned Thingtime account and returns a non-expiring
// bearer token. The account must verify its email within seven days.
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  const body = await request.json().catch(() => ({}));
  const result = await provisionServiceAccount({ ...body, origin: resolveTrustedOrigin(request) });

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
