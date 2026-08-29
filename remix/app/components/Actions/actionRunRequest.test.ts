import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildActionRunBody } from './actionRunRequest.ts';

// The delegated-run marker is a security control, not a hint: `source:
// 'component'` is the only thing that narrows execute.ts resolution to
// actions the viewer owns, and a ttAction control lives inside markup its
// author — not its clicker — wrote.
//
// The live battery (verify-actions.mjs R2) POSTs to /api/v1/actions/run
// directly, so it can only prove the SERVER honours the marker; it cannot see
// a client that never sends one. That is exactly how the field came to be
// dropped in useApi while every check stayed green. These tests cover the
// blind spot.

test('a delegated component click carries source into the request body', () => {
	const body = buildActionRunBody({ action: 'send-invoice', inputs: { invoiceId: 'abc' }, source: 'component' });
	assert.equal(body.source, 'component');
	assert.equal(body.action, 'send-invoice');
	assert.deepEqual(body.inputs, { invoiceId: 'abc' });
});

test('the deliberate inspector path sends no source, so a readable foreign action still resolves', () => {
	const body = buildActionRunBody({ action: 'abc123', inputs: {} });
	assert.equal('source' in body, false);
});

test('an absent, empty or non-string source is omitted rather than sent as junk', () => {
	assert.equal('source' in buildActionRunBody({ action: 'a' }), false);
	assert.equal('source' in buildActionRunBody({ action: 'a', source: '' }), false);
	assert.equal('source' in buildActionRunBody({ action: 'a', source: 7 }), false);
	assert.equal('source' in buildActionRunBody(), false);
});

test('a future source value is forwarded verbatim — the drop must not recur by omission', () => {
	assert.equal(buildActionRunBody({ action: 'a', source: 'webhook' }).source, 'webhook');
});

test('action and inputs are always present keys, so an omitted input list still posts cleanly', () => {
	const body = buildActionRunBody({ action: 'ping' });
	assert.equal(body.action, 'ping');
	assert.equal(body.inputs, undefined);
	assert.deepEqual(Object.keys(body), ['action', 'inputs']);
});
