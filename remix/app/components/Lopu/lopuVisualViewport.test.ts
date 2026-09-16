import assert from 'node:assert/strict';
import test from 'node:test';
import { lopuVisualViewportGeometry } from './useLopuVisualViewport';
test('iOS keyboard shrink and visual viewport pan keep the sheet above the keyboard', () => {
	assert.deepEqual(lopuVisualViewportGeometry(844, 444, 50), { height: 444, top: 50, bottom: 350, keyboardOpen: true });
	assert.deepEqual(lopuVisualViewportGeometry(844, 844, 0), { height: 844, top: 0, bottom: 0, keyboardOpen: false });
	assert.equal(lopuVisualViewportGeometry(844, 800, 0).keyboardOpen, false);
	assert.equal(lopuVisualViewportGeometry(844, 900, 0).bottom, 0);
});
