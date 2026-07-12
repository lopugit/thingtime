import { consumeOtpChallenge, createOtpChallenge, generateOtpCode } from './authOtps';
import { sendEmailOtp } from './email';
import { signJwt } from './jwt';
import { verifyPassword } from './passwords';
import { createSession } from './sessions';
import { findUserById, findUserByUsername, PublicUser, toPublicUser } from './users';

export type LoginResult =
  | { ok: false; status: number; error: string }
  | { ok: true; requiresOtp: true; challenge: string; expiresAt: string }
  | { ok: true; user: PublicUser; jwt: string; jti: string };

const issueSession = async (user: any): Promise<LoginResult> => {
  const session = await createSession(String(user._id));
  const jwt = await signJwt({ sub: String(user._id), jti: session.jti });
  return { ok: true, user: toPublicUser(user), jwt, jti: session.jti };
};

// Login is allowed even when emailVerified is false (we just flag it). The
// generic error avoids leaking whether a username exists.
export const loginUser = async ({ username, password }: { username: string; password: string }): Promise<LoginResult> => {
  const user = await findUserByUsername((username || '').trim().toLowerCase());
  if (!user) return { ok: false, status: 401, error: 'Invalid username or password' };

  const match = await verifyPassword(password || '', user.passwordHash);
  if (!match) return { ok: false, status: 401, error: 'Invalid username or password' };

  // Opt-in email 2FA: a valid password alone doesn't mint a session — the
  // caller gets a challenge id and finishes login via completeOtpLogin.
  if (user.meta?.twoFactorEmailEnabled) {
    const code = generateOtpCode();
    const challenge = await createOtpChallenge({ userId: String(user._id), purpose: 'login', code });
    await sendEmailOtp({ to: user.email, code });
    return {
      ok: true,
      requiresOtp: true,
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt.toISOString()
    };
  }

  return issueSession(user);
};

// Second step of an email-2FA login: exchange challenge + emailed code for a
// real session. Errors stay generic so challenge ids can't be probed.
export const completeOtpLogin = async ({
  challenge,
  code
}: {
  challenge: string;
  code: string;
}): Promise<LoginResult> => {
  const result = await consumeOtpChallenge({
    challenge: String(challenge || ''),
    code: String(code || ''),
    purpose: 'login'
  });
  if (result.ok === false) {
    if (result.reason === 'too_many_attempts') {
      return { ok: false, status: 429, error: 'Too many attempts — request a new code by logging in again' };
    }
    if (result.reason === 'wrong_code') {
      return { ok: false, status: 401, error: 'Invalid security code' };
    }
    return { ok: false, status: 401, error: 'This login challenge is no longer valid — log in again' };
  }

  const user = await findUserById(result.userId);
  if (!user) return { ok: false, status: 401, error: 'This login challenge is no longer valid — log in again' };
  return issueSession(user);
};
