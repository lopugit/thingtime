import assert from 'node:assert/strict';
import test from 'node:test';
import { addCatalogProgress, emptyCatalogProgress, parseCatalogImport, publishCatalogImport } from './catalogImport';

const definition = (index = 0) => ({ slug: `import-test-${index}`, name: 'Import test', library: 'thingtime', category: 'button', args: [], render: { tag: 'button', children: ['Save'] } });
const catalog = (count: number) => parseCatalogImport(JSON.stringify(Array.from({ length: count }, (_, i) => definition(i))));
const result = (count: number) => ({ ok: true, received: count, created: count, refreshed: 0, unchanged: 0, skipped: 0 });

test('catalog validates the entire upload and rejects duplicates before publication', () => {
  assert.equal(catalog(2800).definitions.length, 2800);
  assert.throws(() => parseCatalogImport(JSON.stringify([definition(), definition()])), /Duplicate/);
  assert.throws(() => parseCatalogImport(JSON.stringify([definition(), { ...definition(1), name: '' }])), /name/i);
  assert.throws(() => parseCatalogImport('{'), SyntaxError);
  assert.throws(() => parseCatalogImport('[]'), /between 1/);
  assert.throws(() => catalog(5001), /5,000/);
  assert.equal(parseCatalogImport(JSON.stringify({ components: [definition()] })).definitions.length, 1);
});

test('batching respects both count and UTF-8 body ceilings', () => {
  assert.deepEqual(catalog(201).batches.map(body => JSON.parse(body).components.length), [100, 100, 1]);
  // Extra metadata counts toward the HTTP limit even though it is not rendered.
  const large = Array.from({ length: 80 }, (_, i) => ({ ...definition(i), metadata: '🌳'.repeat(12_000) }));
  const batches = parseCatalogImport(JSON.stringify(large)).batches;
  assert.ok(batches.length > 1);
  assert.ok(batches.every(body => Buffer.byteLength(body) <= 1_500_000));
  assert.equal(batches.flatMap(body => JSON.parse(body).components).length, 80);
});

test('partial, malformed, and skipped server results never claim full success', async () => {
  assert.throws(() => addCatalogProgress(emptyCatalogProgress(), result(1), 2), /incomplete/);
  assert.throws(() => addCatalogProgress(emptyCatalogProgress(), { ...result(2), created: -1 }, 2), /incomplete/);
  let sent = 0;
  let reported = emptyCatalogProgress();
  await assert.rejects(publishCatalogImport(catalog(201), {
    signal: new AbortController().signal, pause: async () => {},
    send: async () => { sent++; return { ...result(100), created: 99, skipped: 1 }; },
    onProgress: next => { reported = next; }
  }), /skipped/);
  assert.equal(sent, 1);
  assert.equal(reported.skipped, 1);
  assert.equal(reported.processed, 100);
});

test('cancellation between batches prevents further writes and stale result reporting', async () => {
  const controller = new AbortController();
  let sent = 0;
  const updates: number[] = [];
  await assert.rejects(publishCatalogImport(catalog(201), {
    signal: controller.signal,
    send: async () => { sent++; return result(100); },
    pause: async () => { controller.abort(); },
    onProgress: next => updates.push(next.processed)
  }), { name: 'AbortError' });
  assert.equal(sent, 1);
  assert.deepEqual(updates, [100]);
  const duringWrite = new AbortController();
  await assert.rejects(publishCatalogImport(catalog(1), {
    signal: duringWrite.signal, pause: async () => {},
    send: async () => { duringWrite.abort(); return result(1); },
    onProgress: () => assert.fail('stale result')
  }), { name: 'AbortError' });
});

test('publication reports the real aggregate after every successful batch', async () => {
  const updates: number[] = [];
  let pauses = 0;
  const finished = await publishCatalogImport(catalog(201), {
    signal: new AbortController().signal,
    send: async body => result(JSON.parse(body).components.length),
    pause: async () => { pauses++; }, onProgress: next => updates.push(next.processed)
  });
  assert.equal(finished.created, 201);
  assert.equal(pauses, 2);
  assert.deepEqual(updates, [100, 200, 201]);
});
