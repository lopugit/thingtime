'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SyncWindowLease } = require('../lib/sync-window.cjs');
function fixture() {
    const throttles = [], frame = { url: 'http://127.0.0.1:23114/files' };
    let hidden = 0, prevented = 0;
    const window = { isDestroyed: () => false, hide: () => hidden++, webContents: { mainFrame: frame, setBackgroundThrottling: value => throttles.push(value) } };
    const context = { window, origin: 'http://127.0.0.1:23114', enabled: true };
    const lease = new SyncWindowLease(() => context);
    const event = { sender: window.webContents, senderFrame: frame };
    const close = () => lease.close({ preventDefault: () => prevented++ }, window);
    return { lease, window, context, event, close, throttles, counts: () => ({ hidden, prevented }) };
}
test('only an active transfer keeps its Mac window alive and timers unthrottled', () => {
    const f = fixture(); assert.equal(f.close(), false);
    assert.deepEqual(f.lease.set(f.event, { active: true }), { ok: true, version: '1.0.0' });
    assert.equal(f.close(), true); assert.deepEqual(f.counts(), { hidden: 1, prevented: 1 });
    f.lease.set(f.event, { active: false }); assert.equal(f.close(), false);
    assert.deepEqual(f.throttles, [false, true]);
});
test('quit and renderer invalidation always release the lease', () => {
    for (const operation of ['quit', 'invalidate']) {
        const f = fixture(); f.lease.set(f.event, { active: true }); f.lease[operation]();
        assert.equal(f.close(), false); assert.equal(f.lease.window, null); assert.deepEqual(f.throttles, [false, true]);
        if (operation === 'quit') assert.throws(() => f.lease.set(f.event, { active: true }));
    }
});
test('foreign frames, windows, origins and malformed requests cannot hold the app open', () => {
    const changes = [f => { f.event.sender = {}; }, f => { f.event.senderFrame = { ...f.event.senderFrame }; },
        f => { f.event.senderFrame.url = 'https://other.example'; }, f => { f.context.enabled = false; },
        f => { f.window.isDestroyed = () => true; }];
    for (const change of changes) { const f = fixture(); change(f); assert.throws(() => f.lease.set(f.event, { active: true })); assert.equal(f.lease.window, null); }
    for (const input of [null, {}, { active: 1 }, { active: true, path: '/' }]) {
        const f = fixture(); assert.throws(() => f.lease.set(f.event, input)); assert.equal(f.lease.window, null);
    }
});
