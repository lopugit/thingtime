import assert from 'node:assert/strict';
import test from 'node:test';
import { flushThingtimeSnapshot } from './flushThingtimeSnapshot';
import { createLatestRevisionAutosave } from './latestRevisionAutosave';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
test('explicit flush drains queued edits and awaits durable writes without advancing debounce timers', async () => {
 let state = 'old'; let written = ''; let done = false;
 const gate = deferred();
 const autosave = createLatestRevisionAutosave({ debounceMs: 350, maxWaitMs: 2000, serialize: (value: string) => value,
  write: async value => { await gate.promise; written = value; } });
 const operation = flushThingtimeSnapshot({ assertCurrent() {}, drain: () => { state = 'latest queued edit'; }, read: () => state,
  schedule: value => { autosave.schedule(value, 1); }, flush: autosave.flush }).then(() => { done = true; });
 await Promise.resolve(); assert.equal(done, false); assert.equal(written, '');
 gate.resolve(); await operation;
 assert.equal(written, 'latest queued edit'); assert.equal(done, true); autosave.dispose();
});
test('write failures reject the explicit commit boundary', async () => {
 await assert.rejects(flushThingtimeSnapshot({ assertCurrent() {}, drain() {}, read: () => 'edit', schedule() {}, flush: async () => { throw new Error('disk full'); } }), /disk full/);
});
test('changed owner/plane refuses queued writes and suppresses stale success', async () => {
 let current = false; let touched = false;
 const assertCurrent = () => { if (!current) throw new Error('scope changed'); };
 await assert.rejects(flushThingtimeSnapshot({ assertCurrent, drain: () => { touched = true; }, read: () => '', schedule() {}, flush: async () => {} }), /scope changed/);
 assert.equal(touched, false);
 current = true;
 await assert.rejects(flushThingtimeSnapshot({ assertCurrent, drain() {}, read: () => 'old owner', schedule() {}, flush: async () => { current = false; } }), /scope changed/);
});
