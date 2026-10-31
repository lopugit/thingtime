import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
	assert.equal(resolveSettingsTab(null, '#lopu-instructions'), 'lopu');
	assert.equal(resolveSettingsTab(null, '#lopu-accounts'), 'admin');
	assert.equal(resolveSettingsTab(null, '#lopu-base-prompt'), 'admin');
	assert.equal(resolveSettingsTab(null, '#lopu-credits'), 'account');
	assert.equal(resolveSettingsTab('things', '#lopu'), 'things');
});

test('Account owns new and legacy invite and credits links without overriding unrelated categories', () => {
	assert.equal(settingsTabHref('account'), '/settings/account');
	for (const hash of ['#gift-invites', '#lopu-credits']) {
		for (const tab of [null, 'account', 'lopu', 'unknown']) assert.equal(resolveSettingsTab(tab, hash), 'account');
		assert.equal(resolveSettingsTab('profile', hash), 'profile');
	}
	assert.equal(resolveSettingsTab('lopu'), 'lopu');
});

test('agent browser security links to its actual settings category and disclosure anchor', async () => {
	const route = await readFile(new URL('../../routes/agent-browsers.tsx', import.meta.url), 'utf8');
	const controls = await readFile(new URL('../AgentTasks/AgentBrowserDefaults.tsx', import.meta.url), 'utf8');
	const href = route.match(/to="([^"]+)"[^>]*>General security settings/)?.[1];
	assert.ok(href, 'The task page must expose general security settings');
	const url = new URL(href, 'http://test.local');
	assert.equal(resolveSettingsTab(url.pathname.split('/').pop(), url.hash), 'things');
	assert.equal(url.hash, '#agent-browser-security');
	assert.ok(controls.includes(`id="${url.hash.slice(1)}"`), 'The settings disclosure must contain its deep-link target');
});


test('password manager is a reloadable category distinct from account sign-in security', () => {
	assert.equal(settingsTabHref('passwords'), '/settings/passwords');
	assert.equal(resolveSettingsTab('passwords'), 'passwords');
	assert.equal(resolveSettingsTab(null, '#password-manager'), 'passwords');
	assert.equal(resolveSettingsTab('security', '#password-manager'), 'security');
	assert.equal(resolveSettingsTab(null, '#secure-vault'), 'security');
});
