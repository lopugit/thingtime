#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const TERMINAL_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'startup_failure']);
const TERMINAL_TARGET_STATUSES = new Set(['success', 'failure', 'cancelled', 'skipped']);
const STEP_PHASES = [
  ['Check out the trusted controller', 5, 'Loading the trusted Lopu controller'],
  ['Prepare immutable sources', 15, 'Preparing immutable PR snapshots'],
  ['Require an AI credential', 22, 'Checking the configured Lopu account waterfall'],
  ['Combine the Feature Stack with Lopu', 45, 'Resolving conflicts and combining sources with Lopu'],
  ['Continue the exact Feature Stack session until it finishes', 65, 'Continuing the active Lopu merge session'],
  ['Verify exact merge topology and conflict scope', 84, 'Verifying merge topology and conflict scope'],
  ['Publish an auto-merge PR to the target', 95, 'Publishing the verified auto-merge PR']
];

export const targetProgress = (target, job, mergeGateJob = null) => {
  if (mergeGateJob) {
    if (mergeGateJob.status === 'completed') {
      const rawConclusion = TERMINAL_CONCLUSIONS.has(mergeGateJob.conclusion) ? mergeGateJob.conclusion : 'failure';
      const conclusion = ['success', 'cancelled', 'skipped'].includes(rawConclusion) ? rawConclusion : 'failure';
      return {
        target,
        status: conclusion,
        phase: rawConclusion === 'success' ? 'Verified stack PR merged' : `Target merge gate ${String(rawConclusion).replaceAll('_', ' ')}`,
        progressPercent: 100,
        jobUrl: mergeGateJob.html_url ?? null
      };
    }
    return {
      target,
      status: mergeGateJob.status === 'queued' || mergeGateJob.status === 'waiting' || mergeGateJob.status === 'pending' ? 'queued' : 'in_progress',
      phase: 'Waiting for branch protection to merge the verified stack PR',
      progressPercent: 98,
      jobUrl: mergeGateJob.html_url ?? null
    };
  }
  if (!job) return { target, status: 'waiting', phase: 'Waiting for the GitHub worker to appear', progressPercent: 0, jobUrl: null };
  if (job.status === 'queued' || job.status === 'waiting' || job.status === 'pending') {
    return { target, status: 'queued', phase: 'Waiting for the shared Lopu worker', progressPercent: 0, jobUrl: job.html_url ?? null };
  }
  if (job.status === 'completed') {
    const rawConclusion = TERMINAL_CONCLUSIONS.has(job.conclusion) ? job.conclusion : 'failure';
    const conclusion = rawConclusion === 'success'
      ? 'in_progress'
      : ['cancelled', 'skipped'].includes(rawConclusion)
        ? rawConclusion
        : 'failure';
    const phase = rawConclusion === 'success'
      ? 'Verified stack PR published; waiting for its merge gate'
      : rawConclusion === 'skipped'
        ? 'Worker skipped before publication'
        : `Worker ${String(rawConclusion).replaceAll('_', ' ')}`;
    return { target, status: conclusion, phase, progressPercent: rawConclusion === 'success' ? 95 : 100, jobUrl: job.html_url ?? null };
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  let selected = STEP_PHASES[0];
  for (const candidate of STEP_PHASES) {
    const step = steps.find((item) => item?.name === candidate[0]);
    if (step?.status === 'in_progress') {
      selected = candidate;
      break;
    }
    if (step?.status === 'completed') selected = candidate;
  }
  return { target, status: 'in_progress', phase: selected[2], progressPercent: selected[1], jobUrl: job.html_url ?? null };
};

export const progressSnapshot = ({ targets, jobs, startedAt, now = Date.now() }) => {
  const findJob = (expectedName) => jobs.find((job) => {
    const name = String(job?.name ?? '');
    return name === expectedName || name.endsWith(` / ${expectedName}`);
  });
  const rows = targets.map((target) => targetProgress(
    target,
    findJob(`Merge Feature Stack into ${target}`),
    findJob(`Confirm Feature Stack merged into ${target}`)
  ));
  const progressPercent = Math.round(rows.reduce((total, row) => total + row.progressPercent, 0) / Math.max(1, rows.length));
  const terminal = rows.every((row) => TERMINAL_TARGET_STATUSES.has(row.status));
  const failed = rows.some((row) => row.status !== 'success' && TERMINAL_TARGET_STATUSES.has(row.status));
  const status = terminal ? (failed ? 'failure' : 'success') : 'in_progress';
  const active = rows.filter((row) => row.status === 'in_progress').length;
  const queued = rows.filter((row) => row.status === 'queued' || row.status === 'waiting').length;
  const finished = rows.filter((row) => TERMINAL_TARGET_STATUSES.has(row.status)).length;
  const details = rows.map((row) => `${row.target}: ${row.phase}`).join('; ');
  const message = terminal
    ? `Lopu finished ${finished}/${rows.length} target workers. ${details}`
    : `Lopu progress: ${active} active, ${queued} queued, ${finished}/${rows.length} finished. ${details}`;
  const elapsed = Math.max(60_000, now - startedAt);
  const remaining = progressPercent >= 5
    ? Math.min(6 * 60 * 60_000, Math.max(2 * 60_000, Math.round(elapsed * (100 - progressPercent) / progressPercent)))
    : Math.max(10 * 60_000, targets.length * 30 * 60_000);
  return {
    status,
    terminal,
    message: message.slice(0, 500),
    progressPercent,
    expectedFinishAt: terminal ? new Date(now).toISOString() : new Date(now + remaining).toISOString(),
    targets: rows
  };
};

const githubJobs = async ({ repository, runId, token }) => {
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?filter=all&per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`GitHub jobs API returned ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.jobs) ? payload.jobs : [];
};

const postProgress = async ({ endpoint, secret, payload }) => {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Thingtime-CI-Signature': signature },
        body: raw,
        signal: AbortSignal.timeout(20_000)
      });
      if (response.ok) return;
      lastError = new Error(`Thingtime progress endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw lastError;
};

export const recoveryPayload = ({
  repository,
  runId,
  runAttempt,
  stackId,
  featureStackRunId,
  matrix,
  now = Date.now(),
  serverUrl = 'https://github.com'
}) => {
  const targets = Array.isArray(matrix?.include) ? matrix.include : [];
  if (!targets.length) throw new Error('Feature Stack receipt recovery has no verified targets.');
  const rows = targets.map((item) => {
    const target = String(item?.target ?? '');
    const pr = Number(item?.pr);
    const prUrl = String(item?.pr_url ?? '');
    const mergedAt = String(item?.merged_at ?? '');
    const mergeCommitSha = String(item?.merge_commit_sha ?? '');
    if (!target || !Number.isSafeInteger(pr) || pr <= 0 || !/^https:\/\/github\.com\//u.test(prUrl)
      || !Number.isFinite(Date.parse(mergedAt)) || !/^[0-9a-f]{40}$/u.test(mergeCommitSha)) {
      throw new Error('Feature Stack receipt recovery target is invalid.');
    }
    return {
      target,
      status: 'success',
      phase: `Verified stack PR #${pr} already merged`,
      progressPercent: 100,
      jobUrl: null
    };
  });
  const workflowRunUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const timestamp = new Date(now).toISOString();
  const details = targets.map((item) => `${item.target} via PR #${item.pr} (${String(item.merge_commit_sha).slice(0, 12)})`).join('; ');
  return {
    deliveryId: `${featureStackRunId}:${runId}:${runAttempt}:reconcile`,
    repository,
    stackId,
    featureStackRunId,
    workflowRunId: runId,
    workflowRunUrl,
    runAttempt,
    startedAt: timestamp,
    reportedAt: timestamp,
    expectedFinishAt: timestamp,
    status: 'success',
    message: `Lopu reconciled an already-merged Feature Stack without rerunning AI: ${details}`.slice(0, 500),
    progressPercent: 100,
    targets: rows
  };
};

const reconcile = async () => {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const runId = Number(process.env.GITHUB_RUN_ID);
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? '1');
  const stackId = process.env.STACK_ID ?? '';
  const featureStackRunId = process.env.FEATURE_STACK_RUN_ID ?? '';
  const secret = process.env.THINGTIME_CI_ROUTER_SECRET ?? '';
  const matrix = JSON.parse(process.env.FEATURE_STACK_MATRIX ?? '{"include":[]}');
  const origin = new URL(process.env.THINGTIME_PROGRESS_ORIGIN || process.env.THINGTIME_CREDENTIAL_VAULT_ORIGIN || 'https://thingtime.com').origin;
  if (!repository || !Number.isSafeInteger(runId) || !Number.isSafeInteger(runAttempt) || !stackId || !featureStackRunId || !secret) {
    throw new Error('Feature Stack receipt recovery is missing its trusted run configuration.');
  }
  const payload = recoveryPayload({ repository, runId, runAttempt, stackId, featureStackRunId, matrix });
  await postProgress({ endpoint: `${origin}/api/v1/integrations/ci/progress`, secret, payload });
  console.log(`Reconciled Feature Stack ${stackId} at 100% success.`);
};

const run = async () => {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const runId = Number(process.env.GITHUB_RUN_ID);
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? '1');
  const stackId = process.env.STACK_ID ?? '';
  const featureStackRunId = process.env.FEATURE_STACK_RUN_ID ?? '';
  const token = process.env.GH_TOKEN ?? '';
  const secret = process.env.THINGTIME_CI_ROUTER_SECRET ?? '';
  const matrix = JSON.parse(process.env.FEATURE_STACK_MATRIX ?? '{"include":[]}');
  const targets = Array.isArray(matrix.include) ? matrix.include.map((item) => String(item?.target ?? '')).filter(Boolean) : [];
  const heartbeatMs = Number(process.env.HEARTBEAT_SECONDS ?? '600') * 1000;
  const pollMs = Number(process.env.POLL_SECONDS ?? '60') * 1000;
  const startedAt = Date.now();
  const origin = new URL(process.env.THINGTIME_PROGRESS_ORIGIN || process.env.THINGTIME_CREDENTIAL_VAULT_ORIGIN || 'https://thingtime.com').origin;
  const endpoint = `${origin}/api/v1/integrations/ci/progress`;
  const workflowRunUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}/actions/runs/${runId}`;
  if (!repository || !Number.isSafeInteger(runId) || !Number.isSafeInteger(runAttempt) || !stackId || !featureStackRunId || !token || !secret || !targets.length) {
    throw new Error('Feature Stack progress reporter is missing its trusted run configuration.');
  }

  let sequence = 0;
  let lastSentAt = 0;
  let lastSignature = '';
  let lastSnapshot = null;
  while (true) {
    try {
      const jobs = await githubJobs({ repository, runId, token });
      lastSnapshot = progressSnapshot({ targets, jobs, startedAt });
      const phaseSignature = JSON.stringify(lastSnapshot.targets.map(({ target, status, phase }) => ({ target, status, phase })));
      const now = Date.now();
      if (!lastSentAt || phaseSignature !== lastSignature || now - lastSentAt >= heartbeatMs || lastSnapshot.terminal) {
        sequence += 1;
        const payload = {
          deliveryId: `${featureStackRunId}:${runId}:${runAttempt}:${sequence}`,
          repository,
          stackId,
          featureStackRunId,
          workflowRunId: runId,
          workflowRunUrl,
          runAttempt,
          startedAt: new Date(startedAt).toISOString(),
          reportedAt: new Date(now).toISOString(),
          expectedFinishAt: lastSnapshot.expectedFinishAt,
          status: lastSnapshot.status,
          message: lastSnapshot.message,
          progressPercent: lastSnapshot.progressPercent,
          targets: lastSnapshot.targets
        };
        try {
          await postProgress({ endpoint, secret, payload });
          console.log(`Reported Feature Stack progress ${payload.progressPercent}% (${payload.status}).`);
        } catch (error) {
          console.warn(`::warning::Could not stream Feature Stack progress: ${error instanceof Error ? error.message : String(error)}`);
        }
        lastSentAt = now;
        lastSignature = phaseSignature;
      }
      if (lastSnapshot.terminal) return;
    } catch (error) {
      console.warn(`::warning::Could not inspect Feature Stack workers: ${error instanceof Error ? error.message : String(error)}`);
      if (lastSnapshot && Date.now() - lastSentAt >= heartbeatMs) lastSignature = '';
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

const selfTest = () => {
  const jobs = [
    { name: 'control-plane / Merge Feature Stack into main', status: 'in_progress', html_url: 'https://github.com/lopugit/thingtime/actions/runs/1/job/2', steps: [{ name: 'Prepare immutable sources', status: 'completed' }, { name: 'Combine the Feature Stack with Lopu', status: 'in_progress' }] },
    { name: 'Merge Feature Stack into develop', status: 'queued', steps: [] }
  ];
  const snapshot = progressSnapshot({ targets: ['main', 'develop'], jobs, startedAt: Date.now() - 600_000 });
  assert.equal(snapshot.status, 'in_progress');
  assert.equal(snapshot.targets[0].phase, 'Resolving conflicts and combining sources with Lopu');
  assert.match(snapshot.message, /1 active, 1 queued/);
  const done = progressSnapshot({ targets: ['main'], jobs: [{ name: 'Merge Feature Stack into main', status: 'completed', conclusion: 'success' }], startedAt: Date.now() - 600_000 });
  assert.equal(done.status, 'in_progress');
  assert.equal(done.progressPercent, 95);
  const awaitingMerge = progressSnapshot({
    targets: ['main'],
    jobs: [
      { name: 'Merge Feature Stack into main', status: 'completed', conclusion: 'success' },
      { name: 'Confirm Feature Stack merged into main', status: 'in_progress' }
    ],
    startedAt: Date.now() - 600_000
  });
  assert.equal(awaitingMerge.status, 'in_progress');
  assert.equal(awaitingMerge.progressPercent, 98);
  assert.match(awaitingMerge.targets[0].phase, /branch protection/);
  const recovered = recoveryPayload({
    repository: 'lopugit/thingtime',
    runId: 3,
    runAttempt: 1,
    stackId: 'ci-feature-stack-98c30439-8739-4acb-8dfa-2dc4e0f780aa',
    featureStackRunId: 'feature-stack-run-f2023eb8-a7a5-4903-ba83-65a73c02dc4f',
    matrix: { include: [{ target: 'main', pr: 566, pr_url: 'https://github.com/lopugit/thingtime/pull/566', merged_at: '2026-09-01T12:24:36Z', merge_commit_sha: '4adda985252632f2c1d0738b3e6bf84faf874af8' }] },
    now: Date.parse('2026-09-01T12:40:00Z')
  });
  assert.equal(recovered.status, 'success');
  assert.equal(recovered.progressPercent, 100);
  assert.match(recovered.message, /main via PR #566/);
  assert.equal(recovered.targets[0].jobUrl, null);
  console.log('Feature Stack progress self-test passed.');
};

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--reconcile')) await reconcile();
else if (import.meta.url === `file://${process.argv[1]}`) await run();
