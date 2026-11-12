import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createInstructionStore, exportInstructionRecord, advanceInstructionTransfer, type InstructionTransferState } from './lopuInstructionStore';
import { INSTRUCTION_CHAIN_SEED, splitInstructionParts, parseInstructionPart, type InstructionPart } from '../../../lopu/instructionTransfer';
import { thingStorageSizeBytes } from '../storage/storageCore';
import { LopuPromptConflictError } from '../lopu/promptSettingsCore';
const chain = (parts: InstructionPart[]) => parts.reduce((digest, part) => createHash('sha256').update(digest + '\n' + JSON.stringify(part)).digest('hex'), INSTRUCTION_CHAIN_SEED);
const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const matches = (doc: any, query: any): boolean => Object.entries(query).every(([key, value]: any) => {
 if (key === '$or') return value.some((entry: any) => matches(doc, entry));
 const actual = doc[key];
 if (value && typeof value === 'object' && !value._bsontype && !(value instanceof Date)) {
  if ('$in' in value) return value.$in.some((entry: any) => equal(actual, entry));
  if ('$ne' in value) return !equal(actual, value.$ne);
  if ('$lt' in value) return actual < value.$lt;
 }
 if (key === 'thingtime' || key === 'uniqueKeys') return doc[key]?.some((entry: any) => equal(entry, value));
 return equal(actual, value);
});
function fixture() {
 let docs: any[] = [], personal: any = { revision: null, instructions: [] }, usedBytes = 0, quota = Infinity, writes = 0;
 const things: any = {
  findOne: async (query: any) => docs.find(doc => matches(doc, query)) ?? null,
  find: (query: any) => { let limit = Infinity; const cursor: any = { limit: (count: number) => { limit = count; return cursor; }, toArray: async () => docs.filter(doc => matches(doc, query)).slice(0, limit) }; return cursor; }
 };
 const store = createInstructionStore({
  getThings: async () => things,
  transaction: async (work: any) => {
   const before = docs.map(doc => ({ ...doc })), beforePersonal = personal, beforeBytes = usedBytes;
   try { return await work({ synthetic: true }); } catch (error) { docs = before; personal = beforePersonal; usedBytes = beforeBytes; throw error; }
  },
  insert: async (_things: any, doc: any, options: any) => {
   assert.ok(options.session); assert.equal(options.accountedPlane, 'home');
   const size = thingStorageSizeBytes(doc); if (usedBytes + size > quota) throw new Error('quota refused');
   if (docs.some(prior => prior.shareId === doc.shareId || doc.uniqueKeys?.some((key: any) => prior.uniqueKeys?.some((previous: any) => equal(key, previous))))) throw new Error('unique identity refused');
   usedBytes += size; doc._id = `doc-${++writes}`; docs.push(doc); return {};
  },
  update: async (_things: any, query: any, update: any, options: any) => {
   assert.ok(options.session); const prior = docs.find(doc => matches(doc, query)); if (!prior) return { matchedCount: 0 };
   const before = thingStorageSizeBytes(prior), next = { ...prior, ...update.$set }, after = thingStorageSizeBytes(next);
   if (usedBytes + after - before > quota) throw new Error('quota refused');
   usedBytes += after - before; Object.assign(prior, next); return { matchedCount: 1 };
  },
  remove: async (_things: any, query: any, options: any) => {
   assert.ok(options.session); const removed = docs.filter(doc => matches(doc, query)); usedBytes -= removed.reduce((sum, doc) => sum + thingStorageSizeBytes(doc), 0); docs = docs.filter(doc => !matches(doc, query)); return { deletedCount: removed.length };
  },
  readRecord: async () => personal,
  setRecord: async (_owner: string, record: any, expected: any, session: any) => { assert.ok(session); if (personal.revision !== expected) throw new LopuPromptConflictError(); personal = record; return record; }
 } as any);
 const call = (command: any, ownerId = 'alice', scope = 'origin/home/alice', admit?: () => Promise<void>) => store.execute(ownerId, scope, command, admit);
 const begin = async (parts: InstructionPart[], attemptId = 'attempt', expectedRevision = personal.revision, digest = chain(parts)) => call({ action: 'begin', attemptId, expectedRevision, partCount: parts.length, digest });
 return { call, begin, docs: () => docs, record: () => personal, setRecord: (value: any) => { personal = value; }, setQuota: (value: number) => { quota = value; }, usage: () => usedBytes };
}
test('large private content resumes immutable parts and durable commits without overwriting a newer edit', async () => {
 const f = fixture(), original = [{ id: 'large', enabled: true, text: '漢字😀\n'.repeat(120000) }, { id: 'off', enabled: false, text: 'Preserve disabled row' }];
 const parts = [...splitInstructionParts(original)]; assert.ok(Buffer.byteLength(original[0].text) > 1024 * 1024);
 const begun: any = await f.begin(parts);
 for (let offset = 0; offset < parts.length; offset += 8) {
  const command = { action: 'parts', attemptId: 'attempt', offset, parts: parts.slice(offset, offset + 8) };
  await f.call(command); await f.call(command); // lost reply resumes the same immutable bytes
 }
 assert.deepEqual(f.record(), { revision: null, instructions: [] });
 const committed: any = await f.call({ action: 'commit', attemptId: 'attempt' });
 assert.equal(committed.personal.revision, begun.transfer.revision);
 const retained = f.docs().filter(doc => doc.thingtime[0] === 'lopu-instruction-part').map(exportInstructionRecord).sort((a,b) => a.payload.ordinal-b.payload.ordinal);
 const reconstructed: any[] = [];
 for (const { payload: { part } } of retained) { if (part.start) reconstructed.push({ id: part.id, enabled: part.enabled, text: '' }); reconstructed.at(-1).text += part.text; }
 assert.deepEqual(reconstructed, original.map(row => ({ ...row, text: row.text.trim() })));
 f.setRecord({ revision: 'newer', instructions: [{ id: 'new', enabled: true, text: 'New device edit' }] });
 assert.deepEqual(await f.call({ action: 'commit', attemptId: 'attempt' }), committed);
 assert.equal(f.record().revision, 'newer');
 const firstPart = await f.call({ action: 'read-part', attemptId: 'attempt', ordinal: 0 });
 assert.ok('part' in firstPart); assert.equal(firstPart.part.text, parts[0].text);
 assert.equal(f.usage(), f.docs().reduce((sum, doc) => sum + thingStorageSizeBytes(doc), 0));
 await assert.rejects(f.call({ action: 'abort', attemptId: 'attempt' }), /cannot be cancelled/);
});
test('integrity, duplicate ids, missing parts, changed retries and concurrent ordinary revisions refuse atomically', async () => {
 const f = fixture(), part = parseInstructionPart({ id: 'one', enabled: true, text: 'first', start: true, end: true });
 await f.begin([part, part]); await f.call({ action: 'part', attemptId: 'attempt', ordinal: 0, part });
 await assert.rejects(f.call({ action: 'part', attemptId: 'attempt', ordinal: 1, part }), /unique id/);
 await assert.rejects(f.call({ action: 'part', attemptId: 'attempt', ordinal: 0, part: { ...part, text: 'different' } }), /identity changed/);
 await assert.rejects(f.call({ action: 'commit', attemptId: 'attempt' }), /incomplete/);
 await assert.rejects(f.begin([part], 'attempt'), /identity changed/);
 const bad = fixture(); await bad.begin([part], 'attempt', null, 'f'.repeat(64)); await bad.call({ action: 'part', attemptId: 'attempt', ordinal: 0, part });
 await assert.rejects(bad.call({ action: 'commit', attemptId: 'attempt' }), /corrupt/);
 assert.equal(bad.record().revision, null);
 const stale = fixture(); await stale.begin([part]); await stale.call({ action: 'part', attemptId: 'attempt', ordinal: 0, part }); stale.setRecord({ revision: 'newer', instructions: [] });
 await assert.rejects(stale.call({ action: 'commit', attemptId: 'attempt' }), LopuPromptConflictError);
 const staged = await stale.call({ action: 'status', attemptId: 'attempt' });
 assert.ok('transfer' in staged); assert.equal(staged.transfer.status, 'staging');
});
test('quota and revoked-session failures roll back parts, checkpoint and bytes', async () => {
 const f = fixture(), parts = [...splitInstructionParts([{ id: 'one', text: 'x'.repeat(20000), enabled: true }])]; await f.begin(parts);
 const before = f.usage(); f.setQuota(before + 100);
 await assert.rejects(f.call({ action: 'parts', attemptId: 'attempt', offset: 0, parts }), /quota/);
 assert.equal(f.usage(), before); const checkpoint = await f.call({ action: 'status', attemptId: 'attempt' });
 assert.ok('transfer' in checkpoint); assert.equal(checkpoint.transfer.nextOrdinal, 0);
 f.setQuota(Infinity); let admissions = 0;
 await assert.rejects(f.call({ action: 'parts', attemptId: 'attempt', offset: 0, parts }, 'alice', 'origin/home/alice', async () => { if (++admissions === 3) throw new Error('session revoked'); }), /revoked/);
 assert.equal(f.usage(), before); assert.equal(f.docs().length, 1);
});
test('abort cleanup is bounded, metered, resumable and cannot revive a discarded identity', async () => {
 const f = fixture(), parts = [...splitInstructionParts([{ id: 'one', text: 'x'.repeat(6000 * 130), enabled: true }])]; await f.begin(parts);
 for (let offset = 0; offset < parts.length; offset += 64) await f.call({ action: 'parts', attemptId: 'attempt', offset, parts: parts.slice(offset,offset+64) });
 const before = f.docs().length; await f.call({ action: 'abort', attemptId: 'attempt' }); assert.equal(f.docs().length, before - 64);
 await f.call({ action: 'status', attemptId: 'attempt' }); await f.call({ action: 'status', attemptId: 'attempt' }); assert.equal(f.docs().length,1);
 assert.equal(f.usage(), thingStorageSizeBytes(f.docs()[0]));
 const terminal = await f.call({ action: 'commit', attemptId: 'attempt' });
 assert.ok('terminalCode' in terminal); assert.equal(terminal.terminalCode, 'INSTRUCTION_TRANSFER_ABORTED');
 await assert.rejects(f.call({ action: 'status', attemptId: 'attempt' }, 'bob'), /not found/);
 await assert.rejects(f.call({ action: 'status', attemptId: 'attempt' }, 'alice', 'different-plane'), /confirmation changed/);
});
test('fragment boundaries preserve canonical Unicode and escaped content without limiting total size', () => {
 const original = '😀\u0000漢'.repeat(12000), parts = [...splitInstructionParts([{ id: 'text', text: original, enabled: true }])];
 assert.equal(parts.map(part => part.text).join(''), original); assert.ok(parts.every(part => Buffer.byteLength(JSON.stringify(part)) <= 48*1024));
 const state: InstructionTransferState = { formatVersion:1,attemptId:'a',expectedRevision:null,partCount:1,digest:chain([parts[0]]),chain:INSTRUCTION_CHAIN_SEED,nextOrdinal:0,status:'staging',revision:'r',openId:null,openEnabled:null,rowCount:0,scope:'scope' };
 assert.throws(() => advanceInstructionTransfer(state, {...parts[0],start:false}), /contiguous/);
});

test('expired staging is tombstoned and lazily refunded while committed historical home content remains readable after a plane change', async () => {
 const f=fixture(), parts=[...splitInstructionParts([{id:'row',text:'Retained private content',enabled:true}])];
 await f.begin(parts,'expired'); await f.call({action:'part',attemptId:'expired',ordinal:0,part:parts[0]});
 f.docs().find(doc=>doc.thingtime[0]==='lopu-instruction-transfer').updatedAt=new Date(Date.now()-8*86400_000);
 await f.begin(parts,'replacement');
 const previous:any=await f.call({action:'status',attemptId:'expired'}); assert.equal(previous.transfer.status,'aborted');
 assert.equal(f.docs().filter(doc=>doc.thingtime[0]==='lopu-instruction-part').length,0);
 await f.call({action:'part',attemptId:'replacement',ordinal:0,part:parts[0]}); await f.call({action:'commit',attemptId:'replacement'});
 // Home account settings remain readable when the selected content database
 // changes. Only mutation/resume identity stays pinned to its original plane.
 const historicalPart = await f.call({action:'read-part',attemptId:'replacement',ordinal:0},'alice','same-origin/another-plane/alice');
 assert.ok('part' in historicalPart); assert.deepEqual(historicalPart.part,parts[0]);
 await assert.rejects(f.call({action:'status',attemptId:'replacement'},'alice','same-origin/another-plane/alice'),/confirmation changed/);
});
