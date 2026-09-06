import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { LOPU_CONFIRM_TTL_MS, MAX_LOPU_CONFIRMATIONS_PER_REPLY, mintLopuConfirmation, parseLopuConfirmations, verifyLopuConfirmation } from './confirmations.ts';

// Grants (design note §2.4) are purpose JWTs on the auth key material: with no
// JWT env the signer falls back to the local-dev secret (a warning, not an
// error), which is exactly what a dev stack does.

const action = { key: 'delete_thing:thing-1', tool: 'delete_thing' as const, summary: 'Delete "Landing" (thing thing-1)', subject: { id: 'thing-1' } };

test('a grant round-trips only for the same user, chat and action key', async () => {
  const before = Date.now();
  const grant = await mintLopuConfirmation({ userId: 'user-1', chatId: 'lopu-chat-1', action });
  assert.equal(typeof grant.token, 'string');
  assert.ok(grant.token.split('.').length === 3, 'a compact JWT');
  const expiresAt = Date.parse(grant.expiresAt);
  assert.ok(expiresAt >= before + LOPU_CONFIRM_TTL_MS - 1000 && expiresAt <= Date.now() + LOPU_CONFIRM_TTL_MS + 1000);

  const approved = await verifyLopuConfirmation(grant.token, { userId: 'user-1', chatId: 'lopu-chat-1', key: action.key });
  assert.deepEqual(approved, { key: action.key, tool: 'delete_thing', summary: action.summary });

  assert.equal(await verifyLopuConfirmation(grant.token, { userId: 'user-2', chatId: 'lopu-chat-1', key: action.key }), null, 'another user');
  assert.equal(await verifyLopuConfirmation(grant.token, { userId: 'user-1', chatId: 'lopu-chat-2', key: action.key }), null, 'another chat');
  assert.equal(await verifyLopuConfirmation(grant.token, { userId: 'user-1', chatId: 'lopu-chat-1', key: 'delete_thing:thing-2' }), null, 'another action');
  assert.equal(await verifyLopuConfirmation('forged.token.value', { userId: 'user-1', chatId: 'lopu-chat-1', key: action.key }), null, 'garbage');
  assert.equal(await verifyLopuConfirmation('', { userId: 'user-1', chatId: 'lopu-chat-1', key: action.key }), null, 'empty');
  assert.equal(await verifyLopuConfirmation(`${grant.token}x`, { userId: 'user-1', chatId: 'lopu-chat-1', key: action.key }), null, 'tampered signature');
});

test('the reply body’s confirmations are shape-checked, deduplicated and capped', () => {
  assert.deepEqual(parseLopuConfirmations(undefined), { ok: true, confirmations: [] });
  assert.deepEqual(parseLopuConfirmations(null), { ok: true, confirmations: [] });
  assert.deepEqual(parseLopuConfirmations([{ key: ' a ', token: ' t ' }, { key: 'a', token: 't2' }]), { ok: true, confirmations: [{ key: 'a', token: 't' }] });
  assert.equal(parseLopuConfirmations('nope').ok, false);
  assert.equal(parseLopuConfirmations([{ key: 'a' }]).ok, false);
  assert.equal(parseLopuConfirmations([{ key: '', token: 't' }]).ok, false);
  assert.equal(parseLopuConfirmations([{ key: 'x'.repeat(301), token: 't' }]).ok, false);
  const tooMany = Array.from({ length: MAX_LOPU_CONFIRMATIONS_PER_REPLY + 1 }, (_, index) => ({ key: `k${index}`, token: 't' }));
  assert.equal(parseLopuConfirmations(tooMany).ok, false);
});
