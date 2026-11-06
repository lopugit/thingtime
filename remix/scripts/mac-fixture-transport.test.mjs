import test from 'node:test';
import assert from 'node:assert/strict';
import { MacFixtureTransport, FixtureIdentityTiming, FixturePageObservers, validateFixtureProofKind, FixtureReceiptObservations, validateFixtureWorkerParity } from './mac-fixture-transport.mjs';
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

test('durable confirmation returns while proof is held; drain owns all observations', async () => {
  const proof = new FixtureReceiptObservations(); let release, observed = false, claimed = false;
  const held = new Promise(resolve => { release = resolve; });
  const confirm = () => proof.confirm('receipt-1', async () => ({ committed: true }), () => held.then(() => { observed = true; }));
  assert.deepEqual(await confirm(), { committed: true }); claimed = true;
  let drained = false; const drain = proof.drain().then(() => { drained = true; }); await Promise.resolve();
  assert.equal(claimed, true); assert.equal(observed, false); assert.equal(drained, false);
  release(); await drain; assert.equal(observed, true); assert.equal(proof.pending.size, 0);
});
test('out-of-order observations retain own receipt and failure is raced then drained once', async () => {
  const proof = new FixtureReceiptObservations(), completed = []; let first;
  const held = new Promise(resolve => { first = resolve; });
  proof.schedule('first', () => held.then(() => completed.push('first')));
  proof.schedule('second', () => { completed.push('second'); });
  first(); await proof.drain(); assert.deepEqual(completed, ['second', 'first']);
  assert.throws(() => proof.schedule('first', () => {}), /Duplicate/);
  const failed = new FixtureReceiptObservations(), error = Error('controlled proof refusal');
  failed.schedule('bad', () => { throw error; });
  await assert.rejects(failed.failed, e => e === error); await assert.rejects(failed.drain(), e => e === error);
  assert.equal(failed.errors.length, 1); assert.equal(failed.pending.size, 0);
});

test('failed durable confirmation never registers a proof and barrier time is captured after commit', async () => {
  let clock = 10, observedAt; const proof = new FixtureReceiptObservations(() => clock);
  await assert.rejects(proof.confirm('failed', async () => { throw Error('commit refused'); }, () => { throw Error('must not observe'); }), /commit refused/);
  assert.equal(proof.registered.size, 0);
  assert.equal(await proof.confirm('saved', async () => { clock = 20; return 'receipt'; }, (receipt, at) => { assert.equal(receipt, 'receipt'); observedAt = at; }), 'receipt');
  await proof.drain(); assert.equal(observedAt, 20);
});

test('per-call diagnostics retain closed identity and end once on cancellation/EOF', async () => {
  const events = [], transport = new MacFixtureTransport({ write: () => {}, createStream: () => {}, observeRequest: event => events.push(event) });
  const controller = new AbortController(), pending = transport.request({ requestId: 'safe-id', action: 'inspect', path: 'private-name-must-not-leak' }, controller.signal);
  await turn(); controller.abort(Error('private-reason')); await assert.rejects(pending);
  transport.close(); transport.close();
  assert.deepEqual(events.map(e => e.phase), ['enqueue','start','cancel','end']);
  assert.equal(events.at(-1).outcome, 'cancelled');
  assert.ok(events.every(e => e.requestId === 'safe-id' && e.path === 'other'));
  assert.equal(JSON.stringify(events).includes('private'), false);
});

const callbackFrame = (requestId, callbackId, frame = { kind: 'chunk', ordinal: 0, data: 'private-bytes' }) =>
  ({ type: 'batch', requestId, callbackId, frame, nativeEmittedMs: 123 });
test('duplex replies bypass the held lane and out-of-order callbacks keep request identity', async () => {
  const f = fixture(), callbacks = new Map();
  const active = f.transport.request({ requestId: 'upload', action: 'upload-single' }, undefined,
    { onBatchFrame: frame => new Promise(resolve => callbacks.set(frame.ordinal, resolve)) });
  const poll = f.transport.request({ requestId: 'poll', action: 'scan-changes' });
  const next = f.transport.request({ requestId: 'next', action: 'inspect' });
  await turn(); f.transport.receive(callbackFrame('upload', 1)); f.transport.receive(callbackFrame('upload', 2, { kind: 'chunk', ordinal: 1 }));
  callbacks.get(1)({ status: 'second' }); await turn(); callbacks.get(0)({ status: 'first' }); await turn();
  assert.deepEqual(f.sent.filter(x => x.action === 'fixture-batch-reply').map(x => [x.requestId,x.callbackId,x.reply.status]), [['upload',2,'second'],['upload',1,'first']]);
  assert.equal(f.sent.some(x => x.requestId === 'next'), false);
  f.reply('poll'); await poll; f.reply('upload'); await active; await turn(); f.reply('next'); await next;
});
test('duplex unknown requests and replayed callback IDs cannot invoke another callback', async () => {
  const f = fixture(); let calls = 0;
  const active = f.transport.request({ requestId: 'upload', action: 'upload-single' }, undefined,
    { onBatchFrame: () => { calls++; return new Promise(() => {}); } });
  const rejected = assert.rejects(active);
  await turn(); assert.throws(() => f.transport.receive(callbackFrame('wrong-request',1)), /identity/);
  assert.equal(calls,0); f.transport.receive(callbackFrame('upload',1));
  assert.throws(() => f.transport.receive(callbackFrame('upload',1)), /callback/); assert.equal(calls,1);
  f.transport.close(); await rejected;
});
test('duplex cancellation aborts callback once and holds lane through late batch frames until native ACK', async () => {
  const f = fixture(), controller = new AbortController(); let aborted = 0, release;
  const active = f.transport.request({ requestId: 'upload', action: 'upload-single' }, controller.signal,
    { onBatchFrame: (_frame, signal) => { signal.addEventListener('abort', () => aborted++, { once: true }); return new Promise(resolve => { release = resolve; }); } });
  const rejected = assert.rejects(active), next = f.transport.request({ requestId: 'next', action: 'read' });
  await turn(); f.transport.receive(callbackFrame('upload',1)); controller.abort(); await rejected;
  f.transport.receive(callbackFrame('upload',2)); release({ status: 'late' }); await turn();
  assert.equal(aborted,1); assert.equal(f.sent.some(x => x.action === 'fixture-batch-reply'),false);
  assert.equal(f.sent.some(x => x.requestId === 'next'),false);
  f.transport.receive({ requestId: 'upload', ok: false }); await turn(); f.reply('next'); await next;
});
test('duplex EOF rejects all relevant pending work once, aborts callback and redacts diagnostics', async () => {
  const sent = [], events = []; let release, aborted = 0;
  const transport = new MacFixtureTransport({ write: frame => sent.push(frame), createStream: () => {}, observeRequest: event => events.push(event) });
  const active = transport.request({ requestId: 'upload', action: 'upload-single' }, undefined,
    { onBatchFrame: (_frame, signal) => { signal.addEventListener('abort', () => aborted++, { once: true }); return new Promise(resolve => { release = resolve; }); } });
  const other = transport.request({ requestId: 'other', action: 'read' });
  const rejected = Promise.all([assert.rejects(active),assert.rejects(other)]);
  await turn(); transport.receive(callbackFrame('upload',1)); const count = sent.length;
  transport.close(Error('private-error')); transport.close(); await rejected; release({ status: 'late' }); await turn();
  assert.equal(aborted,1); assert.equal(sent.length,count); assert.equal(JSON.stringify(events).includes('private'),false);
  assert.equal(events.filter(x => x.requestId === 'upload' && x.phase === 'end').length,1);
});
test('duplex callback authority refusal cancels only its operation and waits for native ACK', async () => {
  const f = fixture();
  const active = f.transport.request({ requestId: 'upload', action: 'upload-single' }, undefined,
    { onBatchFrame: async () => { throw Error('controlled authority refusal'); } });
  const rejected = assert.rejects(active, /authority refusal/), next = f.transport.request({ requestId: 'next', action: 'inspect' });
  await turn(); f.transport.receive(callbackFrame('upload',1)); await rejected; await turn();
  assert.equal(f.sent.filter(x => x.action === 'fixture-cancel').length,1);
  assert.equal(f.sent.some(x => x.action === 'fixture-batch-reply' || x.requestId === 'next'),false);
  f.transport.receive({ requestId: 'upload', ok: false }); await turn(); f.reply('next'); await next;
});

test('requested canonical worker proof refuses legacy or missing transport parity', () => {
  const legacy = { parity: { nativeOperationGuards: false } };
  assert.equal(validateFixtureWorkerParity(legacy, false), legacy);
  assert.throws(() => validateFixtureWorkerParity(legacy, true), /canonical worker/);
  const current = { parity: { canonicalDesktopManager: true, canonicalRendererHost: true, canonicalTransferWorkerSelected: true, nativeOperationGuards: true } };
  assert.equal(validateFixtureWorkerParity(current, true), current);
  for (const key of Object.keys(current.parity)) assert.throws(() => validateFixtureWorkerParity({ parity: { ...current.parity, [key]: false } }, true), /canonical worker/);
});

test('requested streaming two-way proof requires actual feeds, async capture and deletions off', () => {
  const parity = { canonicalDesktopManager: true, canonicalRendererHost: true, canonicalTransferWorkerSelected: true, nativeOperationGuards: true };
  assert.throws(() => validateFixtureWorkerParity({ parity }, true, true), /streaming two-way/);
  const streaming = { ...parity, streamingTwoWay: true, localFeed: true, remoteFeed: true, strictAsyncCapture: true, propagateDeletes: false };
  const current = { parity: streaming };
  assert.equal(validateFixtureWorkerParity(current, true, true), current);
  for (const key of ['streamingTwoWay', 'localFeed', 'remoteFeed', 'strictAsyncCapture'])
    assert.throws(() => validateFixtureWorkerParity({ parity: { ...streaming, [key]: false } }, true, true), /streaming two-way/);
  assert.throws(() => validateFixtureWorkerParity({ parity: { ...streaming, propagateDeletes: true } }, true, true), /streaming two-way/);
});
