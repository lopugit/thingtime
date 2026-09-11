import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_TABS, resolveSettingsTab, settingsTabHref } from './settingsTabs';
test('every category has a unique reloadable URL; profile is default', () => {
	assert.equal(resolveSettingsTab(), 'profile');
	assert.equal(resolveSettingsTab('unknown'), 'profile');
	const links = SETTINGS_TABS.map((tab) => settingsTabHref(tab.id));
	assert.equal(new Set(links).size, SETTINGS_TABS.length);
	for (const tab of SETTINGS_TABS) assert.equal(resolveSettingsTab(settingsTabHref(tab.id).split('/').pop()), tab.id);
});
test('existing section bookmarks select the section’s category', () => {
	assert.equal(resolveSettingsTab(null, '#ai-waterfalls'), 'ai-waterfalls');
	assert.equal(resolveSettingsTab(null, '#secure-vault'), 'security');
	assert.equal(resolveSettingsTab(null, '#lopu'), 'lopu');
	assert.equal(resolveSettingsTab(null, '#lopu-credits'), 'lopu');
	assert.equal(resolveSettingsTab('things', '#lopu'), 'things');
});
