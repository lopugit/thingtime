import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { createSingleUseToken, consumeSingleUseToken } from '../auth/singleUseTokens';
const uri=process.env.THINGTIME_TOKEN_TEST_MONGO_URI;
if(!uri)throw Error('Require explicit disposable Mongo URI');
const selected=new URL(uri);
if(selected.hostname!=='127.0.0.1'||selected.username||selected.password||selected.pathname!=='/thingtime_token_repository_test')throw Error('Only owned loopback synthetic Mongo test database accepted');
const client=new MongoClient(uri,{serverSelectionTimeoutMS:3000});
try{
 await client.connect();const db=client.db(),collection=db.collection(physicalCollectionName('emailVerifications'));
 const getCollection=async()=>collection;
 await collection.createIndex({token:1},{unique:true});await collection.createIndex({expiresAt:1},{expireAfterSeconds:0});
 const issued=await createSingleUseToken({getCollection,schemaVersion:2,userId:'mongo-new-account',email:' MONGO@EXAMPLE.INVALID ',expiresInMs:60000});
 const stored=await collection.findOne({token:issued.token});
 assert.ok(stored);assert.equal(stored.token,issued.token);
 // An unchanged pre-feature binary can consume newly minted hosted links.
 const oldReader=await collection.findOneAndUpdate({token:issued.token,consumedAt:null,expiresAt:{$gt:new Date()}},{$set:{consumedAt:new Date()}},{returnDocument:'after'});
 assert.equal(oldReader!.userId,'mongo-new-account');
 assert.deepEqual(await consumeSingleUseToken(getCollection,issued.token),{ok:false,reason:'used'});
 const racing=await createSingleUseToken({getCollection,schemaVersion:2,userId:'mongo-race-account',email:'race@example.invalid',expiresInMs:60000});
 const claims=await Promise.all(Array.from({length:12},()=>consumeSingleUseToken(getCollection,racing.token)));
 assert.equal(claims.filter(x=>x.ok).length,1);assert.equal(claims.filter(x=>x.ok===false&&x.reason==='used').length,11);
 // Synthetic historical document reproduces the pre-change persisted format.
 const legacy='a'.repeat(64),now=new Date();
 await collection.insertOne({token:legacy,userId:'mongo-legacy-account',email:'legacy@example.invalid',schemaVersion:2,createdAt:now,expiresAt:new Date(now.getTime()+60000),consumedAt:null});
 assert.deepEqual(await consumeSingleUseToken(getCollection,legacy),{ok:true,userId:'mongo-legacy-account',email:'legacy@example.invalid'});
 assert.deepEqual(await consumeSingleUseToken(getCollection,legacy),{ok:false,reason:'used'});
 // Avoid TTL races while checking the exact atomic strict-expiry predicate.
 const expired=await createSingleUseToken({getCollection,schemaVersion:2,userId:'expired',email:'expired@example.invalid',expiresInMs:60000});
 await collection.updateOne({token:expired.token},{$set:{expiresAt:new Date(0)}});
 assert.deepEqual(await consumeSingleUseToken(getCollection,expired.token),{ok:false,reason:'expired'});
 assert.deepEqual(await consumeSingleUseToken(getCollection,'b'.repeat(64)),{ok:false,reason:'invalid'});
 console.log('genuine-mongo-token-compatibility-ok: original raw storage, old-reader rollback compatibility, atomic race, outstanding links, expiry, invalid');
}finally{await client.close();}
