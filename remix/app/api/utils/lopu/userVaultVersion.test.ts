import assert from 'node:assert/strict';
import test from 'node:test';
import { BSON } from 'mongodb';
import { userVaultSnapshotVersion, userVaultSnapshotMatch, validUserVaultSnapshotVersion } from './userVaultVersion';
const doc = () => ({ _id: 'fixture-database-id', shareId: 'fixture-vault-id', ownerId: 'fixture-owner', schemaVersion: 2, thingtime: ['data'], acl: ['tt:user'], createdAt: new Date('2026-10-17T00:00:00.000Z'), updatedAt: new Date('2026-10-17T00:00:01.000Z'), crystal: { systemType: 'tt.lopuUserVault', schemaVersion: 1, recordKind: 'secret', name: 'Before', key: 'KEY', updatedAt: '2026-10-17T00:00:00.000Z', encryptedValue: { cipherText: 'synthetic-ciphertext', iv: 'synthetic-iv', tag: 'synthetic-tag' } } });
test('actual Thing state detects generic edits despite an unchanged embedded timestamp', () => {
 const before = doc(), after = structuredClone(before); after.crystal.name='Generic editor name';
 assert.equal(after.crystal.updatedAt,before.crystal.updatedAt); assert.notEqual(userVaultSnapshotVersion(before),userVaultSnapshotVersion(after));
 assert.equal(userVaultSnapshotVersion(before),userVaultSnapshotVersion(structuredClone(before)));
});
test('same-millisecond credential replacement, ACL changes and physical recreation produce distinct versions', () => {
 const before=doc(), initial=userVaultSnapshotVersion(before);
 for(const change of [(row:any)=>row.crystal.encryptedValue.cipherText='new-ciphertext',(row:any)=>row.acl=['tt:all'],(row:any)=>row._id='new-row-id',(row:any)=>row.ownerId='different-owner',(row:any)=>row.tags=['edited']]){
  const after=structuredClone(before);change(after);assert.equal(after.updatedAt.getTime(),before.updatedAt.getTime());assert.notEqual(initial,userVaultSnapshotVersion(after));
 }
 assert.equal(validUserVaultSnapshotVersion(initial),true);
 for(const value of ['', initial+'x',initial.replace('v1:','v2:'),null,{},42])assert.equal(validUserVaultSnapshotVersion(value),false);
});
test('atomic state filters compare the full document as a literal', () => {
 const before=doc(), filter=userVaultSnapshotMatch(before);
 assert.equal(filter._id,before._id);assert.equal(filter.ownerId,before.ownerId);
 assert.deepEqual(filter.$expr,{$eq:['$$ROOT',{$literal:before}]});
 const withNull={...before,folderId:null};assert.notEqual(userVaultSnapshotVersion(before),userVaultSnapshotVersion(withNull));
 const hostile={...before,crystal:{$ne:null,reference:'$$ROOT'}};
 assert.deepEqual(userVaultSnapshotMatch(hostile).$expr,{$eq:['$$ROOT',{$literal:hostile}]});
});
test('BSON identity and dates cannot collide with their JSON string representations',()=>{
 const oid=new BSON.ObjectId(), before={...doc(),_id:oid};
 assert.notEqual(userVaultSnapshotVersion(before),userVaultSnapshotVersion({...before,_id:oid.toHexString()}));
 assert.notEqual(userVaultSnapshotVersion(before),userVaultSnapshotVersion({...before,createdAt:before.createdAt.toISOString()}));
 const binary={...before,extension:new BSON.Binary(Buffer.from('fixture'))};
 assert.notEqual(userVaultSnapshotVersion(binary),userVaultSnapshotVersion({...binary,extension:'Zml4dHVyZQ=='}));
});
test('previously unknown root fields participate without an allowlist migration',()=>{
 const before=doc();assert.notEqual(userVaultSnapshotVersion(before),userVaultSnapshotVersion({...before,futureEnvelopeField:{changed:true}}));
});
test('missing identities, unusable timestamps and oversized state fail closed',()=>{
 for(const row of [{...doc(),_id:undefined},{...doc(),ownerId:''},{...doc(),updatedAt:'invalid'},{...doc(),crystal:{value:'x'.repeat(1024*1024)}}])assert.throws(()=>userVaultSnapshotVersion(row));
});
