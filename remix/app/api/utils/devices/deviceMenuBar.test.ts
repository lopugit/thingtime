import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceMenuBar } from './deviceMenuBar';
import { normalizeDeviceState } from './deviceCore';
const row = {
	id: 'ax:42:0',
	processId: 42,
	program: 'Test app',
	source: 'accessibility',
	appPath: '/Applications/Test.app',
	executablePath: '/Applications/Test.app/Contents/MacOS/Test',
	residentBytes: 0,
	cpuTimeSeconds: 0,
	visible: false
};
const snapshot = { status: 'available', collectedAt: '2026-10-18T00:00:00Z', accessibility: true, unreadableApplications: 0, items: [row] };
test('native omitted optionals become unavailable, zero and false survive the full state projection', () => {
	const state = normalizeDeviceState({ locked: false, menuBar: snapshot });
	assert.equal(state?.menuBar?.items[0].label, null);
	assert.equal(state?.menuBar?.items[0].residentBytes, 0);
	assert.equal(state?.menuBar?.items[0].visible, false);
	assert.equal(state?.menuBar?.items[0].executablePath, row.executablePath);
	assert.ok(normalizeDeviceState({ locked: false }));
	assert.equal(normalizeDeviceState({ locked: true, menuBar: snapshot }), null);
});
test('closed native vocabulary refuses arguments, windows, malformed stats and duplicate identities', () => {
	for (const item of [
		{ ...row, arguments: '--secret' },
		{ ...row, title: 'private window' },
		{ ...row, processId: '42' },
		{ ...row, cpuTimeSeconds: Infinity },
		{ ...row, appPath: 'https://example.com' }
	])
		assert.equal(normalizeDeviceMenuBar({ ...snapshot, items: [item] }), null);
	assert.equal(normalizeDeviceMenuBar({ ...snapshot, items: [row, row] }), null);
	assert.equal(normalizeDeviceMenuBar({ ...snapshot, status: 'locked' }), null);
	assert.equal(normalizeDeviceMenuBar({ ...snapshot, items: [], status: 'locked' })?.status, 'locked');
});
test('inventory preserves every item for paginated rendering', () => {
	const items = Array.from({ length: 300 }, (_, i) => ({ ...row, id: `ax:42:${i}` }));
	assert.equal(normalizeDeviceMenuBar({ ...snapshot, items })?.items.length, 300);
});

const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6m0AAAAASUVORK5CYII=';
test('owner projection carries safe PNG thumbnails and explicit provenance only',()=>{
 const value=normalizeDeviceMenuBar({...snapshot,items:[{...row,iconDataUrl:icon,iconSource:'menu-bar'}]});
 assert.equal(value?.items[0].iconDataUrl,icon);
 assert.equal(value?.items[0].iconSource,'menu-bar');
 for (const bad of [
  {iconDataUrl:'https://remote.test/icon.png',iconSource:'application'},
  {iconDataUrl:'data:image/svg+xml,<svg/>',iconSource:'menu-bar'},
  {iconDataUrl:icon,iconSource:'desktop'},
  {iconDataUrl:icon},
  {iconSource:'application'}
 ]) assert.equal(normalizeDeviceMenuBar({...snapshot,items:[{...row,...bad}]}),null);
});
