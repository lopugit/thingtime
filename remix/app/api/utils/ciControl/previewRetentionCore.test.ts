import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PREVIEW_RETENTION, parsePreviewRetentionPolicy, validPreviewRetentionRead } from './previewRetentionCore';

test('retention defaults clean orphan deployments while live PR expiry is opt-in', () => {
  assert.deepEqual(parsePreviewRetentionPolicy(DEFAULT_PREVIEW_RETENTION), DEFAULT_PREVIEW_RETENTION);
  assert.equal(DEFAULT_PREVIEW_RETENTION.enabled, true);
  assert.equal(DEFAULT_PREVIEW_RETENTION.noOpenPrGraceHours, 0);
  assert.equal(DEFAULT_PREVIEW_RETENTION.pruneSupersededOpenPr, false);
  assert.equal(DEFAULT_PREVIEW_RETENTION.inactivePullRequestDays, null);
});
test('rejects malformed stored policies instead of silently restoring cleanup authority', () => {
  for (const policy of [null, {}, { ...DEFAULT_PREVIEW_RETENTION, version: 2 }, { ...DEFAULT_PREVIEW_RETENTION, enabled: 'true' },
    { ...DEFAULT_PREVIEW_RETENTION, noOpenPrGraceHours: -1 }, { ...DEFAULT_PREVIEW_RETENTION, supersededGraceHours: 1.5 },
    { ...DEFAULT_PREVIEW_RETENTION, inactivePullRequestDays: 0 }, { ...DEFAULT_PREVIEW_RETENTION, inactivePullRequestDays: Infinity },
    { ...DEFAULT_PREVIEW_RETENTION, inactivePullRequestDays: Number.MAX_SAFE_INTEGER }]) assert.throws(() => parsePreviewRetentionPolicy(policy));
  assert.equal(parsePreviewRetentionPolicy({ ...DEFAULT_PREVIEW_RETENTION, noOpenPrGraceHours: 100000 }).noOpenPrGraceHours, 100000);
  assert.equal(parsePreviewRetentionPolicy({ ...DEFAULT_PREVIEW_RETENTION, hidden: 'secret' } as any).hasOwnProperty('hidden'), false);
});
test('controller read binds the repository, protected ref and request freshness', () => {
  const now = Date.now();
  const body = { repository: 'lopugit/thingtime', ref: 'github-actions', requestedAt: new Date(now).toISOString() };
  assert.equal(validPreviewRetentionRead(body, body.repository, now), true);
  for (const update of [{ repository: 'attacker/fork' }, { ref: 'main' }, { requestedAt: new Date(now - 601000).toISOString() }, { requestedAt: 'invalid' }])
    assert.equal(validPreviewRetentionRead({ ...body, ...update }, body.repository, now), false);
});
