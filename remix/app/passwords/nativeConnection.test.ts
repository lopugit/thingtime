import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativePasswordConnectionController, nativeConnectionPresentation } from './nativeConnection';
import type { NativePasswordConnection, NativePasswordResult } from './native.client';

test('reopening reads the actual device and exposes only the matching action', async () => {
  let saved: NativePasswordConnection = 'disconnected';
  const calls: string[] = [];
  const provider = async (action: string) => {
    calls.push(action);
    if (action === 'connect') saved = 'connected';
    if (action === 'disconnect') saved = 'disconnected';
    return { ok: true, connection: saved };
  };
  const first = new NativePasswordConnectionController('fixture', provider);
  await first.refresh();
  assert.equal(nativeConnectionPresentation(first.getSnapshot()).label, 'Connect Password AutoFill');
  await first.activate();
  assert.equal(nativeConnectionPresentation(first.getSnapshot()).label, 'Disconnect AutoFill');
  first.dispose();
  const reopened = new NativePasswordConnectionController('fixture', provider);
  assert.equal(nativeConnectionPresentation(reopened.getSnapshot()).disabled, true);
  await reopened.refresh();
  assert.equal(nativeConnectionPresentation(reopened.getSnapshot()).label, 'Disconnect AutoFill');
  await reopened.activate();
  assert.equal(nativeConnectionPresentation(reopened.getSnapshot()).label, 'Connect Password AutoFill');
  assert.deepEqual(calls, ['status', 'connect', 'status', 'status', 'disconnect', 'status']);
});

test('unknown status permits only a read retry and never assumes disconnection', async () => {
  const calls: string[] = [];
  const controller = new NativePasswordConnectionController('fixture', async action => { calls.push(action); throw new Error('offline'); });
  await controller.refresh();
  assert.equal(nativeConnectionPresentation(controller.getSnapshot()).label, 'Retry AutoFill status');
  await controller.activate();
  assert.deepEqual(calls, ['status', 'status']);
  assert.equal(controller.getSnapshot().connection, 'unavailable');
  assert.equal(nativeConnectionPresentation(controller.getSnapshot(), false).disabled, true);
});

test('account/origin teardown fences pending results and a new scope starts checking', async () => {
  let complete!: (value: NativePasswordResult) => void;
  const previous = new NativePasswordConnectionController('old-owner', async () => new Promise(resolve => { complete = resolve; }));
  const pending = previous.refresh(); previous.dispose();
  const switched = new NativePasswordConnectionController('new-owner', async (_action, owner) => { assert.equal(owner, 'new-owner'); return { ok: true, connection: 'differentSession' }; });
  assert.equal(switched.getSnapshot().connection, 'checking');
  await switched.refresh(); complete({ ok: true, connection: 'connected' }); await pending;
  assert.equal(previous.getSnapshot().connection, 'checking');
  assert.equal(switched.getSnapshot().connection, 'differentSession');
  assert.equal(nativeConnectionPresentation(switched.getSnapshot()).label, 'Connect Password AutoFill');
});

test('newer status read wins and failed disconnect still reads the remaining device connection', async () => {
  const replies: ((value: NativePasswordResult) => void)[] = [];
  const controller = new NativePasswordConnectionController('fixture', async () => new Promise(resolve => replies.push(resolve)));
  const old = controller.refresh(), current = controller.refresh();
  replies[1]({ ok: true, connection: 'connected' }); await current;
  replies[0]({ ok: true, connection: 'disconnected' }); await old;
  assert.equal(controller.getSnapshot().connection, 'connected');
  const failed = new NativePasswordConnectionController('fixture', async action => { if (action === 'disconnect') throw new Error('locked'); return { ok: true, connection: 'connected' }; });
  await failed.refresh(); await failed.activate();
  assert.equal(failed.getSnapshot().connection, 'connected');
  assert.match(failed.getSnapshot().notice, /could not be updated/);
});


test('a local account has a precise non-mutating HTTPS recovery state', async () => {
  const calls: string[] = [];
  const controller = new NativePasswordConnectionController('local-fixture', async action => { calls.push(action); return { ok: true, connection: 'unsupportedOrigin' }; });
  await controller.refresh();
  const presentation = nativeConnectionPresentation(controller.getSnapshot());
  assert.equal(presentation.label, 'HTTPS account required');
  assert.equal(presentation.disabled, true);
  assert.match(presentation.status, /Thingtime → API Endpoint → Production/);
  await controller.activate();
  assert.deepEqual(calls, ['status']);
});
