import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { recoveryAttempt, recoverySourceIssue, previewWorkActive, reconcilePreviewInventory } from './preview-recovery.mjs';
import { publishPreviewNotifications } from './preview-comments.mjs';

const now = Date.parse('2026-09-05T08:00:00Z');
const source = { id: 123, event: 'schedule', head_branch: 'main', path: '.github/workflows/develop-pr-preview.yml',
  repository: { id: 1 }, head_repository: { id: 1 }, status: 'in_progress', created_at: new Date(now).toISOString() };
test('recovery provenance binds the fixed default-branch scheduled workflow, repository, run and expiry', () => {
  const config = { repositoryId: 1, defaultBranch: 'main' }, payload = { sourceRunId: 123 };
  assert.equal(recoverySourceIssue(source, payload, config, now), null);
  for (const changed of [{ id: 124 }, { event: 'pull_request' }, { head_branch: 'feature' },
    { path: '.github/workflows/other.yml' }, { head_repository: { id: 2 } }, { status: 'queued' }, { created_at: 'bad' }]) {
    assert.ok(recoverySourceIssue({ ...source, ...changed }, payload, config, now));
  }
  assert.equal(recoverySourceIssue(source, payload, config, now + 13 * 3600_000), 'expired');
});

test('recovery skips active preview workers and handoffs, but not inactive groups', async () => {
  const inactive = async () => { throw Object.assign(new Error('inactive'), { status: 404 }); };
  assert.equal(await previewWorkActive(inactive, 'example/project', 596), false);
  assert.equal(await previewWorkActive(async (path) => path.includes('handoff')
    ? { total_count: 1, group_members: [{ status: 'pending' }] } : { total_count: 0, group_members: [] }, 'example/project', 596), true);
  await assert.rejects(previewWorkActive(async () => ({ total_count: 2, group_members: [] }), 'example/project', 596), /Incomplete/);
  await assert.rejects(previewWorkActive(async () => { throw Object.assign(new Error('denied'), { status: 403 }); }, 'example/project', 596));
});

test('durable retry receipts impose a cooldown and three-attempt limit per exact-SHA deployment', () => {
  const receipt = (attempt, age) => ({ description: `Preview recovery requested (attempt ${attempt})`, created_at: new Date(now - age).toISOString() });
  assert.deepEqual(recoveryAttempt([], now), { allowed: true, attempt: 1 });
  assert.deepEqual(recoveryAttempt([receipt(1, 1000)], now), { allowed: false, reason: 'cooldown' });
  assert.deepEqual(recoveryAttempt([receipt(1, 3600_000)], now), { allowed: true, attempt: 2 });
  assert.deepEqual(recoveryAttempt([receipt(3, 3600_000)], now), { allowed: false, reason: 'retry-limit' });
  assert.throws(() => recoveryAttempt(Array(100).fill({}), now), /Incomplete/);
});

test('one broken PR does not prevent the rest of the scheduled inventory from being inspected', async () => {
  const visited = [];
  await assert.rejects(reconcilePreviewInventory({ numbers: [1, 2, 3], inspect: async (number) => {
    visited.push(number); if (number === 1) throw new Error('unavailable');
  } }), /PR\(s\): 1/);
  assert.deepEqual(visited, [1, 2, 3]);
});

test('comment errors do not suppress independent label publication or poison a later phase', async () => {
  let labels = 0;
  await publishPreviewNotifications([async () => { throw new Error('comment failed'); }, async () => labels++], { bestEffort: true });
  assert.equal(labels, 1);
  await publishPreviewNotifications([async () => {}, async () => labels++]);
  assert.equal(labels, 2);
  await assert.rejects(publishPreviewNotifications([async () => { throw new Error('still failed'); }]), /publication is incomplete/);
});

test('workflow keeps secretless builds while allowing protected comments and recovery dispatch', () => {
  const workflow = readFileSync(new URL('../workflows/develop-pr-preview.yml', import.meta.url), 'utf8');
  const develop = readFileSync(new URL('./deploy-develop-pr-preview.mjs', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('./deploy-admin-pr-previews.mjs', import.meta.url), 'utf8');
  const prepare = workflow.slice(workflow.indexOf('\n  prepare:'), workflow.indexOf('\n  build:'));
  const adminPrepare = workflow.slice(workflow.indexOf('\n  admin_prepare:'), workflow.indexOf('\n  admin_build:'));
  assert.match(prepare, /pull-requests: write/);
  assert.match(adminPrepare, /pull-requests: write/);
  assert.match(workflow, /RECOVERY_GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(develop, /pulls\?state=open&per_page=100/);
  assert.match(develop, /Promise.allSettled\(\[reconcile\(config\)\]\)/);
  assert.doesNotMatch(develop.slice(develop.lastIndexOf('const main = async')), /reconcileStableDevelopAlias\(/);
  const build = workflow.slice(workflow.indexOf('\n  build:'), workflow.indexOf('\n  controller:'));
  assert.match(build, /VERCEL_TARGET_ENV: develop/);
  assert.doesNotMatch(build, /secrets\.|THINGTIME_MONGODB_CONNECTION_MODE/);
  assert.match(build, /VERCEL_GIT_COMMIT_REF: \$\{\{ needs.prepare.outputs.head_ref \}\}/);
  assert.match(admin, /commentWrite\.catch\(\(\) => undefined\)\.then/);
  assert.match(admin, /lane: row.environment === 'develop' \? 'admin-develop' : 'production'/);
});

test('protected receipt path initializes on the runner before publisher steps without job-context expressions', () => {
  const workflow = readFileSync(new URL('../workflows/develop-pr-preview.yml', import.meta.url), 'utf8');
  const controller = workflow.split('\n  controller:\n')[1].split('\n  admin_prepare:\n')[0];
  const [job, steps] = controller.split('\n    steps:\n');
  assert.doesNotMatch(job, /\$\{\{\s*runner\./, 'runner context is unavailable in job-level env');
  const initializer = /- name: Initialize protected Preview upload receipt path\n        run: (.+)/.exec(steps)?.[1];
  assert.ok(initializer, 'the receipt path must be initialized by a runner step');
  assert.ok(steps.indexOf(initializer) < steps.indexOf('- name: Upload and publish GitHub-built preview'));
  const directory = mkdtempSync(join(tmpdir(), 'preview receipt '));
  try {
    const environmentFile = join(directory, 'github env');
    const result = spawnSync('/bin/bash', ['-eu', '-c', initializer], {
      env: { RUNNER_TEMP: directory, GITHUB_ENV: environmentFile }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', 'the initialization must not log environment values');
    assert.equal(readFileSync(environmentFile, 'utf8'), `VERCEL_PREVIEW_RECEIPT_PATH=${directory}/pr-preview-upload-receipt.json\n`);
    assert.match(steps, /path: \$\{\{ runner\.temp \}\}\/pr-preview-upload-receipt\.json/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
