import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';
import { LocalLopuInstructions, type InstructionTransport } from './lopuInstructions';
import { syncLopuInstructionPass } from './lopuInstructionSync';
import { createSyncPump } from './syncPump';

const scope: WorkspaceScope = { kind: 'account', ownerId: 'fixture', origin: 'https://instructions.test', dataPlane: 'home' };
const snapshot = { base: { basePrompt: 'Public base', revision: null }, personal: { revision: 'server-one', instructions: [{ id: 'first', text: 'Retained account guidance', enabled: true }] } };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };

test('initial read failure recovers through the scheduled worker without an edit or focus event', async t => {
 const db = new WorkspaceDatabase(new IDBFactory()), service = new LocalLopuInstructions(db, scope, lease);
 t.mock.timers.enable({ apis: ['setTimeout'] });
 let reads = 0, writes = 0, changes = 0, passes = 0;
 const transport: InstructionTransport = { read: async () => { if (++reads === 1) throw Error('Temporary outage'); return structuredClone(snapshot); }, write: async () => { writes++; throw Error('No write expected'); } };
 const pump = createSyncPump(() => true, async () => { const delay = await syncLopuInstructionPass(service, transport, new AbortController().signal, () => { changes++; }); passes++; return delay; });
 const finished = async (count: number) => { for (let i = 0; i < 100 && passes < count; i++) await new Promise<void>(r => setImmediate(r)); assert.equal(passes, count); };
 try {
  pump.wake(); t.mock.timers.tick(0); await finished(1);
  const failed = await service.read(); assert.ok(failed.error); assert.equal(failed.pending, undefined); assert.deepEqual(failed.personal.instructions, []);
  t.mock.timers.tick(60_000); t.mock.timers.tick(0); await finished(2);
  assert.deepEqual((await service.read()).personal.instructions, snapshot.personal.instructions);
  assert.equal((await service.read()).error, undefined); assert.equal(reads, 2); assert.equal(writes, 0); assert.equal(changes, 2);
  t.mock.timers.tick(120_000); await new Promise<void>(r => setImmediate(r)); assert.equal(reads, 2, 'successful idle worker stops polling');
 } finally { pump.stop(); t.mock.timers.reset(); await db.close(); }
});

test('a different tab holding the initial claim retains a retry without duplicate IO', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), first = new LocalLopuInstructions(db, scope, lease), second = new LocalLopuInstructions(db, scope, lease);
 let entered!: () => void, release!: () => void, reads = 0;
 const started = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
 const transport: InstructionTransport = { read: async () => { reads++; entered(); await held; return structuredClone(snapshot); }, write: async () => { throw Error('No write expected'); } };
 try {
  const running = syncLopuInstructionPass(first, transport, new AbortController().signal, () => {}); await started;
  assert.equal(await syncLopuInstructionPass(second, transport, new AbortController().signal, () => {}), 60_000); assert.equal(reads, 1);
  release(); assert.equal(await running, null); assert.deepEqual((await second.read()).personal.instructions, snapshot.personal.instructions);
 } finally { release?.(); await db.close(); }
});

test('anonymous and explicit-conflict workers do not schedule remote retries', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), anonymous = new LocalLopuInstructions(db, { kind: 'anonymous' }, lease), account = new LocalLopuInstructions(db, scope, lease);
 let reads = 0;
 const transport: InstructionTransport = { read: async () => { reads++; return structuredClone(snapshot); }, write: async () => { throw Error('No write expected'); } };
 try {
  assert.equal(await syncLopuInstructionPass(anonymous, transport, new AbortController().signal, () => {}), null); assert.equal(reads, 0);
  await account.save({ revision: null, instructions: [{ id: 'local', text: 'Device guidance', enabled: true }] });
  assert.equal(await syncLopuInstructionPass(account, transport, new AbortController().signal, () => {}), null);
  assert.ok((await account.read()).conflict); assert.equal(reads, 1);
  assert.equal(await syncLopuInstructionPass(account, transport, new AbortController().signal, () => {}), null); assert.equal(reads, 1);
 } finally { await db.close(); }
});
