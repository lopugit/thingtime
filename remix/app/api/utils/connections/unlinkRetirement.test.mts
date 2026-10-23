import assert from 'node:assert/strict';
import { beforeEach, mock, test, after } from 'node:test';

// Unlinking the LAST holder of a shared external account retires it: the
// account thing (which carries the sealed OAuth token blob) is deleted along
// with every external-post-source membership row behind it. That branch is
// irreversible and it is taken on the strength of ONE count, so what it counts
// matters.
//
// `parentId` is the indexed denormalization of `crystal.accountId`. It is
// healed opportunistically ($set on connect), never backfilled — so a link
// written by an earlier build carries the crystal field and no parentId until
// its owner happens to reconnect. Counting only parentId therefore reads
// "nobody else links this account" while somebody demonstrably does, and takes
// the destructive branch on another user's live connection.
//
// Module mocks stand in for both collections (the feedFilterBudget.test.mts
// precedent), so this runs with no Mongo.

type Doc = Record<string, any>;

const matches = (doc: Doc, query: Doc): boolean =>
  Object.entries(query).every(([field, expected]) => {
    // the one dotted path these queries use
    const value = field.includes('.') ? field.split('.').reduce<any>((node, key) => node?.[key], doc) : doc[field];
    return Array.isArray(value) ? value.includes(expected) : value === expected;
  });

const makeCollection = (docs: Doc[]) => ({
  docs,
  async findOne(query: Doc) {
    return docs.find((doc) => matches(doc, query)) || null;
  },
  async countDocuments(query: Doc) {
    return docs.filter((doc) => matches(doc, query)).length;
  },
  async deleteOne(query: Doc) {
    const index = docs.findIndex((doc) => matches(doc, query));
    if (index === -1) return { deletedCount: 0 };
    docs.splice(index, 1);
    return { deletedCount: 1 };
  },
  async deleteMany(query: Doc) {
    const keep = docs.filter((doc) => !matches(doc, query));
    const deletedCount = docs.length - keep.length;
    docs.length = 0;
    docs.push(...keep);
    return { deletedCount };
  }
});

let home = makeCollection([]);
let things = makeCollection([]);

mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getThingsCollection: async () => things,
    getHomeThingsCollection: async () => home
  }
});

const { unlinkConnection } = await import('./connections.ts');

after(() => mock.restoreAll());

const ACCOUNT = 'ext-account-shared';

// The unlinking user's own link — always current-shape.
const ownLink = () => ({
  shareId: 'ext-link-mine',
  thingtime: ['external-account-link'],
  ownerId: 'user-1',
  parentId: ACCOUNT,
  crystal: { accountId: ACCOUNT, provider: 'demo' }
});

const accountDoc = () => ({ shareId: ACCOUNT, thingtime: ['external-account'], ownerId: 'system' });
const sourceRow = () => ({ shareId: 'ext-source-1', thingtime: ['external-post-source'], parentId: ACCOUNT });

const world = (otherLinks: Doc[]) => {
  home = makeCollection([ownLink(), accountDoc(), ...otherLinks]);
  things = makeCollection([sourceRow()]);
};

beforeEach(() => world([]));

test('the last link retires the shared account and drains its membership rows', async () => {
  const result = await unlinkConnection({ id: 'user-1', username: 'one' }, { id: 'ext-link-mine' });

  assert.deepEqual(result, { ok: true, removed: true });
  assert.equal(home.docs.find((doc) => doc.shareId === ACCOUNT), undefined, 'the account is retired');
  assert.equal(things.docs.length, 0, 'its membership rows are drained');
});

test('another current-shape link keeps the shared account alive', async () => {
  world([
    {
      shareId: 'ext-link-theirs',
      thingtime: ['external-account-link'],
      ownerId: 'user-2',
      parentId: ACCOUNT,
      crystal: { accountId: ACCOUNT, provider: 'demo' }
    }
  ]);

  await unlinkConnection({ id: 'user-1', username: 'one' }, { id: 'ext-link-mine' });

  assert.ok(home.docs.some((doc) => doc.shareId === ACCOUNT), 'a co-linked account is never retired');
  assert.equal(things.docs.length, 1);
});

test('a co-linker whose row predates the parentId stamp still keeps the account alive', async () => {
  // exactly the legacy shape: crystal.accountId present, parentId absent
  world([
    {
      shareId: 'ext-link-legacy',
      thingtime: ['external-account-link'],
      ownerId: 'user-2',
      crystal: { accountId: ACCOUNT, provider: 'demo' }
    }
  ]);

  await unlinkConnection({ id: 'user-1', username: 'one' }, { id: 'ext-link-mine' });

  assert.ok(
    home.docs.some((doc) => doc.shareId === ACCOUNT),
    'counting parentId alone would delete a live account, and with it the sealed tokens user-2 still depends on'
  );
  assert.equal(things.docs.length, 1, 'user-2 keeps the membership rows their feed reads');
});

test('unlinking something the caller does not own changes nothing', async () => {
  const result = await unlinkConnection({ id: 'someone-else', username: 'nope' }, { id: 'ext-link-mine' });

  assert.equal(result.ok, false);
  assert.equal(home.docs.length, 2, 'no link and no account removed');
  assert.equal(things.docs.length, 1);
});
