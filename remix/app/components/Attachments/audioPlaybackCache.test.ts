import assert from 'node:assert/strict';
import test from 'node:test';

import { audioOfflineCacheKey, isOfflineAudioRecord } from './audioPlaybackCache';

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
