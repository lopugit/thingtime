import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecordingReference } from './recordingReference';
import { supportsSavedRecordings } from './recordingsCapabilities';

test('recording references accept raw IDs and exact-domain Thing/post links only', () => {
	const origin = 'https://thingtime.test';
	for (const input of [' audio-123 ', origin + '/thing/audio-123', origin + '/post/audio-123/'])
		assert.equal(parseRecordingReference(input, origin), 'audio-123');
	for (const input of ['https://other.test/thing/audio-123', origin + '/settings', origin + '/thing/a/b',
		origin + '/thing/a%2Fb', 'https://user:pass@thingtime.test/thing/audio-123', '', 'a'.repeat(161)])
		assert.throws(() => parseRecordingReference(input, origin));
});

test('saved-recording controls require their compatible selected-origin feature', () => {
	const origin = 'https://thingtime.test';
	const manifest = (version: string) => ({ origin, features: { 'api.lopu-recordings': { version } } });
	for (const version of ['1.5.0', '1.5.1', '1.6.0']) assert.equal(supportsSavedRecordings(manifest(version), origin), true);
	for (const version of ['', '1.4.0', '2.0.0']) assert.equal(supportsSavedRecordings(manifest(version), origin), false);
	assert.equal(supportsSavedRecordings(manifest('1.5.0'), 'https://other.test'), false);
});
