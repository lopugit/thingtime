import { json } from '~/api/http';

import { getStoredLopuAccessSettings, type LopuAccessSettings } from '../settings/lopuAccess';
import { ensureLopuAccount, reserveLopuTurn, type LopuAccountRecord, type LopuTurnReservation } from './accounting';
import {
  evaluateLopuAccess,
  LOPU_BUSY_CODE,
  LOPU_BUSY_ERROR,
  lopuAccessRefusalBody,
  lopuUserVerified,
  type LopuAccessRefusal,
  type LopuAccessUser,
  type LopuBilling
} from './accessCore';

export * from './accessCore';

// The Lopu access gate (design note "Lopu verified access, usage accounting
// and credits" §1) — runs BEFORE any provider call in chats create, chats
// reply, voice reply and voice session:
//
//   temporary/guest session            → 403 LOPU_GUEST
//   requireVerification && !verified   → 403 LOPU_UNVERIFIED
//                                        (unless billing 'byo' && allowByoUnverified)
//   billing 'thingtime' && balance ≤ 0 → 402 LOPU_NO_CREDITS (+ balanceMicros)
//   too many billed turns in flight    → 429 LOPU_TURN_IN_FLIGHT
//
// Admins are always verified. The account is created lazily here (starter
// credits granted once) so a first-ever turn sees the starter balance.
// Listing/reading chats is never gated (history is the user's data) and
// /lopu/musing is a public site feature.
//
// `reserve` (the reply route, the only surface that spends credits on a
// provider call): the balance this gate read is only meaningful if a bounded
// number of turns can spend it, so the grant carries an in-flight slot the
// caller MUST release in a finally. Without it, N concurrent replies each see
// the same one credit and each spend it.

export type LopuAccessGrant = {
  ok: true;
  billing: LopuBilling;
  settings: LopuAccessSettings;
  verified: boolean;
  // present for thingtime billing (the balance the gate saw)
  account: LopuAccountRecord | null;
  // held only when the caller asked to reserve; release it in a finally
  release: (() => Promise<void>) | null;
};

export type LopuAccessResult = LopuAccessGrant | LopuAccessRefusal;

export type AssertLopuAccessDependencies = {
  getSettings: () => Promise<LopuAccessSettings>;
  ensureAccount: (userId: string) => Promise<LopuAccountRecord>;
  reserveTurn: (userId: string) => Promise<LopuTurnReservation>;
};

export const createAssertLopuAccess =
  (dependencies: AssertLopuAccessDependencies) =>
  async (user: LopuAccessUser | null | undefined, input: { billing: LopuBilling; reserve?: boolean }): Promise<LopuAccessResult> => {
    const settings = await dependencies.getSettings();
    // the cheap refusals first — an unverified guest never creates an account
    const early = evaluateLopuAccess(user, { billing: input.billing, settings, balanceMicros: 1 });
    if (early.ok === false) return early;
    let account: LopuAccountRecord | null = null;
    let release: (() => Promise<void>) | null = null;
    if (input.billing === 'thingtime' && user) {
      account = await dependencies.ensureAccount(user.id);
      const verdict = evaluateLopuAccess(user, { billing: input.billing, settings, balanceMicros: account.crystal.balanceMicros });
      if (verdict.ok === false) return verdict;
      // only after the balance passed, so a broke account never holds a slot
      if (input.reserve) {
        const reserved = await dependencies.reserveTurn(user.id);
        if (reserved.ok === false) return { ok: false, status: 429, code: LOPU_BUSY_CODE, error: LOPU_BUSY_ERROR };
        release = reserved.release;
      }
    }
    return { ok: true, billing: input.billing, settings, verified: lopuUserVerified(user), account, release };
  };

export const assertLopuAccess = createAssertLopuAccess({ getSettings: getStoredLopuAccessSettings, ensureAccount: ensureLopuAccount, reserveTurn: reserveLopuTurn });

const NO_STORE = { 'Cache-Control': 'no-store' };
// a slot frees as soon as one of the running turns finishes — seconds, not
// the rate limiter's minutes
const IN_FLIGHT_RETRY_AFTER_SECONDS = '5';

// The refusal as a JSON response: { ok:false, error, code[, balanceMicros] }.
export const lopuAccessResponse = (refusal: LopuAccessRefusal): Response =>
  json(lopuAccessRefusalBody(refusal), {
    status: refusal.status,
    headers: refusal.status === 429 ? { ...NO_STORE, 'Retry-After': IN_FLIGHT_RETRY_AFTER_SECONDS } : NO_STORE
  });
