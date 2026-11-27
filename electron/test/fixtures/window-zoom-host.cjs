'use strict';
// Real Chromium keyboard/menu regression with a disposable local document.
// Run with `pnpm --dir electron verify:window-zoom`; no Thingtime API is used.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { attachWindowZoom, windowZoomMenu } = require('../../lib/window-zoom.cjs');
const profile = process.env.THINGTIME_ZOOM_TEST_PROFILE;
assert.ok(profile && path.isAbsolute(profile), 'runner must provide disposable profile');
app.setPath('userData', profile);
const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
let window;

app.whenReady().then(async () => {
 window = new BrowserWindow({ title: 'Thingtime zoom isolated regression', width: 1000, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
 const contents = window.webContents;
 attachWindowZoom(window);
 const unconsumed = [];
 contents.on('before-input-event', (event, input) => {
  if (input.type === 'keyDown' && !event.defaultPrevented) unconsumed.push(input.key);
 });
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { role: 'editMenu' }, windowZoomMenu(() => window)
 ]));
 await window.loadURL('data:text/html,<input autofocus aria-label="Zoom test"><script>window.keys=[];addEventListener("keydown",e=>keys.push(e.key))</script>');
 window.show();
 window.focus();
 contents.focus();
 await contents.executeJavaScript('document.querySelector("input").focus()');
 await pause();
 assert.equal(window.isFocused(), true, 'fixture requires focused native window');
 let applications = 0;
 const nativeSetZoomLevel = contents.setZoomLevel.bind(contents);
 contents.setZoomLevel = (level) => { applications++; nativeSetZoomLevel(level); };
 async function key(keyCode, modifiers) {
  contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause();
 }
 function level(expected) { assert.ok(Math.abs(contents.getZoomLevel() - expected) < 0.00001, `expected zoom ${expected}, observed ${contents.getZoomLevel()}`); }
 const primary = process.platform === 'darwin' ? 'meta' : 'control';
 await key('=', [primary]); level(0.5);
 assert.equal(applications, 1, 'menu and before-input must not double-apply');
 await key('+', [primary, 'shift']); level(1);
 assert.equal(applications, 2);
 await key('-', ['control']); level(0.5);
 assert.equal(applications, 3, 'Control-minus also works on macOS');
 nativeSetZoomLevel(0.37);
 await key('=', ['control']); level(0.87);
 await key('0', [primary]); level(0);
 assert.equal(applications, 5);
 const view = Menu.getApplicationMenu().items.find((item) => item.label === 'View');
 view.submenu.items[0].click(); level(0.5);
 view.submenu.items[1].click(); level(0);
 nativeSetZoomLevel(0.37);
 view.submenu.items[2].click(); level(0);
 assert.equal(applications, 8);
 await key('a', []);
 await key('z', [primary]);
 await key('_', [primary, 'shift']);
 await key('=', [primary, 'alt']);
 assert.equal(applications, 8, 'ordinary typing/editing/unsupported chords do not zoom');
 assert.equal(await contents.executeJavaScript('document.activeElement.tagName'), 'INPUT');
 const keys = await contents.executeJavaScript('window.keys');
 assert.ok(keys.includes('a'), 'ordinary typing reaches renderer');
 assert.ok(unconsumed.includes('z'), 'undo remains available to the native Edit menu');
 assert.ok(!keys.includes('+') && !keys.includes('0'), 'zoom keys are consumed before renderer');
 console.log('PASS: real Electron input/menu zoom, no duplicate application, Control on macOS, fractional reset and input focus');
 window.destroy();
 app.exit(0);
}).catch((error) => { console.error(error); window?.destroy(); app.exit(1); });
