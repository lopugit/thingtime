import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint, continuationNumbers, finalize, initialize, partitionReview, requeue, selectContinuation, yieldRequested } from "./lopu-cooperative-review.mjs";

const fiveMinutes = 300_000;
const queue = { total_count: 2, group_members: [
  { run_id: 123, job_id: 111, job_name: "Lopu reviews selected PRs", status: "in_progress" },
  { run_id: 124, job_id: 112, job_name: "Resolve PR #11", status: "pending" },
] };
const withTemp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "lopu-cooperative-test-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (dir, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
function worktree(dir, number) {
  const path = join(dir, "lopu-review-worktrees", `pr-${number}`);
  mkdirSync(path, { recursive: true });
  git(path, "init", "--quiet");
  writeFileSync(join(path, "source.txt"), "original\n");
  git(path, "add", "source.txt");
  git(path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "initial");
  return { number, path, head_sha: git(path, "rev-parse", "HEAD") };
}
function report(dir, number) {
  mkdirSync(join(dir, "lopu-review-reports"), { recursive: true });
  writeFileSync(join(dir, "lopu-review-reports", `${number}.md`), "Completed review; focused tests passed.\n");
}
function request(dir) {
  const path = join(dir, "lopu-review-cooperative-state.json");
  writeFileSync(path, JSON.stringify({ ...json(path), requested: true }));
}

test("only the active review owner yields, after a useful-work quantum and with real pending jobs", () => {
  assert.equal(yieldRequested(queue, "123", fiveMinutes - 1), false);
  assert.equal(yieldRequested(queue, "123", fiveMinutes), true);
  assert.equal(yieldRequested(queue, "999", fiveMinutes), false);
  assert.equal(yieldRequested({ ...queue, total_count: 3 }, "123", fiveMinutes), false);
  assert.equal(yieldRequested({ total_count: 0, group_members: [] }, "123", fiveMinutes), false);
  for (const status of ["completed", "in_progress"]) {
    const changed = structuredClone(queue); changed.group_members[1].status = status;
    assert.equal(yieldRequested(changed, "123", fiveMinutes), false);
  }
  const atomic = structuredClone(queue); atomic.group_members[0].job_name = "Resolve PR #11";
  assert.equal(yieldRequested(atomic, "123", fiveMinutes), false, "atomic conflict repairs are not interrupted");
});

test("setup gives both providers a checkpoint command and Claude non-interrupting tool hooks", async () => withTemp(async (dir) => {
  const setup = initialize(dir, "Review the selected PRs.", 0);
  assert.match(setup.prompt, /Review the selected PRs/);
  assert.match(setup.prompt, /Do not start another PR/);
  assert.match(setup.prompt, /EXISTING trusted publisher/);
  const settings = json(setup.settings);
  assert.deepEqual(Object.keys(settings.hooks), ["PostToolUse", "PostToolUseFailure", "Stop"]);
  assert.equal(settings.hooks.Stop[0].matcher, undefined);
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].timeout, 20);
  assert.match(settings.hooks.Stop[0].hooks[0].command, /lopu-cooperative-review.mjs' hook$/);
  assert.doesNotMatch(JSON.stringify(settings), /kill|cancel|permissionDecision/);
}));

test("pending work requests wrap-up once; metadata reads and reminders are debounced", async () => withTemp(async (dir) => {
  initialize(dir, "Review.", 0);
  let reads = 0;
  const read = async (path) => { reads++; assert.match(path, /lopu-agent-fleet-example%2Fproject$/); return queue; };
  const input = { runId: "123", repo: "example/project", event: "PostToolUse", read };
  assert.equal(await checkpoint(dir, { ...input, now: 299_999 }), "");
  assert.equal(reads, 0);
  assert.match(await checkpoint(dir, { ...input, now: 300_000 }), /handover requested/);
  assert.equal(await checkpoint(dir, { ...input, now: 300_001 }), "");
  assert.match(await checkpoint(dir, { ...input, now: 360_000 }), /handover requested/);
  assert.equal(reads, 1, "latched requests do not repeatedly poll or reset the quantum");
}));

test("parallel tool completions cannot reset a latched request or multiply API reads", async () => withTemp(async (dir) => {
  initialize(dir, "Review.", 0);
  let reads = 0;
  const read = async () => { reads++; await new Promise((resolve) => setTimeout(resolve, 10)); return queue; };
  await Promise.all([1, 2, 3].map(() => checkpoint(dir, { runId: "123", repo: "example/project", now: 300_000, read })));
  assert.equal(reads, 1);
  assert.equal(json(join(dir, "lopu-review-cooperative-state.json")).requested, true);
}));

test("unavailable queue metadata never interrupts work and retries only on a later checkpoint", async () => withTemp(async (dir) => {
  initialize(dir, "Review.", 0);
  let reads = 0;
  const read = async () => { reads++; throw new Error("unavailable"); };
  const input = { runId: "123", repo: "example/project", read };
  assert.equal(await checkpoint(dir, { ...input, now: 300_000 }), "");
  assert.equal(await checkpoint(dir, { ...input, now: 300_001 }), "");
  assert.equal(reads, 1);
  await checkpoint(dir, { ...input, now: 360_000 });
  assert.equal(reads, 2);
}));

test("checkpoint publishes only completed PRs and preserves a metadata-only remainder receipt", async () => withTemp(async (dir) => {
  initialize(dir, "Review.", 0);
  const first = worktree(dir, 11), second = worktree(dir, 12);
  writeFileSync(join(first.path, "source.txt"), "validated improvement\n");
  report(dir, 11);
  writeFileSync(join(dir, "lopu-review-manifest.json"), JSON.stringify([first, second]));
  request(dir);
  const result = finalize(dir);
  assert.deepEqual(json(result.manifest), [first]);
  assert.equal(result.remaining, "12");
  assert.deepEqual(json(result.receipt), { version: 1, completed: [11], remaining: [12] });
  assert.equal(readFileSync(join(first.path, "source.txt"), "utf8"), "validated improvement\n", "never discards changes");
  assert.equal(git(first.path, "rev-parse", "HEAD"), first.head_sha, "never commits or pushes itself");
  assert.equal(await checkpoint(dir, { runId: "123", repo: "example/project", event: "Stop", now: 400_000 }), "", "safe Stop is allowed");
}));

test("unfinished edits block handover instead of being discarded or blindly published", async () => withTemp(async (dir) => {
  initialize(dir, "Review.", 0);
  const pr = worktree(dir, 11);
  writeFileSync(join(pr.path, "source.txt"), "unfinished\n");
  writeFileSync(join(dir, "lopu-review-manifest.json"), JSON.stringify([pr]));
  request(dir);
  assert.throws(() => finalize(dir), /unpublished work/);
  assert.equal(existsSync(join(dir, "lopu-review-publish-manifest.json")), false);
  assert.match(await checkpoint(dir, { runId: "123", repo: "example/project", event: "Stop", now: 400_000 }), /not safe yet/);
  assert.equal(readFileSync(join(pr.path, "source.txt"), "utf8"), "unfinished\n");
}));

test("a report cannot authorize yielding in the middle of a Git operation", async () => withTemp(async (dir) => {
  const pr = worktree(dir, 11); report(dir, 11);
  writeFileSync(join(pr.path, ".git", "MERGE_HEAD"), `${pr.head_sha}\n`);
  assert.throws(() => partitionReview(dir, [pr]), /atomic Git operation/);
}));

test("no request leaves the existing complete-review publication behavior unchanged", async () => withTemp(async (dir) => {
  initialize(dir, "Review.", 0);
  assert.deepEqual(finalize(dir), { manifest: join(dir, "lopu-review-manifest.json"), remaining: "" });
}));

test("repeated queue pressure cannot create an endless zero-progress continuation", async () => withTemp(async (dir) => {
  const pr = worktree(dir, 11);
  assert.throws(() => partitionReview(dir, [pr]), /at least one PR/);
}));

test("continuations re-read live candidates but cannot expand the original selector", () => {
  const id = "lopu-review:yield:123:11,12";
  assert.deepEqual(continuationNumbers(id), [11, 12]);
  assert.deepEqual(selectContinuation([{ number: 12, head_sha: "new" }, { number: 13 }], id), [{ number: 12, head_sha: "new" }]);
  assert.equal(continuationNumbers("lopu-review:issue-comment:55:123"), null);
  for (const bad of ["lopu-review:yield:123:", "lopu-review:yield:0:11", "lopu-review:yield:123:11,11", "lopu-review:yield:123:0", "lopu-review:yield:123:1e3"]) {
    assert.throws(() => continuationNumbers(bad), /Invalid/);
  }
});

test("workflow publishes the checkpoint before requeue and never marks untouched PRs reviewed", () => {
  const workflow = readFileSync(new URL("../workflows/resolve-pr-conflicts.yml", import.meta.url), "utf8");
  const action = readFileSync(new URL("../actions/lopu-agent/action.yml", import.meta.url), "utf8");
  assert.match(workflow, /cooperative-review: 'true'/);
  assert.match(workflow, /Lopu continues a checkpointed PR review/);
  assert.match(workflow, /CANDIDATES="\$candidates" node .*lopu-cooperative-review.mjs select/);
  const checkpoint = workflow.indexOf("name: Checkpoint completed reviews before publishing");
  const publish = workflow.indexOf("name: Commit and push Lopu's justified PR improvements");
  const resume = workflow.indexOf("name: Queue remaining reviews behind waiting work");
  assert.ok(checkpoint > 0 && checkpoint < publish && publish < resume);
  assert.equal((workflow.match(/MANIFEST: \$\{\{ steps.review_checkpoint.outputs.manifest \}\}/g) || []).length, 3);
  assert.match(workflow.slice(resume), /steps.publish.outcome == 'success'/);
  assert.match(workflow, /path: \$\{\{ steps.review_checkpoint.outputs.receipt \}\}/);
  assert.equal((action.match(/settings: \$\{\{ steps.handoff.outputs.settings \|\| '' \}\}/g) || []).length, 8);
  assert.equal((action.match(/prompt: \$\{\{ steps.handoff.outputs.prompt \|\| inputs.prompt \}\}/g) || []).length, 9);
});

test("remaining work dispatches once against the protected controller, with only its original PR inventory", async () => withTemp(async (dir) => {
  writeFileSync(join(dir, "lopu-review-handoff.json"), JSON.stringify({ remaining: [12, 13] }));
  const environment = { REPO: "example/project", GITHUB_RUN_ID: "123", SELECTED_BRANCH: "develop" };
  const sent = [];
  const read = async () => ({ total_count: 0, group_members: [] });
  await requeue(dir, { environment, read, send: async (...args) => sent.push(args) });
  assert.deepEqual(sent, [["repos/example/project/actions/workflows/resolve-pr-conflicts.yml/dispatches", {
    ref: "github-actions", inputs: { pr_number: "", branch: "develop", detector_handoff: true,
      manual_retry: false, depth: "0", control_dispatch_id: "lopu-review:yield:123:12,13" },
  }]]);
  const fail = async () => { throw new Error("ambiguous dispatch"); };
  await assert.rejects(requeue(dir, { environment, read, send: fail }), /ambiguous dispatch/);
  assert.deepEqual(json(join(dir, "lopu-review-handoff.json")).remaining, [12, 13]);
}));

test("an unstarted full-scope waiter covers continuation; incomplete metadata never dispatches duplicates", async () => withTemp(async (dir) => {
  writeFileSync(join(dir, "lopu-review-handoff.json"), JSON.stringify({ remaining: [12] }));
  const environment = { REPO: "example/project", GITHUB_RUN_ID: "123" };
  let sent = 0;
  const read = async (path) => {
    if (path.includes("concurrency_groups")) return { total_count: 1, group_members: [{ run_id: 124, status: "in_progress" }] };
    if (path.includes("/jobs")) return [{ total_count: 1, jobs: [{ name: "Lopu reviews selected PRs", status: "pending", steps: [] }] }];
    return { event: "workflow_dispatch", head_branch: "github-actions", actor: { login: "github-actions[bot]" },
      path: ".github/workflows/resolve-pr-conflicts.yml", display_title: "Lopu reviews all eligible PRs from the control plane", status: "in_progress" };
  };
  await requeue(dir, { environment, read, send: async () => sent++ });
  assert.equal(sent, 0);
  await assert.rejects(requeue(dir, { environment, read: async () => ({ total_count: 1, group_members: [] }),
    send: async () => sent++ }), /Incomplete/);
  assert.equal(sent, 0);
}));
