// Real frozen DocumentStore/CollectionProvider and installed MongoDB BSON; synthetic data only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { BSON, Binary, Decimal128, Double, Int32, Long, ObjectId } from 'mongodb';
import { openSqliteDocumentStore } from './sqliteStore.ts';
import { createCollectionProvider } from './collectionProvider.ts';
const root=dirname(process.env.PROBE_REPORT), marker=join(root,'committed.json');
const phase=existsSync(marker)?'restart-read':'write';
const report={phase,node:process.version,platform:process.platform,arch:process.arch,checks:[],passed:false};
const check=name=>report.checks.push(name);
const expected=BSON.serialize({_id:new ObjectId('0123456789abcdef01234567'),text:'SQLite 🧪 persistence',date:new Date('2026-11-12T00:00:00Z'),binary:new Binary(Buffer.from([0,1,255]),128),decimal:Decimal128.fromString('123.4500'),long:Long.fromString('9007199254740993'),int:new Int32(7),double:new Double(7.5),nested:{nil:null}});
const expectedHash=createHash('sha256').update(expected).digest('hex');
const decode=bytes=>BSON.deserialize(bytes,{promoteValues:false,promoteLongs:false,promoteBuffers:false});
let primitive,provider;
try {
 const memory=new DatabaseSync(':memory:'); report.sqliteVersion=memory.prepare('select sqlite_version() as version').get().version;memory.close();check('real-node-sqlite');
 primitive=await openSqliteDocumentStore(join(root,'primitive.sqlite'));
 const address={collection:'things',key:'typed'};
 if(phase==='write'){
  await primitive.transaction(tx=>tx.insert(address,expected));
  await assert.rejects(primitive.transaction(async tx=>{tx.put(address,BSON.serialize({wrong:true}));await Promise.resolve();throw new Error('rollback-witness');}),/rollback-witness/);
  await primitive.transaction(tx=>assert.deepEqual(tx.read(address),Uint8Array.from(expected)));check('async-rollback');
  await assert.rejects(primitive.transaction(tx=>{try{tx.insert(address,expected);}catch{};}),error=>error.code==='DUPLICATE_DOCUMENT');check('caught-error-aborts');
  await primitive.transaction(tx=>{tx.insert({collection:'things',key:'z'},expected);assert.equal(tx.scan('things',{limit:1}).nextAfter,'typed');assert.equal(tx.scan('things',{limit:1,after:'typed'}).documents[0].key,'z');});check('primitive-pagination');
  await primitive.close();primitive=await openSqliteDocumentStore(join(root,'primitive.sqlite'));check('close-reopen');
 }
 await primitive.transaction(tx=>assert.deepEqual(tx.read(address),Uint8Array.from(expected)));check('byte-exact-bson');
 const typed=decode(expected);assert.ok(typed._id instanceof ObjectId);assert.ok(typed.date instanceof Date);assert.ok(typed.binary instanceof Binary);assert.ok(typed.decimal instanceof Decimal128);assert.ok(typed.long instanceof Long);assert.ok(typed.int instanceof Int32);assert.ok(typed.double instanceof Double);check('bson-types');
 provider=createCollectionProvider(await openSqliteDocumentStore(join(root,'collections.sqlite')));
 const definition={unique:[{name:'email',path:['email'],sparse:false,multikey:false}]};
 if(phase==='write'){
  await provider.transaction(tx=>{tx.defineCollection('users',definition);tx.collection('users').insert(BSON.serialize({_id:'a',email:'a@example.invalid',count:new Int32(1),typed}));tx.collection('users').insert(BSON.serialize({_id:'b',email:'b@example.invalid',count:new Int32(2)}));});
  await assert.rejects(provider.transaction(tx=>{const c=tx.collection('users');c.updateOne({op:'eq',path:['_id'],value:'a'},[{op:'increment',path:['count'],amount:10}]);try{c.insert(BSON.serialize({_id:'c',email:'b@example.invalid'}));}catch{}}),error=>error.code==='DUPLICATE_UNIQUE_KEY');check('collection-unique-rollback');
  await provider.transaction(tx=>{const c=tx.collection('users');assert.equal(decode(c.find({limit:1}).documents[0]).count.valueOf(),1);assert.equal(c.find({limit:1}).nextAfter,'a');assert.equal(c.find({after:'a',limit:1}).documents.length,1);assert.equal(c.find({filter:{op:'eq',path:['count'],value:new Double(1)},limit:4}).documents.length,0);const result=c.updateOne({op:'eq',path:['_id'],value:'a'},[{op:'increment',path:['count'],amount:2}]);assert.equal(decode(result.document).count.valueOf(),3);});check('collection-query-update-pagination-type-equality');
  await provider.close();provider=createCollectionProvider(await openSqliteDocumentStore(join(root,'collections.sqlite')));check('collection-close-reopen');
 }
 await provider.transaction(tx=>{tx.defineCollection('users',definition);const c=tx.collection('users');const row=decode(c.find({filter:{op:'eq',path:['_id'],value:'a'},limit:1}).documents[0]);assert.equal(row.count.valueOf(),3);assert.ok(row.typed.long instanceof Long);assert.equal(row.typed.long.toString(),'9007199254740993');assert.equal(c.find({limit:10}).documents.length,2);assert.equal(decode(c.find({filter:{op:'eq',path:['_id'],value:'b'},limit:1}).documents[0]).count.valueOf(),phase==='write'?2:5);});check('collection-persisted-definition-and-data');
 if(phase==='write'){
  // Commit a final write and leave both handles open: external termination tests WAL recovery.
  await primitive.transaction(tx=>tx.insert({collection:'restart',key:'unclosed'},BSON.serialize({committed:true})));
  await provider.transaction(tx=>tx.collection('users').updateOne({op:'eq',path:['_id'],value:'b'},[{op:'increment',path:['count'],amount:3}]));
  writeFileSync(marker,JSON.stringify({expectedHash}));check('unclosed-commit-ready');
 }else{
  assert.equal(JSON.parse(readFileSync(marker)).expectedHash,expectedHash);
  await primitive.transaction(tx=>assert.equal(BSON.deserialize(tx.read({collection:'restart',key:'unclosed'})).committed,true));check('app-process-restart-committed-data');
  await provider.close();await primitive.close();check('final-close');
 }
 report.bsonSha256=expectedHash;report.passed=true;
}catch(error){report.error={name:error.name,code:error.code,message:error.message,stack:error.stack};}
writeFileSync(process.env.PROBE_REPORT,JSON.stringify(report,null,2));
setInterval(()=>{},1000);
