import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('custom audience modal stays above the Builder inspector drawer', async () => {
  const source = await readFile(new URL('./CustomAudienceModal.tsx', import.meta.url), 'utf8');

  assert.match(source, /<ModalOverlay zIndex=\{DRAWER_MODAL_OVERLAY_Z\} \/>/u);
  assert.match(source, /containerProps=\{\{ zIndex: DRAWER_MODAL_Z \}\}/u);
});
