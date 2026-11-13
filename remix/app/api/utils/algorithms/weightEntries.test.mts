import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { thingStorageSizeBytes, currentContentStorageSizeBytes } from '../storage/storageCore';
import { applyEventsToWeights, emptyWeights, interestScore } from '../things/feedRanking';
let ledger = 0;
mock.module('../storage/userStorage', { namedExports: {
  applyUserStorageDelta: async (_owner: string, delta: number) => { ledger += delta; },
  markUserStorageNeedsReconcile: async () => { throw new Error('Unexpected uncertain accounting'); }
} });
const { hydrateAlgorithmWeights, replaceAlgorithmWeights, deleteAlgorithmWeights, algorithmWeightCounts } = await import('./weightEntries');
const valueAt = (doc: any, path: string) => path.split('.').reduce((value,key) => value?.[key], doc);
const match = (doc: any, query: any): boolean => Object.entries(query).every(([key,value]: [string,any]) =>
  key === '$or' ? value.some((part: any) => match(doc,part)) : key === 'thingtime' ? doc.thingtime.includes(value) : valueAt(doc,key) === value);
function fixture() {
  const rows: any[] = [];
  const roots = new Map<string,any>();
  let afterRead = () => {};
  const collection = {
    findOne: async (query: any) => [...roots.values()].find(doc => match(doc,query)) || null,
    find: (query: any) => {
      const found = rows.filter(row => match(row,query));
      const cursor = { batchSize: () => cursor, toArray: async () => found,
        async *[Symbol.asyncIterator]() { yield* found; afterRead(); } };
      return cursor;
    },
    insertMany: async (docs: any[]) => { rows.push(...docs); return { insertedCount: docs.length }; },
    deleteMany: async (query: any) => { let deletedCount = 0; for (let n=rows.length-1;n>=0;n--) if (match(rows[n],query)) { rows.splice(n,1); deletedCount++; } return { deletedCount }; }
  };
  const root = { shareId: 'profile', ownerId: 'owner', thingtime: ['feed-algorithm'], crystal: {} as any };
  roots.set(root.shareId,root); ledger = 0;
  return { collection, rows, root, onRead: (callback: () => void) => { afterRead = callback; } };
}
test('more than10000 weights persist as billed children and exact deletion refunds every byte', async () => {
  const f = fixture();
  const weights = { ...emptyWeights(), tags: Object.fromEntries(Array.from({length:10001},(_,n) => [`interest-${n}`, (n%10+1)/10])) };
  f.root.crystal.weightsGeneration = await replaceAlgorithmWeights(f.collection,f.root,weights,{});
  f.root.crystal.weightsCounts = algorithmWeightCounts(weights);
  assert.equal(f.rows.length,10001);
  const exact = f.rows.reduce((total,row) => total+thingStorageSizeBytes(row),0);
  assert.equal(ledger,exact); assert(f.rows.every(row => currentContentStorageSizeBytes(row) === row.sizeBytes));
  const [read] = await hydrateAlgorithmWeights(f.collection,[f.root]);
  assert.deepEqual(read.crystal.weights,weights);
  const features = new Map([['post',{type:'text',tags:['interest-0','new-tag'],ownerId:'author',createdAt:new Date(0)}]]);
  const events = [{thingId:'post',signal:'react' as const}];
  const direct = applyEventsToWeights(weights,events,features), hydrated = applyEventsToWeights(read.crystal.weights,events,features);
  assert.deepEqual(hydrated,direct); assert.equal(interestScore(hydrated.weights,features.get('post')!),interestScore(direct.weights,features.get('post')!));
  await deleteAlgorithmWeights(f.collection,f.root.shareId,f.root.ownerId,{});
  assert.equal(f.rows.length,0); assert.equal(ledger,0);
});
test('replacement refunds previous rows and an empty generation overrides stale embedded maps', async () => {
  const f = fixture(); const weights = {...emptyWeights(),tags:{old:2}};
  f.root.crystal.weightsGeneration = await replaceAlgorithmWeights(f.collection,f.root,weights,{});
  f.root.crystal.weightsCounts = algorithmWeightCounts(weights);
  f.root.crystal.weightsGeneration = await replaceAlgorithmWeights(f.collection,f.root,emptyWeights(),{});
  f.root.crystal.weightsCounts = algorithmWeightCounts(emptyWeights()); f.root.crystal.weights = weights;
  assert.equal(ledger,0); assert.equal(f.rows.length,0);
  assert.deepEqual((await hydrateAlgorithmWeights(f.collection,[f.root]))[0].crystal.weights,emptyWeights());
});
test('missing, wrong-owner and wrong-generation rows cannot silently shorten a profile', async () => {
  for (const mode of ['missing','owner','generation']) {
    const f = fixture(); const weights = {...emptyWeights(),tags:{preserved:2}};
    f.root.crystal.weightsGeneration = await replaceAlgorithmWeights(f.collection,f.root,weights,{});
    f.root.crystal.weightsCounts = algorithmWeightCounts(weights);
    if (mode === 'missing') f.rows.splice(0); else if (mode === 'owner') f.rows[0].ownerId = 'other'; else f.rows[0].crystal.generation = 'other';
    await assert.rejects(hydrateAlgorithmWeights(f.collection,[f.root]), /changed or are incomplete/);
  }
});
test('a root generation change while reading rejects a torn complete projection', async () => {
  const f = fixture(); const weights = {...emptyWeights(),tags:{preserved:2}};
  f.root.crystal.weightsGeneration = await replaceAlgorithmWeights(f.collection,f.root,weights,{});
  f.root.crystal.weightsCounts = algorithmWeightCounts(weights);
  f.onRead(() => { f.root.crystal.weightsGeneration = 'newer'; });
  await assert.rejects(hydrateAlgorithmWeights(f.collection,[f.root]), /changed or are incomplete/);
});
