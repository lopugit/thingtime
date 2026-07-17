import { json } from '~/api/http';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { getEmailTestConfig } from '~/api/utils/email/testConfig';

// GET/POST /api/v1/email/config — dev/preview-only helper for the /tests page.
// getEmailTestConfig() returns email infrastructure details (SES region,
// configuration set, sender identities, sandbox flag, test recipient), so gate
// it exactly like the sibling test-otp route: never reachable in real
// production or unknown production-like hosts.
export const loader = async () => {
  if (!shouldShowDevVerificationLink()) {
    return json(
      { ok: false, error: 'Email config is available only in local development and Vercel previews.' },
      { status: 403 }
    );
  }
  return json({
    ok: true,
    email: getEmailTestConfig()
  });
};

export const action = loader;
