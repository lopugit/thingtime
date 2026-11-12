import assert from 'node:assert/strict';
import test from 'node:test';

import { action, loader } from './_publications';

// The server-side gate on marketing publishing. Everything under /marketing is
// admin-only until an admin publishes it (marketing/publishing.ts), so this
// route is the one place a write can happen — it must fail closed for an
// anonymous caller, and it must do so BEFORE it reads a body or consults the
// rate limiter, which are the only steps that touch a database.

const url = 'http://localhost/api/v1/admin/marketing/publications';

const assertPrivate = (response: Response) => {
	assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
	assert.equal(response.headers.get('pragma'), 'no-cache');
};

test('the admin publication read fails closed and stays private for an anonymous caller', async () => {
	const response = await loader({ request: new Request(url) });
	assert.equal(response.status, 401);
	assertPrivate(response);
	assert.deepEqual(await response.json(), { ok: false, error: 'Unauthorized' });
});

test('an anonymous write is refused, and never leaks the audit trail or a publication list', async () => {
	const response = await action({
		request: new Request(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ changes: [{ key: 'hub', state: 'published' }] })
		})
	});
	assert.equal(response.status, 401);
	assertPrivate(response);
	const payload = await response.json();
	assert.deepEqual(payload, { ok: false, error: 'Unauthorized' });
	assert.ok(!('publications' in payload), 'a refused write must not answer with state');
	assert.ok(!('audit' in payload), 'the audit trail is admin-only');
});

test('the admin gate runs before the body is parsed, so an anonymous caller cannot make the server read one', async () => {
	// Well past MAX_BODY_BYTES (512 KiB) and not even valid JSON: if this still
	// answers 401 rather than a 400/413, the gate is ordered ahead of
	// readJsonBody and an unauthenticated caller cannot spend server work.
	const response = await action({
		request: new Request(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: `{"changes":[${'"junk",'.repeat(120_000)}`
		})
	});
	assert.equal(response.status, 401);
	assertPrivate(response);
	assert.deepEqual(await response.json(), { ok: false, error: 'Unauthorized' });
});
