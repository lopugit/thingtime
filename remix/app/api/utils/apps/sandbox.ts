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
//     sandboxes can never see each other — UNLESS both were minted into the
//     same SPACE (an opt-in caller-chosen secret): same-space tokens pool
//     their 'app'-visibility entries, each as its own pretend user, so the
//     cross-user feed is rehearsable pre-registration. Knowing the space
//     string ≈ holding a token for that pool, so pooling adds no authority a
//     shared token wouldn't; private entries stay per-token even in a space.

export const SANDBOX_TOKEN_TTL_MS = 1000 * 60 * 60;

// Sandbox namespaces get a deliberately smaller storage byte budget than real
// grants (SANDBOX_STORAGE_BYTES vs the real app-user allowance, enforced by
// the namespace ledger in apps/namespace.ts): the mint is anonymous, so the
// worst-case standing junk per IP is (mint rate × per-namespace budget) and
// every factor should be tight.

export const SANDBOX_OWNER_PREFIX = 'sandbox:';

export const isSandboxOwnerId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(SANDBOX_OWNER_PREFIX);

// A space is a caller-chosen pool secret: 8–64 chars keeps casual collisions
// ("test") from junking a stranger's demo feed while staying easy to mint
// (a uuid is the recommended value). Scoped per clientId on read, so a
// collision additionally needs the same clientId.
const SANDBOX_SPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;

export const sanitizeSandboxSpace = (value: unknown): string | null | { error: string } => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && SANDBOX_SPACE_RE.test(value.trim())) return value.trim();
  return { error: 'space must be 8-64 chars of letters, digits, . _ : - (use a uuid)' };
};

// Pretend-author names: always 'sandbox-' prefixed so a pooled feed can never
// impersonate a real account, lowercase slug, bounded.
export const sanitizeSandboxUsername = (value: unknown): string => {
  const slug =
    typeof value === 'string'
      ? value
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 24)
      : '';
  return slug ? `sandbox-${slug}` : 'sandbox-you';
};

export const sandboxDisplayName = (username: string) => {
  const name = username.replace(/^sandbox-/, '').replace(/-/g, ' ');
  return `Sandbox ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
};

// The pretend account every sandbox token resolves to — mirrors the popup's
// client-side SANDBOX_USER, PublicUser-shaped so every route that reads
// ctx.user works unchanged. Nothing here is real.
export const sandboxPublicUser = (ownerId: string, mintedAt: Date, username = 'sandbox-you'): PublicUser => ({
  id: ownerId,
  ttid: username,
  username,
  email: 'sandbox@thingtime.invalid',
  displayName: sandboxDisplayName(username),
  bio: 'A pretend account — nothing here is real.',
  avatarUrl: null,
  bannerUrl: null,
	avatarAttachmentId: null,
	bannerAttachmentId: null,
	avatarLinkedUrl: null,
	bannerLinkedUrl: null,
  birthday: null,
  emailVerified: false,
  createdAt: mintedAt.toISOString(),
  accountKind: 'user',
  emailVerificationRequiredBy: null,
  storageAllowanceBytes: null,
  storageUsedBytes: null,
	storageRemainingBytes: null,
	storageAccountingReady: false,
	publicUploadsEnabled: false,
	privateUploadsEnabled: false,
	storage: {
		usedBytes: 0,
		allowanceBytes: null,
		remainingBytes: null,
		overageBytes: 0,
		status: 'unavailable',
		accountingVersion: null,
		reconciledAt: null
	},
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
// cleans it up. Pass the same `space` to several mints (with distinct
// usernames) to simulate multiple users of one app sharing a feed.
export const mintSandboxToken = async (
  clientId: string,
  origin: string,
  scopes: string[],
  opts: { space?: string | null; username?: string } = {}
): Promise<SandboxTokenGrant> => {
  const ownerId = `${SANDBOX_OWNER_PREFIX}${randomUUID()}`;
  const expiresAt = new Date(Date.now() + SANDBOX_TOKEN_TTL_MS);
  const session = await createSession(ownerId, {
    purpose: 'app-sandbox',
    expiresAt,
    meta: {
      clientId,
      origin,
      scopes,
      sandbox: true,
      ...(opts.space ? { space: opts.space } : {}),
      ...(opts.username ? { username: opts.username } : {})
    }
  });
  const token = await signJwt({ sub: ownerId, jti: session.jti, expiresIn: '1h' });
  return { token, tokenType: 'Bearer', expiresAt, scopes };
};
