import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setImmediate as immediate } from 'node:timers/promises';
import { BSON, Binary, Decimal128, Double, Int32, Long, ObjectId } from 'mongodb';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import type { CollectionFilter, CollectionProvider, NativeCollection } from './collectionContract';
const eq = (field: string, value: any): CollectionFilter => ({ op: 'eq', path: [field], value });
const encode = (row: Record<string, unknown>) => BSON.serialize(row);
const decode = (bytes: Uint8Array) => BSON.deserialize(bytes, { promoteValues: false });
const errorCode = (code: string) => (error: unknown) => (error as { code?: string })?.code === code;
const definition = { unique: [{ name: 'protected-keys', path: ['uniqueKeys'], sparse: true, multikey: true }] };
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-collection-provider-'));
 const providers: CollectionProvider[] = [];
 const open = async () => { const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'store.sqlite'))); providers.push(provider); return provider; };
 t.after(async () => { await Promise.all(providers.map(provider => provider.close())); await rm(directory, { recursive: true, force: true }); });
 const provider = await open();
 await provider.transaction(session => { session.defineCollection('things', definition); session.defineCollection('ledger', { unique: [] }); });
 return { provider, open };
};

test('exact typed identities and lossless BSON survive updates and reopen without aliasing bytes', async t => {
 const { provider, open } = await fixture(t);
 const id = new ObjectId('0123456789abcdef01234567');
 const row = { _id: id, count: new Long(9), date: new Date('2026-11-12T00:00:00Z'), binary: new Binary(Buffer.from([0, 255]), 128), decimal: Decimal128.fromString('1.2300'), integer: new Int32(9), double: new Double(9) };
 const supported = row;
 const original = encode(supported);
 await provider.transaction(s => {
  const things = s.collection('things'); things.insert(original);
  things.insert(encode({ _id: id.toHexString(), count: 'separate string identity' }));
  const page = things.find({ filter: eq('_id', id), limit: 1 });
  assert.deepEqual(page.documents[0], Uint8Array.from(original)); page.documents[0].fill(0);
  const result = things.updateOne(eq('_id', id), [{ op: 'increment', path: ['count'], amount: 3 }]);
  assert.equal(result.matched, true); assert.equal(result.modified, true);
 });
 await provider.close(); const reopened = await open();
 await reopened.transaction(s => {
  s.defineCollection('things', definition);
  const row = decode(s.collection('things').find({ filter: eq('_id', id), limit: 1 }).documents[0]);
  assert.equal(row.count.toBigInt(), BigInt(12)); assert.equal(row.integer._bsontype, 'Int32'); assert.equal(row.double._bsontype, 'Double');
  assert.equal(row.decimal.toString(), '1.2300');
  assert.equal(row.date.toISOString(), supported.date.toISOString()); assert.deepEqual(row.binary, supported.binary);
  assert.equal(s.collection('things').find({ filter: eq('_id', id.toHexString()), limit: 1 }).documents.length, 1);
 });
});

test('ordered paging matches an independent bytewise identity ordering with exact missing/null and scalar-array membership', async t => {
 const { provider } = await fixture(t); const ids = ['😀', '中', 'a', 'A', 'z'];
 await provider.transaction(s => { for (const [i, id] of ids.entries()) s.collection('things').insert(encode({ _id: id, ...(i ? { optional: null } : {}), members: ['owner', id] })); });
 await provider.transaction(s => {
  const collection = s.collection('things'), observed: string[] = []; let after: string | undefined;
  do { const page = collection.find({ limit: 2, after }); observed.push(...page.documents.map(bytes => decode(bytes)._id)); after = page.nextAfter as string || undefined; } while (after);
  assert.deepEqual(observed, [...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  assert.equal(collection.find({ filter: eq('optional', null), limit: 10 }).documents.length, 4);
  assert.equal(collection.find({ filter: { op: 'exists', path: ['optional'], value: false }, limit: 10 }).documents.length, 1);
  assert.equal(collection.find({ filter: { op: 'contains', path: ['members'], value: 'owner' }, limit: 10 }).documents.length, 5);
 });
});

test('durable sparse multikey uniqueness deduplicates one document but rejects other documents and rolls back a caught error', async t => {
 const { provider, open } = await fixture(t);
 await provider.transaction(s => {
  const c = s.collection('things'); c.insert(encode({ _id: 'a', uniqueKeys: ['owner:user:a', 'owner:user:a'] }));
  c.insert(encode({ _id: 'b' })); c.insert(encode({ _id: 'c' }));
 });
 await provider.close(); const reopened = await open();
 await assert.rejects(reopened.transaction(s => {
  s.collection('ledger').insert(encode({ _id: 'should-rollback', used: 1 }));
  assert.throws(() => s.collection('things').insert(encode({ _id: 'd', uniqueKeys: ['owner:user:a'] })), errorCode('DUPLICATE_UNIQUE_KEY'));
 }), errorCode('DUPLICATE_UNIQUE_KEY'));
 await reopened.transaction(s => {
  assert.equal(s.collection('ledger').find({ limit: 10 }).documents.length, 0);
  assert.equal(s.collection('things').find({ limit: 10 }).documents.length, 3);
  assert.throws(() => s.defineCollection('things', { unique: [] }), errorCode('COLLECTION_DEFINITION_MISMATCH'));
 }).then(() => assert.fail('caught definition failure must poison commit'), error => assert.ok(errorCode('COLLECTION_DEFINITION_MISMATCH')(error)));
});

test('cross-collection content/ledger mutation rolls back on failure, and conditional revision claims have one winner', async t => {
 const { provider, open } = await fixture(t), competitor = await open();
 await provider.transaction(s => {
  s.collection('things').insert(encode({ _id: 'thing', ownerId: 'owner', revision: new Int32(1), text: 'before' }));
  s.collection('ledger').insert(encode({ _id: 'owner', used: new Long(10) }));
 });
 const condition: CollectionFilter = { op: 'and', filters: [eq('_id', 'thing'), eq('ownerId', 'owner'), eq('revision', new Int32(1))] };
 await assert.rejects(provider.transaction(s => {
  s.collection('things').updateOne(condition, [{ op: 'set', path: ['text'], value: 'must rollback' }]);
  s.collection('ledger').updateOne(eq('_id', 'owner'), [{ op: 'increment', path: ['used'], amount: 3 }]);
  throw new Error('quota failure');
 }), /quota failure/);
 let enter!: () => void, release!: () => void;
 const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
 const first = provider.transaction(async s => {
  const result = s.collection('things').updateOne(condition, [{ op: 'increment', path: ['revision'], amount: 1 }]);
  enter(); await gate; return result.matched;
 });
 await entered;
 let competitorEntered = false;
 const second = competitor.transaction(s => { competitorEntered = true; return s.collection('things').updateOne(condition, [{ op: 'set', path: ['text'], value: 'stale' }]).matched; });
 await immediate(); assert.equal(competitorEntered, false); release();
 assert.deepEqual(await Promise.all([first, second]), [true, false]);
 await provider.transaction(s => {
  assert.equal(decode(s.collection('things').find({ limit: 1 }).documents[0]).text, 'before');
  assert.equal(decode(s.collection('ledger').find({ limit: 1 }).documents[0]).used.toBigInt(), BigInt(10));
 });
});

test('invalid grammar and options fail eagerly on empty and no-match collections before any write', async t => {
 const { provider } = await fixture(t);
 const invalidFilters = [{ op: '$where', code: 'execute' }, { op: 'eq', path: ['__proto__'], value: 'x' }, { op: 'or', filters: [eq('_id', 'missing'), { op: '$expr', value: true }] }, { op: 'lt', path: ['x'], value: null }];
 for (const filter of invalidFilters) await assert.rejects(provider.transaction(s => s.collection('things').updateOne(filter as any, [{ op: 'set', path: ['x'], value: 1 }])));
 for (const updates of [[{ op: '$set', x: 1 }], [{ op: 'set', path: ['x'], value: 1 }, { op: 'set', path: ['x', 'child'], value: 2 }], [{ op: 'set', path: ['_id'], value: 'new' }]]) {
  await assert.rejects(provider.transaction(s => s.collection('things').updateOne(eq('_id', 'absent'), updates as any)), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 }
 await assert.rejects(provider.transaction(s => (s.collection('things').updateOne as any)(eq('_id', 'missing'), [{ op: 'unset', path: ['x'] }], { upsert: true })), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 await assert.rejects(provider.transaction(s => s.collection('things').find({ limit: 10, sort: { x: 1 } } as any)), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 await provider.transaction(s => assert.equal(s.collection('things').find({ limit: 10 }).documents.length, 0));
});

test('prototype/accessor/code inputs never execute; escaped collections and numeric overflow cannot partially commit', async t => {
 const { provider } = await fixture(t); let executed = false;
 const value = Object.defineProperty({}, 'secret', { enumerable: true, get() { executed = true; return 1; } });
 await assert.rejects(provider.transaction(s => s.collection('things').updateOne(eq('_id', 'missing'), [{ op: 'set', path: ['x'], value }])), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 const malicious = new Int32(1); Object.defineProperty(malicious, 'toBSON', { value() { executed = true; return 9; } });
 await assert.rejects(provider.transaction(s => s.collection('things').find({ filter: eq('x', malicious), limit: 1 })), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 const filters = Object.defineProperty([], '0', { get() { executed = true; return eq('_id', 'a'); } });
 await assert.rejects(provider.transaction(s => s.collection('things').find({ filter: { op: 'and', filters } as any, limit: 1 })), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 const proxy = new Proxy({}, { getPrototypeOf() { executed = true; return Object.prototype; } });
 await assert.rejects(provider.transaction(s => s.collection('things').find({ filter: proxy as any, limit: 1 })), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 assert.equal(executed, false); assert.equal(({} as any).polluted, undefined);
 let escaped!: NativeCollection;
 await provider.transaction(s => { escaped = s.collection('things'); escaped.insert(encode({ _id: 'a', used: Long.MAX_VALUE })); });
 assert.throws(() => escaped.find({ limit: 1 }), errorCode('TRANSACTION_OWNERSHIP'));
 await assert.rejects(provider.transaction(s => {
  s.collection('ledger').insert(encode({ _id: 'rollback' }));
  assert.throws(() => s.collection('things').updateOne(eq('_id', 'a'), [{ op: 'increment', path: ['used'], amount: 1 }]), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 }), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 await provider.transaction(s => assert.equal(s.collection('ledger').find({ limit: 10 }).documents.length, 0));
});

test('conditional owner/revision guards, set/unset, no-op and delete use the same exact matcher', async t => {
 const { provider } = await fixture(t);
 await provider.transaction(s => {
  const c = s.collection('things');
  c.insert(encode({ _id: 'a', owner: 'one', nested: { keep: 'yes', remove: 'old' }, at: new Date('2026-11-12'), revision: new Int32(4) }));
  assert.deepEqual(c.updateOne(eq('owner', 'two'), [{ op: 'unset', path: ['nested', 'remove'] }]), { matched: false, modified: false, document: null });
  assert.equal(c.updateOne(eq('_id', 'a'), [{ op: 'set', path: ['owner'], value: 'one' }]).modified, false);
  const filter: CollectionFilter = { op: 'and', filters: [eq('owner', 'one'), { op: 'gte', path: ['revision'], value: new Int32(4) }, { op: 'lt', path: ['at'], value: new Date('2026-11-13') }] };
  const changed = c.updateOne(filter, [{ op: 'unset', path: ['nested', 'remove'] }, { op: 'set', path: ['nested', 'added'], value: ['one', new Int32(2)] }]);
  const value = decode(changed.document!);
  assert.equal(value.nested.keep, 'yes'); assert.equal(Object.prototype.hasOwnProperty.call(value.nested, 'remove'), false); assert.equal(value.nested.added[1].valueOf(), 2);
  assert.equal(c.deleteOne(eq('owner', 'two')), false); assert.equal(c.deleteOne(filter), true); assert.equal(c.find({ limit: 1 }).documents.length, 0);
 });
});

test('unique-key changes are atomic, null and missing policy is explicit, and invalid definitions never register', async t => {
 const { provider } = await fixture(t);
 await provider.transaction(s => {
  s.defineCollection('strict', { unique: [{ name: 'one-null', path: ['key'], sparse: false, multikey: false }] });
  const c = s.collection('things'); c.insert(encode({ _id: 'a', uniqueKeys: ['a'] })); c.insert(encode({ _id: 'b', uniqueKeys: ['b'] }));
  s.collection('strict').insert(encode({ _id: 'missing' }));
 });
 await assert.rejects(provider.transaction(s => s.collection('strict').insert(encode({ _id: 'null', key: null }))), errorCode('DUPLICATE_UNIQUE_KEY'));
 await assert.rejects(provider.transaction(s => s.collection('things').updateOne(eq('_id', 'b'), [{ op: 'set', path: ['uniqueKeys'], value: ['a'] }])), errorCode('DUPLICATE_UNIQUE_KEY'));
 for (const unique of [[{ name: 'bad', path: ['uniqueKeys'], sparse: true, multikey: true, partialFilter: {} }], [{ name: 'bad', path: ['constructor'], sparse: true, multikey: true }]]) {
  await assert.rejects(provider.transaction(s => s.defineCollection('invalid', { unique } as any)), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 }
 await provider.transaction(s => {
  assert.equal(decode(s.collection('things').find({ filter: eq('_id', 'b'), limit: 1 }).documents[0]).uniqueKeys[0], 'b');
  s.defineCollection('invalid', { unique: [] });
 });
});


test('forged BSON wrapper internals cannot execute nested hooks or proxies during query/update admission', async t => {
 const { provider } = await fixture(t); let executed = false;
 const hostile = { subarray() { executed = true; return new Uint8Array(12); }, valueOf() { executed = true; return 1; } };
 const binary = Object.assign(Object.create(Binary.prototype), { sub_type: 0, buffer: hostile, position: 1 });
 const id = Object.assign(Object.create(ObjectId.prototype), { buffer: hostile });
 const long = Object.assign(Object.create(Long.prototype), { low: hostile, high: 0, unsigned: false });
 const decimal = Object.assign(Object.create(Decimal128.prototype), { bytes: new Proxy(new Uint8Array(16), { get() { executed = true; return 0; } }) });
 const hookedBytes = new Uint8Array(12);
 Object.defineProperty(hookedBytes, 'subarray', { get() { executed = true; return () => hookedBytes; } });
 const hookedId = Object.assign(Object.create(ObjectId.prototype), { buffer: hookedBytes });
 for (const value of [binary, id, long, decimal, hookedId]) {
  await assert.rejects(provider.transaction(s => s.collection('things').find({ filter: eq('field', value), limit: 1 })), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
  await assert.rejects(provider.transaction(s => s.collection('things').updateOne(eq('_id', 'absent'), [{ op: 'set', path: ['field'], value }])), errorCode('UNSUPPORTED_COLLECTION_OPERATION'));
 }
 assert.equal(executed, false);
 await provider.transaction(s => assert.equal(s.collection('things').find({ limit: 1 }).documents.length, 0));
});

test('internal scan batches and caller page sizes never truncate larger collections', async t => {
 const { provider } = await fixture(t);
 const ids = Array.from({ length: 261 }, (_, index) => `row-${String(index).padStart(4, '0')}`).reverse();
 await provider.transaction(s => {
  s.defineCollection('paged', { unique: [] });
  for (const id of ids) s.collection('paged').insert(encode({ _id: id }));
 });
 await provider.transaction(s => {
  const collection = s.collection('paged'); let after: string | undefined;
  const observed: string[] = [];
  do {
   const page = collection.find({ after, limit: 73 });
   observed.push(...page.documents.map(bytes => decode(bytes)._id));
   after = page.nextAfter as string || undefined;
  } while (after);
  assert.deepEqual(observed, [...ids].sort());
  assert.equal(collection.find({ limit: 1000 }).documents.length, 261);
 });
});
