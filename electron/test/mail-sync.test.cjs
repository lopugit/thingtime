const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DesktopMailSync } = require('../lib/mail-sync.cjs');
const batch = { folders: [], messages: [], nextCursor: null };
function fixture(fetchBatch = async () => batch) {
  const sender = new EventEmitter(); sender.mainFrame = { url: 'https://thingtime.example/mail' };
  const event = { sender, senderFrame: sender.mainFrame };
  const bridge = new DesktopMailSync({ fetchBatch, trustedOrigin: () => 'https://thingtime.example' });
  const request = { requestId: 'request_one', account: { sync: { local: true, transport: 'native' } }, protocol: 'imap' };
  return { sender, event, bridge, request };
}
test('native mail accepts only the trusted top-level renderer with explicit device transport', async () => {
  let calls = 0; const { bridge, event, request } = fixture(async () => { calls++; return batch; });
  assert.deepEqual(await bridge.sync(event, request), { ok: true, version: 1, ...batch });
  await assert.rejects(bridge.sync({ ...event, senderFrame: { url: event.senderFrame.url } }, request), /main Thingtime/);
  event.senderFrame.url = 'https://other.example/mail';
  await assert.rejects(bridge.sync(event, request), /main Thingtime/);
  event.senderFrame.url = 'https://thingtime.example/mail';
  await assert.rejects(bridge.sync(event, { ...request, account: { sync: { local: true, transport: 'relay' } } }), /not enabled/);
  assert.equal(calls, 1);
});
test('native mail cancellation and navigation close provider work and never return provider secrets', async () => {
  for (const mode of ['cancel', 'navigation', 'destroyed']) {
    let started; const ready = new Promise(resolve => { started = resolve; });
    const { bridge, event, sender, request } = fixture((_a, _r, signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('PASS fixture-private-password')), { once: true }); started();
    }));
    const pending = bridge.sync(event, request); await ready;
    if (mode === 'cancel') bridge.cancel(event, request);
    else if (mode === 'navigation') sender.emit('did-start-navigation', {}, 'https://other.example', false, true);
    else sender.emit('destroyed');
    await assert.rejects(pending, error => !error.message.includes('fixture-private') && /Device mail sync failed/.test(error.message));
    assert.equal(bridge.active.size, 0);
    assert.equal(sender.listenerCount('did-start-navigation'), 0);
  }
});
test('native mail has a two-request ceiling and cancellation is renderer-bound', async () => {
  const { bridge, event, request } = fixture((_a, _r, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error()))));
  const one = bridge.sync(event, request);
  const two = bridge.sync(event, { ...request, requestId: 'request_two' });
  await assert.rejects(bridge.sync(event, { ...request, requestId: 'request_three' }), /Another/);
  const other = fixture(); bridge.cancel(other.event, request);
  assert.equal(bridge.active.get(request.requestId).controller.signal.aborted, false);
  bridge.stop(); await Promise.all([assert.rejects(one), assert.rejects(two)]);
});
