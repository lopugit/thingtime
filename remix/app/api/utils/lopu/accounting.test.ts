import assert from 'node:assert/strict';
import test from 'node:test';

import { thingUniqueKey } from '../mongodb/uniqueKeys';
import { DEFAULT_LOPU_ACCESS_SETTINGS } from '../settings/lopuAccess';
import { LOPU_TEST_MODEL_ID } from '../ai/pricing';
import {
  accountCrystalOf,
  createLopuAccountingService,
  decodeLopuCursor,
  encodeLopuCursor,
  LOPU_ACCOUNT_THINGTIME,
  LOPU_CREDIT_THINGTIME,
  LOPU_INFLIGHT_TTL_MS,
  LOPU_MAX_CONCURRENT_TURNS,
  LOPU_USAGE_THINGTIME,
  lopuTopupUrl,
  monthKeyOf,
  publicLopuAccount,
  publicLopuCreditRow,
  publicLopuUsageRow
} from './accounting';
import { createMemoryThingsCollection } from './accountingMemory.testutil';

// The accounting service against the in-memory collection (design note §2–§3):
// starter credits once, debit / grant arithmetic, the month rollover, the
// negative floor, requests (one pending at a time, approve / decline), the
// history page and the admin listing. No Mongo — the collection is the
// invariant-preserving stand-in from accountingMemory.testutil.ts.

const setup = (overrides: Partial<{ starterCredits: number; lowBalanceWarningCredits: number }> = {}) => {
  const things = createMemoryThingsCollection();
  let clock = new Date('2026-09-06T10:00:00.000Z');
  let ids = 0;
  const settings = { ...DEFAULT_LOPU_ACCESS_SETTINGS, ...overrides };
  const logs: string[] = [];
  const service = createLopuAccountingService({
    getThingsCollection: async () => things,
    getSettings: async () => settings,
    now: () => clock,
    newId: () => `id-${++ids}`,
    log: (message) => logs.push(message)
  });
  return { things, service, logs, settings, tick: (ms = 1000) => (clock = new Date(clock.getTime() + ms)), setClock: (date: Date) => (clock = date) };
};

const chatUsage = (requestId: string, hops = 1) => ({
  surface: 'chat' as const,
  billing: 'thingtime' as const,
  provider: 'test',
  model: 'test',
  pricingModel: LOPU_TEST_MODEL_ID,
  usage: { inputTokens: 100 * hops, outputTokens: 50 * hops },
  chatId: 'lopu-chat-1',
  requestId,
  toolCalls: 2,
  hops,
  durationMs: 1234
});

test('ensureLopuAccount creates one protected control row per user and grants the starter credits exactly once', async () => {
  const { things, service } = setup({ starterCredits: 2 });
  const first = await service.ensureLopuAccount('user-1');
  const again = await service.ensureLopuAccount('user-1');
  assert.equal(first.id, again.id);
  assert.equal(first.crystal.balanceMicros, 2_000_000);
  assert.equal(first.crystal.starterGranted, true);
  assert.equal(first.crystal.starterMicros, 2_000_000);
  assert.equal(first.crystal.monthKey, '2026-09');
  const accounts = things.ofKind(LOPU_ACCOUNT_THINGTIME);
  assert.equal(accounts.length, 1);
  const doc = accounts[0];
  assert.equal(doc.ownerId, 'user-1');
  assert.equal(doc.storageClass, 'control');
  assert.deepEqual(doc.acl, ['tt:user']);
  assert.equal(doc.targetId, null);
  assert.ok(doc.shareId.startsWith('lopu-account-'));
  assert.equal(doc.uniqueKeys.length, 1);
  assert.equal(Buffer.from(doc.uniqueKeys[0].buffer).toString('utf8'), 'lopuAccount:user-1');
  // exactly one starter ledger row, with the balance after
  const ledger = things.ofKind(LOPU_CREDIT_THINGTIME);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].crystal.entry, 'starter');
  assert.equal(ledger[0].crystal.amountMicros, 2_000_000);
  assert.equal(ledger[0].crystal.balanceAfterMicros, 2_000_000);
  assert.equal(ledger[0].crystal.actorId, 'system');
  assert.equal(ledger[0].ownerId, 'user-1');
  // starter credits of 0 write no ledger row but still mark the grant
  const { things: things0, service: service0 } = setup();
  const zero = await service0.ensureLopuAccount('user-2');
  assert.equal(zero.crystal.balanceMicros, 0);
  assert.equal(zero.crystal.starterGranted, true);
  assert.equal(things0.ofKind(LOPU_CREDIT_THINGTIME).length, 0);
  // a low starter balance is already flagged
  assert.equal(typeof zero.crystal.lowBalanceNotifiedAt, 'string');
  await assert.rejects(service0.ensureLopuAccount(''), TypeError);
});

test('debitLopuUsage prices the turn, writes the usage + ledger rows and moves the balance atomically', async () => {
  const { things, service } = setup({ starterCredits: 2 });
  const result = await service.debitLopuUsage('user-1', chatUsage('req-1', 3));
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  // 300 in × 1000 + 150 out × 2000 = 600,000 micros = 0.6 credits
  assert.equal(result.costMicros, 600_000);
  assert.equal(result.debitedMicros, 600_000);
  assert.equal(result.balanceMicros, 1_400_000);
  assert.equal(result.priced, true);
  assert.equal(result.estimated, false);
  assert.ok(result.usageId.startsWith('lopu-usage-'));

  const account = (await service.getLopuAccount('user-1'))!;
  assert.equal(account.crystal.balanceMicros, 1_400_000);
  assert.equal(account.crystal.lifetimeCostMicros, 600_000);
  assert.equal(account.crystal.lifetimeInputTokens, 300);
  assert.equal(account.crystal.lifetimeOutputTokens, 150);
  assert.equal(account.crystal.turns, 1);
  assert.equal(account.crystal.monthCostMicros, 600_000);
  assert.equal(account.crystal.monthTurns, 1);

  const usage = things.ofKind(LOPU_USAGE_THINGTIME);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].shareId, result.usageId);
  assert.equal(usage[0].ownerId, 'user-1');
  assert.equal(usage[0].storageClass, 'control');
  assert.deepEqual(usage[0].acl, ['tt:user']);
  assert.deepEqual(usage[0].crystal, {
    chatId: 'lopu-chat-1',
    requestId: 'req-1',
    surface: 'chat',
    provider: 'test',
    model: 'test',
    billing: 'thingtime',
    inputTokens: 300,
    outputTokens: 150,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicros: 600_000,
    priced: true,
    estimated: false,
    debitedMicros: 600_000,
    toolCalls: 2,
    hops: 3,
    durationMs: 1234
  });
  const debits = things.ofKind(LOPU_CREDIT_THINGTIME).filter((doc) => doc.crystal.entry === 'debit');
  assert.equal(debits.length, 1);
  assert.equal(debits[0].crystal.amountMicros, -600_000);
  assert.equal(debits[0].crystal.balanceAfterMicros, 1_400_000);
  assert.equal(debits[0].crystal.usageId, result.usageId);
  assert.equal(debits[0].crystal.actorId, 'user-1');
  assert.match(debits[0].crystal.reason, /Chat turn · test/);

  // A SECOND provider call is a second charge, even when the client re-used
  // its requestId (it can: deleting the chat drops the message that would
  // have 409'd it). The idempotency key is minted here, never taken from the
  // caller — otherwise a single requestId would buy unlimited free turns.
  const again = await service.debitLopuUsage('user-1', chatUsage('req-1', 3));
  assert.equal(again.ok, true);
  assert.notEqual((again as any).usageId, result.usageId);
  assert.equal((again as any).debitedMicros, 600_000);
  assert.equal((again as any).balanceMicros, 800_000);
  assert.equal(things.ofKind(LOPU_USAGE_THINGTIME).length, 2);
  assert.equal(things.ofKind(LOPU_CREDIT_THINGTIME).filter((doc) => doc.crystal.entry === 'debit').length, 2);
  // …and both rows still carry the requestId, as metadata
  assert.deepEqual(
    things.ofKind(LOPU_USAGE_THINGTIME).map((doc) => doc.crystal.requestId),
    ['req-1', 'req-1']
  );
});

test('a $inc that is retried after it already committed does not move the balance twice', async () => {
  const { things, service, logs } = setup({ starterCredits: 5 });
  await service.ensureLopuAccount('user-1');
  // the driver reports a failure AFTER the write landed — the classic
  // retryable-write hazard: the retry must be a no-op, not a second debit
  const original = things.findOneAndUpdate;
  let sabotage = true;
  things.findOneAndUpdate = async (filter, update, options) => {
    const applied = await original(filter, update, options);
    if (sabotage && update.$inc && 'crystal.balanceMicros' in (update.$inc as Record<string, number>)) {
      sabotage = false;
      throw new Error('socket closed after commit');
    }
    return applied;
  };
  const debit = await service.debitLopuUsage('user-1', chatUsage('req-1', 1));
  things.findOneAndUpdate = original;
  assert.equal(debit.ok, true);
  // one turn of 0.2 credits, not two
  assert.equal((debit as any).balanceMicros, 4_800_000);
  const account = (await service.getLopuAccount('user-1'))!;
  assert.equal(account.crystal.balanceMicros, 4_800_000);
  assert.equal(account.crystal.turns, 1);
  assert.ok(logs.some((line) => /retrying once/.test(line)));

  // the same guard on a grant: the retry cannot grant twice
  sabotage = true;
  things.findOneAndUpdate = async (filter, update, options) => {
    const applied = await original(filter, update, options);
    if (sabotage) {
      sabotage = false;
      throw new Error('socket closed after commit');
    }
    return applied;
  };
  const granted = await service.grantLopuCredits('user-1', { entry: 'grant', amountMicros: 1_000_000, reason: 'Bonus', actorId: 'admin-1' });
  things.findOneAndUpdate = original;
  assert.equal(granted.balanceMicros, 5_800_000);
  assert.equal((await service.getLopuAccount('user-1'))!.crystal.balanceMicros, 5_800_000);
  assert.equal(things.ofKind(LOPU_CREDIT_THINGTIME).filter((doc) => doc.crystal.entry === 'grant').length, 1);
});

test('a billed turn holds one of a bounded number of in-flight slots, and a dead request’s slot is swept', async () => {
  const { things, service, tick } = setup({ starterCredits: 5 });
  await service.ensureLopuAccount('user-1');
  await service.ensureLopuAccount('user-2');
  const held: Array<{ ok: true; release: () => Promise<void> }> = [];
  for (let index = 0; index < LOPU_MAX_CONCURRENT_TURNS; index++) {
    const slot = await service.reserveLopuTurn('user-1');
    assert.equal(slot.ok, true, `slot ${index} should be free`);
    if (slot.ok === true) held.push(slot);
  }
  // the cap: the next concurrent turn is refused rather than spending the
  // same balance one more time
  assert.deepEqual(await service.reserveLopuTurn('user-1'), { ok: false, reason: 'busy' });
  // another account is unaffected
  assert.equal((await service.reserveLopuTurn('user-2')).ok, true);

  // releasing hands the slot straight back, and is idempotent
  await held[0].release();
  await held[0].release();
  assert.equal((await service.reserveLopuTurn('user-1')).ok, true);
  assert.deepEqual(await service.reserveLopuTurn('user-1'), { ok: false, reason: 'busy' });

  // a request that died mid-turn never released: the next reservation after
  // the TTL sweeps the account clean instead of locking the user out
  tick(LOPU_INFLIGHT_TTL_MS + 60_000);
  assert.equal((await service.reserveLopuTurn('user-1')).ok, true);
  const account = things.ofKind(LOPU_ACCOUNT_THINGTIME).find((doc) => doc.ownerId === 'user-1');
  assert.equal(account.crystal.inflight, 1);
  // an account that does not exist can never take a slot (fail closed)
  assert.deepEqual(await service.reserveLopuTurn('nobody'), { ok: false, reason: 'busy' });
});

test('byo and free turns are recorded but never debited; unpriced models cost nothing', async () => {
  const { things, service } = setup();
  const byo = await service.debitLopuUsage('user-1', {
    surface: 'chat',
    billing: 'byo',
    provider: 'vault',
    providerLabel: 'My Claude',
    model: 'claude-sonnet-4-6',
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 },
    requestId: 'req-byo'
  });
  assert.equal(byo.ok, true);
  // priced for information (Sonnet 4.6: 3 + 15 + 0.3 per token classes) but not debited
  assert.equal((byo as any).costMicros, 1000 * 3 + 100 * 15 + 500 * 0.3);
  assert.equal((byo as any).debitedMicros, 0);
  assert.equal((byo as any).balanceMicros, 0);
  const free = await service.debitLopuUsage('user-1', { surface: 'chat', billing: 'free', provider: 'fallback', model: null, usage: { inputTokens: 0, outputTokens: 0 }, requestId: 'req-free' });
  assert.equal((free as any).costMicros, 0);
  assert.equal((free as any).priced, false);
  const custom = await service.debitLopuUsage('user-1', { surface: 'voice', billing: 'byo', provider: 'compatible', model: 'llama-3.3-70b', usage: { inputTokens: 50, outputTokens: 50 } });
  assert.equal((custom as any).priced, false);
  assert.equal((custom as any).costMicros, 0);
  const session = await service.debitLopuUsage('user-1', { surface: 'voice-session', billing: 'byo', provider: 'xai', model: 'grok-voice-latest', usage: null });
  assert.equal(session.ok, true);
  // every turn is a usage row and counts as a turn; the balance never moved
  assert.equal(things.ofKind(LOPU_USAGE_THINGTIME).length, 4);
  const account = (await service.getLopuAccount('user-1'))!;
  assert.equal(account.crystal.turns, 4);
  assert.equal(account.crystal.balanceMicros, 0);
  assert.equal(account.crystal.lifetimeCostMicros, 0);
  assert.equal(account.crystal.lifetimeInputTokens, 1050);
  assert.equal(things.ofKind(LOPU_CREDIT_THINGTIME).length, 0);
  const rows = things.ofKind(LOPU_USAGE_THINGTIME);
  assert.equal(rows[0].crystal.providerLabel, 'My Claude');
  assert.equal(rows[0].crystal.cacheReadTokens, 500);
  assert.equal(rows[3].crystal.surface, 'voice-session');
  assert.ok(rows[3].shareId.startsWith('lopu-usage-'));
});

test('the balance may go negative by one turn and the month counters roll over', async () => {
  const { service, tick, setClock } = setup({ starterCredits: 0.5 });
  await service.ensureLopuAccount('user-1');
  // 0.5 credits, a 0.6-credit turn: allowed to land, the balance dips below zero
  const debit = await service.debitLopuUsage('user-1', chatUsage('req-1', 3));
  assert.equal((debit as any).balanceMicros, -100_000);
  tick();
  // next month: the month counters restart, lifetime keeps counting
  setClock(new Date('2026-10-01T00:00:01.000Z'));
  const next = await service.debitLopuUsage('user-1', chatUsage('req-2', 1));
  assert.equal((next as any).balanceMicros, -300_000);
  const account = (await service.getLopuAccount('user-1'))!;
  assert.equal(account.crystal.monthKey, '2026-10');
  assert.equal(account.crystal.monthCostMicros, 200_000);
  assert.equal(account.crystal.monthTurns, 1);
  assert.equal(account.crystal.lifetimeCostMicros, 800_000);
  assert.equal(account.crystal.turns, 2);
  // the public shape reports the CURRENT month (a stale key reads as zero)
  const shown = publicLopuAccount({ record: account, userId: 'user-1', verified: true, settings: DEFAULT_LOPU_ACCESS_SETTINGS, topupUrl: null, now: new Date('2026-11-02T00:00:00.000Z') });
  assert.deepEqual(shown.month, { key: '2026-11', costMicros: 0, turns: 0 });
  assert.equal(shown.lifetime.costMicros, 800_000);
  assert.equal(shown.balanceMicros, -300_000);
  assert.equal(shown.balanceCredits, -0.3);
  assert.equal(shown.lowBalance, true);
  assert.equal(shown.starterGranted, true);
  assert.equal(monthKeyOf(new Date('2026-01-31T23:59:59.000Z')), '2026-01');
});

test('grants move the balance with a ledger row and clear the low-balance mark; junk amounts are refused', async () => {
  const { things, service } = setup();
  await assert.rejects(service.grantLopuCredits('user-1', { entry: 'grant', amountMicros: 0, reason: 'x', actorId: 'admin' }), TypeError);
  const granted = await service.grantLopuCredits('user-1', { entry: 'grant', amountMicros: 2_000_000, reason: 'Welcome', actorId: 'admin-1', note: 'hi' });
  assert.equal(granted.balanceMicros, 2_000_000);
  assert.equal(granted.account.crystal.lowBalanceNotifiedAt, null);
  const ledger = things.ofKind(LOPU_CREDIT_THINGTIME);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].shareId, granted.ledgerId);
  assert.deepEqual(ledger[0].crystal, { entry: 'grant', amountMicros: 2_000_000, balanceAfterMicros: 2_000_000, reason: 'Welcome', actorId: 'admin-1', note: 'hi' });
  // a negative adjust is a signed movement
  const adjusted = await service.grantLopuCredits('user-1', { entry: 'adjust', amountMicros: -1_500_000, reason: 'Correction', actorId: 'admin-1' });
  assert.equal(adjusted.balanceMicros, 500_000);
  // below the warning threshold now → the mark is set; a refund lifts it
  assert.equal(typeof adjusted.account.crystal.lowBalanceNotifiedAt, 'string');
  const refunded = await service.grantLopuCredits('user-1', { entry: 'refund', amountMicros: 1_000_000, reason: 'Oops', actorId: 'admin-1' });
  assert.equal(refunded.balanceMicros, 1_500_000);
  assert.equal(refunded.account.crystal.lowBalanceNotifiedAt, null);
  assert.equal(things.ofKind(LOPU_CREDIT_THINGTIME).length, 3);
});

test('top-up requests: one pending at a time, approve grants and links, decline grants nothing', async () => {
  const { things, service } = setup();
  const bad = await service.createLopuTopupRequest('user-1', { credits: 0.1 });
  assert.equal(bad.ok, false);
  assert.equal((bad as any).status, 400);
  assert.equal((await service.createLopuTopupRequest('user-1', { credits: 5000 })).ok, false);
  assert.equal((await service.createLopuTopupRequest('user-1', { credits: 5, note: 42 })).ok, false);
  assert.equal((await service.createLopuTopupRequest('user-1', { credits: 5, note: 'x'.repeat(501) })).ok, false);

  const created = await service.createLopuTopupRequest('user-1', { credits: '2.5', note: 'Building a site' });
  assert.equal(created.ok, true);
  const request = (created as any).request;
  assert.equal(request.entry, 'request');
  assert.equal(request.amountMicros, 2_500_000);
  assert.equal(request.amountCredits, 2.5);
  assert.equal(request.requestStatus, 'pending');
  assert.equal(request.note, 'Building a site');
  assert.equal(request.balanceAfterMicros, null);
  // the pending unique key is on the row and a second request collides with it
  const stored = things.docs.find((doc) => doc.shareId === request.id)!;
  assert.equal(Buffer.from(stored.uniqueKeys[0].buffer).toString('utf8'), 'lopuTopupPending:user-1');
  const second = await service.createLopuTopupRequest('user-1', { credits: 1 });
  assert.equal(second.ok, false);
  assert.equal((second as any).status, 409);
  assert.deepEqual(await service.getPendingLopuTopupRequest('user-1'), request);
  // another user's request is independent
  assert.equal((await service.createLopuTopupRequest('user-2', { credits: 1 })).ok, true);
  const pending = await service.pendingLopuTopupRequestsFor(['user-1', 'user-2', 'user-3']);
  assert.deepEqual([...pending.keys()].sort(), ['user-1', 'user-2']);

  // approve with the requested amount: the request flips, the pending key is
  // released, a 'topup' ledger row links back to it, the balance moves
  const approved = await service.resolveLopuTopupRequest({ requestId: request.id, actorId: 'admin-1', approve: true });
  assert.equal(approved.ok, true);
  if (approved.ok !== true) return;
  assert.equal(approved.userId, 'user-1');
  assert.equal(approved.balanceMicros, 2_500_000);
  assert.equal(approved.request.requestStatus, 'approved');
  assert.equal(approved.request.resolvedBy, 'admin-1');
  assert.equal(approved.request.grantedMicros, 2_500_000);
  assert.equal(approved.ledger!.entry, 'topup');
  assert.equal(approved.ledger!.amountMicros, 2_500_000);
  assert.equal(approved.ledger!.requestId, request.id);
  assert.equal(approved.ledger!.balanceAfterMicros, 2_500_000);
  // the key is REMOVED (never an empty array — the unique multikey index
  // would key that as undefined and collide across resolved requests)
  const resolvedDoc = things.docs.find((doc) => doc.shareId === request.id)!;
  assert.equal(Array.isArray(resolvedDoc.uniqueKeys) ? resolvedDoc.uniqueKeys.length : 0, 0);
  assert.equal(resolvedDoc.uniqueKeys === undefined || resolvedDoc.uniqueKeys.length === 0, true);
  assert.equal(await service.getPendingLopuTopupRequest('user-1'), null);
  // resolving twice is a 409; a fresh request is possible again
  assert.equal((await service.resolveLopuTopupRequest({ requestId: request.id, actorId: 'admin-1', approve: true }) as any).status, 409);
  const again = await service.createLopuTopupRequest('user-1', { credits: 1 });
  assert.equal(again.ok, true);
  // approve with an overriding amount
  const partial = await service.resolveLopuTopupRequest({ requestId: (again as any).request.id, actorId: 'admin-1', approve: true, credits: 0.75, reason: 'Half for now' });
  assert.equal((partial as any).balanceMicros, 3_250_000);
  assert.equal((partial as any).ledger.reason, 'Half for now');
  // decline: no balance change, status declined, key released
  const other = await service.getPendingLopuTopupRequest('user-2');
  const declined = await service.resolveLopuTopupRequest({ requestId: other!.id, actorId: 'admin-1', approve: false, reason: 'Not yet' });
  assert.equal(declined.ok, true);
  assert.equal((declined as any).request.requestStatus, 'declined');
  assert.equal((declined as any).ledger, null);
  assert.equal((declined as any).balanceMicros, 0);
  assert.equal(await service.getPendingLopuTopupRequest('user-2'), null);
  assert.equal((await service.resolveLopuTopupRequest({ requestId: 'nope', actorId: 'a', approve: true }) as any).status, 404);
  assert.equal((await service.resolveLopuTopupRequest({ requestId: '', actorId: 'a', approve: true }) as any).status, 400);
  assert.equal((await service.resolveLopuTopupRequest({ requestId: (again as any).request.id, actorId: 'a', approve: true, credits: 0 }) as any).status, 409);
});

test('an approval whose grant never landed is recoverable, and recovering it cannot grant twice', async () => {
  const { things, service } = setup();
  const request = (await service.createLopuTopupRequest('user-1', { credits: 3 })) as { ok: true; request: { id: string } };
  assert.equal(request.ok, true);

  // the status flip lands (a plain updateOne), the grant's $inc does not —
  // the request reads 'approved' with the balance untouched
  const original = things.findOneAndUpdate;
  things.findOneAndUpdate = async () => {
    throw new Error('died before the grant');
  };
  await assert.rejects(service.resolveLopuTopupRequest({ requestId: request.request.id, actorId: 'admin-1', approve: true }));
  things.findOneAndUpdate = original;
  const stranded = things.docs.find((doc) => doc.shareId === request.request.id)!;
  assert.equal(stranded.crystal.requestStatus, 'approved');
  assert.equal((await service.getLopuAccount('user-1'))!.crystal.balanceMicros, 0);
  assert.equal(things.ofKind(LOPU_CREDIT_THINGTIME).filter((doc) => doc.crystal.entry === 'topup').length, 0);

  // approving again finishes the job instead of refusing it with a 409
  const recovered = await service.resolveLopuTopupRequest({ requestId: request.request.id, actorId: 'admin-2', approve: true });
  assert.equal(recovered.ok, true);
  if (recovered.ok !== true) return;
  assert.equal(recovered.balanceMicros, 3_000_000);
  assert.equal(recovered.ledger!.entry, 'topup');
  assert.equal(recovered.ledger!.amountMicros, 3_000_000);
  assert.equal(recovered.request.requestStatus, 'approved');

  // …and once it has landed, a third approval is the ordinary 409 — the
  // deterministic ledger id makes a double grant impossible either way
  assert.equal((await service.resolveLopuTopupRequest({ requestId: request.request.id, actorId: 'admin-2', approve: true }) as any).status, 409);
  assert.equal((await service.getLopuAccount('user-1'))!.crystal.balanceMicros, 3_000_000);
  assert.equal(things.ofKind(LOPU_CREDIT_THINGTIME).filter((doc) => doc.crystal.entry === 'topup').length, 1);
  // a declined request is never "recovered"
  const declined = (await service.createLopuTopupRequest('user-2', { credits: 1 })) as { ok: true; request: { id: string } };
  await service.resolveLopuTopupRequest({ requestId: declined.request.id, actorId: 'admin-1', approve: false });
  assert.equal((await service.resolveLopuTopupRequest({ requestId: declined.request.id, actorId: 'admin-1', approve: true }) as any).status, 409);
  assert.equal((await service.getLopuAccount('user-2'))!.crystal.balanceMicros, 0);
});

test('history pages newest first with the usage rows the debits point at, and cursors round-trip', async () => {
  const { service, tick } = setup({ starterCredits: 5 });
  await service.ensureLopuAccount('user-1');
  for (let index = 1; index <= 4; index++) {
    tick();
    await service.debitLopuUsage('user-1', chatUsage(`req-${index}`, 1));
  }
  tick();
  await service.grantLopuCredits('user-1', { entry: 'grant', amountMicros: 1_000_000, reason: 'Bonus', actorId: 'admin-1' });
  // another user's rows never bleed in
  await service.debitLopuUsage('user-2', chatUsage('req-x', 1));

  const page1 = await service.listLopuAccountHistory('user-1', { limit: 3 });
  assert.equal(page1.ok, true);
  if (page1.ok !== true) return;
  assert.deepEqual(page1.entries.map((row) => row.entry), ['grant', 'debit', 'debit']);
  assert.deepEqual(page1.usage.map((row) => row.requestId), ['req-4', 'req-3']);
  assert.equal(page1.usage[0].costMicros, 200_000);
  assert.equal(page1.usage[0].costCredits, 0.2);
  assert.ok(page1.nextCursor);
  const page2 = await service.listLopuAccountHistory('user-1', { limit: 3, cursor: page1.nextCursor });
  assert.equal(page2.ok, true);
  if (page2.ok !== true) return;
  assert.deepEqual(page2.entries.map((row) => row.entry), ['debit', 'debit', 'starter']);
  assert.deepEqual(page2.usage.map((row) => row.requestId), ['req-2', 'req-1']);
  assert.equal(page2.nextCursor, null);
  assert.equal(page2.entries[2].balanceAfterMicros, 5_000_000);
  const bad = await service.listLopuAccountHistory('user-1', { cursor: 'not-a-cursor' });
  assert.equal(bad.ok, false);
  const capped = await service.listLopuAccountHistory('user-1', { limit: 5000 });
  assert.equal((capped as any).entries.length, 6);
  assert.equal(decodeLopuCursor(''), null);
  assert.equal(decodeLopuCursor(undefined), null);
  assert.equal(decodeLopuCursor('x'.repeat(401)), 'invalid');
  const cursor = encodeLopuCursor({ createdAt: new Date('2026-09-06T10:00:00.000Z'), shareId: 'lopu-credit-1' })!;
  assert.deepEqual(decodeLopuCursor(cursor), { createdAt: new Date('2026-09-06T10:00:00.000Z'), shareId: 'lopu-credit-1' });
  assert.equal(encodeLopuCursor({ createdAt: null, shareId: 'x' }), null);
});

test('the admin listing pages accounts newest first or resolves a set of users', async () => {
  const { service, tick } = setup();
  for (const user of ['a', 'b', 'c']) {
    tick();
    await service.ensureLopuAccount(user);
  }
  const page = await service.listLopuAccountsForAdmin({ limit: 2 });
  assert.equal(page.ok, true);
  if (page.ok !== true) return;
  assert.deepEqual(page.accounts.map((row) => row.userId), ['c', 'b']);
  assert.ok(page.nextCursor);
  const rest = await service.listLopuAccountsForAdmin({ limit: 2, cursor: page.nextCursor });
  assert.deepEqual((rest as any).accounts.map((row: any) => row.userId), ['a']);
  assert.equal((rest as any).nextCursor, null);
  const some = await service.listLopuAccountsForAdmin({ userIds: ['b', 'missing', 'b'] });
  assert.deepEqual((some as any).accounts.map((row: any) => row.userId), ['b']);
  assert.deepEqual(await service.listLopuAccountsForAdmin({ userIds: [] }), { ok: true, accounts: [], nextCursor: null });
  assert.equal((await service.listLopuAccountsForAdmin({ cursor: 'junk' })).ok, false);
});

test('a failure inside the debit is logged, retried once, and never thrown', async () => {
  const { things, service, logs } = setup({ starterCredits: 1 });
  await service.ensureLopuAccount('user-1');
  let failures = 1;
  const original = things.findOneAndUpdate;
  things.findOneAndUpdate = async (filter, update, options) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('transient');
    }
    return original(filter, update, options);
  };
  const retried = await service.debitLopuUsage('user-1', chatUsage('req-1', 1));
  assert.equal(retried.ok, true);
  assert.equal((retried as any).balanceMicros, 800_000);
  assert.ok(logs.some((line) => /retrying once/.test(line)));
  // two failures in a row: the turn is reported unrecorded, nothing throws
  failures = 2;
  const failed = await service.debitLopuUsage('user-1', chatUsage('req-2', 1));
  assert.equal(failed.ok, false);
  assert.ok(logs.some((line) => /usage was not recorded/.test(line)));
  // the usage row from the failed attempt exists but nothing was applied to
  // the balance, so the NEXT turn debits normally (the failed one is on the
  // house — logged, never charged twice)
  things.findOneAndUpdate = original;
  const next = await service.debitLopuUsage('user-1', chatUsage('req-3', 1));
  assert.equal((next as any).debitedMicros, 200_000);
  assert.equal((next as any).balanceMicros, 600_000);
});

test('public projections bound and default every field', () => {
  assert.equal(publicLopuCreditRow(null), null);
  assert.equal(publicLopuCreditRow({ shareId: 'x', crystal: { entry: 'bogus' } }), null);
  const row = publicLopuCreditRow({
    shareId: 'lopu-credit-1',
    createdAt: new Date('2026-09-06T00:00:00.000Z'),
    crystal: { entry: 'request', amountMicros: 1_000_000, balanceAfterMicros: 'no', reason: 'r'.repeat(400), actorId: 'u', requestStatus: 'pending', note: 'n', grantedMicros: 1.5 }
  })!;
  assert.equal(row.reason.length, 300);
  assert.equal(row.balanceAfterMicros, null);
  assert.equal(row.grantedMicros, null);
  assert.equal(row.amountCredits, 1);
  assert.equal(row.createdAt, '2026-09-06T00:00:00.000Z');
  assert.equal(row.updatedAt, null);
  const usage = publicLopuUsageRow({ shareId: 'lopu-usage-1', crystal: { surface: 'nope', billing: 'weird', inputTokens: -3, costMicros: 12 } })!;
  assert.equal(usage.surface, 'chat');
  assert.equal(usage.billing, 'free');
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.provider, 'unknown');
  assert.equal(usage.costCredits, 0.000012);
  assert.deepEqual(accountCrystalOf({ balanceMicros: -5, turns: 'x', monthKey: 'bad' }, new Date('2026-09-06T00:00:00.000Z')), {
    balanceMicros: -5,
    lifetimeCostMicros: 0,
    lifetimeInputTokens: 0,
    lifetimeOutputTokens: 0,
    turns: 0,
    monthKey: '2026-09',
    monthCostMicros: 0,
    monthTurns: 0,
    starterGranted: false,
    starterMicros: 0,
    lowBalanceNotifiedAt: null
  });
  // an account that does not exist yet still projects (zero balance, current month)
  const empty = publicLopuAccount({ record: null, userId: 'u', verified: false, settings: { ...DEFAULT_LOPU_ACCESS_SETTINGS, starterCredits: 1 }, topupUrl: 'https://pay.example/topup', now: new Date('2026-09-06T00:00:00.000Z') });
  assert.equal(empty.balanceMicros, 0);
  assert.equal(empty.lowBalance, true);
  assert.equal(empty.starterGranted, false);
  assert.equal(empty.starterCredits, 1);
  assert.equal(empty.topupUrl, 'https://pay.example/topup');
  assert.equal(empty.pendingRequest, null);
  assert.equal(empty.createdAt, null);
  assert.deepEqual(empty.month, { key: '2026-09', costMicros: 0, turns: 0 });
  assert.equal(empty.requireVerification, true);
  // the topup URL must be http(s); anything else reads as unset
  assert.equal(lopuTopupUrl({ THINGTIME_LOPU_TOPUP_URL: ' https://pay.example/lopu ' }), 'https://pay.example/lopu');
  assert.equal(lopuTopupUrl({ THINGTIME_LOPU_TOPUP_URL: ['javascript', 'alert(1)'].join(':') }), null);
  assert.equal(lopuTopupUrl({ THINGTIME_LOPU_TOPUP_URL: 'not a url' }), null);
  assert.equal(lopuTopupUrl({}), null);
  // unique keys are the server-owned BinData namespace
  assert.equal(Buffer.from(thingUniqueKey('lopuAccount', 'u').buffer).toString('utf8'), 'lopuAccount:u');
});

test('a gift exhausting the balance between the access read and turn reservation prevents provider work', async () => {
  const { things, service } = setup({ starterCredits: 1 });
  const before = await service.ensureLopuAccount('gift-owner');
  assert.equal(before.crystal.balanceMicros, 1_000_000);
  await things.updateOne({ ownerId: 'gift-owner', thingtime: LOPU_ACCOUNT_THINGTIME }, { $inc: { 'crystal.balanceMicros': -1_000_000 } });
  assert.deepEqual(await service.reserveLopuTurn('gift-owner'), { ok: false, reason: 'busy' });
});
