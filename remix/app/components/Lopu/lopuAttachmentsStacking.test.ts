import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Lopu Thing picker layers both its overlay and fixed container above app chrome', async () => {
	const source = await readFile(new URL('./LopuAttachments.tsx', import.meta.url), 'utf8');
	assert.match(source, /<ModalOverlay zIndex=\{DRAWER_MODAL_OVERLAY_Z\} \/>/u);
	// Raising only ModalContent leaves it trapped inside Chakra's lower stacking context.
	assert.match(source, /containerProps=\{\{ zIndex: DRAWER_MODAL_Z \}\}/u);
});
