import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeVersionValues, versionContent } from './versions.ts';

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
