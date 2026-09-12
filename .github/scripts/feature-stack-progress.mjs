#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const TERMINAL_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'startup_failure']);
const TERMINAL_TARGET_STATUSES = new Set(['success', 'failure', 'cancelled', 'skipped']);
const STEP_PHASES = [
  ['Check out the trusted controller', 5, 'Loading the trusted Lopu controller'],
  ['Prepare immutable sources', 15, 'Preparing immutable PR snapshots'],
  ['Require an AI credential', 22, 'Checking the configured Lopu account waterfall'],
  ['Merge with the selected AI endpoint waterfall', 45, 'Resolving conflicts with the selected AI endpoint waterfall'],
  ['Combine the Feature Stack with Lopu', 45, 'Resolving conflicts and combining sources with Lopu'],
  ['Continue the exact Feature Stack session until it finishes', 65, 'Continuing the active Lopu merge session'],
  ['Verify exact merge topology and conflict scope', 84, 'Verifying merge topology and conflict scope'],
  ['Publish an auto-merge PR to the target', 95, 'Publishing the verified auto-merge PR']
];

export const targetProgress = (target, job, mergeGateJob = null) => {
  // A running gate cannot revive a failed publisher. A completed successful
  // gate still wins when it has independently confirmed the merge.
  if (job?.status === 'completed' && job.conclusion !== 'success'
    && !(mergeGateJob?.status === 'completed' && mergeGateJob.conclusion === 'success')) {
    const failedStep = job.steps?.find((step) => step.conclusion === 'failure')?.name;
    return { target, status: ['cancelled', 'skipped'].includes(job.conclusion) ? job.conclusion : 'failure', progressPercent: 100, jobUrl: job.html_url ?? null,
      phase: failedStep ? `Worker failed: ${failedStep}` : `Worker ${job.conclusion || 'failure'}` };
  }
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
      status: 'waiting',
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
      ? 'waiting'
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
  const current = steps.find(step => step.status === 'in_progress');
  if (current) return { target, status: 'in_progress', progressPercent: STEP_PHASES.find(row => row[0] === current.name)?.[1] ?? 0,
    phase: STEP_PHASES.find(row => row[0] === current.name)?.[2] ?? `Running: ${String(current.name).slice(0, 240)}`, jobUrl: job.html_url ?? null };
  let selected = STEP_PHASES[0];
  for (const candidate of STEP_PHASES) {
    const step = steps.find((item) => item?.name === candidate[0]);
    if (step?.status === 'in_progress') {
      selected = candidate;
      break;
    }
    if (step?.status === 'completed' && step.conclusion === 'success') selected = candidate;
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
  const queued = rows.filter((row) => row.status === 'queued').length;
  const waiting = rows.filter((row) => row.status === 'waiting').length;
  const merged = rows.filter((row) => row.status === 'success').length;
  const failures = rows.filter((row) => row.status === 'failure').length;
  const details = rows.map((row) => `${row.target}: ${row.phase}`).join('; ');
  const message = terminal
    ? `Run ended: ${merged}/${rows.length} targets merged, ${failures} failed. ${details}`
    : `Lopu: ${active} working, ${queued} queued, ${waiting} waiting, ${merged}/${rows.length} merged, ${failures} failed. ${details}`;
  return {
    status,
    terminal,
    message: message.slice(0, 500),
    progressPercent,
    expectedFinishAt: terminal ? new Date(now).toISOString() : null,
    targets: rows
  };
};

const githubJobs = async ({ repository, runId, runAttempt, token }) => {
  const jobs = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`GitHub jobs API returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.jobs)) throw new Error('GitHub jobs inventory is incomplete');
    jobs.push(...payload.jobs);
    if (payload.jobs.length < 100) return jobs;
  }
  throw new Error('GitHub jobs inventory exceeded its page bound');
};

export const githubStackPullRequests = async ({ repository, stackId, targets, token, request = fetch }) => {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const results = await Promise.allSettled(targets.map(async target => {
    const head = `lopu/feature-stack-${stackId}-to-${target.replace(/[/_]/g, '-').replace(/[^A-Za-z0-9.-]/g, '')}`;
    const query = new URLSearchParams({ state: 'all', head: `${repository.split('/')[0]}:${head}`, base: target, sort: 'updated', direction: 'desc', per_page: '20' });
    const response = await request(`https://api.github.com/repos/${repository}/pulls?${query}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('PR inventory unavailable');
    const list = await response.json();
    const pr = list.find(row => row.head?.ref === head && row.head?.repo?.full_name === repository && row.base?.ref === target);
    if (!pr) return null;
    // The list endpoint may omit computed mergeability. Read the selected PR.
    const detail = await request(`https://api.github.com/repos/${repository}/pulls/${pr.number}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!detail.ok) throw new Error('PR state unavailable');
    return detail.json();
  }));
  return { prs: results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value),
    unavailableTargets: targets.filter((_, index) => results[index].status === 'rejected') };
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

  // Old callers may sparsely check out only this reporter. Chat must remain optional.
  const runChat = process.env.STACK_CHAT_ENABLED === 'true'
    ? await import('./feature-stack-chat.mjs').catch(() => null) : null;
  const chatState = { done: false, context: null };
  const chatScope = { origin, secret, identity: { repository, runId: featureStackRunId, workflowRunId: runId, runAttempt } };
  // The responder is optional and negotiated; older product deployments remain compatible.
  const chatEnabled = Boolean(runChat && await runChat.chatSupported(origin));
  const chat = chatEnabled ? runChat.serveRunChat(chatScope, chatState) : Promise.resolve();
  let sequence = 0;
  let lastSentAt = 0;
  let lastSignature = '';
  let lastSnapshot = null;
  while (true) {
    try {
      const jobs = await githubJobs({ repository, runId, runAttempt, token });
      lastSnapshot = progressSnapshot({ targets, jobs, startedAt });
      if (chatEnabled) {
        const prState = await githubStackPullRequests({ repository, stackId, targets, token });
        chatState.context = { ...runChat.safeRunContext({ snapshot: lastSnapshot, jobs, prs: prState.prs, at: new Date().toISOString(), workflowRunUrl }),
          unavailablePullRequestTargets: prState.unavailableTargets };
      }
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
      if (lastSnapshot.terminal) { chatState.done = true; await chat; return; }
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
  assert.match(snapshot.message, /1 working, 1 queued/);
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
