import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundSyncContext } from './foregroundSyncContext';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import type { ForegroundSyncInput } from './foregroundSync';

test('composite authorization retains every configuration/device/conditions boundary without legacy RPCs', async () => {
 const f = await foregroundFixture(), input: ForegroundSyncInput = f.input();
 let calls = 0, network = 'wifi', revoked = false;
 input.authorizeDevice = input.conditions = async () => { throw Error('redundant legacy request'); };
 input.authorizeContext = async () => { calls++; if (revoked) throw Error('Device revoked'); return { network: network as 'wifi', charging: true }; };
 const context = foregroundSyncContext(saved, scope, input, new AbortController().signal);
 await context.authorize(); assert.equal(calls, 1);
 network = 'offline'; await assert.rejects(context.authorize(), /internet|network/); assert.equal(calls, 2);
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
