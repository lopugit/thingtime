'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { ORIGIN, FAILURE, allowedURL, assertSender, loadBinding, createBridge, diagnostic, refusalCode } = require('../scripts/acceptance-viewer-boundary.cjs');
const binding = { leaseId: 'lease', token: 'PRIVATE_HANDLE', taskId: 'task', sessionId: 'session', pageId: '1' };
test('Electron-owned require.main still recognizes the explicit viewer entry script', () => {
  const { isEntrypoint } = require('../scripts/test-agent-acceptance-viewer.cjs');
  const entry = path.resolve(__dirname, '../scripts/test-agent-acceptance-viewer.cjs');
  assert.equal(isEntrypoint(entry), true);
  assert.equal(isEntrypoint(path.relative(process.cwd(), entry)), true);
  assert.equal(isEntrypoint(__filename), false);
  assert.equal(isEntrypoint('electron'), false);
  assert.equal(isEntrypoint(null), false);
});
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

test('diagnostic stages distinguish action failure from subsequent refresh without revealing raw errors', async () => {
  for (const failing of ['manifest', 'status', 'tabs', 'click', 'frame']) {
    const request = async (method, params) => {
      if ((params?.operation || method) === failing) throw new Error('password=SECRET /private/path ?token=SECRET');
      if (method === 'manifest') return { protocol: 'thingtime-agent-browser/1', features: { 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' } };
      if (method === 'status') return { leases: [{ id: 'lease', taskId: 'task' }], sessions: [{ id: 'session', leaseId: 'lease', state: 'ready', proof: { isolated: true }, policy: { mode: 'isolated' }, application: { origin: ORIGIN } }] };
      if (params.operation === 'tabs') return [{ id: '1', url: ORIGIN }];
      return { ok: true };
    };
    const command = createBridge(binding, request);
    await assert.rejects(command({ operation: failing === 'frame' ? 'frame' : 'click', args: failing === 'frame' ? {} : { x: 40.25, y: 17.5 } }), error => {
      assert.equal(error.message, FAILURE);
      assert.deepEqual(diagnostic(error), { operation: failing === 'frame' ? 'frame' : 'click', stage: ['click', 'frame'].includes(failing) ? 'command-' + failing : failing, code: 'refused' });
      assert.equal(JSON.stringify(diagnostic(error)).includes('SECRET'), false);
      return true;
    });
  }
  assert.deepEqual(diagnostic({ diagnostic: { stage: 'password=SECRET', code: 'token=SECRET' } }), { operation: 'input', stage: 'input', code: 'refused' });
});
test('fractional clicks remain exact and a refused action is never retried or poisons the queue', async () => {
  const { command, commands } = fixture();
  await command({ operation: 'click', args: { x: 263.125, y: 701.75 } });
  assert.deepEqual(commands.at(-1).args, { pageId: '1', x: 263.125, y: 701.75 });
  await assert.rejects(command({ operation: 'click', args: { x: NaN, y: 0 } }));
  assert.deepEqual(await command({ operation: 'frame' }), { image: 'YWJj', viewport: { width: 1280, height: 800 } });
  assert.equal(commands.filter(value => value.operation === 'click').length, 1);
});

test('manager refusal classification exports categories only, including navigation context loss', () => {
  for (const [message, code] of [['Execution context was destroyed, most likely because of a navigation.', 'page-context'], ['Protocol error: Target closed.', 'page-closed'], ['The browser operation timed out.', 'timeout'], ['This task runtime is unavailable.', 'runtime'], ['This browser lease has expired.', 'lease'], ['password=SECRET https://private/?token=SECRET', 'refused'], ['unrecognized private failure', 'refused']]) assert.equal(refusalCode(message), code);
});

test('one explicit context-loss preflight retry revalidates ownership and never repeats input', async () => {
  let reads = 0, statusReads = 0, clicks = 0;
  const request = async (method, params) => {
    if (method === 'manifest') return { protocol: 'thingtime-agent-browser/1', features: { 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' } };
    if (method === 'status') { statusReads++; return { leases: [{ id: 'lease', taskId: 'task' }], sessions: [{ id: 'session', leaseId: 'lease', state: 'ready', proof: { isolated: true }, policy: { mode: 'isolated' }, application: { origin: ORIGIN } }] }; }
    if (params.operation === 'tabs') {
      if (++reads === 1) { const error = new Error(FAILURE); error.diagnostic = { code: 'page-context' }; throw error; }
      return [{ id: '1', url: ORIGIN }];
    }
    if (params.operation === 'click') clicks++;
    return { ok: true };
  };
  await createBridge(binding, request)({ operation: 'click', args: { x: 12.5, y: 17 } });
  assert.equal(reads, 2); assert.equal(statusReads, 2); assert.equal(clicks, 1);
  const refused = createBridge(binding, async (method, params) => {
    if (params?.operation === 'tabs') { const error = new Error(FAILURE); error.diagnostic = { code: 'page-context' }; throw error; }
    return request(method, params);
  });
  await assert.rejects(refused({ operation: 'click', args: { x: 1, y: 1 } }), error => {
    assert.deepEqual(diagnostic(error), { operation: 'click', stage: 'tabs', code: 'page-context' }); return true;
  });
  assert.equal(clicks, 1);
});

test('context recovery refuses a changed task binding and never retries a dispatched click', async () => {
  for (const scenario of ['binding-change', 'click-failure', 'generic-tabs']) {
    let statusReads = 0, clicks = 0, tabsReads = 0;
    const command = createBridge(binding, async (method, params) => {
      if (method === 'manifest') return { protocol: 'thingtime-agent-browser/1', features: { 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' } };
      if (method === 'status') return { leases: [{ id: 'lease', taskId: scenario === 'binding-change' && ++statusReads === 2 ? 'foreign' : 'task' }], sessions: [{ id: 'session', leaseId: 'lease', state: 'ready', proof: { isolated: true }, policy: { mode: 'isolated' }, application: { origin: ORIGIN } }] };
      if (params.operation === 'tabs') {
        tabsReads++;
        if (scenario !== 'click-failure') { const error = new Error(FAILURE); error.diagnostic = { code: scenario === 'binding-change' ? 'page-context' : 'refused' }; throw error; }
        return [{ id: '1', url: ORIGIN }];
      }
      clicks++;
      const error = new Error(FAILURE); error.diagnostic = { code: 'page-context' }; throw error;
    });
    await assert.rejects(command({ operation: 'click', args: { x: 1, y: 1 } }));
    assert.equal(clicks, scenario === 'click-failure' ? 1 : 0);
    assert.equal(tabsReads, 1);
  }
});
test('renderer displays only allowlisted operation/stage/code and clears the frame on refusal', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, '../scripts/acceptance-viewer/viewer.js'), 'utf8');
  for (const message of ['raw password=SECRET [click/tabs:page-context]', 'raw password=SECRET [SECRET/SECRET:SECRET]']) {
    const elements = new Map();
    const element = id => { if (!elements.has(id)) elements.set(id, { hidden: false, value: '', textContent: '' }); return elements.get(id); };
    vm.runInNewContext(source, {
      window: { acceptanceViewer: { tabs: async () => { throw new Error(message); } }, addEventListener() {} },
      document: { getElementById: element, querySelectorAll: () => [] }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(element('frame').hidden, true);
    assert.equal(element('status').textContent.includes('SECRET'), false);
    assert.equal(element('status').textContent.includes('[click/tabs:page-context]'), message.includes('[click/tabs:page-context]'));
  }
});

test('select-all chords use only fixed focused-field selection on retained runtimes', async () => {
  const vm = require('node:vm');
  for (const key of ['Control+A', 'Meta+A']) {
    const { command, commands } = fixture();
    const bridge = createBridge(binding, async (method, params) => {
      if (params?.operation === 'evaluate') {
        commands.push(params);
        class Input {
          constructor() { this.type = 'password'; this.value = 'non-secret-sentinel'; }
          select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
        }
        const field = new Input();
        const value = vm.runInNewContext(params.args.expression, { document: { activeElement: field }, HTMLInputElement: Input, HTMLTextAreaElement: class {} });
        assert.equal(value, true);
        assert.equal(params.args.expression.includes(field.value), false);
        return { value };
      }
      if (method === 'manifest') return { protocol: 'thingtime-agent-browser/1', features: { 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' } };
      if (method === 'status') return { leases: [{ id: 'lease', taskId: 'task' }], sessions: [{ id: 'session', leaseId: 'lease', state: 'ready', proof: { isolated: true }, policy: { mode: 'isolated' }, application: { origin: ORIGIN } }] };
      if (params.operation === 'tabs') return [{ id: '1', url: ORIGIN }];
    });
    assert.deepEqual(await bridge({ operation: 'key', args: { key } }), { ok: true });
    assert.equal(commands.at(-1).operation, 'evaluate');
    await assert.rejects(command({ operation: 'evaluate', args: { expression: 'document.activeElement.value' } }), { message: FAILURE });
  }
});

test('refused selection fences queued input until a successful current frame', async () => {
  let types = 0;
  const command = createBridge(binding, async (method, params) => {
    if (method === 'manifest') return { protocol: 'thingtime-agent-browser/1', features: { 'agent.browsers': '1.0.0', 'agent.network-policy': '1.0.0' } };
    if (method === 'status') return { leases: [{ id: 'lease', taskId: 'task' }], sessions: [{ id: 'session', leaseId: 'lease', state: 'ready', proof: { isolated: true }, policy: { mode: 'isolated' }, application: { origin: ORIGIN } }] };
    if (params.operation === 'tabs') return [{ id: '1', url: ORIGIN }];
    if (params.operation === 'evaluate') return { value: false };
    if (params.operation === 'type') types++;
    if (params.operation === 'frame') return { image: 'YWJj', viewport: { width: 800, height: 600 } };
    return { ok: true };
  });
  const selection = command({ operation: 'key', args: { key: 'Control+A' } });
  const queued = command({ operation: 'type', args: { text: 'must-not-append' } });
  await assert.rejects(selection, error => diagnostic(error).stage === 'command-key');
  await assert.rejects(queued, { message: FAILURE });
  assert.equal(types, 0);
  await command({ operation: 'tabs' });
  await assert.rejects(command({ operation: 'type', args: { text: 'still-blocked' } }));
  await command({ operation: 'frame' });
  await command({ operation: 'type', args: { text: 'explicitly-recovered' } });
  assert.equal(types, 1);
});

test('renderer keeps failed edits visible and input disabled until explicit refresh', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, '../scripts/acceptance-viewer/viewer.js'), 'utf8');
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { id, hidden: false, disabled: false, value: '', textContent: '' }); return elements.get(id); };
  const keyButton = { id: 'select-all', dataset: { key: 'Control+A' } };
  const buttons = [element('go'), element('refresh'), element('type'), keyButton];
  let typed = 0;
  const api = { tabs: async () => [{ id: '1', url: ORIGIN }], frame: async () => ({ image: 'YWJj' }), key: async () => { throw new Error('SECRET [key/command-key:refused]'); }, type: async () => { typed++; } };
  vm.runInNewContext(source, { window: { acceptanceViewer: api, addEventListener() {} }, document: { getElementById: element, querySelectorAll: selector => selector === '[data-key]' ? [keyButton] : buttons } });
  await new Promise(resolve => setImmediate(resolve));
  element('text').value = 'sensitive-input-must-clear';
  await keyButton.onclick();
  assert.equal(element('text').value, '');
  assert.equal(element('text').disabled, true);
  assert.equal(element('type').disabled, true);
  assert.equal(element('refresh').disabled, false);
  assert.match(element('status').textContent, /Input is stopped/);
  assert.equal(element('status').textContent.includes('SECRET'), false);
  element('text').value = 'must-not-send';
  element('type').onclick();
  assert.equal(typed, 0);
  await element('refresh').onclick();
  assert.equal(element('text').disabled, false);
  assert.equal(element('type').disabled, false);
  assert.equal(element('status').textContent, 'Ready');
});
