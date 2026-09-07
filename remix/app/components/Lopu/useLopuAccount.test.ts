import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	applyLopuTurnBilling,
	bindLopuAccountApi,
	getLopuAccountSnapshot,
	hydrateLopuAccount,
	loadLopuAccountHistory,
	LOPU_ACCESS_DEFAULTS,
	lopuAdminRowFromDirectory,
	mergeLopuHistory,
	normalizeLopuAccessSettings,
	normalizeLopuAccount,
	normalizeLopuAdminAccountRow,
	normalizeLopuHistoryPage,
	normalizeLopuLedgerEntry,
	normalizeLopuUsageRow,
	noteLopuGate,
	refreshLopuAccount,
	requestLopuTopup,
	resetLopuAccountForTests,
	selectLopuAccess,
	type LopuAccount,
	type LopuAccountApiClient
} from './useLopuAccount.ts';
// @ts-ignore same
import { formatCredits, formatTurnCredits, lopuGateFromResponse } from './lopuTurnCore.ts';
// @ts-ignore same
import { lopuBalanceChipLabel, lopuBalanceTone } from './LopuBalanceChip.tsx';

// The viewer's Lopu account (verified-credits design note §3/§4): the wire
// normalisation, the access rules every surface locks on, credits formatting
// and the module store's reactions to `done` / the gate. Pure module state —
// no DOM (localStorage is absent in node, so caches are simply skipped).

const M = 1_000_000;

const ACCOUNT_WIRE = {
	ok: true,
	account: {
		verified: false,
		requireVerification: true,
		allowByoUnverified: false,
		balanceMicros: 4_970_000,
		balanceCredits: 4.97,
		lowBalance: false,
		lowBalanceWarningCredits: 1,
		month: { key: '2026-09', costMicros: 30_000, turns: 3 },
		lifetime: { costMicros: 1_030_000, inputTokens: 12_000, outputTokens: 4_000, turns: 41 },
		starterCredits: 2,
		topupUrl: 'https://pay.example.test/lopu',
		pendingRequest: null
	}
};

const VIEWER = { signedIn: true, temporary: false, admin: false };

test('normalizeLopuAccount reads the envelope or the bare account and fills safe defaults', () => {
	const account = normalizeLopuAccount(ACCOUNT_WIRE);
	assert.ok(account);
	assert.equal(account!.verified, false);
	assert.equal(account!.requireVerification, true);
	assert.equal(account!.balanceMicros, 4_970_000);
	assert.equal(account!.lowBalanceWarningCredits, 1);
	assert.deepEqual(account!.month, { key: '2026-09', costMicros: 30_000, turns: 3 });
	assert.deepEqual(account!.lifetime, { costMicros: 1_030_000, inputTokens: 12_000, outputTokens: 4_000, turns: 41 });
	assert.equal(account!.starterCredits, 2);
	assert.equal(account!.topupUrl, 'https://pay.example.test/lopu');
	assert.equal(account!.pendingRequest, null);
	// the bare shape works too; a bogus topupUrl is dropped; lowBalance falls back to the threshold
	const bare = normalizeLopuAccount({ verified: true, balanceMicros: 500_000, lowBalanceWarningCredits: 1, topupUrl: 'ftp://not-a-web-page' });
	assert.equal(bare?.verified, true);
	assert.equal(bare?.requireVerification, true, 'verification is required unless the server says otherwise');
	assert.equal(bare?.lowBalance, true, '0.50 is under a 1-credit threshold');
	assert.equal(bare?.topupUrl, null);
	assert.equal(bare?.month.turns, 0);
	// a pending request rides as a projection or as a raw ledger row
	const pending = normalizeLopuAccount({ ...ACCOUNT_WIRE.account, pendingRequest: { id: 'req-1', crystal: { entry: 'request', amountMicros: 5 * M, note: 'please' }, createdAt: '2026-09-06T10:00:00.000Z' } });
	assert.deepEqual(pending?.pendingRequest, { id: 'req-1', amountMicros: 5 * M, note: 'please', createdAt: '2026-09-06T10:00:00.000Z' });
	// not an account at all
	assert.equal(normalizeLopuAccount({ ok: false, error: 'nope' }), null);
	assert.equal(normalizeLopuAccount(null), null);
});

test('ledger + usage rows normalise from projections or raw things and merge newest first', () => {
	const debit = normalizeLopuLedgerEntry({ id: 'c-2', createdAt: '2026-09-06T10:00:01.000Z', crystal: { entry: 'debit', amountMicros: -13_200, balanceAfterMicros: 4_970_000, reason: 'turn', usageId: 'u-1' } });
	assert.deepEqual(debit, { id: 'c-2', entry: 'debit', amountMicros: -13_200, balanceAfterMicros: 4_970_000, reason: 'turn', note: null, requestStatus: null, usageId: 'u-1', createdAt: '2026-09-06T10:00:01.000Z' });
	const request = normalizeLopuLedgerEntry({ id: 'c-3', entry: 'request', amountMicros: 5 * M, requestStatus: 'pending', note: 'more please', createdAt: '2026-09-06T11:00:00.000Z' });
	assert.equal(request?.requestStatus, 'pending');
	assert.equal(normalizeLopuLedgerEntry({ id: 'x', entry: 'bogus' }), null, 'an unknown entry kind is not a ledger row');
	const usage = normalizeLopuUsageRow({
		id: 'u-1',
		createdAt: '2026-09-06T10:00:01.000Z',
		crystal: { chatId: 'chat-1', requestId: 'req-1', surface: 'chat', provider: 'test', model: 'test-model', billing: 'thingtime', inputTokens: 100, outputTokens: 50, costMicros: 13_200, priced: true, estimated: false, debitedMicros: 13_200, toolCalls: 1, hops: 2, durationMs: 420 }
	});
	assert.equal(usage?.surface, 'chat');
	assert.equal(usage?.billing, 'thingtime');
	assert.equal(usage?.costMicros, 13_200);
	assert.equal(usage?.durationMs, 420);
	assert.equal(usage?.cacheReadTokens, 0);
	const merged = mergeLopuHistory([debit!, request!], [usage!]);
	assert.deepEqual(
		merged.map((item) => `${item.kind}:${item.row.id}`),
		['ledger:c-3', 'usage:u-1', 'ledger:c-2'],
		'newest first; a usage row sorts before the debit that paid for it'
	);
	const page = normalizeLopuHistoryPage({ ok: true, entries: [debit], usage: [usage], nextCursor: 'abc' });
	assert.equal(page.items.length, 2);
	assert.equal(page.nextCursor, 'abc');
	assert.equal(normalizeLopuHistoryPage(null).nextCursor, null);
});

test('formatCredits: two decimals, cents below one credit, a minus for negatives; turn costs keep four', () => {
	assert.equal(formatCredits(4_970_000), '4.97');
	assert.equal(formatCredits(1_000_000), '1.00');
	assert.equal(formatCredits(420_000), '42¢');
	assert.equal(formatCredits(13_200), '1.3¢');
	assert.equal(formatCredits(5_000), '0.5¢');
	assert.equal(formatCredits(0), '0.00');
	assert.equal(formatCredits(-1_250_000), '−1.25');
	assert.equal(formatCredits(null), '0.00');
	assert.equal(formatTurnCredits(13_200), '0.0132');
	assert.equal(formatTurnCredits(500_000), '0.50');
	assert.equal(formatTurnCredits(1_250_000), '1.25');
	assert.equal(formatTurnCredits(0), '0.00');
	assert.equal(lopuBalanceChipLabel({ balanceMicros: 4_970_000 }), '4.97 credits');
	assert.equal(lopuBalanceChipLabel({ balanceMicros: 420_000 }), '42¢');
});

test('selectLopuAccess: guest / unverified / verified / admin × BYO', () => {
	const account = normalizeLopuAccount(ACCOUNT_WIRE)!;
	// unverified, verification required → locked
	const locked = selectLopuAccess(account, VIEWER);
	assert.equal(locked.locked, true);
	assert.equal(locked.reason, 'unverified');
	assert.equal(locked.byoOnly, false);
	// admins are always verified
	const admin = selectLopuAccess(account, { ...VIEWER, admin: true });
	assert.equal(admin.locked, false);
	assert.equal(admin.verified, true);
	// a temporary (guest) session is locked with its own reason
	const guest = selectLopuAccess(account, { signedIn: false, temporary: true, admin: false });
	assert.equal(guest.locked, true);
	assert.equal(guest.reason, 'temporary');
	// verified → open
	const verified = selectLopuAccess({ ...account, verified: true }, VIEWER);
	assert.equal(verified.locked, false);
	assert.equal(verified.reason, null);
	// verification switched off by the admin → open even when unverified
	assert.equal(selectLopuAccess({ ...account, requireVerification: false }, VIEWER).locked, false);
	// allowByoUnverified: locked on a catalog model, open on the viewer's own provider
	const byoAllowed = { ...account, allowByoUnverified: true };
	assert.equal(selectLopuAccess(byoAllowed, VIEWER, { byo: false }).locked, true);
	assert.equal(selectLopuAccess(byoAllowed, VIEWER, { byo: false }).byoOnly, true);
	assert.equal(selectLopuAccess(byoAllowed, VIEWER, { byo: true }).locked, false);
	// no credits / low balance ride along
	assert.equal(selectLopuAccess({ ...account, verified: true, balanceMicros: 0 }, VIEWER).noCredits, true);
	assert.equal(selectLopuAccess({ ...account, verified: true, lowBalance: true }, VIEWER).lowBalance, true);
	// before the account is known: the user projection's own flag is the only hint
	assert.equal(selectLopuAccess(null, VIEWER).locked, false);
	assert.equal(selectLopuAccess(null, VIEWER).known, false);
	assert.equal(selectLopuAccess(null, { ...VIEWER, verifiedHint: false }).locked, true);
	assert.equal(selectLopuAccess(null, { ...VIEWER, verifiedHint: true }).locked, false);
});

test('the balance chip tone: red at or below zero, amber under the threshold, quiet otherwise', () => {
	assert.equal(lopuBalanceTone({ balanceMicros: 4_970_000, lowBalance: false }), 'muted');
	assert.equal(lopuBalanceTone({ balanceMicros: 500_000, lowBalance: true }), 'warning');
	assert.equal(lopuBalanceTone({ balanceMicros: 0, lowBalance: true }), 'danger');
	assert.equal(lopuBalanceTone({ balanceMicros: -13_200, lowBalance: true }), 'danger');
	assert.equal(lopuBalanceTone(null), 'muted');
});

test('lopuGateFromResponse maps the 403/402 refusals and nothing else', () => {
	assert.deepEqual(lopuGateFromResponse(403, 'LOPU_UNVERIFIED', 'Lopu is invite-only for now — …'), { code: 'LOPU_UNVERIFIED', message: 'Lopu is invite-only for now — …', status: 403 });
	assert.equal(lopuGateFromResponse(402, 'LOPU_NO_CREDITS', '')?.message, "Lopu's credits for your account are used up — add credits to keep going.");
	assert.equal(lopuGateFromResponse(402, undefined)?.code, 'LOPU_NO_CREDITS', 'a 402 without a code is still the credits gate');
	assert.equal(lopuGateFromResponse(403, undefined, 'Create an account first')?.code, 'LOPU_FORBIDDEN');
	assert.equal(lopuGateFromResponse(429, 'LOPU_UNVERIFIED'), null);
	assert.equal(lopuGateFromResponse(null, 'LOPU_UNVERIFIED'), null);
});

test('admin rows and the access settings singleton normalise defensively', () => {
	const row = normalizeLopuAdminAccountRow({ user: { id: 'u-2', username: 'lopunew', displayName: null, lopuVerified: false, isAdmin: false }, balanceMicros: 0, month: { key: '2026-09', costMicros: 0, turns: 0 }, lifetime: {}, pendingRequest: { id: 'req-1', amountMicros: 5 * M } });
	assert.equal(row?.user.username, 'lopunew');
	assert.equal(row?.user.lopuVerified, false);
	assert.equal(row?.pendingRequest?.amountMicros, 5 * M);
	assert.equal(row?.lifetime.turns, 0);
	assert.equal(normalizeLopuAdminAccountRow({ balanceMicros: 1 }), null, 'a row without a user id is dropped');
	// a users-directory hit (no lopu-account row yet) becomes a zero-balance row the admin can still verify / credit
	const stub = lopuAdminRowFromDirectory({ id: 'u-3', username: 'fresh', displayName: 'Fresh', isAdmin: false, envAdmin: false, lopuVerified: false });
	assert.equal(stub?.noAccount, true);
	assert.equal(stub?.balanceMicros, 0);
	assert.equal(stub?.user.lopuVerified, false);
	assert.equal(lopuAdminRowFromDirectory({ id: 'u-4', username: 'env', envAdmin: true })?.user.isAdmin, true, 'env-allowlist admins count as admins');
	assert.equal(lopuAdminRowFromDirectory({ username: 'no-id' }), null);
	assert.deepEqual(normalizeLopuAccessSettings({ ok: true, settings: { requireVerification: false, allowByoUnverified: true, starterCredits: 2, lowBalanceWarningCredits: 0.5 } }), { requireVerification: false, allowByoUnverified: true, starterCredits: 2, lowBalanceWarningCredits: 0.5 });
	assert.deepEqual(normalizeLopuAccessSettings({ ok: true, requireVerification: true, starterCredits: -3 }), { ...LOPU_ACCESS_DEFAULTS, requireVerification: true });
	assert.deepEqual(normalizeLopuAccessSettings(undefined), LOPU_ACCESS_DEFAULTS);
});

// a stateful fake server: a posted request shows up on the next GET, exactly
// like the real one (the store refetches after every write)
const fakeClient = (options?: { account?: unknown; history?: unknown; topup?: (args: unknown) => unknown }) => {
	const calls: { name: string; args: unknown }[] = [];
	let pending: unknown = null;
	const client: LopuAccountApiClient = {
		get: async () => {
			calls.push({ name: 'get', args: null });
			const base = (options?.account ?? ACCOUNT_WIRE) as { account: Record<string, unknown> };
			return { ...base, account: { ...base.account, ...(pending ? { pendingRequest: pending } : {}) } };
		},
		history: async (args) => {
			calls.push({ name: 'history', args });
			return options?.history ?? { ok: true, entries: [], usage: [], nextCursor: null };
		},
		requestTopup: async (args) => {
			calls.push({ name: 'topup', args });
			if (options?.topup) return options.topup(args);
			pending = { id: 'req-9', amountMicros: (args as { credits: number }).credits * M, note: (args as { note?: string }).note ?? null };
			return { ok: true, request: pending };
		}
	};
	return { client, calls };
};

test('the store hydrates per viewer, refreshes through the bound client and dedupes in-flight fetches', async () => {
	resetLopuAccountForTests();
	const { client, calls } = fakeClient();
	bindLopuAccountApi(client);
	hydrateLopuAccount('u1');
	assert.equal(getLopuAccountSnapshot().account, null, 'no cache in node → nothing seeded');
	await Promise.all([refreshLopuAccount(), refreshLopuAccount()]);
	assert.equal(calls.filter((call) => call.name === 'get').length, 1, 'one fetch serves both callers');
	const snapshot = getLopuAccountSnapshot();
	assert.equal(snapshot.loaded, true);
	assert.equal(snapshot.account?.balanceMicros, 4_970_000);
	assert.ok(snapshot.fetchedAt > 0);
	// a fresh enough copy is kept when a minimum age is asked for
	await refreshLopuAccount({ minAgeMs: 60_000 });
	assert.equal(calls.filter((call) => call.name === 'get').length, 1);
	// a viewer change drops the previous account
	hydrateLopuAccount('u2');
	assert.equal(getLopuAccountSnapshot().account, null);
	assert.equal(getLopuAccountSnapshot().userId, 'u2');
	resetLopuAccountForTests();
});

test('applyLopuTurnBilling moves the balance and the month from the done event before the refetch lands', async () => {
	resetLopuAccountForTests();
	const { client, calls } = fakeClient();
	bindLopuAccountApi(client);
	hydrateLopuAccount('u1');
	await refreshLopuAccount();
	applyLopuTurnBilling({ balanceMicros: 4_956_800, costMicros: 13_200, billing: 'thingtime', usage: { inputTokens: 100, outputTokens: 50 } });
	const account = getLopuAccountSnapshot().account as LopuAccount;
	assert.equal(account.balanceMicros, 4_956_800);
	assert.equal(account.month.costMicros, 43_200);
	assert.equal(account.month.turns, 4);
	assert.equal(account.lifetime.turns, 42);
	assert.equal(account.lifetime.inputTokens, 12_100);
	// without a balance on the event the cost is subtracted; a BYO / free turn changes nothing
	applyLopuTurnBilling({ costMicros: 6_800, billing: 'thingtime' });
	assert.equal(getLopuAccountSnapshot().account?.balanceMicros, 4_950_000);
	applyLopuTurnBilling({ costMicros: 999_999, billing: 'byo' });
	assert.equal(getLopuAccountSnapshot().account?.balanceMicros, 4_950_000);
	assert.equal(getLopuAccountSnapshot().account?.month.turns, 5);
	// the balance dipping under the threshold turns the chip amber
	applyLopuTurnBilling({ balanceMicros: 900_000, costMicros: 4_050_000, billing: 'thingtime' });
	assert.equal(getLopuAccountSnapshot().account?.lowBalance, true);
	// …and the delayed refetch reconciles with the server
	await new Promise((resolve) => setTimeout(resolve, 700));
	assert.equal(calls.filter((call) => call.name === 'get').length, 2, 'one refetch after the burst of done events');
	assert.equal(getLopuAccountSnapshot().account?.balanceMicros, 4_970_000);
	resetLopuAccountForTests();
});

test('noteLopuGate folds a refusal into the account (402 names the balance, 403 unverifies) and refetches', async () => {
	resetLopuAccountForTests();
	const { client, calls } = fakeClient({ account: { ...ACCOUNT_WIRE, account: { ...ACCOUNT_WIRE.account, verified: true } } });
	bindLopuAccountApi(client);
	hydrateLopuAccount('u1');
	await refreshLopuAccount();
	assert.equal(getLopuAccountSnapshot().account?.verified, true);
	noteLopuGate({ code: 'LOPU_NO_CREDITS', message: 'used up', status: 402 }, -13_200);
	assert.equal(getLopuAccountSnapshot().account?.balanceMicros, -13_200);
	assert.equal(getLopuAccountSnapshot().account?.lowBalance, true);
	noteLopuGate({ code: 'LOPU_UNVERIFIED', message: 'invite-only', status: 403 });
	assert.equal(getLopuAccountSnapshot().account?.verified, false);
	assert.equal(selectLopuAccess(getLopuAccountSnapshot().account, VIEWER).locked, true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.ok(calls.filter((call) => call.name === 'get').length >= 2, 'the gate triggers a refetch');
	resetLopuAccountForTests();
});

test('requestLopuTopup validates the amount, records the pending request and reads the 409', async () => {
	resetLopuAccountForTests();
	const { client, calls } = fakeClient();
	bindLopuAccountApi(client);
	hydrateLopuAccount('u1');
	await refreshLopuAccount();
	assert.equal((await requestLopuTopup({ credits: 0.1 })).ok, false);
	assert.equal((await requestLopuTopup({ credits: 5000 })).ok, false);
	assert.equal(calls.filter((call) => call.name === 'topup').length, 0, 'invalid amounts never leave the client');
	const result = await requestLopuTopup({ credits: 5, note: '  more please  ' });
	assert.equal(result.ok, true);
	assert.deepEqual(calls.find((call) => call.name === 'topup')?.args, { credits: 5, note: 'more please' });
	assert.equal(getLopuAccountSnapshot().account?.pendingRequest?.amountMicros, 5 * M);
	// a request already waiting
	const conflict = fakeClient({
		topup: () => {
			throw Object.assign(new Error('A request is already waiting'), { status: 409, error: 'A request is already waiting' });
		}
	});
	bindLopuAccountApi(conflict.client);
	const refused = await requestLopuTopup({ credits: 5 });
	assert.equal(refused.ok, false);
	assert.equal(refused.ok === false && refused.status, 409);
	resetLopuAccountForTests();
});

test('loadLopuAccountHistory returns a normalised page through the bound client', async () => {
	resetLopuAccountForTests();
	const { client, calls } = fakeClient({
		history: { ok: true, entries: [{ id: 'c-1', entry: 'starter', amountMicros: 2 * M, balanceAfterMicros: 2 * M, createdAt: '2026-09-06T09:00:00.000Z' }], usage: [], nextCursor: 'next-1' }
	});
	bindLopuAccountApi(client);
	hydrateLopuAccount('u1');
	const result = await loadLopuAccountHistory({ cursor: 'c0', limit: 25 });
	assert.equal(result.ok, true);
	assert.equal(result.ok && result.page.items[0].row.id, 'c-1');
	assert.equal(result.ok && result.page.nextCursor, 'next-1');
	assert.deepEqual(calls[0].args, { cursor: 'c0', limit: 25 });
	resetLopuAccountForTests();
});
