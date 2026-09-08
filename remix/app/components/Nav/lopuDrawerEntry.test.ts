import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { DRAWER_KEEP_OPEN_DEFAULT_IDS, drawerMenuItems, filterDrawerItemsByAuth } from './Drawer/drawerMenu';

// 🦄 Lopu's chrome wiring: the drawer entry, the z rungs the floating host
// layers on, the root mount, and the tab-local open state. Source-level
// checks (the same style as thingtimeSyncChannel.test.ts) so the contract
// holds without rendering the app shell in node.

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative: string) => readFileSync(path.join(appDir, relative), 'utf8');

test('the drawer lists Lopu right after Messages with chat, conversations and settings underneath', () => {
	const ids = drawerMenuItems.map((item) => item.id);
	assert.equal(ids[ids.indexOf('messages') + 1], 'lopu');

	const lopu = drawerMenuItems.find((item) => item.id === 'lopu');
	assert.ok(lopu, 'expected a lopu top-level entry');
	assert.equal(lopu.label, 'Lopu');
	assert.equal(lopu.icon, '🦄');
	assert.equal(lopu.to, '/lopu');
	assert.deepEqual(
		lopu.children.map((child) => [child.id, child.to]),
		[
			['lopu-chat', '/lopu'],
			['lopu-voice', '/lopu/voice'],
			['lopu-conversations', '/messages'],
			['lopu-vault', '/settings#secure-vault'],
			['lopu-settings', '/settings#lopu']
		]
	);
	// the settings deep links land on real anchors
	const settingsPage = read('components/Settings/SettingsPage.tsx');
	assert.match(settingsPage, /id="secure-vault"/);
	assert.match(settingsPage, /id="lopu"/);

	// the chat page has a signed-out state; voice (microphone + vault providers),
	// the Messenger-backed conversation list and the Secure Vault are gated behind login
	assert.deepEqual(
		filterDrawerItemsByAuth(lopu.children, false).map((child) => child.id),
		['lopu-chat', 'lopu-settings']
	);
	assert.deepEqual(
		filterDrawerItemsByAuth(lopu.children, true).map((child) => child.id),
		['lopu-chat', 'lopu-voice', 'lopu-conversations', 'lopu-vault', 'lopu-settings']
	);

	// a navigating hub: clicking it closes the drawer like Feed/Messages do
	assert.ok(!DRAWER_KEEP_OPEN_DEFAULT_IDS.includes('lopu'));
});

test('every drawer id stays unique across top-level items and children', () => {
	const ids = drawerMenuItems.flatMap((item) => [item.id, ...item.children.map((child) => child.id)]);
	assert.equal(new Set(ids).size, ids.length, `duplicate drawer ids: ${ids.filter((id, index) => ids.indexOf(id) !== index).join(', ')}`);
});

test('useDrawer exports the Lopu z rungs and documents them in the ladder', () => {
	const source = read('components/Nav/Drawer/useDrawer.tsx');
	assert.match(source, /export const LOPU_WINDOW_Z = DRAWER_Z \+ 60;/);
	assert.match(source, /export const LOPU_LAUNCHER_Z = DRAWER_Z \+ 200;/);
	// the ladder comment names the concrete rungs so the next reader can place
	// new chrome relative to them
	assert.match(source, /\/\/\s+10060\s+Lopu/);
	assert.match(source, /\/\/\s+10200\s+Lopu launcher/);
	// the window rides with the editor windows: above the panel, below the hovered drawer
	const drawerZ = Number(source.match(/export const DRAWER_Z = (\d+);/)?.[1]);
	const hoverZ = Number(source.match(/export const DRAWER_HOVER_Z = (\d+);/)?.[1]);
	const popupZ = Number(source.match(/export const DRAWER_POPUP_Z = (\d+);/)?.[1]);
	assert.ok(drawerZ + 60 > drawerZ && drawerZ + 60 < hoverZ, 'LOPU_WINDOW_Z must sit between the drawer panel and the hovered drawer');
	assert.ok(drawerZ + 200 > hoverZ && drawerZ + 200 < popupZ, 'LOPU_LAUNCHER_Z must sit above the hovered drawer and below popups');
});

test('root mounts the floating host after DrawerSystem, client-only and never in the authorize popup', () => {
	const source = read('root.tsx');
	assert.match(source, /import \{ LopuHost \} from '\.\/components\/Lopu\/LopuHost';/);
	const drawerAt = source.indexOf('<DrawerSystem />');
	const hostAt = source.indexOf('{mounted && !isAuthorizePopup ? <LopuHost /> : null}');
	assert.notEqual(drawerAt, -1);
	assert.notEqual(hostAt, -1);
	assert.ok(hostAt > drawerAt, 'LopuHost must mount after DrawerSystem');
});

test('the drawer row and the floating host show the shared streaming badge', () => {
	const drawerContent = read('components/Nav/Drawer/DrawerContent.tsx');
	assert.match(drawerContent, /import \{ LopuActivityBadge \} from '\.\.\/\.\.\/Lopu\/LopuActivityBadge';/);
	assert.match(drawerContent, /\{item\.id === 'lopu' \? <LopuActivityBadge \/> : null\}/);

	const badge = read('components/Lopu/LopuActivityBadge.tsx');
	// reads the module store the /lopu page and the window share
	assert.match(badge, /subscribeLopuStore/);
	assert.match(badge, /selectLopuStreaming/);
	assert.match(badge, /useSyncExternalStore/);
});

test("the floating window's open state is tab-local while Lopu preferences still sync", () => {
	const source = read('components/Lopu/useLopuSettings.ts');
	// `open` describes this viewport: a peer tab must not pop Lopu open
	const openWrite = source.slice(source.indexOf("'settings.lopu.open'")).match(/^[^;]*;/);
	assert.ok(openWrite, 'expected useLopuSettings to write settings.lopu.open through setThingtime');
	assert.match(openWrite[0], /tabLocal: true/, 'settings.lopu.open must not actuate another tab');
	assert.match(openWrite[0], /ignoreUndoRedo: true/, 'chrome state stays out of the undo timeline');

	// launcher/dock/applyPatches/… are preferences — the generic setter must
	// keep broadcasting them
	const preferenceWrite = source.match(/setThingtime\?\.\(`\$\{LOPU_SETTINGS_PATH\}\.\$\{key\}`[^;]*;/);
	assert.ok(preferenceWrite, 'expected the generic preference setter');
	assert.doesNotMatch(preferenceWrite[0], /tabLocal/, 'Lopu preferences should keep syncing across tabs');
	assert.match(preferenceWrite[0], /ignoreUndoRedo: true/);
});

test('the floating host is non-modal chrome that hides on /lopu and honours the launcher setting', () => {
	const source = read('components/Lopu/LopuHost.tsx');
	// nothing floats on the page that IS the chat
	assert.match(source, /const hiddenOnPath = isLopuHostHiddenOnPath\(pathname\);/);
	assert.match(source, /if \(hiddenOnPath\) \{\s*return null;/);
	// the launcher setting hides the bubble only — the window still follows
	// `open`, so the navbar 🦄 can open it with the bubble turned off
	assert.match(source, /const showLauncher = !hiddenOnPath && settings\.launcher;/);
	assert.match(source, /const showWindow = !hiddenOnPath && open;/);
	assert.match(source, /\{showLauncher && !showSheet && !\(showFrame && docked\) && \(/);
	assert.doesNotMatch(source, /role="dialog"/, 'the window must not claim to be a dialog while non-modal');
	assert.match(source, /role="complementary"/);
	assert.match(source, /zIndex=\{LOPU_WINDOW_Z\}/);
	assert.match(source, /zIndex=\{LOPU_LAUNCHER_Z\}/);
	// drags ride the app's pointer-gesture helper (pointer-id filtered, blur teardown)
	assert.match(source, /import \{ startPointerGesture \} from '\.\.\/Thingtime\/EditorSplit';/);
	// Escape closes, but a caret in a page input keeps its keystroke
	assert.match(source, /shouldIgnoreGlobalKeydown\(event\)/);
	// the window never focuses itself — no programmatic focus() calls
	assert.doesNotMatch(source, /\.focus\(\)/);
	// mobile: an 88dvh bottom sheet instead of a floating frame
	assert.match(source, /height: '88dvh'/);
	// the shared chat view, compact, without the conversation column
	assert.match(source, /<LopuChatView compact showConversations=\{false\} onOpenFull=\{openFull\} \/>/);
});

test('logging out sweeps every tt-lopu-* cache line', () => {
	const source = read('hooks/useApi.tsx');
	const logoutAt = source.indexOf('logout: useCallback(');
	const sweepAt = source.indexOf("clearLocalCachePrefix('tt-lopu-');");
	const submitAt = source.indexOf("{ action: '/api/v1/auth/logout' }");
	assert.ok(logoutAt !== -1 && sweepAt !== -1 && submitAt !== -1);
	assert.ok(sweepAt > logoutAt && sweepAt < submitAt, 'the sweep must run inside logout before the request is submitted');
});

test('both settings surfaces and the admin panel mount the Lopu sections', () => {
	assert.match(read('components/Nav/Drawer/UserSettingsModal.tsx'), /<LopuSettingsRows renderRow=\{settingRow\} \/>/);
	assert.match(read('components/Settings/SettingsPage.tsx'), /<SettingsSection\s+eyebrow="Lopu 🦄"/);
	assert.match(read('components/Settings/SettingsPage.tsx'), /<LopuSettingsRows/);
	assert.match(read('components/Admin/AdminPanel.tsx'), /<LopuModelsEditor \/>/);
});
