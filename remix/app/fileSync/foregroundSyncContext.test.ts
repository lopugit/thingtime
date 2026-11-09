import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundSyncContext, SyncConditionsWait } from './foregroundSyncContext';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import type { ForegroundSyncInput } from './foregroundSync';

test('composite authorization retains every configuration/device/conditions boundary without legacy RPCs', async () => {
 const f = await foregroundFixture(), input: ForegroundSyncInput = f.input();
 let calls = 0, network = 'wifi', revoked = false;
 input.authorizeDevice = input.conditions = async () => { throw Error('redundant legacy request'); };
 input.authorizeContext = async () => { calls++; if (revoked) throw Error('Device revoked'); return { network: network as 'wifi', charging: true }; };
 const context = foregroundSyncContext(saved, scope, input, new AbortController().signal);
 await context.authorize(); assert.equal(calls, 1);
 network = 'offline'; await assert.rejects(context.authorize(), cause => cause instanceof SyncConditionsWait && cause.reason === 'wifi'); assert.equal(calls, 2);
 network = 'wifi'; revoked = true; await assert.rejects(context.authorize(), /revoked/);
 f.change(); await assert.rejects(context.authorize());
 f.journal().close();
});

test('only explicitly lazy native source construction omits the redundant IO authorization and still fences abort/scope', async () => {
 const f = await foregroundFixture(), input: ForegroundSyncInput = f.input();
 let authorized = 0, opened = 0;
 input.authorizeContext = async () => { authorized++; return { network: 'wifi', charging: true }; };
 input.source = async () => { opened++; return { size: 0, check: () => {}, read: async () => new Uint8Array() }; };
 const controller = new AbortController();
 let context = foregroundSyncContext(saved, scope, input, controller.signal);
 await context.openSource(f.local[0]); assert.deepEqual({ authorized, opened }, { authorized: 1, opened: 1 });
 input.nativeOperationGuards = true; context = foregroundSyncContext(saved, scope, input, controller.signal);
 await context.openSource(f.local[0]); assert.deepEqual({ authorized, opened }, { authorized: 1, opened: 2 });
 input.currentScope = () => ({ ...scope, ownerId: 'other' });
 await assert.rejects(context.openSource(f.local[0]), /context changed/); assert.equal(opened, 2);
 controller.abort(); await assert.rejects(context.openSource(f.local[0])); assert.equal(opened, 2);
 f.journal().close();
});

test('custom mutation authorization never receives the compound native approval', async () => {
 const f = await foregroundFixture(), input: ForegroundSyncInput = f.input();
 assert.ok(foregroundSyncContext(saved, scope, input, new AbortController().signal).runtime.nativeUploadApproval);
 input.runtime.authorizeMutation = async () => {};
 assert.equal(foregroundSyncContext(saved, scope, input, new AbortController().signal).runtime.nativeUploadApproval, undefined);
 f.journal().close();
});


test('compound observation checks saved settings before IO and fences reply identity and cancellation', async () => {
 const f = await foregroundFixture(), input: ForegroundSyncInput = f.input(), controller = new AbortController();
 let observations = 0, wrong = false, cancel = false;
 input.authorizeContext = async () => { throw Error('separate context'); };
 input.observeLocal = async path => {
  observations++; if (cancel) controller.abort();
  return { conditions: { network: 'wifi', charging: true }, entries: [{ ...f.local[0], path: wrong ? 'other' : path }] };
 };
 const context = foregroundSyncContext(saved, scope, input, controller.signal);
 assert.deepEqual(await context.observeLocal!('Documents', ''), f.local);
 wrong = true; await assert.rejects(context.observeLocal!('Documents', ''), /observation changed/); wrong = false;
 f.change(); await assert.rejects(context.observeLocal!('Documents', ''), /configuration|approval/); assert.equal(observations, 2);
 f.journal().close();
 const next = await foregroundFixture(), nextInput: ForegroundSyncInput = next.input();
 nextInput.observeLocal = input.observeLocal; cancel = true;
 await assert.rejects(foregroundSyncContext(saved, scope, nextInput, controller.signal).observeLocal!('Documents', ''));
 next.journal().close();
});

test('compound observations reject parent mismatch, incomplete reply and offline conditions', async () => {
 const f = await foregroundFixture(), input: ForegroundSyncInput = f.input();
 input.observeLocal = async () => ({ conditions: { network: 'wifi', charging: true }, entries: [null] });
 const context = foregroundSyncContext(saved, scope, input, new AbortController().signal);
 await assert.rejects(context.observeLocal!('Documents/child', 'other'), /Invalid observation/);
 await assert.rejects(context.observeLocal!('Documents/child', 'Documents'), /observation changed/);
 input.observeLocal = async () => ({ conditions: { network: 'offline', charging: true }, entries: [null] });
 await assert.rejects(context.observeLocal!('Documents', ''), cause => cause instanceof SyncConditionsWait && cause.reason === 'wifi');
 f.journal().close();
});
