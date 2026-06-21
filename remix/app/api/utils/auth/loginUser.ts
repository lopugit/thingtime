import { signJwt } from './jwt';
import { verifyPassword } from './passwords';
import { createSession } from './sessions';
import { findUserByUsername, PublicUser, toPublicUser } from './users';

export type LoginResult =
  | { ok: false; status: number; error: string }
  | { ok: true; user: PublicUser; jwt: string };

// Login is allowed even when emailVerified is false (we just flag it). The
// generic error avoids leaking whether a username exists.
export const loginUser = async ({ username, password }: { username: string; password: string }): Promise<LoginResult> => {
  const user = await findUserByUsername((username || '').trim().toLowerCase());
  if (!user) return { ok: false, status: 401, error: 'Invalid username or password' };

  const match = await verifyPassword(password || '', user.passwordHash);
  if (!match) return { ok: false, status: 401, error: 'Invalid username or password' };

  const session = await createSession(String(user._id));
  const jwt = await signJwt({ sub: String(user._id), jti: session.jti });

  return { ok: true, user: toPublicUser(user), jwt };
};
