import assert from 'node:assert/strict';
import test from 'node:test';
import { listSchemaIdMatch, listCrystalIdMatch } from './things';

test('optional saved Schema Thing ID becomes an exact crystal predicate before paging', () => {
	assert.deepEqual(listSchemaIdMatch(null), { ok: true, match: null });
	assert.deepEqual(listSchemaIdMatch('sample-schema-contact'), { ok: true, match: { 'crystal.schemaId': 'sample-schema-contact' } });
	assert.deepEqual(listSchemaIdMatch('sample-schema-route'), { ok: true, match: { 'crystal.schemaId': 'sample-schema-route' } });
	assert.deepEqual(listCrystalIdMatch('parentId', 'sample-route-one'), { ok: true, match: { 'crystal.parentId': 'sample-route-one' } });
	// This predicate is on the stored schema stamp, never a title/kind guess.
	const filter = listSchemaIdMatch('sample-schema-contact');
	assert.equal(filter.ok, true);
	if (filter.ok) {
		assert.equal(filter.match?.['crystal.schemaId'], 'sample-schema-contact');
		assert.deepEqual(Object.keys(filter.match || {}), ['crystal.schemaId']);
	}
});

test('schema list filter rejects ambiguous or operator-shaped IDs', () => {
	for (const value of ['', '$ne', 'a.b', 'two words', 'line\nbreak', 'x'.repeat(129), 123, {}]) {
		const result = listSchemaIdMatch(value);
		assert.equal(result.ok, false, String(value));
		if (!result.ok) assert.equal(result.status, 400);
		assert.equal(listCrystalIdMatch('parentId', value).ok, false, String(value));
	}
});
