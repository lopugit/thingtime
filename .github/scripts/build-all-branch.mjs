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
// - graphify-out/graph.json normally merges through the repo's graphify union
//   driver, which CI does not install; the driver is overridden to `cp %B %A`
//   (take theirs) so graph conflicts resolve the same way as everything else.
//   The graph/manifest pair may go stale on `all`; nothing runs
//   `graphify update` there.
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
// Modes (argv[2]): `build` (default) rebuild + replay + dedup decision;
// `check` run the union build (install → build:client → build:server) with
// mechanical lockfile repair; `doctor-commit --round N` guard + commit the
// model's working-tree edits; `doctor-record` note an exhausted doctor;
// `push` final force-push with the .github re-pin fallback and summary.
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
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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

// Override the repo's graphify union merge driver (the binary is not
// installed here) with a take-theirs command matching the global bias.
const MERGE_CONFIG = [
  "-c",
  "merge.graphify.name=all-branch take-theirs override",
  "-c",
  "merge.graphify.driver=cp %B %A",
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

// Merge one ref with the newest-wins policy. Returns { result } on success or
// { failed } after cleanly aborting, so one impossible merge never poisons the
// rest of the rebuild.
function mergeRef(ref, message) {
  const before = git("rev-parse", "HEAD");
  const merge = spawnSync(
    "git",
    [...MERGE_CONFIG, "merge", "--no-ff", "--no-edit", "-X", "theirs", "-m", message, ref],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "inherit", "pipe"] }
  );
  if (merge.status === 0) {
    return git("rev-parse", "HEAD") === before
      ? { result: "already included" }
      : { result: "clean merge" };
  }
  if (tryGit("rev-parse", "-q", "--verify", "MERGE_HEAD").status !== 0) {
    return { failed: `merge could not start: ${singleLine(merge.stderr, 200)}` };
  }

  // `-X theirs` already settled every textual conflict; what remains are the
  // structural cases (modify/delete, directory/file, -merge attributes).
  // Resolve them with the same bias: theirs where a "theirs" version exists,
  // deletion where theirs deleted.
  const abort = (failed) => {
    tryGit("merge", "--abort");
    return { failed };
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
    const resolved = stages.has("3")
      ? tryGit("checkout", "--theirs", "--", path).status === 0 &&
        tryGit("add", "--", path).status === 0
      : tryGit("rm", "-f", "-q", "--ignore-unmatch", "--", path).status === 0;
    if (!resolved) return abort(`could not theirs-resolve ${singleLine(path, 160)}`);
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
    result: `auto-resolved theirs (${resolvedPaths.length} paths: ${shown}${resolvedPaths.length > 8 ? ", …" : ""})`,
  };
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
    const allowed = [
      "remix/app/components/Feed/PostCard.tsx",
      "README.md",
      "scripts/vercel-build.mjs",
      "remix/package.json",
      "AI_ALL.md",
    ];
    for (const path of allowed) assert.equal(isForbiddenDoctorPath(path), false, `${path} must be editable`);
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

  writeState({ notes, manifest, proceed: true, buildOk: null, stage: "", replayed, doctored: 0, merges: merges.length, skips: skipped.length });
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
    if (!isForbiddenDoctorPath(path)) continue;
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
  const leaked = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].some((name) => {
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
    const pushArgs = ["push", "--force", "origin", `${ALL_BRANCH}:refs/heads/${ALL_BRANCH}`];
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
    if (push.status !== 0) {
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
  try {
    prepare();
    if (mode === "build") buildMode();
    else if (mode === "check") checkMode();
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
