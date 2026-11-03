import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LOPU_ACCESS_SETTINGS, type LopuAccessSettings } from '../settings/lopuAccess';
import { createLopuAccountingService, type LopuCreditRowPublic } from './accounting';
import { createMemoryThingsCollection } from './accountingMemory.testutil';
// @ts-ignore Node executes these TypeScript routes through the repo's tsx test loader.
import { createLopuAccountHandlers } from '../../../routes/api/v1/lopu/account/_account.tsx';
// @ts-ignore see above
import { createLopuAccountHistoryHandlers } from '../../../routes/api/v1/lopu/account/history/_history.tsx';
// @ts-ignore see above
import { createLopuTopupRequestHandlers, renderLopuTopupRequestEmail } from '../../../routes/api/v1/lopu/account/topup-request/_topup-request.tsx';
// @ts-ignore see above
import { createAdminLopuAccessHandlers } from '../../../routes/api/v1/admin/users/lopu-access/_lopu-access.tsx';
// @ts-ignore see above
import { createAdminLopuAccountsHandlers } from '../../../routes/api/v1/admin/lopu/accounts/_accounts.tsx';
// @ts-ignore see above
import { createAdminLopuCreditsHandlers } from '../../../routes/api/v1/admin/lopu/credits/_credits.tsx';

// The seven account / admin route handlers driven end to end against the
// REAL accounting service on the in-memory collection (design note §3 + §5
// "route handlers with in-memory collections"): auth walls, the JSON fence,
// rate-limit wiring (bucket names + failClosed), validation, and the shapes
// the client contracts on.

const ORIGIN = 'https://thingtime.test';
const allowed = { allowed: true, limit: 60, remaining: 59, resetAt: new Date(Date.now() + 60_000).toISOString() };
const blocked = { allowed: false, limit: 60, remaining: 0, resetAt: new Date(Date.now() + 30_000).toISOString() };

const users: Record<string, any> = {
  'user-1': { id: 'user-1', username: 'nik', displayName: 'Nik', email: 'nik@example.com', lopuVerified: false, isAdmin: false, envAdmin: false, emailVerified: true, createdAt: null, publicUploadsEnabled: true, privateUploadsEnabled: true, publicUploadsPending: false, privateUploadsPending: false },
  'user-2': { id: 'user-2', username: 'sam', displayName: null, email: 'sam@example.com', lopuVerified: true, isAdmin: false, envAdmin: false, emailVerified: true, createdAt: null, publicUploadsEnabled: true, privateUploadsEnabled: true, publicUploadsPending: false, privateUploadsPending: false }
};

const harness = (overrides: Partial<LopuAccessSettings> = {}) => {
  const things = createMemoryThingsCollection();
  let settings: LopuAccessSettings = { ...DEFAULT_LOPU_ACCESS_SETTINGS, ...overrides };
  const limits: Array<{ name: string; identity: string | null; options: unknown }> = [];
  let limitResult: typeof allowed | typeof blocked = allowed;
  // a ticking clock: rows written in the same millisecond would tie on
  // createdAt and page in shareId order, which the newest-first assertions
  // below must not depend on
  let clock = Date.parse('2026-09-06T10:00:00.000Z');
  const service = createLopuAccountingService({ getThingsCollection: async () => things, getSettings: async () => settings, now: () => new Date((clock += 1000)), log: () => {} });
  const enforceRateLimit = async (_request: Request, name: string, identity: string | null, options?: unknown) => {
    limits.push({ name, identity, options });
    return limitResult;
  };
  let currentUser: any = { id: 'user-1', username: 'nik', isAdmin: false, lopuVerified: false, temporary: false };
  const getCurrentUser = async () => currentUser;
  const requireAdmin = async () => (currentUser?.isAdmin ? { user: currentUser } : currentUser ? { error: { status: 403, message: 'Admins only' } } : { error: { status: 401, message: 'Unauthorized' } });
  const notified: any[] = [];
  const verifiedWrites: Array<{ userId: string; verified: boolean; actorId: string }> = [];

  const account = createLopuAccountHandlers({ getCurrentUser, enforceRateLimit, getSettings: async () => settings, ensureAccount: service.ensureLopuAccount, getPendingRequest: service.getPendingLopuTopupRequest, topupUrl: () => 'https://pay.example/lopu' } as any);
  const history = createLopuAccountHistoryHandlers({ getCurrentUser, enforceRateLimit, listHistory: service.listLopuAccountHistory } as any);
  const topup = createLopuTopupRequestHandlers({
    getCurrentUser,
    enforceRateLimit,
    createRequest: service.createLopuTopupRequest,
    notifyAdmins: async (input: unknown) => {
      notified.push(input);
      if ((input as any).request?.note === 'boom') throw new Error('mail down');
    },
    log: () => {}
  } as any);
  const access = createAdminLopuAccessHandlers({
    requireAdmin,
    enforceRateLimit,
    setUserLopuVerified: async (userId: string, verified: boolean, actorId: string) => {
      verifiedWrites.push({ userId, verified, actorId });
      if (!users[userId]) return null;
      users[userId] = { ...users[userId], lopuVerified: verified };
      return users[userId];
    }
  } as any);
  const accounts = createAdminLopuAccountsHandlers({
    requireAdmin,
    enforceRateLimit,
    getSettings: async () => settings,
    listAccounts: service.listLopuAccountsForAdmin,
    pendingRequestsFor: service.pendingLopuTopupRequestsFor,
    searchUsers: async (query: string) => Object.values(users).filter((row) => row.username.includes(query)),
    usersByIds: async (ids: string[]) => ids.map((id) => users[id]).filter(Boolean)
  } as any);
  const credits = createAdminLopuCreditsHandlers({
    requireAdmin,
    enforceRateLimit,
    getSettings: async () => settings,
    grantCredits: service.grantLopuCredits,
    resolveRequest: service.resolveLopuTopupRequest,
    getAccount: service.getLopuAccount,
    getPendingRequest: service.getPendingLopuTopupRequest,
    findUser: async (userId: string) => users[userId] ?? null
  } as any);

  return {
    things,
    service,
    limits,
    notified,
    verifiedWrites,
    account,
    history,
    topup,
    access,
    accounts,
    credits,
    setUser: (user: any) => (currentUser = user),
    setSettings: (next: Partial<LopuAccessSettings>) => (settings = { ...settings, ...next }),
    block: () => (limitResult = blocked),
    unblock: () => (limitResult = allowed)
  };
};

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, body: unknown, contentType = 'application/json') =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('GET /api/v1/lopu/account: walls, then the lazily created account in the public shape', async () => {
  const h = harness({ starterCredits: 2 });
  h.setUser(null);
  const anon = await h.account.loader({ request: get('/api/v1/lopu/account') });
  assert.equal(anon.status, 401);
  assert.equal(h.things.docs.length, 0);
  h.setUser({ id: 'guest', username: 'guest', temporary: true });
  const guest = await h.account.loader({ request: get('/api/v1/lopu/account') });
  assert.equal(guest.status, 403);
  assert.equal((await guest.json()).code, 'LOPU_GUEST');
  assert.equal(h.things.docs.length, 0);
  assert.equal((await h.account.loader({ request: new Request(`${ORIGIN}/api/v1/lopu/account`, { method: 'DELETE' }) })).status, 405);

  h.setUser({ id: 'user-1', username: 'nik', isAdmin: false, lopuVerified: false });
  const response = await h.account.loader({ request: get('/api/v1/lopu/account') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body: any = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body.account).sort(), [
    'allowByoUnverified',
    'balanceCredits',
    'balanceMicros',
    'createdAt',
    'lifetime',
    'lowBalance',
    'lowBalanceWarningCredits',
    'month',
    'pendingRequest',
    'requireVerification',
    'starterCredits',
    'starterGranted',
    'topupUrl',
    'updatedAt',
    'userId',
    'verified'
  ]);
  assert.equal(body.account.userId, 'user-1');
  assert.equal(body.account.verified, false);
  assert.equal(body.account.requireVerification, true);
  assert.equal(body.account.balanceMicros, 2_000_000);
  assert.equal(body.account.balanceCredits, 2);
  assert.equal(body.account.lowBalance, false);
  assert.equal(body.account.starterCredits, 2);
  assert.equal(body.account.starterGranted, true);
  assert.equal(body.account.topupUrl, 'https://pay.example/lopu');
  assert.equal(body.account.pendingRequest, null);
  assert.deepEqual(h.limits, [{ name: 'lopu.account', identity: 'user:user-1', options: undefined }]);
  // an admin reads as verified even without the flag; the same account is reused
  h.setUser({ id: 'user-1', username: 'nik', isAdmin: true });
  const admin: any = await (await h.account.loader({ request: get('/api/v1/lopu/account') })).json();
  assert.equal(admin.account.verified, true);
  assert.equal(h.things.ofKind('lopu-account').length, 1);
  h.block();
  assert.equal((await h.account.loader({ request: get('/api/v1/lopu/account') })).status, 429);
});

test('GET /api/v1/lopu/account/history: walls and the paged ledger with its usage rows', async () => {
  const h = harness({ starterCredits: 1 });
  await h.service.ensureLopuAccount('user-1');
  await h.service.debitLopuUsage('user-1', { surface: 'chat', billing: 'thingtime', provider: 'test', model: 'test', pricingModel: 'test-model', usage: { inputTokens: 100, outputTokens: 50 }, requestId: 'req-1', chatId: 'lopu-chat-1' });
  h.setUser(null);
  assert.equal((await h.history.loader({ request: get('/api/v1/lopu/account/history') })).status, 401);
  h.setUser({ id: 'user-1', username: 'nik', temporary: true });
  assert.equal((await h.history.loader({ request: get('/api/v1/lopu/account/history') })).status, 403);
  h.setUser({ id: 'user-1', username: 'nik' });
  const page: any = await (await h.history.loader({ request: get('/api/v1/lopu/account/history?limit=1') })).json();
  assert.equal(page.ok, true);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].entry, 'debit');
  assert.equal(page.entries[0].amountMicros, -200_000);
  assert.equal(page.usage.length, 1);
  assert.equal(page.usage[0].requestId, 'req-1');
  assert.equal(page.usage[0].id, page.entries[0].usageId);
  assert.ok(page.nextCursor);
  const next: any = await (await h.history.loader({ request: get(`/api/v1/lopu/account/history?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`) })).json();
  assert.equal(next.entries[0].entry, 'starter');
  assert.equal(next.nextCursor, null);
  assert.equal((await h.history.loader({ request: get('/api/v1/lopu/account/history?cursor=junk') })).status, 400);
  assert.deepEqual(h.limits.map((entry) => entry.name), ['lopu.account', 'lopu.account', 'lopu.account']);
  // another user's history is empty
  h.setUser({ id: 'user-2', username: 'sam' });
  const other: any = await (await h.history.loader({ request: get('/api/v1/lopu/account/history') })).json();
  assert.deepEqual(other, { ok: true, entries: [], usage: [], nextCursor: null });
});

test('POST /api/v1/lopu/account/topup-request: fence, validation, one pending at a time, best-effort admin mail', async () => {
  const h = harness();
  h.setUser(null);
  assert.equal((await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 1 }) })).status, 401);
  h.setUser({ id: 'guest', username: 'guest', temporary: true });
  assert.equal((await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 1 }) })).status, 403);
  h.setUser({ id: 'user-1', username: 'nik' });
  const form = await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', 'credits=1', 'text/plain') });
  assert.equal(form.status, 415);
  assert.equal(h.limits.length, 0, 'the fence runs before the bucket is spent');
  assert.equal((await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', {}) })).status, 400);
  assert.equal((await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 0.1 }) })).status, 400);
  assert.equal((await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 5, note: 'x'.repeat(501) }) })).status, 400);
  const ok = await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 2.5, note: 'please' }) });
  assert.equal(ok.status, 200);
  const body: any = await ok.json();
  assert.equal(body.request.entry, 'request');
  assert.equal(body.request.requestStatus, 'pending');
  assert.equal(body.request.amountCredits, 2.5);
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].username, 'nik');
  // the admin link is the TRUSTED origin, never the caller's Host: a request
  // arriving as thingtime.test cannot point an admin's mail at itself
  assert.notEqual(h.notified[0].origin, ORIGIN);
  assert.equal(h.notified[0].origin, 'https://thingtime.com');
  assert.equal(h.notified[0].request.id, body.request.id);
  assert.deepEqual(h.limits[0], { name: 'lopu.account.write', identity: 'user:user-1', options: { failClosed: true } });
  const again = await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 1 }) });
  assert.equal(again.status, 409);
  // a mail failure never fails the request
  h.setUser({ id: 'user-2', username: 'sam' });
  const boom = await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 1, note: 'boom' }) });
  assert.equal(boom.status, 200);
  assert.equal((await h.service.getPendingLopuTopupRequest('user-2'))?.note, 'boom');
  h.block();
  assert.equal((await h.topup.action({ request: post('/api/v1/lopu/account/topup-request', { credits: 1 }) })).status, 429);
  // the ops mail names the account and the amount, never a credential
  const mail = renderLopuTopupRequestEmail({ username: 'nik', userId: 'user-1', credits: 2.5, note: '<b>hi</b>', adminUrl: 'https://thingtime.test/admin' });
  assert.match(mail.subject, /@nik asks for 2\.5 credits/);
  assert.ok(mail.html.includes('&lt;b&gt;hi&lt;/b&gt;'));
  // exact final line, not a substring: an `includes` here would also pass on
  // https://thingtime.test/admin.evil.com (CodeQL js/incomplete-url-substring-sanitization)
  assert.equal(mail.text.split('\n').at(-1), 'Review it under Admin \u2192 Lopu accounts: https://thingtime.test/admin');
});

test('POST /api/v1/admin/users/lopu-access: admin-only, JSON-only, validated, fail-closed', async () => {
  const h = harness();
  h.setUser(null);
  assert.equal((await h.access.action({ request: post('/api/v1/admin/users/lopu-access', { userId: 'user-1', verified: true }) })).status, 401);
  h.setUser({ id: 'user-1', username: 'nik', isAdmin: false });
  assert.equal((await h.access.action({ request: post('/api/v1/admin/users/lopu-access', { userId: 'user-1', verified: true }) })).status, 403);
  assert.deepEqual(h.verifiedWrites, []);
  h.setUser({ id: 'admin-1', username: 'admin', isAdmin: true });
  assert.equal((await h.access.action({ request: post('/api/v1/admin/users/lopu-access', 'userId=user-1', 'text/plain') })).status, 415);
  assert.equal((await h.access.action({ request: post('/api/v1/admin/users/lopu-access', { verified: true }) })).status, 400);
  assert.equal((await h.access.action({ request: post('/api/v1/admin/users/lopu-access', { userId: 'user-1', verified: 'yes' }) })).status, 400);
  assert.equal((await h.access.action({ request: post('/api/v1/admin/users/lopu-access', { userId: 'nobody', verified: true }) })).status, 404);
  const ok = await h.access.action({ request: post('/api/v1/admin/users/lopu-access', { userId: 'user-1', verified: true }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const body: any = await ok.json();
  assert.equal(body.user.id, 'user-1');
  assert.equal(body.user.lopuVerified, true);
  assert.deepEqual(h.verifiedWrites.at(-1), { userId: 'user-1', verified: true, actorId: 'admin-1' });
  assert.deepEqual(h.limits[0], { name: 'admin.users.lopu-access', identity: 'user:admin-1', options: { failClosed: true } });
  assert.equal((await h.access.action({ request: get('/api/v1/admin/users/lopu-access') })).status, 405);
});

test('GET /api/v1/admin/lopu/accounts: admin-only directory, paged or searched, with pending requests', async () => {
  const h = harness({ starterCredits: 1 });
  await h.service.ensureLopuAccount('user-2');
  await h.service.createLopuTopupRequest('user-2', { credits: 3 });
  h.setUser({ id: 'user-1', username: 'nik', isAdmin: false });
  assert.equal((await h.accounts.loader({ request: get('/api/v1/admin/lopu/accounts') })).status, 403);
  h.setUser({ id: 'admin-1', username: 'admin', isAdmin: true });
  const page = await h.accounts.loader({ request: get('/api/v1/admin/lopu/accounts?limit=5') });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const body: any = await page.json();
  assert.equal(body.ok, true);
  assert.equal(body.accounts.length, 1);
  assert.equal(body.nextCursor, null);
  assert.deepEqual(body.settings, { ...DEFAULT_LOPU_ACCESS_SETTINGS, starterCredits: 1 });
  const row = body.accounts[0];
  assert.deepEqual(row.user, { id: 'user-2', username: 'sam', displayName: null, email: 'sam@example.com', lopuVerified: true, isAdmin: false });
  assert.equal(row.hasAccount, true);
  assert.ok(row.accountId.startsWith('lopu-account-'));
  assert.equal(row.balanceMicros, 1_000_000);
  assert.equal(row.pendingRequest.amountMicros, 3_000_000);
  assert.equal(row.starterGranted, true);
  // a search lists a user without an account too
  const searched: any = await (await h.accounts.loader({ request: get('/api/v1/admin/lopu/accounts?q=nik') })).json();
  assert.equal(searched.accounts.length, 1);
  assert.equal(searched.accounts[0].user.id, 'user-1');
  assert.equal(searched.accounts[0].hasAccount, false);
  assert.equal(searched.accounts[0].balanceMicros, 0);
  assert.equal(searched.accounts[0].pendingRequest, null);
  assert.equal((await h.accounts.loader({ request: get('/api/v1/admin/lopu/accounts?cursor=junk') })).status, 400);
  assert.deepEqual(h.limits[0], { name: 'admin.lopu.accounts', identity: 'user:admin-1', options: undefined });
});

test('POST /api/v1/admin/lopu/credits: grants, signed adjustments, request approval and decline', async () => {
  const h = harness();
  await h.service.ensureLopuAccount('user-2');
  const created = await h.service.createLopuTopupRequest('user-2', { credits: 3 });
  const request = (created as { ok: true; request: LopuCreditRowPublic }).request;
  h.setUser({ id: 'user-1', username: 'nik', isAdmin: false });
  assert.equal((await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { userId: 'user-1', credits: 5 }) })).status, 403);
  h.setUser({ id: 'admin-1', username: 'admin', isAdmin: true });
  assert.equal((await h.credits.action({ request: post('/api/v1/admin/lopu/credits', 'x', 'text/plain') })).status, 415);
  for (const body of [{}, { userId: 'user-1' }, { userId: 'user-1', credits: 0 }, { userId: 'user-1', credits: 20_000 }, { userId: 'user-1', credits: -1 }, { userId: 'user-1', credits: 1, entry: 'bonus' }, { requestId: request.id, credits: -2 }]) {
    const response = await h.credits.action({ request: post('/api/v1/admin/lopu/credits', body) });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal((await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { userId: 'nobody', credits: 1 }) })).status, 404);
  assert.equal((await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { requestId: 'lopu-credit-missing' }) })).status, 404);

  // a grant creates the account on the spot
  const granted = await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { userId: 'user-1', credits: 5, reason: 'Welcome', note: 'first' }) });
  assert.equal(granted.status, 200);
  const grantedBody: any = await granted.json();
  assert.equal(grantedBody.account.user.id, 'user-1');
  assert.equal(grantedBody.account.hasAccount, true);
  assert.equal(grantedBody.account.balanceMicros, 5_000_000);
  assert.deepEqual(grantedBody.ledger, { id: grantedBody.ledger.id, entry: 'grant', amountMicros: 5_000_000, balanceAfterMicros: 5_000_000 });
  assert.equal(grantedBody.request, null);
  assert.deepEqual(h.limits[0], { name: 'admin.lopu.credits', identity: 'user:admin-1', options: { failClosed: true } });
  // a signed adjustment
  const adjusted: any = await (await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { userId: 'user-1', credits: -1.5, entry: 'adjust', reason: 'oops' }) })).json();
  assert.equal(adjusted.account.balanceMicros, 3_500_000);
  assert.equal(adjusted.ledger.entry, 'adjust');
  // approve the pending request with an override amount
  const approved: any = await (await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { requestId: request.id, credits: 2, reason: 'partial' }) })).json();
  assert.equal(approved.ok, true);
  assert.equal(approved.request.requestStatus, 'approved');
  assert.equal(approved.request.grantedMicros, 2_000_000);
  assert.equal(approved.ledger.entry, 'topup');
  assert.equal(approved.ledger.requestId, request.id);
  assert.equal(approved.account.user.id, 'user-2');
  assert.equal(approved.account.balanceMicros, 2_000_000);
  assert.equal(approved.account.pendingRequest, null);
  assert.equal((await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { requestId: request.id }) })).status, 409);
  // decline another
  const second = (await h.service.createLopuTopupRequest('user-2', { credits: 1 })) as { ok: true; request: LopuCreditRowPublic };
  const declined: any = await (await h.credits.action({ request: post('/api/v1/admin/lopu/credits', { requestId: second.request.id, decline: true, reason: 'not now' }) })).json();
  assert.equal(declined.request.requestStatus, 'declined');
  assert.equal(declined.request.reason, 'not now');
  assert.equal(declined.ledger, null);
  assert.equal(declined.account.balanceMicros, 2_000_000);
  // the ledger reflects everything (two requests and the topup that answered
  // the first; rows written in the same millisecond tie on shareId, so the
  // set is asserted, not the order)
  const history = await h.service.listLopuAccountHistory('user-2', {});
  assert.deepEqual([...(history as any).entries.map((row: any) => row.entry)].sort(), ['request', 'request', 'topup']);
  assert.deepEqual(
    (history as any).entries.filter((row: any) => row.entry === 'request').map((row: any) => row.requestStatus).sort(),
    ['approved', 'declined']
  );
});
