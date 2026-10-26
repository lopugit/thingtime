'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');

const ORIGIN = 'http://127.0.0.1:28671';
const CHANNEL = 'acceptance-viewer:command';
const FAILURE = 'The isolated viewer request was refused. Inspect the task connection and current page before retrying.';
const STAGES = new Set(['input', 'manifest', 'status', 'binding', 'tabs', 'tab', 'arguments', 'frame-result', ...['frame', 'navigate', 'type', 'key', 'click', 'scroll', 'viewport'].map(value => 'command-' + value)]);
const CODES = new Set(['refused', 'invalid', 'timeout', 'disconnected', 'transport', 'protocol', 'page-context', 'page-closed', 'runtime', 'lease']);
const OPERATIONS = new Set(['input', 'tabs', 'frame', 'navigate', 'type', 'key', 'click', 'scroll', 'viewport']);
function failure(stage = 'input', code = 'refused', operation = 'input') {
  const error = new Error(FAILURE);
  error.diagnostic = Object.freeze({ operation: OPERATIONS.has(operation) ? operation : 'input', stage: STAGES.has(stage) ? stage : 'input', code: CODES.has(code) ? code : 'refused' });
  return error;
}
// Classify only known failure categories; never return the manager's message.
function refusalCode(message) {
  if (typeof message !== 'string') return 'refused';
  if (/Execution context was destroyed|Cannot find context|detached [Ff]rame/.test(message)) return 'page-context';
  if (/Target closed|Session closed|[Pp]age.*closed/.test(message)) return 'page-closed';
  if (message === 'The current browser lease is required.' || message === 'This browser lease has expired.') return 'lease';
  if (/runtime.*(?:unavailable|released)|preflight must finish/i.test(message)) return 'runtime';
  if (/timed out|timeout/i.test(message)) return 'timeout';
  return 'refused';
}
function diagnostic(error) { return failure(error?.diagnostic?.stage, error?.diagnostic?.code, error?.diagnostic?.operation).diagnostic; }
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
    const finish = (code, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); code ? reject(failure('input', code)) : resolve(value); };
    const timer = setTimeout(() => finish('timeout'), 45000);
    socket.once('error', () => finish('transport')); socket.once('end', () => finish('disconnected'));
    socket.once('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', chunk => {
      response += chunk.toString();
      if (!response.includes('\n')) return;
      try { const value = JSON.parse(response.slice(0, response.indexOf('\n'))); if (value.id !== id) return finish('protocol'); if (value.error) return finish(refusalCode(value.error)); finish(null, value.result); } catch { finish('protocol'); }
    });
  });
}
function createBridge(binding, request = (method, params) => rpc(binding, method, params)) {
  let pending = Promise.resolve();
  const browser = (operation, args = {}) => request('browser', { leaseId: binding.leaseId, token: binding.token, operation, args });
  async function execute(input, retryContext = true) {
    let stage = 'input', requested = 'input';
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['operation', 'args'].includes(key))) throw new Error(FAILURE);
      const { operation, args = {} } = input;
      requested = operation;
      stage = 'manifest';
      const manifest = await request('manifest');
      if (manifest?.protocol !== 'thingtime-agent-browser/1' || !['agent.browsers', 'agent.network-policy'].every(feature => /^1\./.test(manifest.features?.[feature] || ''))) throw new Error(FAILURE);
      stage = 'status';
      const status = await request('status');
      const session = status?.sessions?.find(value => value.leaseId === binding.leaseId && value.id === binding.sessionId);
      const lease = status?.leases?.find(value => value.id === binding.leaseId && value.taskId === binding.taskId && !value.expired);
      stage = 'binding';
      if (!session || !lease || session.state !== 'ready' || session.proof?.isolated !== true || session.policy?.mode !== 'isolated' || session.application?.origin !== ORIGIN) throw new Error(FAILURE);
      stage = 'tabs';
      const tabs = await browser('tabs');
      stage = 'tab';
      const tab = tabs?.find(value => value.id === binding.pageId);
      if (!tab || !allowedURL(tab.url, true)) throw new Error(FAILURE);
      if (operation === 'tabs') return [{ id: binding.pageId, url: tab.url === 'about:blank' ? tab.url : ORIGIN + new URL(tab.url).pathname }];
      stage = 'arguments';
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
      stage = 'command-' + operation;
      const result = await browser(operation, { ...safe, pageId: binding.pageId });
      if (operation === 'frame') {
        stage = 'frame-result';
        if (!result || typeof result.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(result.image) || ![result.viewport?.width, result.viewport?.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192)) throw new Error(FAILURE);
        return { image: result.image, viewport: { width: result.viewport.width, height: result.viewport.height } };
      }
      return { ok: true };
    } catch (error) {
      const code = error?.diagnostic?.code || 'refused';
      // A tabs title read may lose its execution context during navigation.
      // No input has been dispatched at this stage. Revalidate the complete
      // binding once, then retry this read; never replay a browser command.
      if (stage === 'tabs' && code === 'page-context' && retryContext) return execute(input, false);
      throw failure(stage, code, requested);
    }
  }
  return input => {
    const next = pending.then(() => execute(input));
    pending = next.catch(() => {}); return next;
  };
}
module.exports = { ORIGIN, CHANNEL, FAILURE, allowedURL, assertSender, loadBinding, createBridge, diagnostic, refusalCode };
