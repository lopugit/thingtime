import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localNodeIsHealthy, shouldHideLocalNodePanel, nodePanelPreferenceKey } from './localNodePanel';
import type { LocalThingtimeNodeState } from './useLocalThingtimeNode';
const healthy: LocalThingtimeNodeState = {
	available: true,
	checking: false,
	pendingActionKeys: [],
	status: {
		serviceStatus: 'running',
		pairingStatus: 'paired',
		transportStatus: 'online',
		loginItem: { registered: true, label: 'node', state: 'enabled' }
	},
	permissions: [
		{ kind: 'accessibility', status: 'authorized' },
		{ kind: 'screenRecording', status: 'authorized' }
	],
	permissionsCheckedAt: 123,
	permissionCheckError: null,
	pairingChallenge: null,
	pairedDeviceIds: ['mac'],
	pairedAccountCount: 1,
	pairedToCurrentAccount: true
};
test('dismissal is opt-in and scoped to the current account', () => {
	assert.equal(shouldHideLocalNodePanel(healthy, false), false);
	assert.equal(shouldHideLocalNodePanel(healthy, true), true);
	assert.notEqual(nodePanelPreferenceKey('alice'), nodePanelPreferenceKey('bob'));
});
test('stopped, unpaired, offline, denied and failed-check nodes resurface', () => {
	const cases: LocalThingtimeNodeState[] = [
		{ ...healthy, status: { ...healthy.status!, serviceStatus: 'stopped' } },
		{ ...healthy, status: { ...healthy.status!, serviceStatus: 'version-mismatch' } },
		{ ...healthy, status: { ...healthy.status!, transportStatus: 'offline' } },
		{ ...healthy, status: { ...healthy.status!, lastError: { code: 'broken' } } },
		{ ...healthy, pairedToCurrentAccount: false },
		{ ...healthy, permissions: [{ kind: 'accessibility', status: 'denied' }] },
		{ ...healthy, permissionCheckError: 'failed' },
		{ ...healthy, status: null, permissionCheckError: 'unreachable' }
	];
	for (const state of cases) {
		assert.equal(localNodeIsHealthy(state), false);
		assert.equal(shouldHideLocalNodePanel(state, true), false);
	}
});
test('background checks keep healthy dismissal stable; initial checks do not flash setup', () => {
	assert.equal(shouldHideLocalNodePanel({ ...healthy, checking: true }, true), true);
	assert.equal(shouldHideLocalNodePanel({ ...healthy, pairedToCurrentAccount: null }, true), true);
	assert.equal(shouldHideLocalNodePanel({ ...healthy, pairedToCurrentAccount: null, permissionCheckError: 'failed' }, true), false);
	assert.equal(shouldHideLocalNodePanel({ ...healthy, status: null, checking: true }, true), true);
});
