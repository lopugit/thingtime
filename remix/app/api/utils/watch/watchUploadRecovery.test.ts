import assert from 'node:assert/strict';
import test from 'node:test';
import { watchUploadNeedsRestart } from './watchUploadRecovery';

const now = new Date('2026-09-09T12:00:00Z');
const draft = { shareId: 'audio', attachmentPurpose: 'post', attachmentState: 'ready', attachmentExpiresAt: new Date(now.getTime() + 60_000) };
test('expired, deleted and cleanup-stuck drafts can restart from retained Watch bytes', () => {
	assert.equal(watchUploadNeedsRestart([], ['audio'], now), true);
	assert.equal(watchUploadNeedsRestart([{ ...draft, attachmentState: 'deleting' }], ['audio'], now), true);
	assert.equal(watchUploadNeedsRestart([{ ...draft, attachmentExpiresAt: now }], ['audio'], now), true);
});
test('live uploads, other bindings and other purposes cannot be restarted by this recovery path', () => {
	assert.equal(watchUploadNeedsRestart([draft], ['audio'], now), false);
	for (const patch of [{ targetId: 'other' }, { attachmentPurpose: 'message' }, { attachmentProfileSlot: 'avatar' }]) {
		assert.equal(watchUploadNeedsRestart([{ ...draft, attachmentState: 'deleting', ...patch }], ['audio'], now), false);
	}
	assert.equal(watchUploadNeedsRestart([draft], ['audio', 'missing'], now), false);
	assert.equal(watchUploadNeedsRestart([], [], now), false);
	assert.equal(watchUploadNeedsRestart([], ['audio', 'audio'], now), false);
});
