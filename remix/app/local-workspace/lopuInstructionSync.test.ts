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

test('oversized revisions survive reopen without timer retries and an edited revision resumes sync', async t => {
 const db = new WorkspaceDatabase(new IDBFactory()), service = new LocalLopuInstructions(db, scope, lease);
 let reads = 0, writes = 0, passes = 0;
 let personal = { revision: 'initial', instructions: [] as { id: string; text: string; enabled: boolean }[] };
 const transport: InstructionTransport = { read: async () => { reads++; return { ...snapshot, personal: structuredClone(personal) }; }, write: async value => {
  writes++; personal = { revision: 'saved', instructions: value.instructions }; return structuredClone(personal);
 } };
 const instructions = [{ id: 'large', text: '🌟'.repeat(30_000), enabled: true }];
 await service.save({ revision: null, instructions });
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const pump = createSyncPump(() => true, async () => { const next = await syncLopuInstructionPass(service, transport, new AbortController().signal, () => {}); passes++; return next; });
 const finished = async (count: number) => { for (let i = 0; i < 100 && passes < count; i++) await new Promise<void>(r => setImmediate(r)); assert.equal(passes, count); };
 try {
  pump.wake(); t.mock.timers.tick(0); await finished(1);
  const blocked = await service.read();
  assert.deepEqual(blocked.personal.instructions, instructions); assert.equal(blocked.blocked?.revision, blocked.personal.revision);
  assert.match(blocked.error!, /saved on this device.*96 KiB.*Shorten/); assert.equal(blocked.attempt, undefined);
  assert.equal(writes, 0); assert.equal(reads, 1);
  t.mock.timers.tick(180_000); await new Promise<void>(r => setImmediate(r)); assert.equal(passes, 1, 'no guaranteed-failure retry timer');
  await db.close();
  const reopened = new LocalLopuInstructions(db, scope, lease);
  assert.deepEqual(await reopened.read(), blocked);
  assert.equal(await syncLopuInstructionPass(reopened, transport, new AbortController().signal, () => {}), null);
  assert.equal(reads, 1, 'a persisted block also suppresses focus/reopen requests');
  await assert.rejects(reopened.save({ revision: 'stale', instructions: [{ id: 'small', text: 'Stale edit', enabled: true }] }), /another tab/);
  assert.deepEqual((await reopened.read()).blocked, blocked.blocked, 'stale edits cannot clear the current block');
  await reopened.save({ revision: blocked.personal.revision, instructions: [{ id: 'small', text: 'Fits', enabled: true }] });
  assert.equal((await reopened.read()).blocked, undefined);
  pump.wake(); t.mock.timers.tick(0); await finished(2);
  assert.equal(writes, 1); assert.equal((await reopened.read()).pending, false); assert.equal((await reopened.read()).error, undefined);
 } finally { pump.stop(); t.mock.timers.reset(); await db.close(); }
});

test('acknowledging a lost reply resumes a newer device edit at normal transfer cadence', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), service = new LocalLopuInstructions(db, scope, lease), signal = new AbortController().signal;
 let personal = { revision: 'initial', instructions: [] as { id: string; text: string; enabled: boolean }[] }, writes = 0, entered!: () => void, release!: () => void;
 const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
 const transport: InstructionTransport = { read: async () => ({ ...snapshot, personal: structuredClone(personal) }), write: async value => { writes++; personal = { revision: 'receipt-' + writes, instructions: value.instructions }; return structuredClone(personal); } };
 try {
  await service.sync(transport, signal);
  const first = await service.save({ revision: (await service.read()).personal.revision, instructions: [{ id: 'one', text: 'First edit', enabled: true }] });
  const uncertain: InstructionTransport = { ...transport, write: async (value, signal) => { await transport.write(value, signal); entered(); await held; throw Error('Lost committed reply'); } };
  const running = syncLopuInstructionPass(service, uncertain, signal, () => {}); await started;
  const newer = await service.save({ revision: first.personal.revision, instructions: [{ id: 'one', text: 'Newer edit', enabled: true }] });
  release(); assert.equal(await running, 60_000);
  const delay = await syncLopuInstructionPass(service, transport, signal, () => {});
  assert.ok(delay !== null && delay >= 14_990 && delay <= 15_000);
  const ready = await service.read(); assert.equal(ready.attempt, undefined); assert.equal(ready.error, undefined); assert.equal(ready.pending, true); assert.deepEqual(ready.personal, newer.personal); assert.equal(writes, 1);
  assert.equal(await syncLopuInstructionPass(service, transport, signal, () => {}), null); assert.equal(writes, 2); assert.equal(personal.instructions[0].text, 'Newer edit');
 } finally { release?.(); await db.close(); }
});
