import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { parseTransfer, serializeTransfer } from '../utils/thingTransfer/format';
import { bundleFromPlan } from '../utils/thingTransfer/browser';

const selected = { kind: 'account', origin: 'https://home-facade.example', ownerId: 'owner', dataPlane: 'custom-' + 'a'.repeat(64) } as const;

test('home facade uses normal library/import/export adapters without granting home remote authority', async () => {
 const original = { window: globalThis.window, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, fetch: globalThis.fetch };
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), nav = {onLine: false}; let requests = 0;
 Object.assign(globalThis, { window: { location: { origin: selected.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), IDBKeyRange, fetch: async () => { requests++; throw Error('Unexpected network'); } });
 Object.defineProperty(globalThis, 'navigator', {configurable:true,value:nav});
 const remote = async () => { requests++; throw Error('Unexpected remote adapter'); };
 const endpoints = {things:{get:remote,list:remote,create:remote,update:remote,import:remote,export:remote},actions:{run:remote}};
 const bind = (scope: {kind:'account';origin:string;ownerId:string;dataPlane:string}) => {
  rootIdentity.changed(); bindLocalWorkspace(false,rootIdentity.read().generation,scope);rootIdentity.confirm(rootIdentity.read().generation);
 };
 try {
  bind(selected);
  const destination:{localPlane?:'home'}={localPlane:'home'};
  const api:any = accountApi(endpoints,{id:selected.ownerId},selected.dataPlane,destination);
  destination.localPlane=undefined;
  const ordinary:any = accountApi(endpoints,{id:selected.ownerId},selected.dataPlane);
  const imported = await api.things.import({manifest:{format:'thingtime.transfer',version:1,roots:['folder'],things:[
   {id:'folder',thingtime:['folder'],crystal:{name:'Home bundle'}},
   {id:'theme',thingtime:['theme'],folderId:'folder',crystal:{name:'Peach',theme:{colors:{accent:'#bf8068'}}}},
   {id:'data',thingtime:['data'],folderId:'folder',crystal:{value:'Editable companion'}}
  ],files:[]}});
  assert.equal(imported.savedLocally,true);
  const folder = imported.roots[0];
  assert.equal((await api.things.list({folder})).things.length,2);
  assert.equal((await ordinary.things.list({})).things.length,0,'home content is never split into the selected database');
  const exported = await api.things.export({ids:[folder]});
  const transfer = parseTransfer(serializeTransfer((await bundleFromPlan(exported.plan)).manifest));
  assert.equal(transfer.things.length,3);assert.equal(transfer.things.find(row=>row.thingtime.includes('theme'))?.folderId,folder);
  const note = transfer.things.find(row=>row.thingtime.includes('data'))!;
  await api.things.update({id:note.id,crystal:{value:'Edited in home'}});
  assert.equal((await api.things.get({id:note.id})).thing.crystal.value,'Edited in home');
  const worker = accountWorkspaceWorker(selected,{localPlane:'home'});
  assert.equal((await worker.sync.status()).length,2);
  assert.equal((await worker.themes.status()).length,1);
  assert.equal(requests,0);
  nav.onLine=true;
  await assert.rejects(api.actions.run({}),/workspace|offline/i);
  await assert.rejects(worker.transport.read({id:note.id}),/workspace|offline/i);
  assert.equal(requests,0,'verified custom identity cannot send generic home requests');
  let themePasses=0,genericPasses=0;
  const syncThemes=worker.themes.sync.bind(worker.themes);
  worker.themes.sync=async(...args)=>{themePasses++;return syncThemes(...args);};
  worker.themeTransport.snapshot=async()=>[];
  worker.themeTransport.selection=async()=>({themeId:null,version:'theme-selection-v1:'+'a'.repeat(64)});
  worker.algorithmWorker!.transport.snapshot=async()=>[];
  worker.algorithmWorker!.transport.selection=async()=>({algorithmId:null,version:'algorithm-selection-v1:'+'a'.repeat(64)});
  worker.sync.sync=async()=>{genericPasses++;throw Error('Home must be selected before sending generic content');};
  worker.wake();
  for(let n=0;n<50&&!themePasses;n++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(themePasses,1,'dedicated home theme sender can run under the selected account fence');
  assert.equal(genericPasses,0,'a theme wake cannot start the generic home sender');
  assert.equal(requests,0);
  worker.stop();
  nav.onLine=false;
  const next = {...selected,dataPlane:'custom-'+'b'.repeat(64)};
  bind(next);
  await assert.rejects(api.things.get({id:note.id}),/workspace changed/i);
  const nextHome:any=accountApi(endpoints,{id:next.ownerId},next.dataPlane,{localPlane:'home'});
  assert.equal((await nextHome.things.get({id:note.id})).thing.crystal.value,'Edited in home');
  const nextOrdinary:any=accountApi(endpoints,{id:next.ownerId},next.dataPlane);
  assert.equal((await nextOrdinary.things.list({})).things.length,0);
  const foreign={...selected,ownerId:'other'};bind(foreign);
  const foreignHome:any=accountApi(endpoints,{id:foreign.ownerId},foreign.dataPlane,{localPlane:'home'});
  assert.equal((await foreignHome.things.list({})).things.length,0);
  assert.throws(()=>accountApi(endpoints,{id:foreign.ownerId},foreign.dataPlane,{localPlane:'arbitrary'} as any),/selected workspace or home/);
  rootIdentity.changed();bindLocalWorkspace(true,rootIdentity.read().generation);rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(foreignHome.things.list({}),/workspace changed/i);
  const forbidden:any=accountApi(endpoints,{id:selected.ownerId},selected.dataPlane,{localPlane:'home'});
  await assert.rejects(forbidden.things.list({}),/workspace changed/i);
  assert.equal(requests,0);
 } finally {
  rootIdentity.changed();await workspaceDatabase().close();Object.assign(globalThis,original);
  if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else Reflect.deleteProperty(globalThis,'navigator');
 }
});
