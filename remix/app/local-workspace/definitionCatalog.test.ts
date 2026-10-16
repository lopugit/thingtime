import assert from 'node:assert/strict';
import test from 'node:test';
import { browseLocalDefinitions } from './definitionCatalog';
import type { LocalThing } from './things';
const row = (id: string, kind: string, crystal = {}, targetId?: string): LocalThing => ({ id, thingtime: [kind], crystal, targetId, revision: 1, createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z' });
const rows = [row('a', 'schema', { name: 'Gold one' }), row('b', 'schema', { name: 'Other' }), row('c', 'schema', { name: 'Gold two' }), row('d', 'component', { name: 'Gold component' }), row('save-a', 'save', {}, 'a'), row('reaction-a', 'reaction', { emoji: '❤️' }, 'a'), row('use-a', 'data', { schemaId: 'a' })];
const browse = (args = {}, scope = 'anonymous') => browseLocalDefinitions(rows, 'schema', args, scope, row => ({ id: row.id, crystal: row.crystal }));
test('device catalogue filters before pagination and projects relational saves, reactions and usage', async () => {
 const first = await browse({ q: 'gold', limit: 1, sort: 'oldest' });
 assert.deepEqual(first.schemas.map(row => row.id), ['a']); assert.equal(first.total, 2); assert.equal('things' in first, false);
 assert.equal(first.schemas[0].saved, true); assert.deepEqual(first.schemas[0].viewerReactions, ['❤️']); assert.equal(first.schemas[0].usageCount, 1);
 const second = await browse({ q: 'gold', limit: 1, sort: 'oldest', cursor: first.nextCursor });
 assert.deepEqual(second.schemas.map(row => row.id), ['c']); assert.equal(second.nextCursor, null);
 assert.deepEqual((await browse({ library: true })).schemas.map(row => row.id), ['a']);
 assert.equal((await browse({ library: true, q: 'other' })).total, 0);
 for (const [args, scope] of [[{ q: 'gold', sort: 'oldest', library: true }, 'anonymous'], [{ q: 'gold', sort: 'oldest' }, 'account']] as const) await assert.rejects(browse({ ...args, cursor: first.nextCursor }, scope), /changed/);
 const components = await browseLocalDefinitions(rows, 'component', {}, 'anonymous', row => ({ id: row.id })); assert.deepEqual(components.components.map(row => row.id), ['d']);
});
