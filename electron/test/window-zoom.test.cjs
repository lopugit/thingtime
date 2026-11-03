'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { zoomCommand, applyWindowZoom, attachWindowZoom, windowZoomMenu } = require('../lib/window-zoom.cjs');

function fixture() {
 const window = new EventEmitter();
 const contents = new EventEmitter();
 Object.assign(window, { webContents: contents, isDestroyed: () => false, isFocused: () => true });
 let level = 0;
 const changes = [];
 Object.assign(contents, { isDestroyed: () => false, getZoomLevel: () => level, setZoomLevel: (value) => { level = value; changes.push(value); } });
 return { window, contents, changes };
}

test('Command and Control zoom include unshifted equals, shifted plus and keypad keys', () => {
 for (const modifier of ['meta', 'control']) {
  for (const [key, shift, expected] of [['=', false, 'in'], ['+', true, 'in'], ['+', false, 'in'], ['Add', false, 'in'], ['-', false, 'out'], ['-', true, 'out'], ['Subtract', false, 'out'], ['0', false, 'reset'], ['0', true, 'reset']]) {
   assert.equal(zoomCommand({ type: 'keyDown', [modifier]: true, key, shift }), expected);
  }
 }
});

test('typing, editing, composition and conflicting modifiers pass through untouched', () => {
 for (const input of [
  { key: '+' }, { key: '_', shift: true }, { key: ')', shift: true }, { key: 'a' }, { key: 'z' },
  { key: '=', alt: true }, { key: '=', control: true }, { key: '=', isComposing: true }, { key: '=', type: 'keyUp' }
 ]) {
  assert.equal(zoomCommand({ type: 'keyDown', meta: true, ...input, ...(input.key === '+' ? { meta: false } : {}) }), null);
 }
});

test('input consumes the menu/default action once; repeats advance and reset works', () => {
 const { window, contents, changes } = fixture();
 attachWindowZoom(window);
 const menu = windowZoomMenu(() => window);
 function dispatch(key, extra = {}) {
  let prevented = false;
  contents.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', meta: true, key, ...extra });
  // Electron dispatches a menu shortcut only when input was not prevented.
  if (!prevented && key === '+') menu.submenu[0].click();
  return prevented;
 }
 assert.equal(dispatch('+'), true);
 assert.deepEqual(changes, [0.5]);
 dispatch('=', { isAutoRepeat: true });
 dispatch('-');
 dispatch('0');
 assert.deepEqual(changes, [0.5, 1, 0.5, 0]);
 assert.equal(dispatch('z'), false);
 menu.submenu[0].click();
 menu.submenu[1].click();
 menu.submenu[2].click();
 assert.deepEqual(changes.slice(-3), [0.5, 0, 0]);
 window.emit('closed');
 assert.equal(contents.listenerCount('before-input-event'), 0);
});

test('missing, background and destroyed windows or renderers never zoom or swallow input', () => {
 assert.equal(applyWindowZoom(null, 'in'), false);
 for (const state of ['background', 'window-destroyed', 'renderer-destroyed']) {
  const { window, contents, changes } = fixture();
  if (state === 'background') window.isFocused = () => false;
  if (state === 'window-destroyed') window.isDestroyed = () => true;
  if (state === 'renderer-destroyed') contents.isDestroyed = () => true;
  attachWindowZoom(window);
  contents.emit('before-input-event', { preventDefault() { assert.fail('must not consume input'); } }, { type: 'keyDown', control: true, key: '=' });
  windowZoomMenu(() => window).submenu[0].click();
  assert.deepEqual(changes, []);
 }
});

test('shell installs zoom for each new main window and exposes the shared menu', () => {
 const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
 assert.match(source, /windowZoomMenu\(\(\) => mainWindow\)/);
 assert.match(source, /attachWindowZoom\(mainWindow\)/);
});

test('native menu targets its explicit main window through transient menu blur', () => {
 const { window, changes } = fixture();
 window.isFocused = () => false;
 const zoomIn = windowZoomMenu(() => window).submenu[0].click;
 zoomIn({}, new EventEmitter());
 zoomIn();
 assert.deepEqual(changes, [], 'background or foreign-window command is rejected');
 zoomIn({}, window);
 assert.deepEqual(changes, [0.5], 'Electron-provided focused menu window is honored');
 window.isDestroyed = () => true;
 zoomIn({}, window);
 assert.deepEqual(changes, [0.5]);
});
