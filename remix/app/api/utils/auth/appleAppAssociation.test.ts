import assert from 'node:assert/strict';
import test from 'node:test';
import { appleAppAssociation } from './appleAppAssociation';
test('Apple webcredentials exposes only explicitly configured valid application identifiers', () => {
	assert.deepEqual(appleAppAssociation(''), { webcredentials: { apps: [] } });
	assert.deepEqual(appleAppAssociation('ABCDEFGHIJ.com.example.app, ABCDEFGHIJ.com.example.app,*,https://example.com,garbage'), {
		webcredentials: { apps: ['ABCDEFGHIJ.com.example.app'] }
	});
});
