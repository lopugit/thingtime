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

test('component family expansion and filters precede paging, preserve provenance and scope cursors', async () => {
 const components = [
  row('a', 'component', { name: 'First design', library: 'thingtime', familyKey: 'card', componentKey: 'card-a' }),
  row('b', 'component', { name: 'Second design', library: 'custom', familyKey: 'card', componentKey: 'card-b' }),
  row('c', 'component', { name: 'Other family', library: 'custom', familyKey: 'other', componentKey: 'other' })
 ];
 const project = (row: LocalThing) => ({ ...row, author: { id: 'local' } });
 const run = (args = {}) => browseLocalDefinitions(components, 'component', args, 'scope', project);
 assert.deepEqual((await run({ family: 'card-a', sort: 'oldest' })).components!.map(row => row.id), ['a', 'b']);
 assert.deepEqual((await run({ family: 'b', sort: 'oldest' })).components!.map(row => row.id), ['a', 'b']);
 assert.deepEqual((await run({ lib: 'custom', q: 'second' })).components!.map(row => row.id), ['b']);
 const first = await run({ group: 'family', sort: 'oldest', limit: 1 });
 assert.equal(first.total, 2); assert.equal(first.components![0].id, 'a'); assert.equal(first.components![0].designs.length, 2);
 const second = await run({ group: 'family', sort: 'oldest', limit: 1, cursor: first.nextCursor }); assert.equal(second.components![0].id, 'c');
 await assert.rejects(run({ group: 'family', sort: 'oldest', lib: 'custom', cursor: first.nextCursor }), /changed/);
 for (const args of [{ family: {} }, { lib: 4 }, { group: 'unknown' }]) await assert.rejects(run(args));
 const bundled: any[] = [{ ...row('component-bundled', 'component', { name: 'Bundled', render: { tag: 'p' } }), author: null }];
 const result = await browseLocalDefinitions(components, 'component', {}, 'scope', project, bundled);
 assert.equal(result.components!.find(row => row.id === 'component-bundled').author, null);
 assert.equal((await browseLocalDefinitions(components, 'component', { mine: true }, 'scope', project, bundled)).components!.some(row => row.id === 'component-bundled'), false);
});
