import { Sandbox } from '@vercel/sandbox';
import { FatalError, sleep } from 'workflow';
import { start } from 'workflow/api';

import type { CiWorkflowKey } from './automationPolicy';
import { githubRequest } from './githubClient';
import { ciProviderReadiness } from './providerReadiness';
import { recordCiEvent, upsertCiEntity } from './store';

const CONTROL_PLANE_REF = 'github-actions';
// The configured Vercel team is on Pro, where a Sandbox may run for up to 24
// hours. Two hours covers the longest protected workflow (currently 55m) plus
// queue/cascade headroom without leaving a runner alive indefinitely.
const RUNNER_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const POLL_INTERVAL = '15s';
const MAX_POLL_ROUNDS = 480;

export type VercelCiRunnerInput = {
  repository: string;
  workflow: CiWorkflowKey;
  workflowFile: string;
  inputs: Record<string, string | boolean>;
  actorId: string;
  dispatchExternalId: string;
  dispatchThingId: string;
  requestedAt: string;
};

type RunnerHandle = {
  sandbox: Sandbox;
  label: string;
  name: string;
};

type RunnerJobSnapshot = {
  seen: number;
  active: number;
  failed: number;
  runIds: number[];
};

export type VercelRunnerJob = {
  runId: number;
  status: string;
  conclusion: string | null;
};

const safeSegment = (value: string, max = 48) =>
  value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);

const repositoryPath = (repository: string) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new FatalError('The configured GitHub repository is invalid');
  }
  return repository;
};

export const vercelRunnerIdentity = (dispatchThingId: string) => {
  const suffix = safeSegment(dispatchThingId.replace(/^ci-/, ''), 28);
  if (!suffix) throw new Error('The CI dispatch id cannot identify a Vercel runner');
  return {
    name: `thingtime-vercel-${suffix}`,
    label: `thingtime-vercel-${suffix}`
  };
};

export const summarizeVercelRunnerJobs = (jobs: VercelRunnerJob[]): RunnerJobSnapshot => {
  const failedConclusions = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']);
  return {
    seen: jobs.length,
    active: jobs.filter((job) => job.status !== 'completed').length,
    failed: jobs.filter((job) => job.conclusion && failedConclusions.has(job.conclusion)).length,
    runIds: [...new Set(jobs.map((job) => job.runId))]
  };
};

const createRunner = async (input: VercelCiRunnerInput): Promise<RunnerHandle> => {
  'use step';

  const repository = repositoryPath(input.repository);
  const { name, label } = vercelRunnerIdentity(input.dispatchThingId);
  const [registration, downloads] = await Promise.all([
    githubRequest<{ token?: string }>(`/repos/${repository}/actions/runners/registration-token`, { method: 'POST' }),
    githubRequest<Array<{ os?: string; architecture?: string; download_url?: string; filename?: string }>>(
      `/repos/${repository}/actions/runners/downloads`
    )
  ]);
  if (!registration?.token) throw new FatalError('GitHub did not issue a self-hosted runner registration token');
  const runner = downloads.find(
    (candidate) => candidate.os === 'linux' && candidate.architecture === 'x64' && candidate.download_url
  );
  if (!runner?.download_url) throw new FatalError('GitHub did not publish a compatible Linux x64 runner');

  const sandbox = await Sandbox.getOrCreate({
    name,
    image: 'vercel/sandbox/universal:latest',
    resources: { vcpus: 4 },
    timeout: RUNNER_TIMEOUT_MS,
    persistent: true,
    tags: { purpose: 'github-runner', workflow: safeSegment(input.workflow, 30) }
  });
  const runnerDir = `${sandbox.cwd}/actions-runner`;
  await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', runnerDir] });
  const configured = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'test -f .runner'],
    cwd: runnerDir
  });
  if (configured.exitCode !== 0) {
    const download = await sandbox.runCommand({
      cmd: 'curl',
      args: ['--fail', '--location', '--silent', '--show-error', '--output', 'actions-runner.tar.gz', runner.download_url],
      cwd: runnerDir
    });
    if (download.exitCode !== 0) throw new Error('The GitHub runner archive could not be downloaded');
    const extract = await sandbox.runCommand({
      cmd: 'tar',
      args: ['xzf', 'actions-runner.tar.gz'],
      cwd: runnerDir
    });
    if (extract.exitCode !== 0) throw new Error('The GitHub runner archive could not be extracted');
    const configure = await sandbox.runCommand({
      cmd: 'bash',
      args: [
        '-lc',
        './config.sh --unattended --replace --url "$RUNNER_REPOSITORY_URL" --token "$RUNNER_REGISTRATION_TOKEN" --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --work _work'
      ],
      cwd: runnerDir,
      env: {
        RUNNER_ALLOW_RUNASROOT: '1',
        RUNNER_REPOSITORY_URL: `https://github.com/${repository}`,
        RUNNER_REGISTRATION_TOKEN: registration.token,
        RUNNER_NAME: name,
        RUNNER_LABELS: `vercel-sandbox,${label}`
      }
    });
    if (configure.exitCode !== 0) throw new Error('The Vercel Sandbox runner could not register with GitHub');
  }

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'exec ./run.sh'],
    cwd: runnerDir,
    env: { RUNNER_ALLOW_RUNASROOT: '1' },
    detached: true
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const listing = await githubRequest<{ runners?: Array<{ name?: string; status?: string }> }>(
      `/repos/${repository}/actions/runners?per_page=100`
    );
    if (listing.runners?.some((candidate) => candidate.name === name && candidate.status === 'online')) {
      return { sandbox, label, name };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('The Vercel Sandbox runner did not become available to GitHub');
};

const dispatchToRunner = async (input: VercelCiRunnerInput, runner: RunnerHandle) => {
  'use step';

  await githubRequest<void>(
    `/repos/${repositoryPath(input.repository)}/actions/workflows/${encodeURIComponent(input.workflowFile)}/dispatches`,
    {
      method: 'POST',
      body: {
        ref: CONTROL_PLANE_REF,
        inputs: {
          ...input.inputs,
          execution_provider: 'vercel-sandbox',
          runner_label: runner.label,
          control_dispatch_id: input.dispatchThingId
        }
      }
    }
  );
  await upsertCiEntity({
    kind: 'ci-dispatch',
    provider: 'thingtime',
    repository: input.repository,
    externalId: input.dispatchExternalId,
    title: `Dispatch ${input.workflow}`,
    status: 'running',
    occurredAt: new Date(),
    data: {
      workflow: input.workflow,
      workflowFile: input.workflowFile,
      ref: CONTROL_PLANE_REF,
      executionProvider: 'vercel-sandbox',
      runnerLabel: runner.label,
      actorId: input.actorId
    }
  });
};

const runnerJobs = async (input: VercelCiRunnerInput, runner: RunnerHandle): Promise<RunnerJobSnapshot> => {
  'use step';

  const created = encodeURIComponent(`>=${input.requestedAt}`);
  const runs = await githubRequest<{ workflow_runs?: Array<{ id?: number }> }>(
    `/repos/${repositoryPath(input.repository)}/actions/runs?event=workflow_dispatch&created=${created}&per_page=100`
  );
  const matched: VercelRunnerJob[] = [];
  for (const run of runs.workflow_runs ?? []) {
    if (!Number.isInteger(run.id)) continue;
    const jobs = await githubRequest<{
      jobs?: Array<{ status?: string; conclusion?: string | null; labels?: string[] }>;
    }>(`/repos/${input.repository}/actions/runs/${run.id}/jobs?filter=all&per_page=100`);
    for (const job of jobs.jobs ?? []) {
      if (!job.labels?.includes(runner.label)) continue;
      matched.push({
        runId: run.id as number,
        status: String(job.status ?? 'unknown'),
        conclusion: job.conclusion ?? null
      });
    }
  }
  return summarizeVercelRunnerJobs(matched);
};

const finishDispatch = async (
  input: VercelCiRunnerInput,
  status: 'completed' | 'failed',
  snapshot: RunnerJobSnapshot | null,
  detail?: string
) => {
  'use step';

  await upsertCiEntity({
    kind: 'ci-dispatch',
    provider: 'thingtime',
    repository: input.repository,
    externalId: input.dispatchExternalId,
    title: `Dispatch ${input.workflow}`,
    status,
    occurredAt: new Date(),
    data: {
      workflow: input.workflow,
      workflowFile: input.workflowFile,
      ref: CONTROL_PLANE_REF,
      executionProvider: 'vercel-sandbox',
      actorId: input.actorId,
      githubRunIds: snapshot?.runIds ?? [],
      failedJobs: snapshot?.failed ?? 0,
      detail: detail?.slice(0, 500) ?? null
    }
  });
  await recordCiEvent({
    provider: 'thingtime',
    repository: input.repository,
    deliveryId: `${input.dispatchExternalId}:${status}`,
    eventType: 'vercel_runner',
    action: input.workflow,
    parentId: input.dispatchThingId,
    actor: input.actorId,
    statusFrom: 'running',
    statusTo: status,
    occurredAt: new Date(),
    data: { githubRunIds: snapshot?.runIds ?? [], failedJobs: snapshot?.failed ?? 0 }
  });
};

const fallbackToGithub = async (input: VercelCiRunnerInput, detail: string) => {
  'use step';

  await githubRequest<void>(
    `/repos/${repositoryPath(input.repository)}/actions/workflows/${encodeURIComponent(input.workflowFile)}/dispatches`,
    {
      method: 'POST',
      body: {
        ref: CONTROL_PLANE_REF,
        inputs: {
          ...input.inputs,
          execution_provider: 'github-actions',
          runner_label: '',
          control_dispatch_id: input.dispatchThingId
        }
      }
    }
  );
  await upsertCiEntity({
    kind: 'ci-dispatch',
    provider: 'thingtime',
    repository: input.repository,
    externalId: input.dispatchExternalId,
    title: `Dispatch ${input.workflow}`,
    status: 'accepted',
    occurredAt: new Date(),
    data: {
      workflow: input.workflow,
      workflowFile: input.workflowFile,
      ref: CONTROL_PLANE_REF,
      executionProvider: 'github-actions',
      fallbackFrom: 'vercel-sandbox',
      actorId: input.actorId,
      detail: detail.slice(0, 500)
    }
  });
  await recordCiEvent({
    provider: 'thingtime',
    repository: input.repository,
    deliveryId: `${input.dispatchExternalId}:fallback:github-actions`,
    eventType: 'provider_fallback',
    action: input.workflow,
    parentId: input.dispatchThingId,
    actor: input.actorId,
    statusFrom: 'vercel-sandbox',
    statusTo: 'github-actions',
    occurredAt: new Date(),
    data: { reason: detail.slice(0, 500) }
  });
};

const cleanupRunner = async (input: VercelCiRunnerInput, runner: RunnerHandle | null) => {
  'use step';

  if (!runner) return;
  try {
    await runner.sandbox.stop();
  } catch {
    // GitHub cleanup below is authoritative; an expired sandbox is already stopped.
  }
  try {
    const listing = await githubRequest<{ runners?: Array<{ id?: number; name?: string }> }>(
      `/repos/${repositoryPath(input.repository)}/actions/runners?per_page=100`
    );
    const registered = listing.runners?.find((candidate) => candidate.name === runner.name);
    if (registered?.id) {
      await githubRequest<void>(`/repos/${input.repository}/actions/runners/${registered.id}`, { method: 'DELETE' });
    }
  } finally {
    try {
      await runner.sandbox.delete();
    } catch {
      // Sandbox retention is bounded by its timeout even when deletion is unavailable.
    }
  }
};

export async function runCiOnVercel(input: VercelCiRunnerInput) {
  'use workflow';

  let runner: RunnerHandle | null = null;
  let latest: RunnerJobSnapshot | null = null;
  try {
    runner = await createRunner(input);
    await dispatchToRunner(input, runner);
    let quietRounds = 0;
    let everSeen = false;
    for (let round = 0; round < MAX_POLL_ROUNDS; round += 1) {
      await sleep(POLL_INTERVAL);
      latest = await runnerJobs(input, runner);
      everSeen ||= latest.seen > 0;
      if (latest.active > 0 || !everSeen) {
        quietRounds = 0;
        continue;
      }
      quietRounds += 1;
      if (quietRounds >= 4) {
        const status = latest.failed > 0 ? 'failed' : 'completed';
        await finishDispatch(input, status, latest);
        return { status, githubRunIds: latest.runIds, failedJobs: latest.failed };
      }
    }
    throw new FatalError('The Vercel runner exceeded its two-hour orchestration window');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Vercel runner orchestration failed';
    await finishDispatch(input, 'failed', latest, detail);
    try {
      // The protected workflows are lease-safe and idempotent. If the
      // external runner fails after the original GitHub trigger has exited,
      // re-enter the same reviewed workflow on GitHub compute so automation
      // remains automatic rather than requiring an operator to notice/retry.
      await fallbackToGithub(input, detail);
      return { status: 'fallback' as const, githubRunIds: latest?.runIds ?? [], failedJobs: latest?.failed ?? 0 };
    } catch {
      throw error;
    }
  } finally {
    await cleanupRunner(input, runner);
  }
}

export const startCiOnVercel = async (input: VercelCiRunnerInput) => {
  const run = await start(runCiOnVercel, [input], { deploymentId: 'latest' });
  return { runId: run.runId };
};

export const vercelRunnerConfigured = () =>
  ciProviderReadiness().vercelRuntimeConfigured;
