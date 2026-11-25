#!/usr/bin/env node

// Deterministically rebuild the wildcard `all` branch.
//
// `all` = develop + main + every open, same-repo pull request (stacked
// branch → branch PRs included) merged together, so all in-progress work can
// be tried — and Vercel-previewed — in one place. Design notes:
//
// - Full rebuild, not accretion: every run recreates `all` from the current
//   base tips and open-PR set, so closed/merged PRs fall out on their own and
//   the branch never accumulates resolution debt. The result is force-pushed,
//   but only when the rebuilt *tree* differs from the pushed one — reruns with
//   identical inputs are no-ops and do not retrigger Vercel.
// - Merge order is stack-aware: PRs based on develop/main first, then PRs
//   based on those PRs' heads, and so on, ascending PR number within a layer.
//   Later merges win contested hunks via `-X theirs`, with a matching
//   theirs-biased fallback for the conflicts strategy options cannot settle
//   (modify/delete, directory/file, and `-merge`-attributed paths). A PR whose
//   merge cannot complete at all is skipped and reported, never fatal.
// - `graphify-out/` is generated state, not union source. Every PR merge pins
//   that entire subtree back to its pre-merge value, so legacy mutable caches,
//   content-addressed snapshots, and root aliases cannot conflict or balloon
//   the synthetic branch. The graph/manifest pair is intentionally the
//   primary base's snapshot on `all`; nothing runs `graphify update` there.
// - `.github` is pinned to develop's copy: workflows never execute on `all`
//   (GITHUB_TOKEN pushes trigger no workflows, and schedules only run from the
//   default branch), and the pin keeps the force-push inside the default
//   token's powers — GitHub refuses GITHUB_TOKEN pushes that change
//   .github/workflows/** content. When develop's own workflow files changed
//   since the last `all` push, that normalized delta still trips the refusal;
//   the fallback then re-pins `.github` to the previously pushed `all` state
//   and retries, leaving those files stale-but-inert until a workflow-scoped
//   credential next rebuilds the branch.
// - Fork PRs are excluded by default: `all` deploys through this repo's
//   Vercel project, and routing unreviewed fork code into it would bypass
//   Vercel's own fork-authorization step. Label a PR `no-all` to opt it out of
//   the union explicitly.
// - Build doctor: textually-clean merges can still collide semantically (two
//   PRs adding the same helper, duplicate imports), which breaks the union
//   build even though no git conflict ever existed. The workflow runs the
//   union build after each rebuild; on failure a capped, edit-files-only AI
//   round (house resolver pattern) fixes the working tree, this script guards
//   and commits it, and the build is re-verified mechanically. Doctor commits
//   ride on `all` itself: the next rebuild cherry-pick-replays them, and a
//   fixup that stops applying (the source PRs healed) is dropped silently.
//   Rebuild dedup compares the *manifest commit* trees, so unchanged inputs
//   skip the build check and AI entirely.
//
// - Fleet split: only the model-backed doctor may hold Lopu's serialized
//   agent-fleet lane, so the workflow runs `build` + the first `check` in a
//   deterministic job and hands a repairable failure to a separate doctor job.
//   `handoff` packs every object this checkout created locally (the union
//   commits plus the dirty working tree; fetched promisor objects stay on
//   origin) beside the exact input tips, state, and build log. `doctor-admit`
//   stands down without model spend when any recorded tip moved while it
//   waited for the fleet; otherwise it fetches the same inputs, imports the
//   pack, restores and verifies the exact working tree, and arms a
//   --force-with-lease push against the `all` tip the rebuild replayed from.
//
// Modes (argv[2]): `build` (default) rebuild + replay + dedup decision;
// `check` run the union build (install → build:client → build:server) with
// mechanical lockfile repair; `handoff --out DIR` export a failing union for
// the doctor job; `doctor-admit --from DIR` restore it there (or stand down
// when it is stale); `doctor-install` give round 1 the same node_modules the
// build job's check had; `doctor-commit --round N` guard + commit the model's
// working-tree edits; `doctor-record` note an exhausted doctor; `push` final
// force-push (leased after `doctor-admit`) with the .github re-pin fallback
// and summary.
//
// Requirements: a pushable `origin` checkout of the repo, plus `gh` auth
// (GH_TOKEN in Actions) for PR listing. Tunables: ALL_BRANCH_NAME (all),
// ALL_BASE_BRANCHES ("develop main" — the first entry is the starting point),
// ALL_SKIP_LABEL (no-all), ALL_INCLUDE_FORKS=1, ALL_PUSH=0 (build without
// pushing). Outside GitHub Actions the script refuses to run without
// ALL_BRANCH_FORCE=1 because it hard-switches branches in the current
// checkout.
//
// `--self-test` runs the pure planning/rendering examples and exits.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ALL_BRANCH = process.env.ALL_BRANCH_NAME || "all";
const BASE_BRANCHES = (process.env.ALL_BASE_BRANCHES || "develop main")
  .split(/\s+/)
  .filter(Boolean);
const SKIP_LABEL = process.env.ALL_SKIP_LABEL || "no-all";
const INCLUDE_FORKS = process.env.ALL_INCLUDE_FORKS === "1";
const PUSH = process.env.ALL_PUSH !== "0";
const REPOSITORY = process.env.GITHUB_REPOSITORY || "lopugit/thingtime";
const REMOTE_ALL_REF = "refs/all-build/remote-all";
const STATE_DIR = ".all-doctor";
const STATE_FILE = `${STATE_DIR}/state.json`;
const BUILD_LOG = `${STATE_DIR}/build.log`;
const DOCTOR_SUBJECT_PREFIX = "all: build doctor";
const MANIFEST_SUBJECT_PREFIX = "all: manifest (";
const MAX_REPLAYED_DOCTOR_COMMITS = 30;
// Files the build job hands to the doctor job (one artifact directory).
const HANDOFF_VERSION = 1;
const HANDOFF_FILE = "handoff.json";
const HANDOFF_PACK = "union.pack";
const HANDOFF_STATE = "state.json";
const HANDOFF_LOG = "build.log";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

// The fast path keeps the checkout blobless. If Git asks the promisor remote
// for an object GitHub no longer serves lazily, materialize the exact live
// base and PR refs once and retry the affected merge. The refspec list is
// populated from the same live `gh pr list` snapshot used for the build.
let completeRefspecs = [];
let completeRefetchAttempted = false;

// Override the repo's graphify union merge driver (the binary is not
// installed here). The entire derived subtree is pinned to the pre-merge
// state below, so an attributed graph.json should keep ours as well.
const MERGE_CONFIG = [
  "-c",
  "merge.graphify.name=all-branch keep-derived-base override",
  "-c",
  "merge.graphify.driver=true",
];

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
const git = (...args) => run("git", args).replace(/\n$/, "");
const tryGit = (...args) =>
  spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// Checkouts run with persist-credentials: false, so network git operations
// authenticate through an ephemeral credential helper reading GH_TOKEN from
// the environment (anonymous outside Actions, where ambient auth applies).
const gitAuthConfig = () =>
  process.env.GITHUB_ACTIONS === "true" && process.env.GH_TOKEN
    ? ["-c", "credential.helper=", "-c", 'credential.helper=!f() { echo "username=x-access-token"; echo "password=${GH_TOKEN}"; }; f']
    : [];

const singleLine = (text, max = 120) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const tableCell = (text) => singleLine(text).replaceAll("|", "\\|");

export function isPromisorFetchFailure(...parts) {
  const text = parts.map((part) => String(part ?? "")).join("\n");
  return (
    /remote error: upload-pack: not our ref [0-9a-f]{40}/i.test(text) ||
    /could not fetch [0-9a-f]{40} from promisor remote/i.test(text) ||
    /promisor remote[^\n]*failed/i.test(text)
  );
}

function refetchCompleteInputs() {
  if (completeRefetchAttempted || completeRefspecs.length === 0) return false;
  completeRefetchAttempted = true;
  console.warn(
    `build-all-branch: lazy promisor fetch failed; refetching ${completeRefspecs.length} exact live ref(s) without a blob filter`
  );
  const refetch = spawnSync(
    "git",
    [
      ...gitAuthConfig(),
      "fetch",
      "--no-tags",
      "--force",
      "--refetch",
      "--no-filter",
      "origin",
      ...completeRefspecs,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "inherit", "pipe"] }
  );
  if (refetch.status === 0) return true;
  console.error(
    `build-all-branch: complete-history refetch failed: ${singleLine(refetch.stderr, 300)}`
  );
  return false;
}

// Only commits the doctor itself created are replayed onto the next rebuild;
// pins, manifests, and human commits never are. Pure: exercised by --self-test.
export function isReplayableDoctorSubject(subject) {
  return String(subject ?? "").startsWith(DOCTOR_SUBJECT_PREFIX);
}

// Exhausted-doctor marker commits (deliberately non-replayable). A leading
// streak of them on the pushed tip is the retry ledger: identical inputs get
// exactly one more doctoring attempt, then wait for any input change. Pure:
// exercised by --self-test.
export function countLeadingFailureMarkers(subjects) {
  let count = 0;
  for (const subject of subjects) {
    if (/still failing after doctor rounds$/.test(String(subject ?? ""))) count += 1;
    else break;
  }
  return count;
}

// Paths the doctor may never commit. The action's tool restrictions block the
// model from editing these; this mechanical layer catches anything that slips
// through. Pure: exercised by --self-test.
export function isForbiddenDoctorPath(path) {
  const p = String(path ?? "");
  if (
    p.startsWith(".github/") ||
    p.startsWith("graphify-out/") ||
    p.startsWith(`${STATE_DIR}/`) ||
    p.startsWith("control-plane/")
  ) {
    return true;
  }
  if (p === ".github" || p === STATE_DIR || p === "control-plane") return true;
  if (p === "ALL_BRANCH.md" || p === "AGENTS.md" || p === "CLAUDE.md") return true;
  const base = p.split("/").pop();
  return base === ".gitattributes" || base === "pnpm-lock.yaml" || base === "package-lock.json";
}

// The protected controller is a trusted nested checkout, so the outer repo
// reports it as one untracked `control-plane/` entry. Preserve that exact root
// between doctor rounds; its contents remain forbidden and the staging/clean
// commands exclude the directory mechanically.
export function shouldRevertDoctorStatusPath(path) {
  const p = String(path ?? "");
  if (p === "control-plane" || p === "control-plane/") return false;
  return isForbiddenDoctorPath(p);
}

// `git ls-remote` output → Map(ref → sha). Pure: exercised by --self-test.
export function parseLsRemote(text) {
  const refs = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const match = /^([0-9a-f]{40})\t(\S+)$/.exec(line.replace(/\r$/, ""));
    if (match) refs.set(match[2], match[1]);
  }
  return refs;
}

// The handoff crosses a job boundary as an artifact, so re-check its shape
// before any value reaches a git argument. Pure: exercised by --self-test.
export function validateHandoff(handoff, { allBranch, baseBranches }) {
  assert.equal(handoff?.version, HANDOFF_VERSION, "unsupported build-doctor handoff version");
  assert.equal(handoff.allBranch, allBranch, "handoff names a different union branch");
  for (const key of ["tip", "tree", "worktree"]) {
    assert.match(String(handoff[key] ?? ""), SHA_PATTERN, `handoff ${key} must be a full object id`);
  }
  assert.ok(
    handoff.remoteTip === "" || SHA_PATTERN.test(String(handoff.remoteTip ?? "")),
    "handoff remoteTip must be empty or a full commit id"
  );
  assert.ok(Array.isArray(handoff.bases) && Array.isArray(handoff.pulls), "handoff must record its input tips");
  assert.deepEqual(
    handoff.bases.map((base) => base?.branch),
    baseBranches,
    "handoff bases must be this builder's base branches, in order"
  );
  for (const { sha } of handoff.bases) assert.match(String(sha ?? ""), SHA_PATTERN, "base tips must be full commit ids");
  const seen = new Set();
  for (const pull of handoff.pulls) {
    assert.ok(Number.isSafeInteger(pull?.number) && pull.number > 0, "PR numbers must be positive integers");
    assert.ok(!seen.has(pull.number), `PR #${pull.number} is recorded twice`);
    seen.add(pull.number);
    assert.match(String(pull.sha ?? ""), SHA_PATTERN, `PR #${pull.number} head must be a full commit id`);
  }
  return handoff;
}

// Decide whether a queued doctor may still repair its handoff. The doctor can
// wait in the fleet for a long time; if any input it was built from moved, the
// pending rebuild (every base push and PR event, plus the hourly schedule,
// queues one) owns the branch and this one stands down before spending a
// model round. Pure: exercised by --self-test.
export function decideDoctorAdmission(handoff, liveRefs, { allBranch }) {
  const live = (ref) => liveRefs.get(ref) ?? "";
  const short = (sha) => (sha ? sha.slice(0, 7) : "(missing)");
  const moved = [];
  const liveAll = live(`refs/heads/${allBranch}`);
  if (liveAll !== handoff.remoteTip) {
    moved.push(`origin/${allBranch} moved from ${short(handoff.remoteTip)} to ${short(liveAll)}`);
  }
  for (const { branch, sha } of handoff.bases) {
    const now = live(`refs/heads/${branch}`);
    if (now !== sha) moved.push(`${branch} moved from ${short(sha)} to ${short(now)}`);
  }
  for (const { number, sha } of handoff.pulls) {
    const now = live(`refs/pull/${number}/head`);
    if (now !== sha) moved.push(`PR #${number} moved from ${short(sha)} to ${short(now)}`);
  }
  if (moved.length > 0) {
    const shown = moved.slice(0, 5).join("; ") + (moved.length > 5 ? `; and ${moved.length - 5} more` : "");
    return { admit: false, reason: `the union inputs changed while the doctor waited (${shown})` };
  }
  return { admit: true, reason: "", lease: handoff.remoteTip };
}

const workflowJobBlock = (text, key) => {
  const start = text.indexOf(`\n  ${key}:\n`);
  assert.notEqual(start, -1, `all-branch workflow must define the ${key} job`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 2);
};
const workflowSteps = (jobBlock) =>
  jobBlock
    .split(/\n(?=      - )/)
    .slice(1)
    .map((body) => ({ name: /^      - name: (.+)$/m.exec(body)?.[1] ?? "", body }));

// Keep the doctor internal to the one public Lopu manager. Push normalization
// lives in resolve-pr-conflicts.yml because provider actions reject push-event
// provenance even when the implementation is reached through workflow_call.
// Only the doctor job may join Lopu's serialized agent fleet; the deterministic
// build job must never run a model.
export function assertAllBranchWorkflowContract(workflowText) {
  const text = String(workflowText ?? "").replaceAll("\r\n", "\n");
  const triggerBlock = text.split("\npermissions:", 1)[0];
  assert.match(text, /^name: Lopu internal all-branch integration$/m, "the union doctor is branded as Lopu");
  assert.match(
    triggerBlock,
    /\non:\n  workflow_call:\n/,
    "all-branch workflow must remain callable by the public Lopu manager"
  );
  assert.doesNotMatch(
    triggerBlock,
    /^  (?:push|pull_request|pull_request_target|schedule|workflow_dispatch|repository_dispatch):/m,
    "all-branch workflow must not expose a second public trigger"
  );
  assert.doesNotMatch(text, /\n  handoff:\n/, "push normalization belongs to the public Lopu manager");
  const jobKeys = [...text.slice(text.indexOf("\njobs:\n")).matchAll(/\n  ([A-Za-z0-9_-]+):\n/g)].map((m) => m[1]);
  assert.deepEqual(jobKeys, ["build", "doctor"], "the union runs as one deterministic job and one doctor job");
  const build = workflowJobBlock(text, "build");
  const doctor = workflowJobBlock(text, "doctor");
  const fleetQueue = /group: lopu-agent-fleet-\$\{\{ github\.repository \}\}\n\s*queue: max\n\s*cancel-in-progress: false/;
  const modelUse = /uses: \.\/control-plane\/\.github\/actions\/lopu-agent\b|lopu-model-waterfall\.mjs|claude-args:|You are Lopu,/;

  for (const [label, block] of [["build", build], ["doctor", doctor]]) {
    assert.match(block, /if: github\.repository == 'lopugit\/thingtime'/, `${label} job stays on the canonical repository`);
    assert.match(block, /timeout-minutes: 60\n/, `${label} job keeps the sweeper's 60-minute bound`);
    assert.match(
      block,
      /name: Check out develop working tree[\s\S]*?fetch-depth: 0[\s\S]*?filter: blob:none[\s\S]*?persist-credentials: false/,
      `${label}: the union checkout keeps exact ancestry without eagerly downloading historical blobs`
    );
    const steps = workflowSteps(block);
    assert.equal(steps.at(-1)?.name, "Push the all branch", `${label}: the credential-helper push is the final step`);
    for (const step of steps) {
      if (/uses: actions\/checkout@/.test(step.body)) {
        assert.match(step.body, /persist-credentials: false/, `${label}: ${step.name} must not persist a token`);
      }
    }
  }

  // Fleet membership: exactly the doctor, never the deterministic rebuild.
  assert.equal(
    [...text.matchAll(/^\s*group: lopu-agent-fleet-/gm)].length,
    1,
    "only one job may join the Lopu agent fleet"
  );
  assert.match(doctor, fleetQueue, "the union doctor must share Lopu's durable single-agent fleet");
  assert.doesNotMatch(build, /group: lopu-agent-fleet-/, "the deterministic rebuild must not hold Lopu's agent fleet");
  assert.match(
    build,
    /concurrency:\n\s*group: lopu-all-branch-\$\{\{ github\.repository \}\}\n\s*cancel-in-progress: false/,
    "the deterministic rebuild runs in its own non-cancelling all-branch lane"
  );
  assert.doesNotMatch(build, modelUse, "no model may run in the deterministic rebuild job");
  for (const step of ["Rebuild the all branch", "Union build check", "Hand the failing union to the build doctor"]) {
    assert.ok(workflowSteps(build).some(({ name }) => name === step), `build job must run "${step}"`);
  }
  assert.match(build, /outputs:\n\s*handoff: \$\{\{ steps\.handoff\.outputs\.handoff \}\}/);
  assert.match(
    build,
    /id: handoff\n\s*if: >-\n\s*steps\.build\.outputs\.proceed == 'true'\n\s*&& steps\.check1\.outputs\.build_ok != 'true'\n\s*&& steps\.check1\.outputs\.ai_eligible == 'true'\n\s*&& steps\.backend\.outputs\.has_credential == 'true'\n\s*run: node control-plane\/\.github\/scripts\/build-all-branch\.mjs handoff --out "\$RUNNER_TEMP\/lopu-all-handoff"/,
    "only a repairable failure with a model credential is handed to the doctor"
  );
  for (const step of ["Record the doctor outcome", "Push the all branch"]) {
    const body = workflowSteps(build).find(({ name }) => name === step)?.body ?? "";
    assert.match(
      body,
      /if: steps\.build\.outputs\.proceed == 'true' && steps\.handoff\.outputs\.handoff != 'true'/,
      `build job "${step}" yields to the doctor whenever it handed off`
    );
  }
  const artifact = /name: (lopu-all-branch-doctor-handoff)\n/;
  assert.match(build, /uses: actions\/upload-artifact@[0-9a-f]{40}[\s\S]*?name: lopu-all-branch-doctor-handoff\n/);
  assert.match(doctor, /uses: actions\/download-artifact@[0-9a-f]{40}[\s\S]*?name: lopu-all-branch-doctor-handoff\n/);
  assert.equal(artifact.exec(build)?.[1], artifact.exec(doctor)?.[1]);

  assert.match(doctor, /\n    needs: build\n/, "the doctor runs after the deterministic rebuild");
  assert.match(
    doctor,
    /\n    if: github\.repository == 'lopugit\/thingtime' && needs\.build\.outputs\.handoff == 'true'\n/,
    "the doctor job (and its fleet wait) exists only for a handed-off failure"
  );
  const doctorSteps = workflowSteps(doctor);
  const stepIndex = (name) => doctorSteps.findIndex((step) => step.name === name);
  assert.ok(
    stepIndex("Admit the handoff and restore the failing union") !== -1 &&
      stepIndex("Admit the handoff and restore the failing union") < stepIndex("Load the build-doctor model waterfall"),
    "the doctor admits its handoff before any model is selected"
  );
  assert.ok(
    stepIndex("Admit the handoff and restore the failing union") < stepIndex("Install the union's dependencies for round 1") &&
      stepIndex("Install the union's dependencies for round 1") < stepIndex("Lopu build doctor round 1"),
    "round 1 sees the same installed dependencies the build job's check had"
  );
  assert.match(
    doctorSteps[stepIndex("Install the union's dependencies for round 1")]?.body ?? "",
    /if: steps\.admit\.outputs\.proceed == 'true'\n\s*run: node control-plane\/\.github\/scripts\/build-all-branch\.mjs doctor-install\n/
  );
  assert.match(
    doctorSteps[stepIndex("Load the build-doctor model waterfall")]?.body ?? "",
    /if: steps\.admit\.outputs\.proceed == 'true'/,
    "a stale handoff never loads a model"
  );
  const rounds = doctorSteps.filter(({ name }) => /^Lopu build doctor round \d$/.test(name));
  assert.equal(rounds.length, 3, "the doctor keeps three bounded rounds");
  for (const round of rounds) {
    assert.match(round.body, /uses: \.\/control-plane\/\.github\/actions\/lopu-agent\n/, `${round.name} uses the one Lopu action`);
    assert.match(round.body, /--allowedTools "Read,Grep,Glob,Edit,Write"/, `${round.name} may only edit files`);
    assert.match(round.body, /--disallowedTools "WebFetch,WebSearch,Bash,/, `${round.name} has no shell`);
  }
  assert.equal(
    [...doctor.matchAll(/You are Lopu, Thingtime's principal PR and repository manager\./g)].length,
    3,
    "every union repair round must identify itself as Lopu"
  );

  // GH_TOKEN reaches only the fetch/push steps and the credential scan.
  const tokenSteps = new Set([
    "Rebuild the all branch",
    "Admit the handoff and restore the failing union",
    "Commit doctor round 1",
    "Commit doctor round 2",
    "Commit doctor round 3",
    "Push the all branch",
  ]);
  for (const step of [...workflowSteps(build), ...doctorSteps]) {
    if (/\bGH_TOKEN:/.test(step.body)) {
      assert.ok(tokenSteps.has(step.name), `"${step.name}" must not receive GH_TOKEN`);
    }
  }
}

const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { notes: [], manifest: "", proceed: false, buildOk: null, stage: "", replayed: 0 };
  }
};
const writeState = (state) => {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
};
const stepOutput = (name, value) => {
  console.log(`build-all-branch: output ${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
};
const writeSummary = (markdown) => {
  console.log(`\n${markdown}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
};

// The workspace must already be the built `all` branch for every post-build
// mode; guard against running them against a product branch by accident.
function requireAllBranchCheckout(mode) {
  const branch = tryGit("branch", "--show-current").stdout?.trim();
  if (branch !== ALL_BRANCH) {
    console.error(`build-all-branch ${mode}: expected to run on branch ${ALL_BRANCH}, found ${branch || "detached HEAD"}.`);
    process.exit(2);
  }
}

// Decide which open PRs join the union and in what order. Pure: exercised by
// --self-test below.
export function planMerges(
  pullRequests,
  { baseBranches, allBranch, skipLabel, includeForks = false }
) {
  const skipped = [];
  const candidates = [];
  const seenHeads = new Set();
  const reserved = new Set([...baseBranches, allBranch]);
  for (const pr of [...pullRequests].sort((a, b) => a.number - b.number)) {
    const labels = (pr.labels || []).map((label) => label.name);
    if (labels.includes(skipLabel)) {
      skipped.push({ pr, reason: `labelled ${skipLabel}` });
    } else if (pr.isCrossRepository && !includeForks) {
      skipped.push({ pr, reason: "fork PR (excluded from the union by default)" });
    } else if (reserved.has(pr.headRefName)) {
      skipped.push({
        pr,
        reason: `head ${pr.headRefName} is a base branch (its content is already merged)`,
      });
    } else if (seenHeads.has(pr.headRefName)) {
      skipped.push({
        pr,
        reason: `duplicate head ${pr.headRefName} (already queued by an earlier PR)`,
      });
    } else {
      seenHeads.add(pr.headRefName);
      candidates.push(pr);
    }
  }

  // Layered topological order over base → head edges, seeded by the base
  // branches: parents always merge before the PRs stacked on them.
  const ordered = [];
  const reachable = new Set(baseBranches);
  let remaining = candidates;
  while (remaining.length > 0) {
    const layer = remaining.filter((pr) => reachable.has(pr.baseRefName));
    if (layer.length === 0) break;
    ordered.push(...layer);
    const inLayer = new Set(layer.map((pr) => pr.number));
    for (const pr of layer) reachable.add(pr.headRefName);
    remaining = remaining.filter((pr) => !inLayer.has(pr.number));
  }
  for (const pr of remaining) {
    skipped.push({
      pr,
      reason: `base ${pr.baseRefName} is not ${baseBranches.join("/")} or an open PR head (dangling stack)`,
    });
  }
  return { ordered, skipped };
}

// Render the ALL_BRANCH.md manifest. Deliberately timestamp-free so identical
// inputs produce identical trees (that is what push dedup keys on).
export function renderManifest({ allBranch, baseTips, merges, skipped }) {
  const lines = [
    `# \`${allBranch}\` — the everything branch`,
    "",
    "Generated by the **Build all branch** workflow (`.github/workflows/all-branch.yml`",
    "listener → protected `github-actions` implementation). Rebuilt from scratch and",
    `force-pushed on every change: never base work on \`${allBranch}\`, never edit it by`,
    "hand, and expect `git reset --hard` when tracking it locally.",
    "",
    `Bases: ${baseTips
      .map(({ branch, sha }) => `\`${branch}\` @ ${sha.slice(0, 7)}`)
      .join(" + ")}`,
    "",
  ];
  if (merges.length > 0) {
    lines.push(
      `## Merged pull requests (${merges.length}, in merge order)`,
      "",
      "| PR | Head | Title | Result |",
      "| --- | --- | --- | --- |"
    );
    for (const { pr, result } of merges) {
      lines.push(
        `| #${pr.number} | \`${pr.headRefName}\` @ ${pr.headRefOid.slice(0, 7)} | ${tableCell(pr.title)} | ${tableCell(result)} |`
      );
    }
    lines.push("");
  } else {
    lines.push("No open pull requests qualified for this rebuild.", "");
  }
  if (skipped.length > 0) {
    lines.push(
      `## Skipped pull requests (${skipped.length})`,
      "",
      "| PR | Head | Reason |",
      "| --- | --- | --- |"
    );
    for (const { pr, reason } of [...skipped].sort((a, b) => a.pr.number - b.pr.number)) {
      lines.push(`| #${pr.number} | \`${pr.headRefName}\` | ${tableCell(reason)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// Graphify output is derived from each source branch independently. It has no
// useful union semantics, and legacy mutable-cache layouts can create
// directory-rename conflicts with the content-addressed layout. Restore the
// complete pre-merge subtree in the index and working tree. This handles both
// conflicted and textually-clean merges, including PR-only generated files.
function restoreDerivedGraphify(sourceRef) {
  const derivedPath = "graphify-out";
  const sourceHasGraphify = tryGit("cat-file", "-e", `${sourceRef}:${derivedPath}`).status === 0;
  const removed = tryGit("rm", "-r", "-q", "-f", "--ignore-unmatch", "--", derivedPath);
  if (removed.status !== 0) {
    return {
      failed: `could not clear derived Graphify subtree: ${singleLine(removed.stderr, 200)}`,
      promisorFailure: isPromisorFetchFailure(removed.stdout, removed.stderr),
    };
  }
  if (!sourceHasGraphify) return { restored: true };
  const restored = tryGit("checkout", sourceRef, "--", derivedPath);
  if (restored.status !== 0) {
    return {
      failed: `could not restore derived Graphify subtree: ${singleLine(restored.stderr, 200)}`,
      promisorFailure: isPromisorFetchFailure(restored.stdout, restored.stderr),
    };
  }
  return { restored: true };
}

// Merge one ref with the newest-wins policy. Returns { result } on success or
// { failed } after cleanly aborting, so one impossible merge never poisons the
// rest of the rebuild.
function mergeRefOnce(ref, message) {
  const before = git("rev-parse", "HEAD");
  const merge = spawnSync(
    "git",
    [...MERGE_CONFIG, "merge", "--no-ff", "--no-edit", "-X", "theirs", "-m", message, ref],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "inherit", "pipe"] }
  );
  if (merge.status === 0) {
    const unchanged = git("rev-parse", "HEAD") === before;
    const pinned = restoreDerivedGraphify(before);
    if (pinned.failed) {
      git("reset", "--hard", before);
      return pinned;
    }
    if (tryGit("diff", "--cached", "--quiet").status !== 0) {
      const amend = tryGit("commit", "--amend", "--no-edit");
      if (amend.status !== 0) {
        git("reset", "--hard", before);
        return { failed: `could not pin derived Graphify subtree: ${singleLine(amend.stderr, 200)}` };
      }
    }
    return unchanged ? { result: "already included" } : { result: "clean merge" };
  }
  if (isPromisorFetchFailure(merge.stdout, merge.stderr)) {
    tryGit("merge", "--abort");
    return {
      failed: `lazy promisor fetch failed: ${singleLine(merge.stderr, 200)}`,
      promisorFailure: true,
    };
  }
  if (tryGit("rev-parse", "-q", "--verify", "MERGE_HEAD").status !== 0) {
    return { failed: `merge could not start: ${singleLine(merge.stderr, 200)}` };
  }

  const pinned = restoreDerivedGraphify(before);
  if (pinned.failed) {
    tryGit("merge", "--abort");
    return pinned;
  }

  // `-X theirs` already settled every textual conflict; what remains are the
  // structural cases (modify/delete, directory/file, -merge attributes).
  // Resolve them with the same bias: theirs where a "theirs" version exists,
  // deletion where theirs deleted.
  const abort = (failed, promisorFailure = false) => {
    tryGit("merge", "--abort");
    return { failed, promisorFailure };
  };
  const stagesByPath = new Map();
  for (const entry of git("ls-files", "-u", "-z").split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const stage = entry.slice(0, tab).split(" ")[2];
    const path = entry.slice(tab + 1);
    if (!stagesByPath.has(path)) stagesByPath.set(path, new Set());
    stagesByPath.get(path).add(stage);
  }
  const resolvedPaths = [];
  for (const [path, stages] of stagesByPath) {
    const resolution = stages.has("3")
      ? tryGit("checkout", "--theirs", "--", path)
      : tryGit("rm", "-f", "-q", "--ignore-unmatch", "--", path);
    const add =
      stages.has("3") && resolution.status === 0
        ? tryGit("add", "--", path)
        : null;
    const resolved = resolution.status === 0 && (!add || add.status === 0);
    if (!resolved) {
      const promisorFailure = isPromisorFetchFailure(
        resolution.stdout,
        resolution.stderr,
        add?.stdout,
        add?.stderr
      );
      return abort(
        `could not theirs-resolve ${singleLine(path, 160)}`,
        promisorFailure
      );
    }
    resolvedPaths.push(path);
  }
  if (git("ls-files", "-u") !== "") {
    return abort("unmerged paths remained after theirs-resolution");
  }
  const commit = tryGit("commit", "--no-edit");
  if (commit.status !== 0) {
    return abort(`conflict commit failed: ${singleLine(commit.stderr, 200)}`);
  }
  const shown = singleLine(resolvedPaths.slice(0, 8).join(", "), 200);
  return {
    result:
      resolvedPaths.length === 0
        ? "pinned generated Graphify state"
        : `auto-resolved theirs (${resolvedPaths.length} paths: ${shown}${resolvedPaths.length > 8 ? ", …" : ""}); pinned generated Graphify state`,
  };
}

function mergeRef(ref, message) {
  const first = mergeRefOnce(ref, message);
  if (!first.promisorFailure || !refetchCompleteInputs()) return first;
  console.warn(`build-all-branch: retrying ${ref} after complete-history refetch`);
  const retry = mergeRefOnce(ref, message);
  if (retry.failed) {
    return {
      failed: `${retry.failed} (complete-history retry did not recover the merge)`,
    };
  }
  return retry;
}

// Re-establish the invariants merges can break: make .github exactly match
// sourceRef's copy (restores content, deletes extras), drop the
// `path~refs_all-build_pr-N` collision artifacts theirs-side checkouts leave
// beside file-vs-symlink conflicts, and restore the root AGENTS.md/CLAUDE.md
// instruction symlinks (they must resolve to AI_ALL.md on every generated
// checkout; a legacy PR side can replace or delete them). Returns true when a
// pin commit was created.
function pinInvariants(sourceRef, label) {
  const junk = git("ls-files", "-z")
    .split("\0")
    .filter((path) => path.includes("~refs_all-build_pr-"));
  if (junk.length > 0) tryGit("rm", "-q", "-f", "--", ...junk);
  tryGit("rm", "-r", "-q", "-f", "--ignore-unmatch", "--", ".github");
  const restore = tryGit("checkout", sourceRef, "--", ".github");
  if (restore.status !== 0) {
    throw new Error(`could not restore .github from ${sourceRef}: ${restore.stderr}`);
  }
  tryGit("checkout", sourceRef, "--", "AGENTS.md", "CLAUDE.md");
  if (tryGit("diff", "--cached", "--quiet").status === 0) return false;
  run("git", ["commit", "-q", "-m", `all: pin .github and instruction symlinks to ${label}`]);
  return true;
}

function selfTest() {
  const pr = (number, base, head, extra = {}) => ({
    number,
    title: `PR ${number}`,
    baseRefName: base,
    headRefName: head,
    headRefOid: "a".repeat(40),
    isCrossRepository: false,
    labels: [],
    ...extra,
  });
  const options = { baseBranches: ["develop", "main"], allBranch: "all", skipLabel: "no-all" };

  // A stacked child merges after its parent even when its number is lower.
  {
    const parent = pr(30, "develop", "feature/parent");
    const child = pr(8, "feature/parent", "feature/child");
    const { ordered, skipped } = planMerges([child, parent], options);
    assert.deepEqual(ordered.map((p) => p.number), [30, 8]);
    assert.equal(skipped.length, 0);
  }

  // Dangling stacks, forks, opt-out labels, base-branch heads, duplicates.
  {
    const prs = [
      pr(1, "develop", "feat/a"),
      pr(2, "closed/gone", "feat/dangling"),
      pr(3, "develop", "feat/fork", { isCrossRepository: true }),
      pr(4, "develop", "feat/optout", { labels: [{ name: "no-all" }] }),
      pr(5, "main", "develop"),
      pr(6, "main", "feat/a"),
      pr(7, "feat/a", "feat/stacked"),
    ];
    const { ordered, skipped } = planMerges(prs, options);
    assert.deepEqual(ordered.map((p) => p.number), [1, 7]);
    const reasons = Object.fromEntries(skipped.map(({ pr: p, reason }) => [p.number, reason]));
    assert.match(reasons[2], /dangling stack/);
    assert.match(reasons[3], /fork PR/);
    assert.match(reasons[4], /labelled no-all/);
    assert.match(reasons[5], /base branch/);
    assert.match(reasons[6], /duplicate head/);
    const withForks = planMerges(prs, { ...options, includeForks: true });
    assert.deepEqual(withForks.ordered.map((p) => p.number), [1, 3, 7]);
  }

  // Manifest rendering: deterministic, pipe-safe, timestamp-free.
  {
    const input = {
      allBranch: "all",
      baseTips: [
        { branch: "develop", sha: "d".repeat(40) },
        { branch: "main", sha: "e".repeat(40) },
      ],
      merges: [
        { pr: pr(9, "develop", "feat/x", { title: "adds | pipes | everywhere" }), result: "clean merge" },
      ],
      skipped: [{ pr: pr(2, "gone", "feat/dangling"), reason: "base gone (dangling stack)" }],
    };
    const manifest = renderManifest(input);
    assert.equal(manifest, renderManifest(input));
    assert.match(manifest, /adds \\\| pipes \\\| everywhere/);
    assert.match(manifest, /#9/);
    assert.match(manifest, /dangling/);
    assert.doesNotMatch(manifest, /\d{4}-\d{2}-\d{2}[T ]\d{2}:/);
  }

  // Doctor replay-subject and forbidden-path rules.
  {
    assert.equal(
      isPromisorFetchFailure(
        "fatal: remote error: upload-pack: not our ref e4714e180e060da862f577de5ab5a63282de7e97"
      ),
      true
    );
    assert.equal(
      isPromisorFetchFailure(
        "fatal: could not fetch 16686feec299bb96c2ebece335afb2b299fe41cc from promisor remote"
      ),
      true
    );
    assert.equal(isPromisorFetchFailure("CONFLICT (content): Merge conflict in app.ts"), false);
    const source = readFileSync(new URL(import.meta.url), "utf8");
    const mergeBlock = source.slice(
      source.indexOf("function mergeRefOnce("),
      source.indexOf("function mergeRef(ref,"),
    );
    assert.equal(
      [...mergeBlock.matchAll(/restoreDerivedGraphify\(before\)/g)].length,
      2,
      "both clean and conflicted PR merges pin the complete derived Graphify subtree",
    );
    assert.ok(
      mergeBlock.indexOf("const pinned = restoreDerivedGraphify(before);") <
        mergeBlock.indexOf("const stagesByPath = new Map();"),
      "Graphify directory-rename conflicts are removed before path-level source resolution",
    );
    assert.equal(isReplayableDoctorSubject("all: build doctor round 1 — fix union build (client-build): a.ts"), true);
    assert.equal(isReplayableDoctorSubject("all: build doctor — mechanical pnpm lockfile reset to develop"), true);
    assert.equal(isReplayableDoctorSubject("all: manifest (61 PRs merged, 4 skipped)"), false);
    assert.equal(isReplayableDoctorSubject("all: union client-build still failing after doctor rounds"), false);
    assert.equal(isReplayableDoctorSubject("all: pin .github and instruction symlinks to develop"), false);
    assert.equal(
      countLeadingFailureMarkers([
        "all: union server-build still failing after doctor rounds",
        "all: union client-build still failing after doctor rounds",
        "all: build doctor round 1 — fix union build (client-build): a.ts",
        "all: union install still failing after doctor rounds",
      ]),
      2
    );
    assert.equal(countLeadingFailureMarkers(["all: manifest (5 PRs merged, 0 skipped)"]), 0);
    assert.equal(countLeadingFailureMarkers([]), 0);
    const forbidden = [
      ".github/workflows/web-ci.yml",
      "graphify-out/graph.json",
      ".all-doctor/state.json",
      "control-plane/.github/scripts/build-all-branch.mjs",
      "ALL_BRANCH.md",
      "AGENTS.md",
      "CLAUDE.md",
      ".gitattributes",
      "remix/.gitattributes",
      "remix/pnpm-lock.yaml",
      "package-lock.json",
    ];
    for (const path of forbidden) assert.equal(isForbiddenDoctorPath(path), true, `${path} must be forbidden`);
    assert.equal(shouldRevertDoctorStatusPath("control-plane/"), false, "the trusted controller checkout must survive doctor rounds");
    assert.equal(
      shouldRevertDoctorStatusPath("control-plane/.github/scripts/build-all-branch.mjs"),
      true,
      "nested controller paths must remain forbidden"
    );
    assert.equal(shouldRevertDoctorStatusPath(".github/workflows/all-branch.yml"), true);
    const allowed = [
      "remix/app/components/Feed/PostCard.tsx",
      "README.md",
      "scripts/vercel-build.mjs",
      "remix/package.json",
      "AI_ALL.md",
    ];
    for (const path of allowed) assert.equal(isForbiddenDoctorPath(path), false, `${path} must be editable`);
  }

  // The action rejects push events, so the push listener must remain wired to
  // the supported workflow_dispatch handoff path.
  {
    const workflow = readFileSync(new URL("../workflows/all-branch.yml", import.meta.url), "utf8");
    assertAllBranchWorkflowContract(workflow);

    // Fleet membership is enforced, not just documented: each of these
    // regressions must fail the contract.
    const rejects = (label, mutate) => {
      const mutated = mutate(workflow);
      assert.notEqual(mutated, workflow, `${label}: the mutation must apply`);
      assert.throws(() => assertAllBranchWorkflowContract(mutated), assert.AssertionError, label);
    };
    rejects("the rebuild re-joining the agent fleet", (text) =>
      text.replace(
        "group: lopu-all-branch-${{ github.repository }}\n      cancel-in-progress: false",
        "group: lopu-agent-fleet-${{ github.repository }}\n      queue: max\n      cancel-in-progress: false"
      )
    );
    rejects("the doctor leaving the agent fleet", (text) =>
      text.replace("group: lopu-agent-fleet-${{ github.repository }}", "group: lopu-doctor-${{ github.repository }}")
    );
    rejects("a model round inside the build job", (text) =>
      text.replace(
        "      - name: Union build check\n",
        "      - name: Early doctor\n        uses: ./control-plane/.github/actions/lopu-agent\n\n      - name: Union build check\n"
      )
    );
    rejects("a doctor that runs without a handoff", (text) =>
      text.replace(" && needs.build.outputs.handoff == 'true'\n", "\n")
    );
    rejects("a build job that pushes over a handed-off union", (text) =>
      text.replace(
        "      - name: Push the all branch\n        if: steps.build.outputs.proceed == 'true' && steps.handoff.outputs.handoff != 'true'\n",
        "      - name: Push the all branch\n        if: steps.build.outputs.proceed == 'true'\n"
      )
    );
    rejects("a doctor that selects a model before admission", (text) =>
      text.replace(
        "        id: models\n        if: steps.admit.outputs.proceed == 'true'\n",
        "        id: models\n        if: always()\n"
      )
    );
    rejects("a doctor checkout that persists its token", (text) => {
      const at = text.indexOf("  doctor:\n");
      return text.slice(0, at) + text.slice(at).replace("persist-credentials: false", "persist-credentials: true");
    });
    rejects("GH_TOKEN reaching the model waterfall loader", (text) =>
      text.replace(
        "        id: models\n        if: steps.admit.outputs.proceed == 'true'\n",
        "        id: models\n        if: steps.admit.outputs.proceed == 'true'\n        env:\n          GH_TOKEN: ${{ github.token }}\n"
      )
    );
    rejects("a third job", (text) => `${text}\n  extra:\n    runs-on: ubuntu-latest\n    steps: []\n`);
  }

  // Handoff validation and doctor admission.
  {
    const sha = (char) => char.repeat(40);
    const handoff = {
      version: 1,
      allBranch: "all",
      tip: sha("1"),
      tree: sha("2"),
      worktree: sha("3"),
      remoteTip: sha("4"),
      bases: [
        { branch: "develop", sha: sha("d") },
        { branch: "main", sha: sha("e") },
      ],
      pulls: [
        { number: 12, sha: sha("a") },
        { number: 112, sha: sha("b") },
      ],
    };
    const shape = { allBranch: "all", baseBranches: ["develop", "main"] };
    assert.equal(validateHandoff(handoff, shape), handoff);
    for (const broken of [
      { ...handoff, version: 2 },
      { ...handoff, allBranch: "everything" },
      { ...handoff, tip: "HEAD" },
      { ...handoff, worktree: `${sha("3")} --upload-pack=evil` },
      { ...handoff, remoteTip: "refs/heads/all" },
      { ...handoff, bases: [...handoff.bases].reverse() },
      { ...handoff, pulls: [{ number: "12; rm -rf /", sha: sha("a") }] },
      { ...handoff, pulls: [{ number: 12, sha: sha("a") }, { number: 12, sha: sha("a") }] },
      { ...handoff, pulls: undefined },
    ]) {
      assert.throws(() => validateHandoff(broken, shape), assert.AssertionError);
    }
    assert.doesNotThrow(() => validateHandoff({ ...handoff, remoteTip: "", pulls: [] }, shape));

    const listing = [
      `${sha("4")}\trefs/heads/all`,
      `${sha("d")}\trefs/heads/develop`,
      `${sha("e")}\trefs/heads/main`,
      `${sha("a")}\trefs/pull/12/head`,
      `${sha("b")}\trefs/pull/112/head`,
      "warning: not a ref line",
      "",
    ].join("\n");
    const live = parseLsRemote(listing);
    assert.equal(live.size, 5);
    assert.equal(live.get("refs/pull/12/head"), sha("a"));
    assert.deepEqual(decideDoctorAdmission(handoff, live, { allBranch: "all" }), {
      admit: true,
      reason: "",
      lease: sha("4"),
    });
    const moved = (ref, value) => {
      const next = new Map(live);
      if (value === undefined) next.delete(ref);
      else next.set(ref, value);
      return decideDoctorAdmission(handoff, next, { allBranch: "all" });
    };
    assert.match(moved("refs/heads/develop", sha("f")).reason, /develop moved from ddddddd to fffffff/);
    assert.match(moved("refs/heads/main", sha("f")).reason, /main moved/);
    assert.match(moved("refs/pull/112/head", sha("f")).reason, /PR #112 moved/);
    assert.match(moved("refs/heads/all", sha("f")).reason, /origin\/all moved from 4444444 to fffffff/);
    assert.match(moved("refs/heads/all", undefined).reason, /origin\/all moved from 4444444 to \(missing\)/);
    assert.match(moved("refs/pull/12/head", undefined).reason, /PR #12 moved from aaaaaaa to \(missing\)/);
    for (const ref of ["refs/heads/develop", "refs/heads/all", "refs/pull/12/head"]) {
      assert.equal(moved(ref, sha("f")).admit, false, `${ref} moving must supersede the doctor`);
    }
    // No pushed union yet: admit only while origin/all is still absent.
    const fresh = { ...handoff, remoteTip: "" };
    const withoutAll = new Map(live);
    withoutAll.delete("refs/heads/all");
    assert.deepEqual(decideDoctorAdmission(fresh, withoutAll, { allBranch: "all" }).lease, "");
    assert.equal(decideDoctorAdmission(fresh, live, { allBranch: "all" }).admit, false);
    // Long move lists stay one bounded summary line.
    const many = { ...handoff, pulls: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, sha: sha("c") })) };
    assert.match(decideDoctorAdmission(many, live, { allBranch: "all" }).reason, /and 4 more\)$/);
  }
}

// Every mode hard-touches the checkout; gate and normalize once.
function prepare() {
  const inActions = process.env.GITHUB_ACTIONS === "true";
  if (!inActions && process.env.ALL_BRANCH_FORCE !== "1") {
    console.error(
      "build-all-branch: refusing to run outside GitHub Actions without ALL_BRANCH_FORCE=1 — it hard-switches branches in the current checkout."
    );
    process.exit(2);
  }
  process.chdir(git("rev-parse", "--show-toplevel"));
  if (inActions) {
    git("config", "user.name", "github-actions[bot]");
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  }
}

function buildMode() {

  run(
    "git",
    [
      ...gitAuthConfig(),
      "fetch",
      "--no-tags",
      "--force",
      "origin",
      ...BASE_BRANCHES.map((branch) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`),
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  tryGit(...gitAuthConfig(), "fetch", "--no-tags", "--force", "origin", `+refs/heads/${ALL_BRANCH}:${REMOTE_ALL_REF}`);

  const pullRequests = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      REPOSITORY,
      "--state",
      "open",
      "--limit",
      "500",
      "--json",
      "number,title,baseRefName,headRefName,headRefOid,isCrossRepository,labels",
    ])
  );
  const plan = planMerges(pullRequests, {
    baseBranches: BASE_BRANCHES,
    allBranch: ALL_BRANCH,
    skipLabel: SKIP_LABEL,
    includeForks: INCLUDE_FORKS,
  });
  const { ordered } = plan;
  const skipped = [...plan.skipped];
  completeRefetchAttempted = false;
  completeRefspecs = [
    ...BASE_BRANCHES.map((branch) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`),
    ...ordered.map((pr) => `+refs/pull/${pr.number}/head:refs/all-build/pr-${pr.number}`),
  ];
  console.log(
    `build-all-branch: ${pullRequests.length} open PRs — merging ${ordered.length}, skipping ${skipped.length}`
  );

  if (ordered.length > 0) {
    run(
      "git",
      [
        ...gitAuthConfig(),
        "fetch",
        "--no-tags",
        "--force",
        "origin",
        ...ordered.map((pr) => `+refs/pull/${pr.number}/head:refs/all-build/pr-${pr.number}`),
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
  }

  git("checkout", "--force", "-B", ALL_BRANCH, `refs/remotes/origin/${BASE_BRANCHES[0]}`);
  const baseTips = BASE_BRANCHES.map((branch) => ({
    branch,
    sha: git("rev-parse", `refs/remotes/origin/${branch}`),
  }));
  // Exact inputs as first fetched. A later complete-history refetch can only
  // move a ref forward, which makes a doctor handoff conservatively stale.
  const inputs = {
    bases: baseTips,
    pulls: ordered.map((pr) => ({
      number: pr.number,
      sha: git("rev-parse", `refs/all-build/pr-${pr.number}^{commit}`),
    })),
  };
  const remoteAll = tryGit("rev-parse", "-q", "--verify", `${REMOTE_ALL_REF}^{commit}`);
  const remoteTip = remoteAll.status === 0 ? remoteAll.stdout.trim() : "";

  const notes = [];
  for (const branch of BASE_BRANCHES.slice(1)) {
    const outcome = mergeRef(`refs/remotes/origin/${branch}`, `all: merge ${branch}`);
    if (outcome.failed) {
      notes.push(`⚠️ base merge of ${branch} failed: ${outcome.failed}`);
      console.error(`build-all-branch: base merge of ${branch} failed: ${outcome.failed}`);
    } else {
      notes.push(`base ${branch}: ${outcome.result}`);
    }
  }

  const merges = [];
  for (const pr of ordered) {
    const outcome = mergeRef(
      `refs/all-build/pr-${pr.number}`,
      `all: merge PR #${pr.number} — ${singleLine(pr.title)}`
    );
    if (outcome.failed) {
      skipped.push({ pr, reason: outcome.failed });
      console.error(`build-all-branch: PR #${pr.number} skipped: ${outcome.failed}`);
    } else {
      merges.push({ pr, result: outcome.result });
      console.log(`build-all-branch: PR #${pr.number} ${outcome.result}`);
    }
  }

  pinInvariants(`refs/remotes/origin/${BASE_BRANCHES[0]}`, BASE_BRANCHES[0]);

  const manifest = renderManifest({ allBranch: ALL_BRANCH, baseTips, merges, skipped });
  writeFileSync("ALL_BRANCH.md", manifest);
  git("add", "--", "ALL_BRANCH.md");
  if (tryGit("diff", "--cached", "--quiet").status !== 0) {
    run("git", ["commit", "-q", "-m", `all: manifest (${merges.length} PRs merged, ${skipped.length} skipped)`]);
  }

  // Rebuild dedup + doctor-fixup replay against the previously pushed branch.
  // Comparing MANIFEST-commit trees (both pre-doctor) means unchanged inputs
  // skip the build check and every AI round outright.
  const remote = remoteDoctorState();
  const manifestTree = git("rev-parse", "HEAD^{tree}");
  // Identical inputs skip the build check and every AI round — except when
  // the pushed tip says the doctor ran out of rounds, which earns exactly one
  // more attempt (failStreak 1) before waiting for any input change.
  if (remote && remote.manifestTree === manifestTree && remote.failStreak !== 1) {
    const kept = remote.doctorShas.length;
    writeState({ notes, manifest, proceed: false, buildOk: null, stage: "", replayed: 0, merges: merges.length, skips: skipped.length });
    writeSummary(
      [
        "## Build all branch",
        "",
        remote.failStreak >= 2
          ? "No input change — the doctor already exhausted its rounds on exactly these inputs; waiting for any PR or base movement before retrying."
          : `No input change — origin/${ALL_BRANCH} already matches this rebuild` +
            (kept > 0 ? ` (${kept} doctor fixup${kept === 1 ? "" : "s"} preserved).` : "."),
      ].join("\n")
    );
    stepOutput("proceed", "false");
    return;
  }

  let replayed = 0;
  if (remote && remote.doctorShas.length > 0) {
    const preReplay = git("rev-parse", "HEAD");
    for (const sha of remote.doctorShas) {
      if (tryGit("cherry-pick", sha).status === 0) {
        replayed += 1;
        continue;
      }
      // Stale or now-empty fixup (the source PRs healed): drop it silently.
      if (tryGit("cherry-pick", "--skip").status !== 0) tryGit("cherry-pick", "--abort");
      notes.push(`🩺 replay dropped: doctor fixup ${sha.slice(0, 7)} no longer applies`);
    }
    if (git("ls-files", "-u") !== "" || tryGit("rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD").status === 0) {
      tryGit("cherry-pick", "--abort");
      git("reset", "--hard", preReplay);
      replayed = 0;
      notes.push("🩺 replay abandoned: fixups left an inconsistent state and were dropped wholesale");
    } else if (replayed > 0) {
      notes.push(`🩺 replayed ${replayed} doctor fixup${replayed === 1 ? "" : "s"} from the previous ${ALL_BRANCH}`);
    }
  }

  writeState({ notes, manifest, proceed: true, buildOk: null, stage: "", replayed, doctored: 0, merges: merges.length, skips: skipped.length, inputs, remoteTip });
  stepOutput("proceed", "true");
  console.log(
    `build-all-branch: rebuild ready (${merges.length} merged, ${skipped.length} skipped, ${replayed} fixup${replayed === 1 ? "" : "s"} replayed)`
  );
}

// Inspect the previously pushed branch: its manifest commit (rebuild identity)
// and the replayable doctor commits stacked on top of it.
function remoteDoctorState() {
  if (tryGit("rev-parse", "-q", "--verify", REMOTE_ALL_REF).status !== 0) return null;
  const log = tryGit("log", "--first-parent", "-n", "60", "--format=%H%x09%s", REMOTE_ALL_REF);
  if (log.status !== 0) return null;
  const rows = (log.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  const failStreak = countLeadingFailureMarkers(rows.map((row) => row.subject));
  const manifestIndex = rows.findIndex((row) => row.subject.startsWith(MANIFEST_SUBJECT_PREFIX));
  if (manifestIndex === -1) {
    return {
      manifestTree: tryGit("rev-parse", `${REMOTE_ALL_REF}^{tree}`).stdout?.trim() || "",
      doctorShas: [],
      failStreak,
    };
  }
  return {
    manifestTree: tryGit("rev-parse", `${rows[manifestIndex].sha}^{tree}`).stdout?.trim() || "",
    doctorShas: rows
      .slice(0, manifestIndex)
      .filter((row) => isReplayableDoctorSubject(row.subject))
      .map((row) => row.sha)
      .reverse()
      .slice(0, MAX_REPLAYED_DOCTOR_COMMITS),
    failStreak,
  };
}

// Run one command for the union build check, teeing a failure's output into
// BUILD_LOG for the doctor model to read.
function runCheckStep(label, command, args) {
  console.log(`build-all-branch check: ${label}...`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    console.error(output.split("\n").slice(-120).join("\n"));
    const body = output.length > 1024 * 1024 ? output.slice(-1024 * 1024) : output;
    writeFileSync(BUILD_LOG, `# Failed command: ${label}\n\n${body}\n`);
    return false;
  }
  console.log(output.split("\n").slice(-20).join("\n"));
  return true;
}

// Union build check: install → client build → server build, with a
// deterministic lockfile repair before any AI is spent. Always exits 0; the
// verdict travels via step outputs and state.
function checkMode() {
  requireAllBranchCheckout("check");
  mkdirSync(STATE_DIR, { recursive: true });
  const state = readState();
  const notes = state.notes || [];
  const install = () =>
    runCheckStep("pnpm install (remix)", "corepack", ["pnpm", "--dir", "remix", "install", "--no-frozen-lockfile"]);
  let ok = true;
  let stage = "";
  if (!install()) {
    // Union lockfiles are frequently unsatisfiable; reset to the primary
    // base's lockfile and let pnpm re-resolve. Committed mechanically (and
    // replayed next rebuild) — never a model concern.
    const restore = tryGit("checkout", `refs/remotes/origin/${BASE_BRANCHES[0]}`, "--", "remix/pnpm-lock.yaml");
    if (restore.status === 0 && install()) {
      run("git", ["add", "--", "remix/pnpm-lock.yaml"]);
      if (tryGit("diff", "--cached", "--quiet").status !== 0) {
        run("git", ["commit", "-q", "-m", `${DOCTOR_SUBJECT_PREFIX} — mechanical pnpm lockfile reset to ${BASE_BRANCHES[0]}`]);
        notes.push(`🩺 mechanical repair: remix/pnpm-lock.yaml reset to ${BASE_BRANCHES[0]} so the union installs`);
      }
    } else {
      ok = false;
      stage = "install";
    }
  }
  // The remix `build` script is Vercel's exact chain (pre-dev, client +
  // embed + verify, nitro-template sync, NITRO_PRESET=vercel server build,
  // output patch + verify) — anything lighter lets collisions in the later
  // stages reach the deployment (the preview-freshness plugin drop did
  // exactly that on the first doctored push).
  if (ok && !runCheckStep("vercel-parity build (client + embed + nitro + output verify)", "corepack", ["pnpm", "--dir", "remix", "run", "build"])) {
    ok = false;
    stage = "build";
  }
  writeState({ ...state, notes, buildOk: ok, stage });
  stepOutput("build_ok", ok ? "true" : "false");
  // Install-stage failures are not fixable by editing app source; skip AI.
  stepOutput("ai_eligible", !ok && stage !== "install" ? "true" : "false");
  if (!ok) console.error(`build-all-branch check: union build failing at ${stage} (log: ${BUILD_LOG})`);
}

// The tree doctor-commit would stage right now: HEAD plus every working-tree
// change outside the state and controller directories. Uses a throwaway copy
// of the index so the real index (== HEAD) is untouched.
function worktreeTree() {
  const index = resolve(git("rev-parse", "--git-path", "index"));
  const scratch = `${index}.all-handoff`;
  copyFileSync(index, scratch);
  try {
    const env = { ...process.env, GIT_INDEX_FILE: scratch };
    run("git", ["add", "-A", "--", ".", `:(exclude)${STATE_DIR}`, ":(exclude)control-plane"], { env });
    return run("git", ["write-tree"], { env }).trim();
  } finally {
    rmSync(scratch, { force: true });
  }
}

// Build job: export a failing union for the doctor job. The pack holds only
// objects this checkout created (merge/pin/manifest/replay commits, their new
// trees and merged blobs, and the dirty working tree); everything fetched from
// origin stays a promisor object the doctor job fetches itself.
function handoffMode(outDir) {
  requireAllBranchCheckout("handoff");
  const state = readState();
  if (state.proceed !== true || state.buildOk !== false || !state.inputs) {
    console.error("build-all-branch handoff: only a checked, failing rebuild can be handed to the doctor.");
    process.exit(2);
  }
  const tip = git("rev-parse", "HEAD");
  const handoff = validateHandoff(
    {
      version: HANDOFF_VERSION,
      allBranch: ALL_BRANCH,
      tip,
      tree: git("rev-parse", "HEAD^{tree}"),
      worktree: worktreeTree(),
      remoteTip: state.remoteTip || "",
      bases: state.inputs.bases,
      pulls: state.inputs.pulls,
    },
    { allBranch: ALL_BRANCH, baseBranches: BASE_BRANCHES }
  );
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Current Git marks a blobless clone with remote.<name>.promisor; older Git
  // used extensions.partialClone. Either way, promisor objects stay out.
  const promisorConfig =
    tryGit("config", "--get-regexp", "^(extensions\\.partialclone|remote\\..+\\.promisor)$").stdout || "";
  const partial = promisorConfig
    .split("\n")
    .some((line) => /^extensions\.partialclone \S/i.test(line) || /^remote\..+\.promisor true$/i.test(line));
  const revs = [
    handoff.tip,
    handoff.worktree,
    ...handoff.bases.map(({ sha }) => `^${sha}`),
    ...handoff.pulls.map(({ sha }) => `^${sha}`),
    ...(handoff.remoteTip ? [`^${handoff.remoteTip}`] : []),
  ];
  const packPath = join(outDir, HANDOFF_PACK);
  const fd = openSync(packPath, "w");
  let pack;
  try {
    pack = spawnSync(
      "git",
      // --no-sparse keeps exact rev-list reachability: the sparse walk leaves
      // unchanged sibling blobs of a touched directory interesting, and in a
      // blobless clone those may not even be present locally.
      ["pack-objects", "--revs", "--stdout", "--no-sparse", ...(partial ? ["--exclude-promisor-objects"] : [])],
      { input: `${revs.join("\n")}\n`, stdio: ["pipe", fd, "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
  } finally {
    closeSync(fd);
  }
  if (pack.status !== 0) {
    throw new Error(`could not pack the union for the doctor: ${singleLine(pack.stderr, 300)}`);
  }
  copyFileSync(STATE_FILE, join(outDir, HANDOFF_STATE));
  if (existsSync(BUILD_LOG)) copyFileSync(BUILD_LOG, join(outDir, HANDOFF_LOG));
  writeFileSync(join(outDir, HANDOFF_FILE), `${JSON.stringify(handoff, null, 2)}\n`);
  const bytes = readFileSync(packPath).length;
  stepOutput("handoff", "true");
  writeSummary(
    [
      "## Build all branch",
      "",
      `❌ Union build failing at ${state.stage || "build"} — handed ${tip.slice(0, 7)} (${bytes} byte pack, ${handoff.pulls.length} PR tips) to the build doctor, which waits for Lopu's agent fleet. This job did not hold the fleet and did not push.`,
    ].join("\n")
  );
}

// Doctor job: admit (or stand down from) a handoff, then restore the exact
// failing union and working tree the build job checked.
function doctorAdmitMode(fromDir) {
  const handoff = validateHandoff(JSON.parse(readFileSync(join(fromDir, HANDOFF_FILE), "utf8")), {
    allBranch: ALL_BRANCH,
    baseBranches: BASE_BRANCHES,
  });
  const patterns = [
    `refs/heads/${ALL_BRANCH}`,
    ...handoff.bases.map(({ branch }) => `refs/heads/${branch}`),
    ...handoff.pulls.map(({ number }) => `refs/pull/${number}/head`),
  ];
  let listing = null;
  for (let attempt = 1; attempt <= 2 && listing === null; attempt += 1) {
    const result = spawnSync("git", [...gitAuthConfig(), "ls-remote", "origin", ...patterns], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status === 0) listing = result.stdout;
    else console.error(`build-all-branch doctor-admit: ls-remote attempt ${attempt} failed: ${singleLine(result.stderr, 200)}`);
  }
  if (listing === null) throw new Error("could not read the live union inputs from origin");
  const standDown = (reason) => {
    writeSummary(
      [
        "## Build all branch",
        "",
        `🩺 The build doctor stood down without running a model or pushing: ${reason}. The pending rebuild will rebuild and, if needed, doctor the newer inputs.`,
      ].join("\n")
    );
    stepOutput("proceed", "false");
  };
  const decision = decideDoctorAdmission(handoff, parseLsRemote(listing), { allBranch: ALL_BRANCH });
  if (!decision.admit) return standDown(decision.reason);

  const refspecs = [
    ...handoff.bases.map(({ branch }) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`),
    ...handoff.pulls.map(({ number }) => `+refs/pull/${number}/head:refs/all-build/pr-${number}`),
    ...(handoff.remoteTip ? [`+refs/heads/${ALL_BRANCH}:${REMOTE_ALL_REF}`] : []),
  ];
  run("git", [...gitAuthConfig(), "fetch", "--no-tags", "--force", "origin", ...refspecs], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (!handoff.remoteTip) tryGit("update-ref", "-d", REMOTE_ALL_REF);
  const fetched = new Map([
    ...handoff.bases.map(({ branch }) => [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]),
    ...handoff.pulls.map(({ number }) => [`refs/pull/${number}/head`, `refs/all-build/pr-${number}`]),
    ...(handoff.remoteTip ? [[`refs/heads/${ALL_BRANCH}`, REMOTE_ALL_REF]] : []),
  ]);
  const local = new Map(
    [...fetched].map(([remoteRef, localRef]) => [remoteRef, tryGit("rev-parse", "-q", "--verify", `${localRef}^{commit}`).stdout?.trim() || ""])
  );
  if (!handoff.remoteTip) local.set(`refs/heads/${ALL_BRANCH}`, "");
  const refetched = decideDoctorAdmission(handoff, local, { allBranch: ALL_BRANCH });
  if (!refetched.admit) return standDown(refetched.reason);

  const fd = openSync(join(fromDir, HANDOFF_PACK), "r");
  let imported;
  try {
    imported = spawnSync("git", ["index-pack", "--stdin"], { stdio: [fd, "pipe", "pipe"], encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  if (imported.status !== 0) throw new Error(`could not import the union pack: ${singleLine(imported.stderr, 300)}`);
  assert.equal(git("rev-parse", `${handoff.tip}^{tree}`), handoff.tree, "the imported union tip has a different tree");
  assert.equal(git("cat-file", "-t", handoff.worktree), "tree", "the imported working tree is missing");

  git("checkout", "--force", "-B", ALL_BRANCH, handoff.tip);
  run("git", [
    "restore",
    `--source=${handoff.worktree}`,
    "--worktree",
    "--",
    ".",
    `:(exclude)${STATE_DIR}`,
    ":(exclude)control-plane",
  ]);
  const restored = worktreeTree();
  assert.equal(restored, handoff.worktree, "the restored working tree differs from the tree the build job checked");

  mkdirSync(STATE_DIR, { recursive: true });
  copyFileSync(join(fromDir, HANDOFF_STATE), STATE_FILE);
  if (existsSync(join(fromDir, HANDOFF_LOG))) copyFileSync(join(fromDir, HANDOFF_LOG), BUILD_LOG);
  const state = readState();
  writeState({ ...state, lease: decision.lease });
  console.log(
    `build-all-branch doctor-admit: restored ${handoff.tip.slice(0, 7)} with its exact working tree; pushes are leased on ${decision.lease ? decision.lease.slice(0, 7) : `a missing origin/${ALL_BRANCH}`}`
  );
  stepOutput("proceed", "true");
}

// Doctor job: reinstall the union's dependencies before round 1, so the model
// reads the same node_modules it had when the build job ran this check in the
// same job. Never writes BUILD_LOG (the model must read the build job's
// failure) and never fails the job: the next re-check installs again anyway.
function doctorInstallMode() {
  requireAllBranchCheckout("doctor-install");
  const result = spawnSync("corepack", ["pnpm", "--dir", "remix", "install", "--no-frozen-lockfile"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  console.log(output.split("\n").slice(-20).join("\n"));
  if (result.status !== 0) {
    console.log("::notice::The doctor's dependency install failed; round 1 runs without node_modules and the re-check installs again.");
  }
}

// Guard and commit whatever the doctor model left in the working tree.
function doctorCommitMode(round) {
  requireAllBranchCheckout("doctor-commit");
  const state = readState();
  const notes = state.notes || [];
  const porcelain = tryGit("status", "--porcelain=v1", "-z", "--untracked-files=all").stdout || "";
  const entries = porcelain.split("\0").filter(Boolean);
  const reverted = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    index += status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    if (!shouldRevertDoctorStatusPath(path)) continue;
    if (status === "??") rmSync(path, { recursive: true, force: true });
    else tryGit("checkout", "HEAD", "--", path);
    reverted.push(path);
  }
  if (reverted.length > 0) {
    notes.push(`🩺 round ${round}: reverted out-of-scope model edits (${singleLine(reverted.join(", "), 180)})`);
  }
  run("git", ["add", "-A", "--", ".", `:(exclude)${STATE_DIR}`, ":(exclude)control-plane"]);
  if (tryGit("diff", "--cached", "--quiet").status === 0) {
    notes.push(`🩺 round ${round}: the model made no eligible edits`);
    writeState({ ...state, notes });
    stepOutput("committed", "false");
    stepOutput("scrubbed", "false");
    return;
  }
  // House rule: a committed fixup must never contain any credential this job
  // could see, raw or base64. On a hit, discard the entire round.
  const staged = tryGit("diff", "--cached").stdout || "";
  const leaked = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY_FALLBACK",
    "CLAUDE_CODE_OAUTH_TOKEN_FALLBACK",
    "GH_TOKEN",
    "GITHUB_TOKEN",
  ].some((name) => {
    const value = process.env[name];
    if (!value) return false;
    return staged.includes(value) || staged.includes(Buffer.from(value, "utf8").toString("base64"));
  });
  if (leaked) {
    tryGit("reset", "-q");
    tryGit("checkout", "--", ".");
    tryGit("clean", "-fd", "-e", STATE_DIR, "-e", "control-plane");
    notes.push(`🩺 round ${round}: DISCARDED — the staged fixup contained credential material`);
    writeState({ ...state, notes });
    stepOutput("committed", "false");
    stepOutput("scrubbed", "true");
    return;
  }
  const files = (tryGit("diff", "--cached", "--name-only").stdout || "").split("\n").filter(Boolean);
  const shown = singleLine(files.slice(0, 6).join(", "), 140) + (files.length > 6 ? ", …" : "");
  run("git", ["commit", "-q", "-m", `${DOCTOR_SUBJECT_PREFIX} round ${round} — fix union build (${state.stage || "build"}): ${shown}`]);
  notes.push(`🩺 round ${round}: committed fixes to ${files.length} file${files.length === 1 ? "" : "s"} (${shown})`);
  writeState({ ...state, notes, doctored: (state.doctored || 0) + 1 });
  stepOutput("committed", "true");
  stepOutput("scrubbed", "false");
}

// Record how doctoring ended; on an exhausted doctor, leave a human-visible
// (deliberately non-replayable) marker commit on the branch tip.
function doctorRecordMode() {
  requireAllBranchCheckout("doctor-record");
  const state = readState();
  const notes = state.notes || [];
  if (process.env.ALL_DOCTOR_SKIP_REASON) {
    notes.push(`🩺 doctor skipped: ${singleLine(process.env.ALL_DOCTOR_SKIP_REASON, 200)}`);
  }
  if (state.buildOk === false) {
    run("git", ["commit", "-q", "--allow-empty", "-m", `all: union ${state.stage || "build"} still failing after doctor rounds`]);
    notes.push(`🩺 rounds exhausted — union build still failing at ${state.stage || "build"}; pushing anyway so the manifest and history stay inspectable`);
  } else if (state.buildOk === true && (state.doctored || 0) > 0) {
    notes.push(`🩺 union build green after ${state.doctored} doctor round${state.doctored === 1 ? "" : "s"}`);
  }
  writeState({ ...state, notes });
}

// Final force-push (with the .github re-pin fallback) and the run summary.
// After doctor-admit the push is leased on the `all` tip the rebuild replayed
// from, so a doctor can never overwrite a newer union that landed meanwhile.
function pushMode() {
  requireAllBranchCheckout("push");
  const state = readState();
  const notes = state.notes || [];
  if (state.proceed !== true) {
    console.log("build-all-branch push: nothing to push (build mode decided to skip).");
    return;
  }
  const pushGit = (args) =>
    spawnSync("git", [...gitAuthConfig(), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "inherit", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  let pushLine;
  const builtTree = git("rev-parse", "HEAD^{tree}");
  const remoteTree = tryGit("rev-parse", "-q", "--verify", `${REMOTE_ALL_REF}^{tree}`);
  // An exhausted doctor pushes even a tree-identical result: the failure
  // marker on the tip is the retry ledger the next rebuild reads.
  if (remoteTree.status === 0 && remoteTree.stdout.trim() === builtTree && state.buildOk !== false) {
    pushLine = `No push needed — the rebuilt tree is identical to origin/${ALL_BRANCH}.`;
  } else if (!PUSH) {
    pushLine = `Build only (ALL_PUSH=0): origin/${ALL_BRANCH} was not updated.`;
  } else {
    const lease = typeof state.lease === "string" ? state.lease : null;
    const pushArgs = [
      "push",
      lease === null ? "--force" : `--force-with-lease=refs/heads/${ALL_BRANCH}:${lease}`,
      "origin",
      `${ALL_BRANCH}:refs/heads/${ALL_BRANCH}`,
    ];
    let push = pushGit(pushArgs);
    if (push.status !== 0 && /workflow/i.test(push.stderr || "")) {
      // GITHUB_TOKEN may not change .github/workflows/** content. Re-pin
      // .github to the previously pushed all state so the tip-to-tip workflow
      // delta disappears, then retry once.
      console.error(`build-all-branch: push refused (${singleLine(push.stderr, 200)})`);
      if (tryGit("rev-parse", "-q", "--verify", REMOTE_ALL_REF).status === 0) {
        const repinned = pinInvariants(
          REMOTE_ALL_REF,
          "previously pushed all (.github/workflows push restriction)"
        );
        notes.push(
          "⚠️ .github re-pinned to the previous all state: GITHUB_TOKEN cannot push the pending workflow-file delta."
        );
        if (repinned && git("rev-parse", "HEAD^{tree}") === remoteTree.stdout.trim()) {
          push = { status: 0 };
          pushLine = `No push needed after re-pin — origin/${ALL_BRANCH} already matches.`;
        } else {
          push = pushGit(pushArgs);
        }
      }
    }
    if (push.status !== 0 && lease !== null && /stale info/i.test(push.stderr || "")) {
      pushLine = `Superseded — origin/${ALL_BRANCH} moved while the doctor was repairing, so this older union was not pushed over it.`;
    } else if (push.status !== 0) {
      console.error(`build-all-branch: push failed: ${push.stderr || ""}`);
      process.exitCode = 1;
      pushLine = `❌ Push to origin/${ALL_BRANCH} failed: ${singleLine(push.stderr, 300)}`;
    } else {
      pushLine = pushLine || `Force-pushed origin/${ALL_BRANCH} (${state.merges ?? "?"} PRs merged, ${state.skips ?? "?"} skipped).`;
    }
  }
  const doctored = state.doctored || 0;
  const statusLine =
    state.buildOk === true
      ? `✅ Union build: green${doctored > 0 ? ` (after ${doctored} doctor round${doctored === 1 ? "" : "s"})` : (state.replayed || 0) > 0 ? " (replayed fixups held)" : ""}.`
      : state.buildOk === false
        ? `❌ Union build: still failing at ${state.stage || "build"} — the branch is pushed regardless; details in the notes.`
        : "Union build: not checked this run.";
  writeSummary(
    ["## Build all branch", "", pushLine, statusLine, "", ...notes.map((note) => `- ${note}`), "", state.manifest || ""].join("\n")
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("build-all-branch: self-test OK");
} else {
  const mode = process.argv[2] || "build";
  const flagValue = (name) => {
    const flag = process.argv.indexOf(name);
    return flag !== -1 && process.argv[flag + 1] ? process.argv[flag + 1] : "";
  };
  const requiredDir = (name) => {
    const value = flagValue(name);
    if (!value) {
      console.error(`build-all-branch ${mode}: ${name} <directory> is required`);
      process.exit(2);
    }
    // Resolve before prepare() moves to the repository root.
    return resolve(value);
  };
  try {
    const handoffDir = mode === "handoff" ? requiredDir("--out") : mode === "doctor-admit" ? requiredDir("--from") : "";
    prepare();
    if (mode === "build") buildMode();
    else if (mode === "check") checkMode();
    else if (mode === "handoff") handoffMode(handoffDir);
    else if (mode === "doctor-admit") doctorAdmitMode(handoffDir);
    else if (mode === "doctor-install") doctorInstallMode();
    else if (mode === "doctor-commit") {
      const flag = process.argv.indexOf("--round");
      doctorCommitMode(flag !== -1 && process.argv[flag + 1] ? process.argv[flag + 1] : "1");
    } else if (mode === "doctor-record") doctorRecordMode();
    else if (mode === "push") pushMode();
    else {
      console.error(`build-all-branch: unknown mode ${mode}`);
      process.exit(2);
    }
  } catch (error) {
    console.error(`build-all-branch: fatal: ${error?.message || error}`);
    process.exit(1);
  }
}
