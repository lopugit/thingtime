import { test } from 'node:test';
import { createRequire } from 'node:module';
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

// Exercise the actual Desktop adapter rather than assuming every local status
// includes a cloud transport observation.
test('healthy status from the installed Desktop adapter can be dismissed', () => {
	const { normalizeNodeStatus } = createRequire(import.meta.url)('../../../../electron/lib/thingtime-node-bridge.cjs');
	const status = normalizeNodeStatus(
		{
			pairing: { paired: true, deviceID: 'mac' },
			permissions: { accessibility: 'granted', screenRecording: 'granted' },
			connector: { state: 'running' }
		},
		{ registered: true, label: 'node', state: 'enabled' },
		'test'
	);
	const state = { ...healthy, status, permissions: status.permissions };
	assert.equal(status.transportStatus, 'unknown');
	assert.equal(localNodeIsHealthy(state), true);
	assert.equal(shouldHideLocalNodePanel(state, true), true);
	assert.equal(shouldHideLocalNodePanel({ ...state, status: { ...status, transportStatus: 'offline' } }, true), false);
});
