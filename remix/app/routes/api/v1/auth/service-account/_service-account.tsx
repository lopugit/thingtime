import { json, readJsonBody } from '~/api/http';
import { withAdmin } from '~/api/utils/auth/admin';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { provisionServiceAccount } from '~/api/utils/auth/serviceAccounts';

// POST /api/v1/auth/service-account
// Admin-only provisioning for a service-owned Thingtime account. The account
// must verify its email within seven days and the bearer token expires.
const provision = withAdmin(async ({ request, admin }) => {
  const body = await readJsonBody(request, 64 * 1024);
  const result = await provisionServiceAccount({
    ...body,
    origin: new URL(request.url).origin,
    provisionedByUserId: admin.id
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
});

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  return provision({ request });
};
