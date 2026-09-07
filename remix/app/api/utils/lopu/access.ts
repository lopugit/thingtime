import { json } from '~/api/http';

import { getStoredLopuAccessSettings, type LopuAccessSettings } from '../settings/lopuAccess';
import { ensureLopuAccount, type LopuAccountRecord } from './accounting';
import { evaluateLopuAccess, lopuAccessRefusalBody, lopuUserVerified, type LopuAccessRefusal, type LopuAccessUser, type LopuBilling } from './accessCore';

export * from './accessCore';

// The Lopu access gate (design note "Lopu verified access, usage accounting
// and credits" §1) — runs BEFORE any provider call in chats create, chats
// reply, voice reply and voice session:
//
//   temporary/guest session            → 403 LOPU_GUEST
//   requireVerification && !verified   → 403 LOPU_UNVERIFIED
//                                        (unless billing 'byo' && allowByoUnverified)
//   billing 'thingtime' && balance ≤ 0 → 402 LOPU_NO_CREDITS (+ balanceMicros)
//
// Admins are always verified. The account is created lazily here (starter
// credits granted once) so a first-ever turn sees the starter balance.
// Listing/reading chats is never gated (history is the user's data) and
// /lopu/musing is a public site feature.

export type LopuAccessGrant = {
  ok: true;
  billing: LopuBilling;
  settings: LopuAccessSettings;
  verified: boolean;
  // present for thingtime billing (the balance the gate saw)
  account: LopuAccountRecord | null;
};

export type LopuAccessResult = LopuAccessGrant | LopuAccessRefusal;

export type AssertLopuAccessDependencies = {
  getSettings: () => Promise<LopuAccessSettings>;
  ensureAccount: (userId: string) => Promise<LopuAccountRecord>;
};

export const createAssertLopuAccess =
  (dependencies: AssertLopuAccessDependencies) =>
  async (user: LopuAccessUser | null | undefined, input: { billing: LopuBilling }): Promise<LopuAccessResult> => {
    const settings = await dependencies.getSettings();
    // the cheap refusals first — an unverified guest never creates an account
    const early = evaluateLopuAccess(user, { billing: input.billing, settings, balanceMicros: 1 });
    if (early.ok === false) return early;
    let account: LopuAccountRecord | null = null;
    if (input.billing === 'thingtime' && user) {
      account = await dependencies.ensureAccount(user.id);
      const verdict = evaluateLopuAccess(user, { billing: input.billing, settings, balanceMicros: account.crystal.balanceMicros });
      if (verdict.ok === false) return verdict;
    }
    return { ok: true, billing: input.billing, settings, verified: lopuUserVerified(user), account };
  };

export const assertLopuAccess = createAssertLopuAccess({ getSettings: getStoredLopuAccessSettings, ensureAccount: ensureLopuAccount });

const NO_STORE = { 'Cache-Control': 'no-store' };

// The refusal as a JSON response: { ok:false, error, code[, balanceMicros] }.
export const lopuAccessResponse = (refusal: LopuAccessRefusal): Response => json(lopuAccessRefusalBody(refusal), { status: refusal.status, headers: NO_STORE });
