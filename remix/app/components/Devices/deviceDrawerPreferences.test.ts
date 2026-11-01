import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultDeviceDrawerPreferences,
	normalizeDeviceDrawerPreferences,
	setDeviceDrawerSectionExpanded,
	setDeviceDrawerWidthPreference
} from './deviceDrawerPreferences';

test('device drawer preferences collapse every section by default', () => {
	const preferences = defaultDeviceDrawerPreferences();

	assert.equal(preferences.version, 2);
	assert.equal(preferences.drawerWidth, null);
	assert.deepEqual(preferences.sections, {
		node: false,
		permissions: false,
		'observed-state': false,
		audio: false,
		network: false,
		'system-controls': false,
		power: false,
		applications: false,
		connectors: false,
		screen: false,
		files: false,
		sync: false,
		approvals: false,
		'command-activity': false
	});
});

test('device drawer preferences retain only known local layout values', () => {
	const preferences = normalizeDeviceDrawerPreferences({
		version: 2,
		sections: { node: true, connectors: false, unknown: false },
		drawerWidth: 683,
		accountEmail: 'not a preference'
	});

	assert.equal(preferences.sections.node, true);
	assert.equal(preferences.sections.connectors, false);
	assert.equal(preferences.sections.screen, false);
	assert.equal(preferences.drawerWidth, 683);
	assert.deepEqual(normalizeDeviceDrawerPreferences({ sections: { node: 'no' }, drawerWidth: -1 }), defaultDeviceDrawerPreferences());
});

test('persistence helpers are SSR-safe when browser storage is unavailable', () => {
	assert.equal(setDeviceDrawerSectionExpanded('device-1', 'node', false).sections.node, false);
	assert.equal(setDeviceDrawerWidthPreference('device-1', 560).drawerWidth, 560);
});

test('legacy expanded sections migrate to collapsed defaults while retaining drawer width', () => {
	const result = normalizeDeviceDrawerPreferences({
		version: 1,
		sections: { applications: true, 'observed-state': true, approvals: true },
		drawerWidth: 640
	});
	assert.equal(result.version, 2);
	assert.equal(result.drawerWidth, 640);
	assert.ok(Object.values(result.sections).every((value) => value === false));
});
