import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createScheduledRunReporter, deliverScheduledRunEvent, SCHEDULED_HTTP_JOBS, type ScheduledRunEvent } from './scheduledRunReporting';
const path = '/api/v1/peers/sync';
const secret = 'synthetic-scheduler-secret';
const request = (authorization = `Bearer ${secret}`, method = 'GET', signal?: AbortSignal) => new Request('https://scheduled.test'+path, { method, headers: { Authorization: authorization }, signal });
const setup = () => {
  const events: ScheduledRunEvent[] = [];
  const report = createScheduledRunReporter({ sink: async event => { events.push(event); }, getSecret: () => secret });
  return { events, report };
};
test('every configured platform cron has exactly one fixed reporting descriptor', () => {
  const deployed = JSON.parse(readFileSync(new URL('../../../../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(SCHEDULED_HTTP_JOBS.map(job => job.path).sort(), deployed.crons.map((job: any) => job.path).sort());
  assert.equal(new Set(SCHEDULED_HTTP_JOBS.map(job => job.path)).size, SCHEDULED_HTTP_JOBS.length);
});
test('only exact scheduler-authenticated registered GET invocations produce events', async () => {
  const { events, report } = setup();
  for (const req of [request(''), request(secret), request('Bearer '+secret+'extra'), request('Bearer '+secret, 'POST'), request('Bearer '+secret, 'HEAD')]) {
    const response = await report(req, path, async () => new Response('ordinary action'));
    assert.equal(await response.text(), 'ordinary action');
  }
  await report(request(), '/api/v1/not-a-scheduled-job', async () => new Response(null, { status: 204 }));
  const unconfigured = createScheduledRunReporter({ getSecret: () => undefined, sink: async event => { events.push(event); } });
  await unconfigured(request(), path, async () => new Response(null, { status: 204 }));
  assert.deepEqual(events, []);
});
test('consumed success retains bytes/headers and emits safe lifecycle with one UUID', async () => {
  const { events, report } = setup();
  const response = await report(request(), path, async () => new Response('private-response-body', { headers: { 'X-Private': 'private-header' } }));
  assert.deepEqual(events.map(event => event.status), ['started']);
  assert.equal(await response.text(), 'private-response-body');
  assert.equal(response.headers.get('X-Private'), 'private-header');
  assert.deepEqual(events.map(event => event.status), ['started', 'completed']);
  assert.match(events[0].runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(events[0].runId, events[1].runId); assert.equal(events[1].httpCode, 200);
  assert.deepEqual(Object.keys(events[1]).sort(), ['httpCode','jobName','observedAt','path','runId','scope','startedAt','status']);
  for (const forbidden of [secret,'private-response-body','private-header','Authorization']) assert.equal(JSON.stringify(events).includes(forbidden), false);
  assert.ok(Number.isFinite(Date.parse(events[1].observedAt)));
});
test('HTTP failure and thrown handler failure retain original outcomes and omit raw errors', async () => {
  const { events, report } = setup();
  assert.equal((await report(request(), path, async () => new Response(null,{status:503}))).status,503);
  assert.equal(events.at(-1)?.status,'failed'); assert.equal(events.at(-1)?.httpCode,503);
  const failure = new Error('raw provider password/token failure');
  await assert.rejects(report(request(), path, async () => { throw failure; }), error => error === failure);
  assert.equal(events.at(-1)?.status,'failed'); assert.equal(events.at(-1)?.httpCode,500);
  assert.equal(JSON.stringify(events).includes(failure.message),false);
});
test('stream completion waits for terminal consumption, including asynchronous work', async () => {
  const { events, report } = setup(); let release!: () => void;
  const done = new Promise<void>(resolve => { release=resolve; }); let index=0;
  const response=await report(request(),path,async()=>new Response(new ReadableStream({async pull(controller) {
    if(index++===0) controller.enqueue(new TextEncoder().encode('line\n'));
    else { await done; controller.close(); }
  }},{highWaterMark:0})));
  const reader=response.body!.getReader(); await reader.read();
  assert.deepEqual(events.map(event=>event.status),['started']);
  const terminal=reader.read(); release(); await terminal;
  assert.deepEqual(events.map(event=>event.status),['started','completed']);
});
test('stream cancellation cancels upstream and reports once without leaking the reason', async () => {
  const { events, report } = setup(); let cancelled=false;
  const response=await report(request(),path,async()=>new Response(new ReadableStream({
    pull(controller){controller.enqueue(new Uint8Array([1]));}, cancel(){cancelled=true;}
  },{highWaterMark:0})));
  const reader=response.body!.getReader(); await reader.read(); await reader.cancel('private cancellation token');
  assert.equal(cancelled,true); assert.deepEqual(events.map(event=>event.status),['started','cancelled']);
  assert.equal(JSON.stringify(events).includes('private cancellation'),false);
});
test('stream failure propagates to consumer and records failed rather than complete', async () => {
  const { events, report } = setup(); const failure=new Error('private stream body failure');
  const response=await report(request(),path,async()=>new Response(new ReadableStream({pull(){throw failure;}},{highWaterMark:0})));
  await assert.rejects(response.text(),error=>error===failure);
  assert.deepEqual(events.map(event=>event.status),['started','failed']);
  assert.equal(JSON.stringify(events).includes(failure.message),false);
});
test('reporting refusal or unavailability never changes the original work', async () => {
  let calls=0;
  const report=createScheduledRunReporter({getSecret:()=>secret,sink:async()=>{throw new Error('private sink failure');}});
  const response=await report(request(),path,async()=>{calls++;return new Response('job outcome');});
  assert.equal(await response.text(),'job outcome'); assert.equal(calls,1);
  assert.equal(await deliverScheduledRunEvent({runId:'id',jobName:SCHEDULED_HTTP_JOBS[0].name,path:SCHEDULED_HTTP_JOBS[0].path,status:'started',httpCode:null,startedAt:'now',observedAt:'now'}),'unavailable');
});
test('aborted handler reports cancellation while retaining the original thrown error', async () => {
  const { events, report } = setup(); const abort=new AbortController(); const failure=new Error('cancelled handler');
  await assert.rejects(report(request(undefined,'GET',abort.signal),path,async()=>{abort.abort();throw failure;}), error=>error===failure);
  assert.deepEqual(events.map(event=>event.status),['started','cancelled']);
});

test('cancelling a pending read cannot race into a completed status', async () => {
  const { events, report } = setup();
  let readStarted!: () => void;
  const started = new Promise<void>(resolve => { readStarted = resolve; });
  const response = await report(request(), path, async () => new Response(new ReadableStream({
    pull() { readStarted(); }
  }, { highWaterMark: 0 })));
  const reader = response.body!.getReader();
  const read = reader.read(); await started;
  await reader.cancel('private cancellation'); await read;
  assert.deepEqual(events.map(event => event.status), ['started', 'cancelled']);
});
