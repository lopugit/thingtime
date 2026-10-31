import assert from 'node:assert/strict';
import test from 'node:test';

import { loader } from './_publications';

// The anonymous half of marketing publishing. Every /marketing surface gates on
// this one endpoint before first paint (marketing/publishing.ts), so it is the
// only publication read a visitor can reach — and the only place the admin-only
// audit trail could leak out. Its sibling admin route has its own gate tests
// (../../admin/marketing/publications/_publications.test.ts); these pin the two
// properties that are this route's alone:
//
//   1. it answers a signed-out caller at all (the suite must not need a session)
//   2. it answers WITHOUT `audit`, and never caches
//
// Both run with no Mongo reachable, which is also the fail-closed case worth
// pinning: the store swallows the read failure and publishes nothing rather
// than exposing unpublished surfaces, and the fail-OPEN limiter still lets the
// visitor through.

const url = 'http://localhost/api/v1/marketing/publications';

test('an anonymous visitor can read the publish state, and gets no audit trail', async () => {
	const response = await loader({ request: new Request(url) });
	assert.equal(response.status, 200);

	const payload = await response.json();
	assert.equal(payload.ok, true);
	assert.deepEqual(payload.publications, { published: [], hidden: [], updatedAt: null }, 'an unreachable store publishes nothing rather than everything');
	assert.ok(!('audit' in payload.publications), 'who switched each key is admin-only and must never reach a visitor');
	assert.ok(!('audit' in payload), 'nor at the top level');
});

test('the publish state is never cached, so a publish shows on the next navigation', async () => {
	const response = await loader({ request: new Request(url) });
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal(response.headers.get('pragma'), 'no-cache');
});
