import { randomUUID } from 'node:crypto';

import { signJwt } from '../auth/jwt';
import { createSession } from '../auth/sessions';
import type { PublicUser } from '../auth/users';

// The sandbox token layer: a REAL signed, revocable, short-lived credential
// that resolves through the normal app-token path (appTokens.resolveAppToken)
// to a synthetic user — so integrators (human or AI) can exercise every embed
// endpoint (/app-data*, /oauth/userinfo) end-to-end BEFORE registering an
// app, without a browser, and without a single byte of real account data.
//
// Containment, in layers:
//   • purpose 'app-sandbox' — rejected by resolveSessionUser, so it can never
//     act as an account credential;
//   • the synthetic userId ('sandbox:<uuid>') matches no real user;
//   • app-data written under it is namespaced per token and TTL-reaped
//     (sandboxExpiresAt on the docs);
//   • 1-hour expiry + per-IP mint rate limit bound accumulation;
//   • the shared pool for a sandbox token is its own namespace only — two
//     sandboxes can never see each other.

export const SANDBOX_TOKEN_TTL_MS = 1000 * 60 * 60;

export const SANDBOX_OWNER_PREFIX = 'sandbox:';

export const isSandboxOwnerId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith(SANDBOX_OWNER_PREFIX);

// The pretend account every sandbox token resolves to — mirrors the popup's
// client-side SANDBOX_USER, PublicUser-shaped so every route that reads
// ctx.user works unchanged. Nothing here is real.
export const sandboxPublicUser = (ownerId: string, mintedAt: Date): PublicUser => ({
  id: ownerId,
  ttid: 'sandbox-you',
  username: 'sandbox-you',
  email: 'sandbox@thingtime.invalid',
  displayName: 'Sandbox You',
  bio: 'A pretend account — nothing here is real.',
  avatarUrl: null,
  bannerUrl: null,
  emailVerified: false,
  createdAt: mintedAt.toISOString(),
  accountKind: 'user',
  emailVerificationRequiredBy: null,
  storageAllowanceBytes: null,
  storageUsedBytes: null,
  activeThemeId: null,
  activeFeedAlgorithmId: null,
  isAdmin: false
});

export type SandboxTokenGrant = {
  token: string;
  tokenType: 'Bearer';
  expiresAt: Date;
  scopes: string[];
};

// Mint a sandbox token for ANY clientId (registered or not) — the whole point
// is building before registering. Same revocable-JWT model as every other
// Thingtime credential: the session doc is the kill switch and the TTL reaper
// cleans it up.
export const mintSandboxToken = async (
  clientId: string,
  origin: string,
  scopes: string[]
): Promise<SandboxTokenGrant> => {
  const ownerId = `${SANDBOX_OWNER_PREFIX}${randomUUID()}`;
  const expiresAt = new Date(Date.now() + SANDBOX_TOKEN_TTL_MS);
  const session = await createSession(ownerId, {
    purpose: 'app-sandbox',
    expiresAt,
    meta: { clientId, origin, scopes, sandbox: true }
  });
  const token = await signJwt({ sub: ownerId, jti: session.jti, expiresIn: '1h' });
  return { token, tokenType: 'Bearer', expiresAt, scopes };
};
