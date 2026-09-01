import assert from 'node:assert/strict';
import test from 'node:test';

import { privateAccountHintsHeaders } from './accountHintsHeaders';

test('account-hint responses are private, non-storable, and vary by cookie', () => {
	const headers = privateAccountHintsHeaders();

	assert.equal(headers.get('Cache-Control'), 'private, no-store');
	assert.equal(headers.get('Vary'), 'Cookie');
});

test('account-hint privacy headers preserve CORS and rate-limit response headers', () => {
	const headers = privateAccountHintsHeaders(
		{ 'Access-Control-Allow-Origin': 'https://pr-367.previews.dev.thingtime.com', Vary: 'Origin' },
		{ 'Retry-After': '30', Vary: 'origin, Cookie' }
	);

	assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://pr-367.previews.dev.thingtime.com');
	assert.equal(headers.get('Retry-After'), '30');
	assert.equal(headers.get('Cache-Control'), 'private, no-store');
	assert.equal(headers.get('Vary'), 'Origin, Cookie');
});
