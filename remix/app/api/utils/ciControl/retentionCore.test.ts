import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CI_RETENTION_ENV,
  DEFAULT_CI_RETENTION_DAYS,
  MAX_CI_RETENTION_DAYS,
  ciExpiresAt,
  ciRetentionClass,
  ciRetentionPolicy,
  describeCiRetention
} from './retentionCore';

const DAY_MS = 24 * 60 * 60 * 1000;

test('retention classes: events, job projections, activity, and permanent entities', () => {
  assert.equal(ciRetentionClass('ci-event'), 'event');
  assert.equal(ciRetentionClass('ci-workflow-run', 'job:123'), 'job');
  assert.equal(ciRetentionClass('ci-workflow-run', '123'), 'activity');
  assert.equal(ciRetentionClass('ci-workflow-run', null), 'activity');
  assert.equal(ciRetentionClass('ci-deployment', '9'), 'activity');
  assert.equal(ciRetentionClass('ci-preview', 'dpl_x'), 'activity');
  for (const permanent of [
    'ci-repository',
    'ci-automation',
    'ci-feature',
    'ci-feature-stack',
    'ci-feature-stack-entry',
    'ci-branch',
    'ci-pull-request',
    'ci-preview-policy',
    'ci-dispatch'
  ]) {
    assert.equal(ciRetentionClass(permanent, 'x'), 'permanent', permanent);
  }
});

test('defaults apply when the env is unset, blank, or malformed', () => {
  const expected = {
    eventDays: DEFAULT_CI_RETENTION_DAYS.event,
    jobDays: DEFAULT_CI_RETENTION_DAYS.job,
    activityDays: DEFAULT_CI_RETENTION_DAYS.activity
  };
  assert.deepEqual(ciRetentionPolicy({}), expected);
  assert.deepEqual(
    ciRetentionPolicy({
      [CI_RETENTION_ENV.event]: '  ',
      [CI_RETENTION_ENV.job]: 'thirty',
      [CI_RETENTION_ENV.activity]: '-5'
    }),
    expected
  );
});

test('env overrides are clamped, and an explicit 0 keeps a class forever', () => {
  const policy = ciRetentionPolicy({
    [CI_RETENTION_ENV.event]: '7',
    [CI_RETENTION_ENV.job]: '0',
    [CI_RETENTION_ENV.activity]: '99999'
  });
  assert.deepEqual(policy, { eventDays: 7, jobDays: null, activityDays: MAX_CI_RETENTION_DAYS });
});

test('expiresAt is measured from the row base time per class; permanent rows get null', () => {
  const base = new Date('2026-09-01T00:00:00.000Z');
  const policy = ciRetentionPolicy({});
  assert.equal(ciExpiresAt('ci-event', null, base, policy)?.getTime(), base.getTime() + DEFAULT_CI_RETENTION_DAYS.event * DAY_MS);
  assert.equal(ciExpiresAt('ci-workflow-run', 'job:1', base, policy)?.getTime(), base.getTime() + DEFAULT_CI_RETENTION_DAYS.job * DAY_MS);
  assert.equal(ciExpiresAt('ci-workflow-run', '1', base, policy)?.getTime(), base.getTime() + DEFAULT_CI_RETENTION_DAYS.activity * DAY_MS);
  assert.equal(ciExpiresAt('ci-pull-request', '1', base, policy), null);
  assert.equal(ciExpiresAt('ci-event', null, base, { ...policy, eventDays: null }), null);
});

test('an invalid base date falls back to now rather than producing an invalid stamp', () => {
  const before = Date.now();
  const stamp = ciExpiresAt('ci-event', null, new Date('not a date'), ciRetentionPolicy({}));
  assert.ok(stamp instanceof Date && Number.isFinite(stamp.getTime()));
  assert.ok(stamp!.getTime() >= before + DEFAULT_CI_RETENTION_DAYS.event * DAY_MS);
});

test('the operator summary names the env knobs beside the effective windows', () => {
  const summary = describeCiRetention(ciRetentionPolicy({ [CI_RETENTION_ENV.event]: '3' }));
  assert.equal(summary.eventDays, 3);
  assert.equal(summary.env.event, 'THINGTIME_CI_EVENT_RETENTION_DAYS');
  assert.equal(summary.env.job, 'THINGTIME_CI_JOB_RETENTION_DAYS');
  assert.equal(summary.env.activity, 'THINGTIME_CI_ACTIVITY_RETENTION_DAYS');
});
