import { consumeOtpChallenge, createOtpChallenge, deleteOtpChallenge, generateOtpCode } from './authOtps';
import { sendEmailOtp } from './email';
import { signJwt } from './jwt';
import { verifyPassword } from './passwords';
import { createSession } from './sessions';
import { findUserById, findUserByUsername, PublicUser, toPublicUser } from './users';

// Machine-readable failure reason for the 2FA (OTP) step, so the client decides
// whether to abandon the challenge from a STABLE code instead of matching server
// copy. 'challenge_invalid' / 'too_many_attempts' mean the challenge is dead
// (go back to the password step); 'wrong_code' means let the user retry.
export type LoginFailReason = 'too_many_attempts' | 'wrong_code' | 'challenge_invalid';

export type LoginResult =
  | { ok: false; status: number; error: string; reason?: LoginFailReason }
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
    // If the code can't be delivered, don't strand a challenge the user can
    // never complete — drop it and surface a real error instead of prompting
    // for a code that never arrives (or, under fail-closed email, 500ing).
    let sent: Awaited<ReturnType<typeof sendEmailOtp>> | null = null;
    try {
      sent = await sendEmailOtp({ to: user.email, code });
    } catch {
      sent = null;
    }
    if (!sent || sent.status === 'failed' || sent.status === 'skipped') {
      await deleteOtpChallenge(challenge.challenge);
      return { ok: false, status: 502, error: 'Could not send your security code — try again in a moment' };
    }
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
      return { ok: false, status: 429, reason: 'too_many_attempts', error: 'Too many attempts — request a new code by logging in again' };
    }
    if (result.reason === 'wrong_code') {
      return { ok: false, status: 401, reason: 'wrong_code', error: 'Invalid security code' };
    }
    return { ok: false, status: 401, reason: 'challenge_invalid', error: 'This login challenge is no longer valid — log in again' };
  }

  const user = await findUserById(result.userId);
  if (!user) return { ok: false, status: 401, reason: 'challenge_invalid', error: 'This login challenge is no longer valid — log in again' };
  return issueSession(user);
};
