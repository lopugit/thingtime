import assert from 'node:assert/strict';
import test from 'node:test';

import { loader } from './_peers';

test('admin peer explorer fails closed and keeps even unauthorized diagnostic responses private', async () => {
	const response = await loader({ request: new Request('http://localhost/api/v1/admin/peers') });
	assert.equal(response.status, 401);
	assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
	assert.equal(response.headers.get('pragma'), 'no-cache');
	assert.deepEqual(await response.json(), { ok: false, error: 'Unauthorized' });
});
