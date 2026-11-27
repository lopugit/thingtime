import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceCommand, deviceSupportsCommand } from './deviceCore';
import { normalizeNotificationInput, normalizeMediaInput, preparedSoundFilename } from './deviceAlertCore';
const version = 'a'.repeat(64);
test('typed notification and uploaded-media commands refuse paths, URLs and unknown fields', () => {
	assert.deepEqual(normalizeNotificationInput({ title: 'Find device', message: 'Please return it', sound: { kind: 'none' } }), {
		title: 'Find device',
		message: 'Please return it',
		sound: { kind: 'none' }
	});
	assert.ok(normalizeNotificationInput({ title: 'Alert', message: 'Message', sound: { kind: 'prepared', id: version } }));
	for (const input of [
		{ title: 'Alert', message: 'M', sound: { kind: 'prepared', id: '../tone.caf' } },
		{ title: 'Alert', message: 'M', sound: { kind: 'default', id: version } },
		{ title: 'Alert', message: 'M', sound: { kind: 'url', url: 'https://untrusted' } }
	])
		assert.equal(normalizeNotificationInput(input), null);
	assert.equal(normalizeMediaInput({ attachmentId: 'attachment', url: 'https://untrusted' }), null);
	assert.equal(normalizeMediaInput({ attachmentId: '/tmp/private.mp3' }), null);
	assert.ok(normalizeMediaInput({ attachmentId: 'attachment', versionId: version }));
	assert.ok(normalizeMediaInput({ attachmentId: 'attachment', versionId: version, format: 'notification-sound', soundId: version }, true));
	assert.equal(preparedSoundFilename(version), `tt-${version}.caf`);
	assert.throws(() => preparedSoundFilename('../file'));
});
test('every effect requires its explicit paired-device capability', () => {
	for (const kind of ['notification.show', 'media.play', 'media.prepare'] as const) {
		assert.equal(deviceSupportsCommand(kind, []), false);
		assert.equal(deviceSupportsCommand(kind, [`${kind}.v1`]), true);
		assert.equal(deviceSupportsCommand(kind, ['system.volume.write']), false);
	}
	assert.equal(normalizeDeviceCommand('notification.show', { title: 'A', message: 'B', sound: { kind: 'default' } }).ok, true);
	assert.equal(normalizeDeviceCommand('media.play', { attachmentId: 'asset', versionId: version }).ok, true);
	assert.equal(normalizeDeviceCommand('media.prepare', { attachmentId: 'asset', format: 'notification-sound' }).ok, true);
});
