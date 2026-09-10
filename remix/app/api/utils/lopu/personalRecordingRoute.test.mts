import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { PERSONAL_RECORDING_CAPABILITY } from './personalRecordingCore';

let actor: any, limit: any, failure: unknown;
const calls: any[] = [];
class Unavailable extends Error {}
mock.module(new URL('../devices/deviceAuth.ts', import.meta.url).href, { namedExports: {
	resolveDeviceActor: async () => actor
} });
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: {
	runWithMongoEndpoint: async (endpoint: unknown, work: () => unknown) => { assert.equal(endpoint, null); return work(); }
} });
mock.module(new URL('../rateLimit/subscription.ts', import.meta.url).href, { namedExports: {
	enforceSubscriptionRateLimit: async (_request: Request, product: string, ownerId: string) => {
		assert.equal(product, 'lopu.recordings'); assert.equal(ownerId, 'owner'); return limit;
	}
} });
mock.module(new URL('./personalRecordingAuth.ts', import.meta.url).href, { namedExports: {
	PersonalRecordingUnavailable: Unavailable,
	assertPersonalRecordingAuthority: async (value: any) => { assert.equal(value, actor); if (failure) throw failure; }
} });
const record = async (name: string, value: any, input?: any) => {
	assert.equal(value, actor); calls.push({ name, input }); return { ok: true, job: null };
};
mock.module(new URL('./personalRecordingStore.ts', import.meta.url).href, { namedExports: {
	claimPersonalRecording: (value: any) => record('claim', value),
	heartbeatPersonalRecording: (value: any, input: any) => record('heartbeat', value, input),
	failPersonalRecording: (value: any, input: any) => record('failed', value, input),
	completePersonalRecording: (value: any, input: any) => record('complete', value, input),
	readPersonalRecordingAudio: async (value: any, input: any) => {
		await record('audio', value, input); return { type: 'audio/wav', bytes: new Uint8Array([1, 2, 3]) };
	}
} });
const route = await import('../../../routes/api/v1/lopu/recordings/personal/_personal');
const url = 'https://thingtime.test/api/v1/lopu/recordings/personal';
const jobId = `lopu-recording-job-${'a'.repeat(64)}`;
const leaseId = '52a5a4a2-060c-44bf-a208-6aac88913e75';
const post = (body: unknown, headers: Record<string, string> = {}) => route.action({ request: new Request(url, {
	method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
}) });
const isPrivate = (response: Response) => {
	assert.equal(response.headers.get('cache-control'), 'private, no-store');
	assert.equal(response.headers.get('pragma'), 'no-cache');
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
};
beforeEach(() => {
	actor = { userId: 'owner', deviceId: 'worker', sessionId: 'paired-session', capabilities: [PERSONAL_RECORDING_CAPABILITY] };
	limit = { allowed: true }; failure = undefined; calls.length = 0;
});

test('missing device actor, capabilities, cross-origin and non-JSON requests cannot reach the broker', async () => {
	actor = null;
	const unauthorized = await post({ op: 'claim' }, { Cookie: 'tt_auth=synthetic-browser-session' });
	assert.equal(unauthorized.status, 401); isPrivate(unauthorized);
	actor = { capabilities: [] };
	assert.equal((await post({ op: 'claim' })).status, 403);
	assert.equal((await post({ op: 'claim' }, { Origin: 'https://other.test' })).status, 403);
	actor = { userId: 'owner', capabilities: [PERSONAL_RECORDING_CAPABILITY] };
	assert.equal((await post({ op: 'claim' }, { 'Content-Type': 'text/plain' })).status, 415);
	assert.equal((await route.loader({ request: new Request(url, { method: 'DELETE' }) })).status, 405);
	assert.equal(calls.length, 0);
});

test('account subscription allowance is enforced before every broker operation', async () => {
	limit = { allowed: false, retryAfterSeconds: 42 };
	const response = await post({ op: 'claim' });
	assert.equal(response.status, 429); isPrivate(response);
	limit = { allowed: false, unavailable: true };
	assert.equal((await route.loader({ request: new Request(url) })).status, 503);
	assert.equal(calls.length, 0);
});

test('malformed, unbounded and forged operation fields fail closed with private responses', async () => {
	for (const body of [{}, { op: 'delete-all', ownerId: 'other' }, { op: 'complete', jobId, leaseId, transcript: 'hello', analysis: 'bad json' }]) {
		const response = await post(body); assert.equal(response.status, 400); isPrivate(response);
	}
	for (const headers of [{}, { 'Content-Length': '600000' }]) {
		const response = await post({ op: 'claim', text: 'x'.repeat(524288) }, headers);
		assert.equal(response.status, 413); isPrivate(response);
	}
	assert.equal(calls.length, 0);
});

test('originless native requests dispatch only the closed protocol and return private audio bytes', async () => {
	assert.equal((await post({ op: 'claim', ownerId: 'other' })).status, 200);
	assert.equal((await post({ op: 'heartbeat', jobId, leaseId })).status, 200);
	assert.equal((await post({ op: 'failed', jobId, leaseId, stage: 'runtime' })).status, 200);
	assert.equal((await post({ op: 'complete', jobId, leaseId, transcript: 'Water the fern.', analysis: '{"items":[]}' })).status, 200);
	const audio = await route.loader({ request: new Request(`${url}?jobId=${jobId}&leaseId=${leaseId}`) });
	isPrivate(audio); assert.equal(audio.headers.get('content-type'), 'audio/wav');
	assert.equal(audio.headers.get('location'), null);
	assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3]);
	assert.deepEqual(calls.map((call) => call.name), ['claim', 'heartbeat', 'failed', 'complete', 'audio']);
	assert.deepEqual(calls.at(-1).input, { op: 'heartbeat', jobId, leaseId });
});

test('revoked authority and backend exceptions never leak private details', async () => {
	for (const error of [new Unavailable('private credential detail'), new Error('private credential detail')]) {
		failure = error;
		const response = await post({ op: 'claim' });
		assert.equal(response.status, error instanceof Unavailable ? 409 : 503);
		isPrivate(response); assert.doesNotMatch(await response.text(), /private credential detail/);
	}
	assert.equal(calls.length, 0);
});
