import assert from 'node:assert/strict';
import test from 'node:test';
import { searchLocalThings } from './structuredSearch';
import type { LocalThing } from './things';
import { buildGroup } from '../api/utils/things/searchGrammar';

const row = (id: string, crystal: Record<string, any>, extra: Partial<LocalThing> = {}): LocalThing => ({ id, crystal, thingtime: ['data'], tags: ['gold', 'warm'], revision: 1, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T01:00:00.000Z', ...extra });
const rows = [row('a', { name: 'Golden [card]', price: 5, enabled: true, nil: null, nested: { count: 7 }, list: [{ value: 4 }, { value: 9 }] }), row('b', { name: 'Peach card', price: 12, enabled: false, values: [1, 8] }), row('c', { name: 'Rose card', price: '5' })];
const ids = async (conditions: any[], extra = {}, input = rows) => (await searchLocalThings(input, { conditions, sort: 'oldest', ...extra }, 'anonymous')).things.map(row => row.id);
const condition = (field: string, op: string, value?: unknown) => ({ field, op, value });

test('device filters reuse the canonical bounded grammar and match scalar and array values', async () => {
 for (const [field, op, value, expected] of [
  ['price', 'eq', 5, ['a']], ['price', 'ne', 5, ['b', 'c']], ['price', 'gt', 5, ['b']], ['price', 'gte', 5, ['a', 'b']],
  ['price', 'lt', 6, ['a']], ['price', 'lte', 5, ['a']], ['price', 'in', [5, 12], ['a', 'b']], ['price', 'nin', [5, 12], ['c']],
  ['name', 'contains', '[CARD]', ['a']], ['name', 'startsWith', 'peach', ['b']], ['name', 'endsWith', 'card', ['b', 'c']],
  ['enabled', 'eq', true, ['a']], ['tags', 'eq', 'gold', ['a', 'b', 'c']], ['nested.count', 'eq', 7, ['a']],
  ['list.value', 'gte', 8, ['a']], ['values', 'gt', 7, ['b']], ['list.0.value', 'eq', 4, ['a']],
  ['shareId', 'eq', 'b', ['b']], ['createdAt', 'eq', '2026-10-16T00:00:00Z', ['a', 'b', 'c']]
 ] as const) assert.deepEqual(await ids([condition(field, op, value)]), expected, `${field} ${op}`);
 assert.deepEqual(await ids([{ field: 'price', op: 'between', values: [5, 10] }]), ['a']);
 assert.deepEqual(await ids([{ field: 'createdAt', op: 'between', values: ['2026-10-15', '2026-10-17'] }]), ['a', 'b', 'c']);
 assert.deepEqual(await ids([{ mode: 'any', conditions: [condition('price', 'eq', 5), condition('price', 'eq', 12)] }, condition('enabled', 'eq', true)]), ['a']);
 assert.deepEqual(await ids([condition('price', 'eq', 5), condition('price', 'eq', 12)], { mode: 'any' }), ['a', 'b']);
});

test('missing/null, types and prototype paths retain field semantics without exposing object prototypes', async () => {
 for (const [field, op, value, expected] of [
  ['nil', 'eq', null, ['a', 'b', 'c']], ['nil', 'ne', null, []], ['nil', 'exists', true, ['a']], ['nil', 'exists', false, ['b', 'c']],
  ['nil', 'type', 'null', ['a']], ['price', 'type', 'number', ['a', 'b']], ['price', 'type', 'string', ['c']], ['enabled', 'type', 'boolean', ['a', 'b']],
  ['nested', 'type', 'object', ['a']], ['list', 'type', 'array', ['a']], ['createdAt', 'type', 'date', ['a', 'b', 'c']],
  ['constructor.name', 'exists', true, []], ['__proto__.polluted', 'exists', true, []]
 ] as const) assert.deepEqual(await ids([condition(field, op, value)]), expected, `${field} ${op}`);
 for (const value of ['constructor', '__proto__', 'toString']) {
  assert.equal(buildGroup({ conditions: [condition('price', 'type', value)] }, 1, { total: 0 }).ok, false);
 }
});

test('literal text, exclusion of protected records and draft files, and stable scoped cursors', async () => {
 assert.deepEqual(await ids([], { q: '[CARD]' }), ['a']);
 assert.deepEqual(await ids([], { q: '.*' }), []);
 assert.deepEqual(await ids([], { q: 'price' }), [], 'keys are not authored values');
 const first = await searchLocalThings(rows, { limit: 1 }, 'anonymous');
 const second = await searchLocalThings(rows, { cursor: first.nextCursor, limit: 2 }, 'anonymous');
 assert.deepEqual([...first.things, ...second.things].map(row => row.id), ['c', 'b', 'a']);
 assert.equal(second.nextCursor, null); assert.equal(second.total, 3);
 for (const [input, query, scope] of [[rows, { q: 'card' }, 'anonymous'], [rows, {}, 'account:a'], [rows.filter(row => row.id !== 'c'), {}, 'anonymous']] as const) {
  await assert.rejects(searchLocalThings([...input], { ...query, cursor: first.nextCursor }, scope), /changed/);
 }
 const privateRows = [row('history', {}, { thingtime: ['notification'] }), row('user', {}, { thingtime: ['user'] }), row('plain', {}), row('draft', {}, { thingtime: ['attachment'], localAttachment: { purpose: 'file', draftId: 'draft' } } as any)];
 assert.deepEqual(await ids([], {}, privateRows), ['plain']);
});

test('invalid inputs fail explicitly rather than widening searches or executing operator injection', async () => {
 for (const query of [
  { conditions: 'invalid' }, { conditions: [null] }, { conditions: [condition('$where', 'eq', 'anything')] },
  { conditions: [condition('price', 'eq', { $gt: 0 })] }, { conditions: Array.from({ length: 33 }, () => condition('price', 'eq', 1)) },
  { conditions: [condition('price', 'in', Array(51).fill(1))] }, { conditions: [condition('name', 'contains', 'a'.repeat(513))] },
  { conditions: [condition('price', 'gt', true)] }, { conditions: [condition('price', '$where', 'x')] },
  { conditions: [condition('createdAt', 'eq', 'nonsense')] }, { conditions: [condition('price', 'eq', Infinity)] },
  { conditions: [{ field: 'price', op: 'between' }] }, { mode: 'bad' }, { sort: 'relevance' }, { author: 'someone-else' },
  { q: {} }, { q: 'a'.repeat(201) }, { thingtime: ['data'] }, { limit: 51 }, { limit: NaN }, { cursor: 'remote-cursor' }
 ]) await assert.rejects(searchLocalThings(rows, query, 'anonymous'), undefined, JSON.stringify(query));
 let group: any = condition('price', 'eq', 5);
 for (let n = 0; n < 4; n++) group = { conditions: [group] };
 await assert.rejects(ids([group]), /nest/);
});
