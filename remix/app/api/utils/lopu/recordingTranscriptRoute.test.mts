import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let user: any = { id: 'owner' };
let failed = false;
const reads: any[] = [];
mock.module(new URL('../auth/scopedUser.ts', import.meta.url).href, { namedExports: { getScopedUser: async (_: Request, scope: string) => { assert.equal(scope, 'lopu.recordings'); return user; } } });
mock.module(new URL('../attachments/attachmentResponses.ts', import.meta.url).href, { namedExports: { isSameOriginAttachmentRequest: () => true } });
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: { runWithMongoEndpoint: async (endpoint: unknown, work: () => unknown) => { assert.equal(endpoint, null); return work(); } } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: { rateLimitedResponseInit: () => ({}) } });
mock.module(new URL('../rateLimit/subscription.ts', import.meta.url).href, { namedExports: { enforceSubscriptionRateLimit: async () => ({ allowed: true }) } });
const unused = () => { throw new Error('Transcript reads must not load settings or invoke processing'); };
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, { namedExports: Object.fromEntries(['listRecordingAutomation', 'getRecordingSettings', 'queueRecordingPost', 'retryRecordingJob', 'setRecordingSettings'].map((name) => [name, unused])) });
mock.module(new URL('./recordingsConnections.ts', import.meta.url).href, { namedExports: { recordingConnectionStatus: unused, validateRecordingConnections: unused } });
mock.module(new URL('./recordingsReminders.ts', import.meta.url).href, { namedExports: { updateRecordingTodo: unused } });
mock.module(new URL('../things/thingActions.ts', import.meta.url).href, { namedExports: { dispatchThingAction: unused } });
mock.module(new URL('./recordingTranscripts.ts', import.meta.url).href, { namedExports: { readRecordingTranscripts: async (owner: string, ids: string[]) => {
	reads.push({ owner, ids }); if (failed) throw new Error('secret diagnostic'); return [{ attachmentId: ids[0], text: 'Synthetic saved quote' }];
} } });
const { loader } = await import('../../../routes/api/v1/lopu/recordings/_recordings');
const read = (query: string) => loader({ request: new Request(`https://thingtime.test/api/v1/lopu/recordings?transcriptAttachmentIds=${query}`) });
test('transcript route negotiable read is authenticated, bounded, home-pinned and private/no-store', async () => {
	user = null; assert.equal((await read('audio')).status, 401);
	user = { id: 'owner', temporary: true }; assert.equal((await read('audio')).status, 401);
	user = { id: 'owner' }; assert.equal((await read('')).status, 400);
	assert.equal((await read('../audio')).status, 400);
	assert.equal(reads.length, 0);
	const response = await read('audio,other,audio');
	assert.equal(response.status, 200);
	assert.match(response.headers.get('cache-control')!, /private, no-store/);
	assert.deepEqual(await response.json(), { ok: true, ownerId: 'owner', transcripts: [{ attachmentId: 'audio', text: 'Synthetic saved quote' }] });
	assert.deepEqual(reads, [{ owner: 'owner', ids: ['audio', 'other'] }]);
	failed = true;
	const unavailable = await read('audio');
	assert.equal(unavailable.status, 503);
	assert.doesNotMatch(await unavailable.text(), /secret/);
});
