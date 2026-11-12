import assert from 'node:assert/strict';
import { mock } from 'node:test';
import Module from 'node:module';
import { ObjectId } from 'mongodb';
import * as originals from '../mongodb/collections.ts';
const calls: { store: string; operation: string; filter?: any; value?: any; options?: any }[] = [];
let thing: any = null;
const legacy = { _id: new ObjectId(), username:'legacy', email:'legacy@example.invalid', passwordHash:'synthetic', meta:{} };
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{defaultExport:{},namedExports:{...originals,
 getHomeThingsCollection: async()=>({
  findOne:async(filter:any)=>{calls.push({store:'home',operation:'find',filter});return thing;},
  insertOne:async(value:any,options:any)=>{calls.push({store:'home',operation:'insert',value,options});thing=value;return{insertedId:new ObjectId()};}
 }),
 getUsersCollection: async()=>({findOne:async(filter:any)=>{calls.push({store:'legacy',operation:'find',filter});return legacy;}})
}});
const load=(Module as any)._load;
(Module as any)._load=function(name: string,...args: unknown[]){
 if(name==='node:sqlite'||name.includes('nativeUserIdentities')||name.includes('nativeSessions')) throw Error('Hosted identity path imported native persistence');
 return Reflect.apply(load,this,[name,...args]);
};
const users=await import('../auth/users.ts');
assert.equal(await users.findUserByUsername(' LEGACY '),legacy);
assert.deepEqual(calls.map(x=>[x.store,x.filter]),[['home',{thingtime:'user','crystal.username':'legacy'}],['legacy',{username:'legacy'}]]);
calls.length=0;
assert.equal(await users.findUserByEmail(' LEGACY@EXAMPLE.INVALID '),legacy);
assert.deepEqual(calls[0].filter.uniqueKeys,users.userEmailKey('legacy@example.invalid'));
assert.deepEqual(calls[1].filter,{email:'legacy@example.invalid'});
calls.length=0;
assert.equal(await users.findUserById(String(legacy._id)),legacy);
assert.deepEqual(calls[0].filter,{thingtime:'user',shareId:String(legacy._id)});
assert.deepEqual(calls[1].filter,{_id:legacy._id});
const session={syntheticTransaction:true};calls.length=0;
const saved=await users.insertUser({username:'native-shape',ttid:'native-shape',email:'shape@example.invalid',passwordHash:'synthetic',displayName:'Shape',emailVerified:false,meta:{},createdAt:new Date(),updatedAt:new Date()},{session});
assert.equal(calls[0].store,'home');assert.equal(calls[0].operation,'insert');assert.equal(calls[0].options.session,session);
assert.equal(calls[0].value.ownerId,saved._id);assert.equal(calls[0].value.shareId,saved._id);
assert.equal((await users.findUserByUsername('native-shape'))._id,saved._id); // Thing wins over the legacy twin.
console.log('canonical-mongo-identity-regression-ok');
