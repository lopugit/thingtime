'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');

const ORIGIN = 'http://127.0.0.1:28671';
const CHANNEL = 'acceptance-viewer:command';
const FAILURE = 'The isolated viewer request was refused. Inspect the task connection and current page before retrying.';
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Control+A', 'Meta+A']);
function allowedURL(value, blank = false) {
  if (blank && value === 'about:blank') return true;
  try { const url = new URL(value); return url.origin === ORIGIN && !url.username && !url.password; } catch { return false; }
}
function assertSender(event, contents, rendererURL) {
  if (!event || event.sender !== contents || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== rendererURL) throw new Error(FAILURE);
}
async function privatePath(file, kind) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || !stat[kind]()) throw new Error(FAILURE);
  if (await fs.realpath(file) !== file) throw new Error(FAILURE);
}
async function loadBinding(root) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) throw new Error(FAILURE);
  await privatePath(root, 'isDirectory');
  const descriptorFile = path.join(root, 'relay.json'), leaseFile = path.join(root, 'browser-lease.json');
  await privatePath(descriptorFile, 'isFile'); await privatePath(leaseFile, 'isFile');
  const descriptor = JSON.parse(await fs.readFile(descriptorFile, 'utf8'));
  const lease = JSON.parse(await fs.readFile(leaseFile, 'utf8'));
  const socketPath = path.join(root, 'browser.sock');
  await privatePath(socketPath, 'isSocket');
  const pageId = descriptor.browserTabs?.[0]?.id;
  if (descriptor.origin !== ORIGIN || descriptor.ready !== true || !descriptor.isolation?.isolated || descriptor.socketPath !== socketPath || descriptor.leaseFile !== leaseFile || lease.socketPath !== socketPath || lease.taskId !== descriptor.taskId || !lease.id || !lease.token || !descriptor.sessionId || typeof pageId !== 'string') throw new Error(FAILURE);
  return Object.freeze({ root, socketPath, taskId: descriptor.taskId, sessionId: descriptor.sessionId, pageId, leaseId: lease.id, token: lease.token });
}
function rpc(binding, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID(), socket = net.createConnection(binding.socketPath);
    let response = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(new Error(FAILURE)) : resolve(value); };
    const timer = setTimeout(() => finish(true), 45000);
    socket.once('error', () => finish(true)); socket.once('end', () => finish(true));
    socket.once('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', chunk => {
      response += chunk.toString();
      if (!response.includes('\n')) return;
      try { const value = JSON.parse(response.slice(0, response.indexOf('\n'))); if (value.id !== id || value.error) return finish(true); finish(false, value.result); } catch { finish(true); }
    });
  });
}
function createBridge(binding, request = (method, params) => rpc(binding, method, params)) {
  let pending = Promise.resolve();
  const browser = (operation, args = {}) => request('browser', { leaseId: binding.leaseId, token: binding.token, operation, args });
  async function execute(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['operation', 'args'].includes(key))) throw new Error(FAILURE);
    const { operation, args = {} } = input;
    const manifest = await request('manifest');
    if (manifest?.protocol !== 'thingtime-agent-browser/1' || !['agent.browsers', 'agent.network-policy'].every(feature => /^1\./.test(manifest.features?.[feature] || ''))) throw new Error(FAILURE);
    const status = await request('status');
    const session = status?.sessions?.find(value => value.leaseId === binding.leaseId && value.id === binding.sessionId);
    const lease = status?.leases?.find(value => value.id === binding.leaseId && value.taskId === binding.taskId && !value.expired);
    if (!session || !lease || session.state !== 'ready' || session.proof?.isolated !== true || session.policy?.mode !== 'isolated' || session.application?.origin !== ORIGIN) throw new Error(FAILURE);
    const tabs = await browser('tabs');
    const tab = tabs?.find(value => value.id === binding.pageId);
    if (!tab || !allowedURL(tab.url, true)) throw new Error(FAILURE);
    if (operation === 'tabs') return [{ id: binding.pageId, url: tab.url === 'about:blank' ? tab.url : ORIGIN + new URL(tab.url).pathname }];
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(FAILURE);
    let safe;
    switch (operation) {
      case 'frame': safe = {}; break;
      case 'navigate': if (!allowedURL(args.url)) throw new Error(FAILURE); safe = { url: args.url }; break;
      case 'type': if (!allowedURL(tab.url) || typeof args.text !== 'string' || !args.text) throw new Error(FAILURE); safe = { text: args.text }; break;
      case 'key': if (!allowedURL(tab.url) || !KEYS.has(args.key)) throw new Error(FAILURE); safe = { key: args.key }; break;
      case 'click': if (!allowedURL(tab.url) || ![args.x, args.y].every(value => Number.isFinite(value) && value >= 0 && value <= 8192)) throw new Error(FAILURE); safe = { x: args.x, y: args.y }; break;
      case 'scroll': if (!allowedURL(tab.url) || ![args.x || 0, args.y || 0].every(value => Number.isFinite(value) && Math.abs(value) <= 8192)) throw new Error(FAILURE); safe = { x: args.x || 0, y: args.y || 0 }; break;
      case 'viewport': if (![args.width, args.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192)) throw new Error(FAILURE); safe = { width: args.width, height: args.height }; break;
      default: throw new Error(FAILURE);
    }
    if (Object.keys(args).some(key => !Object.hasOwn(safe, key))) throw new Error(FAILURE);
    const result = await browser(operation, { ...safe, pageId: binding.pageId });
    if (operation === 'frame') {
      if (!result || typeof result.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(result.image) || ![result.viewport?.width, result.viewport?.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192)) throw new Error(FAILURE);
      return { image: result.image, viewport: { width: result.viewport.width, height: result.viewport.height } };
    }
    return { ok: true };
  }
  return input => {
    const next = pending.then(() => execute(input)).catch(() => { throw new Error(FAILURE); });
    pending = next.catch(() => {}); return next;
  };
}
module.exports = { ORIGIN, CHANNEL, FAILURE, allowedURL, assertSender, loadBinding, createBridge };
