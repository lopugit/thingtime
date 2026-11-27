import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { awaitMongoSharedWork, mongoRequestOptions, startMongoSharedWork } from '../../../../../../api/utils/mongodb/requestBudget';

const administrator = { id: 'synthetic-admin', username: 'synthetic-admin', isAdmin: true };
let authorize: () => Promise<any> = async () => administrator;
let reads = 0, writes = 0;
const authOptions: Array<ReturnType<typeof mongoRequestOptions>> = [];
const readOptions: Array<ReturnType<typeof mongoRequestOptions>> = [];
mock.module(new URL('../../../../../../api/utils/auth/getCurrentUser.ts', import.meta.url).href, { namedExports: {
	getCurrentUser: async () => { authOptions.push(mongoRequestOptions()); return authorize(); }
} });
mock.module(new URL('../../../../../../api/utils/marketing/marketingPublications.ts', import.meta.url).href, { namedExports: {
	getMarketingPublicationsResult: async (options: { audit: boolean }) => {
		assert.equal(options.audit, true); reads++; readOptions.push(mongoRequestOptions());
		return { ok: true, freshness: 'live', publications: { published: ['hub'], hidden: [], audit: {} } };
	},
	applyMarketingPublicationChanges: async () => { writes++; return { ok: true, freshness: 'unavailable', applied: 1 }; }
} });
mock.module(new URL('../../../../../../api/utils/rateLimit/enforce.ts', import.meta.url).href, { namedExports: {
	enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 })
} });
const { loader, action } = await import('./_publications');
const url = 'https://thingtime.test/api/v1/admin/marketing/publications';
const privateUnavailable = async (response: Response) => {
	assert.equal(response.status, 503);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.equal(response.headers.get('Pragma'), 'no-cache');
	assert.equal(response.headers.get('Retry-After'), '15');
	const body = await response.json();
	assert.equal(body.ok, false); assert.equal(body.freshness, 'unavailable');
	assert.equal('publications' in body, false); assert.equal('audit' in body, false);
};
beforeEach(() => { authorize = async () => administrator; reads = 0; writes = 0; authOptions.length = 0; readOptions.length = 0; });

test('admin GET budgets both authentication and its private audit read', async () => {
	const response = await loader({ request: new Request(url) });
	assert.equal(response.status, 200); assert.equal(reads, 1);
	for (const options of [...authOptions, ...readOptions]) {
		assert.ok(options.signal instanceof AbortSignal);
		assert.ok(options.timeoutMS! > 0 && options.timeoutMS! <= 6000);
	}
});

test('cancelled authentication stops only its shared waiter and a live admin request can finish', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let initialization: Promise<typeof administrator> | null = null, starts = 0;
	authorize = () => {
		initialization ??= startMongoSharedWork(async () => { starts++; await gate; assert.deepEqual(mongoRequestOptions(), {}); return administrator; });
		return awaitMongoSharedWork(initialization);
	};
	const cancelled = new AbortController();
	const first = loader({ request: new Request(url, { signal: cancelled.signal }) });
	const second = loader({ request: new Request(url) });
	cancelled.abort();
	await privateUnavailable(await first);
	assert.equal(reads, 0, 'Cancelled authentication cannot reach private publications');
	release();
	assert.equal((await second).status, 200);
	assert.equal(starts, 1); assert.equal(reads, 1);
});

test('the six-second authentication deadline returns private unavailable without late audit reads', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let release!: (value: typeof administrator) => void;
	const shared = new Promise<typeof administrator>(resolve => { release = resolve; });
	authorize = () => awaitMongoSharedWork(shared);
	let finished = false;
	const request = loader({ request: new Request(url) }).then(response => { finished = true; return response; });
	t.mock.timers.tick(5999);
	await Promise.resolve(); assert.equal(finished, false);
	t.mock.timers.tick(1);
	await privateUnavailable(await request);
	release(administrator);
	await Promise.resolve(); await Promise.resolve();
	assert.equal(reads, 0);
});

test('401/403 gates and committed POST readback semantics stay intact', async () => {
	for (const [user, status] of [[null, 401], [{ ...administrator, isAdmin: false }, 403]] as const) {
		authorize = async () => user;
		for (const handler of [loader, action]) {
			const response = await handler({ request: new Request(url, { method: handler === action ? 'POST' : 'GET' }) });
			assert.equal(response.status, status);
			assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
		}
	}
	assert.equal(reads, 0); assert.equal(writes, 0);
	authorize = async () => administrator;
	const response = await action({ request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [{ key: 'hub', state: 'published' }] }) }) });
	assert.equal(response.status, 200); assert.equal(writes, 1);
	assert.equal((await response.json()).freshness, 'unavailable');
	assert.deepEqual(authOptions.at(-1), {}, 'POST does not inherit a new read deadline');
});
