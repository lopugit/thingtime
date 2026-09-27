import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { enforceExpectedDataPlane, mongoDataPlane } from './dataPlane';
import { runWithMongoEndpoint } from './endpoint';
import { EXPECTED_DATA_PLANE_HEADER } from '../../../utils/dataPlane';
import { timelineDataPlane } from '../timeline/service';

test('database identity stays identical to Timeline and never hashes connection credentials', () => {
	// Runtime-only credentials on a reserved test host; never a usable account.
	const credentials = `${randomUUID()}:${randomUUID()}`;
	const a = { url: `mongodb://${credentials}@db.test:27017/alpha`, savedId: null };
	const b = { url: `mongodb://${randomUUID()}:${randomUUID()}@db.test:27017/alpha?retryWrites=true`, savedId: 'saved' };
	const c = { url: `mongodb://${credentials}@db.test:27017/beta`, savedId: null };
	assert.equal(mongoDataPlane(a), mongoDataPlane(b));
	assert.notEqual(mongoDataPlane(a), mongoDataPlane(c));
	assert.equal(runWithMongoEndpoint(a, timelineDataPlane), mongoDataPlane(a));
	assert.equal(mongoDataPlane(null), 'home');
	const old = process.env.MONGODB_CONNECTION_STRING;
	try { process.env.MONGODB_CONNECTION_STRING = a.url; assert.equal(mongoDataPlane(a), 'home'); }
	finally { if (old === undefined) delete process.env.MONGODB_CONNECTION_STRING; else process.env.MONGODB_CONNECTION_STRING = old; }
});

test('expected database fences both read and write handlers without redirecting the selection', async () => {
	const custom = { url: 'mongodb://db.test/alpha', savedId: null };
	for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
		const request = (expected?: string) => new Request('https://thingtime.test/api/v1/things', { method, ...(expected === undefined ? {} : { headers: { [EXPECTED_DATA_PLANE_HEADER]: expected } }) });
		assert.equal(enforceExpectedDataPlane(request(), custom), null);
		assert.equal(enforceExpectedDataPlane(request(mongoDataPlane(custom)), custom), null);
		assert.equal(enforceExpectedDataPlane(request('home'), null), null);
		const stale = enforceExpectedDataPlane(request('home'), custom)!;
		assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'DATA_PLANE_CHANGED');
		assert.match(stale.headers.get('Cache-Control')!, /no-store/);
		for (const bad of ['', 'home,home', 'custom-secret', 'home/other']) assert.equal(enforceExpectedDataPlane(request(bad), custom)?.status, 400);
	}
});
