import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayIntersects, placeEditorOverlay, type OverlayRect } from './editorOverlayLayout';

const bounds = { left: 8, top: 80, width: 374, height: 680 };
const assertFits = (rect: OverlayRect, area: OverlayRect, obstacles: OverlayRect[]) => {
	assert.ok(rect.left >= area.left && rect.top >= area.top);
	assert.ok(rect.left + rect.width <= area.left + area.width);
	assert.ok(rect.top + rect.height <= area.top + area.height);
	for (const obstacle of obstacles) assert.equal(overlayIntersects(rect, obstacle), false);
};
test('narrow centred block keeps chip, history and selection separate above its text', () => {
	const text = { left: 160, top: 360, width: 70, height: 24 };
	const chip = { left: 164, top: 296, width: 130, height: 28 };
	const history = placeEditorOverlay({ width: 130, height: 24 }, { left: 160, top: 326 }, bounds, [text, chip]);
	assertFits(history, bounds, [text, chip]);
	const above = { ...bounds, height: text.top - 12 - bounds.top };
	const inline = placeEditorOverlay({ width: 270, height: 46 }, { left: 60, top: 302 }, above, [text, chip, history]);
	assertFits(inline, above, [text, chip, history]);
});
test('right-edge toolbar flips into available space without overlapping adjacent text', () => {
	const text = { left: 280, top: 250, width: 90, height: 28 };
	const previous = { left: 220, top: 206, width: 150, height: 28 };
	const panel = placeEditorOverlay({ width: 140, height: 32 }, { left: 340, top: 214 }, bounds, [text, previous]);
	assertFits(panel, bounds, [text, previous]);
});
test('keyboard and nested scrolling bounds shrink and pan without offscreen controls', () => {
	const small = { left: 35, top: 120, width: 230, height: 180 };
	const text = { left: 90, top: 240, width: 80, height: 28 };
	const panel = placeEditorOverlay({ width: 300, height: 46 }, { left: 200, top: 180 }, small, [text]);
	assertFits(panel, small, [text]);
	assert.equal(panel.width, 230);
});
test('repeated placement is stable and zero-space bounds produce no negative dimensions', () => {
	const input = [{ left: 100, top: 170, width: 180, height: 40 }];
	const first = placeEditorOverlay({ width: 130, height: 24 }, { left: 100, top: 180 }, bounds, input);
	assert.deepEqual(placeEditorOverlay(first, { left: 100, top: 180 }, bounds, input), first);
	const zero = placeEditorOverlay({ width: 130, height: 24 }, { left: 100, top: 180 }, { left: 8, top: 8, width: 0, height: 0 }, []);
	assert.deepEqual(zero, { left: 8, top: 8, width: 0, height: 0 });
});
