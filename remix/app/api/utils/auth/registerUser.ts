import { ensureIndexes } from '../mongodb/collections';

import { createEmailVerification } from './emailVerifications';
import { sendVerificationEmail } from './email';
import { signJwt } from './jwt';
import { hashPassword } from './passwords';
import { createSession } from './sessions';
import { findUserByEmail, findUserByUsername, insertUser, PublicUser, toPublicUser } from './users';

export type RegisterInput = {
  username: string;
  password: string;
  email: string;
  displayName?: string | null;
  meta?: Record<string, any>;
  // Base URL used to build the verification link (request origin in routes).
  origin?: string;
};

export type RegisterResult =
  | { ok: false; status: number; error: string }
  | { ok: true; user: PublicUser; jwt: string; verificationLink: string };

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// Single creation path for users — used by the register route AND by seeding,
// so a seeded user is identical to a real signup (FUNDAMENTALS.md §2).
export const registerUser = async (input: RegisterInput): Promise<RegisterResult> => {
  const username = (input.username || '').trim().toLowerCase();
  const email = (input.email || '').trim().toLowerCase();
  const password = input.password || '';

  if (!username) return { ok: false, status: 400, error: 'Username is required' };
  if (password.length < 6) return { ok: false, status: 400, error: 'Password must be at least 6 characters' };
  if (!isEmail(email)) return { ok: false, status: 400, error: 'A valid email is required' };

  // ensure the collections + unique indexes exist (idempotent, API-side)
  await ensureIndexes();

  if (await findUserByUsername(username)) return { ok: false, status: 409, error: 'Username already taken' };
  if (await findUserByEmail(email)) return { ok: false, status: 409, error: 'Email already registered' };

  const now = new Date();
  let user;
  try {
    user = await insertUser({
      ttid: username,
      username,
      email,
      passwordHash: await hashPassword(password),
      displayName: input.displayName ?? null,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
      meta: input.meta ?? {}
    });
  } catch (err: any) {
    // a unique index caught a duplicate that raced past the checks above
    if (err?.code === 11000) {
      const field = err?.keyPattern?.email ? 'Email' : 'Username';
      return { ok: false, status: 409, error: `${field} already registered` };
    }
    throw err;
  }

  const userId = String(user._id);

  // session + JWT (logs the user in immediately; emailVerified stays false)
  const session = await createSession(userId);
  const jwt = await signJwt({ sub: userId, jti: session.jti });

  // email verification token + (stubbed) send
  const verification = await createEmailVerification({ userId, email });
  const origin = input.origin || process.env.APP_URL || 'http://localhost:9999';
  const verificationLink = `${origin}/api/v1/auth/verify-email?token=${verification.token}`;
  await sendVerificationEmail({ to: email, link: verificationLink });

  return { ok: true, user: toPublicUser(user), jwt, verificationLink };
};
