#!/usr/bin/env node
// Promote develop → main as reviewable per-feature PRs (with stacks).
//
// Scans PRs merged into SOURCE_BRANCH (develop), and for each one that has not
// yet reached TARGET_BRANCH (main) re-applies its exact diff onto main via
// `git cherry-pick -x` on a dedicated `promote/pr-<n>-<slug>` branch, then
// opens a promotion PR targeting main. PRs that belong to the same feature
// group are stacked: the first promotion PR targets main, the second targets
// the first promotion branch, and so on (ordered by merge time into develop).
//
// Coexists with the all-or-nothing "Promote develop to main" omnibus PR
// (head `develop`): merging the omnibus makes every source merge commit an
// ancestor of main, so scans skip them, and open promotion PRs whose diff has
// become empty are closed automatically as redundant.
//
// Group membership for a source PR is resolved from, in priority order:
//   1. A `Promotion-Group: <key>` line or `<!-- promotion-group: <key> -->`
//      comment in the source PR body.
//   2. A `stack:<key>`, `group:<key>` or `feature:<key>` label.
//   3. A `feature/<key>/...` or `feat/<key>/...` head branch (3+ segments).
//   4. A conventional-commit title scope, e.g. `feat(<key>): ...`
//      (disable with GROUP_FROM_TITLE_SCOPE=false).
// PRs with no group signal promote as standalone single PRs.
//
// State model (no external state files — everything is derived from GitHub):
//   - A promotion PR carries `<!-- promotion-of: <n> -->` in its body and a
//     deterministic `promote/pr-<n>-*` head branch; either identifies it.
//   - content already on main (ancestor merge commit, or the cherry-pick
//     comes out empty) → skipped as a no-op.
//   - promotion MERGED  → source is done, never touched again.
//   - promotion OPEN    → reused as the base for later stack members.
//   - promotion CLOSED  → the change was rejected for main; never recreated
//                         (reopen the closed PR to change your mind).
//   - cherry-pick conflict → the group stops there (later members depend on
//     it); the summary prints exact manual commands, and the next run resumes
//     once the manually-pushed branch exists.
//
// Maintenance passes each run: open promotion PRs whose base promotion PR has
// merged are retargeted (backstop for GitHub's delete-branch auto-retarget),
// and open promotion PRs whose diff against their base is empty are closed as
// redundant (branch deleted once nothing stacks on it).
//
// Run modes: normal, DRY_RUN=1 (simulates cherry-picks in a temp worktree and
// reports the full plan without pushing/creating/closing anything),
// --self-test (pure-helper assertions plus local Git history regression tests;
// no network or GitHub access needed).

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const env = (key, fallback = "") => {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
};
const flag = (key, fallback) => {
  const value = env(key, fallback ? "true" : "false").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
};

const CFG = {
  source: env("SOURCE_BRANCH", "develop"),
  target: env("TARGET_BRANCH", "main"),
  lookback: Math.max(1, Math.min(100, Number(env("LOOKBACK", "50")) || 50)),
  maxNewPrs: Math.max(1, Number(env("MAX_NEW_PRS", "10")) || 10),
  requireLabel: env("REQUIRE_LABEL", ""),
  skipLabels: env("SKIP_LABELS", "no-promote,skip-promotion")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  groupFromTitleScope: flag("GROUP_FROM_TITLE_SCOPE", true),
  groupFromBranchPrefix: flag("GROUP_FROM_BRANCH_PREFIX", true),
  commentOnSource: flag("COMMENT_ON_SOURCE", true),
  promotionLabel: env("PROMOTION_LABEL", "promotion"),
  dryRun: flag("DRY_RUN", false),
  repo: env("GH_REPO", env("GITHUB_REPOSITORY", "")),
};

// ---------------------------------------------------------------------------
// Small process helpers (execFile only — no shell, no quoting hazards)
// ---------------------------------------------------------------------------

const EXEC_OPTS = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { ...EXEC_OPTS, stdio: ["ignore", "pipe", "pipe"], ...opts })
    .toString().trim();
}

function tryRun(cmd, args, { preserveOutput = false, ...opts } = {}) {
  const res = spawnSync(cmd, args, { ...EXEC_OPTS, ...opts });
  const stdout = (res.stdout || "").toString();
  const stderr = (res.stderr || "").toString();
  return {
    ok: res.status === 0,
    status: res.status,
    out: preserveOutput ? stdout : stdout.trim(),
    err: preserveOutput ? stderr : stderr.trim(),
  };
}

const git = (args, cwd) => run("git", args, cwd ? { cwd } : {});
const tryGit = (args, cwd) => tryRun("git", args, cwd ? { cwd } : {});
const gh = (args) => run("gh", args);
const ghJson = (args) => JSON.parse(run("gh", args) || "null");
const tryGh = (args) => tryRun("gh", args);

function failureDetail(result, fallback = "unknown error", maxLen = 500) {
  const detail = (result?.err || result?.out || fallback)
    .replace(/\s+/g, " ")
    .trim();
  return (detail || fallback).slice(0, maxLen);
}

// GitHub keeps a merged PR's original mergeCommit OID even when a later force
// rewrite makes that object unreachable from every advertised branch. A full
// checkout cannot fetch an unreachable object, but GitHub accepts an exact-OID
// fetch while it still retains the object. Hydrate it before any inspection so
// one historical rewrite cannot crash the whole promotion batch.
export function ensureCommitAvailable(sha, cwd, gitRunner = tryGit) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha || "")) {
    return { ok: false, error: `invalid merge commit OID \`${sha || "unknown"}\`` };
  }

  const probe = () => gitRunner(["cat-file", "-e", `${sha}^{commit}`], cwd);
  if (probe().ok) return { ok: true, fetched: false };

  const fetched = gitRunner(["fetch", "--no-tags", "--no-recurse-submodules", "origin", sha], cwd);
  if (!fetched.ok) {
    return {
      ok: false,
      error: `merge commit \`${sha}\` is missing locally and exact-SHA fetch failed: ${failureDetail(fetched)}`,
    };
  }
  if (!probe().ok) {
    return {
      ok: false,
      error: `merge commit \`${sha}\` was fetched by exact SHA but is still not a readable commit`,
    };
  }
  return { ok: true, fetched: true };
}

// `git merge-base --is-ancestor` deliberately returns 1 for "not an ancestor"
// and a different non-zero status for operational errors such as a missing
// object. Preserve that distinction instead of interpreting every failure as
// "not on main".
export function inspectAncestry(ancestor, descendant, cwd, gitRunner = tryGit) {
  const checked = gitRunner(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
  if (checked.status === 0) return { ok: true, isAncestor: true };
  if (checked.status === 1) return { ok: true, isAncestor: false };
  return {
    ok: false,
    error: `could not compare merge commit \`${ancestor}\` with \`${descendant}\`: ${failureDetail(checked)}`,
  };
}

export function patchIdForCommit(
  sha,
  cwd,
  { gitRunner = tryGit, commandRunner = tryRun, paths = [] } = {},
) {
  const inspected = gitRunner(["rev-list", "--parents", "-n", "1", sha], cwd);
  if (!inspected.ok) {
    return { ok: false, error: `cannot inspect \`${sha}\` for patch identity: ${failureDetail(inspected)}` };
  }
  const parts = inspected.out.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { ok: false, error: `cannot calculate patch identity for parentless commit \`${sha}\`` };
  }
  const diffArgs = ["diff", "--binary", parts[1], sha];
  if (paths.length > 0) diffArgs.push("--", ...paths);
  const diff = commandRunner("git", diffArgs, {
    ...EXEC_OPTS,
    cwd,
    preserveOutput: true,
  });
  if (!diff.ok) {
    return { ok: false, error: `cannot read patch for \`${sha}\`: ${failureDetail(diff)}` };
  }
  if (!diff.out) return { ok: false, error: `commit \`${sha}\` has an empty patch` };
  const identified = commandRunner("git", ["patch-id", "--stable"], {
    ...EXEC_OPTS,
    cwd,
    input: `${diff.out}\n`,
  });
  if (!identified.ok) {
    return { ok: false, error: `cannot calculate stable patch identity for \`${sha}\`: ${failureDetail(identified)}` };
  }
  const patchId = identified.out.split(/\s+/)[0] || "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(patchId)) {
    return { ok: false, error: `git returned an invalid patch identity for \`${sha}\`` };
  }
  return { ok: true, patchId };
}

function plannedDiffEndpoints(picks) {
  if (!Array.isArray(picks) || picks.length !== 1) {
    return { ok: false, error: "source-tip verification currently requires exactly one planned pick" };
  }
  const pick = picks[0] || {};
  if (pick.range) {
    const separator = pick.range.indexOf("..");
    if (separator <= 0 || separator >= pick.range.length - 2) {
      return { ok: false, error: `invalid planned cherry-pick range \`${pick.range}\`` };
    }
    return {
      ok: true,
      start: pick.range.slice(0, separator),
      end: pick.range.slice(separator + 2),
    };
  }
  if (!pick.sha) return { ok: false, error: "planned cherry-pick is missing a commit SHA" };
  return {
    ok: true,
    start: `${pick.sha}^${pick.mainline ? "1" : ""}`,
    end: pick.sha,
  };
}

// Read the exact aggregate patch that the promoter plans to apply. Generated
// Graphify data and the aggregate changelog are ignored when source files are
// also present: those are regenerated/combined independently and commonly
// differ across a history rewrite even when the feature itself is identical.
export function readPlannedPatch(
  picks,
  cwd,
  { gitRunner = tryGit, commandRunner = tryRun } = {},
) {
  const endpoints = plannedDiffEndpoints(picks);
  if (!endpoints.ok) return endpoints;
  const changed = gitRunner(["diff", "--name-only", endpoints.start, endpoints.end], cwd);
  if (!changed.ok) {
    return {
      ok: false,
      error: `cannot list the planned promotion patch: ${failureDetail(changed)}`,
    };
  }
  const paths = changed.out.split("\n").filter(Boolean);
  const meaningfulPaths = paths.filter(
    (path) => !path.startsWith("graphify-out/") && path !== "remix/CHANGELOG.md",
  );
  const selectedPaths = meaningfulPaths.length > 0 ? meaningfulPaths : paths;
  const diffArgs = ["diff", "--binary", "--full-index", endpoints.start, endpoints.end];
  if (selectedPaths.length > 0 && selectedPaths.length <= 200) {
    diffArgs.push("--", ...selectedPaths);
  } else if (meaningfulPaths.length > 0) {
    diffArgs.push("--", ".", ":(exclude)graphify-out/**", ":(exclude)remix/CHANGELOG.md");
  }
  const diff = commandRunner("git", diffArgs, {
    ...EXEC_OPTS,
    cwd,
    preserveOutput: true,
  });
  if (!diff.ok) {
    return { ok: false, error: `cannot read the planned promotion patch: ${failureDetail(diff)}` };
  }
  if (!diff.out) return { ok: false, error: "the planned promotion patch is empty" };
  const identified = commandRunner("git", ["patch-id", "--stable"], {
    ...EXEC_OPTS,
    cwd,
    input: `${diff.out}\n`,
  });
  if (!identified.ok) {
    return { ok: false, error: `cannot calculate the planned patch identity: ${failureDetail(identified)}` };
  }
  const patchId = identified.out.split(/\s+/)[0] || "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(patchId)) {
    return { ok: false, error: "git returned an invalid identity for the planned promotion patch" };
  }
  return {
    ok: true,
    patch: diff.out,
    patchId,
    paths: selectedPaths,
    start: endpoints.start,
    end: endpoints.end,
  };
}

// Check the current source tree, not merely its history. A force-rewritten
// equivalent commit may later be reverted: in that case the old patch is
// forward-applicable (absent), while a still-present patch is reverse-
// applicable. Ambiguous/overlapping evolution fails closed for human review.
export function inspectPatchAtSourceTip(
  patch,
  sourceSha,
  cwd,
  commandRunner = tryRun,
  branchLabel = CFG.source,
) {
  const root = mkdtempSync(join(process.env.RUNNER_TEMP || os.tmpdir(), "promote-source-tip-"));
  const indexPath = join(root, "index");
  const options = {
    ...EXEC_OPTS,
    cwd,
    env: { ...process.env, GIT_INDEX_FILE: indexPath },
  };
  try {
    const loaded = commandRunner("git", ["read-tree", sourceSha], options);
    if (!loaded.ok) {
      return { ok: false, error: `cannot inspect current source tree: ${failureDetail(loaded)}` };
    }
    const check = (reverse) => commandRunner(
      "git",
      ["apply", "--cached", "--check", "--whitespace=nowarn", ...(reverse ? ["--reverse"] : []), "-"],
      { ...options, input: `${patch}\n` },
    );
    const forward = check(false);
    const reverse = check(true);
    if (reverse.ok && !forward.ok) return { ok: true, present: true };
    if (forward.ok && !reverse.ok) {
      return {
        ok: true,
        present: false,
        detail:
          `the recovered promotion patch is not present at current \`${branchLabel}\` tip ` +
          "(it applies forward there, consistent with a later removal or revert)",
      };
    }
    return {
      ok: true,
      present: null,
      detail:
        `the recovered promotion patch is not verifiably present at current \`${branchLabel}\` tip; ` +
        `forward check: ${failureDetail(forward)}; reverse check: ${failureDetail(reverse)}`,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// A recovered historical merge is safe to promote only when the current
// source branch still contains its effect. Ancestry alone is insufficient
// because a later revert preserves ancestry. Exact patch identity plus a clean
// current-tip reverse-application is required after rewrites; uncertain state
// is blocked for manual review.
export function inspectSourcePresence(
  sha,
  sourceSha,
  cwd,
  {
    gitRunner = tryGit,
    ancestry = inspectAncestry,
    patchIdentity = patchIdForCommit,
    picks = [{ sha, mainline: true }],
    plannedPatch = readPlannedPatch,
    tipInspector = inspectPatchAtSourceTip,
    maxCandidates = 500,
  } = {},
) {
  if (!sourceSha) return { ok: false, error: "current source branch SHA is unavailable" };
  const contained = ancestry(sha, sourceSha, cwd, gitRunner);
  if (!contained.ok) return contained;

  const sourcePatch = plannedPatch(picks, cwd, { gitRunner });
  if (!sourcePatch.ok) return sourcePatch;
  const presentAtTip = tipInspector(sourcePatch.patch, sourceSha, cwd);
  if (!presentAtTip.ok) return presentAtTip;
  if (presentAtTip.present === false) {
    return { ok: false, error: presentAtTip.detail };
  }

  const candidatePaths = sourcePatch.paths || [];
  const patchPaths = candidatePaths.length <= 200 ? candidatePaths : [];
  if (contained.isAncestor) {
    if (presentAtTip.present !== true) return { ok: false, error: presentAtTip.detail };
    return {
      ok: true,
      equivalentSha: sha,
      rewritten: false,
      verifiedAtSourceTip: true,
    };
  }

  const args = ["rev-list", `--max-count=${Math.max(1, maxCandidates)}`, sourceSha];
  if (candidatePaths.length > 0 && candidatePaths.length <= 200) {
    args.push("--", ...candidatePaths);
  }
  const candidates = gitRunner(args, cwd);
  if (!candidates.ok) {
    return { ok: false, error: `cannot search current source history for an equivalent patch: ${failureDetail(candidates)}` };
  }

  let checked = 0;
  for (const candidate of candidates.out.split("\n").filter(Boolean)) {
    if (candidate === sha) continue;
    const candidatePatch = patchIdentity(candidate, cwd, { gitRunner, paths: patchPaths });
    if (!candidatePatch.ok) continue;
    checked += 1;
    if (candidatePatch.patchId === sourcePatch.patchId) {
      if (presentAtTip.present !== true) return { ok: false, error: presentAtTip.detail };
      return {
        ok: true,
        equivalentSha: candidate,
        rewritten: true,
        verifiedAtSourceTip: true,
        checked,
      };
    }
  }
  if (presentAtTip.present !== true) {
    return { ok: false, error: presentAtTip.detail };
  }
  return {
    ok: true,
    equivalentSha: sourceSha,
    rewritten: true,
    verifiedAtSourceTip: true,
    aggregateVerified: true,
    checked,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (covered by --self-test)
// ---------------------------------------------------------------------------

export function slugify(text, maxLen = 40) {
  const slug = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || "change";
}

const STRIP_PREFIXES = ["claude", "codex", "feature", "feat", "fix", "chore", "promote"];

export function promotionBranchFor(pr) {
  const segments = (pr.headRefName || "").split("/").filter(Boolean);
  while (segments.length > 1 && STRIP_PREFIXES.includes(segments[0].toLowerCase())) {
    segments.shift();
  }
  const base = segments.join("-") || pr.title || `pr-${pr.number}`;
  return `promote/pr-${pr.number}-${slugify(base)}`;
}

export function parsePromotionOf(body) {
  const match = /<!--\s*promotion-of:\s*#?(\d+)\s*-->/i.exec(body || "");
  return match ? Number(match[1]) : null;
}

export function parsePromotionGroupMarker(body) {
  const match = /<!--\s*promotion-group:\s*([^>]*?)\s*-->/i.exec(body || "");
  const key = match ? slugify(match[1]) : "";
  return key && key !== "change" ? key : null;
}

export function promotionSourceNumber(pr) {
  const marker = parsePromotionOf(pr?.body);
  if (marker !== null) return marker;
  const branchNumber = Number(/^promote\/pr-(\d+)-/.exec(pr?.headRefName || "")?.[1] || NaN);
  return Number.isFinite(branchNumber) ? branchNumber : null;
}

export function groupKeyFor(pr, cfg = CFG) {
  const body = pr.body || "";
  const explicit =
    /(?:^|\n)\s*promotion-group\s*:\s*([^\n<]+)/i.exec(body)?.[1] ??
    /<!--\s*promotion-group:\s*([^>]*?)\s*-->/i.exec(body)?.[1];
  if (explicit && slugify(explicit) !== "change") return slugify(explicit);

  for (const label of pr.labels || []) {
    const name = (label.name || label || "").toLowerCase();
    const match = /^(?:stack|group|feature):(.+)$/.exec(name);
    if (match && slugify(match[1]) !== "change") return slugify(match[1]);
  }

  if (cfg.groupFromBranchPrefix) {
    const segments = (pr.headRefName || "").split("/").filter(Boolean);
    if (segments.length >= 3 && ["feature", "feat"].includes(segments[0].toLowerCase())) {
      return slugify(segments[1]);
    }
  }

  if (cfg.groupFromTitleScope) {
    const match = /^(?:feat|fix|chore|refactor|perf|docs|test|build|ci|style)\(([^)]+)\)!?:/i
      .exec(pr.title || "");
    if (match && slugify(match[1]) !== "change") return slugify(match[1]);
  }

  return null; // standalone
}

export function promotionTitleFor(pr, groupKey, position) {
  const prefix = groupKey ? `[Promote][${groupKey} #${position}]` : "[Promote]";
  return `${prefix} ${pr.title} (#${pr.number})`;
}

export function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function orphanedMergeHydrationIntegrationTest(assert) {
  const root = mkdtempSync(join(os.tmpdir(), "promote-orphan-merge-test-"));
  const remote = join(root, "origin.git");
  const writer = join(root, "writer");
  const fresh = join(root, "fresh");
  const isolatedEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    TZ: "UTC",
  };
  const isolatedArgs = (args) => [
    "-c", "protocol.file.allow=always",
    "-c", "core.hooksPath=/dev/null",
    "-c", "maintenance.auto=false",
    ...args,
  ];
  const testGit = (args, cwd = root) =>
    run("git", isolatedArgs(args), { cwd, env: isolatedEnv });
  const testTryGit = (args, cwd = root) =>
    tryRun("git", isolatedArgs(args), { cwd, env: isolatedEnv });

  try {
    testGit(["init", "--bare", remote]);
    testGit(["config", "uploadpack.allowAnySHA1InWant", "true"], remote);
    testGit(["config", "gc.auto", "0"], remote);
    testGit(["config", "core.logAllRefUpdates", "false"], remote);

    testGit(["init", "--initial-branch=main", writer]);
    testGit(["config", "user.name", "Promoter Test"], writer);
    testGit(["config", "user.email", "promoter-test@example.invalid"], writer);
    writeFileSync(join(writer, "base.txt"), "base\n");
    testGit(["add", "base.txt"], writer);
    testGit(["commit", "-m", "base"], writer);
    testGit(["checkout", "-b", "develop"], writer);
    testGit(["checkout", "-b", "feature"], writer);
    writeFileSync(join(writer, "feature.txt"), "feature\n");
    testGit(["add", "feature.txt"], writer);
    testGit(["commit", "-m", "feature"], writer);
    const featureSha = testGit(["rev-parse", "HEAD"], writer);
    testGit(["checkout", "develop"], writer);
    testGit(["merge", "--no-ff", "feature", "-m", "merge feature"], writer);
    const orphanedMergeSha = testGit(["rev-parse", "HEAD"], writer);
    testGit(["remote", "add", "origin", `file://${remote}`], writer);
    testGit(["push", "origin", "main", "develop"], writer);

    // A normal merge remains an ancestor after `git revert`; ancestry alone
    // must not cause the removed feature to be promoted again.
    testGit(["checkout", "-b", "ancestry-revert", "develop"], writer);
    testGit(["revert", "-m", "1", "--no-edit", orphanedMergeSha], writer);
    const ancestryRevertTip = testGit(["rev-parse", "HEAD"], writer);
    const ancestryReverted = inspectSourcePresence(
      orphanedMergeSha,
      ancestryRevertTip,
      writer,
      { picks: [{ sha: orphanedMergeSha, mainline: true }] },
    );
    assert.equal(ancestryReverted.ok, false);
    assert.match(ancestryReverted.error, /not present at current `develop` tip/);

    // Reproduce the historical failure: force-rewrite develop to an equivalent
    // cherry-pick, leaving the original merge object stored but unadvertised.
    testGit(["checkout", "-B", "rewritten-develop", "main"], writer);
    testGit(["cherry-pick", featureSha], writer);
    const rewrittenSha = testGit(["rev-parse", "HEAD"], writer);
    testGit(["push", "--force", "origin", "HEAD:develop"], writer);

    testGit(["clone", "--no-local", "--branch", "develop", `file://${remote}`, fresh]);
    testGit(["config", "user.name", "Promoter Test"], fresh);
    testGit(["config", "user.email", "promoter-test@example.invalid"], fresh);
    assert.equal(
      testTryGit(["cat-file", "-e", `${orphanedMergeSha}^{commit}`], fresh).ok,
      false,
      "fresh full clone must omit the unreachable historical merge",
    );

    const sourcePr = { number: 999, title: "rewritten feature", mergeCommit: { oid: orphanedMergeSha } };
    const plans = preflightPromotionPlans([sourcePr], "origin/main", {
      cwd: fresh,
      sourceSha: "origin/develop",
    });
    const plan = plans.get(sourcePr.number);
    assert.equal(plan.error, undefined);
    assert.equal(plan.recovered, true);
    assert.equal(plan.sourceRewritten, true);
    assert.equal(plan.sourceEquivalent, rewrittenSha);
    assert.deepEqual(plan.picks, [{ sha: orphanedMergeSha, mainline: true }]);
    assert.equal(testGit(["rev-parse", "FETCH_HEAD"], fresh), orphanedMergeSha);
    assert.equal(
      testGit(["rev-list", "--parents", "-n", "1", orphanedMergeSha], fresh)
        .split(/\s+/).length,
      3,
      "the exact fetch must include both merge parents",
    );
    assert.deepEqual(
      inspectAncestry(orphanedMergeSha, "origin/develop", fresh, testTryGit),
      { ok: true, isAncestor: false },
      "the hydrated historical merge remains distinct from rewritten develop",
    );
    const removedFromSource = inspectSourcePresence(orphanedMergeSha, "origin/main", fresh);
    assert.equal(removedFromSource.ok, false);
    assert.match(removedFromSource.error, /not present at current `develop` tip/);

    testGit(["push", "origin", "main:refs/heads/promote/test-reuse"], writer);
    const firstBranchFetch = ensureRemoteBranchAvailable("promote/test-reuse", fresh, testTryGit);
    assert.equal(firstBranchFetch.ok, true);
    assert.equal(testGit(["rev-parse", firstBranchFetch.ref], fresh), testGit(["rev-parse", "main"], writer));
    testGit(["push", "--force", "origin", `${rewrittenSha}:refs/heads/promote/test-reuse`], writer);
    const refreshedBranch = ensureRemoteBranchAvailable("promote/test-reuse", fresh, testTryGit);
    assert.equal(refreshedBranch.ok, true);
    assert.equal(
      testGit(["rev-parse", refreshedBranch.ref], fresh),
      rewrittenSha,
      "reused promotion branches must refresh stale remote-tracking refs",
    );
    assert.equal(
      validateReusablePromotionBranch(
        refreshedBranch.ref, "origin/main", sourcePr, fresh, plan,
      ).ok,
      false,
      "a refreshed but repurposed branch without cherry-pick provenance must be rejected",
    );

    testGit(["checkout", "--detach", "origin/main"], fresh);
    testGit(["config", "user.name", ""], fresh);
    const identityFailure = applyPicks(fresh, plan.picks, testTryGit);
    assert.equal(identityFailure.status, "error");
    assert.match(identityFailure.detail, /empty ident name/i);
    assert.equal(
      testGit(["rev-parse", "HEAD^{tree}"], fresh),
      testGit(["rev-parse", "origin/main^{tree}"], fresh),
      "an identity failure must abort instead of silently skipping the source patch",
    );
    assert.equal(
      testTryGit(["diff", "--cached", "--quiet", "HEAD", "--"], fresh).status,
      0,
      "aborting an operational cherry-pick failure must clean the index",
    );
    assert.equal(
      testTryGit(["diff", "--quiet", "--"], fresh).status,
      0,
      "aborting an operational cherry-pick failure must clean tracked worktree changes",
    );

    testGit(["config", "user.name", "Promoter Test"], fresh);
    assert.deepEqual(applyPicks(fresh, plan.picks, testTryGit), { status: "ok" });
    assert.equal(
      testGit(["rev-parse", "HEAD^{tree}"], fresh),
      testGit(["rev-parse", `${rewrittenSha}^{tree}`], fresh),
      "the hydrated merge must be complete enough for a correct mainline cherry-pick",
    );
    const promotedTree = testGit(["rev-parse", "HEAD^{tree}"], fresh);
    assert.deepEqual(
      applyPicks(fresh, plan.picks, testTryGit),
      { status: "ok" },
      "a genuinely empty repeat pick must still be skipped safely",
    );
    assert.equal(testGit(["rev-parse", "HEAD^{tree}"], fresh), promotedTree);
    assert.deepEqual(
      validateReusablePromotionBranch("HEAD", "origin/main", sourcePr, fresh, plan),
      { ok: true },
      "a genuine `cherry-pick -x` promotion remains reusable",
    );
    const validPromotionSha = testGit(["rev-parse", "HEAD"], fresh);
    testGit(["config", "user.name", "Promoter Test"], fresh);
    testGit(["config", "user.email", "promoter-test@example.invalid"], fresh);
    writeFileSync(join(fresh, "unrelated.txt"), "unrelated branch drift\n");
    testGit(["add", "unrelated.txt"], fresh);
    testGit(["commit", "-m", "unexplained branch drift"], fresh);
    assert.equal(
      validateReusablePromotionBranch("HEAD", "origin/main", sourcePr, fresh, plan).ok,
      false,
      "an appended unrelated commit must make a promotion branch non-reusable",
    );
    testGit(["checkout", "--detach", validPromotionSha], fresh);
    writeFileSync(join(fresh, "feature.txt"), "  feature\n");
    testGit(["add", "feature.txt"], fresh);
    testGit(["commit", "--amend", "--no-edit"], fresh);
    assert.equal(
      validateReusablePromotionBranch("HEAD", "origin/main", sourcePr, fresh, plan).ok,
      false,
      "same-path whitespace drift must fail exact reconstructed-tree validation",
    );
    testGit(["checkout", "--detach", validPromotionSha], fresh);
    testGit(["revert", "--no-edit", validPromotionSha], fresh);
    assert.equal(
      validateReusablePromotionBranch("HEAD", "origin/main", sourcePr, fresh, plan).ok,
      false,
      "a branch that later reverts its genuine pick must not pass on trailer history alone",
    );

    const unavailable = ensureCommitAvailable("f".repeat(40), fresh, testTryGit);
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error, /exact-SHA fetch failed/);

    // A rebase-merged PR can require a multi-commit range. Verify the combined
    // range patch at the current source tip rather than checking only its last
    // commit, which would silently omit earlier changes.
    testGit(["checkout", "rewritten-develop"], writer);
    const rangeStart = testGit(["rev-parse", "HEAD"], writer);
    writeFileSync(join(writer, "range-a.txt"), "range a\n");
    testGit(["add", "range-a.txt"], writer);
    testGit(["commit", "-m", "range part a"], writer);
    writeFileSync(join(writer, "range-b.txt"), "range b\n");
    testGit(["add", "range-b.txt"], writer);
    testGit(["commit", "-m", "range part b"], writer);
    const rangeEnd = testGit(["rev-parse", "HEAD"], writer);
    testGit(["push", "origin", "HEAD:develop"], writer);
    testGit([
      "fetch", "origin", "+refs/heads/develop:refs/remotes/origin/develop",
    ], fresh);
    const aggregatePresence = inspectSourcePresence(
      orphanedMergeSha,
      "origin/develop",
      fresh,
      { picks: [{ range: `${rangeStart}..${rangeEnd}` }] },
    );
    assert.equal(aggregatePresence.ok, true);
    assert.equal(aggregatePresence.aggregateVerified, true);

    // Merely finding an equivalent rewritten commit in history is not enough:
    // if a later source commit reverts it, preflight must fail closed.
    testGit(["revert", "--no-edit", rewrittenSha], writer);
    testGit(["push", "origin", "HEAD:develop"], writer);
    testGit([
      "fetch", "origin", "+refs/heads/develop:refs/remotes/origin/develop",
    ], fresh);
    const revertedPlans = preflightPromotionPlans([sourcePr], "origin/main", {
      cwd: fresh,
      sourceSha: "origin/develop",
    });
    assert.match(
      revertedPlans.get(sourcePr.number).error,
      /not present at current `develop` tip/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function selfTest() {
  const { strict: assert } = await import("node:assert");

  assert.equal(slugify("Hello, World! 42"), "hello-world-42");
  assert.equal(slugify("---"), "change");
  assert.equal(slugify("a".repeat(80)).length, 40);

  const pr = { number: 7, headRefName: "claude/search-index-abc123", title: "feat: add search" };
  assert.equal(promotionBranchFor(pr), "promote/pr-7-search-index-abc123");
  assert.equal(promotionBranchFor({ number: 8, headRefName: "", title: "Fix: A thing" }),
    "promote/pr-8-fix-a-thing");

  assert.equal(parsePromotionOf("hi\n<!-- promotion-of: 123 -->\nbye"), 123);
  assert.equal(parsePromotionOf("<!-- promotion-of: #45 -->"), 45);
  assert.equal(parsePromotionOf("nothing"), null);
  assert.equal(parsePromotionGroupMarker("<!-- promotion-group: search-v2 -->"), "search-v2");
  assert.equal(parsePromotionGroupMarker("<!-- promotion-group:  -->"), null);
  assert.equal(
    promotionSourceNumber({ body: "<!-- promotion-of: 44 -->", headRefName: "promote/pr-1-old" }),
    44,
  );
  assert.equal(promotionSourceNumber({ body: "", headRefName: "promote/pr-45-feature" }), 45);
  assert.equal(promotionSourceNumber({ body: "", headRefName: "feature/not-promotion" }), null);

  const cfg = { groupFromTitleScope: true, groupFromBranchPrefix: true };
  assert.equal(groupKeyFor({ body: "Promotion-Group: Search V2", title: "x" }, cfg), "search-v2");
  assert.equal(groupKeyFor({ body: "<!-- promotion-group: search -->", title: "x" }, cfg), "search");
  assert.equal(groupKeyFor({ labels: [{ name: "stack:messenger" }], title: "x" }, cfg), "messenger");
  assert.equal(groupKeyFor({ labels: [{ name: "feature:Feed Algo" }], title: "x" }, cfg), "feed-algo");
  assert.equal(groupKeyFor({ headRefName: "feature/search/indexing", title: "x" }, cfg), "search");
  assert.equal(groupKeyFor({ headRefName: "feature/only-two", title: "x" }, cfg), null);
  assert.equal(groupKeyFor({ title: "feat(search): add fuzzy match" }, cfg), "search");
  assert.equal(groupKeyFor({ title: "feat(search): x" }, { ...cfg, groupFromTitleScope: false }), null);
  assert.equal(groupKeyFor({ title: "plain title", headRefName: "claude/foo-bar" }, cfg), null);

  assert.equal(promotionTitleFor({ title: "Add search", number: 9 }, null, 1), "[Promote] Add search (#9)");
  assert.equal(promotionTitleFor({ title: "Add search", number: 9 }, "search", 2),
    "[Promote][search #2] Add search (#9)");

  assert.ok(setsEqual(new Set(["a", "b"]), new Set(["b", "a"])));
  assert.ok(!setsEqual(new Set(["a"]), new Set(["a", "b"])));

  for (const length of [39, 41, 63, 65]) {
    assert.equal(
      ensureCommitAvailable("a".repeat(length), undefined,
        () => ({ ok: true, status: 0, out: "", err: "" })).ok,
      false,
    );
  }
  for (const length of [40, 64]) {
    assert.deepEqual(
      ensureCommitAvailable("a".repeat(length), undefined,
        () => ({ ok: true, status: 0, out: "", err: "" })),
      { ok: true, fetched: false },
    );
  }

  assert.deepEqual(
    inspectAncestry("a".repeat(40), "b".repeat(40), undefined,
      () => ({ ok: false, status: 1, out: "", err: "" })),
    { ok: true, isAncestor: false },
  );
  assert.match(
    inspectAncestry("a".repeat(40), "b".repeat(40), undefined,
      () => ({ ok: false, status: 128, out: "", err: "fatal: bad object" })).error,
    /bad object/,
  );

  const sourcePrs = [
    { number: 10, title: "first", mergeCommit: { oid: "a".repeat(40) } },
    { number: 11, title: "missing", mergeCommit: { oid: "b".repeat(40) } },
    { number: 12, title: "third", mergeCommit: { oid: "c".repeat(40) } },
  ];
  const plans = preflightPromotionPlans(sourcePrs, "d".repeat(40), {
    ensure: (sha) => sha === "b".repeat(40)
      ? { ok: false, error: "fixture object unavailable" }
      : { ok: true, fetched: false },
    sourcePresence: (sha) => ({ ok: true, equivalentSha: sha, rewritten: false }),
    ancestry: () => ({ ok: true, isAncestor: false }),
    compute: (sourcePr) => ({ picks: [{ sha: sourcePr.mergeCommit.oid }] }),
    plannedPatch: () => ({ ok: true, patch: "fixture patch" }),
    targetPresence: () => ({ ok: true, present: false }),
  });
  assert.deepEqual(plans.get(10).picks, [{ sha: "a".repeat(40) }]);
  assert.match(plans.get(11).error, /fixture object unavailable/);
  assert.deepEqual(plans.get(12).picks, [{ sha: "c".repeat(40) }]);
  let sourcePresenceCalledForTarget = false;
  const targetEquivalentPlans = preflightPromotionPlans([sourcePrs[0]], "d".repeat(40), {
    ensure: () => ({ ok: true, fetched: false }),
    ancestry: () => ({ ok: true, isAncestor: false }),
    compute: (sourcePr) => ({ picks: [{ sha: sourcePr.mergeCommit.oid }] }),
    plannedPatch: () => ({ ok: true, patch: "fixture patch" }),
    targetPresence: () => ({ ok: true, present: true }),
    sourcePresence: () => {
      sourcePresenceCalledForTarget = true;
      return { ok: false, error: "must not run" };
    },
  });
  assert.equal(targetEquivalentPlans.get(10).inTarget, true);
  assert.equal(targetEquivalentPlans.get(10).targetPatchEquivalent, true);
  assert.equal(sourcePresenceCalledForTarget, false);

  const stack = { key: "alpha", prs: sourcePrs };
  assert.deepEqual(dependentMembersAfter(stack, 1).map((member) => member.number), [12]);
  assert.deepEqual(dependentMembersAfter({ key: null, prs: [sourcePrs[1]] }, 0), []);
  assert.deepEqual(groupFailureMessages(stack, 1, "object unavailable"), [
    "#11 missing — object unavailable",
    "Stack `alpha` stopped at #11; dependent source PRs #12 were deferred.",
  ]);
  assert.deepEqual(validateGroupChronology({
    key: "alpha",
    prs: [
      { number: 1, mergedAt: "2026-08-09T00:00:00Z" },
      { number: 2, mergedAt: "2026-08-09T00:00:01Z" },
    ],
  }), { ok: true });
  assert.match(validateGroupChronology({
    key: "alpha",
    prs: [
      { number: 1, mergedAt: "2026-08-09T00:00:00Z" },
      { number: 2, mergedAt: "2026-08-09T00:00:00Z" },
    ],
  }).error, /dependency order is ambiguous/);
  const externalClosed = {
    number: 90,
    state: "CLOSED",
    body: "<!-- promotion-of: 9 -->\n<!-- promotion-group: alpha -->",
    headRefName: "promote/pr-9-prerequisite",
  };
  const externalOpen = {
    number: 91,
    state: "OPEN",
    body: "<!-- promotion-of: 8 -->\n<!-- promotion-group: alpha -->",
    headRefName: "promote/pr-8-prerequisite",
  };
  assert.deepEqual(
    externalStackPromotionState(
      stack,
      [externalClosed, externalOpen],
      new Map([[9, externalClosed], [8, externalOpen]]),
    ),
    {
      closed: externalClosed,
      closeds: [externalClosed],
      open: externalOpen,
      opens: [externalOpen],
    },
  );

  const processedGroups = [];
  const failedGroups = [];
  processGroupsIndependently(
    [{ key: "first" }, { key: "broken" }, { key: "third" }],
    (group) => {
      if (group.key === "broken") throw new Error("fixture failure");
      processedGroups.push(group.key);
    },
    (group, error) => failedGroups.push(`${group.key}:${error.message}`),
  );
  assert.deepEqual(processedGroups, ["first", "third"]);
  assert.deepEqual(failedGroups, ["broken:fixture failure"]);

  const partialResults = {
    created: [], recovered: [], retargeted: [], closed: [], conflicts: [],
    blocked: [], warnings: [], skipped: [],
  };
  let summarizedPartial = null;
  await assert.rejects(
    runWithSummary(
      async () => {
        partialResults.conflicts.push("fixture conflict");
        throw new Error("fixture fatal");
      },
      partialResults,
      { eligibleCount: 3 },
      (results, count) => { summarizedPartial = { results, count }; },
    ),
    /fixture fatal/,
  );
  assert.equal(summarizedPartial.count, 3);
  assert.deepEqual(summarizedPartial.results.conflicts, ["fixture conflict"]);
  assert.match(summarizedPartial.results.blocked[0], /fixture fatal/);

  const structuredPlanFailure = computePicks(
    sourcePrs[1],
    { gitRunner: () => ({ ok: false, status: 128, out: "", err: "fatal: bad object" }) },
  );
  assert.match(structuredPlanFailure.error, /cannot inspect merge commit/);

  orphanedMergeHydrationIntegrationTest(assert);

  console.log("self-test OK");
}

// ---------------------------------------------------------------------------
// GitHub data loading
// ---------------------------------------------------------------------------

function repoFlag() {
  return CFG.repo ? ["--repo", CFG.repo] : [];
}

function listMergedSourcePrs() {
  const fields = "number,title,body,labels,headRefName,url,mergedAt,mergeCommit,author";
  const prs = ghJson([
    "pr", "list", ...repoFlag(),
    "--base", CFG.source, "--state", "merged",
    "--limit", String(CFG.lookback), "--json", fields,
  ]) || [];
  prs.sort((a, b) => (a.mergedAt || "").localeCompare(b.mergedAt || ""));
  return prs;
}

function loadSourcePr(number) {
  const fields = "number,title,body,labels,headRefName,url,mergedAt,mergeCommit,author,state";
  return ghJson([
    "pr", "view", String(number), ...repoFlag(), "--json", fields,
  ]);
}

function listPromotionPrs() {
  const fields = "number,state,title,body,headRefName,baseRefName,url";
  const prs = ghJson([
    "pr", "list", ...repoFlag(),
    // `gh pr list` paginates up to this limit. Keep enough history for stable
    // promotion markers as the repository grows beyond a few hundred PRs.
    "--state", "all", "--limit", "1000", "--json", fields,
  ]) || [];
  return prs.filter(
    (pr) => pr.headRefName?.startsWith("promote/pr-") || parsePromotionOf(pr.body) !== null,
  );
}

// Collapse possibly-multiple promotion records per source PR: MERGED wins,
// then OPEN, then the newest CLOSED.
function indexPromotionsBySource(promotionPrs) {
  const bySource = new Map();
  const rank = { MERGED: 3, OPEN: 2, CLOSED: 1 };
  for (const pr of promotionPrs) {
    const source = promotionSourceNumber(pr);
    if (!Number.isFinite(source)) continue;
    const existing = bySource.get(source);
    if (
      !existing ||
      (rank[pr.state] || 0) > (rank[existing.state] || 0) ||
      ((rank[pr.state] || 0) === (rank[existing.state] || 0) && pr.number > existing.number)
    ) {
      bySource.set(source, pr);
    }
  }
  return bySource;
}

function listRemotePromotionBranches() {
  const out = tryGit(["ls-remote", "--heads", "origin", "refs/heads/promote/*"]);
  if (!out.ok) return new Set();
  return new Set(
    out.out.split("\n").filter(Boolean)
      .map((line) => line.split("\t")[1]?.replace("refs/heads/", ""))
      .filter(Boolean),
  );
}

export function ensureRemoteBranchAvailable(branch, cwd, gitRunner = tryGit) {
  const localRef = `refs/remotes/origin/${branch}`;
  const valid = gitRunner(["check-ref-format", `refs/heads/${branch}`], cwd);
  if (!valid.ok) return { ok: false, error: `invalid remote branch name \`${branch}\`` };
  // Always refresh the exact live branch. Conflict/rebase automation can
  // force-update an open promotion branch between promoter runs, so merely
  // finding an existing local remote-tracking ref is not proof it is current.
  const fetched = gitRunner([
    "fetch", "--no-tags", "--no-recurse-submodules", "origin",
    `+refs/heads/${branch}:${localRef}`,
  ], cwd);
  if (!fetched.ok) {
    return { ok: false, error: `could not fetch \`${branch}\`: ${failureDetail(fetched)}` };
  }
  if (!gitRunner(["rev-parse", "--verify", `${localRef}^{commit}`], cwd).ok) {
    return { ok: false, error: `fetched \`${branch}\` but \`${localRef}\` is still unavailable` };
  }
  return { ok: true, fetched: true, ref: localRef };
}

function checkoutRemoteBranch(worktree, branch) {
  const available = ensureRemoteBranchAvailable(branch);
  if (!available.ok) return available;
  const checked = tryGit(["checkout", "--detach", available.ref], worktree);
  if (!checked.ok) {
    return { ok: false, error: `could not check out \`${branch}\`: ${failureDetail(checked)}` };
  }
  return { ok: true, fetched: available.fetched };
}

// Existing promotion branches are mutable remote state. Before using one as a
// stack base or opening a missing PR for it, prove it descends from the base we
// just selected and still carries the script's `cherry-pick -x` provenance for
// this exact source merge. This rejects stale or repurposed orphan branches.
export function validateReusablePromotionBranch(
  branchRef,
  expectedBaseRef,
  sourcePr,
  cwd,
  plan,
  {
    ancestry = inspectAncestry,
    gitRunner = tryGit,
    plannedPatch = readPlannedPatch,
  } = {},
) {
  const descended = ancestry(expectedBaseRef, branchRef, cwd, gitRunner);
  if (!descended.ok) return descended;
  if (!descended.isAncestor) {
    return {
      ok: false,
      error: `promotion branch is not based on current expected base \`${expectedBaseRef}\``,
    };
  }
  const history = gitRunner(["log", "--format=%B", `${expectedBaseRef}..${branchRef}`], cwd);
  if (!history.ok) {
    return { ok: false, error: `cannot inspect reusable promotion branch history: ${failureDetail(history)}` };
  }
  const mergeSha = sourcePr.mergeCommit?.oid || "";
  if (!Array.isArray(plan?.picks) || plan.picks.length === 0) {
    return { ok: false, error: "promotion branch validation is missing its expected pick plan" };
  }
  const expectedPickShas = [];
  for (const pick of plan.picks) {
    if (pick.range) {
      const rangeCommits = gitRunner(["rev-list", "--reverse", pick.range], cwd);
      if (!rangeCommits.ok) {
        return { ok: false, error: `cannot expand expected pick range \`${pick.range}\`` };
      }
      expectedPickShas.push(...rangeCommits.out.split("\n").filter(Boolean));
    } else if (pick.sha) {
      expectedPickShas.push(pick.sha);
    }
  }
  const expectedTrailers = new Map(expectedPickShas.map((sha) => [
    `(cherry picked from commit ${sha})`.toLowerCase(),
    sha,
  ]));
  const lowerHistory = history.out.toLowerCase();
  if (
    !mergeSha || expectedTrailers.size === 0 ||
    [...expectedTrailers.keys()].some((trailer) => !lowerHistory.includes(trailer))
  ) {
    return {
      ok: false,
      error:
        `promotion branch does not contain every expected cherry-pick provenance trailer for source merge ` +
        `\`${mergeSha || "unknown"}\`; refusing to reuse potentially drifted branch state`,
    };
  }
  const expectedPatch = plannedPatch(plan.picks, cwd, { gitRunner });
  if (!expectedPatch.ok) return expectedPatch;

  const actualFiles = gitRunner(
    ["diff", "--name-only", expectedBaseRef, branchRef],
    cwd,
  );
  if (!actualFiles.ok) {
    return { ok: false, error: `cannot inspect reusable promotion diff: ${failureDetail(actualFiles)}` };
  }
  const expectedPaths = new Set(expectedPatch.paths);
  const unexpectedPaths = actualFiles.out.split("\n").filter(Boolean).filter(
    (path) =>
      !expectedPaths.has(path) &&
      !path.startsWith("graphify-out/") &&
      path !== "remix/CHANGELOG.md",
  );
  if (unexpectedPaths.length > 0) {
    return {
      ok: false,
      error:
        `promotion branch changes unexplained path(s): ` +
        unexpectedPaths.slice(0, 10).map((path) => `\`${path}\``).join(", "),
    };
  }
  if (!setsEqual(expectedPaths, new Set(
    actualFiles.out.split("\n").filter(Boolean).filter(
      (path) => !path.startsWith("graphify-out/") && path !== "remix/CHANGELOG.md",
    ),
  ))) {
    return { ok: false, error: "promotion branch does not change exactly the expected source paths" };
  }
  const verificationRoot = mkdtempSync(
    join(process.env.RUNNER_TEMP || os.tmpdir(), "promote-expected-tree-"),
  );
  const verificationWorktree = join(verificationRoot, "wt");
  const verificationGit = (args, directory) => tryRun(
    "git",
    ["-c", "core.hooksPath=/dev/null", ...args],
    directory ? { cwd: directory } : {},
  );
  let worktreeAdded = false;
  try {
    const added = verificationGit(
      ["worktree", "add", "--detach", verificationWorktree, expectedBaseRef],
      cwd,
    );
    if (!added.ok) {
      return { ok: false, error: `cannot build expected promotion tree: ${failureDetail(added)}` };
    }
    worktreeAdded = true;
    const applied = applyPicks(verificationWorktree, plan.picks, verificationGit);
    if (applied.status !== "ok") {
      return {
        ok: false,
        error: `expected source picks do not reconstruct cleanly on the current base: ${applied.detail || applied.status}`,
      };
    }
    for (const path of expectedPatch.paths) {
      const expectedEntry = verificationGit(["ls-tree", "HEAD", "--", path], verificationWorktree);
      const actualEntry = gitRunner(["ls-tree", branchRef, "--", path], cwd);
      if (!expectedEntry.ok || !actualEntry.ok || expectedEntry.out !== actualEntry.out) {
        return {
          ok: false,
          error: `promotion branch tree entry for \`${path}\` differs from the exact reconstructed source pick`,
        };
      }
    }
  } finally {
    if (worktreeAdded) verificationGit(["worktree", "remove", "--force", verificationWorktree], cwd);
    verificationGit(["worktree", "prune"], cwd);
    rmSync(verificationRoot, { recursive: true, force: true });
  }

  const commits = gitRunner(["rev-list", "--reverse", `${expectedBaseRef}..${branchRef}`], cwd);
  if (!commits.ok) {
    return { ok: false, error: `cannot inspect reusable promotion commits: ${failureDetail(commits)}` };
  }
  const observedPickCounts = new Map();
  for (const commit of commits.out.split("\n").filter(Boolean)) {
    const parents = gitRunner(["rev-list", "--parents", "-n", "1", commit], cwd);
    if (!parents.ok) {
      return { ok: false, error: `cannot inspect reusable promotion commit \`${commit}\`` };
    }
    if (parents.out.split(/\s+/).filter(Boolean).length >= 3) continue; // base-refresh merge
    const body = gitRunner(["show", "-s", "--format=%B", commit], cwd);
    const bodyLower = body.ok ? body.out.toLowerCase() : "";
    const matchedTrailer = [...expectedTrailers].find(([trailer]) => bodyLower.includes(trailer));
    if (matchedTrailer) {
      observedPickCounts.set(
        matchedTrailer[1],
        (observedPickCounts.get(matchedTrailer[1]) || 0) + 1,
      );
      continue;
    }
    const files = gitRunner(["diff-tree", "--no-commit-id", "--name-only", "-r", commit], cwd);
    const changed = files.ok ? files.out.split("\n").filter(Boolean) : [];
    if (
      files.ok && changed.length > 0 &&
      changed.every((path) => path.startsWith("graphify-out/") || path === "remix/CHANGELOG.md")
    ) {
      continue;
    }
    return {
      ok: false,
      error:
        `promotion branch contains unexplained commit \`${commit}\` outside its source pick ` +
        "and generated Graphify/changelog follow-ups",
    };
  }
  const provenanceIsExact =
    observedPickCounts.size === expectedTrailers.size &&
    [...expectedTrailers.values()].every((sha) => observedPickCounts.get(sha) === 1);
  if (!provenanceIsExact) {
    return {
      ok: false,
      error:
        `promotion branch cherry-pick provenance is not one-to-one with its ` +
        `${expectedTrailers.size} expected source pick(s)`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Maintenance: retarget open promotion PRs whose base promotion has merged
// ---------------------------------------------------------------------------

function retargetPass(promotionPrs, results) {
  const byHead = new Map(promotionPrs.map((pr) => [pr.headRefName, pr]));
  for (const pr of promotionPrs) {
    if (pr.state !== "OPEN" || pr.baseRefName === CFG.target) continue;
    if (!pr.baseRefName?.startsWith("promote/")) continue;
    let base = pr.baseRefName;
    let hops = 0;
    while (hops++ < 20) {
      const basePr = byHead.get(base);
      if (basePr?.state === "MERGED") {
        base = basePr.baseRefName;
        continue;
      }
      if (basePr?.state === "CLOSED") {
        results.warnings.push(
          `#${pr.number} targets \`${base}\`, whose promotion PR #${basePr.number} was closed without merging — the stack needs manual attention.`,
        );
        base = pr.baseRefName; // leave unchanged
      }
      break;
    }
    if (base !== pr.baseRefName) {
      if (CFG.dryRun) {
        results.retargeted.push(`(dry-run) would retarget #${pr.number}: \`${pr.baseRefName}\` → \`${base}\``);
      } else {
        const res = tryGh(["pr", "edit", String(pr.number), ...repoFlag(), "--base", base]);
        if (res.ok) {
          results.retargeted.push(`retargeted #${pr.number}: \`${pr.baseRefName}\` → \`${base}\``);
          pr.baseRefName = base;
        } else {
          results.warnings.push(`failed to retarget #${pr.number} to \`${base}\`: ${res.err}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Maintenance: close promotion PRs made redundant by an omnibus (or direct)
// merge — their diff against the base is empty, so there is nothing to review.
// ---------------------------------------------------------------------------

function closeRedundantPass(promotionPrs, results) {
  const closed = [];
  for (const pr of promotionPrs) {
    if (pr.state !== "OPEN") continue;
    const diff = tryGh(["pr", "diff", String(pr.number), ...repoFlag(), "--name-only"]);
    if (!diff.ok || diff.out !== "") continue;
    if (CFG.dryRun) {
      results.closed.push(`(dry-run) would close #${pr.number} (\`${pr.headRefName}\`) — empty diff vs \`${pr.baseRefName}\``);
      continue;
    }
    const res = tryGh(["pr", "close", String(pr.number), ...repoFlag(), "--comment",
      `🧹 Closing as redundant: these changes have already reached \`${pr.baseRefName}\` ` +
      `(for example via an omnibus ${CFG.source} → ${CFG.target} merge), so this PR's diff is empty. ` +
      "Reopen if that looks wrong."]);
    if (res.ok) {
      pr.state = "CLOSED";
      closed.push(pr);
      results.closed.push(`closed #${pr.number} (\`${pr.headRefName}\`) — empty diff vs \`${pr.baseRefName}\``);
    } else {
      results.warnings.push(`failed to close redundant #${pr.number}: ${res.err}`);
    }
  }
  for (const pr of closed) {
    const stillUsed = promotionPrs.some(
      (other) => other.state === "OPEN" && other.baseRefName === pr.headRefName,
    );
    if (!stillUsed) tryGit(["push", "origin", "--delete", pr.headRefName]);
  }
}

// ---------------------------------------------------------------------------
// Cherry-pick planning and execution
// ---------------------------------------------------------------------------

// Decide what to cherry-pick for one source PR. Merge commits use `-m 1`
// (full PR diff vs develop's first parent). Single-parent merge commits are
// squash or rebase merges: a squash commit alone IS the full diff; a rebase
// merge of a multi-commit PR needs the whole rebased range, which we accept
// only when its combined file list matches the PR's file list.
export function computePicks(pr, { gitRunner = tryGit, ghRunner = tryGh, cwd } = {}) {
  const sha = pr.mergeCommit?.oid;
  if (!sha) return { error: "merge commit unknown" };
  const inspected = gitRunner(["rev-list", "--parents", "-n", "1", sha], cwd);
  if (!inspected.ok) {
    return {
      error: `cannot inspect merge commit \`${sha}\`: ${failureDetail(inspected)}`,
    };
  }
  const commitLine = inspected.out.split(/\s+/).filter(Boolean);
  if (commitLine.length === 0) {
    return { error: `cannot inspect merge commit \`${sha}\`: git returned no commit data` };
  }
  const parents = commitLine.length - 1;
  if (parents >= 2) return { picks: [{ sha, mainline: true }] };

  const commits = ghRunner(["pr", "view", String(pr.number), ...repoFlag(), "--json", "commits",
    "--jq", ".commits | length"]);
  if (!commits.ok) {
    return { error: `cannot load source PR commit metadata: ${failureDetail(commits)}` };
  }
  const commitCount = Number(commits.out || "1");
  if (!Number.isFinite(commitCount) || commitCount < 1) {
    return { error: `source PR commit metadata returned invalid count \`${commits.out}\`` };
  }
  if (commitCount <= 1) return { picks: [{ sha }] };

  const rangeStart = gitRunner(["rev-parse", `${sha}~${commitCount}`], cwd);
  if (rangeStart.ok) {
    const rangeDiff = gitRunner(["diff", "--name-only", `${sha}~${commitCount}`, sha], cwd);
    const sourceFiles = ghRunner(["pr", "view", String(pr.number), ...repoFlag(), "--json", "files",
      "--jq", ".files[].path"]);
    if (!rangeDiff.ok || !sourceFiles.ok) {
      return {
        picks: [{ sha }],
        warning:
          `#${pr.number} looks rebase-merged with ${commitCount} commits, but its full range ` +
          `could not be verified (${failureDetail(!rangeDiff.ok ? rangeDiff : sourceFiles)}); ` +
          "promoting the merge commit only — verify the promotion diff.",
      };
    }
    const rangeFiles = new Set(
      rangeDiff.out.split("\n").filter(Boolean),
    );
    const prFiles = new Set(
      sourceFiles.out.split("\n").filter(Boolean),
    );
    if (prFiles.size > 0 && setsEqual(rangeFiles, prFiles)) {
      return { picks: [{ range: `${sha}~${commitCount}..${sha}` }] };
    }
  }
  return {
    picks: [{ sha }],
    warning: `#${pr.number} looks rebase-merged with ${commitCount} commits; promoting the merge commit only — verify the promotion diff.`,
  };
}

// Plan every source PR before GitHub-side maintenance or promotion mutations.
// Each plan is isolated: an absent historical object or another inspection
// error becomes data associated with that PR instead of an exception that
// terminates the batch.
export function preflightPromotionPlans(
  prs,
  targetSha,
  {
    cwd,
    sourceSha,
    ensure = ensureCommitAvailable,
    ancestry = inspectAncestry,
    sourcePresence = inspectSourcePresence,
    compute = computePicks,
    plannedPatch = readPlannedPatch,
    targetPresence = inspectPatchAtSourceTip,
  } = {},
) {
  const plans = new Map();
  for (const pr of prs) {
    const sha = pr.mergeCommit?.oid;
    try {
      const available = ensure(sha, cwd);
      if (!available.ok) {
        plans.set(pr.number, { error: available.error });
        continue;
      }
      const compared = ancestry(sha, targetSha, cwd);
      if (!compared.ok) {
        plans.set(pr.number, { error: compared.error, recovered: available.fetched });
        continue;
      }
      if (compared.isAncestor) {
        plans.set(pr.number, {
          inTarget: true,
          picks: [],
          recovered: available.fetched,
        });
        continue;
      }
      const computed = compute(pr, { cwd });
      if (computed.error) {
        plans.set(pr.number, {
          ...computed,
          inTarget: false,
          recovered: available.fetched,
        });
        continue;
      }
      const targetPatch = plannedPatch(computed.picks, cwd);
      if (!targetPatch.ok) {
        plans.set(pr.number, {
          error: targetPatch.error,
          inTarget: false,
          recovered: available.fetched,
        });
        continue;
      }
      const onTarget = targetPresence(targetPatch.patch, targetSha, cwd, tryRun, CFG.target);
      if (!onTarget.ok) {
        plans.set(pr.number, {
          error: onTarget.error,
          inTarget: false,
          recovered: available.fetched,
        });
        continue;
      }
      if (onTarget.present === true) {
        plans.set(pr.number, {
          ...computed,
          inTarget: true,
          recovered: available.fetched,
          targetPatchEquivalent: true,
        });
        continue;
      }
      const present = sourcePresence(sha, sourceSha, cwd, { picks: computed.picks });
      if (!present.ok) {
        plans.set(pr.number, { error: present.error, recovered: available.fetched });
        continue;
      }
      plans.set(pr.number, {
        ...computed,
        inTarget: false,
        recovered: available.fetched,
        sourceEquivalent: present.equivalentSha,
        sourceRewritten: present.rewritten,
        verifiedAtSourceTip: present.verifiedAtSourceTip,
        aggregateVerified: present.aggregateVerified,
      });
    } catch (error) {
      plans.set(pr.number, {
        error: `unexpected planning failure: ${failureDetail({ err: String(error?.message || error) })}`,
      });
    }
  }
  return plans;
}

export function dependentMembersAfter(group, index) {
  return group.key ? group.prs.slice(index + 1) : [];
}

export function groupFailureMessages(group, index, reason) {
  const pr = group.prs[index];
  const messages = [`#${pr.number} ${pr.title} — ${reason}`];
  const dependents = dependentMembersAfter(group, index);
  if (dependents.length > 0) {
    messages.push(
      `Stack \`${group.key}\` stopped at #${pr.number}; dependent source PRs ` +
      `${dependents.map((member) => `#${member.number}`).join(", ")} were deferred.`,
    );
  }
  return messages;
}

export function validateGroupChronology(group) {
  if (!group.key) return { ok: true };
  let previous = -Infinity;
  for (const pr of group.prs) {
    const mergedAt = Date.parse(pr.mergedAt || "");
    if (!Number.isFinite(mergedAt)) {
      return { ok: false, error: `source PR #${pr.number} has no valid merge timestamp` };
    }
    if (mergedAt <= previous) {
      return {
        ok: false,
        error:
          `source PR #${pr.number} does not have a strictly later merge timestamp than ` +
          "the preceding stack member, so dependency order is ambiguous",
      };
    }
    previous = mergedAt;
  }
  return { ok: true };
}

export function processGroupsIndependently(groups, processGroup, onFailure) {
  for (const group of groups) {
    try {
      processGroup(group);
    } catch (error) {
      onFailure(group, error);
    }
  }
}

export function externalStackPromotionState(group, promotionPrs, promoBySource) {
  if (!group.key) return { closed: null, closeds: [], open: null, opens: [] };
  const currentSourceNumbers = new Set(group.prs.map((member) => member.number));
  const records = promotionPrs.filter((promotion) => {
    const sourceNumber = promotionSourceNumber(promotion);
    return Number.isFinite(sourceNumber) &&
      !currentSourceNumbers.has(sourceNumber) &&
      parsePromotionGroupMarker(promotion.body) === group.key &&
      promoBySource.get(sourceNumber)?.number === promotion.number;
  });
  const closeds = records
    .filter((promotion) => promotion.state === "CLOSED")
    .sort((a, b) => a.number - b.number);
  const opens = records
    .filter((promotion) => promotion.state === "OPEN")
    .sort((a, b) => a.number - b.number);
  return {
    closed: closeds.at(-1) || null,
    closeds,
    open: opens.at(-1) || null,
    opens,
  };
}

// Returns { status: "ok" | "conflict" | "error", detail? } and leaves the
// worktree clean (picks applied on success, fully aborted otherwise).
function applyPicks(worktree, picks, gitRunner = tryGit) {
  for (const pick of picks) {
    const args = ["cherry-pick", "-x"];
    if (pick.mainline) args.push("-m", "1");
    args.push(pick.range || pick.sha);
    let res = gitRunner(args, worktree);
    // Empty picks (content already on main) stop the sequencer; skip through
    // them until the pick finishes or a real conflict appears. Never infer
    // emptiness from stderr text: operational failures such as "empty ident
    // name" can leave the intended source patch staged and must be surfaced.
    let guard = 0;
    while (!res.ok && guard++ < 100) {
      const unmerged = gitRunner(["diff", "--name-only", "--diff-filter=U"], worktree);
      if (!unmerged.ok) {
        gitRunner(["cherry-pick", "--abort"], worktree);
        return {
          status: "error",
          detail: `cannot inspect failed cherry-pick state: ${failureDetail(unmerged)}`,
        };
      }
      if (unmerged.out) {
        gitRunner(["cherry-pick", "--abort"], worktree);
        return { status: "conflict", detail: unmerged.out.split("\n").slice(0, 20).join(", ") };
      }

      const cherryPickHead = gitRunner(
        ["rev-parse", "--verify", "-q", "CHERRY_PICK_HEAD"],
        worktree,
      );
      const staged = gitRunner(["diff", "--cached", "--quiet", "HEAD", "--"], worktree);
      const tracked = gitRunner(["diff", "--quiet", "--"], worktree);
      const genuinelyEmpty =
        cherryPickHead.ok && staged.status === 0 && tracked.status === 0;
      if (genuinelyEmpty) {
        res = gitRunner(["cherry-pick", "--skip"], worktree);
        if (res.ok) break;
        continue;
      }
      gitRunner(["cherry-pick", "--abort"], worktree);
      return { status: "error", detail: (res.err || res.out).slice(0, 500) };
    }
    if (!res.ok) {
      gitRunner(["cherry-pick", "--abort"], worktree);
      return { status: "error", detail: (res.err || res.out).slice(0, 500) };
    }
  }
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Promotion PR creation
// ---------------------------------------------------------------------------

let labelEnsured = false;
function ensurePromotionLabel() {
  if (labelEnsured || !CFG.promotionLabel) return labelEnsured;
  const res = tryGh(["label", "create", CFG.promotionLabel, ...repoFlag(),
    "--color", "5319e7", "--force",
    "--description", "Automated develop → main promotion PR"]);
  labelEnsured = res.ok;
  return labelEnsured;
}

function promotionBody(pr, groupKey, position, groupPrs, statusFor) {
  const lines = [];
  lines.push(
    `Automated promotion of #${pr.number} from \`${CFG.source}\` to \`${CFG.target}\`, ` +
    `opened by the **Promote features to main** workflow for release review.`,
    "",
    `<!-- promotion-of: ${pr.number} -->`,
  );
  if (groupKey) lines.push(`<!-- promotion-group: ${groupKey} -->`);
  lines.push(
    "",
    "## Source",
    "| | |",
    "| --- | --- |",
    `| Source PR | #${pr.number} — ${pr.title} |`,
    `| Author | @${pr.author?.login || "unknown"} |`,
    `| Merged into \`${CFG.source}\` | ${pr.mergedAt || "unknown"} |`,
    `| Merge commit | \`${pr.mergeCommit?.oid || "unknown"}\` |`,
    `| Head branch | \`${pr.headRefName}\` |`,
  );
  if (groupKey && groupPrs.length > 1) {
    lines.push(
      "",
      `## Stack — \`${groupKey}\` (position ${position} of ${groupPrs.length} known)`,
      "",
      "Review and merge bottom-up. Delete each promotion branch when its PR",
      "merges so GitHub retargets the next PR automatically (the scheduled",
      "workflow run also retargets stacks as a backstop).",
      "",
      "| # | Source PR | Promotion |",
      "| --- | --- | --- |",
    );
    groupPrs.forEach((member, idx) => {
      const status = member.number === pr.number ? "_this PR_" : statusFor(member);
      lines.push(`| ${idx + 1} | #${member.number} ${member.title} | ${status} |`);
    });
  }
  lines.push(
    "",
    "## How to review",
    "",
    `- This PR re-applies the source PR's exact changes onto \`${CFG.target}\``,
    "  (`git cherry-pick -x`; each commit message references the original SHA).",
    `- Merge it normally to release the change to \`${CFG.target}\` —`,
    "  the **Sync main into develop** workflow keeps `develop` aligned afterwards.",
    `- Close it (without merging) to keep the change out of \`${CFG.target}\`;`,
    "  the workflow never recreates a closed promotion (reopen it to change your mind).",
    `- Prefer shipping everything at once? Merge the standing omnibus`,
    `  **Promote develop to main** PR instead — this PR's diff then becomes`,
    "  empty and the workflow closes it automatically.",
    "",
    "---",
    "🤖 Generated by the `promote-features-to-main` workflow.",
  );
  return lines.join("\n");
}

function createPromotionPr({ branch, base, title, body }) {
  const bodyFile = join(os.tmpdir(), `promotion-body-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(bodyFile, body);
  try {
    const args = ["pr", "create", ...repoFlag(),
      "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile];
    if (ensurePromotionLabel()) args.push("--label", CFG.promotionLabel);
    return { ok: true, url: gh(args).split("\n").pop() };
  } catch (error) {
    return { ok: false, err: String(error.stderr || error.message || error).slice(0, 500) };
  } finally {
    rmSync(bodyFile, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function summarize(results, eligibleCount, scanCompleted = true) {
  const md = [];
  md.push(`## Promote ${CFG.source} → ${CFG.target}${CFG.dryRun ? " (dry run)" : ""}`, "");
  if (scanCompleted) {
    md.push(`Scanned the last ${CFG.lookback} PRs merged into \`${CFG.source}\`; ${eligibleCount} eligible for promotion this run.`, "");
  } else {
    md.push(`The source-PR scan did not complete; the partial results below cover only work reached before the failure.`, "");
  }
  const section = (title, items) => {
    if (!items.length) return;
    md.push(`### ${title}`, "", ...items.map((item) => `- ${item}`), "");
  };
  section("Created", results.created);
  section("Recovered or verified rewritten history", results.recovered);
  section("Retargeted", results.retargeted);
  section("Closed as redundant", results.closed);
  section("Conflicts (manual promotion needed)", results.conflicts);
  section("Blocked", results.blocked);
  section("Warnings", results.warnings);
  section("Skipped", results.skipped);
  if (!results.created.length && !results.conflicts.length && !results.blocked.length) {
    md.push("Nothing new to promote. ✅", "");
  }
  const text = md.join("\n");
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function conflictHelp(pr, branch, base) {
  return [
    `#${pr.number} (**${pr.title}**) does not cherry-pick cleanly onto \`${base}\`. Promote it manually:`,
    "  ```",
    `  git fetch origin ${CFG.target} ${CFG.source}`,
    `  git switch -c ${branch} ${base === CFG.target ? `origin/${CFG.target}` : `origin/${base}`}`,
    `  git cherry-pick -x -m 1 ${pr.mergeCommit?.oid || "<merge-commit>"}`,
    "  # resolve conflicts, git cherry-pick --continue",
    `  git push -u origin ${branch}`,
    "  ```",
    `  The next workflow run will open the promotion PR for \`${branch}\` automatically.`,
  ].join("\n");
}

async function runPromotion(results, state) {
  const skip = (pr, reason) => results.skipped.push(`#${pr.number} ${pr.title} — ${reason}`);

  // --- Preflight -----------------------------------------------------------
  run("gh", ["auth", "status"]);
  if (!CFG.repo) {
    CFG.repo = ghJson(["repo", "view", "--json", "nameWithOwner"])?.nameWithOwner || "";
  }
  const fetched = tryGit(["fetch", "origin", CFG.target, CFG.source]);
  if (!fetched.ok) {
    if (new RegExp(`couldn't find remote ref ${CFG.source}`, "i").test(fetched.err)) {
      console.log(`::notice::No ${CFG.source} branch — nothing to promote.`);
      state.scanCompleted = true;
      return;
    }
    throw new Error(`git fetch failed: ${fetched.err}`);
  }
  const mainSha = git(["rev-parse", `origin/${CFG.target}`]);
  const sourceSha = git(["rev-parse", `origin/${CFG.source}`]);

  // --- Load state ----------------------------------------------------------
  const sourcePrs = listMergedSourcePrs();
  const promotionPrs = listPromotionPrs();
  const promoBySource = indexPromotionsBySource(promotionPrs);
  const remoteBranches = listRemotePromotionBranches();

  // --- Filter candidates ---------------------------------------------------
  const eligible = [];
  for (const pr of sourcePrs) {
    const labels = (pr.labels || []).map((l) => (l.name || "").toLowerCase());
    if (pr.headRefName === CFG.target) continue; // sync main→develop PRs
    if (pr.headRefName?.startsWith("promote/")) continue;
    if (parsePromotionOf(pr.body) !== null) continue; // is itself a promotion
    if (labels.some((name) => CFG.skipLabels.includes(name))) {
      skip(pr, `skip label`);
      continue;
    }
    if (CFG.requireLabel && !labels.includes(CFG.requireLabel.toLowerCase())) {
      skip(pr, `missing required label \`${CFG.requireLabel}\``);
      continue;
    }
    if (!pr.mergeCommit?.oid) {
      skip(pr, "merge commit unknown");
      continue;
    }
    eligible.push(pr);
  }
  state.eligibleCount = eligible.length;
  state.scanCompleted = true;

  // Hydrate and inspect every eligible historical merge before any GitHub-side
  // mutation, including PRs with an existing promotion record/branch. A stale
  // orphan branch must never resurrect a feature later removed from develop,
  // and an already-shipped source merge must win over an obsolete CLOSED
  // promotion record.
  const plans = preflightPromotionPlans(eligible, mainSha, { sourceSha });
  for (const pr of eligible) {
    const plan = plans.get(pr.number);
    if (plan?.sourceRewritten) {
      results.recovered.push(
        `#${pr.number} — historical merge \`${pr.mergeCommit.oid}\` has its planned patch ` +
        `verified at current \`${CFG.source}\` tip` +
        `${plan.aggregateVerified
          ? " as an aggregate rewritten range"
          : ` via patch-equivalent commit \`${plan.sourceEquivalent}\``}` +
        `${plan.recovered ? " after an exact-SHA fetch" : ""}.`,
      );
    } else if (plan?.recovered) {
      results.recovered.push(
        `#${pr.number} — fetched historical merge commit \`${pr.mergeCommit.oid}\` by exact SHA.`,
      );
    }
  }
  const sourcePrByNumber = new Map(sourcePrs.map((pr) => [pr.number, pr]));
  const promotionByHead = new Map(promotionPrs.map((promotion) => [promotion.headRefName, promotion]));
  const externalSources = new Map();
  const externalPlans = new Map();
  const loadExternalPromotionSource = (promotion) => {
    const sourceNumber = promotionSourceNumber(promotion);
    if (!Number.isFinite(sourceNumber)) {
      return { error: `promotion #${promotion.number} has no valid source PR marker` };
    }
    if (externalSources.has(sourceNumber)) return externalSources.get(sourceNumber);
    let sourcePr = sourcePrByNumber.get(sourceNumber);
    try {
      sourcePr ||= loadSourcePr(sourceNumber);
    } catch (error) {
      const failed = {
        error: `cannot load source PR #${sourceNumber} for external stack validation: ` +
          failureDetail({ err: String(error?.message || error) }),
      };
      externalSources.set(sourceNumber, failed);
      return failed;
    }
    if (!sourcePr?.mergeCommit?.oid || sourcePr.state === "OPEN") {
      const failed = { error: `source PR #${sourceNumber} is not a readable merged PR` };
      externalSources.set(sourceNumber, failed);
      return failed;
    }
    sourcePrByNumber.set(sourceNumber, sourcePr);
    const loaded = { sourcePr };
    externalSources.set(sourceNumber, loaded);
    return loaded;
  };
  const loadExternalPromotionPlan = (promotion) => {
    const sourceNumber = promotionSourceNumber(promotion);
    if (!Number.isFinite(sourceNumber)) {
      return { error: `promotion #${promotion.number} has no valid source PR marker` };
    }
    if (externalPlans.has(sourceNumber)) return externalPlans.get(sourceNumber);
    const source = loadExternalPromotionSource(promotion);
    if (source.error) {
      externalPlans.set(sourceNumber, source);
      return source;
    }
    const { sourcePr } = source;
    const plan = preflightPromotionPlans([sourcePr], mainSha, { sourceSha }).get(sourceNumber);
    const loaded = { sourcePr, plan: plan || { error: "promotion plan missing" } };
    externalPlans.set(sourceNumber, loaded);
    return loaded;
  };
  const validateExternalOpenChain = (tail, currentStart) => {
    const chain = [];
    const seen = new Set();
    let cursor = tail;
    while (cursor) {
      if (seen.has(cursor.headRefName) || chain.length >= 50) {
        return { ok: false, error: "external promotion base chain is cyclic or exceeds 50 hops" };
      }
      seen.add(cursor.headRefName);
      if (cursor.state !== "OPEN") {
        return {
          ok: false,
          error: `external promotion #${cursor.number} is ${cursor.state.toLowerCase()}, not open`,
        };
      }
      chain.unshift(cursor);
      if (cursor.baseRefName === CFG.target) break;
      if (!cursor.baseRefName?.startsWith("promote/")) {
        return {
          ok: false,
          error: `external promotion #${cursor.number} has unexpected base \`${cursor.baseRefName}\``,
        };
      }
      const predecessor = promotionByHead.get(cursor.baseRefName);
      if (!predecessor) {
        return {
          ok: false,
          error: `external promotion #${cursor.number} references unknown base \`${cursor.baseRefName}\``,
        };
      }
      cursor = predecessor;
    }

    let expectedBaseName = CFG.target;
    let expectedBaseRef = mainSha;
    let previousMergedAt = -Infinity;
    for (const promotion of chain) {
      if (promotion.baseRefName !== expectedBaseName) {
        return {
          ok: false,
          error:
            `external promotion #${promotion.number} targets \`${promotion.baseRefName}\`, ` +
            `but validated topology requires \`${expectedBaseName}\``,
        };
      }
      const loaded = loadExternalPromotionPlan(promotion);
      if (loaded.error || loaded.plan?.error) {
        return {
          ok: false,
          error: loaded.error || loaded.plan.error,
        };
      }
      const mergedAt = Date.parse(loaded.sourcePr?.mergedAt || "");
      if (!Number.isFinite(mergedAt) || mergedAt >= currentStart || mergedAt <= previousMergedAt) {
        return {
          ok: false,
          error:
            `external promotion #${promotion.number} does not form a strictly ordered ` +
            "predecessor chain before the current source group",
        };
      }
      if (loaded.plan.inTarget) {
        return {
          ok: false,
          error:
            `external promotion #${promotion.number} is already represented on \`${CFG.target}\`; ` +
            "its stale open topology must be closed/retargeted before stacking",
        };
      }
      const available = ensureRemoteBranchAvailable(promotion.headRefName);
      if (!available.ok) return available;
      const reusable = validateReusablePromotionBranch(
        available.ref,
        expectedBaseRef,
        loaded.sourcePr,
        process.cwd(),
        loaded.plan,
      );
      if (!reusable.ok) {
        return {
          ok: false,
          error: `external promotion #${promotion.number} is unsafe to reuse: ${reusable.error}`,
        };
      }
      expectedBaseName = promotion.headRefName;
      expectedBaseRef = available.ref;
      previousMergedAt = mergedAt;
    }
    return { ok: true, baseName: expectedBaseName, baseRef: expectedBaseRef };
  };

  retargetPass(promotionPrs, results);
  closeRedundantPass(promotionPrs, results);

  // --- Group ---------------------------------------------------------------
  const groups = new Map(); // key → { key, prs } ; standalone key = "pr-<n>"
  for (const pr of eligible) {
    const key = groupKeyFor(pr, CFG);
    const mapKey = key || `pr-${pr.number}`;
    if (!groups.has(mapKey)) groups.set(mapKey, { key, prs: [] });
    groups.get(mapKey).prs.push(pr); // eligible is already mergedAt-ascending
  }

  // --- Process each group as one cherry-pick chain -------------------------
  const worktreeRoot = mkdtempSync(join(process.env.RUNNER_TEMP || os.tmpdir(), "promote-"));
  const worktree = join(worktreeRoot, "wt");
  let createdCount = 0;
  const unexpectedGroupErrors = [];

  const statusFor = (member) => {
    const rec = promoBySource.get(member.number);
    if (rec) return `#${rec.number} (${rec.state.toLowerCase()})`;
    return "_pending_";
  };

  try {
    git(["worktree", "add", "--detach", worktree, mainSha]);
    processGroupsIndependently(groups.values(), (group) => {
      let baseName = CFG.target;
      let baseRef = mainSha;
      const chronology = validateGroupChronology(group);
      if (!chronology.ok) {
        results.blocked.push(`Stack \`${group.key}\` cannot be ordered safely: ${chronology.error}.`);
        return;
      }

      // Older stack members can fall outside the lookback window; chain onto
      // the newest open promotion PR of the same group if one exists.
      if (group.key) {
        const externalState = externalStackPromotionState(group, promotionPrs, promoBySource);
        const currentStart = Date.parse(group.prs[0]?.mergedAt || "");
        if (!Number.isFinite(currentStart)) {
          results.blocked.push(
            `Stack \`${group.key}\` cannot order external predecessors because source PR ` +
            `#${group.prs[0]?.number || "unknown"} has no valid merge timestamp.`,
          );
          return;
        }
        const classifyPredecessors = (promotions) => {
          const predecessors = [];
          for (const promotion of promotions) {
            const loaded = loadExternalPromotionSource(promotion);
            const sourceNumber = promotionSourceNumber(promotion) ?? "unknown";
            if (loaded.error) {
              return {
                error:
                  `cannot validate external promotion #${promotion.number} for source PR ` +
                  `#${sourceNumber}: ${loaded.error}`,
              };
            }
            const mergedAt = Date.parse(loaded.sourcePr?.mergedAt || "");
            if (!Number.isFinite(mergedAt)) {
              return {
                error:
                  `source PR #${sourceNumber} for external promotion #${promotion.number} ` +
                  "has no valid merge timestamp",
              };
            }
            if (mergedAt === currentStart) {
              return {
                error:
                  `source PR #${sourceNumber} and current source PR #${group.prs[0].number} ` +
                  "have the same merge timestamp, so predecessor order is ambiguous",
              };
            }
            if (mergedAt < currentStart) predecessors.push({ promotion, mergedAt });
          }
          predecessors.sort((a, b) => a.mergedAt - b.mergedAt);
          return { predecessors };
        };
        const classifiedCloseds = classifyPredecessors(externalState.closeds);
        if (classifiedCloseds.error) {
          results.blocked.push(`Stack \`${group.key}\` ${classifiedCloseds.error}.`);
          return;
        }
        for (const { promotion: closedExternal } of classifiedCloseds.predecessors) {
          const sourceNumber = promotionSourceNumber(closedExternal) ?? "unknown";
          const loaded = loadExternalPromotionPlan(closedExternal);
          if (loaded.error || loaded.plan?.error) {
            results.blocked.push(
              `Stack \`${group.key}\` cannot validate closed predecessor #${closedExternal.number}: ` +
              `${loaded.error || loaded.plan.error}`,
            );
            return;
          }
          if (!loaded.plan.inTarget) {
            results.blocked.push(
              `Stack \`${group.key}\` cannot continue because earlier source PR #${sourceNumber} ` +
              `has closed promotion #${closedExternal.number}; current source PRs ` +
              `${group.prs.map((member) => `#${member.number}`).join(", ")} were deferred.`,
            );
            return;
          }
        }
        const classifiedOpens = classifyPredecessors(externalState.opens);
        if (classifiedOpens.error) {
          results.blocked.push(`Stack \`${group.key}\` ${classifiedOpens.error}.`);
          return;
        }
        const predecessorOpens = classifiedOpens.predecessors.map(({ promotion }) => promotion);
        const openHeads = new Set(predecessorOpens.map((promotion) => promotion.headRefName));
        const externalTails = predecessorOpens.filter(
          (candidate) => !predecessorOpens.some(
            (other) => other.baseRefName === candidate.headRefName && openHeads.has(other.headRefName),
          ),
        );
        if (externalTails.length > 1) {
          results.blocked.push(
            `Stack \`${group.key}\` has ${externalTails.length} parallel external promotion tails; ` +
            "refusing to guess which history should own new dependents.",
          );
          return;
        }
        if (externalTails.length === 1) {
          const validated = validateExternalOpenChain(externalTails[0], currentStart);
          if (!validated.ok) {
            results.blocked.push(`Stack \`${group.key}\` external chain is unsafe: ${validated.error}`);
            return;
          }
          baseName = validated.baseName;
          baseRef = validated.baseRef;
        }
      }

      git(["checkout", "--detach", baseRef], worktree);

      for (const [index, pr] of group.prs.entries()) {
        const position = index + 1;
        const plan = plans.get(pr.number) || { error: "promotion plan missing" };

        // Content already on main (individually promoted and back-merged, or
        // shipped via an omnibus develop → main merge) beats every promotion
        // record — it is simply done.
        if (plan.inTarget) {
          skip(pr, `merge commit already on ${CFG.target}`);
          continue;
        }

        const record = promoBySource.get(pr.number);
        if (record?.state === "MERGED") {
          skip(pr, `already promoted and merged (#${record.number})`);
          continue;
        }
        if (plan.error) {
          results.blocked.push(...groupFailureMessages(group, index, plan.error));
          break;
        }
        if (record?.state === "OPEN") {
          if (record.baseRefName !== baseName) {
            results.blocked.push(...groupFailureMessages(
              group,
              index,
              `promotion #${record.number} targets \`${record.baseRefName}\`, but this stack ` +
                `requires base \`${baseName}\``,
            ));
            break;
          }
          const expectedBaseRef = git(["rev-parse", "HEAD"], worktree);
          const checked = checkoutRemoteBranch(worktree, record.headRefName);
          if (!checked.ok) {
            results.blocked.push(...groupFailureMessages(group, index, checked.error));
            break;
          }
          const reusable = validateReusablePromotionBranch(
            "HEAD", expectedBaseRef, pr, worktree, plan,
          );
          if (!reusable.ok) {
            results.blocked.push(...groupFailureMessages(group, index, reusable.error));
            break;
          }
          skip(pr, `promotion #${record.number} already open`);
          baseName = record.headRefName;
          continue;
        }
        if (record?.state === "CLOSED") {
          skip(pr, `promotion #${record.number} was closed without merging — not recreating (reopen it to promote)`);
          const dependents = dependentMembersAfter(group, index);
          if (dependents.length > 0) {
            results.blocked.push(
              `Stack \`${group.key}\` cannot continue past #${pr.number} because its promotion ` +
              `#${record.number} was closed; dependent source PRs ` +
              `${dependents.map((member) => `#${member.number}`).join(", ")} were deferred.`,
            );
            break;
          }
          continue;
        }

        const branch = promotionBranchFor(pr);
        const existingBranch = [...remoteBranches].find((name) =>
          name.startsWith(`promote/pr-${pr.number}-`));
        if (existingBranch) {
          // Branch pushed earlier (or manually after a conflict) but PR missing.
          if (createdCount >= CFG.maxNewPrs) {
            results.warnings.push(
              `MAX_NEW_PRS=${CFG.maxNewPrs} reached — #${pr.number}${group.key ? ` (and the rest of \`${group.key}\`)` : ""} deferred to the next run.`,
            );
            break;
          }
          const expectedBaseRef = git(["rev-parse", "HEAD"], worktree);
          const checked = checkoutRemoteBranch(worktree, existingBranch);
          if (!checked.ok) {
            results.blocked.push(...groupFailureMessages(group, index, checked.error));
            break;
          }
          const reusable = validateReusablePromotionBranch(
            "HEAD", expectedBaseRef, pr, worktree, plan,
          );
          if (!reusable.ok) {
            results.blocked.push(...groupFailureMessages(group, index, reusable.error));
            break;
          }
          if (CFG.dryRun) {
            results.created.push(`(dry-run) would open PR for existing branch \`${existingBranch}\` → \`${baseName}\``);
            createdCount += 1;
          } else {
            const title = promotionTitleFor(pr, group.key, position);
            const body = promotionBody(pr, group.key, position, group.prs, statusFor);
            const created = createPromotionPr({ branch: existingBranch, base: baseName, title, body });
            if (created.ok) {
              results.created.push(`${created.url} — ${title} (from existing branch)`);
              createdCount += 1;
            } else {
              results.blocked.push(...groupFailureMessages(
                group,
                index,
                `PR creation for existing \`${existingBranch}\` failed: ${created.err}`,
              ));
              break;
            }
          }
          baseName = existingBranch;
          continue;
        }

        if (plan.warning) results.warnings.push(plan.warning);

        if (createdCount >= CFG.maxNewPrs) {
          results.warnings.push(
            `MAX_NEW_PRS=${CFG.maxNewPrs} reached — #${pr.number}${group.key ? ` (and the rest of \`${group.key}\`)` : ""} deferred to the next run.`,
          );
          break;
        }

        const beforeSha = git(["rev-parse", "HEAD"], worktree);
        const applied = applyPicks(worktree, plan.picks);
        if (applied.status === "conflict") {
          results.conflicts.push(conflictHelp(pr, branch, baseName));
          break; // later group members depend on this one
        }
        if (applied.status === "error") {
          results.blocked.push(`#${pr.number}: cherry-pick failed: ${applied.detail}`);
          break;
        }
        const ahead = Number(git(["rev-list", "--count", `${beforeSha}..HEAD`], worktree) || "0");
        if (ahead === 0) {
          skip(pr, `no-op — content already on \`${baseName}\``);
          continue;
        }

        if (CFG.dryRun) {
          results.created.push(`(dry-run) would create \`${branch}\` → \`${baseName}\` (${ahead} commit${ahead === 1 ? "" : "s"}) for #${pr.number} ${pr.title}`);
          baseName = branch;
          createdCount += 1;
          continue;
        }

        const pushed = tryGit(["push", "origin", `HEAD:refs/heads/${branch}`], worktree);
        if (!pushed.ok) {
          results.blocked.push(
            `#${pr.number}: push of \`${branch}\` was refused (${pushed.err.split("\n")[0]}). ` +
            "If the change touches `.github/workflows/`, GITHUB_TOKEN cannot push it — set the `PROMOTION_PAT` secret.",
          );
          break;
        }
        const title = promotionTitleFor(pr, group.key, position);
        const body = promotionBody(pr, group.key, position, group.prs, statusFor);
        const created = createPromotionPr({ branch, base: baseName, title, body });
        if (!created.ok) {
          results.blocked.push(`#${pr.number}: pushed \`${branch}\` but PR creation failed: ${created.err} — the next run will open it.`);
          break;
        }
        results.created.push(`${created.url} — ${title}`);
        createdCount += 1;
        baseName = branch;
        remoteBranches.add(branch);
        if (CFG.commentOnSource) {
          tryGh(["pr", "comment", String(pr.number), ...repoFlag(),
            "--body", `🚀 Promotion PR for \`${CFG.target}\` opened: ${created.url}`]);
        }
      }
    }, (group, error) => {
      tryGit(["cherry-pick", "--abort"], worktree);
      tryGit(["reset", "--hard", "HEAD"], worktree);
      const identity = group.key
        ? `Stack \`${group.key}\` (${group.prs.map((pr) => `#${pr.number}`).join(", ")})`
        : `Source PR #${group.prs[0]?.number || "unknown"}`;
      results.blocked.push(
        `${identity} hit an unexpected group-local failure: ` +
        `${failureDetail({ err: String(error?.message || error) })}. ` +
        "Later independent groups continued.",
      );
      unexpectedGroupErrors.push({ identity, error });
    });
  } finally {
    tryGit(["worktree", "remove", "--force", worktree]);
    tryGit(["worktree", "prune"]);
    rmSync(worktreeRoot, { recursive: true, force: true });
  }
  if (unexpectedGroupErrors.length > 0) {
    const error = new Error(
      `${unexpectedGroupErrors.length} promotion group(s) hit unexpected failures after ` +
      "the remaining independent groups were processed",
    );
    error.afterIndependentGroups = true;
    throw error;
  }
}

export async function runWithSummary(operation, results, state, summarizer = summarize) {
  let fatalError = null;
  try {
    await operation();
  } catch (error) {
    fatalError = error;
    results.blocked.push(
      `${error?.afterIndependentGroups
        ? "Workflow completed the remaining independent groups, then failed because"
        : "Workflow-level failure stopped further scanning:"} ` +
      failureDetail({ err: String(error?.message || error) }),
    );
  } finally {
    try {
      summarizer(results, state.eligibleCount, state.scanCompleted);
    } catch (summaryError) {
      console.error(`::error::Could not publish promotion summary: ${String(summaryError?.message || summaryError)}`);
      fatalError ||= summaryError;
    }
  }
  if (fatalError) throw fatalError;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

  const results = {
    created: [], recovered: [], retargeted: [], closed: [], conflicts: [],
    blocked: [], warnings: [], skipped: [],
  };
  const state = { eligibleCount: 0, scanCompleted: false };
  await runWithSummary(() => runPromotion(results, state), results, state);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`::error::${String(error?.stack || error)}`);
    process.exitCode = 1;
  });
}
