import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultDeviceDrawerPreferences,
	normalizeDeviceDrawerPreferences,
	setDeviceDrawerSectionExpanded,
	setDeviceDrawerWidthPreference
} from './deviceDrawerPreferences';

test('device drawer preferences foreground everyday controls and collapse advanced sections', () => {
	const preferences = defaultDeviceDrawerPreferences();

	assert.equal(preferences.version, 1);
	assert.equal(preferences.drawerWidth, null);
	assert.deepEqual(preferences.sections, {
		node: false,
		permissions: false,
		'observed-state': true,
		audio: false,
		network: false,
		'system-controls': false,
		power: false,
		applications: true,
		connectors: false,
		screen: false,
		approvals: false,
		'command-activity': false
	});
});

test('device drawer preferences retain only known local layout values', () => {
	const preferences = normalizeDeviceDrawerPreferences({
		sections: { node: false, connectors: false, unknown: false },
		drawerWidth: 683,
		accountEmail: 'not a preference'
	});

	assert.equal(preferences.sections.node, false);
	assert.equal(preferences.sections.connectors, false);
	assert.equal(preferences.sections.screen, false);
	assert.equal(preferences.drawerWidth, 683);
	assert.deepEqual(normalizeDeviceDrawerPreferences({ sections: { node: 'no' }, drawerWidth: -1 }), defaultDeviceDrawerPreferences());
});

test('persistence helpers are SSR-safe when browser storage is unavailable', () => {
	assert.equal(setDeviceDrawerSectionExpanded('device-1', 'node', false).sections.node, false);
	assert.equal(setDeviceDrawerWidthPreference('device-1', 560).drawerWidth, 560);
});
