import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport, type AccountLinkRequest } from './accountFiles';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { type FileMetadataTransport } from './accountFileMetadata';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { createQuotaFactory } from './storageTestFixture';
import { isLocalLinkedAttachment, isLocalMediaAttachment } from './attachments';
import { exportAccountThings } from './accountExport';
import { accountImportSupported } from './accountImport';
import { AccountDraftSync, type AccountDraftTransport } from './accountDrafts';
import type { AccountDraft, DraftContent } from '../drafts/draftCore';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { validateTransfer } from '../utils/thingTransfer/format';

const scope = { kind: 'account', origin: 'https://links.test', ownerId: 'owner', dataPlane: 'home' } as const;
const bytes = new TextEncoder().encode('Mixed stored bytes');
const receiptId = (requestId: string) => 'att_' + createHash('sha256').update('thingtime-attachment-request-v1\0owner\0' + requestId).digest('hex');
async function fixture(factory = new IDBFactory()) {
 let db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange), active = true, time = Date.now();
 const callbacks = new Set<() => void>();
 const lease: WorkspaceLease = { assertCurrent() { assert.ok(active, 'Workspace changed'); }, onInvalidate(cb) { callbacks.add(cb); return () => { callbacks.delete(cb); }; } };
 let files = new AccountFileSync(db, scope, lease, () => time), sync = new AccountThingSync(db, scope, lease, () => time, undefined, files.contentHooks);
 const manifest = validateTransfer({ format: 'thingtime.transfer', version: 1, roots: ['post'], things: [
  { id: 'post', thingtime: ['post'], crystal: { type: 'text', text: 'Linked gallery' } }
 ], files: [{ id: 'stored', targetId: 'post', path: 'files/000000', name: 'stored.txt', mime: 'text/plain', bytes: bytes.length, sha256: await transferChecksum(bytes), title: 'Stored title' }],
 links: [{ id: 'a', targetId: 'post', url: 'https://example.invalid/a.png', mediaKind: 'file', title: 'Linked title', description: 'One\nTwo' }, { id: 'b', targetId: 'post', url: 'https://example.invalid/b.mp4', mediaKind: 'file' }], attachmentOrder: ['b', 'stored', 'a'] });
 const remote = new Map<string, any>(), parents = new Map<string, AccountThing>(), links: AccountLinkRequest[] = [], removals: any[] = [], writes: any[] = [], annotations: any[] = [], fences = new Set<string>();
 const upload: AccountFileTransport & FileMetadataTransport = {
  link: async request => {
   links.push(structuredClone(request)); const id = receiptId(request.requestId);
   if (fences.has(id)) throw { status: 409 };
   if (!remote.has(id)) {
    const source = manifest.links!.find(link => link.url === request.url)!;
    remote.set(id, { id, author: { id: scope.ownerId }, thingtime: ['attachment'], crystal: { name: new URL(request.url).pathname.slice(1), contentType: request.url.endsWith('.png') ? 'image/png' : 'video/mp4', size: 0, mediaKind: source.mediaKind, url: request.url }, updatedAt: new Date(++time).toISOString() });
   }
   const row = remote.get(id); return { attachment: { id, ...row.crystal }, updatedAt: row.updatedAt };
  },
  start: async request => { const id = 'stored-' + request.requestId; remote.set(id, { id, author: { id: scope.ownerId }, thingtime: ['attachment'], crystal: { name: request.filename, size: request.sizeBytes, contentType: request.contentType, mediaKind: 'file' }, updatedAt: new Date(++time).toISOString() }); return { id, partSizeBytes: bytes.length, partCount: 1 }; },
  parts: async (_id, parts) => parts.map(part => ({ ...part, url: 'https://storage.invalid/part', expiresAt: '2026-10-24', headers: {} })),
  put: async (_part, body) => assert.deepEqual(body, bytes),
  complete: async id => ({ id, ...remote.get(id).crystal }),
  get: async id => { if (!remote.has(id)) throw { status: 404 }; return structuredClone(remote.get(id)); },
  annotate: async input => { annotations.push(structuredClone(input)); const row = remote.get(input.id); if (row.updatedAt !== input.expectedUpdatedAt) throw { status: 409 }; for (const key of ['title','description','filenamePreview']) { if (input[key as keyof typeof input] == null) delete row.crystal[key]; else row.crystal[key] = input[key as keyof typeof input]; } row.updatedAt = new Date(++time).toISOString(); return { attachment: { id: row.id, ...row.crystal }, updatedAt: row.updatedAt }; },
  move: async () => { throw Error('Bound media must not move independently'); },
  remove: async input => { removals.push(structuredClone(input)); if (fences.has(input.id)) return { deleted: true, deferred: false }; const row = remote.get(input.id); assert.ok(row); assert.equal(input.expectedUpdatedAt, row.updatedAt); assert.equal(input.requestId && receiptId(input.requestId), input.id); assert.ok(input.targetId); if (row.targetId) assert.equal(input.targetId, row.targetId); fences.add(input.id); remote.delete(input.id); return { deleted: true, deferred: false }; }
 };
 const content: AccountSyncTransport = {
  get: async id => { if (!parents.has(id)) throw { status: 404 }; return structuredClone(parents.get(id)!); },
  write: async op => { writes.push(structuredClone(op)); const {attachmentIds, ...body} = op.body; const ids = attachmentIds as string[] || [];
   for (const id of ids) { assert.ok(remote.has(id)); remote.get(id).targetId = op.id; }
   const row = { ...body, id: op.id, author: { id: scope.ownerId }, revision: 1, createdAt: new Date(time).toISOString(), updatedAt: new Date(++time).toISOString(), attachments: ids.map(id => ({ id, ...remote.get(id).crystal })) } as unknown as AccountThing;
   parents.set(op.id, row); return row;
  },
  remove: async operation => { parents.delete(operation.id); }
 };
 return { get db() {return db;}, scope, lease, get files() {return files;}, get sync() {return sync;}, manifest, remote, parents, links, removals, writes, annotations, fences, upload, content,
  import: () => sync.things.import(manifest, null, new Map([['stored', bytes]])),
  tick() { time += 120_000; }, retire() { active = false; callbacks.forEach(cb => cb()); },
  async reopen() { await db.close(); db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange); files = new AccountFileSync(db, scope, lease, () => time); sync = new AccountThingSync(db, scope, lease, () => time, undefined, files.contentHooks); },
  export: (ids: string[]) => exportAccountThings({ ids }, { db, sync, files, lease, canRefresh: () => false, remote: async () => { throw Error('No remote export'); } }) };
}

test('mixed account gallery commits metadata, bytes and independent queues offline, exports fresh copies and synchronizes owner-bound annotations', async () => {
 const f = await fixture(), oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error('No arbitrary URL fetch'); };
 try {
  assert.equal(accountImportSupported(f.manifest), true);
  const imported = await f.import(), post = imported.roots[0];
  assert.equal(f.links.length, 0); assert.equal((await f.files.status()).length, 3);
  const rows = (await f.sync.things.snapshot()).filter(isLocalMediaAttachment), linked = rows.filter(isLocalLinkedAttachment);
  for (const row of linked) { assert.equal(await f.db.transaction(scope, 'readonly', f.lease, tx => tx.getBinary(row.id)), undefined); assert.equal(await f.files.readLinkedUrl(row.id), row.crystal.url); }
  const plan = (await f.export([post])).plan, bundle = await bundleFromPlan(plan); assert.equal(bundle.manifest.links?.length, 2); assert.equal(bundle.files.size, 1);
  const copied = await f.sync.things.import(bundle.manifest, null, bundle.files, undefined, plan.assertCurrentInTransaction); assert.notEqual(copied.roots[0], post);
  assert.ok(copied.things.filter(isLocalLinkedAttachment).every(row => !linked.some(old => old.id === row.id)));
  await f.sync.remove(copied.roots);
  const independent = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Independent' } });
  await f.sync.sync(f.content); assert.ok(f.parents.has(independent.id)); assert.equal(f.parents.has(post), false);
  await f.files.sync(f.upload, undefined, 10); await f.sync.sync(f.content);
  assert.deepEqual(f.parents.get(post)!.acl, ['tt:user']);
  assert.deepEqual((f.parents.get(post) as any).attachments.map((row: any) => row.url || row.name), ['https://example.invalid/b.mp4','stored.txt','https://example.invalid/a.png']);
  assert.equal([...f.remote.values()].find(row => row.crystal.name === 'stored.txt')!.crystal.title, 'Stored title');
  assert.equal([...f.remote.values()].find(row => row.crystal.url?.endsWith('a.png'))!.crystal.title, 'Linked title');
  assert.ok((await f.files.status()).every(row => row.state === 'synced'));
  await f.reopen(); assert.equal((await bundleFromPlan((await f.export([post])).plan)).manifest.links?.length, 2);
  const other = new AccountFileSync(f.db, { ...scope, ownerId: 'other' }, f.lease); await assert.rejects(other.readLinkedUrl(linked[0].id), /not in this workspace/);
 } finally { globalThis.fetch = oldFetch; await f.db.close(); }
});

test('lost link receipts survive reopen and reorder without duplicating identity or overwriting newer annotations', async () => {
 const f = await fixture();
 try {
  const imported = await f.import(), post = imported.roots[0]; let lost = false;
  await f.files.sync({ ...f.upload, link: async (...args) => { const result = await f.upload.link!(...args); if (!lost) { lost = true; throw Error('Lost link receipt'); } return result; } }, undefined, 10);
  const original = f.links[0], missing = (await f.sync.things.snapshot()).filter(isLocalLinkedAttachment).find(row => row.localLinkedAttachment.requestId === original.requestId)!;
  await f.files.things.annotateFile({ id: missing.id, title: 'Newer offline title' });
  const order = (await f.sync.things.snapshot()).filter(isLocalMediaAttachment).map(row => row.id).reverse();
  await f.sync.things.savePost({ id: post, crystal: { text: 'Reordered' }, attachmentIds: order }, true);
  f.tick(); await f.reopen(); await f.files.sync(f.upload, undefined, 10); await f.sync.sync(f.content);
  assert.equal(f.links.filter(row => row.requestId === original.requestId).length, 2);
  assert.deepEqual(f.links.filter(row => row.requestId === original.requestId), [original,original]);
  assert.equal(f.remote.get(receiptId(original.requestId)).crystal.title, 'Newer offline title');
  const aliases = new Map((await f.files.library(true)).aliases);
  assert.deepEqual((f.parents.get(post) as any).attachments.map((row: any) => aliases.get(row.id)), order);
  assert.equal(f.remote.size, 3);
 } finally { await f.db.close(); }
});

test('linked removal before registration is local; ambiguous registration and lost deletion replay retain one durable cancellation fence', async () => {
 const f = await fixture();
 try {
  const imported = await f.import(), post = imported.roots[0], local = (await f.sync.things.snapshot()).filter(isLocalLinkedAttachment);
  await f.files.removeBound(local[0].id, post); assert.equal(f.links.length, 0);
  await f.files.sync({ ...f.upload, link: async (...args) => { await f.upload.link!(...args); throw Error('Lost registration'); } }, undefined, 10);
  const remaining = local[1], prepared = (await f.export([post])).plan;
  await f.files.removeBound(remaining.id, post); await assert.rejects(prepared.assertCurrent(), /not in this workspace/);
  await assert.rejects(f.files.readLinkedUrl(remaining.id), /not in this workspace/);
  f.tick(); await f.reopen(); await f.files.sync(f.upload, undefined, 1);
  let lost = false;
  await f.files.sync({ ...f.upload, remove: async (...args) => { const result = await f.upload.remove!(...args); if (!lost) { lost = true; throw Error('Lost deletion'); } return result; } }, undefined, 10);
  f.tick(); await f.files.sync(f.upload, undefined, 10);
  assert.equal(f.removals.length, 2); assert.deepEqual(f.removals[1], f.removals[0], 'lost delete receipt replays the exact identity and observed version');
  assert.equal(f.fences.has(receiptId(remaining.localLinkedAttachment.requestId!)), true);
  await assert.rejects(f.upload.link!({ requestId: remaining.localLinkedAttachment.requestId!, url: String(remaining.crystal.url), mediaKind: 'file', purpose: 'post' }, new AbortController().signal));
  assert.equal((await f.files.status()).some(row => row.id === remaining.id), false);
  assert.equal(f.remote.size, 1, 'stored file remains independently available');
 } finally { await f.db.close(); }
});

test('bound annotation sync rejects changed owner, target and immutable URL or byte identity without writing or losing device edits', async () => {
 for (const kind of ['linked','stored'] as const) for (const changed of ['owner','target','content'] as const) {
  const f = await fixture();
  try {
   const imported = await f.import(); await f.files.sync(f.upload, undefined, 10); await f.sync.sync(f.content);
   const row = (await f.sync.things.snapshot()).filter(isLocalMediaAttachment).find(row => kind === 'linked' ? isLocalLinkedAttachment(row) : !isLocalLinkedAttachment(row))!;
   const id = (await f.files.remoteId(row.id))!, server = f.remote.get(id), before = f.annotations.length;
   await f.files.things.annotateFile({ id: row.id, title: 'Keep my edit' });
   if (changed === 'owner') server.author.id = 'other';
   if (changed === 'target') server.targetId = 'another-parent';
   if (changed === 'content') { if (kind === 'linked') server.crystal.url = 'https://example.invalid/changed.png'; else server.crystal.size++; }
   await f.files.sync(f.upload, undefined, 0);
   assert.equal(f.annotations.length, before); assert.equal((await f.files.status()).find(entry => entry.id === row.id)?.state, 'error');
   assert.equal((await f.files.things.get(row.id)).crystal.title, 'Keep my edit'); assert.ok(await f.sync.view(imported.roots[0]));
  } finally { await f.db.close(); }
 }
});

test('linked import quota failures leave no partial journal and a retired worker cannot commit its late link receipt', async () => {
 const factory = createQuotaFactory({ records: 2 }), f = await fixture(factory);
 try {
  await assert.rejects(f.import(), /space|quota|storage/i); assert.deepEqual(await f.sync.things.snapshot(), []); assert.deepEqual(await f.files.status(), []); assert.deepEqual(await f.sync.status(), []);
  factory.capacity.records = 100; await f.import();
  let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pending = f.files.sync({ ...f.upload, link: async (...args) => { const result = await f.upload.link!(...args); entered(); await held; return result; } }, undefined, 10);
  await started; f.retire(); release(); await assert.rejects(pending, /Workspace changed/);
  const records = await f.db.transaction(scope, 'readonly', {assertCurrent() {},onInvalidate:()=>()=>{}}, tx => tx.list<any>('account-files'));
  assert.equal(records.filter(row => row.value.linked).some(row => row.value.remote), false);
 } finally { await f.db.close(); }
});

test('direct URL selection waits for a working draft or post; template copies and consumed drafts keep independent receipt identities', async () => {
 const f = await fixture();
 try {
  const request = {requestId:crypto.randomUUID(),url:'https://example.invalid/a.png',mediaKind:'file' as const};
  const selected = await f.files.things.saveLinkedFile(request); assert.deepEqual(await f.files.things.saveLinkedFile(request), selected);
  await assert.rejects(f.files.things.saveLinkedFile({...request,url:'https://example.invalid/b.mp4'}), /different content/);
  await f.files.sync(f.upload); assert.equal(f.links.length, 0);
  const drafts = new AccountDraftSync(f.db,scope,f.lease,f.files.draftHooks);
  const content: DraftContent = { name:'URL working draft',surface:'post',context:'post:new:',attachmentIds:[selected.id],snapshot:JSON.stringify({text:'Offline linked post',attachments:[{id:selected.id}]}) };
  const save = {operation:'save',id:'working',writeId:'working-save',revision:0,content};
  await drafts.drafts.request(save);
  const template = await drafts.drafts.createTemplate('template',content), copy = await drafts.drafts.request({operation:'instantiate',id:'copied',sourceId:'template'});
  assert.notEqual(copy.draft.attachmentIds[0],template.attachmentIds[0]);
  const post = await f.sync.things.savePost({shareId:'copied-post',thingtime:['post'],crystal:{type:'text',text:'Offline linked post'},attachmentIds:copy.draft.attachmentIds});
  await drafts.drafts.request({operation:'delete',id:'copied',revision:copy.draft.revision});
  assert.equal((await f.files.readLinked(copy.draft.attachmentIds[0]))?.targetId,post.id);
  const remoteDrafts = new Map<string,AccountDraft>(), draftWrites:string[] = [];
  const draftTransport:AccountDraftTransport = {read:async id=>{if(!remoteDrafts.has(id))throw{status:404};return remoteDrafts.get(id)!;},write:async command=>{
   draftWrites.push(command.id); if(command.operation==='delete'){remoteDrafts.delete(command.id);return{ok:true};}
   for(const id of command.content.attachmentIds)f.remote.get(id).targetId=command.id;
   const draft:AccountDraft={...command.content,id:command.id,mode:command.mode,revision:command.revision+1,createdAt:'2026-10-23T00:00:00Z',updatedAt:'2026-10-23T00:00:00Z'};remoteDrafts.set(draft.id,draft);return{ok:true,draft};
  }};
  await f.files.sync(f.upload,undefined,10); await drafts.sync(draftTransport); await f.sync.sync(f.content);
  assert.deepEqual(draftWrites.sort(),['template','working']); assert.equal(f.links.length,3); assert.equal(new Set(f.links.map(row=>row.requestId)).size,3);
  assert.ok(f.parents.has(post.id)); assert.equal((await drafts.status()).find(row=>row.id==='copied')?.state,'synced');
  const retention = {...f.upload,retention:async()=>{throw Error('URL refresh must not request a byte descriptor');},bytes:async()=>{throw Error('URL refresh must not request bytes');}};
  await f.files.retainDraft(retention,remoteDrafts.get('template')!,(content,admit)=>drafts.remember(remoteDrafts.get('template')!,Date.now()+1000,content,admit));
  assert.equal((await drafts.drafts.request(undefined,{id:'template'})).attachments[0].url,selected.crystal.url);
  const before = await f.files.things.get(template.attachmentIds[0]), aborted = new AbortController();
  await assert.rejects(f.files.retainDraft(retention,remoteDrafts.get('template')!,async (_content,admit)=>{aborted.abort();return f.db.transaction(scope,'readwrite',f.lease,admit);},aborted.signal));
  assert.deepEqual(await f.files.things.get(template.attachmentIds[0]),before,'retired metadata refresh cannot change local URL rows');
  await f.files.retainPost(retention,f.parents.get(post.id)!,admit=>f.sync.remember(f.parents.get(post.id)!,Date.now()+1000,admit));
  assert.equal((await bundleFromPlan((await f.export([post.id])).plan)).manifest.links?.length,1);
 } finally {await f.db.close();}
});

test('malformed URL receipts never bind and expired unsubmitted URL selections close locally without a request', async () => {
 for(const bad of ['id','url','kind','type','time'] as const){
  const f=await fixture();try{
   const selected=await f.files.things.saveLinkedFile({requestId:crypto.randomUUID(),url:'https://example.invalid/a.png',mediaKind:'file'});
   await f.sync.things.savePost({shareId:'post',thingtime:['post'],crystal:{type:'text',text:'Private'},attachmentIds:[selected.id]});
   await f.files.sync({...f.upload,link:async(...args)=>{const result=await f.upload.link!(...args);if(bad==='time')result.updatedAt='invalid';else Object.assign(result.attachment,bad==='id'?{id:'att_'+'0'.repeat(64)}:bad==='url'?{url:'https://example.invalid/changed.png'}:bad==='kind'?{mediaKind:'image'}:{contentType:'text/plain'});return result;}});
   await f.sync.sync(f.content);assert.equal(f.parents.size,0);assert.equal((await f.files.status())[0].state,'error');assert.equal(await f.files.remoteId(selected.id),null);
  }finally{await f.db.close();}
 }
 const f=await fixture();try{
  await f.files.things.saveLinkedFile({requestId:crypto.randomUUID(),url:'https://example.invalid/a.png'});
  for(let n=0;n<721;n++)f.tick();await f.files.sync(f.upload);assert.equal(f.links.length,0);assert.deepEqual(await f.files.status(),[]);
 }finally{await f.db.close();}
});
