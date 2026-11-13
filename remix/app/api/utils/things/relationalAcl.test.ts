import assert from 'node:assert/strict';
import test from 'node:test';
import { aclAllows, aclCapabilityFor, sanitizeAcl } from '../../../schemas/registry';
import { ACL_ENTRY_KIND, aclEntryId, aclEntryPrefix, aclMarkerClause, aclWithoutMarkersClause, candidateEntriesFor, evaluatedAcl, hasRelationalAclEntries, legacyAclFence, partitionAcl, prepareRelationalAcls, readAllThingAclEntries, relationalAclCandidateStages, replaceRelationalAcl, rootAcl, tokenGrantAllows } from './relationalAcl';
import type { ThingDoc } from './things';

const root = (patch: Partial<ThingDoc> = {}): ThingDoc => ({ shareId: 'private-root', ownerId: 'owner', acl: ['tt:user', 'tt:custom'],
  thingtime: ['data'], crystal: {}, createdAt: new Date(), updatedAt: new Date(), ...patch });
const viewer = () => ({ id: 'bob-id', username: 'bob', groupIds: new Set(['editors']) });

const fixture = () => {
  const rows: any[] = [], queries: any[] = [], roots: ThingDoc[] = [];
  const collection = {
    async deleteMany(filter: any) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].targetId === filter.targetId && rows[i].ownerId === filter.ownerId && (filter['crystal.family'] === 'token' ? rows[i].crystal.family === 'token' : rows[i].crystal.family !== 'token')) rows.splice(i, 1);
    },
    async insertMany(values: any[]) { rows.push(...values); },
    async findOne(query: any) {
      queries.push(query);
      return [...roots, ...rows].find(row => Object.entries(query).every(([key, value]: any) => {
        const actual = key.split('.').reduce((v: any, part: string) => v?.[part], row);
        if (value?.$ne !== undefined) return actual !== value.$ne;
        return Array.isArray(actual) ? actual.includes(value) : actual === value;
      })) || null;
    },
    find(query: any, options: any) {
      queries.push(query);
      const found = (options.projection.aclGeneration || options.projection.tokenAclGeneration) ? roots.filter(row => query.shareId.$in.includes(row.shareId)) : rows.filter(row =>
        (query.shareId?.$in ? query.shareId.$in.includes(row.shareId) : row.targetId === query.targetId && row.ownerId === query.ownerId && row.crystal.revision === query['crystal.revision']) && row.crystal.revoked !== true && (query['crystal.family'] === 'token' ? row.crystal.family === 'token' : (row.crystal.family === 'audience' || row.crystal.family == null)));
      return { async *[Symbol.asyncIterator]() { yield* found; } };
    }
  };
  return { rows, queries, collection, roots };
};

test('large audiences are child relations and leave the root vocabulary constant', async () => {
  const f = fixture();
  const doc = root();
  const members = Array.from({ length: 10_000 }, (_, i) => `tt:user/person${i}/write`);
  const input = ['tt:user', 'tt:custom', ...members];
  assert.ok(Array.isArray(sanitizeAcl(input)));
  await replaceRelationalAcl(f.collection, doc, input, {});
  assert.deepEqual(rootAcl(doc), ['tt:user', 'tt:custom']);
  assert.deepEqual(doc.acl, ['tt:user', '-tt:user', '-tt:custom']);
  assert.equal(doc.aclEntryCount, 10_000);
  assert.equal(f.rows.length, 10_000);
  assert.notEqual(doc.aclGeneration, doc.aclRevision, 'storage generation and edit revision are independent');
  assert.ok(f.rows.every(row => row.thingtime[0] === ACL_ENTRY_KIND && row.targetId === doc.shareId && row.storageClass === 'control'));
});

test('legacy-reader fences deny every nonowner audience while current proofs retain logical semantics', async () => {
  const bob = { ...viewer(), friendIds: new Set(['owner']), extSourcedPostIds: new Set(['private-root']) };
  // The deployed old runtime has explicit hidden/app shortcuts; neither may
  // survive in the persisted fence even when logical audiences include them.
  const legacyRead = (doc: ThingDoc, who: any) => who?.id === doc.ownerId || doc.acl!.includes('tt:hidden') ||
    doc.acl!.includes('tt:app/app') || aclAllows(doc.acl!, who, doc.ownerId, doc.shareId);
  for (const baseline of [['tt:all'], ['tt:user'], ['tt:hidden'], ['tt:userFriends'], ['tt:userFamily'], ['tt:extsourced'], ['tt:app/app']]) {
    const f = fixture(), doc = root({ appId: 'app' }); f.roots.push(doc);
    await replaceRelationalAcl(f.collection, doc, [...baseline, '-tt:user/bob'], {});
    assert.equal(legacyRead(doc, bob), false, baseline.join(','));
    assert.equal(legacyRead(doc, null), false);
    assert.equal(legacyRead(doc, { id: 'owner' }), true);
    assert.deepEqual(rootAcl(doc), baseline);
    await prepareRelationalAcls(f.collection, [doc], bob);
    assert.equal(aclAllows(evaluatedAcl(doc, bob)!, bob, doc.ownerId, doc.shareId), false, 'specific relational exclusion still wins');
    const stranger = { id: 'stranger', username: 'stranger', friendIds: new Set(['owner']), extSourcedPostIds: new Set([doc.shareId]) };
    await prepareRelationalAcls(f.collection, [doc], stranger);
    assert.equal(aclAllows(evaluatedAcl(doc, stranger)!, stranger, doc.ownerId, doc.shareId), ['tt:all','tt:userFriends','tt:extsourced'].includes(baseline[0]));
  }
});

test('genuine broad exclusions are retained and legacy inline drift cannot reuse protected baseline authority', async () => {
  const f = fixture(), doc = root(), bob = viewer(); f.roots.push(doc);
  await replaceRelationalAcl(f.collection, doc, ['tt:all', '-tt:all', 'tt:custom', 'tt:user/bob/write'], {});
  assert.deepEqual(rootAcl(doc), ['tt:all', '-tt:all', 'tt:custom']);
  assert.deepEqual(doc.acl, legacyAclFence(rootAcl(doc)));
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclCapabilityFor(evaluatedAcl(doc, bob)!, bob, doc.ownerId), 'write');
  const other = { id: 'other', username: 'other' }; await prepareRelationalAcls(f.collection, [doc], other);
  assert.equal(aclAllows(evaluatedAcl(doc, other)!, other, doc.ownerId), false);
  const stale = { ...doc };
  doc.acl = ['tt:all']; // an old writer does not know the protected format
  await prepareRelationalAcls(f.collection, [stale], bob);
  assert.equal(evaluatedAcl(stale, bob), null, 'a concurrent inline edit cannot retain the former proof');
  assert.equal(evaluatedAcl(doc, bob), null);
  await assert.rejects(readAllThingAclEntries(f.collection, doc), (error: any) => error.status === 409);
  doc.acl = legacyAclFence(doc.aclBaseline!); doc.aclBaselineVersion = 2;
  assert.equal(evaluatedAcl(doc, bob), null, 'unknown baseline versions fail closed');
});

test('relational audience candidates use the existing indexed negative hints', () => {
  assert.deepEqual(aclMarkerClause('tt:all', 'tt:hidden'), { $or: [
    { aclGeneration: { $exists: false }, acl: { $in: ['tt:all', 'tt:hidden'] } },
    { aclGeneration: { $exists: true }, aclBaselineVersion: 1, acl: { $in: ['-tt:all', '-tt:hidden'] }, aclBaseline: { $in: ['tt:all', 'tt:hidden'] } }
  ] });
  assert.deepEqual(aclMarkerClause('-tt:all').$or[1], {
    aclGeneration: { $exists: true }, aclBaselineVersion: 1, acl: { $in: ['-tt:all'] }, aclBaseline: { $in: ['-tt:all'] }
  });
  assert.deepEqual(aclWithoutMarkersClause('tt:all').$or[1], {
    aclGeneration: { $exists: true }, aclBaselineVersion: 1, aclBaseline: { $exists: true, $nin: ['tt:all'] }
  });
});

test('authorization queries only the viewer’s subject variants, preserving capability and exclusions', async () => {
  const f = fixture(), doc = root(), bob = viewer();
  f.roots.push(doc);
  await replaceRelationalAcl(f.collection, doc, ['tt:user', 'tt:custom', 'tt:all',
    ...Array.from({ length: 1000 }, (_, i) => `tt:user/person${i}`), 'tt:group/editors/write', '-tt:user/bob'], {});
  assert.equal(evaluatedAcl(doc, bob), null, 'unprepared synchronous checks fail closed');
  await prepareRelationalAcls(f.collection, [doc], bob);
  const effective = evaluatedAcl(doc, bob)!;
  assert.equal(f.queries.length, 2);
  assert.equal(f.queries[0].shareId.$in.length, 12, 'query size follows viewer subjects, not audience size');
  assert.equal(effective.length, 5, 'only matching rows are materialized');
  assert.equal(aclAllows(effective, bob, doc.ownerId), false, 'specific user exclusion beats a broader group grant');
  assert.equal(aclCapabilityFor(effective, bob, doc.ownerId), 'none');
  f.rows.find(row => row.crystal.entry === '-tt:user/bob').crystal.revoked = true;
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclCapabilityFor(evaluatedAcl(doc, bob)!, bob, doc.ownerId), 'write', 'revocation is read live on the next check');
});

test('generation, owner, viewer and group changes cannot reuse a proof or a foreign grant', async () => {
  const f = fixture(), doc = root(), bob = viewer();
  f.roots.push(doc);
  await replaceRelationalAcl(f.collection, doc, ['tt:user', 'tt:custom', 'tt:user/bob/write'], {});
  f.rows[0].ownerId = 'foreign-owner';
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclAllows(evaluatedAcl(doc, bob)!, bob, doc.ownerId), false);
  f.rows[0].ownerId = doc.ownerId;
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclCapabilityFor(evaluatedAcl(doc, bob)!, bob, doc.ownerId), 'write');
  f.rows[0].crystal.family = 'future-family';
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclAllows(evaluatedAcl(doc, bob)!, bob, doc.ownerId), false, 'unknown grant families do not become audience grants');
  f.rows[0].crystal.family = 'audience';
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(evaluatedAcl(doc, { ...bob, username: 'mallory' }), null);
  assert.equal(evaluatedAcl(doc, { ...bob, groupIds: new Set() }), null);
  bob.groupIds.add('new-membership');
  assert.equal(evaluatedAcl(doc, bob), null, 'mutating an already-loaded membership set invalidates its proof');
  bob.groupIds.delete('new-membership');
  const username = bob.username; bob.username = 'mallory';
  assert.equal(evaluatedAcl(doc, bob), null, 'changing the same viewer object cannot borrow its former proof');
  bob.username = username;
  doc.aclGeneration = 'replaced';
  assert.equal(evaluatedAcl(doc, bob), null);
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclAllows(evaluatedAcl(doc, bob)!, bob, doc.ownerId), false);
});

test('subject-only legacy ACLs retain engagement semantics and unknown principals do not grow roots', async () => {
  assert.deepEqual(partitionAcl(['tt:user/bob/comment', 'tt:future/a']).baseline, []);
  const f = fixture(), doc = root(), bob = viewer();
  f.roots.push(doc);
  await replaceRelationalAcl(f.collection, doc, ['tt:user/bob/comment'], {});
  assert.deepEqual(rootAcl(doc), []);
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.deepEqual(evaluatedAcl(doc, bob), ['tt:user/bob/comment']);
  assert.equal(evaluatedAcl(doc, bob)!.includes('tt:custom'), false, 'storage must not add a custom-engagement restriction');
});

test('a replaced generation cannot combine an old public baseline with deleted exclusions', async () => {
  const f = fixture(), doc = root({ acl: ['tt:all', 'tt:custom'] }), bob = viewer();
  await replaceRelationalAcl(f.collection, doc, ['tt:all', 'tt:custom', '-tt:user/bob'], {});
  f.roots.push({ ...doc });
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclAllows(evaluatedAcl(doc, bob)!, bob, doc.ownerId), false);
  f.rows.length = 0;
  f.roots[0] = { ...doc, aclGeneration: 'new-generation', aclRevision: 'new-revision' };
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(evaluatedAcl(doc, bob), null, 'an uncertain mixed-generation read fails closed');
  f.roots[0] = { ...doc, aclRevision: 'incremental-change' };
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(evaluatedAcl(doc, bob), null, 'incremental audience changes invalidate an in-flight read too');
  f.roots.length = 0;
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(evaluatedAcl(doc, bob), null, 'deleted roots cannot retain a proof');
});

test('framed deterministic ids and indexed joins distinguish targets and use the actual data-plane collection', () => {
  assert.notEqual(aclEntryId('a:b', 'c', 'tt:user/d'), aclEntryId('a', 'b:c', 'tt:user/d'));
  assert.equal(aclEntryPrefix('é', 'generation'), 'acl-entry:2:é:generation:');
  const bob = viewer();
  const stages = relationalAclCandidateStages('things_v2_selected', bob);
  assert.equal(stages[1].$lookup.from, 'things_v2_selected');
  assert.equal(stages[1].$lookup.foreignField, 'shareId');
  assert.deepEqual(candidateEntriesFor(bob), ['tt:user/bob', 'tt:user/bob/comment', 'tt:user/bob/write', 'tt:group/editors', 'tt:group/editors/comment', 'tt:group/editors/write']);
  assert.deepEqual(candidateEntriesFor(null), []);
});

test('strict-private consumers must consider relational grants and keep known fixed workspace audiences', () => {
  assert.equal(hasRelationalAclEntries({}), false);
  assert.equal(hasRelationalAclEntries({ aclGeneration: 'generation', aclEntryCount: 0 }), false);
  assert.equal(hasRelationalAclEntries({ aclGeneration: 'generation', aclEntryCount: 1 }), true);
  assert.equal(hasRelationalAclEntries({ aclGeneration: 'generation' }), true, 'an unavailable count is not an empty audience');
  assert.deepEqual(partitionAcl(['tt:user', 'tt:custom', 'tt:service-workspace']), {
    baseline: ['tt:user', 'tt:custom', 'tt:service-workspace'], relational: []
  });
});

test('complete compatibility projections fail on partial or replaced generations while transaction snapshots keep before-images', async () => {
  const f = fixture(), doc = root();
  await replaceRelationalAcl(f.collection, doc, ['tt:user', 'tt:custom', 'tt:user/bob', 'tt:user/carol'], {});
  f.roots.push({ ...doc });
  assert.deepEqual(await readAllThingAclEntries(f.collection, doc), ['tt:user', 'tt:custom', 'tt:user/bob', 'tt:user/carol']);
  const removed = f.rows.pop();
  await assert.rejects(readAllThingAclEntries(f.collection, doc), (error: any) => error.status === 409);
  await assert.rejects(readAllThingAclEntries(f.collection, doc, {}), (error: any) => error.status === 409);
  f.rows.push(removed);
  f.roots[0].aclRevision = 'concurrent-change';
  await assert.rejects(readAllThingAclEntries(f.collection, doc), (error: any) => error.status === 409);
  f.roots.length = 0;
  assert.equal((await readAllThingAclEntries(f.collection, doc, {})).length, 4, 'a complete before-image can be captured after root deletion within its transaction');
});

test('token grants use a separate unbounded relation family and never become audience grants', async () => {
  const f = fixture(), doc = root(), bob = viewer();
  f.roots.push(doc);
  await replaceRelationalAcl(f.collection, doc, ['tt:user', 'tt:custom', 'tt:user/bob'], {});
  const audienceGeneration = doc.aclGeneration;
  const tokens = Array.from({ length: 500 }, (_, i) => `tt:token/token-${i}`);
  await replaceRelationalAcl(f.collection, doc, tokens, {}, 'token');
  assert.deepEqual(doc.tokenAcl, []);
  assert.equal(doc.tokenAclEntryCount, 500);
  assert.equal(doc.aclGeneration, audienceGeneration);
  assert.equal(f.rows.length, 501, 'token replacement preserves audience rows');
  assert.equal(await tokenGrantAllows(f.collection, doc, 'token-499'), true);
  assert.equal(await tokenGrantAllows(f.collection, doc, 'absent'), false);
  assert.deepEqual(await readAllThingAclEntries(f.collection, doc, undefined, 'token'), tokens);
  assert.deepEqual(await readAllThingAclEntries(f.collection, doc), ['tt:user', 'tt:custom', 'tt:user/bob']);
  await prepareRelationalAcls(f.collection, [doc], bob);
  assert.equal(aclAllows(evaluatedAcl(doc, bob)!, bob, doc.ownerId), true);
  const stranger = { ...bob, username: 'stranger' };
  await prepareRelationalAcls(f.collection, [doc], stranger);
  assert.equal(aclAllows(evaluatedAcl(doc, stranger)!, stranger, doc.ownerId), false, 'a token grant is never a read grant');
  await replaceRelationalAcl(f.collection, doc, ['tt:all'], {});
  assert.equal(await tokenGrantAllows(f.collection, doc, 'token-499'), true, 'audience replacement preserves token grants');
  await replaceRelationalAcl(f.collection, doc, [], {}, 'token');
  doc.createdByTokenId = 'legacy'; doc.tokenAcl = ['tt:token/legacy'];
  assert.equal(await tokenGrantAllows(f.collection, doc, 'legacy'), false, 'authoritative empty generation never revives legacy grants');
  assert.deepEqual(await readAllThingAclEntries(f.collection, doc, undefined, 'token'), []);
});

test('token mutation authority is bound to exact owner, live generation, revision and family', async () => {
  const f = fixture(), doc = root({ tokenAcl: ['tt:token/legacy'], createdByTokenId: 'creator' });
  assert.equal(await tokenGrantAllows(f.collection, doc, 'creator'), true);
  await replaceRelationalAcl(f.collection, doc, ['tt:token/allowed'], {}, 'token');
  f.roots.push({ ...doc });
  assert.equal(await tokenGrantAllows(f.collection, doc, 'allowed'), true);
  assert.equal(await tokenGrantAllows(f.collection, { ...doc, ownerId: 'foreign' }, 'allowed'), false);
  f.rows[0].crystal.family = 'audience';
  assert.equal(await tokenGrantAllows(f.collection, doc, 'allowed'), false);
  f.rows[0].crystal.family = 'token';
  f.roots[0].tokenAclRevision = 'revoked-during-read';
  assert.equal(await tokenGrantAllows(f.collection, doc, 'allowed'), false);
  await assert.rejects(readAllThingAclEntries(f.collection, doc, undefined, 'token'), (error: any) => error.status === 409);
  f.roots.length = 0;
  assert.equal(await tokenGrantAllows(f.collection, doc, 'allowed'), false);
});
