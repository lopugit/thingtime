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
  updateOne: async (query: any, patch: any) => { Object.assign(docs.find(doc => matches(doc, query)), patch.$set); },
  deleteMany: async (query: any) => { docs = docs.filter(doc => !matches(doc, query)); }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getThingsCollection: async () => collection } });
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
  if (updated.ok) assert.equal(updated.group.memberCount, 242);
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
