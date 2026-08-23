import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('device and chat drawers place the Chakra portal container above their overlay', async () => {
	for (const sourceUrl of [new URL('./DeviceDetailsDrawer.tsx', import.meta.url), new URL('../Messenger/ChatDetailsDrawer.tsx', import.meta.url)]) {
		const source = await readFile(sourceUrl, 'utf8');
		assert.match(source, /<DrawerOverlay zIndex=\{DRAWER_MODAL_OVERLAY_Z\} \/>/u);
		assert.match(source, /containerProps=\{\{ zIndex: DRAWER_MODAL_Z \}\}/u);
	}
});

test('device drawer controls remain interactive inside the Electron drag band', async () => {
	const source = await readFile(new URL('./DeviceDetailsDrawer.tsx', import.meta.url), 'utf8');

	assert.match(source, /aria-label="Close device details"/u);
	assert.match(source, /aria-label="Resize device details panel"/u);
	assert.match(source, /left=\{0\}/u);
	assert.match(source, /title="Drag this edge to resize device details"/u);
	assert.doesNotMatch(source, /GripVertical/u);
	assert.match(source, /display="block"/u);
	assert.doesNotMatch(source, /left=\{-2\}/u);
	assert.match(source, /window\.addEventListener\('pointermove', onPointerMove/u);
	assert.match(source, /window\.addEventListener\('pointerup', onPointerEnd/u);
	assert.doesNotMatch(source, /onMouseDown=/u);
	assert.doesNotMatch(source, /addEventListener\('mousemove'/u);
	assert.match(source, /width: `\$\{drawerWidth\}px !important`/u);
	assert.doesNotMatch(source, /width=\{\{ base: '100%'/u);
	assert.match(source, /opacity: resizing \? 1 : 0/u);
	assert.match(source, /sx=\{\{ WebkitAppRegion: 'no-drag' \}\}/u);
	assert.match(source, /aria-expanded=\{expanded\}/u);
	assert.match(source, /setDeviceDrawerSectionExpanded\(deviceId, section, next\)/u);
	assert.match(source, /setDeviceDrawerWidthPreference\(deviceId, nextWidth\)/u);
});
