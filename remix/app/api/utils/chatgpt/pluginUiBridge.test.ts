import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { renderThingtimeMcpUi } from './pluginLimitlessCore';
import { mcpDemoScenarios, reviewPayloadForScenario } from '../../../routes/docs/mcpDemoCore';

// Execute the shipped module, including its actual event listener and button callbacks.
const app = (legacy?: Record<string, unknown>) => {
  const messages: any[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let receive: (event: any) => void;
  const node = () => ({
    textContent: '', disabled: false, checked: false, id: '', className: '',
    handlers: {} as Record<string, (...args: any[]) => any>,
    addEventListener(type: string, callback: (...args: any[]) => any) { this.handlers[type] = callback; },
    setAttribute() {}, focus() {}
  });
  const elements = new Map<string, ReturnType<typeof node>>();
  let html = '';
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value: string) {
      html = value;
      elements.clear();
      for (const match of value.matchAll(/id="([^"]+)"[^>]*>/g)) {
        const element = node();
        element.id = match[1];
        element.disabled = match[0].includes('disabled');
        elements.set('#' + match[1], element);
      }
    },
    querySelector: (selector: string) => elements.get(selector),
    querySelectorAll: () => [],
    append(element: ReturnType<typeof node>) { elements.set('#' + element.id, element); }
  };
  const parent = { postMessage(message: any) { assert.ok(receive, 'listener must precede initialization'); messages.push(message); } };
  const window = { parent, openai: legacy, addEventListener(_: string, handler: typeof receive) { receive = handler; } };
  const script = renderThingtimeMcpUi().match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  vm.runInNewContext(script, {
    window,
    document: { getElementById: () => root, createElement: node },
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id)
  });
  const send = (data: any, source: unknown = parent) => receive({ source, data });
  const reply = (request: any, result: any, source?: unknown) => send({ jsonrpc: '2.0', id: request.id, result }, source);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const init = async () => { reply(messages[0], { protocolVersion: '2026-01-26', hostInfo: { name: 'Test', version: '1' }, hostCapabilities: {} }); await flush(); };
  const result = (data: any) => send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: data } });
  const expire = async () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); await flush(); };
  return { messages, timers, elements, root, send, reply, flush, init, result, expire };
};
const preview = {
  receipt: 'signed-plan', account: { id: 'personal' },
  preview: { previewId: 'plan', cursor: 0, nextCursor: null, total: 1, operations: [{ id: 'one', title: 'Keep this result' }] }
};

test('shipped MCP App initializes before readiness and renders early tool results without window.openai', async () => {
  const ui = app();
  assert.equal(ui.messages.length, 1);
  assert.equal(ui.messages[0].method, 'ui/initialize');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.messages[0].params)), {
    appInfo: { name: 'Thingtime', version: '1.1.1' }, appCapabilities: {}, protocolVersion: '2026-01-26'
  });
  ui.result({ things: [{ title: 'Early result' }] });
  assert.match(ui.root.innerHTML, /Early result/);
  await ui.init();
  assert.equal(ui.messages[1].method, 'ui/notifications/initialized');
  assert.equal(Object.prototype.hasOwnProperty.call(ui.messages[1], 'id'), false);
  assert.equal(ui.timers.size, 0);
});

test('foreign messages, wrong correlation IDs, malformed replies and late replies cannot ready or overwrite the app', async () => {
  const ui = app();
  ui.reply(ui.messages[0], { protocolVersion: '2026-01-26' }, {});
  ui.reply({ id: 'unknown' }, { protocolVersion: '2026-01-26' });
  ui.send({ jsonrpc: '1.0', id: ui.messages[0].id, result: {} });
  ui.send({ jsonrpc: '2.0', id: ui.messages[0].id, result: {}, error: { code: 1, message: 'invalid' } });
  ui.send({ jsonrpc: '2.0', id: 'foreign', method: 'ui/notifications/tool-result', params: { things: [{ title: 'bad' }] } });
  await ui.flush();
  assert.equal(ui.messages.length, 1);
  await ui.init();
  ui.reply(ui.messages[0], { protocolVersion: 'wrong' });
  await ui.flush();
  assert.equal(ui.messages.length, 2);
  ui.send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { things: [{ title: 'bad' }] } }, {});
  assert.doesNotMatch(ui.root.innerHTML, /bad/);
});

test('standard button calls wait for initialization, correlate tools/call and never use legacy fallback', async () => {
  let legacyCalls = 0;
  const ui = app({ callTool: () => { legacyCalls++; } });
  ui.result(preview);
  const click = ui.elements.get('#apply')!.handlers.click();
  await ui.flush();
  assert.equal(ui.messages.length, 1);
  await ui.init();
  const request = ui.messages[2];
  assert.equal(request.method, 'tools/call');
  assert.deepEqual(JSON.parse(JSON.stringify(request.params)), { name: 'apply_thingtime_mutation', arguments: { receipt: 'signed-plan', accountId: 'personal' } });
  ui.reply({ id: 'wrong' }, { structuredContent: { things: [{ title: 'Wrong response' }] } });
  assert.doesNotMatch(ui.root.innerHTML, /Wrong response/);
  ui.reply(request, { structuredContent: { things: [{ title: 'Applied once' }] } });
  await click;
  assert.match(ui.root.innerHTML, /Applied once/);
  assert.equal(legacyCalls, 0);
  assert.equal(ui.timers.size, 0);
});

test('pagination uses the initialized standard bridge and preserves receipt across review pages', async () => {
  const ui = app(); await ui.init();
  ui.result({ ...preview, preview: { ...preview.preview, nextCursor: 1, total: 2 } });
  const click = ui.elements.get('#next')!.handlers.click(); await ui.flush();
  const request = ui.messages[2];
  assert.equal(request.params.name, 'get_thingtime_mutation_preview');
  assert.equal(request.params.arguments.cursor, 1);
  ui.reply(request, { structuredContent: { preview: { ...preview.preview, cursor: 1, nextCursor: null, total: 2 } } });
  await click;
  assert.ok(ui.elements.get('#apply'));
  assert.equal(ui.timers.size, 0);
});

for (const failure of ['timeout', 'rpc-error', 'tool-error'] as const) {
  test(`an uncertain mutation ${failure} retains data, locks its receipt and does not retry through legacy`, async () => {
    let legacyCalls = 0;
    const ui = app({ callTool: () => { legacyCalls++; } }); await ui.init(); ui.result(preview);
    const click = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
    const request = ui.messages[2];
    if (failure === 'timeout') await ui.expire();
    if (failure === 'rpc-error') ui.send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'host failure' } });
    if (failure === 'tool-error') ui.reply(request, { isError: true, content: [{ type: 'text', text: 'failure' }] });
    await click;
    assert.match(ui.root.innerHTML, /Keep this result/);
    assert.match(ui.elements.get('#status')!.textContent, /history in chat/);
    assert.equal(ui.elements.get('#apply')!.disabled, true);
    await ui.elements.get('#apply')!.handlers.click();
    ui.reply(request, { structuredContent: { things: [{ title: 'Late result' }] } });
    await ui.flush();
    assert.doesNotMatch(ui.root.innerHTML, /Late result/);
    assert.equal(ui.messages.length, 3);
    assert.equal(legacyCalls, 0);
    assert.equal(ui.timers.size, 0);
  });
}

test('failed or incompatible initialization reports one inline error and retains received data', async () => {
  for (const incompatible of [false, true]) {
    const ui = app(); ui.result(preview);
    if (incompatible) ui.reply(ui.messages[0], { protocolVersion: 'wrong' });
    else await ui.expire();
    await ui.flush();
    assert.equal(ui.messages.length, 1);
    assert.match(ui.root.innerHTML, /Keep this result/);
    assert.match(ui.elements.get('#status')!.textContent, /protocol|connect/);
    ui.reply(ui.messages[0], { protocolVersion: '2026-01-26' }); await ui.flush();
    assert.equal(ui.messages.length, 1);
    assert.equal(ui.timers.size, 0);
  }
});

test('legacy-only hosts are deliberately selected after unsupported initialization and calls remain bounded', async () => {
  let calls = 0;
  const ui = app({ callTool: () => { calls++; return new Promise(() => {}); }, toolOutput: preview });
  ui.send({ jsonrpc: '2.0', id: ui.messages[0].id, error: { code: -32601, message: 'unsupported' } });
  await ui.flush();
  const click = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
  assert.equal(calls, 1);
  assert.equal(ui.messages.length, 1);
  await ui.expire(); await click;
  assert.equal(ui.elements.get('#apply')!.disabled, true);
  assert.equal(ui.timers.size, 0);
});

test('confirmation-required tool errors retain the signed plan and enable the explicit confirmation flow', async () => {
  const ui = app(); await ui.init(); ui.result(preview);
  const click = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
  ui.reply(ui.messages[2], { isError: true, structuredContent: { code: 'confirmation_required', confirmationRequired: true } });
  await click;
  assert.match(ui.root.innerHTML, /Keep this result/);
  const confirm = ui.elements.get('#confirm')!;
  assert.ok(confirm);
  assert.equal(ui.elements.get('#apply')!.disabled, true);
  confirm.checked = true; confirm.handlers.change();
  assert.equal(ui.elements.get('#apply')!.disabled, false);
  const confirmed = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
  assert.equal(ui.messages[3].params.arguments.confirmed, true);
  ui.reply(ui.messages[3], { structuredContent: { message: 'Completed' } }); await confirmed;
});

test('an old operation cannot overwrite or lock a newer tool result', async () => {
  for (const timeout of [false, true]) {
    const ui = app(); await ui.init(); ui.result(preview);
    const click = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
    ui.result({ ...preview, receipt: 'new-plan', preview: { ...preview.preview, previewId: 'new', operations: [{ title: 'Newer result' }] } });
    if (timeout) await ui.expire();
    else ui.reply(ui.messages[2], { structuredContent: { message: 'Old result' } });
    await click;
    assert.match(ui.root.innerHTML, /Newer result/);
    assert.doesNotMatch(ui.root.innerHTML, /Old result/);
    assert.equal(ui.elements.get('#apply')!.disabled, false);
  }
});

test('uncertain-operation explanation survives rerendering the current plan', async () => {
  const ui = app(); await ui.init(); ui.result(preview);
  const click = ui.elements.get('#apply')!.handlers.click(); await ui.flush(); await ui.expire(); await click;
  ui.result(preview);
  assert.match(ui.root.innerHTML, /history in chat/);
  assert.equal(ui.elements.get('#apply')!.disabled, true);
});

test('duplicate preview notifications cannot dispatch the same in-flight receipt twice', async () => {
  const ui = app(); await ui.init(); ui.result(preview);
  const click = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
  ui.result(preview);
  assert.equal(ui.elements.get('#apply')!.disabled, true);
  await ui.elements.get('#apply')!.handlers.click();
  assert.equal(ui.messages.length, 3);
  await ui.expire(); await click;
  ui.result(preview);
  assert.equal(ui.elements.get('#apply')!.disabled, true);
  assert.match(ui.root.innerHTML, /history in chat/);
});

test('switching between independently pending and uncertain receipts preserves each lock and error', async () => {
  const ui = app(); await ui.init(); ui.result(preview);
  const first = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
  const secondPreview = { ...preview, receipt: 'second-plan', preview: { ...preview.preview, previewId: 'second' } };
  ui.result(secondPreview);
  const second = ui.elements.get('#apply')!.handlers.click(); await ui.flush();
  ui.result(preview);
  assert.equal(ui.elements.get('#apply')!.disabled, true);
  await ui.elements.get('#apply')!.handlers.click();
  assert.equal(ui.messages.length, 4);
  await ui.expire(); await first; await second;
  for (const value of [preview, secondPreview]) {
    ui.result(value);
    assert.equal(ui.elements.get('#apply')!.disabled, true);
    assert.match(ui.root.innerHTML, /history in chat/);
  }
});

test('legacy hosts can complete a tool after initialization times out without retrying the standard path', async () => {
  let calls = 0;
  const ui = app({ callTool: async () => { calls++; return { structuredContent: { message: 'Legacy completed' } }; }, toolOutput: preview });
  await ui.expire();
  await ui.elements.get('#apply')!.handlers.click();
  assert.match(ui.root.innerHTML, /Legacy completed/);
  assert.equal(calls, 1);
  assert.equal(ui.messages.length, 1);
  assert.equal(ui.timers.size, 0);
});

test('an initialization error other than unsupported method never silently selects legacy', async () => {
  let calls = 0;
  const ui = app({ callTool: () => { calls++; }, toolOutput: preview });
  ui.send({ jsonrpc: '2.0', id: ui.messages[0].id, error: { code: -32603, message: 'initialization failure' } });
  await ui.flush();
  await ui.elements.get('#apply')!.handlers.click();
  assert.equal(calls, 0);
  assert.equal(ui.messages.length, 1);
  assert.match(ui.elements.get('#status')!.textContent, /connect/);
  assert.equal(ui.timers.size, 0);
});


test('each MCP Lab payload renders complete review pages and policy-gated Apply controls', async () => {
  for (const scenario of mcpDemoScenarios) {
    const ui = app(); await ui.init();
    const payload = reviewPayloadForScenario(scenario);
    ui.result(payload);
    assert.doesNotMatch(ui.root.innerHTML, /NaN|of undefined/);
    assert.equal(ui.elements.has('#next'), false);
    assert.equal(ui.elements.has('#apply'), payload.confirmationRequired);
    assert.equal(ui.elements.has('#confirm'), payload.confirmationRequired);
    if (payload.confirmationRequired) {
      assert.equal(ui.elements.get('#apply')!.disabled, true);
      const confirm = ui.elements.get('#confirm')!;
      confirm.checked = true; confirm.handlers.change();
      assert.equal(ui.elements.get('#apply')!.disabled, false);
    }
  }
});
