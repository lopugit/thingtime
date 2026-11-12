import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalHomeBootstrap, isDeviceHomeProof } from './localHomeBootstrap';
import { createLocalRootFallback } from './rootFallback';
import { RootDataUnavailableError } from '../utils/rootDataRecovery';
const origin = 'http://127.0.0.1:29741';
const proof = { documentId: '01234567-89ab-4def-8123-0123456789ab', featureVersion: '1.0.0', origin, profile: 'fresh-owned', canInitialize: true };
function fixture() {
 const values = new Map<string, string>();
 const selection = createLocalRootFallback({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, origin);
 let state = { generation: 0, pending: false }, calls = 0;
 const controller = createLocalHomeBootstrap({ origin, identity: { read: () => state }, selection, requestHost: async () => { calls++; return proof; } });
 return { values, selection, controller, change: () => { state = { generation: 1, pending: true }; }, calls: () => calls };
}
test('first device home requires explicit host-confirmed initialization and remains unauthenticated', async () => {
 const x = fixture(), failure = new RootDataUnavailableError(true);
 assert.equal(x.selection.read(failure), null);
 assert.equal(await x.controller.available(), true);
 assert.equal(x.values.size, 0, 'status never writes a selection');
 await x.controller.initialize();
 const data = x.selection.read(failure)!;
 assert.equal(data.deviceOnly, true); assert.equal(data.user, null); assert.equal(data.dataPlane, 'home');
 assert.equal(data.titlePrefix,'[Device]');assert.equal(data.offlineWorkspace, undefined); assert.deepEqual(data.envFromCookie, {});assert.equal(data.dataEnvironment, null);
 assert.equal(await x.controller.available(), false);
});
test('existing confirmed, invalidated or account pointers are never overwritten', async () => {
 for (const prior of ['anonymous','account','unknown',JSON.stringify(['account',1,origin,'owner','home'])]) {
  const x = fixture();x.values.set('thingtime:local-workspace-root:v1', prior);
  assert.equal(await x.controller.available(), false);await assert.rejects(x.controller.initialize());
  assert.equal(x.calls(),0);assert.equal([...x.values.values()][0],prior);
 }
});
test('pending identity refuses admission and a changed generation refuses late native completion', async () => {
 const x = fixture();x.change();assert.equal(await x.controller.available(),false);await assert.rejects(x.controller.initialize());assert.equal(x.calls(),0);
 const y = fixture();let finish!: (value: unknown) => void;let generation=0;
 const controller=createLocalHomeBootstrap({origin,identity:{read:()=>({generation,pending:false})},selection:y.selection,requestHost:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=controller.initialize();generation++;finish(proof);await assert.rejects(pending);assert.equal(y.values.size,0);
});
test('feature major, exact origin, explicit fresh profile and approval all fail closed', () => {
 for (const bad of [null,{}, {...proof,featureVersion:'2.0.0'}, {...proof,featureVersion:'1'}, {...proof,origin:'https://thingtime.com'}, {...proof,profile:'account'}, {...proof,canInitialize:false}]) {
  const x=fixture();assert.equal(isDeviceHomeProof(bad,origin),false);assert.throws(()=>x.selection.initializeDeviceHome(bad));assert.equal(x.values.size,0);
 }
 assert.equal(isDeviceHomeProof(proof,'https://thingtime.com'),false);
});
test('a competing pointer while native approval is pending prevents overwrite', async () => {
 const x=fixture();let finish!: (value: unknown)=>void;
 const controller=createLocalHomeBootstrap({origin,identity:{read:()=>({generation:0,pending:false})},selection:x.selection,requestHost:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=controller.initialize();x.selection.confirm(false,{kind:'account',origin,ownerId:'owner',dataPlane:'home'});finish(proof);
 await assert.rejects(pending);assert.equal(x.selection.read(new RootDataUnavailableError(true))?.offlineWorkspace?.ownerId,'owner');
});

test('initialize negotiates status before any host mutation and binds its exact document/version', async () => {
 const x=fixture(), calls: string[]=[];
 const controller=createLocalHomeBootstrap({origin,identity:{read:()=>({generation:0,pending:false})},selection:x.selection,requestHost:async (action,expected)=>{
  calls.push(action);if(action==='initialize')assert.deepEqual(expected,proof);return proof;
 }});
 await controller.initialize();assert.deepEqual(calls,['status','initialize']);
 for(const bad of [{...proof,featureVersion:'2.0.0'},{...proof,documentId:'invalid'}]){
  const y=fixture(), actions:string[]=[];
  const refused=createLocalHomeBootstrap({origin,identity:{read:()=>({generation:0,pending:false})},selection:y.selection,requestHost:async action=>{actions.push(action);return bad;}});
  await assert.rejects(refused.initialize());assert.deepEqual(actions,['status']);assert.equal(y.values.size,0);
 }
});
test('a late same-origin document replacement cannot select local identity', async () => {
 const x=fixture();let calls=0;
 const controller=createLocalHomeBootstrap({origin,identity:{read:()=>({generation:0,pending:false})},selection:x.selection,requestHost:async()=>++calls===1?proof:{...proof,documentId:'11234567-89ab-4def-8123-0123456789ab'}});
 await assert.rejects(controller.initialize());assert.equal(x.values.size,0);
});
