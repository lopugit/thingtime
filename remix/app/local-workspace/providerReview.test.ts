import { createQuotaFactory } from './storageTestFixture';
import { openDeviceVaultValue, sealDeviceVaultValue } from '../passwords/vaultCrypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';
import { LocalProviderVault } from './providerVault';
import { parseUserVaultWriteAcknowledgment, type UserVaultWrite } from '../api/utils/lopu/userVaultWriteContract';
const origin = 'https://fixture.example', scope = { kind: 'account', origin, ownerId: 'fixture-owner', dataPlane: 'home' } as const;
const phrase = 'Synthetic separate device passphrase', gate = { assertCurrent() {}, onInvalidate: () => () => {} };
const command = (action = 'save-secret', values: Record<string, unknown> = {}, id = crypto.randomUUID(), revision = 0) => ({
 action, id, revision, writeId: crypto.randomUUID(), ...(action === 'save-secret' ? { name: 'Fixture', key: 'FIXTURE_KEY', value: ' synthetic secret\n', groupId: null } : {}), ...values
});
async function fixture(selected: WorkspaceScope = scope, factory = new IDBFactory()) {
 const db = new WorkspaceDatabase(factory, crypto.randomUUID(), 10_000, IDBKeyRange), vault = new LocalProviderVault(db, selected, gate, origin);
 await vault.unlock(phrase, true); return { db, vault, close: async () => { vault.dispose(); await db.close(); } };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function remote() {
 const values = new Map<string, string>(), receipts = new Map<string, { command: string; receipt: ReturnType<typeof parseUserVaultWriteAcknowledgment> }>(), calls: UserVaultWrite[] = [];
 let counter = 0;
 const transport = { async write(input: UserVaultWrite, _signal: AbortSignal) {
  calls.push(structuredClone(input)); const replay = receipts.get(input.writeId);
  if (replay) { assert.equal(JSON.stringify(input), replay.command); return structuredClone(replay.receipt); }
  if ((values.get(input.id) ?? null) !== input.expectedVersion) throw Object.assign(Error('synthetic remote error must not persist'), { status: 409 });
  const version = 'vault-state-v1:' + (++counter).toString(16).padStart(64,'0');
  if (input.action === 'delete') values.delete(input.id); else values.set(input.id, version);
  const receipt = parseUserVaultWriteAcknowledgment({ id: input.id, writeId: input.writeId, action: input.action, expectedVersion: input.expectedVersion, resultVersion: input.action === 'delete' ? null : version });
  receipts.set(input.writeId, { command: JSON.stringify(input), receipt }); return receipt;
 } };
 return { values, calls, transport };
}
const stored = (db: WorkspaceDatabase) => db.transaction(scope, 'readonly', gate, async tx => ({ records: await tx.list('provider-vault-records'), commands: await tx.list('provider-vault-commands') }));

const empty = { metadata: async () => ({ complete: true as const, groups: [], entries: [] }) };
const reject = { write: async () => { throw Object.assign(Error('refused'), { status: 409 }); } };
const version = 'vault-state-v1:'+'b'.repeat(64), time = '2026-10-17T00:00:00.000Z';
const secretMetadata = (id: string, groupId: string | null = null) => ({ id, kind: 'secret' as const, name: 'Account fixture', key: 'REMOTE_KEY', hasValue: true as const, groupId, version, createdAt: time, updatedAt: time });

test('reviewed environment copy atomically remaps children and queues fresh creates in dependency order', async () => {
 const f = await fixture();
 try {
  const group = command('create-group', { name: 'Local environment' }), child = command('save-secret', { groupId: group.id }), unrelated = command();
  await f.vault.mutate(group); await f.vault.mutate(child); await f.vault.mutate(unrelated); await f.vault.synchronize(reject);
  const review = await f.vault.reviewRefused(group.id); assert.equal(review.canCopy,true); assert.deepEqual(new Set(review.items.map(x=>x.id)),new Set([group.id,child.id]));
  assert.ok(!JSON.stringify(review).includes('synthetic secret'));
  const result = await f.vault.resolveRefused(group.id,review.reviewId,'copy',empty);
  const listed = await f.vault.list(); assert.equal(listed.groups[0].id,result.copiedIds[group.id]);
  assert.equal(listed.entries.find(x=>x.id===result.copiedIds[child.id])?.groupId,result.copiedIds[group.id]);
  assert.equal((await f.vault.reveal(result.copiedIds[child.id])).value,child.value);
  const r=remote(); assert.equal((await f.vault.synchronize(r.transport)).completed,3);
  assert.deepEqual(r.calls.map(x=>x.id),[unrelated.id,result.copiedIds[group.id],result.copiedIds[child.id]]);
  assert.equal(r.calls.every(x=>x.expectedVersion===null),true);
  assert.ok(!JSON.stringify(await stored(f.db)).includes('synthetic secret'));
 } finally { await f.close(); }
});
test('account resolution includes historical group moves and preserves unrelated commands', async () => {
 const f=await fixture();
 try {
  const group=command('create-group',{name:'Group'}), child=command('save-secret',{groupId:group.id}), other=command();
  await f.vault.mutate(group); await f.vault.mutate(child); await f.vault.mutate(command('move-entry',{groupId:null},child.id,1)); await f.vault.mutate(other); await f.vault.synchronize(reject);
  const review=await f.vault.reviewRefused(group.id); assert.equal(review.items.length,2);
  await f.vault.resolveRefused(group.id,review.reviewId,'account',empty);
  assert.deepEqual((await f.vault.syncStatus()).map(x=>x.recordId),[other.id]); assert.deepEqual((await f.vault.list()).entries.map(x=>x.id),[other.id]);
 } finally { await f.close(); }
});
test('account choice adopts actual metadata even at the same version and never retains local pending values', async()=>{
 const f=await fixture(), id=crypto.randomUUID(), metadata={metadata:async()=>({complete:true as const,groups:[],entries:[secretMetadata(id)]})};
 try {
  await f.vault.reconcileMetadata(metadata); const entry=(await f.vault.list()).entries[0];
  await f.vault.mutate(command('save-secret',{name:'Local changed'},id,entry.revision)); await f.vault.synchronize(reject);
  const review=await f.vault.reviewRefused(id); await f.vault.resolveRefused(id,review.reviewId,'account',metadata);
  const after=(await f.vault.list()).entries[0]; assert.equal(after.name,'Account fixture'); assert.equal(after.valueAvailableOffline,false); assert.ok(after.revision>entry.revision);
  await assert.rejects(f.vault.reveal(id),/not been retained/); assert.deepEqual(await f.vault.syncStatus(),[]);
 } finally {await f.close();}
});
test('remote-only values cannot be copied but account metadata may adopt a new environment', async()=>{
 const f=await fixture(), id=crypto.randomUUID(), groupId=crypto.randomUUID();
 try{
  await f.vault.reconcileMetadata({metadata:async()=>({complete:true,groups:[],entries:[secretMetadata(id)]})});
  await f.vault.mutate(command('move-entry',{groupId:null},id,1)); await f.vault.synchronize(reject);
  const review=await f.vault.reviewRefused(id); assert.equal(review.canCopy,false); const before=await stored(f.db);
  await assert.rejects(f.vault.resolveRefused(id,review.reviewId,'copy',empty),/Retain/); assert.deepEqual(await stored(f.db),before);
  await f.vault.resolveRefused(id,review.reviewId,'account',{metadata:async()=>({complete:true,groups:[{id:groupId,name:'Moved account environment',version,createdAt:time,updatedAt:time}],entries:[secretMetadata(id,groupId)]})});
  assert.equal((await f.vault.list()).entries[0].groupId,groupId); assert.equal((await f.vault.list()).groups[0].id,groupId);
 } finally{await f.close();}
});
test('stale review and edits during account fetch both preserve all newer encrypted work',async()=>{
 const f=await fixture(), started=deferred(),release=deferred();
 try{
  const one=command();await f.vault.mutate(one);await f.vault.synchronize(reject);const review=await f.vault.reviewRefused(one.id);
  await f.vault.mutate(command('save-secret',{value:'newer edit'},one.id,1));const before=await stored(f.db);
  await assert.rejects(f.vault.resolveRefused(one.id,review.reviewId,'account',empty),/after this review/);assert.deepEqual(await stored(f.db),before);
  const fresh=await f.vault.reviewRefused(one.id);
  const pending=f.vault.resolveRefused(one.id,fresh.reviewId,'account',{metadata:async()=>{started.resolve();await release.promise;return empty.metadata();}});
  await started.promise;await f.vault.mutate(command('save-secret',{value:'latest edit'},one.id,2));const latest=await stored(f.db);release.resolve();
  await assert.rejects(pending,/during resolution/);assert.deepEqual(await stored(f.db),latest);
 }finally{release.resolve();await f.close();}
});
test('uncertain frozen requests cannot be discarded and anonymous scope never reads account metadata',async()=>{
 const f=await fixture(),anon=await fixture({kind:'anonymous'});let calls=0;
 try{
  const one=command();await f.vault.mutate(one);await f.vault.synchronize({write:async()=>{throw Error('lost');}});const before=await stored(f.db);
  await assert.rejects(f.vault.reviewRefused(one.id),/first waiting change/);assert.deepEqual(await stored(f.db),before);
  await assert.rejects(anon.vault.resolveRefused(one.id,'review','account',{metadata:async()=>{calls++;return empty.metadata();}}),/Anonymous/);assert.equal(calls,0);
 }finally{await f.close();await anon.close();}
});
test('invalid metadata, cancellation and lock all refuse before local resolution commit',async()=>{
 for(const mode of ['invalid','cancel','lock']){
  const f=await fixture(),controller=new AbortController();
  try{
   const one=command();await f.vault.mutate(one);await f.vault.synchronize(reject);const review=await f.vault.reviewRefused(one.id),before=await stored(f.db);
   await assert.rejects(f.vault.resolveRefused(one.id,review.reviewId,'copy',{metadata:async()=>{
    if(mode==='lock')f.vault.lock();if(mode==='cancel')controller.abort();
    return mode==='invalid'?{complete:false,groups:[],entries:[]} as any:empty.metadata();
   }},controller.signal));assert.deepEqual(await stored(f.db),before);
  }finally{await f.close();}
 }
});
test('a later frozen dependent is never rewritten even after its claim expired',async()=>{
 const f=await fixture();
 try{
  const group=command('create-group',{name:'Group'}),child=command('save-secret',{groupId:group.id});
  await f.vault.mutate(group);await f.vault.mutate(child);await f.vault.synchronize(reject);
  // A retained transmission from another runtime must not be treated as pending.
  const rows=await f.db.transaction(scope,'readonly',gate,tx=>tx.list<any>('provider-vault-commands'));
  const row=rows.find(x=>x.value.recordId===child.id)!,op=(f.vault as any).operation(),owner=await (f.vault as any).context;
  const local=JSON.parse(await openDeviceVaultValue(owner,op.key,`command:${child.id}:${row.value.id}`,row.value.encryptedValue));
  const {revision:_revision,...wire}=local;
  const encryptedValue=await sealDeviceVaultValue(owner,op.key,`command:${child.id}:${row.value.id}`,JSON.stringify({...wire,expectedVersion:null}));
  await f.db.transaction(scope,'readwrite',gate,tx=>tx.put('provider-vault-commands',row.id,{...row.value,encryptedValue,state:'frozen',claim:'expired',claimUntil:1}));
  const before=await stored(f.db);await assert.rejects(f.vault.reviewRefused(group.id),{code:'VAULT_UNCERTAIN'});assert.deepEqual(await stored(f.db),before);
 }finally{await f.close();}
});
test('a second unlocked tab wins resolution once and the old review cannot create duplicate copies',async()=>{
 const f=await fixture(),second=new LocalProviderVault(f.db,scope,gate,origin),started=deferred(),release=deferred();
 try{
  await second.unlock(phrase);const one=command();await f.vault.mutate(one);await f.vault.synchronize(reject);
  const review=await f.vault.reviewRefused(one.id);
  const old=f.vault.resolveRefused(one.id,review.reviewId,'copy',{metadata:async()=>{started.resolve();await release.promise;return empty.metadata();}});
  await started.promise;const result=await second.resolveRefused(one.id,review.reviewId,'copy',empty);const before=await stored(f.db);release.resolve();
  await assert.rejects(old,/during resolution/);assert.deepEqual(await stored(f.db),before);assert.equal((await f.vault.list()).entries[0].id,result.copiedIds[one.id]);
 }finally{release.resolve();second.dispose();await f.close();}
});
test('cold unlock retains the same review and no account authority is stored with it',async()=>{
 const f=await fixture();let reopened:LocalProviderVault|undefined;
 try{
  const one=command();await f.vault.mutate(one);await f.vault.synchronize(reject);const review=await f.vault.reviewRefused(one.id);
  f.vault.dispose();reopened=new LocalProviderVault(f.db,scope,gate,origin);await reopened.unlock(phrase);
  assert.deepEqual(await reopened.reviewRefused(one.id),review);
  await reopened.resolveRefused(one.id,review.reviewId,'account',empty);assert.deepEqual(await reopened.syncStatus(),[]);
 }finally{reopened?.dispose();await f.close();}
});
test('partial account snapshots and corrupt sequence cannot erase the refused queue',async()=>{
 const f=await fixture();
 try{
  const one=command();await f.vault.mutate(one);await f.vault.synchronize(reject);let review=await f.vault.reviewRefused(one.id),before=await stored(f.db);
  await assert.rejects(f.vault.resolveRefused(one.id,review.reviewId,'account',{metadata:async()=>({complete:true,groups:[],entries:[secretMetadata(one.id,'missing-group')]})}),/invalid vault metadata/);assert.deepEqual(await stored(f.db),before);
  await f.db.transaction(scope,'readwrite',gate,tx=>tx.put('provider-vault-keys','sequence',0));review=await f.vault.reviewRefused(one.id);before=await stored(f.db);
  await assert.rejects(f.vault.resolveRefused(one.id,review.reviewId,'copy',empty),/sequence limit/);assert.deepEqual(await stored(f.db),before);
 }finally{await f.close();}
});
test('device quota rolls back command removal and every copied record together',async()=>{
 const f=await fixture(scope, createQuotaFactory());
 try{
  const one=command();await f.vault.mutate(one);await f.vault.synchronize(reject);const review=await f.vault.reviewRefused(one.id);
  const usage=await f.db.transaction(scope,'readonly',gate,tx=>tx.usage());
  await f.db.transaction(scope,'readwrite',gate,async tx=>{
   for(let i=0;i<3;i++)await tx.putBytes(`fill-${i}`,new Uint8Array(16*1024*1024));
   await tx.putBytes('fill-last',new Uint8Array(16*1024*1024-usage.bytes));
  });
  const before=await stored(f.db),full=await f.db.transaction(scope,'readonly',gate,tx=>tx.usage());
  await assert.rejects(f.vault.resolveRefused(one.id,review.reviewId,'copy',empty),/workspace is full/);
  assert.deepEqual(await stored(f.db),before);assert.deepEqual(await f.db.transaction(scope,'readonly',gate,tx=>tx.usage()),full);
 }finally{await f.close();}
});
