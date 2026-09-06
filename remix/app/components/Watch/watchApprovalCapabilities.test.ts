import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsWatchApproval, WATCH_CODE_ENTRY_REQUIREMENTS, WATCH_QUICK_APPROVAL_REQUIREMENTS } from './watchApprovalCapabilities';

test('Watch approval negotiates only the features it uses on the selected origin', () => {
	for (const version of ['1.2.0', '1.2.1', '1.3.0']) {
		assert.equal(supportsWatchApproval({ features: { 'api.watch-pairing': version } }, WATCH_QUICK_APPROVAL_REQUIREMENTS), true);
	}
	for (const version of [undefined, '1.0.0', '1.1.9', '2.2.0', '1.2', '1.2.0-beta']) {
		assert.equal(supportsWatchApproval({ features: { 'api.watch-pairing': version } }, WATCH_QUICK_APPROVAL_REQUIREMENTS), false);
	}
	assert.equal(supportsWatchApproval(null, WATCH_QUICK_APPROVAL_REQUIREMENTS), false);
	assert.equal(supportsWatchApproval({ features: { 'api.watch-pairing': { version: '1.2.0' } } }, WATCH_QUICK_APPROVAL_REQUIREMENTS), true);
	assert.equal(supportsWatchApproval({ features: { 'api.watch-pairing': '1.1.0' } }, WATCH_CODE_ENTRY_REQUIREMENTS), true);
	assert.equal(supportsWatchApproval({ features: { 'api.watch-pairing': '1.0.9' } }, WATCH_CODE_ENTRY_REQUIREMENTS), false);
});
