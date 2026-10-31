import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getTwoFactorEmailEnabled, setTwoFactorEmailEnabled } from '~/api/utils/auth/twoFactor';

// GET /api/v1/auth/two-factor — current email-2FA state for the session user.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return json({ ok: true, enabled: await getTwoFactorEmailEnabled(user.id) });
};

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/two-factor — { enabled: boolean } — toggle email 2FA.
// Enabling requires a verified email (codes are delivered there); once on,
// logins return { requiresOtp, challenge } until the emailed code is provided.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (typeof body?.enabled !== 'boolean') {
    return json({ ok: false, error: 'enabled must be true or false' }, { status: 400 });
  }

  const result = await setTwoFactorEmailEnabled(user.id, body.enabled, user.emailVerified);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, enabled: result.enabled });
};
