import assert from 'node:assert/strict';
import test from 'node:test';
import { menuPosition, setMenuDisplay } from './componentMenuPosition';

test('context menu starts at pointer and clamps against both viewport edges', () => {
	assert.deepEqual(menuPosition({ left: 120, right: 120, top: 80, bottom: 80 }, { width: 180, height: 140 }, 800, 600, true), { left: 120, top: 80 });
	assert.deepEqual(menuPosition({ left: 790, right: 790, top: 590, bottom: 590 }, { width: 180, height: 140 }, 800, 600, true), { left: 608, top: 448 });
	assert.deepEqual(menuPosition({ left: -10, right: -10, top: -10, bottom: -10 }, { width: 180, height: 140 }, 800, 600, true), { left: 12, top: 12 });
});
test('keyboard context anchor uses focused rectangle bottom and flips above it', () => {
	assert.deepEqual(menuPosition({ left: 90, right: 130, top: 400, bottom: 430 }, { width: 180, height: 140 }, 800, 480, true), { left: 90, top: 260 });
});
test('ordinary menu preserves right alignment and trigger gap', () => {
	assert.deepEqual(menuPosition({ left: 300, right: 340, top: 40, bottom: 70 }, { width: 180, height: 140 }, 800, 600, false), { left: 160, top: 78 });
});

test('authored grid cannot expose a closed popup and returns when opened', () => {
	let display = 'grid', priority = 'important';
	const style = { setProperty: (_key: string, value: string | null, nextPriority?: string) => { display = value || ''; priority = nextPriority || ''; }, removeProperty: () => { display = ''; priority = ''; return ''; } };
	setMenuDisplay(style, { value: 'grid', priority: 'important' }, false);
	assert.deepEqual([display, priority], ['none', 'important']);
	setMenuDisplay(style, { value: 'grid', priority: 'important' }, true);
	assert.deepEqual([display, priority], ['grid', 'important']);
	setMenuDisplay(style, { value: 'grid', priority: 'important' }, false);
	assert.deepEqual([display, priority], ['none', 'important']);
	setMenuDisplay(style, { value: '', priority: '' }, true);
	assert.deepEqual([display, priority], ['', '']);
});
