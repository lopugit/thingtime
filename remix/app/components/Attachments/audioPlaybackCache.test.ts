import assert from 'node:assert/strict';
import test from 'node:test';

import { audioOfflineCacheKey, isOfflineAudioRecord, saveOfflineAudio } from './audioPlaybackCache';
import { sharedAttachmentUrl } from '../Sharing/sharedMediaCore';

test('offline audio cache keys are account-scoped and encode attachment identifiers', () => {
	assert.equal(audioOfflineCacheKey('track/one', 'listener@example.test'), 'thingtime:audio:v1:listener%40example.test:track%2Fone');
	assert.equal(audioOfflineCacheKey('track one', null), 'thingtime:audio:v1:anonymous:track%20one');
	assert.notEqual(audioOfflineCacheKey('track', 'one'), audioOfflineCacheKey('track', 'two'));
});

test('offline audio cache validation accepts only a complete current blob record', () => {
	const valid = {
		version: 'v1' as const,
		attachmentId: 'track',
		viewerId: 'listener',
		contentType: 'audio/mp4',
		bytes: new Blob(['sound'], { type: 'audio/mp4' }),
		cachedAt: 123
	};
	assert.equal(isOfflineAudioRecord(valid), true);
	assert.equal(isOfflineAudioRecord({ ...valid, version: 'v0' }), false);
	assert.equal(isOfflineAudioRecord({ ...valid, bytes: 'not-a-blob' }), false);
	assert.equal(isOfflineAudioRecord({ ...valid, cachedAt: Number.NaN }), false);
});

test('explicit offline downloads forward shared context and wait for ready authorization', async () => {
	const originalWindow = globalThis.window;
	const originalFetch = globalThis.fetch;
	const attachment = { id: 'audio', size: 10, mediaKind: 'audio', contentType: 'audio/mpeg', name: 'track.mp3' } as any;
	let calls = 0;
	try {
		(globalThis as any).window = {};
		globalThis.fetch = async (source) => {
			calls += 1;
			assert.equal(source, '/api/v1/attachments/content?id=audio&key=fixture-key&sharedRoot=page');
			return new Response(null, { status: 404 });
		};
		await assert.rejects(saveOfflineAudio(attachment, null, (url) => sharedAttachmentUrl(url, 'fixture-key', 'page')), /could not download/);
		await assert.rejects(saveOfflineAudio(attachment, null, () => ''), /not ready/);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalWindow === undefined) delete (globalThis as any).window;
		else globalThis.window = originalWindow;
	}
});
