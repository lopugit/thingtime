import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let docs: any[] = [];
let insertBatchSizes: number[] = [];
const matches = (doc: any, query: any) => Object.entries(query).every(([key, expected]: any) => {
  const value = key.split('.').reduce((at, part) => at?.[part], doc);
  return expected && typeof expected === 'object' && '$in' in expected ? expected.$in.includes(value) : Array.isArray(value) ? value.includes(expected) : value === expected;
});
const collection = {
  find(query: any) {
    let limit = Infinity;
    const cursor = { sort: () => cursor, project: () => cursor, batchSize: () => cursor,
      limit: (value: number) => { limit = value; return cursor; },
      toArray: async () => docs.filter(doc => matches(doc, query)).slice(0, limit) };
    return cursor;
  },
  findOne: async (query: any) => docs.find(doc => matches(doc, query)) || null,
  insertOne: async (doc: any) => { docs.push(doc); },
  insertMany: async (rows: any[]) => { insertBatchSizes.push(rows.length); docs.push(...rows); },
  findOneAndUpdate: async (query: any, patch: any) => { const doc = docs.find(doc => matches(doc, query)); if (doc) { for (const [key, value] of Object.entries(patch.$set)) { const parts = key.split('.'); if (parts.length === 2) doc[parts[0]][parts[1]] = value; else doc[key] = value; } } return doc || null; },
  countDocuments: async (query: any) => docs.filter(doc => matches(doc, query)).length,
  updateOne: async (query: any, patch: any) => { const doc = docs.find(doc => matches(doc, query)); if (!doc) return { matchedCount: 0 }; Object.assign(doc, patch.$set); return { matchedCount: 1 }; },
  deleteMany: async (query: any) => { docs = docs.filter(doc => !matches(doc, query)); },
  deleteOne: async (query: any) => { const index = docs.findIndex(doc => matches(doc, query)); if (index < 0) return { deletedCount: 0 }; docs.splice(index, 1); return { deletedCount: 1 }; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getThingsCollection: async () => collection, withMongoTransaction: async (work: any) => work({}) } });
mock.module(new URL('../storage/accountedThings.ts', import.meta.url).href, { namedExports: {
  insertAccountedThing: (things: any, doc: any, options: any) => things.insertOne(doc, options),
  insertAccountedThings: (things: any, rows: any[], options: any) => things.insertMany(rows, options),
  updateAccountedThing: (things: any, query: any, patch: any, options: any) => things.updateOne(query, patch, options),
  deleteAccountedThing: (things: any, query: any, options: any) => things.deleteOne(query, options),
  deleteAccountedThings: (things: any, query: any, options: any) => things.deleteMany(query, options)
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: { findUserById: async (id: string) => id === 'missing' ? null : { _id: id } } });
mock.module(new URL('../users/social.ts', import.meta.url).href, { namedExports: { friendIdsOf: async () => new Set(), groupIdsOf: async () => new Set() } });
mock.module(new URL('../things/things.ts', import.meta.url).href, { namedExports: { resolveProfiles: async (ids: string[]) => new Map(ids.map(id => [id, { id }])) } });
const { createGroup, listGroups, updateGroup } = await import('./groups.ts');
beforeEach(() => { docs = []; insertBatchSizes = []; });
test('relational groups and member lists remain reachable beyond former caps', async () => {
  const now = new Date();
  docs = Array.from({ length: 70 }, (_, i) => ({ shareId: `group-${i}`, thingtime: ['group'], ownerId: 'owner', crystal: { name: `Group ${i}` }, createdAt: now, updatedAt: now }));
  const members = Array.from({ length: 251 }, (_, i) => `member-${i}`);
  const created = await createGroup('owner', { name: 'Large group', memberIds: members });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.group.memberCount, 251);
  assert.equal(created.group.members.length, 251);
  assert.ok(insertBatchSizes.every(size => size <= 100));
  assert.equal((await listGroups('owner')).groups.length, 71);
  const updated = await updateGroup('owner', created.group.id, { memberIds: members.slice(10).concat('new-member') });
  assert.equal(updated.ok, true);
  if (updated.ok && 'group' in updated) assert.equal(updated.group.memberCount, 242);
  assert.equal((await listGroups('other')).groups.length, 0);
});
test('incremental member deltas cross the old request boundary without duplicate grants', async () => {
  const created = await createGroup('owner', { name: 'Large group' });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const members = Array.from({ length: 2200 }, (_, i) => `member-${String(i).padStart(30, '0')}`);
  for (let offset = 0; offset < members.length; offset += 100) {
    const batch = members.slice(offset, offset + 100);
    const added = await updateGroup('owner', created.group.id, { addMemberIds: batch });
    assert.equal(added.ok, true);
    const replay = await updateGroup('owner', created.group.id, { addMemberIds: batch });
    assert.equal(replay.ok, true);
  }
  assert.equal(docs.filter(doc => matches(doc, { thingtime: 'group-member', ownerId: 'owner' })).length, 2200);
  const removed = await updateGroup('owner', created.group.id, { removeMemberIds: members.slice(0, 200) });
  assert.equal(removed.ok, true);
  assert.equal((await listGroups('owner')).groups[0].memberCount, 2000);
  assert.equal((await updateGroup('other', created.group.id, { addMemberIds: ['member-foreign'] })).ok, false);
  assert.equal((await listGroups('other')).groups.length, 0);
});
test('large membership validation still rejects unknown users and excludes owner', async () => {
  const invalid = await createGroup('owner', { name: 'Group', memberIds: [...Array.from({ length: 150 }, (_, i) => `member-${i}`), 'missing'] });
  assert.equal(invalid.ok, false);
  assert.equal(docs.length, 0);
  const created = await createGroup('owner', { name: 'Group', memberIds: ['owner', 'member', 'member'] });
  assert.equal(created.ok, true);
  if (created.ok) assert.equal(created.group.memberCount, 1);
});
