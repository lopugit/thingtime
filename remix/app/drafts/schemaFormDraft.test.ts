import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreSchemaFormDraft, schemaFormValue } from './schemaFormDraft';
import { validateValueAgainstFields, type SchemaThingField } from '../schemas/registry';
import { schemaThingCreateInput } from '../schemas/schemaCopies';

const fields: SchemaThingField[] = [
	{ name: 'payload', type: 'json' },
	{ name: 'items', type: 'array', items: { type: 'object', children: [{ name: 'data', type: 'json' }] } },
	{ name: 'label', type: 'string' }
];

test('unfinished JSON source survives account serialization and cannot publish', () => {
	const value = { payload: '  {"unfinished":\n', items: [{ data: '[1,' }], label: 'keep me' };
	const restored = restoreSchemaFormDraft(JSON.stringify({ version: 2, value }), fields);
	assert.deepEqual(restored, value);
	assert.equal(validateValueAgainstFields(fields, schemaFormValue(fields, restored)).ok, false);
});

test('valid raw JSON becomes typed publication data without changing saved text', () => {
	const value = { payload: ' { "answer" : 42 } ', items: [{ data: 'false' }], label: 'unchanged' };
	const normalized = schemaFormValue(fields, value);
	assert.deepEqual(normalized, { payload: { answer: 42 }, items: [{ data: false }], label: 'unchanged' });
	assert.equal(value.payload, ' { "answer" : 42 } ');
	assert.equal(validateValueAgainstFields(fields, normalized).ok, true);
	const input = schemaThingCreateInput({ origin: 'community', id: 'schema-id', name: 'Shape' }, normalized);
	assert.deepEqual(input.thingtime, ['data']);
	assert.deepEqual(input.crystal.payload, { answer: 42 });
});

test('legacy parsed JSON drafts retain strings, objects, booleans and array positions', () => {
	const value = { payload: 'a JSON string', items: [{ data: { nested: true } }, { data: false }] };
	const restored = restoreSchemaFormDraft(JSON.stringify({ value }), fields);
	assert.deepEqual(schemaFormValue(fields, restored), value);
	assert.equal(restored.payload, '"a JSON string"');
	const afterRemoval = { ...restored, items: (restored.items as unknown[]).slice(1) };
	assert.deepEqual(schemaFormValue(fields, afterRemoval).items, [{ data: false }]);
});

test('clearing optional JSON remains empty while malformed optional JSON stays invalid', () => {
	assert.equal(validateValueAgainstFields(fields, schemaFormValue(fields, { payload: '  ' })).ok, true);
	assert.equal(validateValueAgainstFields(fields, schemaFormValue(fields, { payload: 'oops' })).ok, false);
});
