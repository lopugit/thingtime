// Server-verified confirmations for Lopu's destructive tools (design note
// §2.4, "Confirmations"). A grant is a short-lived purpose JWT (the auth key
// material, purpose 'lopu-confirm') bound to the user, the conversation and
// the exact action key chatTools.ts derived from the tool input. Only the
// user's client ever holds it: it rides the `confirm` event to the card and
// comes back in the next reply body as confirmations: [{ key, token }]. The
// model sees neither the token nor a way to mint one, so a page block or a
// search snippet claiming "the user already confirmed" changes nothing.
//
// Stateless by design (no collection, no index): a grant is single-use within
// the turn that spends it and expires on its own; the client retires its card
// after one use. Replaying a grant would only re-approve the identical action
// the user already approved, and only while it is still fresh.

import { signPurposeToken, verifyPurposeToken } from '../auth/jwt';
import { MAX_LOPU_CONFIRM_KEY_CHARS, MAX_LOPU_CONFIRM_SUMMARY_CHARS, type LopuApprovedAction, type LopuConfirmableTool, type LopuConfirmationAction, type LopuConfirmationGrant } from './chatTools';

export const LOPU_CONFIRM_PURPOSE = 'lopu-confirm';
export const LOPU_CONFIRM_TTL_MS = 15 * 60_000;
export const MAX_LOPU_CONFIRMATIONS_PER_REPLY = 8;
export const MAX_LOPU_CONFIRM_TOKEN_CHARS = 4096;

const CONFIRMABLE_TOOLS: readonly LopuConfirmableTool[] = ['delete_thing', 'update_thing', 'run_action'];

export type LopuConfirmationInput = { key: string; token: string };

export const mintLopuConfirmation = async (input: { userId: string; chatId: string; action: LopuConfirmationAction }): Promise<LopuConfirmationGrant> => {
  const expiresAt = new Date(Date.now() + LOPU_CONFIRM_TTL_MS).toISOString();
  const token = await signPurposeToken(
    LOPU_CONFIRM_PURPOSE,
    { uid: input.userId, chat: input.chatId, key: input.action.key, tool: input.action.tool, summary: input.action.summary.slice(0, MAX_LOPU_CONFIRM_SUMMARY_CHARS) },
    `${Math.round(LOPU_CONFIRM_TTL_MS / 1000)}s`
  );
  return { token, expiresAt };
};

// The approved action a grant stands for, or null when it is not this
// user's, not this chat's, not this key, expired, or not a grant at all.
export const verifyLopuConfirmation = async (token: string, expected: { userId: string; chatId: string; key: string }): Promise<LopuApprovedAction | null> => {
  if (typeof token !== 'string' || !token || token.length > MAX_LOPU_CONFIRM_TOKEN_CHARS) return null;
  const claims = await verifyPurposeToken(token, LOPU_CONFIRM_PURPOSE);
  if (!claims) return null;
  if (claims.uid !== expected.userId || claims.chat !== expected.chatId || claims.key !== expected.key) return null;
  const tool = CONFIRMABLE_TOOLS.find((name) => name === claims.tool);
  if (!tool) return null;
  return { key: expected.key, tool, summary: typeof claims.summary === 'string' ? claims.summary : '' };
};

// Shape-check the reply body's confirmations before any of them is verified.
export const parseLopuConfirmations = (raw: unknown): { ok: true; confirmations: LopuConfirmationInput[] } | { ok: false; error: string } => {
  if (raw === undefined || raw === null) return { ok: true, confirmations: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'confirmations must be a list of { key, token }' };
  if (raw.length > MAX_LOPU_CONFIRMATIONS_PER_REPLY) return { ok: false, error: `At most ${MAX_LOPU_CONFIRMATIONS_PER_REPLY} confirmations per message` };
  const confirmations: LopuConfirmationInput[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    const key = record && typeof record.key === 'string' ? record.key.trim() : '';
    const token = record && typeof record.token === 'string' ? record.token.trim() : '';
    if (!key || key.length > MAX_LOPU_CONFIRM_KEY_CHARS || !token || token.length > MAX_LOPU_CONFIRM_TOKEN_CHARS) {
      return { ok: false, error: 'Each confirmation needs the key and token from Lopu’s confirm card' };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    confirmations.push({ key, token });
  }
  return { ok: true, confirmations };
};
