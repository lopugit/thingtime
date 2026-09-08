// 🦄 The viewer's Lopu account (verified-credits design note §3/§4): the
// verified flag + the access rules, the credit balance, this month's and the
// lifetime usage, a pending top-up request and the optional "Buy credits"
// URL — one module store shared by every Lopu surface (the chat views, the
// composer's balance chip, Settings → Lopu, the user settings modal) and a
// thin React hook over it.
//
// Optimistic-render house rule: the account seeds from `tt-lopu-account-<uid>`
// during hydrate (render-safe, no synchronous emit) and refetches in the
// background — on mount, after every `done` event (lopuChatStore hands the
// event's usage/cost/balance here first, so the chip moves before the
// refetch lands), and on window focus (slowly). Nothing here gates a first
// paint. The store never fetches on its own: the hook binds useApi's Lopu
// account family (bindLopuAccountApi), exactly like lopuChatStore.
//
// The slice (everything above the hook section) is DOM-free: lopuChatStore
// imports it, and the node tests exercise it without a browser.

import React from 'react';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { formatCredits, microsOrNull, normalizeLopuBilling, type LopuBilling, type LopuTurnGate } from './lopuTurnCore';

export { creditsToMicros, formatCredits, formatTurnCredits, microsToCredits } from './lopuTurnCore';

// ——— wire shapes (GET /api/v1/lopu/account) ————————————————————————————————

export type LopuAccountMonth = { key: string | null; costMicros: number; turns: number };

export type LopuAccountLifetime = { costMicros: number; inputTokens: number; outputTokens: number; turns: number };

export type LopuPendingRequest = { id: string | null; amountMicros: number; note: string | null; createdAt: string | null };

export type LopuAccount = {
	verified: boolean;
	requireVerification: boolean;
	allowByoUnverified: boolean;
	balanceMicros: number;
	lowBalance: boolean;
	// the admin threshold (credits) the server compared against, when it says
	lowBalanceWarningCredits: number | null;
	month: LopuAccountMonth;
	lifetime: LopuAccountLifetime;
	starterCredits: number;
	topupUrl: string | null;
	pendingRequest: LopuPendingRequest | null;
};

export type LopuLedgerEntryKind = 'starter' | 'grant' | 'topup' | 'debit' | 'adjust' | 'refund' | 'request';

export const LOPU_LEDGER_ENTRY_KINDS: ReadonlyArray<LopuLedgerEntryKind> = ['starter', 'grant', 'topup', 'debit', 'adjust', 'refund', 'request'];

export type LopuLedgerEntry = {
	id: string;
	entry: LopuLedgerEntryKind;
	amountMicros: number;
	balanceAfterMicros: number | null;
	reason: string | null;
	note: string | null;
	requestStatus: 'pending' | 'approved' | 'declined' | null;
	usageId: string | null;
	createdAt: string | null;
};

export type LopuUsageRow = {
	id: string;
	chatId: string | null;
	requestId: string | null;
	surface: 'chat' | 'voice' | 'voice-session' | null;
	provider: string | null;
	model: string | null;
	billing: LopuBilling | null;
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
	durationMs: number | null;
	createdAt: string | null;
};

export type LopuHistoryItem = { kind: 'ledger'; at: number; row: LopuLedgerEntry } | { kind: 'usage'; at: number; row: LopuUsageRow };

export type LopuHistoryPage = { items: LopuHistoryItem[]; nextCursor: string | null };

// ——— normalisation (defensive: a thing row, its crystal, or the flat projection) —

const record = (raw: unknown): Record<string, unknown> | null => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null);

const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

const isoOrNull = (value: unknown): string | null => {
	if (typeof value === 'string' && value) return value;
	if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
	if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
	return null;
};

const normalizeMonth = (raw: unknown): LopuAccountMonth => {
	const month = record(raw);
	return { key: stringOrNull(month?.key ?? month?.monthKey), costMicros: numberOr(month?.costMicros, 0), turns: numberOr(month?.turns, 0) };
};

const normalizeLifetime = (raw: unknown): LopuAccountLifetime => {
	const lifetime = record(raw);
	return {
		costMicros: numberOr(lifetime?.costMicros, 0),
		inputTokens: numberOr(lifetime?.inputTokens, 0),
		outputTokens: numberOr(lifetime?.outputTokens, 0),
		turns: numberOr(lifetime?.turns, 0)
	};
};

// a request row: the pending `lopu-credit` ledger row, projected or raw
export const normalizeLopuPendingRequest = (raw: unknown): LopuPendingRequest | null => {
	const source = record(raw);
	if (!source) return null;
	const crystal = record(source.crystal) ?? source;
	const micros = microsOrNull(crystal.amountMicros ?? source.amountMicros);
	const credits = typeof crystal.credits === 'number' ? crystal.credits : typeof source.credits === 'number' ? source.credits : null;
	const amountMicros = micros ?? (credits !== null && Number.isFinite(credits) ? Math.round(credits * 1_000_000) : null);
	if (amountMicros === null) return null;
	return {
		id: stringOrNull(source.id ?? crystal.id),
		amountMicros,
		note: stringOrNull(crystal.note ?? source.note),
		createdAt: isoOrNull(source.createdAt ?? crystal.createdAt)
	};
};

/** The account off the wire (`{ ok, account }` or the bare account) — null when it is not one. */
export const normalizeLopuAccount = (raw: unknown): LopuAccount | null => {
	const envelope = record(raw);
	if (!envelope) return null;
	const source = record(envelope.account) ?? envelope;
	if (typeof source.verified !== 'boolean' && typeof source.balanceMicros !== 'number' && typeof source.requireVerification !== 'boolean') return null;
	const balanceMicros = microsOrNull(source.balanceMicros) ?? (typeof source.balanceCredits === 'number' ? Math.round(source.balanceCredits * 1_000_000) : 0);
	const threshold = typeof source.lowBalanceWarningCredits === 'number' && Number.isFinite(source.lowBalanceWarningCredits) ? source.lowBalanceWarningCredits : null;
	const lowBalance = typeof source.lowBalance === 'boolean' ? source.lowBalance : threshold !== null ? balanceMicros < threshold * 1_000_000 : false;
	return {
		verified: source.verified === true,
		requireVerification: source.requireVerification !== false,
		allowByoUnverified: source.allowByoUnverified === true,
		balanceMicros,
		lowBalance,
		lowBalanceWarningCredits: threshold,
		month: normalizeMonth(source.month),
		lifetime: normalizeLifetime(source.lifetime),
		starterCredits: numberOr(source.starterCredits, 0),
		topupUrl: typeof source.topupUrl === 'string' && /^https?:\/\//i.test(source.topupUrl) ? source.topupUrl : null,
		pendingRequest: normalizeLopuPendingRequest(source.pendingRequest)
	};
};

export const normalizeLopuLedgerEntry = (raw: unknown): LopuLedgerEntry | null => {
	const source = record(raw);
	if (!source) return null;
	const crystal = record(source.crystal) ?? source;
	const entry = LOPU_LEDGER_ENTRY_KINDS.includes(crystal.entry as LopuLedgerEntryKind) ? (crystal.entry as LopuLedgerEntryKind) : null;
	const id = stringOrNull(source.id ?? crystal.id);
	if (!entry || !id) return null;
	const status = crystal.requestStatus;
	return {
		id,
		entry,
		amountMicros: microsOrNull(crystal.amountMicros) ?? 0,
		balanceAfterMicros: microsOrNull(crystal.balanceAfterMicros),
		reason: stringOrNull(crystal.reason),
		note: stringOrNull(crystal.note),
		requestStatus: status === 'pending' || status === 'approved' || status === 'declined' ? status : null,
		usageId: stringOrNull(crystal.usageId),
		createdAt: isoOrNull(source.createdAt ?? crystal.createdAt)
	};
};

export const normalizeLopuUsageRow = (raw: unknown): LopuUsageRow | null => {
	const source = record(raw);
	if (!source) return null;
	const crystal = record(source.crystal) ?? source;
	const id = stringOrNull(source.id ?? crystal.id);
	if (!id) return null;
	const surface = crystal.surface === 'chat' || crystal.surface === 'voice' || crystal.surface === 'voice-session' ? crystal.surface : null;
	return {
		id,
		chatId: stringOrNull(crystal.chatId),
		requestId: stringOrNull(crystal.requestId),
		surface,
		provider: stringOrNull(crystal.provider),
		model: stringOrNull(crystal.model),
		billing: normalizeLopuBilling(crystal.billing),
		inputTokens: numberOr(crystal.inputTokens, 0),
		outputTokens: numberOr(crystal.outputTokens, 0),
		cacheReadTokens: numberOr(crystal.cacheReadTokens, 0),
		cacheWriteTokens: numberOr(crystal.cacheWriteTokens, 0),
		costMicros: microsOrNull(crystal.costMicros) ?? 0,
		priced: crystal.priced === true,
		estimated: crystal.estimated === true,
		debitedMicros: microsOrNull(crystal.debitedMicros) ?? 0,
		toolCalls: numberOr(crystal.toolCalls, 0),
		hops: numberOr(crystal.hops, 0),
		durationMs: typeof crystal.durationMs === 'number' && Number.isFinite(crystal.durationMs) ? crystal.durationMs : null,
		createdAt: isoOrNull(source.createdAt ?? crystal.createdAt)
	};
};

const timeOf = (iso: string | null): number => {
	const at = iso ? Date.parse(iso) : NaN;
	return Number.isFinite(at) ? at : 0;
};

/**
 * One history list from the ledger and the usage rows of a page, newest
 * first (a debit and the usage row it paid for share a timestamp — the
 * usage row sorts first so the debit reads as its consequence).
 */
export const mergeLopuHistory = (entries: LopuLedgerEntry[], usage: LopuUsageRow[]): LopuHistoryItem[] => {
	const items: LopuHistoryItem[] = [
		...entries.map((row): LopuHistoryItem => ({ kind: 'ledger', at: timeOf(row.createdAt), row })),
		...usage.map((row): LopuHistoryItem => ({ kind: 'usage', at: timeOf(row.createdAt), row }))
	];
	return items.sort((a, b) => {
		if (a.at !== b.at) return b.at - a.at;
		if (a.kind !== b.kind) return a.kind === 'usage' ? -1 : 1;
		return a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0;
	});
};

/** A history page off the wire (`{ ok, entries, usage, nextCursor }`). */
export const normalizeLopuHistoryPage = (raw: unknown): LopuHistoryPage => {
	const source = record(raw);
	const entries = Array.isArray(source?.entries) ? source!.entries.map(normalizeLopuLedgerEntry).filter((row): row is LopuLedgerEntry => !!row) : [];
	const usage = Array.isArray(source?.usage) ? source!.usage.map(normalizeLopuUsageRow).filter((row): row is LopuUsageRow => !!row) : [];
	return { items: mergeLopuHistory(entries, usage), nextCursor: stringOrNull(source?.nextCursor) };
};

// ——— admin shapes (GET /api/v1/admin/lopu/accounts, Thingtime.LopuAccess) ————

export type LopuAdminAccountRow = {
	user: { id: string; username: string; displayName: string | null; lopuVerified: boolean; isAdmin: boolean };
	balanceMicros: number;
	month: LopuAccountMonth;
	lifetime: LopuAccountLifetime;
	pendingRequest: LopuPendingRequest | null;
	// a directory hit with no `lopu-account` row yet (the account is created
	// lazily the first time the person meets Lopu, or when an admin grants)
	noAccount?: boolean;
};

/** An admin users-directory row (no Lopu account yet) as a zero-balance table row. */
export const lopuAdminRowFromDirectory = (raw: unknown): LopuAdminAccountRow | null => {
	const user = record(raw);
	const id = stringOrNull(user?.id);
	if (!user || !id) return null;
	return {
		user: { id, username: stringOrNull(user.username) ?? id, displayName: stringOrNull(user.displayName), lopuVerified: user.lopuVerified === true, isAdmin: user.isAdmin === true || user.envAdmin === true },
		balanceMicros: 0,
		month: normalizeMonth(null),
		lifetime: normalizeLifetime(null),
		pendingRequest: null,
		noAccount: true
	};
};

/** One Admin → Lopu accounts row off the wire (`{ user, balanceMicros, month, lifetime, pendingRequest }`). */
export const normalizeLopuAdminAccountRow = (raw: unknown): LopuAdminAccountRow | null => {
	const source = record(raw);
	if (!source) return null;
	const user = record(source.user);
	const id = stringOrNull(user?.id ?? source.userId);
	if (!id) return null;
	return {
		user: {
			id,
			username: stringOrNull(user?.username) ?? id,
			displayName: stringOrNull(user?.displayName),
			lopuVerified: user?.lopuVerified === true || source.verified === true,
			isAdmin: user?.isAdmin === true
		},
		balanceMicros: microsOrNull(source.balanceMicros) ?? 0,
		month: normalizeMonth(source.month),
		lifetime: normalizeLifetime(source.lifetime),
		pendingRequest: normalizeLopuPendingRequest(source.pendingRequest),
		// the directory search lists people who never met Lopu (hasAccount: false)
		...(source.hasAccount === false ? { noAccount: true } : {})
	};
};

export type LopuAccessSettings = { requireVerification: boolean; allowByoUnverified: boolean; starterCredits: number; lowBalanceWarningCredits: number };

export const LOPU_ACCESS_DEFAULTS: LopuAccessSettings = { requireVerification: true, allowByoUnverified: false, starterCredits: 0, lowBalanceWarningCredits: 1 };

/** The Thingtime.LopuAccess singleton (`{ ok, settings }`, `{ ok, lopuAccess }` or the bare object). */
export const normalizeLopuAccessSettings = (raw: unknown): LopuAccessSettings => {
	const envelope = record(raw);
	const source = record(envelope?.settings) ?? record(envelope?.lopuAccess) ?? envelope ?? {};
	return {
		requireVerification: typeof source.requireVerification === 'boolean' ? source.requireVerification : LOPU_ACCESS_DEFAULTS.requireVerification,
		allowByoUnverified: typeof source.allowByoUnverified === 'boolean' ? source.allowByoUnverified : LOPU_ACCESS_DEFAULTS.allowByoUnverified,
		starterCredits: typeof source.starterCredits === 'number' && Number.isFinite(source.starterCredits) && source.starterCredits >= 0 ? source.starterCredits : LOPU_ACCESS_DEFAULTS.starterCredits,
		lowBalanceWarningCredits:
			typeof source.lowBalanceWarningCredits === 'number' && Number.isFinite(source.lowBalanceWarningCredits) && source.lowBalanceWarningCredits >= 0
				? source.lowBalanceWarningCredits
				: LOPU_ACCESS_DEFAULTS.lowBalanceWarningCredits
	};
};

// ——— access rules (client mirror of api/utils/lopu/access.ts) ——————————————

export type LopuAccessViewer = {
	signedIn: boolean;
	temporary: boolean;
	admin: boolean;
	// the user projection's own `lopuVerified` (null when the server does not say)
	verifiedHint?: boolean | null;
	// the instance-wide `requireVerification` last seen on this device (null
	// when nothing is known yet — the server default, true, then applies).
	// Without it an instance that does NOT require verification would greet a
	// first-visit account with "invite-only" until GET /lopu/account lands.
	requireVerificationHint?: boolean | null;
};

export type LopuLockReason = 'unverified' | 'temporary';

export type LopuAccess = {
	// the account has been seen (cache or server); rules below are otherwise
	// the safe defaults for a fresh account
	known: boolean;
	verified: boolean;
	requireVerification: boolean;
	allowByoUnverified: boolean;
	// the surfaces show LopuLockedState and disable the composer / mic
	locked: boolean;
	reason: LopuLockReason | null;
	// unverified, but the admin lets unverified accounts chat on their own
	// providers — the composer works while a vault provider is pinned
	byoOnly: boolean;
	noCredits: boolean;
	lowBalance: boolean;
};

const OPEN_ACCESS: LopuAccess = {
	known: false,
	verified: true,
	requireVerification: false,
	allowByoUnverified: false,
	locked: false,
	reason: null,
	byoOnly: false,
	noCredits: false,
	lowBalance: false
};

/**
 * Where the viewer stands (verified-credits design note §4 "Locked state"):
 * locked when verification is required and the account is not verified —
 * admins are always verified; a BYO turn passes when the admin allows it.
 * `byo` says whether the composer's current choice is one of the viewer's
 * own providers.
 */
export const selectLopuAccess = (account: LopuAccount | null | undefined, viewer: LopuAccessViewer, options?: { byo?: boolean }): LopuAccess => {
	if (!viewer.signedIn || viewer.temporary) {
		return { ...OPEN_ACCESS, known: true, verified: false, locked: true, reason: 'temporary' };
	}
	if (viewer.admin) return { ...OPEN_ACCESS, known: !!account, lowBalance: account?.lowBalance === true, noCredits: !!account && account.balanceMicros <= 0 };
	if (!account) {
		// before the account is known: the user projection's own flag says
		// whether this account is verified, and the last-seen instance rule
		// says whether that even matters (defaulting to the server's own
		// default, "verification required")
		const requireVerification = viewer.requireVerificationHint !== false;
		const locked = requireVerification && viewer.verifiedHint === false;
		return { ...OPEN_ACCESS, verified: viewer.verifiedHint !== false, requireVerification, locked, reason: locked ? 'unverified' : null };
	}
	const verified = account.verified;
	const unverifiedGate = account.requireVerification && !verified;
	const byoOnly = unverifiedGate && account.allowByoUnverified;
	const locked = unverifiedGate && !(byoOnly && options?.byo === true);
	return {
		known: true,
		verified,
		requireVerification: account.requireVerification,
		allowByoUnverified: account.allowByoUnverified,
		locked,
		reason: locked ? 'unverified' : null,
		byoOnly,
		noCredits: account.balanceMicros <= 0,
		lowBalance: account.lowBalance
	};
};

// ——— the store ————————————————————————————————————————————————————————————

export const lopuAccountCacheKey = (userId: string) => `tt-lopu-account-${userId}`;
// The instance-wide access rule, kept per DEVICE rather than per user: a
// first-ever account on this browser has no account cache to seed from, and
// without this it would be greeted with "invite-only" on a deployment that
// does not require verification at all.
export const LOPU_ACCESS_HINT_CACHE_KEY = 'tt-lopu-access';

type AccountCache = { at: number; account: LopuAccount };

export type LopuAccountApiClient = {
	get: (options?: { signal?: AbortSignal }) => Promise<any>;
	history: (args?: { cursor?: string | null; limit?: number }, options?: { signal?: AbortSignal }) => Promise<any>;
	requestTopup: (args: { credits: number; note?: string }) => Promise<any>;
};

export type LopuAccountState = {
	userId: string | null;
	hydrated: boolean;
	account: LopuAccount | null;
	// the instance-wide `requireVerification` last seen on this device
	requireVerificationHint: boolean | null;
	loading: boolean;
	loaded: boolean;
	error: string | null;
	// when the account was last fetched (or seeded), for the slow focus refresh
	fetchedAt: number;
	// bumps on every change (cheap change detection)
	version: number;
};

// the slow refresh: at most once a minute on focus / visibility
export const LOPU_ACCOUNT_FOCUS_MIN_AGE_MS = 60_000;
// several surfaces mount at once (page + host + chip): one fetch serves them
export const LOPU_ACCOUNT_MOUNT_MIN_AGE_MS = 5_000;
// after `done` the server has debited already; a short beat absorbs the retry
export const LOPU_ACCOUNT_DONE_REFRESH_DELAY_MS = 600;

const createInitialState = (): LopuAccountState => ({
	userId: null,
	hydrated: false,
	account: null,
	requireVerificationHint: null,
	loading: false,
	loaded: false,
	error: null,
	fetchedAt: 0,
	version: 0
});

const SERVER_SNAPSHOT: LopuAccountState = createInitialState();
let state: LopuAccountState = createInitialState();
const listeners = new Set<() => void>();
let client: LopuAccountApiClient | null = null;
let inFlight: Promise<void> | null = null;
let doneTimer: ReturnType<typeof setTimeout> | null = null;
let emitScheduled = false;

const emit = () => {
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			// a broken subscriber must not stop the others
		}
	}
};

// hydration runs during render (no synchronous emit there)
const scheduleEmit = () => {
	if (emitScheduled) return;
	emitScheduled = true;
	const flush = () => {
		emitScheduled = false;
		emit();
	};
	if (typeof queueMicrotask === 'function') queueMicrotask(flush);
	else Promise.resolve().then(flush);
};

const setState = (patch: Partial<LopuAccountState>) => {
	state = { ...state, ...patch, version: state.version + 1 };
	emit();
};

export const subscribeLopuAccount = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const getLopuAccountSnapshot = (): LopuAccountState => state;
export const getLopuAccountServerSnapshot = (): LopuAccountState => SERVER_SNAPSHOT;

/** Bind the viewer's API client (called by useLopuAccount on every render — cheap). */
export const bindLopuAccountApi = (next: LopuAccountApiClient | null) => {
	client = next;
};

const errorText = (error: unknown, fallback: string): string => {
	const entry = error as { error?: unknown; message?: unknown } | null;
	if (entry && typeof entry.error === 'string' && entry.error) return entry.error;
	if (entry && typeof entry.message === 'string' && entry.message) return entry.message;
	return fallback;
};

const errorStatus = (error: unknown): number | null => {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : null;
};

/** The last-seen instance rule, or null when this device has never seen one. */
export const readLopuAccessHint = (): boolean | null => {
	const cached = readLocalCache<{ requireVerification?: unknown }>(LOPU_ACCESS_HINT_CACHE_KEY);
	return typeof cached?.requireVerification === 'boolean' ? cached.requireVerification : null;
};

const writeCache = (userId: string | null, account: LopuAccount | null) => {
	if (userId && account) writeLocalCache(lopuAccountCacheKey(userId), { at: Date.now(), account } satisfies AccountCache);
	// the rule is the deployment's, not this user's — kept beside the account
	// so the next first-visit account on this device is not falsely locked
	if (account) writeLocalCache(LOPU_ACCESS_HINT_CACHE_KEY, { requireVerification: account.requireVerification });
};

/**
 * Seed the store for a viewer from localCache. Idempotent per user; safe to
 * call during render. A viewer change drops the previous account's numbers
 * but keeps the deployment-wide access hint.
 */
export const hydrateLopuAccount = (userId: string | null): LopuAccountState => {
	if (state.hydrated && state.userId === userId) return state;
	const cached = userId ? readLocalCache<AccountCache>(lopuAccountCacheKey(userId)) : null;
	const account = cached ? normalizeLopuAccount(cached.account) : null;
	state = {
		...createInitialState(),
		userId,
		hydrated: true,
		account,
		requireVerificationHint: account ? account.requireVerification : readLopuAccessHint(),
		fetchedAt: account && typeof cached?.at === 'number' ? cached.at : 0
	};
	scheduleEmit();
	return state;
};

/** Refetch the account (deduplicated; `minAgeMs` skips a fresh enough copy). */
export const refreshLopuAccount = async (options?: { minAgeMs?: number }): Promise<void> => {
	if (!client || !state.userId) return;
	if (inFlight) return inFlight;
	const minAge = options?.minAgeMs ?? 0;
	if (minAge > 0 && state.fetchedAt && Date.now() - state.fetchedAt < minAge) return;
	const userId = state.userId;
	setState({ loading: true });
	inFlight = (async () => {
		try {
			const response = await client!.get();
			if (state.userId !== userId) return;
			const account = normalizeLopuAccount(response);
			if (!account) {
				setState({ loading: false, loaded: true, error: errorText(response, 'Could not read your Lopu account') });
				return;
			}
			writeCache(userId, account);
			setState({ account, requireVerificationHint: account.requireVerification, loading: false, loaded: true, error: null, fetchedAt: Date.now() });
		} catch (error) {
			if (state.userId !== userId) return;
			// a signed-out / temporary session has no account (401/403): no error to show
			const status = errorStatus(error);
			setState({ loading: false, loaded: true, error: status === 401 || status === 403 ? null : errorText(error, 'Could not read your Lopu account') });
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
};

/**
 * A finished turn (lopuChatStore, on `done`): move the balance now from the
 * event's numbers, fold the cost into this month / lifetime, then refetch
 * shortly after so the server's own arithmetic wins.
 */
export const applyLopuTurnBilling = (turn: { balanceMicros?: number | null; costMicros?: number | null; billing?: LopuBilling | null; usage?: { inputTokens?: number; outputTokens?: number } | null }) => {
	const billed = turn.billing === 'thingtime';
	if (state.account && (billed || typeof turn.balanceMicros === 'number')) {
		const account = state.account;
		const cost = billed && typeof turn.costMicros === 'number' && Number.isFinite(turn.costMicros) ? Math.max(0, Math.round(turn.costMicros)) : 0;
		const balanceMicros = typeof turn.balanceMicros === 'number' && Number.isFinite(turn.balanceMicros) ? Math.round(turn.balanceMicros) : account.balanceMicros - cost;
		const next: LopuAccount = {
			...account,
			balanceMicros,
			// the server's threshold decides the amber tint; below zero is always red
			lowBalance: account.lowBalanceWarningCredits !== null ? balanceMicros < account.lowBalanceWarningCredits * 1_000_000 : account.lowBalance || balanceMicros <= 0,
			month: billed ? { ...account.month, costMicros: account.month.costMicros + cost, turns: account.month.turns + 1 } : account.month,
			lifetime: billed
				? {
						...account.lifetime,
						costMicros: account.lifetime.costMicros + cost,
						turns: account.lifetime.turns + 1,
						inputTokens: account.lifetime.inputTokens + (turn.usage?.inputTokens ?? 0),
						outputTokens: account.lifetime.outputTokens + (turn.usage?.outputTokens ?? 0)
				  }
				: account.lifetime
		};
		writeCache(state.userId, next);
		setState({ account: next });
	}
	if (!client || !state.userId) return;
	if (doneTimer) clearTimeout(doneTimer);
	doneTimer = setTimeout(() => {
		doneTimer = null;
		void refreshLopuAccount();
	}, LOPU_ACCOUNT_DONE_REFRESH_DELAY_MS);
};

/**
 * The reply endpoint refused a turn at the gate: fold what it said into the
 * account (a 402 names the balance) and refetch so the surfaces flip to the
 * locked / no-credits state right away.
 */
export const noteLopuGate = (gate: LopuTurnGate, balanceMicros?: number | null) => {
	if (state.account) {
		const account = state.account;
		const next: LopuAccount = {
			...account,
			...(gate.code === 'LOPU_UNVERIFIED' ? { verified: false, requireVerification: true } : {}),
			...(gate.code === 'LOPU_NO_CREDITS' ? { balanceMicros: typeof balanceMicros === 'number' && Number.isFinite(balanceMicros) ? Math.round(balanceMicros) : Math.min(account.balanceMicros, 0), lowBalance: true } : {})
		};
		writeCache(state.userId, next);
		setState({ account: next });
	}
	void refreshLopuAccount();
};

export type TopupRequestResult = { ok: true; request: LopuPendingRequest | null } | { ok: false; error: string; status: number | null };

/** POST /api/v1/lopu/account/topup-request — one pending request at a time (409). */
export const requestLopuTopup = async (args: { credits: number; note?: string }): Promise<TopupRequestResult> => {
	if (!client) return { ok: false, error: 'Lopu is not connected yet', status: null };
	const credits = Number(args.credits);
	if (!Number.isFinite(credits) || credits < 0.5 || credits > 1000) return { ok: false, error: 'Ask for between 0.5 and 1000 credits', status: 400 };
	const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim().slice(0, 500) : undefined;
	try {
		const response = await client.requestTopup({ credits, ...(note ? { note } : {}) });
		if (response?.ok === false) return { ok: false, error: errorText(response, 'Could not send the request'), status: errorStatus(response) };
		const request = normalizeLopuPendingRequest(response?.request ?? response?.pendingRequest) ?? { id: null, amountMicros: Math.round(credits * 1_000_000), note: note ?? null, createdAt: new Date().toISOString() };
		if (state.account) {
			const next = { ...state.account, pendingRequest: request };
			writeCache(state.userId, next);
			setState({ account: next });
		}
		void refreshLopuAccount();
		return { ok: true, request };
	} catch (error) {
		const status = errorStatus(error);
		// a request is already waiting: the account will show it after the refetch
		if (status === 409) void refreshLopuAccount();
		return { ok: false, error: errorText(error, 'Could not send the request'), status };
	}
};

/** GET /api/v1/lopu/account/history — one page (cursor-paged, newest first). */
export const loadLopuAccountHistory = async (args?: { cursor?: string | null; limit?: number }): Promise<{ ok: true; page: LopuHistoryPage } | { ok: false; error: string }> => {
	if (!client) return { ok: false, error: 'Lopu is not connected yet' };
	try {
		const response = await client.history({ ...(args?.cursor ? { cursor: args.cursor } : {}), ...(args?.limit ? { limit: args.limit } : {}) });
		if (response?.ok === false) return { ok: false, error: errorText(response, 'Could not load your history') };
		return { ok: true, page: normalizeLopuHistoryPage(response) };
	} catch (error) {
		return { ok: false, error: errorText(error, 'Could not load your history') };
	}
};

/** Test/HMR hook: reset the module state (never called by the app). */
export const resetLopuAccountForTests = () => {
	client = null;
	inFlight = null;
	if (doneTimer) clearTimeout(doneTimer);
	doneTimer = null;
	state = createInitialState();
	emit();
};

// ——— the hook ————————————————————————————————————————————————————————————

export type UseLopuAccountOptions = {
	// the composer's current choice is one of the viewer's own providers
	byo?: boolean;
	// fetch on mount / focus (false for surfaces that only read the cache)
	active?: boolean;
};

export type UseLopuAccount = {
	account: LopuAccount | null;
	access: LopuAccess;
	loading: boolean;
	loaded: boolean;
	error: string | null;
	// "4.97" / "42¢" — the balance as people read it
	balanceLabel: string;
	refresh: () => Promise<void>;
	requestTopup: (args: { credits: number; note?: string }) => Promise<TopupRequestResult>;
	loadHistory: (args?: { cursor?: string | null; limit?: number }) => ReturnType<typeof loadLopuAccountHistory>;
};

export const useLopuAccount = (options: UseLopuAccountOptions = {}): UseLopuAccount => {
	const user = useCurrentUser();
	const api = useApi();
	const userId = user?.id ?? null;
	const temporary = !!user?.temporary;
	const admin = user?.isAdmin === true;
	const verifiedHint = typeof (user as { lopuVerified?: unknown } | null)?.lopuVerified === 'boolean' ? ((user as { lopuVerified?: boolean }).lopuVerified as boolean) : null;
	const active = options.active !== false && !!userId && !temporary;

	bindLopuAccountApi(api.v1.lopu.account);

	// seed during render (idempotent, no synchronous emit)
	React.useMemo(() => {
		hydrateLopuAccount(userId);
	}, [userId]);

	const snapshot = React.useSyncExternalStore(subscribeLopuAccount, getLopuAccountSnapshot, getLopuAccountServerSnapshot);

	// background refetch on mount (one fetch serves every surface that mounts together)
	React.useEffect(() => {
		if (!active) return;
		void refreshLopuAccount({ minAgeMs: LOPU_ACCOUNT_MOUNT_MIN_AGE_MS });
	}, [active, userId]);

	// …and slowly on focus / when the tab comes back
	React.useEffect(() => {
		if (!active || typeof window === 'undefined') return;
		const onFocus = () => {
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
			void refreshLopuAccount({ minAgeMs: LOPU_ACCOUNT_FOCUS_MIN_AGE_MS });
		};
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onFocus);
		return () => {
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onFocus);
		};
	}, [active]);

	const byo = options.byo === true;
	const access = React.useMemo(
		() =>
			selectLopuAccess(
				snapshot.account,
				{ signedIn: !!userId && !temporary, temporary, admin, verifiedHint, requireVerificationHint: snapshot.requireVerificationHint },
				{ byo }
			),
		[snapshot.account, snapshot.requireVerificationHint, userId, temporary, admin, verifiedHint, byo]
	);

	const refresh = React.useCallback(() => refreshLopuAccount(), []);

	return {
		account: snapshot.account,
		access,
		loading: snapshot.loading,
		loaded: snapshot.loaded,
		error: snapshot.error,
		balanceLabel: formatCredits(snapshot.account?.balanceMicros ?? 0),
		refresh,
		requestTopup: requestLopuTopup,
		loadHistory: loadLopuAccountHistory
	};
};
