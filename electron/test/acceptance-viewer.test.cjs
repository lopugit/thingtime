'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { ORIGIN, FAILURE, allowedURL, assertSender, loadBinding, createBridge } = require('../scripts/acceptance-viewer-boundary.cjs');
const binding = { leaseId: 'lease', token: 'PRIVATE_HANDLE', taskId: 'task', sessionId: 'session', pageId: '1' };
function fixture({ url = ORIGIN + '/register', mutate = () => {} } = {}) {
  const commands = [];
  const status = { leases: [{ id: 'lease', taskId: 'task', expired: false }], sessions: [{ id: 'session', leaseId: 'lease', state: 'ready', proof: { isolated: true }, policy: { mode: 'isolated' }, application: { origin: ORIGIN } }] };
  mutate(status);
  const request = async (method, params) => {
    if (method === 'manifest') return { protocol: 'thingtime-agent-browser/1', features: { 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' } };
    if (method === 'status') return status;
    commands.push(params);
    if (params.operation === 'tabs') return [{ id: '2', url: ORIGIN }, { id: '1', url }];
    if (params.operation === 'frame') return { image: 'YWJj', viewport: { width: 1280, height: 800 }, token: 'MUST_NOT_RETURN' };
    return { ok: true, secretEcho: params.args.text };
  };
  return { command: createBridge(binding, request), commands };
}
test('exact origin and uncredentialed URLs only; blank is navigation-only bootstrap', () => {
  for (const url of [ORIGIN + '/register', ORIGIN + '/login?q=1']) assert.equal(allowedURL(url), true);
  for (const url of ['http://localhost:28671', 'https://thingtime.com', 'http://127.0.0.1:28672', 'file:///tmp/a', 'javascript:alert(1)', 'http://u:p@127.0.0.1:28671', 'about:blank']) assert.equal(allowedURL(url), false);
  assert.equal(allowedURL('about:blank', true), true);
});
test('IPC requires exact owned contents, main frame, immutable renderer URL', () => {
  const frame = { url: 'file:///viewer/index.html' }, contents = { mainFrame: frame };
  assert.doesNotThrow(() => assertSender({ sender: contents, senderFrame: frame }, contents, frame.url));
  for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { ...frame } }, { sender: contents, senderFrame: { url: 'https://evil.test' } }]) assert.throws(() => assertSender(event, contents, frame.url), { message: FAILURE });
});
test('typed text goes only to bound tab; renderer receives no handle or raw result', async () => {
  const { command, commands } = fixture();
  assert.deepEqual(await command({ operation: 'type', args: { text: 'synthetic-test-value' } }), { ok: true });
  assert.deepEqual(commands.at(-1), { leaseId: 'lease', token: 'PRIVATE_HANDLE', operation: 'type', args: { pageId: '1', text: 'synthetic-test-value' } });
  assert.deepEqual(await command({ operation: 'frame' }), { image: 'YWJj', viewport: { width: 1280, height: 800 } });
});
test('foreign tab override, arbitrary operations, extra arguments and invalid keys fail closed', async () => {
  for (const input of [{ operation: 'type', args: { text: 'value', pageId: '2' } }, { operation: 'evaluate', args: { expression: '1' } }, { operation: 'newPage' }, { operation: 'type', args: { text: 'value' }, leaseId: 'foreign' }, { operation: 'key', args: { key: 'F12' } }, { operation: 'navigate', args: { url: 'https://thingtime.com' } }]) {
    const { command, commands } = fixture();
    await assert.rejects(command(input), { message: FAILURE });
    assert.equal(commands.some(value => value.operation !== 'tabs'), false);
  }
});
test('no input reaches blank or off-origin pages', async () => {
  for (const url of ['about:blank', 'https://thingtime.com/login', 'http://localhost:28671/login']) {
    const { command, commands } = fixture({ url });
    await assert.rejects(command({ operation: 'type', args: { text: 'synthetic' } }), { message: FAILURE });
    assert.equal(commands.some(value => value.operation === 'type'), false);
  }
  assert.deepEqual(await fixture({ url: 'about:blank' }).command({ operation: 'navigate', args: { url: ORIGIN + '/register' } }), { ok: true });
});
test('task/session/lease/isolation/origin mismatch refuses before browser data', async () => {
  for (const mutate of [s => { s.leases[0].taskId = 'other'; }, s => { s.leases[0].expired = true; }, s => { s.sessions[0].id = 'other'; }, s => { s.sessions[0].proof.isolated = false; }, s => { s.sessions[0].policy.mode = 'unrestricted'; }, s => { s.sessions[0].application.origin = 'https://thingtime.com'; }]) {
    const { command, commands } = fixture({ mutate });
    await assert.rejects(command({ operation: 'frame' }), { message: FAILURE });
    assert.equal(commands.length, 0);
  }
});
test('raw socket errors never leave bridge', async () => {
  const command = createBridge(binding, async () => { throw new Error('password=NEVER_RETURN /private/path ' + binding.token); });
  await assert.rejects(command({ operation: 'frame' }), { message: FAILURE });
});
test('real manager dispatch and BrowserDriver produce compatible manifest/status/tab/frame schemas', async () => {
  const { EventEmitter } = require('node:events');
  const { AgentBrowserManager } = require('../lib/agent-browsers/manager.cjs');
  const { BrowserDriver } = require('../lib/agent-browsers/runtime/browser-driver.cjs');
  const { dispatch } = require('../lib/agent-browsers/control.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-manager-test-'));
  const images = new EventEmitter();
  images.records = new Map([['image', { imageId: 'immutable-image' }]]);
  images.initialize = async () => {}; images.snapshot = () => ({ installs: [], downloads: [] });
  const driver = new BrowserDriver();
  // Only native browser I/O is substituted: actual driver, manager, lease and
  // control-dispatch implementations produce all compatibility schemas.
  driver.browser = { close: async () => {} };
  driver.pages.set('1', { isClosed: () => false, url: () => ORIGIN + '/register', title: async () => 'Test', screenshot: async () => 'YWJj', viewport: () => ({ width: 1280, height: 800 }) });
  const manager = await new AgentBrowserManager({ stateRoot: root, images, engine: { recoverOwnedSessions: async () => {} }, createSession: options => ({ id: 'actual-session', policy: options.networkPolicy, proof: { isolated: true }, start: async () => {}, close: () => driver.close(), call: (method, args) => method === 'launch' ? Promise.resolve({ tabs: [], application: { origin: ORIGIN } }) : driver.call(method, args) }) }).initialize();
  try {
    manager.registerTask({ taskId: 'task', network: { mode: 'isolated' } });
    const lease = manager.claim({ taskId: 'task', installId: 'image', agentId: 'viewer-test' });
    await manager.launch({ leaseId: lease.id, token: lease.token });
    const command = createBridge({ taskId: 'task', sessionId: 'actual-session', leaseId: lease.id, token: lease.token, pageId: '1' }, (method, params) => dispatch(manager, { method, params }));
    assert.deepEqual(await command({ operation: 'tabs' }), [{ id: '1', url: ORIGIN + '/register' }]);
    assert.deepEqual(await command({ operation: 'frame' }), { image: 'YWJj', viewport: { width: 1280, height: 800 } });
  } finally { await manager.close(); await fs.rm(root, { recursive: true, force: true }); }
});
test('private descriptor/lease/socket binding rejects permissions, symlinks, foreign task', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'acceptance-viewer-test-'))); await fs.chmod(root, 0o700);
  const socketPath = path.join(root, 'browser.sock'), leaseFile = path.join(root, 'browser-lease.json');
  const server = net.createServer(); await new Promise(resolve => server.listen(socketPath, resolve)); await fs.chmod(socketPath, 0o600);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const descriptor = { origin: ORIGIN, ready: true, isolation: { isolated: true }, socketPath, leaseFile, taskId: 'task', sessionId: 'session', browserTabs: [{ id: '1' }] };
  await fs.writeFile(path.join(root, 'relay.json'), JSON.stringify(descriptor), { mode: 0o600 });
  await fs.writeFile(leaseFile, JSON.stringify({ id: 'lease', taskId: 'task', token: 'synthetic', socketPath }), { mode: 0o600 });
  const result = await loadBinding(root); assert.equal(result.pageId, '1'); assert.equal(result.taskId, 'task');
  await fs.chmod(leaseFile, 0o644); await assert.rejects(loadBinding(root)); await fs.chmod(leaseFile, 0o600);
  await fs.rename(leaseFile, leaseFile + '.real'); await fs.symlink(leaseFile + '.real', leaseFile); await assert.rejects(loadBinding(root)); await fs.unlink(leaseFile);
  await fs.writeFile(leaseFile, JSON.stringify({ id: 'lease', taskId: 'other', token: 'synthetic', socketPath }), { mode: 0o600 }); await assert.rejects(loadBinding(root));
});
test('GUI contract keeps sandbox, fixed preload controls, CSP and masked immediate-clear input', async () => {
  const read = file => fs.readFile(path.join(__dirname, '../scripts', file), 'utf8');
  const main = await read('test-agent-acceptance-viewer.cjs'), preload = await read('acceptance-viewer/preload.cjs'), html = await read('acceptance-viewer/index.html'), js = await read('acceptance-viewer/viewer.js');
  for (const text of ['contextIsolation: true', 'sandbox: true', 'webSecurity: true', 'nodeIntegration: false', "action: 'deny'", "contents.on('will-navigate'", 'assertSender(event, contents, rendererURL)', 'setPermissionRequestHandler', 'onBeforeRequest']) assert.ok(main.includes(text), text);
  assert.equal(/executeJavaScript|loadRemoteModule|shell\.openExternal|createServer/.test(main + preload), false);
  assert.ok(html.includes('type="password"')); assert.ok(html.includes("connect-src 'none'")); assert.ok(js.indexOf("element('text').value = ''") < js.indexOf('api.type(text)'));
  assert.equal(/console\.|localStorage|sessionStorage/.test(js + preload), false);
});
