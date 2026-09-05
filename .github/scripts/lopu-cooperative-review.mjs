#!/usr/bin/env node
// Cooperative scheduling only: never send signals, cancel runs, or bypass the
// fleet lock. GitHub's durable pending members are the coalesced wrap-up request.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const quantumMs = 5 * 60_000;
const pollMs = 60_000;
const numbers = (items) => {
  if (!Array.isArray(items) || items.length > 500
    || items.some((n) => !Number.isSafeInteger(n) || n <= 0) || new Set(items).size !== items.length) {
    throw new Error("Invalid continuation PR inventory");
  }
  return [...items].sort((a, b) => a - b);
};
const safeRepo = (repo) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error("Invalid repository");
  return repo;
};

export function continuationNumbers(id = "") {
  if (!id.startsWith("lopu-review:yield:")) return null;
  if (id.length > 8_000 || !/^lopu-review:yield:[1-9][0-9]*:[1-9][0-9]*(,[1-9][0-9]*)*$/.test(id)) {
    throw new Error("Invalid review continuation");
  }
  return numbers(id.split(":")[3].split(",").map(Number));
}

export function selectContinuation(candidates, id) {
  const remaining = continuationNumbers(id);
  return remaining === null ? candidates : candidates.filter((pr) => remaining.includes(pr.number));
}

export function yieldRequested(queue, runId, elapsedMs) {
  if (elapsedMs < quantumMs || !Array.isArray(queue?.group_members)
    || queue.total_count !== queue.group_members.length) return false;
  const owners = queue.group_members.filter((member) => member.status === "in_progress");
  if (owners.length !== 1 || owners[0].run_id !== Number(runId)
    || !/(^| \/ )Lopu reviews selected PRs$/.test(owners[0].job_name || "")) return false;
  return queue.group_members.some((member) => member.status === "pending"
    && Number.isSafeInteger(member.run_id) && member.run_id > 0
    && Number.isSafeInteger(member.job_id) && member.job_id > 0
    && member.job_id !== owners[0].job_id);
}

function api(path, body) {
  const args = ["api", path];
  if (body) args.push("--method", "POST", "--input", "-");
  try {
    const output = execFileSync("gh", args, {
      encoding: "utf8", input: body ? JSON.stringify(body) : undefined,
      stdio: ["pipe", "pipe", "pipe"], timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch {
    // Never echo API bodies, hook inputs, prompts, or credential environments.
    throw new Error("GitHub handover metadata request failed");
  }
}

const paths = (dir) => ({
  state: join(dir, "lopu-review-cooperative-state.json"),
  manifest: join(dir, "lopu-review-manifest.json"),
  publish: join(dir, "lopu-review-publish-manifest.json"),
  receipt: join(dir, "lopu-review-handoff.json"),
  settings: join(dir, "lopu-review-cooperative-settings.json"),
});
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const completedReport = (path) => existsSync(path) && lstatSync(path).isFile()
  && !lstatSync(path).isSymbolicLink() && readFileSync(path, "utf8").trim().length > 0;

export const HANDOVER_INSTRUCTIONS = `Cooperative Lopu scheduling (trusted controller policy):
Before each new PR, and periodically during longer work, run the controller's
lopu-cooperative-review.mjs check command shown below. Other pending fleet jobs
request one wrap-up after a five-minute useful-work quantum. This is NOT an
instruction to cancel a process, interrupt a command, or drop unfinished edits.
Answer the exact triggering human comment first, if this is a conversation run.
Once wrap-up is requested, finish the PR you are currently handling, run its
focused validation, and write its normal review report only when it is complete.
Do not start another PR or optional investigation. Leave untouched PRs without
reports. Do not return while a touched PR lacks its completed report, while a
merge/rebase is in progress, or while your controller repair is unfinished.
Leave completed edits uncommitted for the EXISTING trusted publisher and its
exact-head lease; do not push or relax its safeguards. Then end your model turn
normally. The controller publishes completed work, records remaining PR numbers,
and queues one continuation behind other work, re-reading live heads on resume.
Do not mark deferred PRs reviewed. Never treat a handover as an error/retry or as
permission to abandon validation. Atomic repairs must reach a safe boundary.`;

export function initialize(dir, prompt, now = Date.now()) {
  const p = paths(dir);
  writeJson(p.state, { version: 1, startedAt: now, lastPoll: 0, lastReminder: 0, requested: false });
  const command = `node ${shellQuote(fileURLToPath(import.meta.url))}`;
  const settings = { hooks: Object.fromEntries(["PostToolUse", "PostToolUseFailure", "Stop"].map((event) => [event, [{
    ...(event === "Stop" ? {} : { matcher: "*" }),
    hooks: [{ type: "command", command: `${command} hook`, timeout: 20 }],
  }]])) };
  writeJson(p.settings, settings);
  return { settings: p.settings, prompt: `${prompt}\n\n${HANDOVER_INSTRUCTIONS}\nCheckpoint command: ${command} check\n` };
}

function git(path, args) {
  return execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
    env: { ...process.env, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_KEY_1: "core.fsmonitor", GIT_CONFIG_VALUE_1: "false" },
  }).trim();
}

export function partitionReview(dir, manifest) {
  numbers(manifest.map((pr) => pr.number));
  const completed = [], remaining = [];
  for (const pr of manifest) {
    const root = realpathSync(resolve(dir, "lopu-review-worktrees"));
    const checkout = realpathSync(pr.path), subpath = relative(root, checkout);
    if (!subpath || subpath.startsWith("..") || resolve(root, subpath) !== checkout
      || lstatSync(pr.path).isSymbolicLink() || realpathSync(git(pr.path, ["rev-parse", "--show-toplevel"])) !== checkout) {
      throw new Error("Review worktree is outside its trusted checkout root");
    }
    const report = join(dir, "lopu-review-reports", `${pr.number}.md`);
    const hasReport = completedReport(report);
    const activeOperation = ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply"]
      .some((name) => existsSync(git(pr.path, ["rev-parse", "--path-format=absolute", "--git-path", name])));
    if (activeOperation || git(pr.path, ["diff", "--name-only", "--diff-filter=U"])) {
      throw new Error(`PR #${pr.number} must finish its atomic Git operation before handover`);
    }
    if (hasReport) completed.push(pr);
    else {
      if (git(pr.path, ["status", "--porcelain", "--untracked-files=normal"])
        || git(pr.path, ["rev-parse", "HEAD"]) !== pr.head_sha) {
        throw new Error(`PR #${pr.number} has unpublished work without a completed review report; finish it before handover`);
      }
      remaining.push(pr.number);
    }
  }
  if (!completed.length && remaining.length) throw new Error("Finish and report at least one PR before yielding; avoid a no-progress continuation loop");
  const controller = process.env.GITHUB_WORKSPACE && join(process.env.GITHUB_WORKSPACE, "trusted");
  if (controller && existsSync(controller)
    && git(controller, ["status", "--porcelain", "--untracked-files=normal", "--", ".github"])
    && !completedReport(join(dir, "lopu-workflow-fix.md"))) {
    throw new Error("Finish and document the touched controller repair before handover");
  }
  return { completed, remaining: numbers(remaining) };
}

export async function checkpoint(dir, { runId, repo, event = "check", now = Date.now(), read = api } = {}) {
  const p = paths(dir), lock = `${p.state}.lock`;
  try { mkdirSync(lock); }
  catch (error) { if (error.code === "EEXIST") return ""; throw error; }
  try {
  const state = readJson(p.state);
  if (!state.requested && now - state.startedAt >= quantumMs && now - state.lastPoll >= pollMs) {
    state.lastPoll = now;
    writeJson(p.state, state);
    try {
      const queue = await read(`repos/${safeRepo(repo)}/actions/concurrency_groups/${encodeURIComponent(`lopu-agent-fleet-${repo}`)}`);
      state.requested = yieldRequested(queue, runId, now - state.startedAt);
      if (state.requested) state.requestedAt = now;
    } catch { /* Keep working safely; unavailable metadata is not a yield request. */ }
  }
  let message = "";
  if (state.requested && (event === "check" || event === "Stop" || now - state.lastReminder >= pollMs)) {
    message = "Lopu handover requested: other work is waiting in the serialized fleet. Finish and validate your current PR, write its completed report, then end normally for the trusted publisher. Do not start another PR, cancel work, or discard partial changes.";
    if (event === "Stop") {
      try { partitionReview(dir, readJson(p.manifest)); }
      catch (error) { message = `Handover is not safe yet: ${error.message}. Complete the touched work and report before ending.`; }
      // No Stop feedback at an actually safe boundary: allow the turn to end.
      if (message.startsWith("Lopu handover requested:")) message = "";
    }
    state.lastReminder = now;
  }
  writeJson(p.state, state);
  return message;
  } finally { rmdirSync(lock); }
}

export function finalize(dir) {
  const p = paths(dir);
  if (!existsSync(p.state) || !readJson(p.state).requested) return { manifest: p.manifest, remaining: "" };
  const { completed, remaining } = partitionReview(dir, readJson(p.manifest));
  writeJson(p.publish, completed);
  writeJson(p.receipt, { version: 1, completed: completed.map((pr) => pr.number), remaining });
  return { manifest: p.publish, remaining: remaining.join(","), receipt: p.receipt };
}

export async function requeue(dir, { environment = process.env, read, send = api } = {}) {
  const { remaining } = readJson(paths(dir).receipt);
  const rest = numbers(remaining);
  if (!rest.length) return;
  const repo = safeRepo(environment.REPO), runId = environment.GITHUB_RUN_ID;
  if (!/^[1-9][0-9]*$/.test(runId || "")) throw new Error("Invalid handover run id");
  const { findPendingReview, readGitHub } = await import("./lopu-review-queue.mjs");
  const queued = await findPendingReview({ repo, prNumber: environment.SELECTED_PR || "", branch: environment.SELECTED_BRANCH || "", eventName: "handover", read: read || readGitHub });
  if (queued) {
    console.log(`An unstarted full-scope review already covers the remaining PRs: ${queued}`);
    return;
  }
  const id = `lopu-review:yield:${runId}:${rest.join(",")}`;
  continuationNumbers(id);
  await send(`repos/${repo}/actions/workflows/resolve-pr-conflicts.yml/dispatches`, {
    ref: "github-actions", inputs: { pr_number: environment.SELECTED_PR || "", branch: environment.SELECTED_BRANCH || "",
      detector_handoff: true, manual_retry: false, depth: "0", control_dispatch_id: id },
  });
  console.log(`Queued one cooperative continuation for ${rest.length} remaining PR(s).`);
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    const delimiter = randomUUID();
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  try {
    const dir = process.env.RUNNER_TEMP;
    if (mode === "select") console.log(JSON.stringify(selectContinuation(JSON.parse(process.env.CANDIDATES), process.env.REVIEW_DISPATCH_ID)));
    else if (!dir) throw new Error("Missing runner temporary directory");
    else if (mode === "initialize") output(initialize(dir, process.env.LOPU_PROMPT || ""));
    else if (mode === "finalize") output(finalize(dir));
    else if (mode === "requeue") await requeue(dir);
    else if (["hook", "check"].includes(mode)) {
      const input = mode === "hook" ? JSON.parse(readFileSync(0, "utf8")) : {};
      const event = mode === "hook" ? input.hook_event_name : "check";
      if (!["PostToolUse", "PostToolUseFailure", "Stop", "check"].includes(event)) throw new Error("Unexpected hook event");
      const message = await checkpoint(dir, { runId: process.env.GITHUB_RUN_ID, repo: process.env.GITHUB_REPOSITORY, event });
      if (mode === "check") console.log(message || "No handover requested; continue the current review.");
      else console.log(JSON.stringify(message ? { hookSpecificOutput: { hookEventName: event, additionalContext: message } } : {}));
    } else throw new Error("Unknown cooperative review command");
  } catch (error) {
    if (mode === "hook") console.log("{}"); // Never terminate a tool on a failed metadata read.
    else { console.error(`::error::${error.message}`); process.exitCode = 1; }
  }
}
