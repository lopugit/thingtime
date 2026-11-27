import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { due } from './jobSchedules';
import { signedJobValid } from './scheduledDispatch';
import { defaultPolicy, SCHEDULED_HTTP_JOBS } from './scheduledJobs';
import { scheduledJobSecret, withVerifiedScheduledRequest } from './scheduledJobSecret';

const now = new Date('2026-11-22T22:00:00.000Z');
const secret = 'synthetic-controller-secret';
const origin = 'https://schedule.example';
const first = SCHEDULED_HTTP_JOBS[0];
function signed(path: string) {
  const message = ['thingtime-scheduled-job-v1', 'GET', origin, path, now.toISOString()].join('\n');
  return new Request(origin + path, { headers: { 'X-Thingtime-Schedule-Time': now.toISOString(),
    'X-Thingtime-CI-Signature': 'sha256=' + createHmac('sha256', secret).update(message).digest('hex') } });
}
test('job wakeups have one fixed daily hour and retain weekly summary', () => {
  const config = JSON.parse(readFileSync(new URL('../../../../../vercel.json', import.meta.url), 'utf8'));
  for (const job of SCHEDULED_HTTP_JOBS) {
    const rule = config.crons.find((entry: { path: string }) => entry.path === job.path);
    assert.match(rule.schedule, new RegExp('^\\d+ ' + job.hour + ' \\* \\* ' + (job.weekday === null ? '\\*' : '0') + '$'));
    assert(due(job, defaultPolicy(job), now));
    assert(!due(job, { ...defaultPolicy(job), hour: 23 }, now));
    assert(!due(job, { ...defaultPolicy(job), enabled: false }, now));
    assert.equal(due(job, defaultPolicy(job), new Date('2026-11-23T22:00:00Z')), job.weekday === null);
  }
});
test('signed dispatch binds origin, path, method and timestamp', () => {
  const r = signed(first.path);
  assert(signedJobValid(r, first.path, now, secret));
  assert(!signedJobValid(r, first.path, now, ''));
  assert(!signedJobValid(r, first.path, new Date(+now + 61_000), secret));
  for (const url of ['https://other.example' + first.path, origin + first.path + '?other', origin + '/other']) {
    assert(!signedJobValid(new Request(url, { headers: r.headers }), first.path, now, secret));
  }
  assert(!signedJobValid(new Request(r.url, { method: 'POST', headers: r.headers }), first.path, now, secret));
});
test('verified scheduler handoff is invocation-local and strips caller headers', async () => {
  const previous = scheduledJobSecret();
  const keys = await Promise.all([0, 1].map(async () => {
    let key: string | undefined;
    await withVerifiedScheduledRequest(signed(first.path), async req => {
      await new Promise(resolve => setImmediate(resolve));
      key = scheduledJobSecret();
      assert(key && key !== previous);
      assert.deepEqual([...req.headers.keys()], ['authorization']);
      assert.equal(req.headers.get('authorization'), 'Bearer ' + key);
      return new Response();
    });
    return key;
  }));
  assert.equal(new Set(keys).size, 2);
  assert.equal(scheduledJobSecret(), previous);
});
