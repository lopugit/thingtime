import assert from 'node:assert/strict';
import test from 'node:test';

import { nextQueuedAudioIndex } from './audioPlaybackCore.ts';

test('audio queues advance in attachment order and stop after the final track', () => {
	assert.equal(nextQueuedAudioIndex(0, 3), 1);
	assert.equal(nextQueuedAudioIndex(1, 3), 2);
	assert.equal(nextQueuedAudioIndex(2, 3), null);
	assert.equal(nextQueuedAudioIndex(0, 1), null);
});
