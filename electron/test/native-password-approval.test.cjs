'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createNativePasswordApproval } = require('../lib/native-passwords/approval.cjs');

const ownerId = 'fixture-owner';
const origin = 'http://127.0.0.1:18452';
const endpoint = 'https://vault.example';
const website = { kind: 'website', origin: 'https://login.example:8443' };
const channel = suffix => `thingtime-desktop:password-approval-${suffix}`;

function fixture(t, { timeout } = {}) {
  const session = {}, handlers = new Map();
  let context = { origin, endpoint, session }, popup;
  const parent = { isDestroyed: () => false, webContents: { session } };
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); popup = this; this.options = options;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = fn => { this.windowOpen = fn; };
    }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadURL(url) {
      this.webContents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false });
      this.webContents.mainFrame.url = url;
    }
    show() {}
  }
  const manager = createNativePasswordApproval({ BrowserWindow, ipcMain, preload: 'preload.cjs', context: () => context, window: () => parent, timeout, platform: 'linux' });
  t.after(() => manager.close());
  return { manager, handlers, session, parent, popup: () => popup, changeContext: change => { context = { ...context, ...change }; },
    invoke(suffix, payload, changes) {
      return handlers.get(channel(suffix))({ sender: popup.webContents, senderFrame: popup.webContents.mainFrame, ...changes }, payload);
    },
    approve: (target = website, assertCurrent = () => {}) => manager.approve({ scope: { origin: endpoint, ownerId }, target, entryId: randomUUID(), assertCurrent }),
  };
}

test('desktop approval verifies the popup, main document, account and exact proof shape', async t => {
  const f = fixture(t);
  const completion = f.approve();
  const window = f.popup();
  assert.equal(window.options.parent, f.parent);
  assert.equal(window.options.webPreferences.session, f.session);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.devTools, false);
  assert.equal(window.webContents.mainFrame.url, `${origin}/passwords/provider?view=vault`);
  assert.deepEqual(window.windowOpen(), { action: 'deny' });
  assert.throws(() => f.invoke('ready', ownerId, { sender: new EventEmitter() }), { code: 'INVALID_APPROVAL' });
  assert.throws(() => f.invoke('ready', ownerId, { senderFrame: { url: window.webContents.mainFrame.url } }), { code: 'INVALID_APPROVAL' });
  assert.throws(() => f.invoke('ready', 'other-owner'), { code: 'INVALID_APPROVAL' });
  const approvalURL = window.webContents.mainFrame.url;
  window.webContents.mainFrame.url = `${origin}/passwords`;
  assert.throws(() => f.invoke('ready', ownerId), { code: 'INVALID_APPROVAL' });
  window.webContents.mainFrame.url = approvalURL;
  assert.throws(() => f.invoke('respond', { ownerId, id: randomUUID(), cancelled: true }), { code: 'INVALID_APPROVAL' });
  const request = f.invoke('ready', ownerId);
  const proof = { requestId: request.id, binding: 'B'.repeat(43), context: { purpose: 'fill', rp: 'login.example', origin: website.origin, entryId: request.entryId, requestHash: request.requestHash } };
  const response = { id: request.id, ownerId, proof };
  for (const invalid of [
    { ...response, ownerId: 'other-owner' },
    { ...response, id: randomUUID() },
    { ...response, unexpected: 'fixture' },
    { ...response, proof: { ...proof, binding: 'invalid' } },
    { ...response, proof: { ...proof, context: { ...proof.context, requestHash: 'X'.repeat(43) } } },
    { ...response, proof: { ...proof, context: { ...proof.context, origin: 'https://login.example' } } },
  ]) assert.throws(() => f.invoke('respond', invalid), { code: 'INVALID_APPROVAL' });
  f.invoke('respond', response);
  assert.deepEqual(await completion, proof);
  assert.equal(window.isDestroyed(), true);
  assert.throws(() => f.invoke('respond', response), { code: 'INVALID_APPROVAL' });
});

test('exact-URL startup history replacement keeps the approval document active', async t => {
  const f = fixture(t);
  const completion = f.approve();
  const window = f.popup();
  const url = window.webContents.mainFrame.url;
  window.webContents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: true });
  assert.equal(window.isDestroyed(), false);
  const request = f.invoke('ready', ownerId);
  const proof = { requestId: request.id, binding: 'B'.repeat(43), context: { purpose: 'fill', rp: 'login.example', origin: website.origin, entryId: request.entryId, requestHash: request.requestHash } };
  f.invoke('respond', { id: request.id, ownerId, proof });
  assert.deepEqual(await completion, proof);
});

test('navigation, authority changes and timeout cancel desktop approval', async t => {
  const f = fixture(t, { timeout: 50 });
  const navigation = f.approve();
  f.invoke('ready', ownerId);
  const window = f.popup();
  window.webContents.emit('did-start-navigation', { url: window.webContents.mainFrame.url, isMainFrame: true });
  await assert.rejects(navigation, { code: 'APPROVAL_CANCELLED' });
  const urlChange = f.approve();
  f.popup().webContents.emit('did-start-navigation', { url: `${origin}/passwords/provider?view=accounts`, isMainFrame: true, isSameDocument: true });
  await assert.rejects(urlChange, { code: 'APPROVAL_CANCELLED' });
  const sessionChange = f.approve();
  f.changeContext({ session: {} });
  assert.throws(() => f.invoke('ready', ownerId), { code: 'SESSION_CHANGED' });
  await assert.rejects(sessionChange, { code: 'APPROVAL_CANCELLED' });
  f.changeContext({ session: f.session });
  await assert.rejects(f.approve(), { code: 'APPROVAL_CANCELLED' });
});

test('GNOME approval binds the fixed consumer and rejects an unexpected context', async t => {
  const f = fixture(t);
  const completion = f.approve({ kind: 'local-app', id: 'org.gnome.keyring' });
  const request = f.invoke('ready', ownerId);
  assert.equal(request.type, 'native-consumer');
  assert.equal(request.consumerId, 'org.gnome.keyring');
  const proof = { requestId: request.id, binding: 'B'.repeat(43) };
  assert.throws(() => f.invoke('respond', { id: request.id, ownerId, proof: { ...proof, context: {} } }), { code: 'INVALID_APPROVAL' });
  f.invoke('respond', { id: request.id, ownerId, proof });
  assert.deepEqual(await completion, proof);
});
