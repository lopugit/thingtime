// The pure half of the Lopu access gate (design note "Lopu verified access,
// usage accounting and credits" §1): the refusal codes and their Lopu-voiced
// copy, the verified/billing/balance matrix, and how a turn's billing is
// resolved. No Mongo, no env — chat.ts stamps `billing` on its meta event
// from here, the route tests drive the matrix directly, and the client may
// import the codes and copy. The async gate that reads the settings singleton
// and the account lives in ./access.ts.

import type { LopuBilling, LopuChatProvider } from './chatEvents';

// Who pays for a turn: Thingtime's server keys (credits), the viewer's own
// Secure Vault provider ("bring your own"), or nobody (the canned fallback).
// The type lives with the wire protocol (chatEvents.ts) so the client shares it.
export type { LopuBilling };
export const LOPU_BILLINGS: readonly LopuBilling[] = ['thingtime', 'byo', 'free'];
export const isLopuBilling = (value: unknown): value is LopuBilling => (LOPU_BILLINGS as readonly unknown[]).includes(value);

export const LOPU_UNVERIFIED_CODE = 'LOPU_UNVERIFIED' as const;
export const LOPU_NO_CREDITS_CODE = 'LOPU_NO_CREDITS' as const;
// a temporary (guest) session — refused like before, now with a code so the
// client can tell "sign up" from "locked"
export const LOPU_GUEST_CODE = 'LOPU_GUEST' as const;

export const LOPU_UNVERIFIED_ERROR = 'Lopu is invite-only for now — an admin needs to verify your account before it can build with you';
export const LOPU_NO_CREDITS_ERROR = 'Lopu’s credits for your account are used up — add credits to keep going';
export const LOPU_GUEST_ERROR = 'Create an account to chat with Lopu — conversations are saved to your account';

// What the gate needs to know about the caller (the PublicUser projection
// carries all four fields).
export type LopuAccessUser = { id: string; isAdmin?: boolean; lopuVerified?: boolean; temporary?: boolean };

export type LopuAccessRules = { requireVerification: boolean; allowByoUnverified: boolean };

export type LopuAccessRefusal =
  | { ok: false; status: 403; code: typeof LOPU_UNVERIFIED_CODE | typeof LOPU_GUEST_CODE; error: string }
  | { ok: false; status: 402; code: typeof LOPU_NO_CREDITS_CODE; error: string; balanceMicros: number };

export type LopuAccessVerdict = { ok: true } | LopuAccessRefusal;

// Admins are always verified (the same posture as upload permissions: an
// admin locked out could not fix the account that grants them).
export const lopuUserVerified = (user: Partial<LopuAccessUser> | null | undefined): boolean =>
  !!user && (user.isAdmin === true || user.lopuVerified === true);

// The matrix. `balanceMicros` is only consulted for thingtime billing; a
// caller that has no account yet passes 0 (the account is created lazily by
// the async gate, starter credits included, before this runs).
export const evaluateLopuAccess = (
  user: LopuAccessUser | null | undefined,
  input: { billing: LopuBilling; settings: LopuAccessRules; balanceMicros?: number | null }
): LopuAccessVerdict => {
  if (!user) return { ok: false, status: 403, code: LOPU_GUEST_CODE, error: LOPU_GUEST_ERROR };
  if (user.temporary === true) return { ok: false, status: 403, code: LOPU_GUEST_CODE, error: LOPU_GUEST_ERROR };
  if (input.settings.requireVerification && !lopuUserVerified(user)) {
    const byoAllowed = input.billing === 'byo' && input.settings.allowByoUnverified;
    if (!byoAllowed) return { ok: false, status: 403, code: LOPU_UNVERIFIED_CODE, error: LOPU_UNVERIFIED_ERROR };
  }
  if (input.billing === 'thingtime') {
    const balance = typeof input.balanceMicros === 'number' && Number.isFinite(input.balanceMicros) ? input.balanceMicros : 0;
    if (balance <= 0) return { ok: false, status: 402, code: LOPU_NO_CREDITS_CODE, error: LOPU_NO_CREDITS_ERROR, balanceMicros: balance };
  }
  return { ok: true };
};

// Billing per turn provider: the viewer's vault connection is theirs to pay
// for; the canned fallback costs nobody anything; the server keys — and the
// scripted test provider, which stands in for them so accounting is
// observable in tests (it prices against `test-model`) — bill credits.
export const billingForProvider = (provider: LopuChatProvider | null | undefined): LopuBilling => {
  if (provider === 'vault') return 'byo';
  if (provider === 'fallback') return 'free';
  return 'thingtime';
};

// Billing BEFORE the turn runs (the gate needs it): an explicit vault
// provider is byo; the test mode bills like the server keys; without any
// configured key the reply is the canned fallback and free.
export const resolveLopuBilling = (input: { vault: boolean; mode: 'auto' | 'claude' | 'openai' | 'test'; configured: boolean }): LopuBilling => {
  if (input.vault) return 'byo';
  if (input.mode === 'test') return 'thingtime';
  return input.configured ? 'thingtime' : 'free';
};

// The JSON body a refused request answers with: { ok:false, error, code } and
// the balance on a 402 so the client can render it.
export const lopuAccessRefusalBody = (refusal: LopuAccessRefusal): Record<string, unknown> => ({
  ok: false,
  error: refusal.error,
  code: refusal.code,
  ...(refusal.status === 402 ? { balanceMicros: refusal.balanceMicros } : {})
});
