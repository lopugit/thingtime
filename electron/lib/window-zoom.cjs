'use strict';

function zoomCommand(input) {
 if (!input || input.type !== 'keyDown' || input.isComposing || input.alt || Boolean(input.meta) === Boolean(input.control)) return null;
 if (['+', '=', 'Add'].includes(input.key)) return 'in';
 if (['-', 'Subtract'].includes(input.key)) return 'out';
 if (input.key === '0') return 'reset';
 return null;
}

function applyWindowZoom(window, command, menuWindow) {
 if (!['in', 'out', 'reset'].includes(command) || !window || window.isDestroyed() || (!window.isFocused() && menuWindow !== window)) return false;
 const contents = window.webContents;
 if (contents.isDestroyed()) return false;
 // Chromium owns the supported range and origin-scoped zoom behavior. Do not
 // add a separate preference store or arbitrary application zoom limits.
 contents.setZoomLevel(command === 'reset' ? 0 : contents.getZoomLevel() + (command === 'in' ? 0.5 : -0.5));
 return true;
}

function attachWindowZoom(window) {
 const contents = window.webContents;
 const onInput = (event, input) => {
  const command = zoomCommand(input);
  if (command && applyWindowZoom(window, command)) {
   // Electron suppresses both renderer keys and menu accelerators, so the
   // same key cannot also invoke the View menu or the page's default zoom.
   event.preventDefault();
  }
 };
 contents.on('before-input-event', onInput);
 window.once('closed', () => contents.removeListener('before-input-event', onInput));
}

function windowZoomMenu(getWindow) {
 const click = (command) => (_item, menuWindow) => {
  const window = getWindow();
  // Electron supplies the menu's focused BrowserWindow. Native menu tracking
  // may temporarily blur it; never redirect another window's menu command.
  if (menuWindow && menuWindow !== window) return false;
  return applyWindowZoom(window, command, menuWindow);
 };
 return {
  label: 'View',
  submenu: [
   { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: click('in') },
   { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: click('out') },
   { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: click('reset') }
  ]
 };
}

module.exports = { zoomCommand, applyWindowZoom, attachWindowZoom, windowZoomMenu };
