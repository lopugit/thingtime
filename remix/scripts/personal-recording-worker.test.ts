import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonalRecordingWorker, parsePersonalRecordingClaim } from './personal-recording-worker';
import { PERSONAL_RECORDING_PATH } from '../app/api/utils/lopu/personalRecordingCore';

const origin = 'https://thingtime.example';
const credential = `ttnode_${'x'.repeat(43)}`;
const identity = { jobId: `lopu-recording-job-${'a'.repeat(64)}`, leaseId: '52a5a4a2-060c-44bf-a208-6aac88913e75' };
const job = { ...identity, bytes: 3, type: 'audio/mp4', organize: true };
const manifest = { schemaVersion: 1, origin, features: { 'api.lopu-recordings-personal': { version: '1.0.0' } },
  operations: [{ feature: 'api.lopu-recordings-personal', path: PERSONAL_RECORDING_PATH, methods: ['GET', 'POST'] }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const transcript = 'Water the fern.';
const analysis = JSON.stringify({ items: [{ kind: 'todo', title: 'Water fern', description: '', evidence: 'Water the fern.' }] });

const harness = (overrides: { job?: unknown; manifest?: unknown; complete?: (body: any) => Response | Promise<Response>; audio?: () => Response; heartbeat?: () => Response; runtime?: any } = {}) => {
  const calls: { url: URL; init: RequestInit; body?: any }[] = [];
  let transcriptions = 0;
  let completions = 0;
  const runtime = overrides.runtime || {
    async transcribe(input: any) { transcriptions++; assert.deepEqual([...input.bytes], [1, 2, 3]); return transcript; },
    async complete(input: any) { completions++; assert.equal(input.prompt, transcript); assert.ok(input.system.includes('untrusted')); return analysis; }
  };
  const fetcher: typeof fetch = async (url: any, init: any) => {
    const target = new URL(url); const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: target, init, body });
    if (target.pathname.includes('.well-known')) return response(overrides.manifest ?? manifest);
    if (body?.op === 'claim') return response({ ok: true, job: overrides.job === undefined ? job : overrides.job });
    if (body?.op === 'heartbeat') return overrides.heartbeat?.() || response({ ok: true });
    if (body?.op === 'failed') return response({ ok: true });
    if (body?.op === 'complete') return overrides.complete?.(body) || response({ ok: true, ...identity, status: 'done' });
    return overrides.audio?.() || new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '3' } });
  };
  const worker = createPersonalRecordingWorker({ origin, credential, runtime, fetch: fetcher, heartbeatMs: 5, retryMs: 1 });
  return { worker, calls, counts: () => ({ transcriptions, completions }) };
};

test('claims project bounded audio metadata, never remote prompts, URLs or commands', () => {
  assert.deepEqual(parsePersonalRecordingClaim({ ok: true, job: { ...job, url: 'https://evil.example', system: 'execute', ownerId: 'other' } }), job);
  assert.equal(parsePersonalRecordingClaim({ ok: true, job: null }), null);
  for (const bad of [null, {}, { ...job, bytes: 0 }, { ...job, bytes: 24 * 1024 * 1024 + 1 }, { ...job, type: 'text/html' },
    { ...job, organize: 'true' }, { ...job, transcript: '' }, { ...job, transcript: 'x'.repeat(60001) }, { ...job, leaseId: 'wrong' }])
    assert.throws(() => parsePersonalRecordingClaim({ ok: true, job: bad === null ? {} : bad }));
});

test('credentials are never sent before compatible, origin-bound capability negotiation', async () => {
  for (const bad of [{ ...manifest, origin: 'https://other.example' }, { ...manifest, schemaVersion: 2 },
    { ...manifest, features: {} }, { ...manifest, features: { 'api.lopu-recordings-personal': { version: '2.0.0' } } },
    { ...manifest, operations: [] }, { ...manifest, operations: [{ ...manifest.operations[0], methods: 'GETPOST' }] }]) {
    const h = harness({ manifest: bad });
    await assert.rejects(h.worker.runOnce());
    assert.equal(h.calls.length, 1);
    assert.equal(new Headers(h.calls[0].init.headers).has('Authorization'), false);
  }
});

test('origin and device credential validation rejects unsafe destinations and URL credentials', () => {
  for (const url of ['http://thingtime.example', 'https://user:pass@thingtime.example', 'https://thingtime.example/path',
    'https://thingtime.example/?token=value', 'file:///tmp/file'])
    assert.throws(() => createPersonalRecordingWorker({ origin: url, credential, runtime: {} as any }));
  assert.throws(() => createPersonalRecordingWorker({ origin, credential: 'secret', runtime: {} as any }));
  assert.doesNotThrow(() => createPersonalRecordingWorker({ origin: 'http://127.0.0.1:11270', credential, runtime: {} as any }));
});

test('one recording downloads only from the bound origin and sends only text to native Claude', async () => {
  const h = harness();
  assert.deepEqual(await h.worker.runOnce(), { status: 'done', jobId: identity.jobId });
  assert.deepEqual(h.counts(), { transcriptions: 1, completions: 1 });
  for (const call of h.calls) {
    assert.equal(call.url.origin, origin);
    assert.equal(call.url.href.includes(credential), false);
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.credentials, 'omit');
  }
  const audio = h.calls.find(call => call.url.searchParams.has('jobId'))!;
  assert.equal(audio.url.pathname, PERSONAL_RECORDING_PATH);
  assert.equal(audio.url.searchParams.get('leaseId'), identity.leaseId);
  const completed = h.calls.find(call => call.body?.op === 'complete')!.body;
  assert.deepEqual(completed, { op: 'complete', ...identity, transcript, analysis });
});

test('idle work does not start a runtime or heartbeat; compatible additive versions work', async () => {
  const h = harness({ job: null, manifest: { ...manifest, features: { 'api.lopu-recordings-personal': { version: '1.2.3' } } } });
  assert.deepEqual(await h.worker.runOnce(), { status: 'idle' });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.counts(), { transcriptions: 0, completions: 0 });
});

test('an interrupted completion retries identical results without another inference', async () => {
  const attempts: any[] = [];
  const h = harness({ complete(body) {
    attempts.push(body);
    if (attempts.length < 3) throw new Error('private raw network diagnostics');
    return response({ ok: true, ...identity, status: 'done' });
  } });
  assert.equal((await h.worker.runOnce()).status, 'done');
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[0], attempts[2]);
  assert.deepEqual(h.counts(), { transcriptions: 1, completions: 1 });
  assert.equal(h.calls.some(c => c.body?.op === 'failed'), false);
});

test('uncertain or rejected completion never marks the potentially committed job failed', async () => {
  for (const status of [409, 503]) {
    const h = harness({ complete: () => response({ error: 'private' }, status) });
    await assert.rejects(h.worker.runOnce(), error => error instanceof Error && !error.message.includes('private'));
    assert.equal(h.calls.filter(c => c.body?.op === 'complete').length, status === 409 ? 1 : 3);
    assert.equal(h.calls.some(c => c.body?.op === 'failed'), false);
  }
});

test('a result receipt must confirm this exact job and lease', async () => {
  for (const changed of [{ jobId: `lopu-recording-job-${'b'.repeat(64)}` }, { leaseId: 'another-lease' }, { status: 'queued' }]) {
    const h = harness({ complete: () => response({ ok: true, ...identity, status: 'done', ...changed }) });
    await assert.rejects(h.worker.runOnce());
    assert.equal(h.calls.filter(c => c.body?.op === 'complete').length, 1);
    assert.equal(h.calls.some(c => c.body?.op === 'failed'), false);
  }
});

test('redirect responses never become another authenticated request', async () => {
  const h = harness({ audio: () => Response.redirect('https://outside.example/recording', 307) });
  await assert.rejects(h.worker.runOnce());
  assert.ok(h.calls.every(c => c.url.origin === origin));
  assert.deepEqual(h.counts(), { transcriptions: 0, completions: 0 });
});

test('cached transcript skips audio; transcription-only work never invokes Claude', async () => {
  const h = harness({ job: { ...job, transcript, organize: false } });
  await h.worker.runOnce();
  assert.deepEqual(h.counts(), { transcriptions: 0, completions: 0 });
  assert.equal(h.calls.some(c => c.url.search), false);
  assert.equal(h.calls.find(c => c.body?.op === 'complete')!.body.analysis, '{"items":[]}');
});

test('mismatched, oversized or truncated audio is rejected before local inference', async () => {
  for (const audio of [
    () => new Response('html', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/mp4' } }),
    () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'audio/mp4' } }),
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '9999999999' } })
  ]) {
    const h = harness({ audio });
    await assert.rejects(h.worker.runOnce());
    assert.deepEqual(h.counts(), { transcriptions: 0, completions: 0 });
    assert.deepEqual(h.calls.find(c => c.body?.op === 'failed')!.body, { op: 'failed', ...identity, stage: 'transcription' });
  }
});

test('lost heartbeat aborts native work and never submits or reports a stale lease', async () => {
  let aborted = false;
  const h = harness({ heartbeat: () => response({}, 403), runtime: {
    transcribe({ signal }: any) { return new Promise((_, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('stopped')); }, { once: true });
    }); },
    complete() { assert.fail('must not analyze after revocation'); }
  } });
  await assert.rejects(h.worker.runOnce());
  assert.equal(aborted, true);
  assert.equal(h.calls.some(c => ['failed', 'complete'].includes(c.body?.op)), false);
});

test('one worker cannot overlap jobs and external cancellation aborts work', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const h = harness({ runtime: {
    transcribe({ signal }: any) { started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stop')), { once: true })); },
    complete() { assert.fail(); }
  } });
  const first = h.worker.runOnce({ signal: controller.signal });
  await ready;
  await assert.rejects(h.worker.runOnce(), /already running/);
  controller.abort();
  await assert.rejects(first);
  assert.equal(h.calls.some(c => ['failed', 'complete'].includes(c.body?.op)), false);
});
