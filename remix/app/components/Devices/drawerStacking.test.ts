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
