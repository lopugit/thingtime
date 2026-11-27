import {resolveAiPreferredAnthropicChoice,resolveAiPreferredOpenAiChoice,type AiWorkflowBaseModel} from './prConflictResolverModelWaterfallCore';
import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createPrConflictResolverModelWaterfallStore } from './prConflictResolverModelWaterfall.ts';

test('every GET reads the durable singleton so an external Admin save is visible immediately', async () => {
  let stored: unknown = ['default'];
  let reads = 0;
  const store = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      reads += 1;
      return stored;
    },
    writeStoredWaterfall: async () => undefined
  });

  assert.deepEqual(await store.getWaterfall(), ['default']);
  stored = ['claude-opus-5', 'claude-fable-5', 'default'];
  assert.deepEqual(await store.getWaterfall(), ['claude-opus-5', 'claude-fable-5', 'default']);
  assert.equal(reads, 2);
});

test('a failed durable read uses last-known-good, or the hard default on a cold instance', async () => {
  let shouldFail = false;
  const warmStore = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      if (shouldFail) throw new Error('Mongo unavailable');
      return ['claude-opus-5', 'default'];
    },
    writeStoredWaterfall: async () => undefined
  });

  assert.deepEqual(await warmStore.getWaterfall(), ['claude-opus-5', 'default']);
  shouldFail = true;
  assert.deepEqual(await warmStore.getWaterfall(), ['claude-opus-5', 'default']);

  const coldStore = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      throw new Error('Mongo unavailable');
    },
    writeStoredWaterfall: async () => undefined
  });
  assert.deepEqual(await coldStore.getWaterfall(), ['default']);
});

test('an Admin save persists the validated order and becomes the outage fallback', async () => {
  let persisted: { waterfall: unknown; updatedBy: string } | null = null;
  const store = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      throw new Error('Mongo unavailable');
    },
    writeStoredWaterfall: async (waterfall, updatedBy) => {
      persisted = { waterfall, updatedBy };
    }
  });

  const waterfall = ['claude-opus-5:high', 'claude-fable-5'] as const;
  assert.deepEqual(await store.setWaterfall(waterfall, 'admin-123'), waterfall);
  assert.deepEqual(persisted, { waterfall: [...waterfall], updatedBy: 'admin-123' });
  assert.deepEqual(await store.getWaterfall(), waterfall);
});


test('live discovered tiers survive save/read/runtime and removed tiers clamp without changing the model',async()=>{
 let stored:unknown=['default'];
 let models:AiWorkflowBaseModel[]=[{id:'claude-opus-9-9',label:'Future Claude',provider:'anthropic',efforts:['low','high'],speeds:['normal']},{id:'claude-opus-5-5',label:'Opus',provider:'anthropic',efforts:['low','medium','high','xhigh','max'],speeds:['normal']},{id:'gpt-6-astra',label:'Astra',provider:'openai',efforts:['high'],speeds:['normal']}];
 const store=createPrConflictResolverModelWaterfallStore({readStoredWaterfall:async()=>stored,writeStoredWaterfall:async(value)=>{stored=value;},readModelCatalog:async()=>models});
 const order=['claude-opus-9-9:high','claude-opus-5-5:max','gpt-6-astra:high'];
 assert.deepEqual(await store.setWaterfall(order,'admin'),order);assert.deepEqual(await store.getWaterfall(),order);
 let snapshot=await store.getSnapshot();assert.equal(resolveAiPreferredAnthropicChoice(snapshot,'fallback').id,'claude-opus-9-9:high');assert.equal(resolveAiPreferredOpenAiChoice(snapshot)?.id,'gpt-6-astra:high');
 models=models.map(model=>model.id==='claude-opus-9-9'?{...model,efforts:['low']}:model);
 snapshot=await store.getSnapshot();assert.equal(resolveAiPreferredAnthropicChoice(snapshot,'fallback').model,'claude-opus-9-9');assert.equal(resolveAiPreferredAnthropicChoice(snapshot,'fallback').effort,null);
 await assert.rejects(store.setWaterfall(order,'admin'),/unknown model/);
 assert.deepEqual(stored,order,'A fresh read never rewrites the saved preference');
 models=models.map(model=>model.id==='claude-opus-5-5'?{...model,efforts:[]}:model);
 stored=['claude-opus-5-5:max'];snapshot=await store.getSnapshot();assert.equal(resolveAiPreferredAnthropicChoice(snapshot,'fallback').id,'claude-opus-5-5');
});

test('concurrent reads return their local model/preference pair and outage fallback caches the whole pair',async()=>{
 let reads=0;
 const releases:((value:any)=>void)[]=[];
 const store=createPrConflictResolverModelWaterfallStore({
  readStoredWaterfall:async()=>[++reads===1?'claude-opus-9-9:high':'claude-opus-8-8:low'],
  readModelCatalog:()=>new Promise(resolve=>{releases.push(resolve);}),writeStoredWaterfall:async()=>{}
 });
 const a=store.getSnapshot(),b=store.getSnapshot();
 releases[1]([{id:'claude-opus-8-8',label:'B',provider:'anthropic',efforts:['low'],speeds:['normal']}]);
 const second=await b;
 releases[0]([{id:'claude-opus-9-9',label:'A',provider:'anthropic',efforts:['high'],speeds:['normal']}]);
 const first=await a;
 assert.equal(resolveAiPreferredAnthropicChoice(first,'fallback').id,'claude-opus-9-9:high');
 assert.equal(resolveAiPreferredAnthropicChoice(second,'fallback').id,'claude-opus-8-8:low');
});
