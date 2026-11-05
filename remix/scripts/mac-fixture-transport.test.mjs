import test from 'node:test';
import assert from 'node:assert/strict';
import { MacFixtureTransport, FixtureIdentityTiming, FixturePageObservers, validateFixtureProofKind } from './mac-fixture-transport.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const sent = [];
  let now = 0;
  const transport = new MacFixtureTransport({
    write: frame => sent.push(JSON.parse(frame.subarray(4, 4 + frame.readUInt32BE(0)).toString())),
    createStream: () => { throw Error('Unexpected stream'); }, now: () => now
  });
  const reply = (requestId, result = requestId) => transport.receive({ requestId, ok: true, result });
  return { transport, sent, reply, advance: ms => { now += ms; } };
}
test('held polling does not block inspect/read; out-of-order replies retain identity', async () => {
  const f = fixture();
  const poll = f.transport.request({ requestId: 'poll', action: 'scan-changes' });
  const inspect = f.transport.request({ requestId: 'inspect', action: 'inspect' });
  const read = f.transport.request({ requestId: 'read', action: 'read' });
  await turn(); assert.deepEqual(f.sent.map(r => r.requestId), ['poll', 'inspect']);
  f.advance(12); f.reply('inspect', { inspected: true });
  assert.deepEqual(await inspect, { inspected: true });
  await turn(); assert.equal(f.sent.at(-1).requestId, 'read');
  f.advance(5); f.reply('read', { bytes: 65537 }); assert.deepEqual(await read, { bytes: 65537 });
  f.reply('poll', { changes: [] }); assert.deepEqual(await poll, { changes: [] });
  assert.equal(f.transport.timings.read.queueTotalMs, 12);
  assert.equal(f.transport.timings.inspect.serviceTotalMs, 12);
  assert.equal(f.transport.timings.read.serviceTotalMs, 5);
});
test('cancelling an active request preserves its lane until manager acknowledges', async () => {
  const f = fixture(), abort = new AbortController();
  let rejections = 0;
  const first = f.transport.request({ requestId: 'first', action: 'inspect' }, abort.signal).catch(() => { rejections++; });
  const next = f.transport.request({ requestId: 'next', action: 'read' });
  await turn(); abort.abort(); await first; await turn();
  assert.equal(rejections, 1); assert.deepEqual(f.sent.map(r => r.action), ['inspect', 'fixture-cancel']);
  f.transport.receive({ requestId: 'first', ok: false }); await turn();
  assert.equal(f.sent.at(-1).requestId, 'next'); f.reply('next'); await next;
  f.transport.receive({ requestId: 'first', ok: false }); assert.equal(rejections, 1);
});
test('cancelled queued work cannot release an earlier active request', async () => {
  const f = fixture(), abort = new AbortController();
  const first = f.transport.request({ requestId: 'first', action: 'inspect' });
  const cancelled = f.transport.request({ requestId: 'cancelled', action: 'read' }, abort.signal);
  const rejection = assert.rejects(cancelled);
  const last = f.transport.request({ requestId: 'last', action: 'publish' });
  abort.abort(); await rejection; await turn();
  assert.deepEqual(f.sent.map(r => r.requestId), ['first']);
  f.reply('first'); await first; await turn();
  assert.deepEqual(f.sent.map(r => r.requestId), ['first', 'last']); f.reply('last'); await last;
});
test('EOF rejects active, polling and queued requests once and prevents more writes', async () => {
  const f = fixture(); let failures = 0;
  const requests = ['inspect', 'scan-changes', 'read'].map((action, i) =>
    f.transport.request({ requestId: String(i), action }).catch(() => { failures++; }));
  await turn(); f.transport.close(Error('EOF')); f.transport.close(Error('second EOF'));
  await Promise.all(requests); await turn(); assert.equal(failures, 3); assert.equal(f.sent.length, 2);
  await assert.rejects(f.transport.request({ requestId: 'late', action: 'read' }), /EOF/);
});
test('binary input is one frame and chunk responses use their request identity', async () => {
  const writes = [], chunks = [];
  const t = new MacFixtureTransport({ write: frame => writes.push(frame), createStream: () => ({
    write: bytes => chunks.push(JSON.parse(bytes.toString())), finish: () => ({ result: 'streamed' })
  }) });
  const stage = t.request({ requestId: 'stage', action: 'stage-range', bytes: Buffer.from([1,2,3]) });
  const poll = t.request({ requestId: 'poll', action: 'scan-changes' });
  await turn(); assert.equal(writes.length, 2);
  const length = writes[0].readUInt32BE(0); assert.deepEqual(writes[0].subarray(4 + length), Buffer.from([1,2,3]));
  t.receive({ requestId: 'stage', ok: true, result: 'staged' }); assert.equal(await stage, 'staged');
  const range = t.request({ requestId: 'range', action: 'read-range' }); await turn();
  t.receive({ requestId: 'range', type: 'chunk', offset: 0, data: 'AA==' });
  t.receive({ requestId: 'poll', ok: true, result: 'polled' }); assert.equal(await poll, 'polled');
  t.receive({ requestId: 'range', ok: true, result: {} }); assert.equal(await range, 'streamed');
  assert.equal(chunks[0].requestId, 'range'); assert.equal(chunks[1].response.id, 'range');
});

test('identity durations accumulate across sessions and ignore out-of-order counter samples', () => {
  const metric = new FixtureIdentityTiming();
  const first = metric.beginSession(); first({ totalMs: 100, maxMs: 60 });
  first({ totalMs: 80, maxMs: 50 }); first({ totalMs: 140, maxMs: 70 });
  assert.equal(metric.totalMs, 140); assert.equal(metric.maxMs, 70);
  const earlyBaseline = metric.totalMs;
  const second = metric.beginSession(); second({ totalMs: 30, maxMs: 20 });
  second({ totalMs: 10, maxMs: 10 }); second({ totalMs: 75, maxMs: 40 });
  assert.equal(metric.totalMs, 215); assert.equal(metric.maxMs, 70);
  assert.equal(metric.totalMs - earlyBaseline, 75);
  first({ totalMs: 160, maxMs: 70 }); // Old stdout can drain after a new child starts.
  second({ totalMs: 90, maxMs: 40 }); first({ totalMs: 150, maxMs: 60 });
  assert.equal(metric.totalMs, 250); assert.equal(metric.maxMs, 70);
});

test('receipt observers require a fresh shared feed page and cancel independently', async () => {
  let now = 1;
  const feed = new FixturePageObservers(() => now), active = new AbortController(), aborted = new AbortController();
  feed.publish({ sequence: 1 }); // Cached state cannot prove a later receipt.
  let settled = false;
  const first = feed.next(active.signal, 2).then(page => { settled = true; return page; });
  const second = feed.next(active.signal, 2);
  const cancelled = assert.rejects(feed.next(aborted.signal));
  aborted.abort(Error('Stopped proof')); await cancelled; await turn(); assert.equal(settled, false);
  feed.publish({ sequence: 'too-early' }); await turn(); assert.equal(settled, false);
  now = 3;
  const fresh = { id: 'same-capture', generation: 'same-generation', state: 'running', sequence: 2 };
  feed.publish(fresh);
  const observed = await first;
  assert.equal(observed.page, fresh); assert.equal((await second).page, fresh);
  assert.equal(observed.observedAt, 3); assert.equal(observed.sequence, 3);
  assert.equal(feed.waiters.size, 0);
});

test('upload-start diagnostic can never satisfy the original two-way proof mode', () => {
 const diagnostic = { proofKind: 'upload-start-diagnostic', twoWayAcceptance: false, download: { exercised: false } };
 assert.equal(validateFixtureProofKind(diagnostic, 'upload-start-diagnostic'), diagnostic);
 assert.throws(() => validateFixtureProofKind(diagnostic, 'two-way-before-seal'));
 assert.throws(() => validateFixtureProofKind({ ...diagnostic, twoWayAcceptance: true }, 'upload-start-diagnostic'));
 assert.throws(() => validateFixtureProofKind({ ...diagnostic, proofKind: 'two-way-before-seal', twoWayAcceptance: true }, 'two-way-before-seal'));
});
