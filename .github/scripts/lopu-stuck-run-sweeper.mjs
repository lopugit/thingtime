#!/usr/bin/env node
// Lopu's model-bearing jobs share one serialized `lopu-agent-fleet-<repo>`
// concurrency lane (queue: max, cancel-in-progress: false). One job that never
// finishes therefore blocks every review, resolution and promotion behind it.
//
// Observed on 2026-11-24/25:
// - An all-branch job failed its Union build check and then hung in GitHub's
//   "Complete job" phase (05:33 -> 06:16, and again 07:04 -> 07:21). Its
//   timeout-minutes did not release the lane, and a normal cancel was accepted
//   but ignored. Only force-cancel freed it.
// - A 19-PR resolution batch held the lane for ~7 hours: every "Resolve PR #n"
//   job ran ~20 minutes and then failed the same way, with nothing stopping
//   the rest of the batch.
//
// This sweeper only acts on runs of the workflows that can hold that lane:
// - a job running longer than JOB_LIMIT_MS is cancelled, then force-cancelled
//   if it is still running FORCE_GRACE_MS later (stateless, so each scheduled
//   pass can escalate);
// - a batch whose last FAILURE_STREAK matrix jobs of one family all failed is
//   cancelled while more of that family are still waiting;
// - a run that reports in_progress with no live job for JOB_LIMIT_MS is a
//   ghost and is force-cancelled.
// Runs that are only waiting for the lane are never touched.

import { basename } from "node:path";
import { pathToFileURL } from "node:url";

// all-branch.yml runs a deterministic `build` job in its own lane and only its
// `doctor` job in the fleet. Both are swept: the caller serializes whole
// all-branch runs, so a hung build job still holds back every later rebuild.
export const FLEET_WORKFLOWS = new Set(["resolve-pr-conflicts.yml", "all-branch.yml", "rebase-pr-stacks.yml"]);
export const JOB_LIMIT_MS = 60 * 60_000;
export const FORCE_GRACE_MS = 10 * 60_000;
export const FAILURE_STREAK = 3;

const LIVE_JOB = new Set(["in_progress", "queued", "waiting", "pending", "requested"]);
const minutes = (ms) => Math.floor(ms / 60_000);
const time = (value) => (value ? Date.parse(value) : Number.NaN);
// "Resolve PR #1145" and "Resolve PR #1126" are one matrix family.
export const jobFamily = (name) => String(name ?? "").replace(/#?\d+/g, "#").trim();

export const isFleetRun = (run) => FLEET_WORKFLOWS.has(basename(String(run?.path ?? "").split("@")[0]));

export function decideRun(run, jobs, now = Date.now()) {
  const none = { action: "none", reason: "" };
  if (run?.status !== "in_progress" || !isFleetRun(run)) return none;

  let oldest = null;
  for (const job of jobs) {
    if (job.status !== "in_progress") continue;
    const age = now - time(job.started_at);
    if (Number.isFinite(age) && (!oldest || age > oldest.age)) oldest = { job, age };
  }
  if (oldest && oldest.age >= JOB_LIMIT_MS + FORCE_GRACE_MS) {
    return { action: "force-cancel", reason: `job "${oldest.job.name}" has run ${minutes(oldest.age)} min; a normal cancel did not release it` };
  }
  if (oldest && oldest.age >= JOB_LIMIT_MS) {
    return { action: "cancel", reason: `job "${oldest.job.name}" has run ${minutes(oldest.age)} min, over the ${minutes(JOB_LIMIT_MS)} min limit` };
  }

  const families = new Map();
  for (const job of jobs) {
    const family = jobFamily(job.name);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(job);
  }
  for (const [family, members] of families) {
    if (members.length <= FAILURE_STREAK) continue;
    const completed = members
      .filter((job) => job.status === "completed" && Number.isFinite(time(job.completed_at)))
      .sort((a, b) => time(a.completed_at) - time(b.completed_at));
    const tail = completed.slice(-FAILURE_STREAK);
    const remaining = members.some((job) => LIVE_JOB.has(job.status));
    if (remaining && tail.length === FAILURE_STREAK && tail.every((job) => job.conclusion === "failure")) {
      return { action: "cancel", reason: `the last ${FAILURE_STREAK} "${family}" jobs all failed; stopping the rest of the batch so the lane is freed` };
    }
  }

  const live = jobs.some((job) => LIVE_JOB.has(job.status));
  const idleFor = now - time(run.updated_at);
  if (!live && Number.isFinite(idleFor) && idleFor >= JOB_LIMIT_MS) {
    return { action: "force-cancel", reason: `run reports in_progress but has had no live job for ${minutes(idleFor)} min` };
  }
  return none;
}

class BudgetExhausted extends Error {}

async function github(path, { method = "GET", token, apiUrl }) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (response.ok) return response.status === 204 || response.status === 202 ? null : response.json();
  const body = await response.text();
  // A shared installation budget is never a stuck run; defer to the next pass.
  if ((response.status === 403 || response.status === 429) && /rate limit/i.test(body)) throw new BudgetExhausted(body.slice(0, 200));
  throw new Error(`${method} ${path} -> HTTP ${response.status}: ${body.slice(0, 200)}`);
}

async function paged(path, key, options, maxPages = 3) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await github(`${path}${separator}per_page=100&page=${page}`, options);
    items.push(...(data?.[key] ?? []));
    if ((data?.[key] ?? []).length < 100) break;
  }
  return items;
}

export async function sweep({ repo, token, apiUrl = "https://api.github.com", dryRun = false, now = Date.now(), log = console.log }) {
  const options = { token, apiUrl };
  const actions = [];
  try {
    const runs = (await paged(`/repos/${repo}/actions/runs?status=in_progress`, "workflow_runs", options)).filter(isFleetRun);
    for (const run of runs) {
      const jobs = await paged(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest`, "jobs", options);
      const decision = decideRun(run, jobs, now);
      if (decision.action === "none") continue;
      log(`${dryRun ? "[dry run] " : ""}${decision.action} run ${run.id} (${run.display_title ?? run.name}): ${decision.reason}`);
      actions.push({ id: run.id, ...decision });
      if (!dryRun) await github(`/repos/${repo}/actions/runs/${run.id}/${decision.action}`, { ...options, method: "POST" });
    }
    if (!actions.length) log(`No stuck Lopu runs among ${runs.length} in-progress fleet run(s).`);
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    log(`::notice::GitHub's shared installation API budget is exhausted; the next sweep will retry. ${error.message}`);
  }
  return actions;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo || !token) {
    console.error("::error::GITHUB_REPOSITORY and GH_TOKEN are required.");
    process.exit(1);
  }
  await sweep({ repo, token, apiUrl: process.env.GITHUB_API_URL || undefined, dryRun: process.env.SWEEPER_DRY_RUN === "true" });
}
