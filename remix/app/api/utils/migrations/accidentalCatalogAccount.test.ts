import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { packSecure } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { CATALOG_FIXTURE, cleanupAccidentalCatalogAccount } from './accidentalCatalogAccount';

const fixture = () => {
  const now = CATALOG_FIXTURE.createdAt;
  const user = { _id: 'fixture-root', shareId: 'fixture-user', ownerId: 'fixture-user', thingtime: ['user'], createdAt: now,
    crystal: { username: CATALOG_FIXTURE.username, displayName: CATALOG_FIXTURE.displayName },
    secure: packSecure({ email: CATALOG_FIXTURE.email, emailVerified: false, accountKind: 'user', meta: { publicUploads: false, privateUploads: false } }) };
  const ledger = { _id: 'fixture-ledger', shareId: subscriptionShareId('user', user.shareId), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['subscription'], ownerId: user.shareId, acl: [ACL_OWNER], targetId: null, tags: [], storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
    createdAt: now, updatedAt: now, crystal: { quotaKind: 'subscription', subjectType: 'user', subjectId: user.shareId, tier: 'free', tierVersionId: 'free-v1', tierVersion: 1,
      tierName: 'Free', tierMetered: true, tierQuotas: { appStorageBytes: 1024, userStorageBytes: 1024, maxApps: 2, maxPats: 2 }, overrides: null, note: null,
      updatedBy: 'system', isDefaultAssignment: true, storageUsedBytes: 0, storageAccountingVersion: 1, storageLedgerStatus: 'ready', storageReconciledAt: now, storageUpdatedAt: now } };
  const neighbor = { _id: 'neighbor-root', shareId: 'neighbor', ownerId: 'neighbor', thingtime: ['user'], crystal: { username: 'real-user' } };
  const rows: Record<string, any[]> = { things: [user, ledger, neighbor], sessions: [{ _id: 'session', userId: user.shareId, createdAt: now, revokedAt: now }],
    emailVerifications: [{ _id: 'verification', userId: user.shareId, email: CATALOG_FIXTURE.email, createdAt: now, consumedAt: null }],
    rosters: [{ _id: 'shared-roster', entries: [{ userId: user.shareId }, { userId: 'neighbor' }] }, { _id: 'fixture-roster', entries: [{ userId: user.shareId }] }] };
  let writes = 0, failDelete = false;
  const session = {};
  const values = (doc: any, keys: string[]): any[] => !keys.length ? [doc] : Array.isArray(doc) ? doc.flatMap(item => values(item, keys)) : values(doc?.[keys[0]], keys.slice(1));
  const matches = (doc: any, query: any): boolean => Object.entries(query).every(([key, value]: any) => {
    if (key === '$or') return value.some((part: any) => matches(doc, part));
    if (key === '$expr') return isDeepStrictEqual(doc, value.$eq[1].$literal);
    const found = values(doc, key.split('.')).flat();
    if (value?.$ne !== undefined) return !found.some(item => isDeepStrictEqual(item, value.$ne));
    return found.some(item => isDeepStrictEqual(item, value));
  });
  const deps: any = {
    collection: async (name: string) => {
      rows[name] ??= [];
      return {
        find(query: any, opts: any) { assert.equal(opts.session, session); return { toArray: async () => rows[name].filter(row => matches(row, query)) }; },
        async findOne(query: any, opts: any) { assert.equal(opts.session, session); return rows[name].find(row => matches(row, query)); },
        async deleteOne(query: any, opts: any) {
          assert.equal(opts.session, session); assert.ok(query.$expr, 'requires complete preimage'); writes++;
          if (failDelete && name === 'sessions') return { deletedCount: 0 };
          const index = rows[name].findIndex(row => matches(row, query));
          if (index < 0) return { deletedCount: 0 };
          rows[name].splice(index, 1); return { deletedCount: 1 };
        },
        async updateOne(query: any, update: any, opts: any) {
          assert.equal(opts.session, session); assert.ok(query.$expr); writes++;
          const row = rows[name].find(row => matches(row, query));
          if (!row) return { matchedCount: 0 };
          Object.assign(row, update.$set); return { matchedCount: 1 };
        }
      };
    },
    transaction: async (run: any) => {
      // Rollback preserves BSON values as well as the neighboring account.
      const before = Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.map(row => ({ ...row }))]));
      try { return await run(session); }
      catch (error) { for (const key of Object.keys(rows)) rows[key] = before[key] || []; throw error; }
    }
  };
  return { user, ledger, neighbor, rows, deps, writes: () => writes, failDelete: () => { failDelete = true; } };
};

test('dry-run is read-only; real cleanup preserves neighbors and shared roster entries, then no-ops', async () => {
  const f = fixture();
  assert.equal((await cleanupAccidentalCatalogAccount({ dryRun: true }, f.deps)).matched, 1);
  assert.equal(f.writes(), 0);
  let leases = 0;
  assert.equal((await cleanupAccidentalCatalogAccount({ dryRun: false, assertLease: async () => { leases++; } }, f.deps)).migrated, 1);
  assert.equal(leases, 2);
  assert.deepEqual(f.rows.things, [f.neighbor]);
  assert.deepEqual(f.rows.sessions, []); assert.deepEqual(f.rows.emailVerifications, []);
  assert.equal(f.rows.rosters.length, 1); assert.deepEqual(f.rows.rosters[0].entries, [{ userId: 'neighbor' }]);
  assert.equal((await cleanupAccidentalCatalogAccount({ dryRun: false }, f.deps)).matched, 0);
});

test('changed identity, elevated permissions, content, storage, verification or live sessions refuse all writes', async () => {
  for (const alter of [
    (f: any) => { f.user.createdAt = new Date(); },
    (f: any) => { f.user.secureAdmin = true; },
    (f: any) => { f.user.secure = packSecure({ email: CATALOG_FIXTURE.email, emailVerified: false, accountKind: 'user', meta: { publicUploads: true, privateUploads: false } }); },
    (f: any) => { f.user.secure = packSecure({ email: 'different@example.invalid', emailVerified: false, accountKind: 'user' }); },
    (f: any) => { f.user.secure = packSecure({ email: CATALOG_FIXTURE.email, emailVerified: true, accountKind: 'user' }); },
    (f: any) => { f.ledger.crystal.storageUsedBytes = 1; },
    (f: any) => { f.rows.things.push({ _id: 'post', ownerId: f.user.shareId, thingtime: ['post'] }); },
    (f: any) => { f.rows.sessions[0].revokedAt = null; },
    (f: any) => { f.rows.emailVerifications[0].consumedAt = new Date(); }
  ]) {
    const f = fixture(); alter(f);
    await assert.rejects(cleanupAccidentalCatalogAccount({ dryRun: false }, f.deps), /cleanup refused/);
    assert.equal(f.writes(), 0);
  }
});

test('conflicting preimage or lost migration lease aborts the whole transaction', async () => {
  const f = fixture(); f.failDelete();
  await assert.rejects(cleanupAccidentalCatalogAccount({ dryRun: false }, f.deps), /cleanup refused/);
  assert.equal(f.rows.things.length, 3); assert.equal(f.rows.sessions.length, 1);
  const g = fixture();
  await assert.rejects(cleanupAccidentalCatalogAccount({ dryRun: false, assertLease: async () => { throw new Error('lease lost'); } }, g.deps), /lease lost/);
  assert.equal(g.writes(), 0);
});
