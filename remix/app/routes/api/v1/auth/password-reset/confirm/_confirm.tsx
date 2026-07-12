import { json, readJsonBody } from '~/api/http';

import { applyPasswordReset, consumePasswordReset } from '~/api/utils/auth/passwordResets';

const MAX_BODY_BYTES = 16 * 1024;

const RESET_ERRORS: Record<string, string> = {
  invalid: 'This reset link is not valid — request a new one',
  used: 'This reset link was already used — request a new one',
  expired: 'This reset link has expired — request a new one'
};

// POST /api/v1/auth/password-reset/confirm — { token, password } — burn the
// reset token, set the new password, and revoke every live session.
export const action = async ({ request }: { request: Request }) => {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!token) {
    return json({ ok: false, error: 'Reset token is required' }, { status: 400 });
  }
  // same rule as registration (createUserAccount)
  if (password.length < 6) {
    return json({ ok: false, error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const consumed = await consumePasswordReset(token);
  if (consumed.ok === false) {
    return json({ ok: false, error: RESET_ERRORS[consumed.reason] }, { status: 400 });
  }

  await applyPasswordReset(consumed.userId, password);
  return json({ ok: true });
};
