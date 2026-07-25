import { json, readJsonBody } from '~/api/http';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { sendEmailOtp } from '~/api/utils/auth/email';
import { generateOtpCode } from '~/api/utils/auth/authOtps';
import { getEmailTestConfig, isAllowedEmailTestRecipient } from '~/api/utils/email/testConfig';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/email/test-otp — dev/preview-only helper for the /tests page.
// It exercises the existing OTP email renderer + delivery service without
// adding a production 2FA flow yet.
export const action = async ({ request }: { request: Request }) => {
  if (!shouldShowDevVerificationLink()) {
    return json({ ok: false, error: 'Email OTP test sends are available only in local development and Vercel previews.' }, { status: 403 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const email = String(body?.email || '').trim().toLowerCase();

  if (!isAllowedEmailTestRecipient(email)) {
    return json(
      {
        ok: false,
        error: 'Email must be the configured test recipient or a plus alias of it.'
      },
      { status: 400 }
    );
  }

  const result = await sendEmailOtp({
    to: email,
    code: String(body?.code || generateOtpCode()),
    expiresMinutes: Number.isFinite(Number(body?.expiresMinutes)) ? Number(body.expiresMinutes) : 10
  });

  return json({
    ok: true,
    email: getEmailTestConfig(),
    result
  });
};
