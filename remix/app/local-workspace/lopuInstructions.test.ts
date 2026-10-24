import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalLopuInstructions, type InstructionTransport } from './lopuInstructions';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';

const account: WorkspaceScope = { kind: 'account', origin: 'https://instructions.test', ownerId: 'alice', dataPlane: 'selected' };
const rows = (text: string) => [{ id: 'style', text, enabled: true }, { id: 'disabled', text: 'Kept but disabled', enabled: false }];
const signal = () => new AbortController().signal;
function fixture(scope: WorkspaceScope = account, factory = new IDBFactory()) {
 const db = new WorkspaceDatabase(factory); let active = true;
 const lease = { assertCurrent() { if (!active) throw new Error('Retired'); }, onInvalidate: () => () => {} };
 return { db, lease, service: new LocalLopuInstructions(db, scope, lease), retire: () => { active = false; }, close: () => db.close() };
}
function server(instructions = rows('Account preference')) {
 let personal = { revision: 'r1', instructions }, reads = 0, writes = 0;
 const transport: InstructionTransport = {
  read: async () => { reads++; return { base: { revision: 'b1', basePrompt: 'Public prompt' }, personal: structuredClone(personal) }; },
  write: async value => { writes++; if (value.revision !== personal.revision) throw Object.assign(Error('Conflict'), { status: 409 }); personal = { revision: `r${writes + 1}`, instructions: structuredClone(value.instructions) }; return structuredClone(personal); }
 };
 return { transport, change(text: string) { personal = { revision: crypto.randomUUID(), instructions: rows(text) }; }, get personal() { return personal; }, get reads() { return reads; }, get writes() { return writes; } };
}
test('anonymous instructions survive reopen, retain disabled rows, and never call account transport', async () => {
 const factory = new IDBFactory(), f = fixture({ kind: 'anonymous' }, factory), remote = server();
 const many = Array.from({ length: 45 }, (_, i) => ({ id: `row-${i}`, text: 'x'.repeat(2100), enabled: i % 2 === 0 }));
 const saved = await f.service.save({ revision: null, instructions: many });
 await f.service.sync(remote.transport, signal());
 assert.equal(remote.reads + remote.writes, 0); assert.equal(saved.pending, undefined);
 await f.close(); const reopened = fixture({ kind: 'anonymous' }, factory);
 assert.deepEqual((await reopened.service.read()).personal.instructions, many); await reopened.close();
});
test('home-pinned settings do not cross account, origin or anonymous boundaries', async () => {
 const f = fixture();
 try {
  await f.service.save({ revision: null, instructions: rows('Private Alice') });
  const scoped = (scope: WorkspaceScope) => new LocalLopuInstructions(f.db, scope, f.lease);
  assert.equal((await scoped({ ...account, dataPlane: 'another' } as WorkspaceScope).read()).personal.instructions[0].text, 'Private Alice');
  for (const scope of [{ kind: 'anonymous' }, { ...account, ownerId: 'bob' }, { ...account, origin: 'https://another.test' }] as WorkspaceScope[])
   assert.deepEqual((await scoped(scope).read()).personal.instructions, []);
 } finally { await f.close(); }
});
test('offline first edit is kept and requires review before replacing unseen account settings', async () => {
 const f = fixture(), remote = server();
 try {
  const local = await f.service.save({ revision: null, instructions: rows('Device') });
  await f.service.sync(remote.transport, signal());
  const conflict = await f.service.read(); assert.ok(conflict.conflict); assert.equal(remote.writes, 0);
  await assert.rejects(f.service.resolve('stale', conflict.conflict.revision, 'device'), /changed/);
  await f.service.resolve(local.personal.revision, conflict.conflict.revision, 'device');
  await f.service.sync(remote.transport, signal());
  assert.equal(remote.personal.instructions[0].text, 'Device'); assert.equal((await f.service.read()).pending, false);
 } finally { await f.close(); }
});
test('a held or failed network save never blocks a newer local save; lost reply reconciles without duplicate write', async () => {
 const f = fixture(), remote = server();
 try {
  await f.service.sync(remote.transport, signal());
  let local = await f.service.read();
  local = await f.service.save({ revision: local.personal.revision, instructions: rows('First') });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
  const failed: InstructionTransport = { ...remote.transport, write: async (value, sig) => { await remote.transport.write(value, sig); entered(); await held; throw Error('Lost reply'); } };
  const running = f.service.sync(failed, signal()); await started;
  await f.service.save({ revision: local.personal.revision, instructions: rows('Second') }); release(); await running;
  assert.equal((await f.service.read()).personal.instructions[0].text, 'Second');
  await f.service.sync(remote.transport, signal());
  assert.equal(remote.writes, 1); assert.equal((await f.service.read()).pending, true);
  await f.service.sync(remote.transport, signal());
  assert.equal(remote.writes, 2); assert.equal(remote.personal.instructions[0].text, 'Second'); assert.equal((await f.service.read()).pending, false);
 } finally { await f.close(); }
});
test('cross-tab stale edits and stale conflict choices cannot replace newer device instructions', async () => {
 const f = fixture(), other = new LocalLopuInstructions(f.db, account, f.lease), remote = server();
 try {
  const initial = await f.service.read();
  let local = await f.service.save({ revision: initial.personal.revision, instructions: rows('One') });
  await assert.rejects(other.save({ revision: initial.personal.revision, instructions: rows('Stale') }), /another tab/);
  await f.service.sync(remote.transport, signal()); const conflict = (await f.service.read()).conflict!;
  await other.save({ revision: local.personal.revision, instructions: rows('Newer') });
  await assert.rejects(f.service.resolve(local.personal.revision, conflict.revision, 'account'), /changed/);
  local = await f.service.read(); await f.service.resolve(local.personal.revision, conflict.revision, 'account');
  assert.deepEqual((await other.read()).personal.instructions, remote.personal.instructions);
 } finally { await f.close(); }
});
test('concurrent sync workers use one durable claim and never duplicate writes', async () => {
 const f = fixture(), remote = server([]), other = new LocalLopuInstructions(f.db, account, f.lease);
 try {
  await f.service.save({ revision: null, instructions: rows('One') });
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const transport = { ...remote.transport, read: async (s: AbortSignal) => { entered(); await held; return remote.transport.read(s); } };
  const run = f.service.sync(transport, signal()); await started;
  await other.sync(remote.transport, signal()); assert.equal(remote.reads, 0); release(); await run;
  assert.equal(remote.writes, 1); assert.equal((await f.service.read()).pending, false);
 } finally { await f.close(); }
});
test('identity changes during account IO discard completion and cannot modify another workspace', async () => {
 const f = fixture(), remote = server();
 try {
  await assert.rejects(f.service.sync({ ...remote.transport, read: async s => { const value = await remote.transport.read(s); f.retire(); return value; } }, signal()), /Retired/);
  assert.equal(remote.writes, 0);
  const another = new LocalLopuInstructions(f.db, { ...account, ownerId: 'bob' } as WorkspaceScope, { assertCurrent() {}, onInvalidate: () => () => {} });
  assert.deepEqual((await another.read()).personal.instructions, []);
 } finally { await f.close(); }
});
test('invalid instruction input cannot replace saved content', async () => {
 const f = fixture({ kind: 'anonymous' });
 try {
  const saved = await f.service.save({ revision: null, instructions: rows('Kept') });
  await assert.rejects(async () => f.service.save({ revision: saved.personal.revision, instructions: [{ id: 'x', text: '', enabled: true }] }), /needs text/);
  assert.deepEqual((await f.service.read()).personal, saved.personal);
 } finally { await f.close(); }
});
