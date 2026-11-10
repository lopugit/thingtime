import assert from 'node:assert/strict';
import test from 'node:test';
import { accountThemeTransport } from './themeTransport.client';
import { accountAlgorithmTransport } from './algorithmTransport.client';
import { accountWorkspaceLease, bindLocalWorkspace } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';

test('profile transports refuse offline entry and connectivity loss during capability discovery, then resume normally', async () => {
 const previous={window:globalThis.window,fetch:globalThis.fetch},nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try {
  for(const delegated of [false,true])for(const kind of ['themes','algorithms'] as const){
   const origin=`https://${kind}-${delegated}.connectivity.example`,principal={kind:'account' as const,origin,ownerId:'principal',dataPlane:'home'};
   const scope=delegated?{...principal,ownerId:'actor',delegatedBy:principal.ownerId}:principal;
   const state={online:false,loseConnectivity:true,discovery:0,writes:0};
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return state.online;}}});
   Object.assign(globalThis,{window:{location:{origin},dispatchEvent:()=>true},fetch:async(url:string)=>{
    if(url.includes('capabilities')){state.discovery++;if(state.loseConnectivity)state.online=false;return Response.json({schemaVersion:1,origin,features:{'api.auth-characters':{version:'1.0.0'},'api.themes-sync':{version:'1.6.0'},'api.algorithms-sync':{version:'1.5.0'},'api.mongodb-endpoint':{version:'1.1.0'}}});}
    state.writes++;return Response.json({ok:true,ownerId:scope.ownerId,dataPlane:'home',storagePlane:'home',complete:true,[kind]:[]});
   }});
   rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,principal,true);
   const transport=(kind==='themes'?accountThemeTransport:accountAlgorithmTransport)(scope,accountWorkspaceLease(scope));
   await assert.rejects(transport.snapshot(new AbortController().signal),/offline/);
   assert.equal(state.discovery,0);assert.equal(state.writes,0);
   state.online=true;
   await assert.rejects(transport.snapshot(new AbortController().signal),/offline/);
   assert.ok(state.discovery>0);assert.equal(state.writes,0,'a previously confirmed account cannot send after going offline during discovery');
   state.online=true;state.loseConnectivity=false;
   assert.deepEqual(await transport.snapshot(new AbortController().signal),[]);assert.equal(state.writes,1);
   // Retire this fixture origin's shared discovery cache before the next case.
   await assert.rejects(requireThingtimeCapability('api.themes-sync','2.0.0'),/incompatible/);
  }
 } finally {
  bindLocalWorkspace(true,rootIdentity.read().generation);Object.assign(globalThis,previous);
  if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete (globalThis as any).navigator;
 }
});
