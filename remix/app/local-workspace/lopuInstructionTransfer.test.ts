import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalLopuInstructions, InstructionTransferRetired, instructionSettings, type InstructionTransport } from './lopuInstructions';
import { readInstructionSnapshot, writeInstructionTransfer } from './lopuInstructionTransfer.client';
import type { InstructionPart } from '../lopu/instructionTransfer';
const scope = { kind: 'account', ownerId: 'alice', origin: 'https://instructions-transfer.test', dataPlane: 'home' } as const;
const base = { revision: 'base', basePrompt: 'Public base' };
const large = [{ id: 'large', enabled: true, text: '🌟漢"\\\n'.repeat(55_000) + 'Exact end' }, { id: 'off', enabled: false, text: 'Disabled preference' }];
function wire() {
 let state: any, reference: any, losePart = false, loseCommit = false;
 const parts: InstructionPart[] = [], calls: any[] = [], aborted = new Set<string>();
 let personal = { revision: null as string | null, instructions: [] as typeof large };
 const request = async (command: any) => {
  calls.push(structuredClone(command));
  assert.ok(new TextEncoder().encode(JSON.stringify({ operation: 'instruction-transfer', expectedOwnerId: 'alice', command })).byteLength <= 96 * 1024);
  if (command.action === 'snapshot') return { base, personal: reference ? { revision: personal.revision, reference } : personal };
  if (command.action === 'read-part') return { part: parts[command.ordinal] };
  if (command.attemptId && aborted.has(command.attemptId)) throw new InstructionTransferRetired(command.attemptId);
  if (command.action === 'begin') {
   if (state?.status === 'aborted' && state.attemptId !== command.attemptId) { state = undefined; parts.splice(0); }
   state ??= { attemptId: command.attemptId, nextOrdinal: 0, partCount: command.partCount, digest: command.digest, status: 'staging', revision: 'receipt' };
   assert.equal(command.attemptId, state.attemptId); assert.equal(command.digest, state.digest);
  }
  if (command.action === 'parts') { assert.equal(command.offset, parts.length); parts.push(...command.parts); state.nextOrdinal = parts.length; if (losePart) { losePart = false; throw Error('Lost part response'); } }
  if (command.action === 'commit') {
   assert.equal(parts.length, state.partCount); state.status = 'committed';
   const instructions: typeof large = [];
   for (const part of parts) { if (part.start) instructions.push({ id: part.id, text: part.text, enabled: part.enabled }); else instructions.at(-1)!.text += part.text; }
   personal = { revision: state.revision, instructions };
   reference = { formatVersion: 1, attemptId: state.attemptId, partCount: state.partCount, digest: state.digest };
   if (loseCommit) { loseCommit = false; throw Error('Lost commit response'); }
  }
  return { transfer: structuredClone(state) };
 };
 return { request, calls, parts, get personal() { return personal; }, losePart() { losePart = true; }, loseCommit() { loseCommit = true; }, abort() { aborted.add(state.attemptId); state.status = 'aborted'; }, change() { personal = { revision: 'other-device', instructions: [{ id: 'remote', text: 'Independent account edit', enabled: true }] }; reference = undefined; } };
}
test('large frozen attempts resume after lost part, reload and newer edit; lost commit acknowledges without replay', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), remote = wire(); let now = 1_000;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, service = () => new LocalLopuInstructions(db, scope, lease, () => now), signal = new AbortController().signal;
 const transport: InstructionTransport = { read: (s, known, attempt) => readInstructionSnapshot(remote.request, s, known, attempt), write: async () => { throw Error('Unexpected atomic write'); }, writeResumable: (v, t, s, p) => writeInstructionTransfer(remote.request, v, t, s, p) };
 try {
  let local = await service().save({ revision: null, instructions: large }); remote.losePart(); await service().sync(transport, signal);
  const failed = await service().read(); assert.ok(failed.attempt?.transfer); assert.ok(remote.parts.length);
  const attemptId = failed.attempt.transfer.id, calls = remote.calls.length;
  await service().sync(transport, signal); assert.equal(remote.calls.length, calls, 'wake storms obey the persisted deadline');
  local = await service().save({ revision: local.personal.revision, instructions: [{ id: 'later', enabled: true, text: 'Newer device edit while upload is pending' }] }); remote.loseCommit();
  for (let pass = 0; pass < 30 && !remote.calls.some(call => call.action === 'commit'); pass++) { now += 60_000; const before = remote.calls.length; await service().sync(transport, signal); assert.ok(remote.calls.length - before <= 5); }
  assert.deepEqual(remote.personal.instructions, large); assert.ok((await service().read()).attempt);
  now += 60_000; await service().sync(transport, signal);
  const acknowledged = await service().read(); assert.equal(acknowledged.attempt, undefined); assert.equal(acknowledged.pending, true); assert.equal(acknowledged.personal.revision, local.personal.revision);
  assert.equal(remote.calls.filter(call => call.action === 'commit').length, 1); assert.equal(remote.calls.filter(call => call.action === 'read-part').length, 0);
  assert.ok(remote.calls.filter(call => call.action === 'begin').every(call => call.attemptId === attemptId));
  const sent = remote.calls.filter(call => call.action === 'parts'); assert.equal(new Set(sent.map(call => call.offset)).size, sent.length);
 } finally { await db.close(); }
});
test('unchanged snapshots reuse durable content; cancelled reads never request a part', async () => {
 const remote = wire(), signal = new AbortController().signal; let transfer = { id: 'read-fixture', nextPart: 0 }, result;
 const progress = async (next: typeof transfer) => { transfer = next; };
 do { result = await writeInstructionTransfer(remote.request, { revision: null, instructions: large }, transfer, signal, progress); } while (!result.personal);
 const before = remote.calls.length, known = { base, personal: result.personal };
 assert.deepEqual(await readInstructionSnapshot(remote.request, signal, known), known); assert.equal(remote.calls.length - before, 1);
 const abort = new AbortController(); abort.abort(); await assert.rejects(readInstructionSnapshot(remote.request, abort.signal), { name: 'AbortError' }); assert.equal(remote.calls.filter(call => call.action === 'read-part').length, 0);
});
test('identity retirement during a resumed part does not apply progress or receipt', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), remote = wire(); let retired = false;
 const lease = { assertCurrent() { if (retired) throw Error('Retired'); }, onInvalidate: () => () => {} }, service = new LocalLopuInstructions(db, scope, lease), signal = new AbortController().signal;
 try {
  await service.save({ revision: null, instructions: large });
  await assert.rejects(service.sync({ read: s => readInstructionSnapshot(remote.request, s), write: async () => { throw Error('Unexpected atomic write'); }, writeResumable: (v, t, s, p) => writeInstructionTransfer(async (command: any) => { const result = await remote.request(command); if (command.action === 'parts') retired = true; return result; }, v, t, s, p) }, signal), /Retired/);
  retired = false; const row = await service.read(); assert.equal(row.attempt?.transfer?.nextPart, 0); assert.equal(row.pending, true); assert.equal(remote.calls.some(call => call.action === 'commit'), false);
 } finally { await db.close(); }
});

test('fresh device reads every immutable part with paced requests and validates the complete digest', async t => {
 const remote = wire(), signal = new AbortController().signal; let transfer = { id: 'fresh-device', nextPart: 0 }, result;
 const progress = async (next: typeof transfer) => { transfer = next; };
 do { result = await writeInstructionTransfer(remote.request, { revision: null, instructions: large }, transfer, signal, progress); } while (!result.personal);
 t.mock.timers.enable({ apis: ['setTimeout'] });
 try {
  let complete = false;
  const read = readInstructionSnapshot(remote.request, signal).finally(() => { complete = true; });
  for (let step = 0; !complete && step < 50_000; step++) { t.mock.timers.tick(2500); await new Promise<void>(resolve => setImmediate(resolve)); }
  assert.equal(complete, true, `Read ${remote.calls.filter(call => call.action === 'read-part').length} of ${remote.parts.length} parts`); const snapshot = await read;
  assert.equal(JSON.stringify(snapshot.personal.instructions) === JSON.stringify(instructionSettings({ revision: null, instructions: large }).instructions), true);
  assert.equal(remote.calls.filter(call => call.action === 'read-part').length, remote.parts.length);
 } finally { t.mock.timers.reset(); }
});

test('long reads renew their durable claim so a second tab cannot race the eventual upload', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()); let now = 0, reads = 0, entered!: () => void, release!: () => void;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, service = () => new LocalLopuInstructions(db, scope, lease, () => now);
 const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
 const transport: InstructionTransport = { read: async (_signal, _known, _attempt, progress) => {
  reads++; now = 50_000; await progress?.(); now = 100_000; entered(); await held;
  return { base, personal: { revision: null, instructions: [] } };
 }, write: async value => ({ ...value, revision: 'saved' }) };
 try {
  const first = service().sync(transport, new AbortController().signal); await started;
  await service().sync(transport, new AbortController().signal); assert.equal(reads, 1);
  release(); await first; assert.equal((await service().read()).claim, undefined);
 } finally { release?.(); await db.close(); }
});

test('rate-limited account reads retain exact local content and explain automatic backoff', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()); let now = 0, reads = 0;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, service = new LocalLopuInstructions(db, scope, lease, () => now);
 const transport: InstructionTransport = { read: async () => { reads++; throw Object.assign(Error('Rate limited'), { status: 429, retryAfterMs: 120_000 }); }, write: async () => { throw Error('No write expected'); } };
 try {
  const local = await service.save({ revision: null, instructions: large });
  await service.sync(transport, new AbortController().signal);
  const state = await service.read(); assert.equal(state.retryAt, 120_000); assert.match(state.error!, /request limit.*saved on this device.*retry automatically/);
  assert.equal(JSON.stringify(state.personal) === JSON.stringify(local.personal), true);
  now = 119_999; await service.sync(transport, new AbortController().signal); assert.equal(reads, 1);
  now = 120_000; await service.sync(transport, new AbortController().signal); assert.equal(reads, 2);
 } finally { await db.close(); }
});

for (const reason of ['seven-day expiry', 'explicit abort'] as const) test(`${reason} retires only its frozen attempt and resumes from a fresh reconciled snapshot`, async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), remote = wire(); let now = 0;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, service = () => new LocalLopuInstructions(db, scope, lease, () => now), signal = new AbortController().signal;
 const transport: InstructionTransport = { read: (s, known, attempt) => readInstructionSnapshot(remote.request, s, known, attempt), write: async value => ({ ...value, revision: 'atomic-receipt' }), writeResumable: (v, t, s, p) => writeInstructionTransfer(remote.request, v, t, s, p) };
 try {
  let local = await service().save({ revision: null, instructions: large });
  await service().sync(transport, signal);
  const oldAttempt = (await service().read()).attempt!; assert.ok(oldAttempt.transfer); assert.ok(oldAttempt.transfer.nextPart > 0);
  remote.abort(); now += 7 * 86400_000 + 1;
  if (reason === 'explicit abort') local = await service().save({ revision: local.personal.revision, instructions: large.map(row => row.id === 'large' ? { ...row, text: row.text + ' New edit after abort' } : row) });
  await service().sync(transport, signal);
  const retired = await service().read(); assert.equal(retired.attempt, undefined); assert.equal(retired.pending, true); assert.deepEqual(retired.personal, local.personal);
  const afterRetirement = remote.calls.length;
  for (let pass = 0; pass < 40 && (await service().read()).pending; pass++) { now += 15_000; await service().sync(transport, signal); }
  const complete = await service().read(); assert.equal(complete.pending, false); assert.deepEqual(complete.personal, local.personal);
  assert.equal(JSON.stringify(remote.personal.instructions) === JSON.stringify(local.personal.instructions), true);
  const freshCalls = remote.calls.slice(afterRetirement); assert.equal(freshCalls[0].action, 'snapshot');
  const freshBegin = freshCalls.find(command => command.action === 'begin'); assert.ok(freshBegin); assert.notEqual(freshBegin.attemptId, oldAttempt.transfer.id); assert.equal(freshBegin.expectedRevision, null);
 } finally { await db.close(); }
});

test('a changed account revision after transfer retirement requires review before a fresh upload', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), remote = wire(); let now = 0;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, service = new LocalLopuInstructions(db, scope, lease, () => now), signal = new AbortController().signal;
 const transport: InstructionTransport = { read: (s, known, attempt) => readInstructionSnapshot(remote.request, s, known, attempt), write: async () => { throw Error('Unexpected write'); }, writeResumable: (v, t, s, p) => writeInstructionTransfer(remote.request, v, t, s, p) };
 try {
  const local = await service.save({ revision: null, instructions: large }); await service.sync(transport, signal); remote.abort(); now += 60_000;
  await service.sync(transport, signal); assert.equal((await service.read()).attempt, undefined);
  remote.change(); const begins = remote.calls.filter(command => command.action === 'begin').length; now += 15_000; await service.sync(transport, signal);
  const conflict = await service.read(); assert.ok(conflict.conflict); assert.deepEqual(conflict.personal, local.personal); assert.equal(conflict.attempt, undefined);
  assert.equal(remote.calls.filter(command => command.action === 'begin').length, begins);
 } finally { await db.close(); }
});
