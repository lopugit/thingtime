import { createHash, randomUUID } from 'node:crypto';
import type { Binary } from 'mongodb';

import { getHomeThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { creditsToMicros, MICROS_PER_CREDIT, microsToCredits, priceTurn, type PricedUsage } from '../ai/pricing';
import { getStoredLopuAccessSettings, type LopuAccessSettings } from '../settings/lopuAccess';
import { isLopuBilling, type LopuBilling } from './accessCore';

// Lopu usage accounting and credits (design note "Lopu verified access, usage
// accounting and credits" §2–§3). Three protected control-plane kinds in
// `things`, written ONLY here (no crystal sanitizer, no generic CRUD, no new
// indexes — every query rides ownerId/thingtime/createdAt, the shareId
// uniqueness, or the root uniqueKeys index):
//
//   lopu-account  one per user (uniqueKeys lopuAccount:<userId>), the running
//                 balance + lifetime and monthly counters
//   lopu-usage    one per turn (chat / voice / voice-session): tokens, price,
//                 what was actually debited
//   lopu-credit   the ledger: starter / grant / topup / debit / adjust /
//                 refund rows with balanceAfterMicros, and top-up REQUESTS
//                 (requestStatus pending → approved | declined; while pending
//                 the row also carries uniqueKeys lopuTopupPending:<userId>,
//                 so "one pending request at a time" is an index invariant)
//
// Atomicity: a debit is (1) insert the usage row, (2) ONE findOneAndUpdate
// with $inc on the account (the month counters are reset first by a
// conditional update when the month key moved on), (3) insert the debit
// ledger row carrying balanceAfterMicros. Each step is retried once and is
// idempotent (deterministic shareIds, duplicate-key tolerated), and a failure
// after the provider call is logged, never surfaced as a chat error — the
// reply already streamed. The balance may go negative by at most one turn;
// the next gate refuses (prepaid model).
//
// Units: 1 credit = 1 USD = 1,000,000 micros (../ai/pricing.ts).

export const LOPU_ACCOUNT_THINGTIME = 'lopu-account' as const;
export const LOPU_USAGE_THINGTIME = 'lopu-usage' as const;
export const LOPU_CREDIT_THINGTIME = 'lopu-credit' as const;
export const LOPU_ACCOUNTING_THINGTIMES = [LOPU_ACCOUNT_THINGTIME, LOPU_USAGE_THINGTIME, LOPU_CREDIT_THINGTIME] as const;

export const LOPU_ACCOUNT_UNIQUE_KEY_FIELD = 'lopuAccount' as const;
export const LOPU_TOPUP_PENDING_UNIQUE_KEY_FIELD = 'lopuTopupPending' as const;

export const LOPU_CREDIT_ENTRIES = ['starter', 'grant', 'topup', 'debit', 'adjust', 'refund', 'request'] as const;
export type LopuCreditEntry = (typeof LOPU_CREDIT_ENTRIES)[number];
export const LOPU_ADMIN_CREDIT_ENTRIES = ['grant', 'topup', 'adjust', 'refund'] as const;
export type LopuAdminCreditEntry = (typeof LOPU_ADMIN_CREDIT_ENTRIES)[number];
export const LOPU_REQUEST_STATUSES = ['pending', 'approved', 'declined'] as const;
export type LopuRequestStatus = (typeof LOPU_REQUEST_STATUSES)[number];
export const LOPU_USAGE_SURFACES = ['chat', 'voice', 'voice-session'] as const;
export type LopuUsageSurface = (typeof LOPU_USAGE_SURFACES)[number];

export const LOPU_TOPUP_MIN_CREDITS = 0.5;
export const LOPU_TOPUP_MAX_CREDITS = 1000;
export const LOPU_ADMIN_CREDITS_MAX = 10_000;
export const LOPU_NOTE_MAX_CHARS = 500;
export const LOPU_REASON_MAX_CHARS = 300;
export const LOPU_HISTORY_DEFAULT_LIMIT = 50;
export const LOPU_HISTORY_MAX_LIMIT = 100;
export const LOPU_ADMIN_ACCOUNTS_DEFAULT_LIMIT = 50;
export const LOPU_ADMIN_ACCOUNTS_MAX_LIMIT = 100;

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type LopuAccountCrystal = {
  balanceMicros: number;
  lifetimeCostMicros: number;
  lifetimeInputTokens: number;
  lifetimeOutputTokens: number;
  turns: number;
  monthKey: string;
  monthCostMicros: number;
  monthTurns: number;
  starterGranted: boolean;
  starterMicros: number;
  lowBalanceNotifiedAt: string | null;
};

export type LopuAccountRecord = {
  id: string;
  userId: string;
  crystal: LopuAccountCrystal;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type LopuUsageCrystal = {
  chatId: string | null;
  requestId: string | null;
  surface: LopuUsageSurface;
  provider: string;
  providerLabel?: string;
  model: string | null;
  billing: LopuBilling;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
  priced: boolean;
  estimated: boolean;
  debitedMicros: number;
  toolCalls: number;
  hops: number;
  durationMs: number;
};

export type LopuCreditCrystal = {
  entry: LopuCreditEntry;
  amountMicros: number;
  balanceAfterMicros: number | null;
  reason: string;
  actorId: string;
  usageId?: string;
  requestId?: string;
  requestStatus?: LopuRequestStatus;
  note?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  grantedMicros?: number;
};

export type LopuUsageInput = {
  surface: LopuUsageSurface;
  billing: LopuBilling;
  provider: string;
  providerLabel?: string | null;
  model: string | null;
  // the pricing row to use when it differs from `model` (the test provider
  // prices against `test-model`); null = unpriced
  pricingModel?: string | null;
  usage: PricedUsage;
  chatId?: string | null;
  requestId?: string | null;
  toolCalls?: number;
  hops?: number;
  durationMs?: number;
};

export type LopuDebitResult =
  | { ok: true; usageId: string; costMicros: number; debitedMicros: number; balanceMicros: number; priced: boolean; estimated: boolean }
  | { ok: false; error: string };

export type LopuGrantInput = {
  entry: Exclude<LopuCreditEntry, 'debit' | 'request'>;
  amountMicros: number;
  reason: string;
  actorId: string;
  note?: string | null;
  requestId?: string | null;
};

export type LopuGrantResult = { ok: true; ledgerId: string; balanceMicros: number; account: LopuAccountRecord };

export type LopuCreditRowPublic = {
  id: string;
  entry: LopuCreditEntry;
  amountMicros: number;
  amountCredits: number;
  balanceAfterMicros: number | null;
  reason: string;
  actorId: string;
  usageId: string | null;
  requestId: string | null;
  requestStatus: LopuRequestStatus | null;
  note: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  grantedMicros: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LopuUsageRowPublic = {
  id: string;
  chatId: string | null;
  requestId: string | null;
  surface: LopuUsageSurface;
  provider: string;
  providerLabel: string | null;
  model: string | null;
  billing: LopuBilling;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
  costCredits: number;
  priced: boolean;
  estimated: boolean;
  debitedMicros: number;
  toolCalls: number;
  hops: number;
  durationMs: number;
  createdAt: string | null;
};

export type LopuAccountPublic = {
  userId: string;
  verified: boolean;
  requireVerification: boolean;
  allowByoUnverified: boolean;
  lowBalanceWarningCredits: number;
  balanceMicros: number;
  balanceCredits: number;
  lowBalance: boolean;
  month: { key: string; costMicros: number; turns: number };
  lifetime: { costMicros: number; inputTokens: number; outputTokens: number; turns: number };
  starterCredits: number;
  starterGranted: boolean;
  topupUrl: string | null;
  pendingRequest: LopuCreditRowPublic | null;
  createdAt: string | null;
  updatedAt: string | null;
};

// ── the collection seam ─────────────────────────────────────────────────────
// The subset of the driver's Collection this module touches, so the service
// is unit-testable against an in-memory collection (accountingMemory.testutil.ts).

export type LopuAccountingCursor = {
  sort: (spec: Record<string, 1 | -1>) => LopuAccountingCursor;
  limit: (count: number) => LopuAccountingCursor;
  toArray: () => Promise<any[]>;
};

export type LopuAccountingCollection = {
  findOne: (filter: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any | null>;
  find: (filter: Record<string, unknown>, options?: Record<string, unknown>) => LopuAccountingCursor;
  insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
  updateOne: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<{ matchedCount?: number; modifiedCount?: number; upsertedCount?: number }>;
  findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any | null>;
};

export type LopuAccountingDependencies = {
  getThingsCollection: () => Promise<LopuAccountingCollection>;
  getSettings: () => Promise<LopuAccessSettings>;
  now?: () => Date;
  newId?: () => string;
  log?: (message: string, error?: unknown) => void;
};

// ── pure helpers ────────────────────────────────────────────────────────────

export const monthKeyOf = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const isDuplicateKey = (error: unknown): boolean => {
  const code = (error as any)?.code;
  return code === 11000 || code === 11001 || /E11000|duplicate key/i.test(String((error as any)?.message || ''));
};

const safeInt = (value: unknown, fallback = 0): number => (Number.isSafeInteger(value) ? (value as number) : typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback);
const nonNegativeInt = (value: unknown): number => Math.max(0, safeInt(value));
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isoOf = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};
const dateOf = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const accountUniqueKey = (userId: string): Binary => thingUniqueKey(LOPU_ACCOUNT_UNIQUE_KEY_FIELD, userId);
const accountFilter = (userId: string): Record<string, unknown> => ({ ...thingUniqueKeyFilter(LOPU_ACCOUNT_UNIQUE_KEY_FIELD, userId), thingtime: LOPU_ACCOUNT_THINGTIME });
const pendingUniqueKey = (userId: string): Binary => thingUniqueKey(LOPU_TOPUP_PENDING_UNIQUE_KEY_FIELD, userId);

export const accountCrystalOf = (value: unknown, now: Date = new Date()): LopuAccountCrystal => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const monthKey = typeof raw.monthKey === 'string' && /^\d{4}-\d{2}$/.test(raw.monthKey) ? raw.monthKey : monthKeyOf(now);
  return {
    balanceMicros: safeInt(raw.balanceMicros),
    lifetimeCostMicros: nonNegativeInt(raw.lifetimeCostMicros),
    lifetimeInputTokens: nonNegativeInt(raw.lifetimeInputTokens),
    lifetimeOutputTokens: nonNegativeInt(raw.lifetimeOutputTokens),
    turns: nonNegativeInt(raw.turns),
    monthKey,
    monthCostMicros: nonNegativeInt(raw.monthCostMicros),
    monthTurns: nonNegativeInt(raw.monthTurns),
    starterGranted: raw.starterGranted === true,
    starterMicros: nonNegativeInt(raw.starterMicros),
    lowBalanceNotifiedAt: isoOf(raw.lowBalanceNotifiedAt)
  };
};

export const accountRecordOf = (doc: any, now: Date = new Date()): LopuAccountRecord | null => {
  if (!doc || typeof doc !== 'object' || typeof doc.shareId !== 'string' || typeof doc.ownerId !== 'string') return null;
  return { id: doc.shareId, userId: doc.ownerId, crystal: accountCrystalOf(doc.crystal, now), createdAt: dateOf(doc.createdAt), updatedAt: dateOf(doc.updatedAt) };
};

export const publicLopuCreditRow = (doc: any): LopuCreditRowPublic | null => {
  if (!doc || typeof doc !== 'object' || typeof doc.shareId !== 'string') return null;
  const crystal = doc.crystal && typeof doc.crystal === 'object' ? (doc.crystal as Record<string, unknown>) : {};
  const entry = (LOPU_CREDIT_ENTRIES as readonly unknown[]).includes(crystal.entry) ? (crystal.entry as LopuCreditEntry) : null;
  if (!entry) return null;
  const amountMicros = safeInt(crystal.amountMicros);
  const requestStatus = (LOPU_REQUEST_STATUSES as readonly unknown[]).includes(crystal.requestStatus) ? (crystal.requestStatus as LopuRequestStatus) : null;
  return {
    id: doc.shareId,
    entry,
    amountMicros,
    amountCredits: microsToCredits(amountMicros),
    balanceAfterMicros: Number.isSafeInteger(crystal.balanceAfterMicros) ? (crystal.balanceAfterMicros as number) : null,
    reason: text(crystal.reason, LOPU_REASON_MAX_CHARS),
    actorId: text(crystal.actorId, 128),
    usageId: text(crystal.usageId, 160) || null,
    requestId: text(crystal.requestId, 160) || null,
    requestStatus,
    note: text(crystal.note, LOPU_NOTE_MAX_CHARS) || null,
    resolvedAt: isoOf(crystal.resolvedAt),
    resolvedBy: text(crystal.resolvedBy, 128) || null,
    grantedMicros: Number.isSafeInteger(crystal.grantedMicros) ? (crystal.grantedMicros as number) : null,
    createdAt: isoOf(doc.createdAt),
    updatedAt: isoOf(doc.updatedAt)
  };
};

export const publicLopuUsageRow = (doc: any): LopuUsageRowPublic | null => {
  if (!doc || typeof doc !== 'object' || typeof doc.shareId !== 'string') return null;
  const crystal = doc.crystal && typeof doc.crystal === 'object' ? (doc.crystal as Record<string, unknown>) : {};
  const surface = (LOPU_USAGE_SURFACES as readonly unknown[]).includes(crystal.surface) ? (crystal.surface as LopuUsageSurface) : 'chat';
  const costMicros = nonNegativeInt(crystal.costMicros);
  return {
    id: doc.shareId,
    chatId: text(crystal.chatId, 160) || null,
    requestId: text(crystal.requestId, 160) || null,
    surface,
    provider: text(crystal.provider, 40) || 'unknown',
    providerLabel: text(crystal.providerLabel, 80) || null,
    model: text(crystal.model, 128) || null,
    billing: isLopuBilling(crystal.billing) ? crystal.billing : 'free',
    inputTokens: nonNegativeInt(crystal.inputTokens),
    outputTokens: nonNegativeInt(crystal.outputTokens),
    cacheReadTokens: nonNegativeInt(crystal.cacheReadTokens),
    cacheWriteTokens: nonNegativeInt(crystal.cacheWriteTokens),
    costMicros,
    costCredits: microsToCredits(costMicros),
    priced: crystal.priced === true,
    estimated: crystal.estimated === true,
    debitedMicros: nonNegativeInt(crystal.debitedMicros),
    toolCalls: nonNegativeInt(crystal.toolCalls),
    hops: nonNegativeInt(crystal.hops),
    durationMs: nonNegativeInt(crystal.durationMs),
    createdAt: isoOf(doc.createdAt)
  };
};

// The optional "Buy credits" destination (README: THINGTIME_LOPU_TOPUP_URL).
// No payment processor is wired in; an http(s) URL is surfaced verbatim, and
// anything else reads as unset so the UI offers "Request credits" only.
export const lopuTopupUrl = (env: Readonly<Record<string, string | undefined>> = process.env): string | null => {
  const raw = env.THINGTIME_LOPU_TOPUP_URL?.trim() || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

export const publicLopuAccount = (input: {
  record: LopuAccountRecord | null;
  userId: string;
  verified: boolean;
  settings: LopuAccessSettings;
  pendingRequest?: LopuCreditRowPublic | null;
  topupUrl?: string | null;
  now?: Date;
}): LopuAccountPublic => {
  const now = input.now ?? new Date();
  const crystal = input.record?.crystal ?? accountCrystalOf(null, now);
  const currentMonth = monthKeyOf(now);
  const monthLive = crystal.monthKey === currentMonth;
  const threshold = creditsToMicros(input.settings.lowBalanceWarningCredits);
  return {
    userId: input.userId,
    verified: input.verified,
    requireVerification: input.settings.requireVerification,
    allowByoUnverified: input.settings.allowByoUnverified,
    lowBalanceWarningCredits: input.settings.lowBalanceWarningCredits,
    balanceMicros: crystal.balanceMicros,
    balanceCredits: microsToCredits(crystal.balanceMicros),
    lowBalance: crystal.balanceMicros < threshold,
    month: { key: currentMonth, costMicros: monthLive ? crystal.monthCostMicros : 0, turns: monthLive ? crystal.monthTurns : 0 },
    lifetime: { costMicros: crystal.lifetimeCostMicros, inputTokens: crystal.lifetimeInputTokens, outputTokens: crystal.lifetimeOutputTokens, turns: crystal.turns },
    starterCredits: input.settings.starterCredits,
    starterGranted: crystal.starterGranted,
    topupUrl: input.topupUrl === undefined ? lopuTopupUrl() : input.topupUrl,
    pendingRequest: input.pendingRequest ?? null,
    createdAt: input.record?.createdAt ? input.record.createdAt.toISOString() : null,
    updatedAt: input.record?.updatedAt ? input.record.updatedAt.toISOString() : null
  };
};

// The admin directory row (GET /api/v1/admin/lopu/accounts, and what the
// credits endpoint echoes): who the account belongs to plus the same numbers
// the owner sees. A user who never opened Lopu has no account yet
// (hasAccount: false, zero balance) and is still listed so they can be
// verified or granted credits.
export type LopuAdminAccountUser = { id: string; username: string; displayName: string | null; email?: string | null; lopuVerified: boolean; isAdmin: boolean };

export type LopuAdminAccountRow = {
  user: LopuAdminAccountUser;
  hasAccount: boolean;
  accountId: string | null;
  balanceMicros: number;
  balanceCredits: number;
  lowBalance: boolean;
  month: { key: string; costMicros: number; turns: number };
  lifetime: { costMicros: number; inputTokens: number; outputTokens: number; turns: number };
  starterGranted: boolean;
  pendingRequest: LopuCreditRowPublic | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export const adminLopuAccountRow = (input: {
  user: LopuAdminAccountUser;
  record: LopuAccountRecord | null;
  settings: LopuAccessSettings;
  pendingRequest?: LopuCreditRowPublic | null;
  now?: Date;
}): LopuAdminAccountRow => {
  const shown = publicLopuAccount({ record: input.record, userId: input.user.id, verified: input.user.lopuVerified, settings: input.settings, pendingRequest: input.pendingRequest ?? null, topupUrl: null, now: input.now });
  return {
    user: input.user,
    hasAccount: !!input.record,
    accountId: input.record?.id ?? null,
    balanceMicros: shown.balanceMicros,
    balanceCredits: shown.balanceCredits,
    lowBalance: shown.lowBalance,
    month: shown.month,
    lifetime: shown.lifetime,
    starterGranted: shown.starterGranted,
    pendingRequest: shown.pendingRequest,
    createdAt: shown.createdAt,
    updatedAt: shown.updatedAt
  };
};

// ── cursors ─────────────────────────────────────────────────────────────────
// Newest first: (createdAt desc, shareId asc); the cursor names the last row.

type PageCursor = { createdAt: Date; shareId: string };

export const encodeLopuCursor = (doc: { createdAt: Date | null; shareId: string }): string | null => {
  if (!doc.createdAt) return null;
  return Buffer.from(JSON.stringify({ t: doc.createdAt.toISOString(), id: doc.shareId }), 'utf8').toString('base64url');
};

export const decodeLopuCursor = (value: unknown): PageCursor | null | 'invalid' => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 400) return 'invalid';
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const createdAt = dateOf(parsed?.t);
    if (!createdAt || typeof parsed?.id !== 'string' || !parsed.id) return 'invalid';
    return { createdAt, shareId: parsed.id };
  } catch {
    return 'invalid';
  }
};

const afterCursor = (cursor: PageCursor | null): Record<string, unknown> =>
  cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.shareId } }] } : {};

const pageLimit = (value: unknown, fallback: number, max: number): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(number)));
};

// ── the service ─────────────────────────────────────────────────────────────

export const createLopuAccountingService = (dependencies: LopuAccountingDependencies) => {
  const now = dependencies.now ?? (() => new Date());
  const newId = dependencies.newId ?? (() => randomUUID());
  const log = dependencies.log ?? ((message: string, error?: unknown) => console.error(message, error));

  const thing = (kind: string, ownerId: string, shareId: string, crystal: Record<string, unknown>, at: Date, uniqueKeys?: Binary[]) => ({
    shareId,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: [kind],
    crystal,
    extended: null,
    ownerId,
    storageClass: 'control',
    acl: [ACL_OWNER],
    targetId: null,
    tags: [],
    ...(uniqueKeys?.length ? { uniqueKeys } : {}),
    createdAt: at,
    updatedAt: at
  });

  // one attempt, then exactly one retry — the design's "retried once"
  const withRetry = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      log(`[lopu-accounting] ${label} failed — retrying once`, error);
      return work();
    }
  };

  const insertTolerant = async (things: LopuAccountingCollection, doc: Record<string, unknown>, label: string): Promise<'inserted' | 'existing'> =>
    withRetry(label, async () => {
      try {
        await things.insertOne(doc);
        return 'inserted';
      } catch (error) {
        if (isDuplicateKey(error)) return 'existing';
        throw error;
      }
    });

  const getLopuAccount = async (userId: string): Promise<LopuAccountRecord | null> => {
    const things = await dependencies.getThingsCollection();
    return accountRecordOf(await things.findOne(accountFilter(userId)), now());
  };

  // Lazily creates the account (one upsert keyed by the unique key, so two
  // concurrent first calls race safely) and grants the starter credits ONCE:
  // the balance is written by the same insert, the ledger row follows.
  const ensureLopuAccount = async (userId: string): Promise<LopuAccountRecord> => {
    const id = typeof userId === 'string' ? userId.trim() : '';
    if (!id) throw new TypeError('ensureLopuAccount needs a user id');
    const things = await dependencies.getThingsCollection();
    const existing = accountRecordOf(await things.findOne(accountFilter(id)), now());
    if (existing) return existing;

    const settings = await dependencies.getSettings();
    const starterMicros = creditsToMicros(settings.starterCredits);
    const at = now();
    const shareId = `lopu-account-${newId()}`;
    const doc = thing(
      LOPU_ACCOUNT_THINGTIME,
      id,
      shareId,
      {
        balanceMicros: starterMicros,
        lifetimeCostMicros: 0,
        lifetimeInputTokens: 0,
        lifetimeOutputTokens: 0,
        turns: 0,
        monthKey: monthKeyOf(at),
        monthCostMicros: 0,
        monthTurns: 0,
        starterGranted: true,
        starterMicros,
        lowBalanceNotifiedAt: starterMicros < creditsToMicros(settings.lowBalanceWarningCredits) ? at.toISOString() : null
      },
      at,
      [accountUniqueKey(id)]
    );
    const res = await things.updateOne(thingUniqueKeyFilter(LOPU_ACCOUNT_UNIQUE_KEY_FIELD, id), { $setOnInsert: doc }, { upsert: true });
    if (res.upsertedCount && starterMicros > 0) {
      const ledger = thing(LOPU_CREDIT_THINGTIME, id, `lopu-credit-${newId()}`, {
        entry: 'starter',
        amountMicros: starterMicros,
        balanceAfterMicros: starterMicros,
        reason: 'Starter credits',
        actorId: 'system'
      } satisfies LopuCreditCrystal, at);
      try {
        await insertTolerant(things, ledger, 'starter ledger row');
      } catch (error) {
        log('[lopu-accounting] starter ledger row not written (balance is correct)', error);
      }
    }
    const created = accountRecordOf(await things.findOne(accountFilter(id)), now());
    if (!created) throw new Error('Lopu account could not be created');
    return created;
  };

  // the month counters restart when the key moved on — a conditional update
  // guarded on the OLD key, so concurrent rollovers are idempotent
  const rolloverMonth = async (things: LopuAccountingCollection, userId: string, monthKey: string, at: Date) => {
    await things.updateOne(
      { ...accountFilter(userId), 'crystal.monthKey': { $ne: monthKey } },
      { $set: { 'crystal.monthKey': monthKey, 'crystal.monthCostMicros': 0, 'crystal.monthTurns': 0, updatedAt: at } }
    );
  };

  const applyLowBalanceMark = async (things: LopuAccountingCollection, userId: string, record: LopuAccountRecord, at: Date) => {
    const settings = await dependencies.getSettings();
    const threshold = creditsToMicros(settings.lowBalanceWarningCredits);
    const low = record.crystal.balanceMicros < threshold;
    if (low && !record.crystal.lowBalanceNotifiedAt) {
      await things.updateOne(accountFilter(userId), { $set: { 'crystal.lowBalanceNotifiedAt': at.toISOString() } });
      record.crystal.lowBalanceNotifiedAt = at.toISOString();
    } else if (!low && record.crystal.lowBalanceNotifiedAt) {
      await things.updateOne(accountFilter(userId), { $set: { 'crystal.lowBalanceNotifiedAt': null } });
      record.crystal.lowBalanceNotifiedAt = null;
    }
  };

  const usageShareId = (userId: string, input: LopuUsageInput): string => {
    if (input.requestId) {
      const digest = createHash('sha256').update(`${userId}|${input.surface}|${input.requestId}`).digest('hex').slice(0, 32);
      return `lopu-usage-${digest}`;
    }
    return `lopu-usage-${newId()}`;
  };

  // Record one turn and, for thingtime billing, debit it. Never throws.
  const debitLopuUsage = async (userId: string, input: LopuUsageInput): Promise<LopuDebitResult> => {
    try {
      const things = await dependencies.getThingsCollection();
      const at = now();
      const price = priceTurn(input.pricingModel === undefined ? input.model : input.pricingModel, input.usage);
      const debited = input.billing === 'thingtime' ? price.costMicros : 0;
      const inputTokens = nonNegativeInt(input.usage?.inputTokens);
      const outputTokens = nonNegativeInt(input.usage?.outputTokens);
      const usageId = usageShareId(userId, input);
      const usageCrystal: LopuUsageCrystal = {
        chatId: text(input.chatId, 160) || null,
        requestId: text(input.requestId, 160) || null,
        surface: input.surface,
        provider: text(input.provider, 40) || 'unknown',
        ...(text(input.providerLabel, 80) ? { providerLabel: text(input.providerLabel, 80) } : {}),
        model: text(input.model, 128) || null,
        billing: input.billing,
        inputTokens,
        outputTokens,
        cacheReadTokens: nonNegativeInt(input.usage?.cacheReadTokens),
        cacheWriteTokens: nonNegativeInt(input.usage?.cacheWriteTokens),
        costMicros: price.costMicros,
        priced: price.priced,
        estimated: price.estimated,
        debitedMicros: debited,
        toolCalls: nonNegativeInt(input.toolCalls),
        hops: nonNegativeInt(input.hops),
        durationMs: nonNegativeInt(input.durationMs)
      };

      // (1) the usage row — deterministic id, so a retry never doubles it
      const inserted = await insertTolerant(things, thing(LOPU_USAGE_THINGTIME, userId, usageId, usageCrystal, at), 'usage row');
      if (inserted === 'existing') {
        // this exact turn was already accounted for (a replayed request):
        // report the balance and do not charge twice
        const record = (await getLopuAccount(userId)) ?? (await ensureLopuAccount(userId));
        return { ok: true, usageId, costMicros: price.costMicros, debitedMicros: 0, balanceMicros: record.crystal.balanceMicros, priced: price.priced, estimated: price.estimated };
      }

      // (2) one $inc on the account
      await ensureLopuAccount(userId);
      const monthKey = monthKeyOf(at);
      const updated = await withRetry('account debit', async () => {
        await rolloverMonth(things, userId, monthKey, at);
        return things.findOneAndUpdate(
          accountFilter(userId),
          {
            $inc: {
              'crystal.balanceMicros': -debited,
              'crystal.lifetimeCostMicros': debited,
              'crystal.lifetimeInputTokens': inputTokens,
              'crystal.lifetimeOutputTokens': outputTokens,
              'crystal.turns': 1,
              'crystal.monthCostMicros': debited,
              'crystal.monthTurns': 1
            },
            $set: { updatedAt: at }
          },
          { returnDocument: 'after' }
        );
      });
      const record = accountRecordOf(updated, at);
      if (!record) throw new Error('Lopu account vanished during the debit');

      // (3) the ledger row with the balance after the debit
      if (debited > 0) {
        const ledger = thing(LOPU_CREDIT_THINGTIME, userId, `${usageId.replace(/^lopu-usage-/, 'lopu-credit-debit-')}`, {
          entry: 'debit',
          amountMicros: -debited,
          balanceAfterMicros: record.crystal.balanceMicros,
          reason: `${input.surface === 'chat' ? 'Chat' : input.surface === 'voice' ? 'Voice' : 'Voice session'} turn${usageCrystal.model ? ` · ${usageCrystal.model}` : ''}`,
          actorId: userId,
          usageId
        } satisfies LopuCreditCrystal, at);
        await insertTolerant(things, ledger, 'debit ledger row');
        await applyLowBalanceMark(things, userId, record, at).catch((error) => log('[lopu-accounting] low-balance mark failed', error));
      }
      return { ok: true, usageId, costMicros: price.costMicros, debitedMicros: debited, balanceMicros: record.crystal.balanceMicros, priced: price.priced, estimated: price.estimated };
    } catch (error) {
      log('[lopu-accounting] usage was not recorded', error);
      return { ok: false, error: String((error as any)?.message || error) };
    }
  };

  // A positive (or, for adjust/refund, negative) movement of the balance with
  // its ledger row. Throws on a durable failure — callers are admin routes.
  const grantLopuCredits = async (userId: string, input: LopuGrantInput): Promise<LopuGrantResult> => {
    const amount = safeInt(input.amountMicros);
    if (!amount) throw new TypeError('amountMicros must be a non-zero integer');
    const things = await dependencies.getThingsCollection();
    await ensureLopuAccount(userId);
    const at = now();
    const updated = await withRetry('credit grant', () =>
      things.findOneAndUpdate(accountFilter(userId), { $inc: { 'crystal.balanceMicros': amount }, $set: { updatedAt: at } }, { returnDocument: 'after' })
    );
    const record = accountRecordOf(updated, at);
    if (!record) throw new Error('Lopu account vanished during the grant');
    const ledgerId = `lopu-credit-${newId()}`;
    const ledger = thing(LOPU_CREDIT_THINGTIME, userId, ledgerId, {
      entry: input.entry,
      amountMicros: amount,
      balanceAfterMicros: record.crystal.balanceMicros,
      reason: text(input.reason, LOPU_REASON_MAX_CHARS) || input.entry,
      actorId: text(input.actorId, 128) || 'system',
      ...(text(input.note, LOPU_NOTE_MAX_CHARS) ? { note: text(input.note, LOPU_NOTE_MAX_CHARS) } : {}),
      ...(text(input.requestId, 160) ? { requestId: text(input.requestId, 160) } : {})
    } satisfies LopuCreditCrystal, at);
    await insertTolerant(things, ledger, 'grant ledger row');
    await applyLowBalanceMark(things, userId, record, at).catch((error) => log('[lopu-accounting] low-balance mark failed', error));
    return { ok: true, ledgerId, balanceMicros: record.crystal.balanceMicros, account: record };
  };

  const getPendingLopuTopupRequest = async (userId: string): Promise<LopuCreditRowPublic | null> => {
    const things = await dependencies.getThingsCollection();
    const doc = await things.findOne({ ...thingUniqueKeyFilter(LOPU_TOPUP_PENDING_UNIQUE_KEY_FIELD, userId), thingtime: LOPU_CREDIT_THINGTIME, ownerId: userId });
    return publicLopuCreditRow(doc);
  };

  // pending requests for a set of users (the admin list), one $in query
  const pendingLopuTopupRequestsFor = async (userIds: readonly string[]): Promise<Map<string, LopuCreditRowPublic>> => {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    const map = new Map<string, LopuCreditRowPublic>();
    if (!ids.length) return map;
    const things = await dependencies.getThingsCollection();
    const docs = await things
      .find({ thingtime: LOPU_CREDIT_THINGTIME, ownerId: { $in: ids }, 'crystal.entry': 'request', 'crystal.requestStatus': 'pending' })
      .sort({ createdAt: -1, shareId: 1 })
      .limit(ids.length * 2)
      .toArray();
    for (const doc of docs) {
      const row = publicLopuCreditRow(doc);
      if (row && typeof doc.ownerId === 'string' && !map.has(doc.ownerId)) map.set(doc.ownerId, row);
    }
    return map;
  };

  // One pending request per account: the row carries the pending unique key,
  // so a second one collides on the index — 409, never a duplicate.
  const createLopuTopupRequest = async (userId: string, input: { credits: unknown; note?: unknown }): Promise<Fail | { ok: true; request: LopuCreditRowPublic }> => {
    const credits = typeof input.credits === 'number' ? input.credits : typeof input.credits === 'string' && input.credits.trim() ? Number(input.credits) : NaN;
    if (!Number.isFinite(credits) || credits < LOPU_TOPUP_MIN_CREDITS || credits > LOPU_TOPUP_MAX_CREDITS) {
      return fail(400, `credits must be a number between ${LOPU_TOPUP_MIN_CREDITS} and ${LOPU_TOPUP_MAX_CREDITS}`);
    }
    if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') return fail(400, 'note must be text');
    if (typeof input.note === 'string' && input.note.length > LOPU_NOTE_MAX_CHARS) return fail(400, `note caps at ${LOPU_NOTE_MAX_CHARS} characters`);
    const things = await dependencies.getThingsCollection();
    await ensureLopuAccount(userId);
    const at = now();
    const doc = thing(
      LOPU_CREDIT_THINGTIME,
      userId,
      `lopu-credit-${newId()}`,
      {
        entry: 'request',
        amountMicros: creditsToMicros(credits),
        balanceAfterMicros: null,
        reason: 'Credit top-up request',
        actorId: userId,
        requestStatus: 'pending',
        ...(text(input.note, LOPU_NOTE_MAX_CHARS) ? { note: text(input.note, LOPU_NOTE_MAX_CHARS) } : {})
      } satisfies LopuCreditCrystal,
      at,
      [pendingUniqueKey(userId)]
    );
    try {
      await things.insertOne(doc);
    } catch (error) {
      if (isDuplicateKey(error)) return fail(409, 'You already have a credit request waiting for an admin — Lopu will let you know when it is reviewed');
      throw error;
    }
    const request = publicLopuCreditRow(doc);
    if (!request) throw new Error('top-up request row is malformed');
    return { ok: true, request };
  };

  // Approve (grant the requested or an overriding amount, entry 'topup') or
  // decline a pending request. The status flips first, guarded on 'pending',
  // so a double-approve can never grant twice; the pending unique key is
  // released with the same write.
  const resolveLopuTopupRequest = async (input: {
    requestId: unknown;
    actorId: string;
    approve: boolean;
    credits?: number | null;
    reason?: string | null;
  }): Promise<Fail | { ok: true; request: LopuCreditRowPublic; ledger: LopuCreditRowPublic | null; balanceMicros: number | null; userId: string }> => {
    const requestId = text(input.requestId, 160);
    if (!requestId) return fail(400, 'requestId is required');
    const things = await dependencies.getThingsCollection();
    const doc = await things.findOne({ shareId: requestId, thingtime: LOPU_CREDIT_THINGTIME, 'crystal.entry': 'request' });
    const current = publicLopuCreditRow(doc);
    if (!doc || !current || typeof doc.ownerId !== 'string') return fail(404, 'Credit request not found');
    if (current.requestStatus !== 'pending') return fail(409, `That request was already ${current.requestStatus}`);
    const userId = doc.ownerId as string;
    const at = now();
    const grantMicros = input.approve ? (typeof input.credits === 'number' && Number.isFinite(input.credits) ? creditsToMicros(input.credits) : current.amountMicros) : 0;
    if (input.approve && grantMicros <= 0) return fail(400, 'An approved request needs a positive amount of credits');
    const flipped = await things.updateOne(
      { shareId: requestId, thingtime: LOPU_CREDIT_THINGTIME, 'crystal.requestStatus': 'pending' },
      {
        $set: {
          'crystal.requestStatus': input.approve ? 'approved' : 'declined',
          'crystal.resolvedAt': at.toISOString(),
          'crystal.resolvedBy': text(input.actorId, 128) || 'system',
          ...(input.approve ? { 'crystal.grantedMicros': grantMicros } : {}),
          ...(text(input.reason, LOPU_REASON_MAX_CHARS) ? { 'crystal.reason': text(input.reason, LOPU_REASON_MAX_CHARS) } : {}),
          updatedAt: at
        },
        // the pending key is the row's ONLY unique key, so the field is
        // removed outright: a $pull would leave `uniqueKeys: []`, and the
        // unique multikey index keys an empty array as undefined — every
        // resolved request would then collide on that one index entry
        $unset: { uniqueKeys: '' }
      }
    );
    if (!flipped.matchedCount) return fail(409, 'That request was just resolved by someone else');
    let ledger: LopuCreditRowPublic | null = null;
    let balanceMicros: number | null = null;
    if (input.approve) {
      const granted = await grantLopuCredits(userId, {
        entry: 'topup',
        amountMicros: grantMicros,
        reason: text(input.reason, LOPU_REASON_MAX_CHARS) || `Top-up request approved (${microsToCredits(grantMicros)} credits)`,
        actorId: input.actorId,
        requestId
      });
      balanceMicros = granted.balanceMicros;
      const ledgerDoc = await things.findOne({ shareId: granted.ledgerId, thingtime: LOPU_CREDIT_THINGTIME });
      ledger = publicLopuCreditRow(ledgerDoc);
    } else {
      balanceMicros = (await getLopuAccount(userId))?.crystal.balanceMicros ?? null;
    }
    const resolved = publicLopuCreditRow(await things.findOne({ shareId: requestId, thingtime: LOPU_CREDIT_THINGTIME }));
    return { ok: true, request: resolved ?? current, ledger, balanceMicros, userId };
  };

  // Ledger rows newest first plus the usage rows the page's debits point at.
  const listLopuAccountHistory = async (
    userId: string,
    input: { cursor?: unknown; limit?: unknown } = {}
  ): Promise<Fail | { ok: true; entries: LopuCreditRowPublic[]; usage: LopuUsageRowPublic[]; nextCursor: string | null }> => {
    const cursor = decodeLopuCursor(input.cursor);
    if (cursor === 'invalid') return fail(400, 'cursor is not a history cursor');
    const limit = pageLimit(input.limit, LOPU_HISTORY_DEFAULT_LIMIT, LOPU_HISTORY_MAX_LIMIT);
    const things = await dependencies.getThingsCollection();
    const docs = await things
      .find({ ownerId: userId, thingtime: LOPU_CREDIT_THINGTIME, ...afterCursor(cursor) })
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray();
    const page = docs.slice(0, limit);
    const entries = page.map(publicLopuCreditRow).filter((row): row is LopuCreditRowPublic => !!row);
    const usageIds = Array.from(new Set(entries.map((row) => row.usageId).filter((id): id is string => !!id)));
    const usageDocs = usageIds.length
      ? await things
          .find({ ownerId: userId, thingtime: LOPU_USAGE_THINGTIME, shareId: { $in: usageIds } })
          .sort({ createdAt: -1, shareId: 1 })
          .limit(usageIds.length)
          .toArray()
      : [];
    const usage = usageDocs.map(publicLopuUsageRow).filter((row): row is LopuUsageRowPublic => !!row);
    const last = page[page.length - 1];
    const nextCursor = docs.length > limit && last ? encodeLopuCursor({ createdAt: dateOf(last.createdAt), shareId: last.shareId }) : null;
    return { ok: true, entries, usage, nextCursor };
  };

  // The admin directory: every account newest first (cursor-paged), or the
  // accounts of a given set of users (a username search resolved elsewhere).
  const listLopuAccountsForAdmin = async (
    input: { userIds?: readonly string[] | null; cursor?: unknown; limit?: unknown } = {}
  ): Promise<Fail | { ok: true; accounts: LopuAccountRecord[]; nextCursor: string | null }> => {
    const things = await dependencies.getThingsCollection();
    const at = now();
    if (input.userIds) {
      const ids = Array.from(new Set(input.userIds.filter(Boolean)));
      if (!ids.length) return { ok: true, accounts: [], nextCursor: null };
      const docs = await things.find({ thingtime: LOPU_ACCOUNT_THINGTIME, ownerId: { $in: ids } }).sort({ createdAt: -1, shareId: 1 }).limit(ids.length).toArray();
      const accounts = docs.map((doc) => accountRecordOf(doc, at)).filter((row): row is LopuAccountRecord => !!row);
      return { ok: true, accounts, nextCursor: null };
    }
    const cursor = decodeLopuCursor(input.cursor);
    if (cursor === 'invalid') return fail(400, 'cursor is not an accounts cursor');
    const limit = pageLimit(input.limit, LOPU_ADMIN_ACCOUNTS_DEFAULT_LIMIT, LOPU_ADMIN_ACCOUNTS_MAX_LIMIT);
    const docs = await things
      .find({ thingtime: LOPU_ACCOUNT_THINGTIME, ...afterCursor(cursor) })
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray();
    const page = docs.slice(0, limit);
    const accounts = page.map((doc) => accountRecordOf(doc, at)).filter((row): row is LopuAccountRecord => !!row);
    const last = page[page.length - 1];
    const nextCursor = docs.length > limit && last ? encodeLopuCursor({ createdAt: dateOf(last.createdAt), shareId: last.shareId }) : null;
    return { ok: true, accounts, nextCursor };
  };

  return {
    ensureLopuAccount,
    getLopuAccount,
    debitLopuUsage,
    grantLopuCredits,
    getPendingLopuTopupRequest,
    pendingLopuTopupRequestsFor,
    createLopuTopupRequest,
    resolveLopuTopupRequest,
    listLopuAccountHistory,
    listLopuAccountsForAdmin
  };
};

export type LopuAccountingService = ReturnType<typeof createLopuAccountingService>;

// Home plane explicitly: accounting is control-plane state and must never
// land on a request's endpoint-override DB.
const service = createLopuAccountingService({
  getThingsCollection: async () => (await getHomeThingsCollection()) as unknown as LopuAccountingCollection,
  getSettings: getStoredLopuAccessSettings
});

export const ensureLopuAccount = service.ensureLopuAccount;
export const getLopuAccount = service.getLopuAccount;
export const debitLopuUsage = service.debitLopuUsage;
export const grantLopuCredits = service.grantLopuCredits;
export const getPendingLopuTopupRequest = service.getPendingLopuTopupRequest;
export const pendingLopuTopupRequestsFor = service.pendingLopuTopupRequestsFor;
export const createLopuTopupRequest = service.createLopuTopupRequest;
export const resolveLopuTopupRequest = service.resolveLopuTopupRequest;
export const listLopuAccountHistory = service.listLopuAccountHistory;
export const listLopuAccountsForAdmin = service.listLopuAccountsForAdmin;

export { MICROS_PER_CREDIT };
