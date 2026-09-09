import assert from 'node:assert/strict';
import test from 'node:test';
import { thingsIndexPlanEntries } from './collections';
import { LEGACY_THING_INDEX_NAMES, LEGACY_THING_LAYOUT_KEY, runLegacyThingIndexLayout } from './legacyThingLayout';

const fixture = async (residue = 0) => {
  const all = await thingsIndexPlanEntries({ legacyLookups: true });
  const indexes = all.filter(index => (LEGACY_THING_INDEX_NAMES as readonly string[]).includes(index.name)).map(index => ({ ...index.options, name: index.name, key: index.keys }));
  const events: string[] = [];
  let ready = false;
  let activatedAt: Date | undefined;
  let dual = 1;
  return {
    events, indexes, drain: () => { activatedAt = new Date(Date.now() - 60_000); },
    things: {
      indexes: async () => indexes,
      countDocuments: async (filter: any) => filter.kind === 'embed' ? dual : residue,
      createIndex: async (keys: any) => { assert.deepEqual(keys, { thingtime: 1, ownerId: 1, updatedAt: -1, shareId: 1 }); events.push('index'); },
      updateMany: async (filter: any, update: any) => {
        assert.equal(ready, true);
        assert.deepEqual(filter, { kind: 'embed', thingtime: { $eq: 'embed', $size: 1 }, schemaVersion: 2 });
        assert.deepEqual(update, { $unset: { kind: '' } });
        events.push('metadata'); const modifiedCount = dual; dual = 0; return { modifiedCount };
      },
      dropIndex: async (name: string) => { events.push(`drop:${name}`); indexes.splice(indexes.findIndex(index => index.name === name), 1); }
    },
    settings: {
      findOne: async () => ({ ready, activatedAt }),
      updateOne: async (filter: any, update: any) => { assert.deepEqual(filter, { key: LEGACY_THING_LAYOUT_KEY }); ready = true; activatedAt = update.$set.activatedAt; events.push('activate'); }
    }
  };
};

test('steady home plan omits eight legacy indexes while compatibility plan retains them', async () => {
  const home = await thingsIndexPlanEntries();
  assert.equal(home.length + 1, 48); // includes Watch recording scheduler
  const fallback = await thingsIndexPlanEntries({ legacyLookups: true });
  assert.equal(fallback.length + 1, 56);
  for (const name of LEGACY_THING_INDEX_NAMES) {
    assert.equal(home.some(index => index.name === name), false);
    assert.equal(fallback.some(index => index.name === name), true);
  }
});

test('dry-run writes nothing; incompatible legacy rows and missing lease block all mutations', async () => {
  const db = await fixture(4);
  assert.equal((await runLegacyThingIndexLayout(db.things, db.settings, { dryRun: true })).matched, 14);
  assert.deepEqual(db.events, []);
  await assert.rejects(runLegacyThingIndexLayout(db.things, db.settings, { dryRun: false }), /active lease/);
  await assert.rejects(runLegacyThingIndexLayout(db.things, db.settings, { dryRun: false, assertLease: async () => {} }), /Legacy Thing rows remain/);
  assert.deepEqual(db.events, []);
});

test('migration builds replacement, activates reads, cleans only canonical embed metadata, then retires exact indexes', async () => {
  const db = await fixture();
  await runLegacyThingIndexLayout(db.things, db.settings, { dryRun: false, assertLease: async () => {} });
  assert.deepEqual(db.events, ['index', 'activate']);
  await runLegacyThingIndexLayout(db.things, db.settings, { dryRun: false, assertLease: async () => {} });
  assert.equal(db.events.some(event => event === 'metadata' || event.startsWith('drop:')), false);
  db.drain();
  await runLegacyThingIndexLayout(db.things, db.settings, { dryRun: false, assertLease: async () => {} });
  assert.equal(db.events.filter(event => event === 'activate').length, 1);
  assert.ok(db.events.indexOf('activate') < db.events.indexOf('metadata'));
  assert.equal(db.events.filter(event => event.startsWith('drop:')).length, 8);
  assert.equal((await runLegacyThingIndexLayout(db.things, db.settings, { dryRun: true })).matched, 0);
});

test('unexpected definitions and lease loss preserve existing indexes without activation', async () => {
  const db = await fixture();
  db.indexes[0].key = { other: 1 };
  await assert.rejects(runLegacyThingIndexLayout(db.things, db.settings, { dryRun: false, assertLease: async () => {} }), /preserved for operator/);
  assert.deepEqual(db.events, []);
  const healthy = await fixture();
  await assert.rejects(runLegacyThingIndexLayout(healthy.things, healthy.settings, { dryRun: false, assertLease: async () => { throw new Error('lost lease'); } }), /lost lease/);
  assert.deepEqual(healthy.events, []);
});
