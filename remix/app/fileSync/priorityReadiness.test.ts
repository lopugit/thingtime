import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { REVIEW_STORE, type PagedRunSpec } from './pagedRunJournal';
import { newFileSyncConfiguration } from './configuration';
import { prepareCloudInventoryWrite } from './cloudWrite';
import { parsePriorityReadiness } from './priorityReadiness';
const scope = { origin: 'https://priority.test', ownerId: 'owner', deviceId: 'device', rootId: 'connection', dataPlane: 'home' };
const folder = (path: string, version = '1') => ({ path, version, id: 'native-' + path, kind: 'folder' as const, size: 0, sha256: null });
const identity = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
async function fixture() {
 const factory = new IDBFactory(), name = 'priority-readiness-test';
 let journal = await openSyncJournal(factory, name, IDBKeyRange);
 const access = { scope, currentScope: () => scope };
 const spec: PagedRunSpec = { id: crypto.randomUUID(), configuration: { ...newFileSyncConfiguration({ name: 'Synthetic', deviceId: scope.deviceId, localRootId: 'local', remoteFolderId: 'cloud' }), mode: 'backup', paused: false },
  streaming: { source: 'local', captureId: crypto.randomUUID() }, plan: { id: crypto.randomUUID(), local: identity('local'), remote: identity('remote'), baseline: { local: identity('local'), remote: identity('remote') }, policy: { mode: 'backup', propagateDeletes: false }, excludedPaths: [] } };
 let runs = journal.pagedRuns(access); await runs.begin(spec);
 return { spec, get journal() { return journal; }, get runs() { return runs; },
  async reopen() { journal.close(); journal = await openSyncJournal(factory, name, IDBKeyRange); runs = journal.pagedRuns(access); },
  async legacy() {
   const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
   try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REVIEW_STORE, 'readwrite'); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    const get = tx.objectStore(REVIEW_STORE).openCursor(); get.onsuccess = () => { const cursor = get.result; if (!cursor) return;
     const row = cursor.value; if (Array.isArray(cursor.key) && cursor.key[2] === 'input') { delete row.inputScope; delete row.inputRun; delete row.inputPath; cursor.update(row); } cursor.continue(); };
   }); } finally { db.close(); }
  },
  async append(entries: ReturnType<typeof folder>[], after: number) { for (let offset = 0; offset < entries.length; offset += 128) await runs.appendStreamInput(spec, spec.streaming!.captureId, entries.slice(offset, offset + 128).map((entry, i) => ({ sequence: after + offset + i + 1, revision: entry.version, entry })), false); }
 };
}

test('visible priority observations distinguish zero/partial/complete legacy proof without moving any source watermark', async () => {
 const f = await fixture(), { spec } = f;
 try {
  await f.append(Array.from({ length: 300 }, (_, i) => folder(i === 279 ? 'Cafe\u0301' : 'ordinary-' + i)), 0);
  await f.legacy(); await f.runs.enableStreamPriorities(spec);
  await f.journal.priorities({ scope, currentScope: () => scope }).save(['CAFÉ'], 0);
  let d = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(d.proofCursor, 0); assert.equal(d.proofCutoff, 300); assert.equal(d.measured, false);
  await f.append([folder('CAFÉ', '2')], 300);
  await f.runs.nextStreamInput(spec);
  d = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(d.blocker, 'proof-pending'); assert.equal(d.candidateSequence, 301); assert.equal(d.candidateOrdinal, 1);
  assert.equal(d.preferencesCount, 1); assert.equal(d.preferencesRevision, 1);
  for (const cursor of [128, 256]) {
   await f.runs.backfillStreamInputs(spec); d = await f.runs.streamPriorityReadiness(spec, true);
   assert.equal(d.proofCursor, cursor); assert.equal(d.proofCutoff, 300); assert.equal(d.blocker, 'proof-pending');
  }
  await f.runs.backfillStreamInputs(spec);
  d = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(d.proofCursor, 300); assert.equal(d.measured, false, 'Crossing proof cannot fabricate a fresh ready selection');
  const selected = (await f.runs.nextStreamInput(spec))!;
  assert.equal(selected.sequence, 280, 'Earlier casefold alias remains the actual selected revision');
  d = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(d.blocker, 'ready'); assert.equal(d.candidateSequence, 280);
  const before = await f.runs.streamState(spec);
  assert.deepEqual(await f.runs.streamPriorityReadiness(spec, true), d);
  assert.deepEqual(await f.runs.streamState(spec), before);
  assert.equal(before.sequence, 0); assert.equal(before.indexedSequence, 301); assert.equal(before.preparedAhead, 0);
  assert.doesNotMatch(JSON.stringify(d), /CAF|Cafe|ordinary|native|owner|https/);
 } finally { f.journal.close(); }
});

test('reserved and confirmed operations retain IDs across diagnostic reads and reopening; fallback stays explicitly unsupported', async () => {
 const f = await fixture(), { spec } = f;
 try {
  await f.append([folder('priority')], 0); await f.runs.enableStreamPriorities(spec);
  await f.journal.priorities({ scope, currentScope: () => scope }).save(['priority'], 0);
  const change = (await f.runs.nextStreamInput(spec))!, operation = { id: crypto.randomUUID(), mutation: { kind: 'copy' as const, from: 'local' as const, path: change.entry.path, source: change.entry, expectedTarget: null }, confirmed: false };
  await f.runs.appendStream(spec, change, { write: prepareCloudInventoryWrite(operation, scope, 'cloud', null, 'cloud') });
  assert.equal((await f.runs.claimNext(spec))!.id, operation.id);
  const d = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(d.reserved, true); assert.equal(d.reservationKind,'operation'); assert.equal(d.reservationRemaining,1);
  assert.equal((await f.runs.claimNext(spec))!.id, operation.id);
  await f.reopen();
  const unknown = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(unknown.reserved, true); assert.equal(unknown.measured, false);
  const fallback = await f.runs.streamPriorityReadiness(spec, false);
  assert.equal(fallback.gate, 'unsupported'); assert.equal(fallback.blocker, 'none'); assert.equal(fallback.candidateSequence, null);
  assert.equal((await f.runs.claimNext(spec))!.id, operation.id);
  await f.runs.confirm(spec, { operationId: operation.id, scope, entry: { ...change.entry, id: 'cloud-id', version: 'cloud-version' } });
  const confirmed = await f.runs.streamState(spec);
  await f.runs.streamPriorityReadiness(spec, true);
  assert.deepEqual(await f.runs.streamState(spec), confirmed);
  assert.equal(await f.runs.claimNext(spec), null);
 } finally { f.journal.close(); }
});

test('absent inputs and new preference revisions are observations, never a completion assertion', async () => {
 const f = await fixture(), { spec } = f;
 try {
  await f.append([folder('ordinary')], 0); await f.runs.enableStreamPriorities(spec);
  const preferences = f.journal.priorities({ scope, currentScope: () => scope });
  await preferences.save(['missing'], 0); await f.runs.nextStreamInput(spec);
  const absent = await f.runs.streamPriorityReadiness(spec, true); assert.equal(absent.blocker, 'not-indexed');
  await f.append([folder('missing')], 1);
  assert.equal((await f.runs.streamPriorityReadiness(spec, true)).measured, false, 'Producer growth invalidates an old absence decision');
  await preferences.save(['other'], 1);
  const changed = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(changed.preferencesRevision, 2); assert.equal(changed.measured, false);
 } finally { f.journal.close(); }
});

test('saved diagnostics accept only bounded closed fields and discard arbitrary cached data', () => {
 const d = { gate: 'enabled' as const, preferencesCount: 5, preferencesRevision: 3, proofCursor: 128, proofCutoff: 300, candidateOrdinal: 2, candidateSequence: 280, blocker: 'proof-pending' as const, measured: true, reserved: true };
 assert.deepEqual(parsePriorityReadiness({ ...d, secret: '/private/path' }), d);
 for (const patch of [{ proofCursor: 301 }, { proofCursor: null }, { proofCutoff: null }, { preferencesCount: -1 }, { candidateOrdinal: 6 }, { candidateSequence: 0 }, { blocker: 'private-error' }, { measured: 'yes' }])
  assert.equal(parsePriorityReadiness({ ...d, ...patch }), undefined);
 assert.deepEqual(parsePriorityReadiness(JSON.parse(JSON.stringify(d))), d, 'Pause/reopen serialization preserves the closed observation');
});

test('a newer pending path revision cannot reuse the old observed candidate identity', async () => {
 const f = await fixture(), { spec } = f;
 try {
  await f.append([folder('priority', 'A')], 0); await f.runs.enableStreamPriorities(spec); await f.runs.backfillStreamInputs(spec);
  await f.journal.priorities({ scope, currentScope: () => scope }).save(['priority'], 0);
  const old = (await f.runs.nextStreamInput(spec))!;
  const binding = (change: typeof old) => {
   const operation = { id: crypto.randomUUID(), mutation: { kind: 'copy' as const, from: 'local' as const, path: change.entry.path, source: change.entry, expectedTarget: null }, confirmed: false };
   return { operation, write: prepareCloudInventoryWrite(operation, scope, 'cloud', null, 'cloud') };
  };
  const first = binding(old); await f.runs.appendStream(spec, old, { write: first.write });
  assert.equal((await f.runs.claimNext(spec, false))!.id, first.operation.id);
  await f.runs.confirm(spec, { operationId: first.operation.id, scope, entry: { ...old.entry, id: 'cloud-id', version: 'cloud-A' } });
  const next = { generation: spec.streaming!.captureId, sequence: 2, revision: 'B', entry: folder('priority', 'B') };
  await f.append([next.entry], 1);
  const second = binding(next); await f.runs.appendStream(spec, next, { write: second.write });
  const before = await f.runs.streamState(spec), d = await f.runs.streamPriorityReadiness(spec, true);
  assert.equal(d.candidateSequence, 1, 'This is still explicitly the last observed candidate');
  assert.equal(d.measured, false, 'A newer pending revision cannot validate the old exact candidate');
  assert.equal(d.blocker, 'none');
  assert.deepEqual(await f.runs.streamState(spec), before);
  assert.equal((await f.runs.claimNext(spec, false))!.id, second.operation.id);
  assert.equal((await f.runs.claimNext(spec, false))!.id, second.operation.id);
 } finally { f.journal.close(); }
});


test('unknown reservation diagnostics never infer recovery from a reserved boolean', () => {
 const d={gate:'enabled' as const,preferencesCount:0,preferencesRevision:0,proofCursor:null,proofCutoff:null,candidateOrdinal:null,candidateSequence:null,blocker:'none' as const,measured:true,reserved:true};
 assert.equal(parsePriorityReadiness(d)!.reservationKind,undefined);
 for(const patch of [...(['file-batch','folder-batch','file-recovery','folder-recovery'].map(reservationKind=>({reservationKind,reservationRemaining:0}))),{reservationKind:'file-recovery',reservationRemaining:-1},{reservationKind:'file-recovery',reservationRemaining:257},{reservationKind:'operation',reservationRemaining:2},{reservationKind:'none',reservationRemaining:1},{reservationKind:'secret',reservationRemaining:1},{reservationKind:'file-batch'}]) {
  const value=parsePriorityReadiness({...d,...patch,folderBatchGate:'secret'})!;
  assert.equal(value.folderBatchGate,undefined); assert.equal(value.reservationKind,undefined); assert.equal(value.reservationRemaining,undefined);
 }
 const known={...d,folderBatchGate:'enabled' as const,reservationKind:'file-recovery' as const,reservationRemaining:89};
 assert.deepEqual(parsePriorityReadiness(JSON.parse(JSON.stringify(known))),known);
});
