import assert from 'node:assert/strict';
import test from 'node:test';
import { bindTransferIdentity, createTransferIntent } from './intent';
import { createRootIdentityState } from '../rootIdentity';

test('cut survives page remount without trusting clipboard text as move authority', () => {
  const session = createTransferIntent(); session.account('a');
  const ids = ['one', 'two'];
  assert.equal(session.record(session.ticket('a'), 'digest', ids), true);
  ids.push('injected');
  // New page consumers read the same tab-memory intent, never a persisted flag.
  assert.deepEqual(session.peek('a')?.ids, ['one', 'two']);
  assert.deepEqual(session.match('a', 'digest')?.ids, ['one', 'two']);
  assert.equal(session.match('a', 'other'), null);
  assert.equal(session.match('b', 'digest'), null);
  assert.equal(createTransferIntent().match('a', 'digest'), null);
});

test('logout/account switches revoke saved cuts and stale async copy completions', () => {
  const session = createTransferIntent(); session.account('a');
  const ticket = session.ticket('a'); session.record(ticket, 'digest', ['one']);
  session.account(undefined); session.account('a');
  assert.equal(session.peek('a'), null);
  assert.equal(session.record(ticket, 'digest', ['one']), false);
  session.account('b'); assert.equal(session.ticket('a'), null);
});

test('partial moves retain failed ids without consuming newer clipboard intent', () => {
  const session = createTransferIntent(); session.account('a');
  session.record(session.ticket('a'), 'digest', ['one', 'two']);
  const old = session.match('a', 'digest')!;
  session.settle(old, ['one']); assert.deepEqual(session.peek('a')?.ids, ['two']);
  session.record(session.ticket('a'), 'new', ['three']);
  session.settle(old, ['two']); assert.deepEqual(session.peek('a')?.ids, ['three']);
  const ticket = session.ticket('a'); session.clear();
  assert.equal(session.record(ticket, 'new', ['three']), false);
  assert.equal(session.peek('a'), null);
});

test('identity refresh revokes cuts before root data arrives and cannot re-arm an old snapshot', () => {
  const identity = createRootIdentityState(); const intent = createTransferIntent();
  const unbind = bindTransferIdentity(identity, 'old-owner', 0, intent);
  const ticket = intent.ticket('old-owner');
  assert.equal(intent.record(ticket, 'digest', ['thing']), true);
  identity.changed();
  assert.equal(intent.peek('old-owner'), null); assert.equal(intent.ticket('old-owner'), null);
  assert.equal(intent.record(ticket, 'late-result', ['thing']), false);
  identity.confirm(0); assert.equal(intent.ticket('old-owner'), null);
  identity.confirm(1); assert.equal(intent.ticket('old-owner'), null);
  unbind();
  const unbindNext = bindTransferIdentity(identity, 'new-owner', 1, intent);
  assert.ok(intent.ticket('new-owner')); assert.equal(intent.ticket('old-owner'), null);
  unbindNext(); assert.equal(intent.ticket('new-owner'), null);
});

test('binding a stale account during a pending identity refresh never grants cut authority', () => {
  const identity = createRootIdentityState(); const intent = createTransferIntent(); identity.changed();
  const unbind = bindTransferIdentity(identity, 'old-owner', 0, intent);
  assert.equal(intent.ticket('old-owner'), null);
  identity.confirm(1); assert.equal(intent.ticket('old-owner'), null); unbind();
});
