'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ensureWindowVisible } = require('../lib/window-visibility.cjs');
function fixture() {
 const window = new EventEmitter(); window.webContents = new EventEmitter();
 let shows = 0; let timer; let cleared = false;
 window.show = () => { shows++; }; window.isDestroyed = () => false;
 ensureWindowVisible(window, { setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { cleared = true; } });
 return { window, fire: () => timer(), shows: () => shows, cleared: () => cleared };
}
test('local restart becomes visible on completed load even when ready-to-show never arrives', () => {
 const f = fixture(); f.window.webContents.emit('did-finish-load');
 assert.equal(f.shows(), 1); assert.equal(f.cleared(), true);
});
test('missing readiness or renderer failure cannot leave a permanently hidden window', () => {
 for (const event of ['did-fail-load', 'render-process-gone']) {
  const f = fixture(); f.window.webContents.emit(event); assert.equal(f.shows(), 1);
 }
 const f = fixture(); f.fire(); assert.equal(f.shows(), 1);
});
test('closed window is never resurrected by a delayed readiness fallback', () => {
 const f = fixture(); f.window.emit('closed'); f.fire();
 assert.equal(f.shows(), 0); assert.equal(f.cleared(), true);
});
test('quit cleanup never reads webContents from an already destroyed window', () => {
 const f = fixture(), contents = f.window.webContents;
 Object.defineProperty(f.window, 'webContents', { get() { throw new TypeError('Object has been destroyed'); } });
 assert.doesNotThrow(() => f.window.emit('closed'));
 for (const event of ['did-finish-load', 'did-fail-load', 'render-process-gone']) {
  assert.equal(contents.listenerCount(event), 0); contents.emit(event);
 }
 f.fire(); assert.equal(f.shows(), 0); assert.equal(f.cleared(), true);
});
