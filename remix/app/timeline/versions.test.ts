import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeVersionValues, versionContent, versionContentEquals } from './versions.ts';

test('three-way merge preserves independent edits, additions and deletion vs null', () => {
 const result = mergeVersionValues({ name: 'A', color: 'red', obsolete: true }, { name: 'B', color: 'red' }, { name: 'A', color: 'blue', obsolete: true, new: null });
 assert.deepEqual(JSON.parse(JSON.stringify(result.value)), { color: 'blue', name: 'B', new: null }); assert.deepEqual(result.conflicts, []);
});
test('overlapping edits and array reorder require explicit choices; stale choices are refused', () => {
 const base = { blocks: [{ id: 'a' }, { id: 'b' }], title: 'A' };
 const current = { blocks: [{ id: 'b' }, { id: 'a' }], title: 'B' };
 const incoming = { blocks: [{ id: 'a', text: 'New' }, { id: 'b' }], title: 'C' };
 const preview = mergeVersionValues(base, current, incoming);
 assert.deepEqual(preview.conflicts.map(conflict => conflict.path), [['blocks'], ['title']]);
 const resolved = mergeVersionValues(base, current, incoming, { '["blocks"]': 'current', '["title"]': 'incoming' });
 assert.deepEqual(JSON.parse(JSON.stringify(resolved.value)), { blocks: current.blocks, title: 'C' }); assert.equal(resolved.conflicts.length, 0);
 assert.throws(() => mergeVersionValues(base, current, incoming, { '["missing"]': 'current' }), /no longer match/);
});
test('conflicts distinguish an absent field, null and false and keep prototype-shaped fields inert', () => {
 const result = mergeVersionValues({ x: true }, {}, { x: null });
 assert.deepEqual(result.conflicts[0], { path: ['x'], base: { present: true, value: true }, current: { present: false }, incoming: { present: true, value: null } });
 const output = mergeVersionValues({}, JSON.parse('{"__proto__":{"safe":false}}'), { added: 1 });
 assert.equal(Object.prototype.hasOwnProperty.call(output.value, '__proto__'), true); assert.equal(({} as any).safe, undefined);
});
test('draft adapters inherit only a saved basis and never restore root credentials', () => {
 const basis = { crystal: { name: 'Old' }, extended: null, tags: [], geo: null, acl: ['tt:user'], folderId: null, secure: 'never' };
 assert.deepEqual(JSON.parse(JSON.stringify(versionContent({ adapter: 'definition-source', version: 1, value: { source: '{"name":"New"}' } }, basis))), { crystal: { name: 'New' }, extended: null, tags: [], geo: null, acl: ['tt:user'], folderId: null });
 assert.throws(() => versionContent({ adapter: 'definition-source', version: 1, value: { source: '{' } }, basis), /invalid JSON/);
 assert.throws(() => versionContent({ adapter: 'webpage-draft', version: 1, value: { crystal: {} } }), /ancestor/);
});
test('undo = mergeVersionValues(base=after, current, incoming=before): later edits of other properties survive, overlaps conflict, arrays stay atomic', () => {
 const before = { crystal: { a: 1, b: 1, list: [1] } }; const after = { crystal: { a: 2, b: 1, list: [1, 2] } };
 const clean = mergeVersionValues(after, { crystal: { a: 2, b: 2, list: [1, 2] } }, before);
 assert.deepEqual(JSON.parse(JSON.stringify(clean.value)), { crystal: { a: 1, b: 2, list: [1] } }); assert.deepEqual(clean.conflicts, []);
 const untouched = mergeVersionValues(after, { crystal: { a: 2, b: 1, list: [1, 2] } }, before);
 assert.deepEqual(JSON.parse(JSON.stringify(untouched.value)), before, 'without later edits the undo restores the before-state exactly');
 const overlap = mergeVersionValues(after, { crystal: { a: 3, b: 1, list: [1, 2, 3] } }, before);
 assert.deepEqual(overlap.conflicts.map(conflict => conflict.path), [['crystal', 'a'], ['crystal', 'list']], 'an array edited on both sides is one atomic conflict');
 assert.deepEqual(overlap.conflicts[0], { path: ['crystal', 'a'], base: { present: true, value: 2 }, current: { present: true, value: 3 }, incoming: { present: true, value: 1 } });
 const chosen = mergeVersionValues(after, { crystal: { a: 3, b: 1, list: [1, 2, 3] } }, before, { '["crystal","a"]': 'incoming', '["crystal","list"]': 'current' });
 assert.deepEqual(JSON.parse(JSON.stringify(chosen.value)), { crystal: { a: 1, b: 1, list: [1, 2, 3] } }); assert.equal(chosen.conflicts.length, 0);
 const reverted = mergeVersionValues(after, { crystal: { a: 1, b: 1, list: [1] } }, before);
 assert.equal(reverted.conflicts.length, 0); assert.equal(versionContentEquals(reverted.value, { crystal: { a: 1, b: 1, list: [1] } }), true, 'an already reverted edit merges to the current content');
});
test('versionContentEquals ignores key order between versionContent output and sorted merge results', () => {
 const basis = { folderId: 'f', acl: ['tt:user'], geo: null, tags: ['t'], extended: { x: 1 }, crystal: { z: 1, a: [1, { k: 'v', j: null }] } };
 const ordered = versionContent({ adapter: 'thing-content', version: 1, value: { ...basis, secure: 'never' } });
 assert.deepEqual(Object.keys(ordered), ['crystal', 'extended', 'tags', 'geo', 'acl', 'folderId']);
 const sorted = mergeVersionValues(basis, basis, basis).value;
 assert.notEqual(JSON.stringify(ordered), JSON.stringify(sorted), 'plain JSON equality is never true across the two orders');
 assert.equal(versionContentEquals(ordered, sorted), true);
 assert.equal(versionContentEquals(ordered, { ...basis, crystal: { z: 1, a: [{ k: 'v', j: null }, 1] } }), false, 'array order still matters');
 assert.equal(versionContentEquals(ordered, { ...basis, extended: null }), false);
});
