#!/usr/bin/env node
// Promote develop → main as reviewable per-feature PRs (with stacks).
//
// Scans PRs merged into SOURCE_BRANCH (develop), and for each one that has not
// yet reached TARGET_BRANCH (main) re-applies its exact diff on a dedicated
// `promote/pr-<n>-<slug>` branch, then opens a promotion PR targeting main.
// Every clean plan, including `.github/**`, uses the direct `git cherry-pick -x`
// path. A conflict is dispatched to Lopu's trusted worker, which reconstructs
// and verifies the exact result before publishing it directly. Historical
// lineage remains context for Lopu's repository-direction assessment, not a
// publication diversion. PRs that belong to the same feature
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
//   - cherry-pick conflict → reserve the canonical promotion branch at its
//     exact base and hand the immutable source plan to Lopu; later members of
//     only that dependency group wait for the resolved branch.
//   - malformed patches and operational inspection failures remain explicit
//     errors; Lopu assesses known historical-lineage states in context.
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
import { createHash } from "node:crypto";
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
  // With uniform lane naming every branch carries --to-<target>; this now
  // exists only to (a) claim legacy pre-uniform branches for the main lane
  // and (b) restore CFG.target after a multi-target pass loop.
  primaryTarget: env("PRIMARY_TARGET_BRANCH", "main"),
  // Multi-target promotion. One merged source PR can legitimately owe changes
  // to more than one branch: #211 converts `main` to thin listeners AND carries
  // the executable implementation those listeners call, which may only live on
  // `github-actions`. A single-target promoter can never express that — the
  // half that does not belong on `main` just conflicts, and the promotion dies.
  // Each configured target gets its own full pass (own branch, own promotion
  // PR, own record), so one source yields as many promotion PRs as it owes.
  // A pass whose cherry-pick does not apply cleanly onto its base is exactly
  // the case the trusted AI worker already handles: it reconstructs the change
  // to fit that base and opens the PR. Nothing here decides WHAT belongs where
  // — the per-base replay and the worker do — which is why no path-routing
  // table exists: the same file legitimately contributes different content to
  // different bases.
  targets: env("TARGET_BRANCHES", "")
    .split(",").map((s) => s.trim()).filter(Boolean),
  lookback: Math.max(1, Math.min(100, Number(env("LOOKBACK", "50")) || 50)),
  maxNewPrs: Math.max(1, Number(env("MAX_NEW_PRS", "10")) || 10),
  requireLabel: env("REQUIRE_LABEL", ""),
  // Lane path guard (reverse lane): when set, only PRs whose ENTIRE planned
  // patch stays under these prefixes promote on this run. Keeps app-wide
  // sources (a merged develop→main promotion, say) out of a CI-scoped
  // main→github-actions lane. Skips are summary lines, not PR comments —
  // being outside a lane is scoping, not a failure.
  requirePathPrefixes: env("REQUIRE_PATH_PREFIXES", "")
    .split(",").map((s) => s.trim()).filter(Boolean),
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
const tryGit = (args, cwd, opts = {}) => tryRun(
  "git",
  args,
  { ...(cwd ? { cwd } : {}), ...opts },
);
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
  const changed = gitRunner([
    "-c", "core.quotePath=false", "diff", "--name-only", "-z",
    endpoints.start, endpoints.end,
  ], cwd, { preserveOutput: true });
  if (!changed.ok) {
    return {
      ok: false,
      error: `cannot list the planned promotion patch: ${failureDetail(changed)}`,
    };
  }
  const paths = changed.out.split("\0").filter(Boolean);
  if (paths.some((path) => !validPromotionPath(path))) {
    return {
      ok: false,
      error: "planned promotion patch contains a control-character path",
    };
  }
  const meaningfulPaths = paths.filter(
    (path) => !path.startsWith("graphify-out/") && path !== "remix/CHANGELOG.md",
  );
  const selectedPaths = meaningfulPaths.length > 0 ? meaningfulPaths : paths;
  const diffArgs = ["diff", "--binary", "--full-index", endpoints.start, endpoints.end];
  if (selectedPaths.length > 0 && selectedPaths.length <= 200) {
    diffArgs.push("--", ...selectedPaths.map(literalPathspec));
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
// applicable. Ambiguous/overlapping evolution is classified explicitly so the
// promoter can stop visibly without reconstructing code whose current source
// intent cannot be proven.
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
    for (const [direction, result] of [["forward", forward], ["reverse", reverse]]) {
      if (result.status !== 0 && result.status !== 1) {
        return {
          ok: false,
          error:
            `cannot determine current source patch state: ${direction} apply check failed ` +
            `operationally (${failureDetail(result)})`,
        };
      }
    }
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
// current-tip reverse-application is required after rewrites. A recoverable
// but removed/ambiguous patch is never called verified. It is a hard safety
// stop: no reservation, branch, AI worker, or promotion PR may be created.
// Operational and patch-authority failures use the same fail-closed boundary.
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
    return {
      ok: false,
      error:
        `source-lineage safety block: the exact historical patch is not present at current ` +
        `\`${CFG.source}\` tip; it may have been intentionally removed or reverted, so the ` +
        "Lopu will create a reviewable candidate instead of labelling the patch verified",
      sourceLineageStatus: "review-required-removed",
    };
  }
  if (presentAtTip.present === null) {
    return {
      ok: false,
      error:
        `source-lineage safety block: the exact historical patch cannot be proven present at ` +
        `current \`${CFG.source}\` tip because later edits overlap its effect, so the ` +
        "Lopu will create a reviewable candidate instead of labelling the patch verified",
      sourceLineageStatus: "review-required-ambiguous",
    };
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
      sourceLineageStatus: "verified",
      sourceLineageReviewRequired: false,
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
        sourceLineageStatus: "verified",
        sourceLineageReviewRequired: false,
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
    sourceLineageStatus: "verified",
    sourceLineageReviewRequired: false,
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

function promotionBranchSlug(pr) {
  const segments = (pr.headRefName || "").split("/").filter(Boolean);
  while (segments.length > 1 && STRIP_PREFIXES.includes(segments[0].toLowerCase())) {
    segments.shift();
  }
  return slugify(segments.join("-") || pr.title || `pr-${pr.number}`);
}

// Uniform lane naming (owner request, 2026-08-12): EVERY promotion branch
// names its target — promote/pr-N-<slug>--to-<target> — with no privileged
// unsuffixed namespace. `--to-` (double dash) is deliberate: slugify collapses
// separator runs, so a slugified head ref can never contain it, and a branch
// literally named `foo-to-github-actions` cannot forge a lane marker.
export function promotionBranchFor(pr, target = CFG.target) {
  return `promote/pr-${pr.number}-${promotionBranchSlug(pr)}--to-${slugify(target)}`;
}

// Pre-uniform history: branches created before uniform naming carry no --to-
// marker and are main-lane artifacts. They stay recognized forever — renaming
// live promotion branches would orphan every open promotion PR.
export function legacyPromotionBranchFor(pr) {
  return `promote/pr-${pr.number}-${promotionBranchSlug(pr)}`;
}

export function promotionBranchMatches(sourcePr, head, target = CFG.target) {
  if (head === promotionBranchFor(sourcePr, target)) return true;
  return target === (CFG.primaryTarget || "main")
    && head === legacyPromotionBranchFor(sourcePr);
}

// Whether a promotion PR belongs to the pass currently running. The primary
// pass owns every promotion without a target suffix (including all history
// from before multi-target existed); an additional target owns exactly the
// branches suffixed for it.
export function promotionBelongsToPass(promotion, cfg = CFG) {
  const head = String(promotion?.headRefName || "");
  if (head.endsWith(`--to-${slugify(cfg.target)}`)) return true;
  // Legacy pre-uniform branches carry no --to- marker and are main-lane
  // history. The marker is double-dash, which slugify never emits, so a
  // source branch that merely reads like "-to-x" cannot false-positive.
  return cfg.target === (cfg.primaryTarget || "main") && !/--to-[a-z0-9-]+$/.test(head);
}

// The configured promotion targets, in order, always beginning with the
// primary one. Unsafe, duplicate, and self-targeting entries are dropped rather
// than allowed to aim a promotion at the branch it came from.
export function promotionTargets(cfg = CFG) {
  const seen = new Set();
  const targets = [];
  for (const candidate of [cfg.target, ...(cfg.targets || [])]) {
    const name = String(candidate || "").trim();
    if (!name || name === cfg.source) continue;
    if (name.startsWith("-") || name.includes("..") || /[\s~^:?*[\\]/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    targets.push(name);
  }
  return targets;
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

export function literalPathspec(path) {
  return `:(literal)${path}`;
}

function sortRepoPaths(paths) {
  return [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function validPromotionPath(path) {
  return typeof path === "string" && path.length > 0 && !/[\0-\x1f\x7f]/.test(path);
}

const PROMOTION_RESOLUTION_MARKER =
  /<!--\s*thingtime-ai-promotion-resolved:v1\s+([A-Za-z0-9_-]+)\s*-->/g;
const PROMOTION_RETIREMENT_MARKER =
  /<!--\s*thingtime-ai-promotion-retired:v1\s+([A-Za-z0-9_-]+)\s*-->/g;
const PROMOTION_PAUSE_LABEL = "ai-promotion-paused";
const SOURCE_LINEAGE_REVIEW_LABEL = "source-lineage-unverified";
const SOURCE_LINEAGE_STATUSES = new Set([
  "verified",
  "review-required-removed",
  "review-required-ambiguous",
]);

function sourceLineageStatus(value) {
  const status = value?.sourceLineageStatus;
  return SOURCE_LINEAGE_STATUSES.has(status) ? status : "review-required-ambiguous";
}

function sourceLineageReviewRequired(value) {
  return sourceLineageStatus(value) !== "verified";
}

function sourceLineageReason(status) {
  if (status === "review-required-removed") {
    return (
      `The exact historical patch is not present at current \`${CFG.source}\` tip. ` +
      "It may have been intentionally removed or reverted after the source PR merged."
    );
  }
  if (status === "review-required-ambiguous") {
    return (
      `Later edits overlap the historical patch, so its effect cannot be proven present at ` +
      `current \`${CFG.source}\` tip.`
    );
  }
  return `The exact source patch is verified at current \`${CFG.source}\` tip.`;
}
// Compatibility parser for promotion branches created before Lopu's direct
// publication model. New Lopu promotions never create these commits.
const PROMOTION_CHECKPOINT_SUBJECT = "ci: activate review-gated promotion checks";
const PROMOTION_CHECKPOINT_TRAILERS = [
  "Thingtime-Promotion-Review-Checkpoint",
  "Thingtime-Promotion-Content-Head",
  "Thingtime-Promotion-Plan-Hash",
];
const RESERVATION_TRAILER_KEYS = [
  "Thingtime-Promotion-Reservation",
  "Thingtime-Promotion-Source-PR",
  "Thingtime-Promotion-Base-Ref",
  "Thingtime-Promotion-Base-SHA",
  "Thingtime-Promotion-Branch",
  "Thingtime-Promotion-Source-Start-SHA",
  "Thingtime-Promotion-Source-End-SHA",
  "Thingtime-Promotion-Source-Lineage",
  "Thingtime-Promotion-Plan-Hash",
];

function isObjectId(value) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value || "");
}

function stablePromotionPlanManifest(context) {
  return {
    v: 1,
    source_pr: context.sourcePr,
    base_ref: context.baseRef,
    base_sha: context.baseSha,
    branch: context.branch,
    source_start_sha: context.sourceStartSha,
    source_end_sha: context.sourceEndSha,
    source_lineage_status: context.sourceLineageStatus,
    paths: sortRepoPaths(context.paths),
    patch_id: context.patchId,
  };
}

// Build the immutable, independently reproducible manifest shared by the
// promoter and trusted resolver. Graphify output is derived after resolution,
// so it never authorizes an AI-authored source change or contributes to the
// plan hash.
export function buildPromotionPlanContext(
  { sourcePr, branch, baseRef, baseSha, sourceTipSha, plan, cwd },
  { gitRunner = tryGit, commandRunner = tryRun } = {},
) {
  if (!Number.isInteger(sourcePr?.number) || sourcePr.number <= 0) {
    return { ok: false, error: "promotion plan is missing a positive source PR number" };
  }
  if (!branch || !baseRef || !isObjectId(baseSha) || !isObjectId(sourceTipSha)) {
    return {
      ok: false,
      error: "promotion plan is missing its canonical branch, exact base, or source tip",
    };
  }
  const endpoints = plannedDiffEndpoints(plan?.picks);
  if (!endpoints.ok) return endpoints;
  const resolveCommit = (value, label) => {
    const resolved = gitRunner(["rev-parse", "--verify", `${value}^{commit}`], cwd);
    if (!resolved.ok || !isObjectId(resolved.out)) {
      return { ok: false, error: `cannot resolve promotion ${label} commit \`${value}\`` };
    }
    return { ok: true, sha: resolved.out };
  };
  const start = resolveCommit(endpoints.start, "source-start");
  if (!start.ok) return start;
  const end = resolveCommit(endpoints.end, "source-end");
  if (!end.ok) return end;
  const listed = commandRunner(
    "git",
    ["-c", "core.quotePath=false", "diff", "--name-only", "-z", start.sha, end.sha],
    { ...EXEC_OPTS, cwd, preserveOutput: true },
  );
  if (!listed.ok) {
    return { ok: false, error: `cannot list promotion source paths: ${failureDetail(listed)}` };
  }
  const rawPaths = listed.out.split("\0").filter(Boolean);
  if (rawPaths.some((path) => !validPromotionPath(path))) {
    return { ok: false, error: "promotion source contains a control-character path" };
  }
  const paths = sortRepoPaths(new Set(
    rawPaths.filter((path) => !path.startsWith("graphify-out/")),
  ));
  if (paths.length === 0) {
    return {
      ok: false,
      error: "promotion conflict has no non-Graphify source paths to authorize",
    };
  }
  const diff = commandRunner(
    "git",
    [
      "diff", "--binary", "--full-index", start.sha, end.sha,
      "--", ...paths.map(literalPathspec),
    ],
    { ...EXEC_OPTS, cwd, preserveOutput: true },
  );
  if (!diff.ok || !diff.out) {
    return {
      ok: false,
      error: `cannot read promotion source manifest patch: ${failureDetail(diff)}`,
    };
  }
  const identified = commandRunner("git", ["patch-id", "--stable"], {
    ...EXEC_OPTS,
    cwd,
    input: `${diff.out}\n`,
  });
  const patchId = identified.ok ? identified.out.split(/\s+/)[0] : "";
  if (!isObjectId(patchId)) {
    return {
      ok: false,
      error: `cannot calculate promotion source manifest identity: ${failureDetail(identified)}`,
    };
  }
  const context = {
    sourcePr: sourcePr.number,
    baseRef,
    baseSha,
    branch,
    sourceTipSha,
    sourceStartSha: start.sha,
    sourceEndSha: end.sha,
    sourceLineageStatus: plan?.sourceLineageStatus,
    paths,
    patchId,
  };
  if (!SOURCE_LINEAGE_STATUSES.has(context.sourceLineageStatus)) {
    return { ok: false, error: "promotion plan has an invalid source-lineage status" };
  }
  context.planHash = createHash("sha256")
    .update(JSON.stringify(stablePromotionPlanManifest(context)))
    .digest("hex");
  return { ok: true, context };
}

export function promotionReservationTrailers(context) {
  return [
    "Thingtime-Promotion-Reservation: v1",
    `Thingtime-Promotion-Source-PR: ${context.sourcePr}`,
    `Thingtime-Promotion-Base-Ref: ${context.baseRef}`,
    `Thingtime-Promotion-Base-SHA: ${context.baseSha}`,
    `Thingtime-Promotion-Branch: ${context.branch}`,
    `Thingtime-Promotion-Source-Start-SHA: ${context.sourceStartSha}`,
    `Thingtime-Promotion-Source-End-SHA: ${context.sourceEndSha}`,
    `Thingtime-Promotion-Source-Lineage: ${context.sourceLineageStatus}`,
    `Thingtime-Promotion-Plan-Hash: ${context.planHash}`,
  ];
}

function expectedReservationTrailers(context) {
  return new Map(promotionReservationTrailers(context).map((line) => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
}

export function parsePromotionReservationTrailers(message) {
  const parsed = new Map();
  for (const line of String(message || "").split("\n")) {
    const match = /^(Thingtime-Promotion-[A-Za-z-]+):\s*(.*?)\s*$/.exec(line);
    if (!match || !RESERVATION_TRAILER_KEYS.includes(match[1])) continue;
    if (parsed.has(match[1])) return { ok: false, error: `duplicate reservation trailer \`${match[1]}\`` };
    parsed.set(match[1], match[2]);
  }
  if (!parsed.has("Thingtime-Promotion-Reservation")) return { ok: true, present: false };
  for (const key of RESERVATION_TRAILER_KEYS) {
    if (!parsed.has(key)) return { ok: false, error: `reservation commit is missing trailer \`${key}\`` };
  }
  return { ok: true, present: true, trailers: parsed };
}

export function inspectUnresolvedPromotionReservationHead(
  branchRef,
  sourcePr,
  canonicalBranch,
  cwd,
  gitRunner = tryGit,
) {
  const head = gitRunner(["rev-parse", "--verify", `${branchRef}^{commit}`], cwd);
  if (!head.ok) return { ok: false, error: "cannot resolve possible reservation head" };
  const body = gitRunner(["show", "-s", "--format=%B", head.out], cwd);
  if (!body.ok) return { ok: false, error: "cannot read possible reservation head" };
  const parsed = parsePromotionReservationTrailers(body.out);
  if (!parsed.ok || !parsed.present) return parsed;
  if (
    parsed.trailers.get("Thingtime-Promotion-Reservation") !== "v1" ||
    parsed.trailers.get("Thingtime-Promotion-Source-PR") !== String(sourcePr?.number) ||
    parsed.trailers.get("Thingtime-Promotion-Branch") !== canonicalBranch
  ) {
    return {
      ok: false,
      error: "reservation head does not belong to this exact source PR and canonical branch",
    };
  }
  const parents = gitRunner(["rev-list", "--parents", "-n", "1", head.out], cwd);
  const parts = parents.ok ? parents.out.split(/\s+/).filter(Boolean) : [];
  if (parts.length !== 2) {
    return { ok: false, error: "unresolved promotion reservation is not single-parent" };
  }
  const headTree = gitRunner(["rev-parse", `${head.out}^{tree}`], cwd);
  const parentTree = gitRunner(["rev-parse", `${parts[1]}^{tree}`], cwd);
  if (!headTree.ok || !parentTree.ok || headTree.out !== parentTree.out) {
    return { ok: false, error: "unresolved promotion reservation is not an empty commit" };
  }
  return {
    ok: true,
    present: true,
    reservationSha: head.out,
    parentSha: parts[1],
    trailers: parsed.trailers,
  };
}

export function createPromotionReservation(worktree, context, gitRunner = tryGit) {
  const head = gitRunner(["rev-parse", "--verify", "HEAD"], worktree);
  if (!head.ok || head.out !== context.baseSha) {
    return {
      ok: false,
      error: `cannot reserve \`${context.branch}\`: worktree is not at exact base \`${context.baseSha}\``,
    };
  }
  const message = [
    `chore(ci): reserve Lopu promotion resolution for #${context.sourcePr}`,
    "",
    ...promotionReservationTrailers(context),
  ].join("\n");
  const committed = gitRunner(["commit", "--allow-empty", "-m", message], worktree);
  if (!committed.ok) {
    return { ok: false, error: `cannot create promotion reservation: ${failureDetail(committed)}` };
  }
  const reservation = gitRunner(["rev-parse", "--verify", "HEAD"], worktree);
  if (!reservation.ok || !isObjectId(reservation.out)) {
    return { ok: false, error: "promotion reservation commit has no readable SHA" };
  }
  return { ok: true, reservationSha: reservation.out };
}

export function inspectPromotionReservation(
  branchRef,
  expectedBaseRef,
  context,
  cwd,
  gitRunner = tryGit,
) {
  const base = gitRunner(["rev-parse", "--verify", `${expectedBaseRef}^{commit}`], cwd);
  const head = gitRunner(["rev-parse", "--verify", `${branchRef}^{commit}`], cwd);
  if (!base.ok || !head.ok) {
    return { ok: false, error: "cannot resolve promotion reservation base/head" };
  }
  if (base.out !== context.baseSha) {
    return { ok: false, error: "promotion reservation base SHA does not match the selected base" };
  }
  const commits = gitRunner(["rev-list", "--reverse", `${base.out}..${head.out}`], cwd);
  if (!commits.ok) return { ok: false, error: `cannot inspect promotion reservation history: ${failureDetail(commits)}` };
  const first = commits.out.split("\n").filter(Boolean)[0];
  if (!first) return { ok: true, present: false };
  const body = gitRunner(["show", "-s", "--format=%B", first], cwd);
  if (!body.ok) return { ok: false, error: "cannot read promotion reservation commit" };
  const parsed = parsePromotionReservationTrailers(body.out);
  if (!parsed.ok || !parsed.present) return parsed;
  const expected = expectedReservationTrailers(context);
  for (const [key, value] of expected) {
    if (parsed.trailers.get(key) !== value) {
      return { ok: false, error: `promotion reservation trailer \`${key}\` does not match the immutable plan` };
    }
  }
  const parents = gitRunner(["rev-list", "--parents", "-n", "1", first], cwd);
  if (!parents.ok || parents.out.split(/\s+/).filter(Boolean).length !== 2 ||
      parents.out.split(/\s+/)[1] !== base.out) {
    return { ok: false, error: "promotion reservation is not the direct child of its exact base" };
  }
  const reservationTree = gitRunner(["rev-parse", `${first}^{tree}`], cwd);
  const baseTree = gitRunner(["rev-parse", `${base.out}^{tree}`], cwd);
  if (!reservationTree.ok || !baseTree.ok || reservationTree.out !== baseTree.out) {
    return { ok: false, error: "promotion reservation commit is not empty" };
  }
  return {
    ok: true,
    present: true,
    reservationSha: first,
    headSha: head.out,
    resolved: head.out !== first,
  };
}

export function parsePromotionResolutionAttestations(body) {
  const attestations = [];
  PROMOTION_RESOLUTION_MARKER.lastIndex = 0;
  for (const match of String(body || "").matchAll(PROMOTION_RESOLUTION_MARKER)) {
    try {
      const decoded = Buffer.from(match[1], "base64url").toString("utf8");
      const value = JSON.parse(decoded);
      if (value && typeof value === "object" && !Array.isArray(value)) attestations.push(value);
    } catch {
      // Invalid or attacker-authored lookalikes are ignored and can never
      // satisfy reuse validation.
    }
  }
  return attestations;
}

export function parsePromotionRetirements(body) {
  const retirements = [];
  PROMOTION_RETIREMENT_MARKER.lastIndex = 0;
  for (const match of String(body || "").matchAll(PROMOTION_RETIREMENT_MARKER)) {
    try {
      const value = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) retirements.push(value);
    } catch {
      // Invalid/user-authored lookalikes never authorize resuming a retired
      // automatic snapshot.
    }
  }
  return retirements;
}

function botCommentsByLatestEvent(comments) {
  return (comments || [])
    .map((comment, index) => ({ comment, index }))
    .filter(({ comment }) => isBotAuthoredComment(comment))
    .sort((left, right) => {
      const leftTime = Date.parse(
        left.comment?.updated_at || left.comment?.updatedAt ||
        left.comment?.created_at || left.comment?.createdAt || "",
      );
      const rightTime = Date.parse(
        right.comment?.updated_at || right.comment?.updatedAt ||
        right.comment?.created_at || right.comment?.createdAt || "",
      );
      const timeOrder = (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0);
      if (timeOrder !== 0) return timeOrder;
      const leftId = Number(left.comment?.id);
      const rightId = Number(right.comment?.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return rightId - leftId;
      }
      return right.index - left.index;
    })
    .map(({ comment }) => comment);
}

function latestBotPromotionAttestationEvents(comments) {
  const seen = new Set();
  const events = [];
  for (const comment of botCommentsByLatestEvent(comments)) {
    const grouped = new Map();
    for (const attestation of parsePromotionResolutionAttestations(comment.body)) {
      const key = `${attestation?.source_pr || ""}:${attestation?.branch || ""}:${attestation?.plan_hash || ""}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(attestation);
    }
    for (const [key, attestations] of grouped) {
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ comment, attestations });
    }
  }
  return events;
}

function promotionRetirementMarker(value) {
  return `<!-- thingtime-ai-promotion-retired:v1 ${Buffer
    .from(JSON.stringify(value), "utf8")
    .toString("base64url")} -->`;
}

function findBotPromotionRetirement(promotion, sourcePr, comments) {
  if (
    promotion?.state !== "CLOSED" ||
    promotionSourceNumber(promotion) !== sourcePr?.number ||
    !promotionBranchMatches(sourcePr, promotion.headRefName)
  ) {
    return null;
  }
  const cancellation =
    `<!-- thingtime-ai-promotion-retirement-cancelled:v1 ${promotion.number} -->`;
  for (const comment of botCommentsByLatestEvent(comments)) {
    const body = String(comment?.body || "");
    if (body.includes(cancellation)) return null;
    const matching = parsePromotionRetirements(body).find((value) =>
      value?.v === 1 &&
      value.source_pr === sourcePr.number &&
      value.promotion_pr === promotion.number &&
      value.branch === promotion.headRefName &&
      isObjectId(value.retired_head) &&
      isObjectId(value.reservation_sha) &&
      /^[0-9a-f]{64}$/i.test(value.plan_hash || ""),
    );
    if (matching) return matching;
  }
  return null;
}

export function retiredBranchCleanupDisposition(retirement, liveHead = "") {
  if (!liveHead) return "already-deleted";
  return liveHead === retirement?.retired_head ? "delete-exact" : "preserve-moved";
}

function cancelPromotionRetirement(promotion, sourcePr, reason) {
  return upsertBotIssueComment(
    sourcePr.number,
    "thingtime-ai-promotion-retired:v1",
    [
      `↩️ Automatic retirement of promotion #${promotion.number} was cancelled.`,
      "",
      reason,
      "",
      `<!-- thingtime-ai-promotion-retirement-cancelled:v1 ${promotion.number} -->`,
    ].join("\n"),
  );
}

function isBotAuthoredComment(comment) {
  const actor = comment?.user || comment?.author;
  return actor?.type === "Bot" && actor?.login === "github-actions[bot]";
}

function sourcePrHasLabel(sourcePr, name) {
  return (sourcePr?.labels || []).some((label) =>
    (typeof label === "string" ? label : label?.name) === name,
  );
}

export function isExactPausedPromotionSnapshot(sourcePr, context, comments) {
  if (!sourcePrHasLabel(sourcePr, PROMOTION_PAUSE_LABEL)) return false;
  const marker = `<!-- thingtime-ai-promotion-paused:v1 ${context?.planHash || ""} -->`;
  return (comments || []).some((comment) =>
    isBotAuthoredComment(comment) && String(comment?.body || "").includes(marker),
  );
}

function attestationMatches(attestation, context, reservation, headSha) {
  return attestation?.v === 1 &&
    attestation.source_pr === context.sourcePr &&
    attestation.base_ref === context.baseRef &&
    attestation.base_sha === context.baseSha &&
    attestation.branch === context.branch &&
    isObjectId(attestation.source_tip_sha) &&
    attestation.source_start_sha === context.sourceStartSha &&
    attestation.source_end_sha === context.sourceEndSha &&
    attestation.source_lineage_status === context.sourceLineageStatus &&
    attestation.plan_hash === context.planHash &&
    attestation.reservation_sha === reservation.reservationSha &&
    attestation.head_sha === headSha &&
    Array.isArray(attestation.conflict_paths) &&
    attestation.conflict_paths.every(
      (path) => typeof path === "string" && !path.startsWith("graphify-out/") && context.paths.includes(path),
    ) &&
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/.*)?$/.test(attestation.run_url || "");
}

export function inspectPromotionReviewCheckpoint(
  branchRef,
  context,
  cwd,
  gitRunner = tryGit,
) {
  const head = gitRunner(["rev-parse", "--verify", `${branchRef}^{commit}`], cwd);
  if (!head.ok) return { ok: false, error: "cannot resolve possible promotion review-checkpoint" };
  const body = gitRunner(["show", "-s", "--format=%B", head.out], cwd);
  if (!body.ok) return { ok: false, error: "cannot read possible promotion review-checkpoint" };
  const parsed = new Map();
  for (const line of String(body.out || "").split("\n")) {
    const match = /^(Thingtime-Promotion-[A-Za-z-]+):\s*(.*?)\s*$/.exec(line);
    if (!match || !PROMOTION_CHECKPOINT_TRAILERS.includes(match[1])) continue;
    if (parsed.has(match[1])) {
      return { ok: false, error: `duplicate review-checkpoint trailer \`${match[1]}\`` };
    }
    parsed.set(match[1], match[2]);
  }
  if (!parsed.has("Thingtime-Promotion-Review-Checkpoint")) {
    return { ok: true, present: false, headSha: head.out };
  }
  for (const key of PROMOTION_CHECKPOINT_TRAILERS) {
    if (!parsed.has(key)) {
      return { ok: false, error: `review-checkpoint is missing trailer \`${key}\`` };
    }
  }
  const parents = gitRunner(["rev-list", "--parents", "-n", "1", head.out], cwd);
  const parts = parents.ok ? parents.out.split(/\s+/).filter(Boolean) : [];
  const contentHead = parsed.get("Thingtime-Promotion-Content-Head");
  if (
    body.out.split("\n")[0] !== PROMOTION_CHECKPOINT_SUBJECT ||
    parsed.get("Thingtime-Promotion-Review-Checkpoint") !== "v1" ||
    parsed.get("Thingtime-Promotion-Plan-Hash") !== context.planHash ||
    !isObjectId(contentHead) ||
    parts.length !== 2 ||
    parts[1] !== contentHead
  ) {
    return { ok: false, error: "promotion review-checkpoint provenance does not match its immutable plan" };
  }
  const headTree = gitRunner(["rev-parse", `${head.out}^{tree}`], cwd);
  const contentTree = gitRunner(["rev-parse", `${contentHead}^{tree}`], cwd);
  if (!headTree.ok || !contentTree.ok || headTree.out !== contentTree.out) {
    return { ok: false, error: "promotion review-checkpoint is not an empty child of its content head" };
  }
  return { ok: true, present: true, headSha: head.out, contentHead };
}

export function validateAiResolvedPromotionBranch(
  branchRef,
  expectedBaseRef,
  context,
  reservation,
  comments,
  cwd,
  gitRunner = tryGit,
  commandRunner = tryRun,
) {
  const latestEvent = latestBotPromotionAttestationEvents(comments).find(({ attestations }) =>
    attestations.some((attestation) =>
      attestation?.source_pr === context.sourcePr &&
      attestation?.branch === context.branch &&
      attestation?.plan_hash === context.planHash,
    ),
  );
  const attestations = latestEvent?.attestations || [];
  const matching = attestations.filter((attestation) =>
    attestationMatches(attestation, context, reservation, reservation.headSha),
  );
  if (matching.length === 0) {
    return {
      ok: false,
      error: "AI-resolved promotion branch has no matching bot-authored source-PR attestation",
    };
  }
  const listed = commandRunner(
    "git",
    [
      "-c", "core.quotePath=false", "diff", "--name-only", "-z",
      expectedBaseRef, branchRef,
    ],
    { ...EXEC_OPTS, cwd, preserveOutput: true },
  );
  if (!listed.ok) return { ok: false, error: `cannot inspect AI-resolved promotion paths: ${failureDetail(listed)}` };
  const rawChanged = listed.out.split("\0").filter(Boolean);
  if (rawChanged.some((path) => !validPromotionPath(path))) {
    return { ok: false, error: "AI-resolved promotion contains a control-character path" };
  }
  const changed = rawChanged
    .filter((path) => !path.startsWith("graphify-out/"));
  if (changed.length === 0) {
    return { ok: false, error: "AI-resolved promotion has no non-Graphify source changes" };
  }
  const unexpected = changed.filter((path) => !context.paths.includes(path));
  if (unexpected.length > 0) {
    return {
      ok: false,
      error: `AI-resolved promotion changes path(s) outside its source plan: ${unexpected
        .slice(0, 10).map((path) => `\`${path}\``).join(", ")}`,
    };
  }
  const markers = commandRunner(
    "git",
    [
      // A bare `=======` is valid Markdown (for example a divider or Setext
      // heading). The start/base/end marker lines are unambiguous and keep
      // this check aligned with the trusted conflict-round parser.
      "grep", "-n", "-I", "-E",
      "^(<{7,}( |$)|\\|{7,}( |$)|>{7,}( |$))",
      branchRef, "--", ...changed.map(literalPathspec),
    ],
    { ...EXEC_OPTS, cwd },
  );
  if (markers.status === 0) {
    return { ok: false, error: "AI-resolved promotion still contains conflict markers" };
  }
  if (markers.status !== 1) {
    return { ok: false, error: `cannot scan AI-resolved promotion for conflict markers: ${failureDetail(markers)}` };
  }
  const pendingCheckpoint = Boolean(
    latestEvent && String(latestEvent.comment?.body || "").includes(
      `<!-- thingtime-ai-promotion-checkpoint-pending:v1 ${context.planHash} -->`,
    ),
  );
  if (pendingCheckpoint) {
    const checkpoint = inspectPromotionReviewCheckpoint(branchRef, context, cwd, gitRunner);
    if (!checkpoint.ok) return checkpoint;
    if (checkpoint.present) {
      const contentAttestation = attestations.find((attestation) =>
        attestationMatches(attestation, context, reservation, checkpoint.contentHead),
      );
      if (!contentAttestation) {
        return {
          ok: false,
          error: "review-checkpoint has no matching bot-authored content-head attestation",
        };
      }
      return {
        ok: true,
        mode: "ai-resolved-checkpoint-finalize",
        attestation: matching.at(-1),
        contentAttestation,
        checkpoint,
      };
    }
    return {
      ok: true,
      mode: "ai-resolved-checkpoint-pending",
      attestation: matching.at(-1),
    };
  }
  return { ok: true, mode: "ai-resolved", attestation: matching.at(-1) };
}

export function validateStalePendingAiPromotionBranch(
  branchRef,
  currentContext,
  comments,
  cwd,
  gitRunner = tryGit,
  commandRunner = tryRun,
) {
  const liveHead = gitRunner(["rev-parse", "--verify", `${branchRef}^{commit}`], cwd);
  if (!liveHead.ok) return { ok: false, error: "cannot resolve stale pending promotion head" };
  for (const event of latestBotPromotionAttestationEvents(comments)) {
    const comment = event.comment;
    for (const attestation of event.attestations) {
      const pendingMarker =
        `<!-- thingtime-ai-promotion-checkpoint-pending:v1 ${attestation?.plan_hash || ""} -->`;
      if (
        !String(comment.body || "").includes(pendingMarker) ||
        attestation?.v !== 1 ||
        attestation.source_pr !== currentContext.sourcePr ||
        attestation.base_ref !== currentContext.baseRef ||
        attestation.branch !== currentContext.branch ||
        attestation.source_start_sha !== currentContext.sourceStartSha ||
        attestation.source_end_sha !== currentContext.sourceEndSha ||
        attestation.head_sha !== liveHead.out ||
        !isObjectId(attestation.base_sha) ||
        !isObjectId(attestation.source_tip_sha) ||
        !isObjectId(attestation.reservation_sha) ||
        !/^[0-9a-f]{64}$/i.test(attestation.plan_hash || "")
      ) {
        continue;
      }
      const oldContext = {
        ...currentContext,
        baseSha: attestation.base_sha,
        sourceTipSha: attestation.source_tip_sha,
        planHash: attestation.plan_hash,
      };
      const reservation = inspectPromotionReservation(
        branchRef,
        attestation.base_sha,
        oldContext,
        cwd,
        gitRunner,
      );
      if (
        !reservation.ok ||
        !reservation.present ||
        !reservation.resolved ||
        reservation.reservationSha !== attestation.reservation_sha
      ) {
        continue;
      }
      const validated = validateAiResolvedPromotionBranch(
        branchRef,
        attestation.base_sha,
        oldContext,
        reservation,
        comments,
        cwd,
        gitRunner,
        commandRunner,
      );
      if (
        validated.ok &&
        (validated.mode === "ai-resolved-checkpoint-pending" ||
          validated.mode === "ai-resolved-checkpoint-finalize")
      ) {
        return { ...validated, present: true, staleContext: oldContext, liveHead: liveHead.out };
      }
    }
  }
  return { ok: true, present: false };
}

export function buildPromotionDispatchRequest(repo, context, reservationSha, title, body) {
  if (Buffer.byteLength(title, "utf8") > 256) {
    return {
      ok: false,
      error: "promotion title exceeds the trusted resolver's 256-byte bound",
    };
  }
  if (Buffer.byteLength(body, "utf8") > 24_000) {
    return {
      ok: false,
      error: "promotion body exceeds the trusted resolver's 24,000-byte bound",
    };
  }
  const promotionPlan = {
    base_ref: context.baseRef,
    base_sha: context.baseSha,
    // The lane's source branch travels in the envelope so the trusted
    // validator can verify "merged into <source>" and "live <source> tip"
    // without assuming the develop lane.
    source_ref: CFG.source,
    branch: context.branch,
    reservation_sha: reservationSha,
    source_tip_sha: context.sourceTipSha,
    source_start_sha: context.sourceStartSha,
    source_end_sha: context.sourceEndSha,
    source_lineage_status: context.sourceLineageStatus,
    plan_hash: context.planHash,
    title_b64: Buffer.from(title, "utf8").toString("base64"),
    body_b64: Buffer.from(body, "utf8").toString("base64"),
  };
  const encodedPlan = Buffer.from(JSON.stringify(promotionPlan), "utf8").toString("base64");
  const approximateInputCharacters =
    encodedPlan.length + String(context.sourcePr).length + 64;
  if (approximateInputCharacters > 60_000) {
    return {
      ok: false,
      error:
        "promotion title/body exceed the safe workflow-dispatch payload bound; " +
        "the source PR needs a shorter review body before automatic handoff",
    };
  }
  return {
    ok: true,
    endpoint: `repos/${repo}/actions/workflows/resolve-pr-conflicts.yml/dispatches`,
    payload: {
      ref: "github-actions",
      inputs: {
        promotion_source_pr: String(context.sourcePr),
        promotion_plan_b64: encodedPlan,
      },
    },
  };
}

export function promotionDispatchArgs(endpoint, inputPath) {
  return ["api", "--method", "POST", endpoint, "--input", inputPath];
}

function dispatchPromotionResolution(request, actionToken, commandRunner = tryRun) {
  if (!actionToken) return { ok: false, error: "ACTIONS_TOKEN is unavailable for bot-authored workflow dispatch" };
  const inputPath = join(
    process.env.RUNNER_TEMP || os.tmpdir(),
    `promotion-dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(inputPath, JSON.stringify(request.payload));
  try {
    const dispatched = commandRunner("gh", promotionDispatchArgs(request.endpoint, inputPath), {
      ...EXEC_OPTS,
      env: { ...process.env, GH_TOKEN: actionToken },
    });
    return dispatched.ok
      ? { ok: true }
      : { ok: false, error: `trusted resolver dispatch failed: ${failureDetail(dispatched)}` };
  } finally {
    rmSync(inputPath, { force: true });
  }
}

export function exactReservationDeleteArgs(branch, reservationSha) {
  return [
    "push",
    `--force-with-lease=refs/heads/${branch}:${reservationSha}`,
    "origin",
    `:refs/heads/${branch}`,
  ];
}

export function exactReservationPushArgs(branch) {
  return [
    "push",
    `--force-with-lease=refs/heads/${branch}:`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  ];
}

function queueTrustedPromotionWorker({
  worktree,
  context,
  title,
  body,
  conflictPaths,
}) {
  const reservation = createPromotionReservation(worktree, context);
  if (!reservation.ok) return reservation;
  const request = buildPromotionDispatchRequest(
    CFG.repo,
    context,
    reservation.reservationSha,
    title,
    body,
  );
  if (!request.ok) return request;
  const pushed = tryGit(exactReservationPushArgs(context.branch), worktree);
  if (!pushed.ok) {
    return {
      ok: false,
      error:
        `cannot publish exact reservation for \`${context.branch}\`: ` +
        failureDetail(pushed),
    };
  }
  const dispatched = dispatchPromotionResolution(
    request,
    process.env.ACTIONS_TOKEN,
  );
  if (!dispatched.ok) {
    const cleaned = tryGit(
      exactReservationDeleteArgs(context.branch, reservation.reservationSha),
      worktree,
    );
    return {
      ok: false,
      error:
        `${dispatched.error}. ` +
        (cleaned.ok
          ? "The exact unclaimed reservation branch was removed safely."
          : `The reservation cleanup lease was refused, so \`${context.branch}\` was preserved for review: ${failureDetail(cleaned)}`),
    };
  }

  let commentWarning = "";
  if (CFG.commentOnSource) {
    const conflicts = conflictPaths || [];
    const conflictSummary = conflicts
      .filter((path) => !path.startsWith("graphify-out/"))
      .slice(0, 20)
      .map((path) => `\`${path}\``)
      .join(", ");
    const handoffKind = conflicts.length > 0
      ? "Promotion conflict resolution"
      : "Lopu promotion replay";
    const commented = tryGh([
      "pr", "comment", String(context.sourcePr), ...repoFlag(),
      "--body",
      `<!-- thingtime-promotion-ai-queued:v1 ${context.planHash} -->\n` +
        `🤖 ${handoffKind} was queued automatically for ` +
        `\`${context.branch}\` at exact base \`${context.baseRef}\` ` +
        `(\`${context.baseSha}\`).` +
        `${conflictSummary ? `\n\nConflicted source paths: ${conflictSummary}.` : ""}\n\n` +
        `The trusted worker will reconstruct, verify, publish, and attest the review branch; ` +
        `no manual branch update is needed.` +
        (sourceLineageReviewRequired(context)
          ? `\n\n⚠️ Source lineage is \`${context.sourceLineageStatus}\`; the resulting PR will ` +
            `carry \`${SOURCE_LINEAGE_REVIEW_LABEL}\` and must be reviewed for restoration intent.`
          : ""),
    ]);
    if (!commented.ok) {
      commentWarning = `Could not add the queued-status comment to source PR #${context.sourcePr}.`;
    }
  }
  return {
    ok: true,
    reservationSha: reservation.reservationSha,
    warning: commentWarning,
  };
}

function redispatchPromotionReservation(context, reservationSha, title, body) {
  const request = buildPromotionDispatchRequest(
    CFG.repo,
    context,
    reservationSha,
    title,
    body,
  );
  if (!request.ok) return request;
  return dispatchPromotionResolution(request, process.env.ACTIONS_TOKEN);
}

function withActionsToken(args, token = process.env.ACTIONS_TOKEN, commandRunner = tryRun) {
  if (!token) return { ok: false, error: "ACTIONS_TOKEN is unavailable for bot-authored promotion recovery" };
  const result = commandRunner("gh", args, {
    ...EXEC_OPTS,
    env: { ...process.env, GH_TOKEN: token },
  });
  return result.ok ? result : { ...result, error: failureDetail(result) };
}

function upsertBotIssueComment(number, marker, body, token = process.env.ACTIONS_TOKEN) {
  const listed = withActionsToken([
    "api", "--paginate",
    `repos/${CFG.repo}/issues/${number}/comments?per_page=100`,
    "--slurp",
  ], token);
  if (!listed.ok) return { ok: false, error: `cannot list bot comments: ${listed.error}` };
  let comments;
  try {
    comments = JSON.parse(listed.out || "[]").flat();
  } catch (error) {
    return { ok: false, error: `cannot parse bot comments: ${String(error?.message || error)}` };
  }
  const existing = comments.filter((comment) =>
    isBotAuthoredComment(comment) && String(comment?.body || "").includes(marker),
  ).at(-1);
  const bodyFile = join(
    process.env.RUNNER_TEMP || os.tmpdir(),
    `promotion-comment-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  writeFileSync(bodyFile, body, { mode: 0o600 });
  try {
    const updated = existing
      ? withActionsToken([
          "api", "--method", "PATCH",
          `repos/${CFG.repo}/issues/comments/${existing.id}`,
          "-F", `body=@${bodyFile}`,
        ], token)
      : withActionsToken([
          "api", `repos/${CFG.repo}/issues/${number}/comments`,
          "-F", `body=@${bodyFile}`,
        ], token);
    return updated.ok
      ? { ok: true }
      : { ok: false, error: `cannot upsert bot comment: ${updated.error}` };
  } finally {
    rmSync(bodyFile, { force: true });
  }
}

export const PROMOTION_STANDASIDE_MARKER = "thingtime-promotion-standaside:v1";

// Stand-aside visibility. A promotion the promoter declines to create used to
// exist ONLY as a line in the run summary, so nobody learned about it unless
// they happened to open the run: #211 — the PR that converts `main` from a
// 2167-line resolver copy to a thin listener — was declined on 2026-08-09 and
// sat unnoticed, because the verdict ("does not cherry-pick cleanly onto
// `main`. Promote it manually", later "not verifiably present at current
// `develop` tip") never reached the PR. Every decline now upserts one
// hidden-marker comment on the SOURCE PR, edited in place on later runs so
// repeat scans never stack. Never fatal: a failed comment is a warning, never a
// reason to abandon promotion work, and dry runs stay side-effect free.
export function noteSourceStandAside(
  pr,
  {
    reason,
    heldBehind = 0,
    target = CFG.target,
    source = CFG.source,
    dryRun = CFG.dryRun,
    upsert = upsertBotIssueComment,
  } = {},
) {
  if (!pr?.number) return { ok: false, error: "stand-aside notice needs a source PR number" };
  if (dryRun) return { ok: true, skipped: "dry-run" };
  const lines = [
    `⛔ **Not promoted to \`${target}\`.** The promoter examined this merged \`${source}\` PR and stood aside:`,
    "",
    `> ${String(reason || "no reason recorded").trim().replace(/\n/g, "\n> ")}`,
    "",
  ];
  if (heldBehind > 0) {
    lines.push(
      `${heldBehind} later PR${heldBehind === 1 ? "" : "s"} in the same stack ${heldBehind === 1 ? "is" : "are"} held behind this one.`,
      "",
    );
  }
  lines.push(
    "No promotion PR exists for this change. Later runs keep re-checking and edit this " +
      "notice in place rather than repeating it; it is replaced with the promotion link once " +
      "the change does ship.",
    "",
    `<!-- ${PROMOTION_STANDASIDE_MARKER} -->`,
  );
  return upsert(pr.number, PROMOTION_STANDASIDE_MARKER, lines.join("\n"));
}

// Clears a previous stand-aside notice by editing it into a resolution, so a
// stale "not promoted" verdict can never outlive the promotion that fixed it.
export function clearSourceStandAside(
  pr,
  {
    promotionNumber,
    target = CFG.target,
    dryRun = CFG.dryRun,
    upsert = upsertBotIssueComment,
  } = {},
) {
  if (!pr?.number) return { ok: false, error: "stand-aside resolution needs a source PR number" };
  if (dryRun) return { ok: true, skipped: "dry-run" };
  return upsert(
    pr.number,
    PROMOTION_STANDASIDE_MARKER,
    [
      `✅ **Promoted to \`${target}\`**${promotionNumber ? ` in #${promotionNumber}` : ""}.`,
      "",
      "An earlier run stood aside on this PR; that verdict no longer applies.",
      "",
      `<!-- ${PROMOTION_STANDASIDE_MARKER} -->`,
    ].join("\n"),
  );
}

function encodePromotionAttestation(attestation) {
  return `<!-- thingtime-ai-promotion-resolved:v1 ${Buffer
    .from(JSON.stringify(attestation), "utf8")
    .toString("base64url")} -->`;
}

function liveRefShaWithActionsToken(ref, token = process.env.ACTIONS_TOKEN) {
  const fetched = withActionsToken([
    "api", `repos/${CFG.repo}/git/ref/heads/${encodeURIComponent(ref)}`,
    "--jq", ".object.sha",
  ], token);
  return fetched.ok && isObjectId(fetched.out)
    ? { ok: true, sha: fetched.out }
    : { ok: false, error: `cannot resolve live ref \`${ref}\`: ${fetched.error || "invalid SHA"}` };
}

function promotionAttestationBody(attestations, context, pending = false) {
  const lines = [
    `🤖 Verified automatic promotion resolution for \`${context.branch}\`.`,
    "",
    "Each marker is inert unless the live branch equals its attested head.",
    "",
    ...attestations.map(encodePromotionAttestation),
  ];
  if (pending) {
    lines.push(`<!-- thingtime-ai-promotion-checkpoint-pending:v1 ${context.planHash} -->`);
  }
  lines.push("<!-- thingtime-ai-promotion-attestation:v1 -->");
  return lines.join("\n");
}

function createPromotionReviewCheckpoint(worktree, context, contentHead, runUrl, gitRunner = tryGit) {
  const head = gitRunner(["rev-parse", "--verify", "HEAD"], worktree);
  if (!head.ok || head.out !== contentHead) {
    return { ok: false, error: "promotion recovery worktree is not at the attested content head" };
  }
  const committed = gitRunner([
    "-c", "core.hooksPath=/dev/null",
    "-c", "user.name=github-actions[bot]",
    "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit", "--allow-empty",
    "-m", PROMOTION_CHECKPOINT_SUBJECT,
    "-m", "Thingtime-Promotion-Review-Checkpoint: v1",
    "-m", `Thingtime-Promotion-Content-Head: ${contentHead}`,
    "-m", `Thingtime-Promotion-Plan-Hash: ${context.planHash}`,
    "-m", `Recovered by the promotion workflow from: ${runUrl}`,
  ], worktree);
  if (!committed.ok) {
    return { ok: false, error: `cannot create promotion review-checkpoint: ${failureDetail(committed)}` };
  }
  const checkpoint = inspectPromotionReviewCheckpoint("HEAD", context, worktree, gitRunner);
  return checkpoint.ok && checkpoint.present
    ? checkpoint
    : { ok: false, error: checkpoint.error || "created review-checkpoint failed verification" };
}

function exactCheckpointPush(
  worktree,
  branch,
  contentHead,
  checkpointHead,
  token = process.env.ACTIONS_TOKEN,
  commandRunner = tryRun,
) {
  if (!token) return { ok: false, error: "ACTIONS_TOKEN is unavailable for review-checkpoint push" };
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  const pushed = commandRunner(
    "git",
    [
      "push", "--porcelain",
      `--force-with-lease=refs/heads/${branch}:${contentHead}`,
      `https://github.com/${CFG.repo}.git`,
      `${checkpointHead}:refs/heads/${branch}`,
    ],
    {
      ...EXEC_OPTS,
      cwd: worktree,
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "4",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/dev/null",
        GIT_CONFIG_KEY_1: "core.fsmonitor",
        GIT_CONFIG_VALUE_1: "false",
        // actions/checkout persists its PAT as this multi-valued header. An
        // empty higher-priority value resets every inherited value before the
        // sole run-scoped GITHUB_TOKEN header is added.
        GIT_CONFIG_KEY_2: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_2: "",
        GIT_CONFIG_KEY_3: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_3: `AUTHORIZATION: basic ${basic}`,
      },
    },
  );
  if (pushed.ok) return { ok: true };
  const live = liveRefShaWithActionsToken(branch, token);
  return live.ok && live.sha === checkpointHead
    ? { ok: true, acceptedAfterTransportError: true }
    : { ok: false, error: `review-checkpoint push failed: ${failureDetail(pushed)}` };
}

function exactBranchDeleteWithActionsToken(
  cwd,
  branch,
  expectedHead,
  token = process.env.ACTIONS_TOKEN,
  commandRunner = tryRun,
) {
  if (!token) return { ok: false, error: "ACTIONS_TOKEN is unavailable for stale promotion cleanup" };
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  const deleted = commandRunner(
    "git",
    [
      "push", "--porcelain",
      `--force-with-lease=refs/heads/${branch}:${expectedHead}`,
      `https://github.com/${CFG.repo}.git`,
      `:refs/heads/${branch}`,
    ],
    {
      ...EXEC_OPTS,
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "4",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/dev/null",
        GIT_CONFIG_KEY_1: "core.fsmonitor",
        GIT_CONFIG_VALUE_1: "false",
        GIT_CONFIG_KEY_2: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_2: "",
        GIT_CONFIG_KEY_3: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_3: `AUTHORIZATION: basic ${basic}`,
      },
    },
  );
  if (deleted.ok) return { ok: true };
  const checked = withActionsToken([
    "api", `repos/${CFG.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    "--jq", ".object.sha",
  ], token);
  return !checked.ok && /(?:HTTP\s+404|Not Found)/i.test(checked.error || "")
    ? { ok: true, acceptedAfterTransportError: true }
    : { ok: false, error: `stale promotion cleanup lease was refused: ${failureDetail(deleted)}` };
}

function revalidateCheckpointRefs(context, expectedHead) {
  for (const [ref, expected] of [
    ["develop", context.sourceTipSha],
    [context.baseRef, context.baseSha],
    [context.branch, expectedHead],
  ]) {
    const live = liveRefShaWithActionsToken(ref);
    if (!live.ok) return live;
    if (live.sha !== expected) {
      return { ok: false, error: `live ref \`${ref}\` moved before promotion recovery` };
    }
  }
  return { ok: true };
}

export function checkpointRecoveryDisposition(status, conclusion = "") {
  if (["queued", "in_progress", "waiting", "pending", "requested"].includes(status)) {
    return "defer";
  }
  if (status === "completed") return "recover";
  return conclusion ? "recover" : "defer";
}

function promotionResolverRunDisposition(runUrl) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/.*)?$/.exec(
    String(runUrl || ""),
  );
  if (!match || match[1].toLowerCase() !== CFG.repo.toLowerCase()) {
    return { ok: false, error: "promotion attestation has no same-repository resolver run" };
  }
  const inspected = withActionsToken([
    "api", `repos/${CFG.repo}/actions/runs/${match[2]}`,
    "--jq", "[.status,.conclusion // \"\"] | @tsv",
  ]);
  if (!inspected.ok) {
    return { ok: false, error: `cannot inspect attested resolver run: ${inspected.error}` };
  }
  const [status = "", conclusion = ""] = inspected.out.split("\t");
  return {
    ok: true,
    status,
    conclusion,
    disposition: checkpointRecoveryDisposition(status, conclusion),
  };
}

function recoverPromotionReviewCheckpoint(worktree, sourcePr, context, reusable) {
  if (!process.env.ACTIONS_TOKEN) {
    return { ok: false, error: "ACTIONS_TOKEN is unavailable for checkpoint recovery" };
  }
  if (reusable.mode === "ai-resolved-checkpoint-finalize") {
    const finalized = upsertBotIssueComment(
      sourcePr.number,
      "thingtime-ai-promotion-attestation:v1",
      promotionAttestationBody([reusable.attestation], context, false),
    );
    return finalized.ok
      ? { ok: true, attestation: reusable.attestation, headSha: reusable.attestation.head_sha }
      : finalized;
  }
  if (reusable.mode !== "ai-resolved-checkpoint-pending") {
    return { ok: true, attestation: reusable.attestation, headSha: reusable.attestation?.head_sha };
  }
  const contentAttestation = reusable.attestation;
  const contentHead = contentAttestation?.head_sha;
  if (!isObjectId(contentHead)) {
    return { ok: false, error: "pending review-checkpoint has no valid attested content head" };
  }
  const resolverRun = promotionResolverRunDisposition(contentAttestation.run_url);
  if (!resolverRun.ok) return resolverRun;
  if (resolverRun.disposition === "defer") {
    return {
      ok: false,
      deferred: true,
      error:
        `attested resolver run is still \`${resolverRun.status}\`; ` +
        "checkpoint recovery deferred to avoid racing its exact-lease publication",
    };
  }
  const live = revalidateCheckpointRefs(context, contentHead);
  if (!live.ok) return live;
  const checkpoint = createPromotionReviewCheckpoint(
    worktree,
    context,
    contentHead,
    contentAttestation.run_url,
  );
  if (!checkpoint.ok) return checkpoint;
  const checkpointAttestation = {
    ...contentAttestation,
    head_sha: checkpoint.headSha,
  };
  const preAttested = upsertBotIssueComment(
    sourcePr.number,
    "thingtime-ai-promotion-attestation:v1",
    promotionAttestationBody([contentAttestation, checkpointAttestation], context, true),
  );
  if (!preAttested.ok) return preAttested;
  const stillLive = revalidateCheckpointRefs(context, contentHead);
  if (!stillLive.ok) return stillLive;
  const pushed = exactCheckpointPush(
    worktree,
    context.branch,
    contentHead,
    checkpoint.headSha,
  );
  if (!pushed.ok) return pushed;
  const accepted = liveRefShaWithActionsToken(context.branch);
  if (!accepted.ok || accepted.sha !== checkpoint.headSha) {
    return { ok: false, error: "live promotion branch does not equal its pushed review-checkpoint" };
  }
  const finalized = upsertBotIssueComment(
    sourcePr.number,
    "thingtime-ai-promotion-attestation:v1",
    promotionAttestationBody([checkpointAttestation], context, false),
  );
  return finalized.ok
    ? { ok: true, attestation: checkpointAttestation, headSha: checkpoint.headSha }
    : finalized;
}

function finalizeSourceLineageMetadata(sourcePr, promotionNumber, lineage) {
  if (!Number.isInteger(Number(promotionNumber)) || Number(promotionNumber) <= 0) {
    return { ok: false, error: "promotion PR number is unavailable for lineage metadata" };
  }
  const status = sourceLineageStatus(lineage);
  const reviewRequired = status !== "verified";
  if (reviewRequired) {
    if (!ensureSourceLineageReviewLabel(process.env.ACTIONS_TOKEN)) {
      return { ok: false, error: `cannot ensure \`${SOURCE_LINEAGE_REVIEW_LABEL}\` label` };
    }
    const labelled = withActionsToken([
      "pr", "edit", String(promotionNumber), ...repoFlag(),
      "--add-label", SOURCE_LINEAGE_REVIEW_LABEL,
    ]);
    if (!labelled.ok) return { ok: false, error: `cannot add source-lineage label: ${labelled.error}` };
  } else {
    // A later develop tip can make a formerly ambiguous historical patch
    // provable. Remove the warning label idempotently; an absent label is fine.
    withActionsToken([
      "api", "--method", "DELETE",
      `repos/${CFG.repo}/issues/${promotionNumber}/labels/${SOURCE_LINEAGE_REVIEW_LABEL}`,
    ]);
  }
  const sourceTipSha = isObjectId(lineage?.sourceTipSha) ? lineage.sourceTipSha : "unknown";
  const promotionBodyText = reviewRequired
    ? [
        "⚠️ **Source-lineage review is required before merging this promotion.**",
        "",
        sourceLineageReason(status),
        "",
        `The branch contains only source PR #${sourcePr.number}'s recoverable historical patch. ` +
          "Automation cannot decide whether restoring it is still intended.",
        "",
        `Status: \`${status}\` · checked source tip: \`${sourceTipSha}\``,
        "",
        "<!-- thingtime-promotion-lineage-review:v1 -->",
      ].join("\n")
    : [
        "✅ **Source-lineage verification currently passes.**",
        "",
        `Source PR #${sourcePr.number}'s exact patch is provably present at the current ` +
          `\`${CFG.source}\` tip \`${sourceTipSha}\`.`,
        "",
        "<!-- thingtime-promotion-lineage-review:v1 -->",
      ].join("\n");
  const reviewed = upsertBotIssueComment(
    Number(promotionNumber),
    "thingtime-promotion-lineage-review:v1",
    promotionBodyText,
  );
  if (!reviewed.ok) return reviewed;
  const sourceBodyText = reviewRequired
    ? [
        `⚠️ Promotion #${promotionNumber} re-applies this PR's exact historical patch, but ` +
          `current \`${CFG.source}\` does not prove the change remains intended.`,
        "",
        sourceLineageReason(status),
        "",
        "Review the promotion diff and merge it only if restoring the change is intentional.",
        "",
        `Status: \`${status}\` · checked source tip: \`${sourceTipSha}\``,
        "",
        "<!-- thingtime-promotion-lineage-status:v1 -->",
      ].join("\n")
    : [
        `✅ Promotion #${promotionNumber} has verified source lineage at current ` +
          `\`${CFG.source}\` tip \`${sourceTipSha}\`.`,
        "",
        "<!-- thingtime-promotion-lineage-status:v1 -->",
      ].join("\n");
  return upsertBotIssueComment(
    sourcePr.number,
    "thingtime-promotion-lineage-status:v1",
    sourceBodyText,
  );
}

function finalizeAiPromotionMetadata(sourcePr, promotionNumber, context, attestation) {
  if (!Number.isInteger(Number(promotionNumber)) || Number(promotionNumber) <= 0) {
    return { ok: false, error: "promotion PR number is unavailable for metadata finalization" };
  }
  const lineage = finalizeSourceLineageMetadata(
    sourcePr,
    promotionNumber,
    context,
  );
  if (!lineage.ok) return lineage;
  const paths = (attestation?.conflict_paths || []).map((path) => `- \`${path}\``);
  const aiResolved = paths.length > 0;
  const labelArgs = [
    "pr", "edit", String(promotionNumber), ...repoFlag(),
    "--add-label", "promotion",
  ];
  if (aiResolved) {
    labelArgs.push(
      "--add-label", "ai-conflict-resolved",
      "--add-label", "review-ai-resolution",
    );
  }
  const labelled = withActionsToken(labelArgs);
  if (!labelled.ok) return { ok: false, error: `cannot repair promotion labels: ${labelled.error}` };
  const inline = (value, fallback) => String(value || fallback)
    .slice(0, 500)
    .replace(/`/g, "\\`");
  const reviewBody = [
    aiResolved
      ? "🤖 **Lopu completed the promotion conflict resolution.**"
      : "🤖 **Lopu completed the promotion replay without an AI edit.**",
    "",
    `Source PR: #${sourcePr.number} · plan: \`${context.planHash}\` · [workflow run](${attestation.run_url})`,
    "",
    `Base: \`${context.baseRef}\` at \`${context.baseSha}\``,
    "",
    `Reservation: \`${attestation.reservation_sha}\` · verified head: \`${attestation.head_sha}\``,
    "",
    ...(paths.length > 0
      ? ["Please manually review the paths the isolated AI resolved:", ...paths]
      : ["The reconstructed synthetic patch replayed cleanly; no model-edited path remained."]),
    "",
    ...(aiResolved
      ? [
          `Model waterfall: \`${inline(attestation?.model_args, "recorded in the linked run")}\` · ` +
            `Graphify refresh: \`${inline(attestation?.graphify_mode, "recorded in the linked run")}\` ` +
            `(semantic: \`${inline(attestation?.graphify_semantic, "recorded in the linked run")}\`).`,
        ]
      : [
          `No model round ran. Graphify refresh: ` +
            `\`${inline(attestation?.graphify_mode, "recorded in the linked run")}\` ` +
            `(semantic: \`${inline(attestation?.graphify_semantic, "recorded in the linked run")}\`).`,
        ]),
    ...(sourceLineageReviewRequired(context)
      ? [
          "",
          `⚠️ Source lineage is \`${context.sourceLineageStatus}\`. ` +
            "This is separate from the AI conflict review: merge only if restoring the historical change is intended.",
        ]
      : []),
    "",
    "<!-- thingtime-ai-promotion-review:v1 -->",
  ].join("\n");
  const reviewed = upsertBotIssueComment(
    Number(promotionNumber),
    "thingtime-ai-promotion-review:v1",
    reviewBody,
  );
  if (!reviewed.ok) return reviewed;
  const statusBody = [
    `✅ Lopu opened promotion conflict resolution #${promotionNumber} for \`${context.branch}\`.`,
    "",
    `Review the exact resolved paths and immutable snapshot in the promotion PR comment. [Workflow run](${attestation.run_url}).`,
    ...(sourceLineageReviewRequired(context)
      ? [
          "",
          `⚠️ Source lineage is \`${context.sourceLineageStatus}\`; the promotion still requires an explicit product-intent review before merge.`,
        ]
      : []),
    "",
    encodePromotionAttestation(attestation),
    "<!-- thingtime-ai-promotion-status:v1 -->",
  ].join("\n");
  const status = upsertBotIssueComment(
    sourcePr.number,
    "thingtime-ai-promotion-status:v1",
    statusBody,
  );
  if (!status.ok) return status;
  withActionsToken([
    "api", "--method", "DELETE",
    `repos/${CFG.repo}/issues/${sourcePr.number}/labels/${PROMOTION_PAUSE_LABEL}`,
  ]);
  return { ok: true };
}

function promotionNumberFromUrl(url) {
  const match = /\/pull\/(\d+)(?:$|[/?#])/.exec(String(url || ""));
  return match ? Number(match[1]) : null;
}

function findOpenPromotionNumber(branch) {
  const listed = withActionsToken([
    "pr", "list", ...repoFlag(), "--head", branch, "--state", "open",
    "--json", "number", "--limit", "2",
  ]);
  if (!listed.ok) return { ok: false, error: `cannot find open promotion PR: ${listed.error}` };
  try {
    const records = JSON.parse(listed.out || "[]");
    return records.length === 1 && Number.isInteger(records[0]?.number)
      ? { ok: true, number: records[0].number }
      : { ok: false, error: `expected exactly one open PR for \`${branch}\`` };
  } catch (error) {
    return { ok: false, error: `cannot parse open promotion PR lookup: ${String(error?.message || error)}` };
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function pathspecAuthorityIntegrationTest(assert) {
  const root = mkdtempSync(join(os.tmpdir(), "promote-pathspec-authority-test-"));
  const testGit = (args) => run("git", [
    "-c", "core.hooksPath=/dev/null",
    "-c", "maintenance.auto=false",
    ...args,
  ], { cwd: root });
  try {
    testGit(["init", "--initial-branch=main"]);
    testGit(["config", "user.name", "Promotion Pathspec Test"]);
    testGit(["config", "user.email", "promotion-pathspec-test@example.invalid"]);
    const literalExclude = ":(exclude)critical.txt";
    const leadingSpace = " leading.txt";
    const trailingSpace = "trailing.txt ";
    writeFileSync(join(root, "normal.txt"), "normal base\n");
    writeFileSync(join(root, "critical.txt"), "critical base\n");
    writeFileSync(join(root, literalExclude), "literal base\n");
    writeFileSync(join(root, leadingSpace), "leading base\n");
    writeFileSync(join(root, trailingSpace), "trailing base\n");
    testGit([
      "add", "--", literalPathspec("normal.txt"), literalPathspec("critical.txt"),
      literalPathspec(literalExclude), literalPathspec(leadingSpace), literalPathspec(trailingSpace),
    ]);
    testGit(["commit", "-m", "pathspec base"]);
    const baseCommit = testGit(["rev-parse", "HEAD"]);

    writeFileSync(join(root, "normal.txt"), "normal source\n");
    writeFileSync(join(root, "critical.txt"), "critical source\n");
    writeFileSync(join(root, literalExclude), "literal source\n");
    writeFileSync(join(root, leadingSpace), "leading source\n");
    writeFileSync(join(root, trailingSpace), "trailing source\n");
    testGit([
      "add", "--", literalPathspec("normal.txt"), literalPathspec("critical.txt"),
      literalPathspec(literalExclude), literalPathspec(leadingSpace), literalPathspec(trailingSpace),
    ]);
    testGit(["commit", "-m", "PROMOTION-FULL-ACCESS-SOURCE-SENTINEL"]);
    const sourceCommit = testGit(["rev-parse", "HEAD"]);

    // Only the ordinary critical path is later removed. If the literal
    // pathspec-looking filename is interpreted as magic, it excludes
    // critical.txt from the planned patch and can falsely report verified.
    writeFileSync(join(root, "critical.txt"), "critical base\n");
    testGit(["add", "--", literalPathspec("critical.txt")]);
    testGit(["commit", "-m", "remove only critical source intent"]);
    const sourceTip = testGit(["rev-parse", "HEAD"]);

    const patch = readPlannedPatch([{ sha: sourceCommit }], root);
    assert.equal(patch.ok, true);
    assert.deepEqual(new Set(patch.paths), new Set([
      "normal.txt",
      "critical.txt",
      literalExclude,
      leadingSpace,
      trailingSpace,
    ]));
    const presence = inspectSourcePresence(sourceCommit, sourceTip, root, {
      picks: [{ sha: sourceCommit }],
    });
    assert.equal(presence.ok, false);
    assert.equal(presence.sourceLineageStatus, "review-required-ambiguous");
    assert.match(presence.error, /source-lineage safety block/);

    testGit(["checkout", "--detach", baseCommit]);
    testGit(["cherry-pick", "-x", sourceCommit]);
    const directPlan = {
      picks: [{ sha: sourceCommit }],
      sourceLineageStatus: "verified",
    };
    assert.equal(
      validateReusablePromotionBranch("HEAD", baseCommit, { mergeCommit: { oid: sourceCommit } }, root, directPlan).ok,
      true,
    );
    writeFileSync(join(root, literalExclude), "mutated orphan content\n");
    testGit(["add", "--", literalPathspec(literalExclude)]);
    testGit(["commit", "--amend", "--no-edit"]);
    assert.equal(
      validateReusablePromotionBranch("HEAD", baseCommit, { mergeCommit: { oid: sourceCommit } }, root, directPlan).ok,
      false,
      "a mutable direct branch cannot hide drift behind a magic-looking literal filename",
    );

    const controlPath = readPlannedPatch([{ sha: sourceCommit }], root, {
      gitRunner: (args) => args.includes("--name-only")
        ? { ok: true, out: "normal.txt\0bad\nname.txt\0", err: "", status: 0 }
        : { ok: false, out: "", err: "unexpected git call", status: 2 },
      commandRunner: () => {
        throw new Error("control-character path must fail before patch extraction");
      },
    });
    assert.equal(controlPath.ok, false);
    assert.match(controlPath.error, /control-character path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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
  const testTryGit = (args, cwd = root, opts = {}) =>
    tryRun("git", isolatedArgs(args), { cwd, env: isolatedEnv, ...opts });

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
    // must not silently call the removed feature verified or create a branch.
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
    assert.equal(ancestryReverted.sourceLineageStatus, "review-required-removed");
    assert.match(
      ancestryReverted.error,
      /Lopu will create a reviewable candidate instead of labelling the patch verified/,
      "the verdict must describe Lopu's candidate rather than claim nothing was created",
    );

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
    assert.equal(removedFromSource.sourceLineageStatus, "review-required-removed");
    assert.match(removedFromSource.error, /source-lineage safety block/);

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
    const reservationBranch = promotionBranchFor(sourcePr);
    const reservationContext = buildPromotionPlanContext({
      sourcePr,
      branch: reservationBranch,
      baseRef: "main",
      baseSha: testGit(["rev-parse", "origin/main"], fresh),
      sourceTipSha: testGit(["rev-parse", "origin/develop"], fresh),
      plan,
      cwd: fresh,
    });
    assert.equal(reservationContext.ok, true);
    const missingRecoveryContext = validateReusablePromotionForRun({
      branchRef: "HEAD",
      actualBranchName: reservationBranch,
      expectedBaseRef: "origin/main",
      expectedBaseName: "main",
      sourceTipSha: testGit(["rev-parse", "origin/develop"], fresh),
      sourcePr,
      cwd: fresh,
      plan: { picks: [], sourceLineageStatus: "verified" },
    });
    assert.equal(missingRecoveryContext.ok, false);
    assert.match(missingRecoveryContext.error, /cannot build immutable context/);
    const advancedSourceTipContext = buildPromotionPlanContext({
      sourcePr,
      branch: reservationBranch,
      baseRef: "main",
      baseSha: testGit(["rev-parse", "origin/main"], fresh),
      sourceTipSha: orphanedMergeSha,
      plan,
      cwd: fresh,
    });
    assert.equal(advancedSourceTipContext.ok, true);
    assert.equal(
      advancedSourceTipContext.context.planHash,
      reservationContext.context.planHash,
      "source tip is a transient dispatch race guard, not durable plan identity",
    );
    assert.deepEqual(
      promotionReservationTrailers(advancedSourceTipContext.context),
      promotionReservationTrailers(reservationContext.context),
    );
    const ambiguousContext = buildPromotionPlanContext({
      sourcePr,
      branch: reservationBranch,
      baseRef: "main",
      baseSha: testGit(["rev-parse", "origin/main"], fresh),
      sourceTipSha: testGit(["rev-parse", "origin/develop"], fresh),
      plan: { ...plan, sourceLineageStatus: "review-required-ambiguous" },
      cwd: fresh,
    });
    assert.equal(ambiguousContext.ok, true);
    assert.notEqual(
      ambiguousContext.context.planHash,
      reservationContext.context.planHash,
      "a review-required lineage classification must be bound into immutable plan identity",
    );
    assert.match(
      promotionReservationTrailers(ambiguousContext.context).join("\n"),
      /Thingtime-Promotion-Source-Lineage: review-required-ambiguous/,
    );
    assert.equal(buildPromotionPlanContext({
      sourcePr,
      branch: reservationBranch,
      baseRef: "main",
      baseSha: testGit(["rev-parse", "origin/main"], fresh),
      sourceTipSha: testGit(["rev-parse", "origin/develop"], fresh),
      plan: { ...plan, sourceLineageStatus: "unknown" },
      cwd: fresh,
    }).ok, false);
    const reservation = createPromotionReservation(
      fresh,
      reservationContext.context,
      testTryGit,
    );
    assert.equal(reservation.ok, true);
    assert.doesNotMatch(
      testGit(["show", "-s", "--format=%B", reservation.reservationSha], fresh),
      /\[skip ci\]/,
      "Lopu reservations publish directly without suppressing CI",
    );
    assert.deepEqual(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          attestations: null,
          gitRunner: testTryGit,
        },
      ),
      {
        ok: true,
        mode: "reservation",
        reservationSha: reservation.reservationSha,
      },
      "an exact empty reservation is reusable as an idempotent queued handoff",
    );
    const staleReservation = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: {
          ...reservationContext.context,
          planHash: "f".repeat(64),
        },
        actualBranchName: reservationBranch,
        attestations: null,
        gitRunner: testTryGit,
      },
    );
    assert.equal(staleReservation.ok, false);
    assert.equal(staleReservation.staleReservation, true);
    assert.equal(staleReservation.reservationSha, reservation.reservationSha);
    writeFileSync(join(fresh, "feature.txt"), "feature\n");
    testGit(["add", "feature.txt"], fresh);
    testGit(["commit", "-m", "AI-resolved promotion fixture"], fresh);
    const resolvedHead = testGit(["rev-parse", "HEAD"], fresh);
    const resolvedAttestation = {
      v: 1,
      source_pr: sourcePr.number,
      base_ref: reservationContext.context.baseRef,
      base_sha: reservationContext.context.baseSha,
      branch: reservationBranch,
      source_tip_sha: orphanedMergeSha,
      source_start_sha: reservationContext.context.sourceStartSha,
      source_end_sha: reservationContext.context.sourceEndSha,
      source_lineage_status: reservationContext.context.sourceLineageStatus,
      plan_hash: reservationContext.context.planHash,
      reservation_sha: reservation.reservationSha,
      head_sha: resolvedHead,
      conflict_paths: ["feature.txt"],
      run_url: "https://github.com/lopugit/thingtime/actions/runs/123",
    };
    const botComment = (attestation) => ({
      user: { login: "github-actions[bot]", type: "Bot" },
      body:
        "resolved\n<!-- thingtime-ai-promotion-resolved:v1 " +
        `${Buffer.from(JSON.stringify(attestation)).toString("base64url")} -->`,
    });
    const pausedSourcePr = {
      ...sourcePr,
      labels: [{ name: PROMOTION_PAUSE_LABEL }],
    };
    const pausedComment = {
      user: { login: "github-actions[bot]", type: "Bot" },
      body:
        `Automatic promotion paused.\n<!-- thingtime-ai-promotion-paused:v1 ` +
        `${reservationContext.context.planHash} -->`,
    };
    assert.equal(
      isExactPausedPromotionSnapshot(
        pausedSourcePr,
        reservationContext.context,
        [pausedComment],
      ),
      true,
      "an exact bot marker plus pause label suppresses repeated automatic dispatch",
    );
    assert.equal(
      isExactPausedPromotionSnapshot(
        { ...pausedSourcePr, labels: [] },
        reservationContext.context,
        [pausedComment],
      ),
      false,
      "removing the pause label explicitly retries the same immutable snapshot",
    );
    assert.equal(
      isExactPausedPromotionSnapshot(
        pausedSourcePr,
        reservationContext.context,
        [{ ...pausedComment, user: { login: "lopugit", type: "User" } }],
      ),
      false,
      "a user-authored lookalike cannot suppress automatic resolution",
    );
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          attestations: [botComment(resolvedAttestation)],
          gitRunner: testTryGit,
        },
      ).mode,
      "ai-resolved",
      "an attested AI resolution may reuse only planned source paths",
    );
    const pendingAttestationComment = {
      user: { login: "github-actions[bot]", type: "Bot" },
      body: [
        encodePromotionAttestation(resolvedAttestation),
        `<!-- thingtime-ai-promotion-checkpoint-pending:v1 ${reservationContext.context.planHash} -->`,
        "<!-- thingtime-ai-promotion-attestation:v1 -->",
      ].join("\n"),
    };
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          attestations: [pendingAttestationComment],
          gitRunner: testTryGit,
        },
      ).mode,
      "ai-resolved-checkpoint-pending",
      "a pending content-head attestation must never be treated as final",
    );
    const stalePending = validateStalePendingAiPromotionBranch(
      "HEAD",
      {
        ...reservationContext.context,
        baseSha: rewrittenSha,
        planHash: "0".repeat(64),
      },
      [pendingAttestationComment],
      fresh,
      testTryGit,
    );
    assert.equal(stalePending.ok, true);
    assert.equal(stalePending.present, true);
    assert.equal(stalePending.liveHead, resolvedHead);
    assert.equal(
      validateStalePendingAiPromotionBranch(
        "HEAD",
        {
          ...reservationContext.context,
          baseSha: rewrittenSha,
          planHash: "0".repeat(64),
        },
        [{ ...pendingAttestationComment, user: { login: "lopugit", type: "User" } }],
        fresh,
        testTryGit,
      ).present,
      false,
      "stale cleanup authority must never come from a user-authored marker",
    );
    const reviewCheckpoint = createPromotionReviewCheckpoint(
      fresh,
      reservationContext.context,
      resolvedHead,
      resolvedAttestation.run_url,
      testTryGit,
    );
    assert.equal(reviewCheckpoint.ok, true);
    const checkpointAttestation = {
      ...resolvedAttestation,
      head_sha: reviewCheckpoint.headSha,
    };
    const checkpointPendingComment = {
      user: { login: "github-actions[bot]", type: "Bot" },
      body: [
        encodePromotionAttestation(resolvedAttestation),
        encodePromotionAttestation(checkpointAttestation),
        `<!-- thingtime-ai-promotion-checkpoint-pending:v1 ${reservationContext.context.planHash} -->`,
        "<!-- thingtime-ai-promotion-attestation:v1 -->",
      ].join("\n"),
    };
    const checkpointReuse = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: reservationContext.context,
        actualBranchName: reservationBranch,
        attestations: [checkpointPendingComment],
        gitRunner: testTryGit,
      },
    );
    assert.equal(checkpointReuse.mode, "ai-resolved-checkpoint-finalize");
    assert.equal(checkpointReuse.checkpoint.contentHead, resolvedHead);
    const duplicatePendingComment = {
      ...checkpointPendingComment,
      id: 201,
      created_at: "2026-08-09T00:00:00Z",
      updated_at: "2026-08-09T00:00:00Z",
    };
    const finalizedCheckpointComment = {
      id: 202,
      created_at: "2026-08-09T00:00:01Z",
      updated_at: "2026-08-09T00:00:02Z",
      user: { login: "github-actions[bot]", type: "Bot" },
      body: [
        encodePromotionAttestation(checkpointAttestation),
        "<!-- thingtime-ai-promotion-attestation:v1 -->",
      ].join("\n"),
    };
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          attestations: [duplicatePendingComment, finalizedCheckpointComment],
          gitRunner: testTryGit,
        },
      ).mode,
      "ai-resolved",
      "the latest finalized bot attestation supersedes an older duplicate pending marker",
    );
    assert.equal(
      validateStalePendingAiPromotionBranch(
        "HEAD",
        {
          ...reservationContext.context,
          baseSha: rewrittenSha,
          planHash: "0".repeat(64),
        },
        [duplicatePendingComment, finalizedCheckpointComment],
        fresh,
        testTryGit,
      ).present,
      false,
      "an older duplicate pending marker cannot re-authorize stale cleanup after finalization",
    );
    testGit(["reset", "--hard", resolvedHead], fresh);
    const rolledBackAfterCheckpoint = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: reservationContext.context,
        actualBranchName: reservationBranch,
        attestations: [duplicatePendingComment, finalizedCheckpointComment],
        gitRunner: testTryGit,
      },
    );
    assert.equal(
      rolledBackAfterCheckpoint.ok,
      false,
      "rolling a finalized branch back to its older content head cannot bypass the review checkpoint",
    );
    assert.match(rolledBackAfterCheckpoint.error, /no matching bot-authored/);
    writeFileSync(join(fresh, "feature.txt"), "feature\n=======\nnotes\n");
    testGit(["add", "feature.txt"], fresh);
    testGit(["commit", "-m", "retain valid Markdown divider"], fresh);
    const dividerAttestation = {
      ...resolvedAttestation,
      head_sha: testGit(["rev-parse", "HEAD"], fresh),
    };
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          attestations: [botComment(dividerAttestation)],
          gitRunner: testTryGit,
        },
      ).mode,
      "ai-resolved",
      "a standalone Markdown divider must not be mistaken for a conflict marker",
    );
    writeFileSync(
      join(fresh, "feature.txt"),
      "<<<<<<< ours\nfeature\n=======\nother\n>>>>>>> theirs\n",
    );
    testGit(["add", "feature.txt"], fresh);
    testGit(["commit", "-m", "leave real conflict markers"], fresh);
    const markerAttestation = {
      ...resolvedAttestation,
      head_sha: testGit(["rev-parse", "HEAD"], fresh),
    };
    const rejectedMarkers = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: reservationContext.context,
        actualBranchName: reservationBranch,
        attestations: [botComment(markerAttestation)],
        gitRunner: testTryGit,
      },
    );
    assert.equal(rejectedMarkers.ok, false);
    assert.match(rejectedMarkers.error, /conflict markers/);
    writeFileSync(join(fresh, "feature.txt"), "<<<<<<<\n");
    testGit(["add", "feature.txt"], fresh);
    testGit(["commit", "-m", "leave malformed bare marker"], fresh);
    const bareMarkerAttestation = {
      ...resolvedAttestation,
      head_sha: testGit(["rev-parse", "HEAD"], fresh),
    };
    const rejectedBareMarker = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: reservationContext.context,
        actualBranchName: reservationBranch,
        attestations: [botComment(bareMarkerAttestation)],
        gitRunner: testTryGit,
      },
    );
    assert.equal(rejectedBareMarker.ok, false);
    assert.match(rejectedBareMarker.error, /conflict markers/);
    writeFileSync(
      join(fresh, "feature.txt"),
      "<<<<<<<<<< ours\nfeature\n==========\nother\n>>>>>>>>>> theirs\n",
    );
    testGit(["add", "feature.txt"], fresh);
    testGit(["commit", "-m", "leave ten-character conflict markers"], fresh);
    const wideMarkerAttestation = {
      ...resolvedAttestation,
      head_sha: testGit(["rev-parse", "HEAD"], fresh),
    };
    const rejectedWideMarkers = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: reservationContext.context,
        actualBranchName: reservationBranch,
        attestations: [botComment(wideMarkerAttestation)],
        gitRunner: testTryGit,
      },
    );
    assert.equal(rejectedWideMarkers.ok, false);
    assert.match(rejectedWideMarkers.error, /conflict markers/);
    testGit(["reset", "--hard", resolvedHead], fresh);
    writeFileSync(join(fresh, "unrelated.txt"), "not authorized\n");
    testGit(["add", "unrelated.txt"], fresh);
    testGit(["commit", "-m", "unauthorized AI drift"], fresh);
    const driftedAttestation = {
      ...resolvedAttestation,
      head_sha: testGit(["rev-parse", "HEAD"], fresh),
    };
    const rejectedAiDrift = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: reservationContext.context,
        actualBranchName: reservationBranch,
        attestations: [botComment(driftedAttestation)],
        gitRunner: testTryGit,
      },
    );
    assert.equal(rejectedAiDrift.ok, false);
    assert.match(rejectedAiDrift.error, /outside its source plan/);
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          attestations: [{
            user: { login: "dependabot[bot]", type: "Bot" },
            body: botComment(driftedAttestation).body,
          }],
          gitRunner: testTryGit,
        },
      ).ok,
      false,
      "an arbitrary bot's marker must never attest a promotion result",
    );
    testGit(["reset", "--hard", "origin/main"], fresh);

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
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: reservationBranch,
          gitRunner: testTryGit,
        },
      ).ok,
      true,
      "a verified canonical direct branch keeps the fast-path recovery",
    );
    const reviewRequiredDirect = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: {
          ...reservationContext.context,
          sourceLineageStatus: "review-required-removed",
        },
        actualBranchName: reservationBranch,
        gitRunner: testTryGit,
      },
    );
    assert.equal(reviewRequiredDirect.ok, true);
    const ciSensitiveDirect = validateReusablePromotionBranch(
      "HEAD",
      "origin/main",
      sourcePr,
      fresh,
      plan,
      {
        promotionContext: {
          ...reservationContext.context,
          paths: [".github/workflows/lopu-restart-canary.yml"],
        },
        actualBranchName: reservationBranch,
        gitRunner: testTryGit,
      },
    );
    assert.equal(ciSensitiveDirect.ok, true);
    assert.equal(
      validateReusablePromotionBranch(
        "HEAD",
        "origin/main",
        sourcePr,
        fresh,
        plan,
        {
          promotionContext: reservationContext.context,
          actualBranchName: `${reservationBranch}-noncanonical`,
          gitRunner: testTryGit,
        },
      ).ok,
      false,
      "a plain direct promotion branch must always use the canonical name",
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
    // if a later source commit reverts it, preflight must refuse to call the
    // plan verified. Under the never-cancel policy that no longer means
    // dropping the promotion — the plan survives so Lopu can open a labelled
    // review PR instead of the change vanishing.
    testGit(["revert", "--no-edit", rewrittenSha], writer);
    testGit(["push", "origin", "HEAD:develop"], writer);
    testGit([
      "fetch", "origin", "+refs/heads/develop:refs/remotes/origin/develop",
    ], fresh);
    const revertedPlans = preflightPromotionPlans([sourcePr], "origin/main", {
      cwd: fresh,
      sourceSha: "origin/develop",
    });
    const revertedPlan = revertedPlans.get(sourcePr.number);
    assert.equal(revertedPlan.error, undefined, "a reverted patch must no longer be dropped");
    assert.equal(revertedPlan.sourceLineageStatus, "review-required-removed");
    assert.equal(revertedPlan.sourceLineageReviewRequired, true);
    assert.equal(sourceLineageReviewRequired(revertedPlan), true);
    assert.match(revertedPlan.sourceLineageDetail, /source-lineage safety block/);
    assert.ok(
      Array.isArray(revertedPlan.picks) && revertedPlan.picks.length > 0,
      "the reviewable plan must keep its picks so Lopu has something to replay",
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
  // Never-cancel replacement for the retired close-before-AI boundary: a
  // degraded lineage marks a plan for review instead of destroying the
  // promotion a human was already given.
  assert.equal(
    sourceLineageReviewRequired({
      sourceLineageStatus: "review-required-removed",
      sourceLineageReviewRequired: true,
    }),
    true,
    "an open promotion whose source patch was removed remains reviewable, never closed",
  );
  assert.equal(
    sourceLineageReviewRequired({ sourceLineageStatus: "verified" }),
    false,
    "verified source lineage needs no extra review state",
  );

  const pr = { number: 7, headRefName: "claude/search-index-abc123", title: "feat: add search" };
  // Uniform lane naming: every branch names its target; legacy unsuffixed
  // names stay recognized as main-lane history.
  assert.equal(promotionBranchFor(pr), "promote/pr-7-search-index-abc123--to-main");
  assert.equal(
    promotionBranchFor(pr, "github-actions"),
    "promote/pr-7-search-index-abc123--to-github-actions",
  );
  assert.equal(legacyPromotionBranchFor(pr), "promote/pr-7-search-index-abc123");
  assert.equal(promotionBranchMatches(pr, "promote/pr-7-search-index-abc123--to-main", "main"), true);
  assert.equal(
    promotionBranchMatches(pr, "promote/pr-7-search-index-abc123", "main"),
    true,
    "legacy unsuffixed names still match on the main lane",
  );
  assert.equal(
    promotionBranchMatches(pr, "promote/pr-7-search-index-abc123", "github-actions"),
    false,
    "legacy unsuffixed names never match another lane",
  );
  const multiCfg = { source: "develop", target: "main", primaryTarget: "main", targets: ["github-actions", "main", "develop", "", "bad ref", "--evil"] };
  assert.deepEqual(
    promotionTargets(multiCfg),
    ["main", "github-actions"],
    "targets dedupe, drop the source branch, and reject unsafe ref names",
  );
  assert.deepEqual(promotionTargets({ source: "develop", target: "main", targets: [] }), ["main"]);
  // Pass visibility: the primary pass must not see another target's promotion,
  // and an additional target must see only its own.
  const primaryPass = { ...multiCfg, target: "main" };
  const secondPass = { ...multiCfg, target: "github-actions" };
  const mainPromotion = { headRefName: "promote/pr-7-search-index-abc123--to-main" };
  const gaPromotion = { headRefName: "promote/pr-7-search-index-abc123--to-github-actions" };
  assert.equal(promotionBelongsToPass(mainPromotion, primaryPass), true);
  assert.equal(promotionBelongsToPass(gaPromotion, primaryPass), false);
  assert.equal(promotionBelongsToPass(gaPromotion, secondPass), true);
  assert.equal(promotionBelongsToPass(mainPromotion, secondPass), false);
  assert.equal(
    promotionBelongsToPass({ headRefName: "promote/pr-9-legacy" }, primaryPass),
    true,
    "legacy pre-uniform branches belong to the main lane",
  );
  assert.equal(
    promotionBelongsToPass({ headRefName: "promote/pr-9-legacy" }, secondPass),
    false,
    "legacy pre-uniform branches never join another lane",
  );
  assert.equal(
    promotionBelongsToPass(
      { headRefName: promotionBranchFor({ number: 5, headRefName: "codex/foo-to-github-actions", title: "t" }, "main") },
      primaryPass,
    ),
    true,
    "a source branch that merely reads like a lane marker stays on its lane",
  );
  assert.equal(
    promotionBelongsToPass({ headRefName: "promote/pr-5-foo-to-github-actions" }, secondPass),
    false,
    "a single-dash -to- lookalike is legacy main-lane history, not a lane marker",
  );
  assert.equal(promotionBranchFor({ number: 8, headRefName: "", title: "Fix: A thing" }),
    "promote/pr-8-fix-a-thing--to-main");
  const retiredSource = {
    number: 8,
    headRefName: "",
    title: "Fix: A thing",
  };
  const retiredBranch = promotionBranchFor(retiredSource);
  const retiredPromotion = {
    number: 508,
    state: "CLOSED",
    headRefName: retiredBranch,
    body: "<!-- promotion-of: 8 -->",
  };
  const retirementFixture = {
    v: 1,
    source_pr: 8,
    promotion_pr: 508,
    branch: retiredBranch,
    retired_head: "a".repeat(40),
    reservation_sha: "b".repeat(40),
    plan_hash: "c".repeat(64),
  };
  const retiredComment = {
    id: 100,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
    user: { login: "github-actions[bot]", type: "Bot" },
    body: promotionRetirementMarker(retirementFixture),
  };
  assert.deepEqual(
    findBotPromotionRetirement(retiredPromotion, retiredSource, [retiredComment]),
    retirementFixture,
    "a restart after close/delete must resume only an exact durable bot retirement",
  );
  assert.equal(
    retiredBranchCleanupDisposition(retirementFixture, retirementFixture.retired_head),
    "delete-exact",
    "a restart after close but before delete resumes the exact leased cleanup",
  );
  assert.equal(
    retiredBranchCleanupDisposition(retirementFixture, "d".repeat(40)),
    "preserve-moved",
    "a user-advanced branch must be preserved after a failed retirement cleanup",
  );
  assert.deepEqual(
    parsePromotionRetirements(
      "<!-- thingtime-ai-promotion-retirement-cancelled:v1 508 -->",
    ),
    [],
    "successful reopen recovery clears active retirement authority so later user closure is respected",
  );
  assert.equal(
    findBotPromotionRetirement(
      retiredPromotion,
      retiredSource,
      [{ ...retiredComment, user: { login: "lopugit", type: "User" } }],
    ),
    null,
    "a user-authored retirement lookalike cannot recreate a closed promotion",
  );
  const duplicateRetirement = {
    ...retiredComment,
    id: 101,
    created_at: "2026-08-09T00:00:01Z",
    updated_at: "2026-08-09T00:00:01Z",
  };
  const retirementCancellation = {
    ...duplicateRetirement,
    updated_at: "2026-08-09T00:00:02Z",
    body: "<!-- thingtime-ai-promotion-retirement-cancelled:v1 508 -->",
  };
  assert.equal(
    findBotPromotionRetirement(
      retiredPromotion,
      retiredSource,
      [retiredComment, retirementCancellation],
    ),
    null,
    "the latest bot cancellation supersedes every older duplicate retirement marker",
  );
  const reorderedStack = [
    { number: 22, mergedAt: "2026-08-09T02:00:00Z" },
    { number: 21, mergedAt: "2026-08-09T01:00:00Z" },
  ];
  sortPromotionCandidates(reorderedStack);
  assert.deepEqual(
    reorderedStack.map((candidate) => candidate.number),
    [21, 22],
    "outside-lookback predecessors requeued by maintenance must regain chronological stack order",
  );

  let checkpointPushOptions;
  const checkpointPushFixture = exactCheckpointPush(
    "/tmp",
    "promote/pr-8-fix-a-thing",
    "a".repeat(40),
    "b".repeat(40),
    "run-scoped-bot-token",
    (_command, _args, options) => {
      checkpointPushOptions = options;
      return { ok: true, status: 0, out: "", err: "" };
    },
  );
  assert.equal(checkpointPushFixture.ok, true);
  assert.equal(checkpointPushOptions.env.GIT_CONFIG_COUNT, "4");
  assert.equal(checkpointPushOptions.env.GIT_CONFIG_KEY_2, "http.https://github.com/.extraheader");
  assert.equal(
    checkpointPushOptions.env.GIT_CONFIG_VALUE_2,
    "",
    "checkpoint push must reset the PAT header persisted by actions/checkout",
  );
  assert.equal(checkpointPushOptions.env.GIT_CONFIG_KEY_3, "http.https://github.com/.extraheader");
  assert.match(checkpointPushOptions.env.GIT_CONFIG_VALUE_3, /^AUTHORIZATION: basic /);
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
    assert.equal(
      checkpointRecoveryDisposition(status),
      "defer",
      `promoter must not race an attested resolver run in ${status}`,
    );
  }
  assert.equal(checkpointRecoveryDisposition("completed", "failure"), "recover");
  assert.equal(checkpointRecoveryDisposition("completed", "success"), "recover");

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
  const lineageBody = promotionBody(
    { ...pr, author: { login: "tester" }, mergedAt: "2026-08-09T00:00:00Z", mergeCommit: { oid: "a".repeat(40) } },
    null,
    1,
    [],
    () => "",
    { sourceLineageStatus: "review-required-removed" },
  );
  assert.match(lineageBody, /Source-lineage review required/);
  assert.match(lineageBody, /Do not merge this promotion unless restoring/);
  assert.match(lineageBody, /thingtime-promotion-source-lineage:v1/);

  // Stand-aside notices: a declined promotion must say so on the source PR,
  // under one reusable marker, and must never act during a dry run.
  const standAsideCalls = [];
  const standAsideUpsert = (number, marker, body) => {
    standAsideCalls.push({ number, marker, body });
    return { ok: true };
  };
  const stood = noteSourceStandAside(
    { number: 211, title: "ci: centralize Actions" },
    {
      reason: "source-lineage safety block: the exact historical patch cannot be proven present",
      heldBehind: 2,
      target: "main",
      source: "develop",
      dryRun: false,
      upsert: standAsideUpsert,
    },
  );
  assert.equal(stood.ok, true);
  assert.equal(standAsideCalls.length, 1);
  assert.equal(standAsideCalls[0].number, 211);
  assert.equal(standAsideCalls[0].marker, PROMOTION_STANDASIDE_MARKER);
  assert.match(standAsideCalls[0].body, /Not promoted to `main`/);
  assert.match(standAsideCalls[0].body, /source-lineage safety block/);
  assert.match(standAsideCalls[0].body, /2 later PRs in the same stack are held behind this one/);
  assert.match(standAsideCalls[0].body, /thingtime-promotion-standaside:v1/);
  assert.equal(
    noteSourceStandAside(
      { number: 211 },
      { reason: "x", dryRun: true, upsert: standAsideUpsert },
    ).skipped,
    "dry-run",
    "a dry run must never comment on a source PR",
  );
  assert.equal(standAsideCalls.length, 1);
  assert.equal(
    noteSourceStandAside({}, { reason: "x", dryRun: false, upsert: standAsideUpsert }).ok,
    false,
    "a stand-aside notice without a PR number must fail closed",
  );
  assert.equal(standAsideCalls.length, 1);
  const cleared = clearSourceStandAside(
    { number: 211 },
    { promotionNumber: 999, target: "main", dryRun: false, upsert: standAsideUpsert },
  );
  assert.equal(cleared.ok, true);
  assert.equal(standAsideCalls.length, 2);
  assert.equal(
    standAsideCalls[1].marker,
    PROMOTION_STANDASIDE_MARKER,
    "a resolution must edit the same comment the decline created",
  );
  assert.match(standAsideCalls[1].body, /Promoted to `main`.*in #999/s);
  assert.doesNotMatch(standAsideCalls[1].body, /Not promoted/);
  assert.doesNotMatch(
    promotionBody(
      { ...pr, author: { login: "tester" }, mergedAt: "2026-08-09T00:00:00Z", mergeCommit: { oid: "a".repeat(40) } },
      null,
      1,
      [],
      () => "",
      { sourceLineageStatus: "verified" },
    ),
    /Source-lineage review required/,
  );

  assert.ok(setsEqual(new Set(["a", "b"]), new Set(["b", "a"])));
  assert.ok(!setsEqual(new Set(["a"]), new Set(["a", "b"])));
  assert.equal(literalPathspec(":(top,glob)**"), ":(literal):(top,glob)**");
  assert.deepEqual(sortRepoPaths(["é.txt", "z.txt", "a.txt"]), ["a.txt", "z.txt", "é.txt"]);
  const workflowConflictBody = promotionWorkerReviewBody(
    "candidate\n---\nfooter",
    {
      sourcePr: 7,
      baseRef: "main",
      paths: [".github/workflows/promotion-canary.yml"],
      sourceLineageStatus: "verified",
    },
  );
  assert.match(workflowConflictBody, /exact source patch conflicted/);
  assert.match(
    promotionWorkerReviewBody(
      "candidate\n---\nfooter",
      {
        sourcePr: 7,
        baseRef: "main",
        paths: ["remix/app/conflict.ts"],
        sourceLineageStatus: "verified",
      },
    ),
    /exact source patch conflicted/,
  );

  const dispatchContext = {
    sourcePr: 193,
    baseRef: "main",
    baseSha: "a".repeat(40),
    branch: "promote/pr-193-fixture",
    sourceTipSha: "9".repeat(40),
    sourceStartSha: "b".repeat(40),
    sourceEndSha: "c".repeat(40),
    sourceLineageStatus: "review-required-ambiguous",
    planHash: "d".repeat(64),
  };
  const dispatchRequest = buildPromotionDispatchRequest(
    "lopugit/thingtime",
    dispatchContext,
    "e".repeat(40),
    "fixture title",
    "fixture body",
  );
  assert.equal(dispatchRequest.ok, true);
  assert.equal(
    dispatchRequest.endpoint,
    "repos/lopugit/thingtime/actions/workflows/resolve-pr-conflicts.yml/dispatches",
  );
  assert.equal(dispatchRequest.payload.ref, "github-actions");
  assert.deepEqual(Object.keys(dispatchRequest.payload.inputs), [
    "promotion_source_pr",
    "promotion_plan_b64",
  ]);
  const decodedDispatchPlan = JSON.parse(
    Buffer.from(dispatchRequest.payload.inputs.promotion_plan_b64, "base64").toString("utf8"),
  );
  assert.deepEqual(Object.keys(decodedDispatchPlan), [
    "base_ref",
    "base_sha",
    "source_ref",
    "branch",
    "reservation_sha",
    "source_tip_sha",
    "source_start_sha",
    "source_end_sha",
    "source_lineage_status",
    "plan_hash",
    "title_b64",
    "body_b64",
  ]);
  assert.equal(decodedDispatchPlan.source_tip_sha, dispatchContext.sourceTipSha);
  assert.equal(decodedDispatchPlan.source_ref, "develop");
  assert.equal(
    decodedDispatchPlan.source_lineage_status,
    dispatchContext.sourceLineageStatus,
  );
  assert.equal(
    Buffer.from(decodedDispatchPlan.title_b64, "base64").toString("utf8"),
    "fixture title",
  );
  assert.equal(
    Buffer.from(decodedDispatchPlan.body_b64, "base64").toString("utf8"),
    "fixture body",
  );
  assert.deepEqual(
    promotionDispatchArgs(dispatchRequest.endpoint, "/tmp/dispatch.json"),
    ["api", "--method", "POST", dispatchRequest.endpoint, "--input", "/tmp/dispatch.json"],
  );
  let dispatchInvocation = null;
  assert.deepEqual(
    dispatchPromotionResolution(
      dispatchRequest,
      "fixture-actions-token",
      (command, args, options) => {
        dispatchInvocation = { command, args, token: options.env.GH_TOKEN };
        return { ok: true, status: 0, out: "", err: "" };
      },
    ),
    { ok: true },
  );
  assert.equal(dispatchInvocation.command, "gh");
  assert.equal(dispatchInvocation.token, "fixture-actions-token");
  assert.equal(dispatchInvocation.args[0], "api");
  assert.equal(dispatchInvocation.args.includes(dispatchRequest.endpoint), true);
  const oversizedDispatch = buildPromotionDispatchRequest(
    "lopugit/thingtime",
    dispatchContext,
    "e".repeat(40),
    "fixture title",
    "x".repeat(50_000),
  );
  assert.equal(oversizedDispatch.ok, false);
  assert.match(oversizedDispatch.error, /24,000-byte bound/);
  const oversizedTitleDispatch = buildPromotionDispatchRequest(
    "lopugit/thingtime",
    dispatchContext,
    "e".repeat(40),
    "🥰".repeat(65),
    "fixture body",
  );
  assert.equal(oversizedTitleDispatch.ok, false);
  assert.match(oversizedTitleDispatch.error, /256-byte bound/);
  assert.deepEqual(exactReservationPushArgs(dispatchContext.branch), [
    "push",
    `--force-with-lease=refs/heads/${dispatchContext.branch}:`,
    "origin",
    `HEAD:refs/heads/${dispatchContext.branch}`,
  ]);
  assert.deepEqual(exactReservationDeleteArgs(dispatchContext.branch, "e".repeat(40)), [
    "push",
    `--force-with-lease=refs/heads/${dispatchContext.branch}:${"e".repeat(40)}`,
    "origin",
    `:refs/heads/${dispatchContext.branch}`,
  ]);

  const attestationFixture = {
    v: 1,
    source_pr: 193,
    base_ref: "main",
    base_sha: "a".repeat(40),
    branch: dispatchContext.branch,
    source_tip_sha: "9".repeat(40),
    source_start_sha: "b".repeat(40),
    source_end_sha: "c".repeat(40),
    source_lineage_status: "review-required-ambiguous",
    plan_hash: "d".repeat(64),
    reservation_sha: "e".repeat(40),
    head_sha: "f".repeat(40),
    conflict_paths: [],
    run_url: "https://github.com/lopugit/thingtime/actions/runs/123",
  };
  const encodedAttestation = Buffer.from(JSON.stringify(attestationFixture), "utf8")
    .toString("base64url");
  assert.deepEqual(
    parsePromotionResolutionAttestations(
      `resolved\n<!-- thingtime-ai-promotion-resolved:v1 ${encodedAttestation} -->`,
    ),
    [attestationFixture],
  );
  assert.deepEqual(
    parsePromotionResolutionAttestations(
      "<!-- thingtime-ai-promotion-resolved:v1 not-json -->",
    ),
    [],
  );

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
  for (const failingApplyIndex of [1, 2]) {
    let sourceTipCommand = 0;
    const operationalPatchCheck = inspectPatchAtSourceTip(
      "fixture patch",
      "b".repeat(40),
      undefined,
      () => {
        const index = sourceTipCommand++;
        if (index === 0) return { ok: true, status: 0, out: "", err: "" };
        if (index === failingApplyIndex) {
          return { ok: false, status: 128, out: "", err: "fatal: fixture apply failure" };
        }
        return { ok: false, status: 1, out: "", err: "patch does not apply" };
      },
    );
    assert.equal(operationalPatchCheck.ok, false);
    assert.match(operationalPatchCheck.error, /failed operationally/);
  }
  const ambiguousLineage = inspectSourcePresence(
    "a".repeat(40),
    "b".repeat(40),
    undefined,
    {
      ancestry: () => ({ ok: true, isAncestor: false }),
      plannedPatch: () => ({ ok: true, patch: "fixture patch", patchId: "c".repeat(40), paths: [] }),
      tipInspector: () => ({ ok: true, present: null }),
    },
  );
  assert.equal(ambiguousLineage.ok, false);
  assert.equal(ambiguousLineage.sourceLineageStatus, "review-required-ambiguous");
  assert.match(ambiguousLineage.error, /source-lineage safety block/);
  const failedLineageInspection = inspectSourcePresence(
    "a".repeat(40),
    "b".repeat(40),
    undefined,
    {
      ancestry: () => ({ ok: true, isAncestor: false }),
      plannedPatch: () => ({ ok: true, patch: "fixture patch", patchId: "c".repeat(40), paths: [] }),
      tipInspector: () => ({ ok: false, error: "fixture source-tip read failure" }),
    },
  );
  assert.equal(failedLineageInspection.ok, false);
  assert.match(failedLineageInspection.error, /source-tip read failure/);

  const sourcePrs = [
    { number: 10, title: "first", mergeCommit: { oid: "a".repeat(40) } },
    { number: 11, title: "missing", mergeCommit: { oid: "b".repeat(40) } },
    { number: 12, title: "third", mergeCommit: { oid: "c".repeat(40) } },
  ];
  const plans = preflightPromotionPlans(sourcePrs, "d".repeat(40), {
    ensure: (sha) => sha === "b".repeat(40)
      ? { ok: false, error: "fixture object unavailable" }
      : { ok: true, fetched: false },
    sourcePresence: (sha) => ({
      ok: true,
      equivalentSha: sha,
      rewritten: false,
      verifiedAtSourceTip: true,
      sourceLineageStatus: "verified",
    }),
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

  for (const invalidLineageStatus of [undefined, "unexpected-lineage-state"]) {
    const invalidLineagePlans = preflightPromotionPlans([sourcePrs[0]], "d".repeat(40), {
      sourceSha: "e".repeat(40),
      ensure: () => ({ ok: true, fetched: false }),
      ancestry: () => ({ ok: true, isAncestor: false }),
      compute: (sourcePr) => ({ picks: [{ sha: sourcePr.mergeCommit.oid }] }),
      plannedPatch: () => ({ ok: true, patch: "fixture patch" }),
      targetPresence: () => ({ ok: true, present: false }),
      sourcePresence: () => ({
        ok: true,
        equivalentSha: null,
        rewritten: true,
        verifiedAtSourceTip: false,
        sourceLineageStatus: invalidLineageStatus,
      }),
    });
    assert.match(
      invalidLineagePlans.get(10).error,
      /invalid source-lineage classification/,
      "missing or unknown lineage must fail closed during preflight",
    );
  }

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
    created: [], recovered: [], retargeted: [], closed: [], queued: [],
    lineageReview: [], blocked: [], warnings: [], skipped: [],
  };
  let summarizedPartial = null;
  await assert.rejects(
    runWithSummary(
      async () => {
        partialResults.queued.push("fixture conflict handoff");
        throw new Error("fixture fatal");
      },
      partialResults,
      { eligibleCount: 3 },
      (results, count) => { summarizedPartial = { results, count }; },
    ),
    /fixture fatal/,
  );
  assert.equal(summarizedPartial.count, 3);
  assert.deepEqual(summarizedPartial.results.queued, ["fixture conflict handoff"]);
  assert.match(summarizedPartial.results.blocked[0], /fixture fatal/);

  const structuredPlanFailure = computePicks(
    sourcePrs[1],
    { gitRunner: () => ({ ok: false, status: 128, out: "", err: "fatal: bad object" }) },
  );
  assert.match(structuredPlanFailure.error, /cannot inspect merge commit/);

  pathspecAuthorityIntegrationTest(assert);
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

function listSourceIssueComments(number) {
  const pages = ghJson([
    "api", "--paginate",
    `repos/${CFG.repo}/issues/${number}/comments?per_page=100`,
    "--slurp",
  ]) || [];
  return pages.flatMap((page) => Array.isArray(page) ? page : [page]);
}

function promotionPauseStateForRun(sourcePr, context) {
  if (!sourcePrHasLabel(sourcePr, PROMOTION_PAUSE_LABEL)) {
    return { ok: true, paused: false };
  }
  try {
    const comments = listSourceIssueComments(sourcePr.number);
    return {
      ok: true,
      paused: isExactPausedPromotionSnapshot(sourcePr, context, comments),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        `cannot verify the exact automatic-promotion pause for source PR #${sourcePr.number}: ` +
        failureDetail({ err: String(error?.message || error) }),
    };
  }
}

function validateReusablePromotionForRun({
  branchRef,
  actualBranchName,
  expectedBaseRef,
  expectedBaseName,
  sourceTipSha,
  sourcePr,
  cwd,
  plan,
}) {
  const baseShaResult = tryGit(["rev-parse", "--verify", `${expectedBaseRef}^{commit}`], cwd);
  const contextResult = baseShaResult.ok
    ? buildPromotionPlanContext({
        sourcePr,
        // The branch under validation, verbatim: re-deriving would break every
        // legacy pre-uniform reservation the moment naming changed.
        branch: actualBranchName || promotionBranchFor(sourcePr),
        baseRef: expectedBaseName,
        baseSha: baseShaResult.out,
        sourceTipSha,
        plan,
        cwd,
      })
    : { ok: false, error: `cannot resolve exact reusable-branch base: ${failureDetail(baseShaResult)}` };
  if (!contextResult.ok) {
    return {
      ok: false,
      error:
        `cannot build immutable context for reusable promotion branch: ` +
        contextResult.error,
    };
  }
  const options = {
    promotionContext: contextResult.context,
    actualBranchName,
    attestations: null,
  };
  let reusable = validateReusablePromotionBranch(
    branchRef,
    expectedBaseRef,
    sourcePr,
    cwd,
    plan,
    options,
  );
  if (reusable.needsAttestations) {
    let comments;
    try {
      comments = listSourceIssueComments(sourcePr.number);
    } catch (error) {
      return {
        ok: false,
        error:
          `cannot load source-PR attestations for AI-resolved promotion: ` +
          failureDetail({ err: String(error?.message || error) }),
      };
    }
    reusable = validateReusablePromotionBranch(
      branchRef,
      expectedBaseRef,
      sourcePr,
      cwd,
      plan,
      { ...options, attestations: comments },
    );
  }
  return { ...reusable, promotionContext: contextResult.context };
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
    commandRunner = tryRun,
    plannedPatch = readPlannedPatch,
    promotionContext = null,
    actualBranchName = "",
    attestations = null,
  } = {},
) {
  if (promotionContext && actualBranchName) {
    const unresolved = inspectUnresolvedPromotionReservationHead(
      branchRef,
      sourcePr,
      promotionContext.branch,
      cwd,
      gitRunner,
    );
    if (!unresolved.ok) return unresolved;
    if (unresolved.present) {
      if (actualBranchName !== promotionContext.branch) {
        return {
          ok: false,
          error: `reserved promotion must use canonical branch \`${promotionContext.branch}\``,
        };
      }
      const expected = expectedReservationTrailers(promotionContext);
      const exact = unresolved.parentSha === promotionContext.baseSha &&
        [...expected].every(([key, value]) => unresolved.trailers.get(key) === value);
      if (exact) {
        return {
          ok: true,
          mode: "reservation",
          reservationSha: unresolved.reservationSha,
        };
      }
      return {
        ok: false,
        staleReservation: true,
        reservationSha: unresolved.reservationSha,
        error:
          "unresolved reservation belongs to an older base, source endpoint, or immutable plan",
      };
    }
  }
  const descended = ancestry(expectedBaseRef, branchRef, cwd, gitRunner);
  if (!descended.ok) return descended;
  if (!descended.isAncestor) {
    return {
      ok: false,
      error: `promotion branch is not based on current expected base \`${expectedBaseRef}\``,
    };
  }
  if (promotionContext) {
    const reservation = inspectPromotionReservation(
      branchRef,
      expectedBaseRef,
      promotionContext,
      cwd,
      gitRunner,
    );
    if (!reservation.ok) return reservation;
    if (reservation.present) {
      if (!actualBranchName || actualBranchName !== promotionContext.branch) {
        return {
          ok: false,
          error:
            `reserved/AI-resolved promotion must use canonical branch ` +
            `\`${promotionContext.branch}\``,
        };
      }
      if (!reservation.resolved) {
        return {
          ok: true,
          mode: "reservation",
          reservationSha: reservation.reservationSha,
        };
      }
      if (attestations === null) {
        return { ok: false, needsAttestations: true, reservation };
      }
      return validateAiResolvedPromotionBranch(
        branchRef,
        expectedBaseRef,
        promotionContext,
        reservation,
        attestations,
        cwd,
        gitRunner,
        commandRunner,
      );
    }
    if (!actualBranchName || actualBranchName !== promotionContext.branch) {
      return {
        ok: false,
        error:
          `plain promotion branch must use canonical branch ` +
          `\`${promotionContext.branch}\` before it can be reused`,
      };
    }
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

  const actualFiles = commandRunner(
    "git",
    [
      "-c", "core.quotePath=false", "diff", "--name-only", "-z",
      expectedBaseRef, branchRef,
    ],
    { ...EXEC_OPTS, cwd, preserveOutput: true },
  );
  if (!actualFiles.ok) {
    return { ok: false, error: `cannot inspect reusable promotion diff: ${failureDetail(actualFiles)}` };
  }
  const expectedPaths = new Set(expectedPatch.paths);
  const actualPaths = actualFiles.out.split("\0").filter(Boolean);
  if (actualPaths.some((path) => !validPromotionPath(path))) {
    return { ok: false, error: "reusable promotion diff contains a control-character path" };
  }
  const unexpectedPaths = actualPaths.filter(
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
    actualPaths.filter(
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
      const expectedEntry = verificationGit(
        ["ls-tree", "HEAD", "--", literalPathspec(path)],
        verificationWorktree,
      );
      const actualEntry = gitRunner(
        ["ls-tree", branchRef, "--", literalPathspec(path)],
        cwd,
      );
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
    const files = gitRunner(
      ["-c", "core.quotePath=false", "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", commit],
      cwd,
      { preserveOutput: true },
    );
    const changed = files.ok ? files.out.split("\0").filter(Boolean) : [];
    if (
      files.ok && changed.every(validPromotionPath) && changed.length > 0 &&
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
        const blockedStatus = SOURCE_LINEAGE_STATUSES.has(present.sourceLineageStatus)
          ? present.sourceLineageStatus
          : "";
        // NEVER CANCEL. A lineage verdict is a review question, not a dead end.
        // This used to drop the promotion entirely — no branch, no worker, no
        // PR, the verdict visible only in a run log — which is how #211 (the
        // conversion of `main` to thin listeners) went a full day unnoticed.
        // The plan is kept for Lopu: because the status is not `verified`,
        // `sourceLineageReviewRequired` routes it through the
        // trusted AI worker, and the PR it opens carries the
        // `source-lineage-unverified` label plus a body that tells the reviewer
        // exactly what could not be proven. The safety property is unchanged —
        // nothing merges without a human — while the failure mode changes from
        // "silently nothing" to "a PR you can reject".
        //
        // Operational failures are NOT lineage verdicts (no status is set):
        // there the patch state is genuinely unknown, so handing it to an AI
        // would be inventing an answer. Those stay errors, stay visible through
        // the stand-aside notice on the source PR, and are retried next run.
        if (blockedStatus && blockedStatus !== "verified") {
          plans.set(pr.number, {
            ...computed,
            inTarget: false,
            recovered: available.fetched,
            sourceLineageStatus: blockedStatus,
            sourceLineageReviewRequired: true,
            sourceLineageDetail: present.error,
          });
          continue;
        }
        plans.set(pr.number, {
          error: present.error,
          recovered: available.fetched,
        });
        continue;
      }
      if (!SOURCE_LINEAGE_STATUSES.has(present.sourceLineageStatus)) {
        plans.set(pr.number, {
          error: "source inspection returned an invalid source-lineage classification",
          recovered: available.fetched,
        });
        continue;
      }
      const lineageStatus = present.sourceLineageStatus;
      if (lineageStatus !== "verified") {
        // Same never-cancel rule as above, for an inspector that reports a
        // non-verified status without failing outright.
        plans.set(pr.number, {
          ...computed,
          inTarget: false,
          recovered: available.fetched,
          sourceEquivalent: present.equivalentSha,
          sourceRewritten: present.rewritten,
          sourceLineageStatus: lineageStatus,
          sourceLineageReviewRequired: true,
          sourceLineageDetail:
            "only a patch proven present at the current source tip promotes without review",
        });
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
        sourceLineageStatus: lineageStatus,
        sourceLineageReviewRequired: lineageStatus !== "verified",
        sourceLineageDetail: present.sourceLineageDetail || "",
        sourceTipSha: sourceSha,
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

export function sortPromotionCandidates(prs) {
  return prs.sort((a, b) =>
    Date.parse(a.mergedAt || "") - Date.parse(b.mergedAt || "") || a.number - b.number,
  );
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
        const paths = unmerged.out.split("\n").filter(Boolean).slice(0, 200);
        return { status: "conflict", paths, detail: paths.slice(0, 20).join(", ") };
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
let sourceLineageLabelEnsured = false;
function ensurePromotionLabel() {
  if (labelEnsured || !CFG.promotionLabel) return labelEnsured;
  const res = tryGh(["label", "create", CFG.promotionLabel, ...repoFlag(),
    "--color", "5319e7", "--force",
    "--description", "Automated develop → main promotion PR"]);
  labelEnsured = res.ok;
  return labelEnsured;
}

function ensureSourceLineageReviewLabel(token = "") {
  if (sourceLineageLabelEnsured) return true;
  const args = [
    "label", "create", SOURCE_LINEAGE_REVIEW_LABEL, ...repoFlag(),
    "--color", "b60205", "--force",
    "--description", "Historical source intent must be reviewed before promotion",
  ];
  const result = token
    ? tryRun("gh", args, { ...EXEC_OPTS, env: { ...process.env, GH_TOKEN: token } })
    : tryGh(args);
  sourceLineageLabelEnsured = result.ok;
  return sourceLineageLabelEnsured;
}
function promotionBody(pr, groupKey, position, groupPrs, statusFor, plan = {}) {
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
  if (sourceLineageReviewRequired(plan)) {
    const status = sourceLineageStatus(plan);
    lines.push(
      "",
      "## ⚠️ Source-lineage review required",
      "",
      `**Do not merge this promotion unless restoring the historical source change is intended.**`,
      "",
      sourceLineageReason(status),
      "",
      `The workflow recovered and re-applied source PR #${pr.number}'s exact historical patch deterministically. ` +
        "A model-authored release analysis is posted as a comment on this promotion: it examines main, develop, and github-actions history plus the PR inventory, infers whether this change still belongs, and names any base-only work the replay would override (with recommended follow-up PRs). It is advisory — the replay content itself never comes from a model.",
      "A reviewer must compare this candidate with current product intent before merging it to `main`.",
      "",
      `Lineage status: \`${status}\` · current source tip was checked automatically.`,
      "",
      "<!-- thingtime-promotion-source-lineage:v1 -->",
    );
  }
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

function promotionConflictReviewBody(body, context) {
  const review = [
    "## Automatic conflict-resolution review",
    "",
    `- The exact source patch conflicted with \`${context.baseRef}\`, so the trusted AI`,
    "  promotion resolver produced this branch automatically instead of leaving manual commands.",
    "- Its write scope was limited to non-Graphify paths already changed by the source PR;",
    "  Graphify output was handled as derived data, and unresolved conflict markers were rejected.",
    `- A \`github-actions[bot]\` comment on source PR #${context.sourcePr} attests the exact`,
    "  base, source endpoints, reservation commit, final head, plan hash, and resolver run.",
    ...(sourceLineageReviewRequired(context)
      ? [
          `- The separate \`${SOURCE_LINEAGE_REVIEW_LABEL}\` warning concerns whether the historical`,
          "  feature is still intended; AI conflict resolution does not clear or answer that review.",
        ]
      : []),
    "- Please review the resolved diff before merging; no manual branch repair is required.",
    "",
  ].join("\n");
  return body.replace("\n---\n", `\n${review}\n---\n`);
}

function promotionWorkerReviewBody(body, context) {
  return promotionConflictReviewBody(body, context);
}

function createPromotionPr({ branch, base, title, body, token = "", sourceLineage = "" }) {
  if (!SOURCE_LINEAGE_STATUSES.has(sourceLineage)) {
    return { ok: false, err: "promotion PR is missing a valid source-lineage classification" };
  }
  const bodyFile = join(os.tmpdir(), `promotion-body-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(bodyFile, body);
  try {
    const args = ["pr", "create", ...repoFlag(),
      "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile];
    if (ensurePromotionLabel()) args.push("--label", CFG.promotionLabel);
    if (sourceLineage !== "verified" && ensureSourceLineageReviewLabel(token)) {
      args.push("--label", SOURCE_LINEAGE_REVIEW_LABEL);
    }
    const created = token
      ? tryRun("gh", args, { ...EXEC_OPTS, env: { ...process.env, GH_TOKEN: token } })
      : tryGh(args);
    return created.ok
      ? { ok: true, url: created.out.split("\n").pop() }
      : { ok: false, err: failureDetail(created) };
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
  section("Queued for trusted promotion worker", results.queued);
  section("Source-lineage review required", results.lineageReview);
  section("Blocked", results.blocked);
  section("Warnings", results.warnings);
  section("Skipped", results.skipped);
  if (!results.created.length && !results.queued.length && !results.lineageReview.length && !results.blocked.length) {
    md.push("Nothing new to promote. ✅", "");
  }
  const text = md.join("\n");
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
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
  // Each target pass may only see its own promotions. Without this, the
  // second pass finds the first pass's PR under the same source marker and
  // concludes the work is already promoted.
  const promotionPrs = listPromotionPrs().filter(promotionBelongsToPass);
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
    if (plan?.sourceLineageReviewRequired) {
      results.lineageReview.push(
        `#${pr.number} — exact historical patch recovered, but source lineage is ` +
        `\`${plan.sourceLineageStatus}\`: ${sourceLineageReason(plan.sourceLineageStatus)} ` +
        "Lopu will create a reviewable candidate instead of treating it as verified.",
      );
    } else if (plan?.sourceRewritten) {
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
      if (!CFG.dryRun && sourceLineageReviewRequired(loaded.plan)) {
        const warned = finalizeSourceLineageMetadata(
          loaded.sourcePr,
          promotion.number,
          loaded.plan,
        );
        if (!warned.ok) {
          results.warnings.push(
            `External promotion #${promotion.number} lineage warning repair deferred: ${warned.error}`,
          );
        }
      }
      let available = ensureRemoteBranchAvailable(promotion.headRefName);
      if (!available.ok) return available;
      let reusable = validateReusablePromotionForRun({
        branchRef: available.ref,
        actualBranchName: promotion.headRefName,
        expectedBaseRef,
        expectedBaseName,
        sourceTipSha: sourceSha,
        sourcePr: loaded.sourcePr,
        cwd: process.cwd(),
        plan: loaded.plan,
      });
      if (!reusable.ok) {
        return {
          ok: false,
          error: `external promotion #${promotion.number} is unsafe to reuse: ${reusable.error}`,
        };
      }
      if (reusable.mode === "reservation") {
        return {
          ok: false,
          error: `external promotion #${promotion.number} is still awaiting its trusted AI resolution`,
        };
      }
      if (
        reusable.mode === "ai-resolved-checkpoint-pending" ||
        reusable.mode === "ai-resolved-checkpoint-finalize"
      ) {
        if (CFG.dryRun) {
          return {
            ok: false,
            error:
              `external promotion #${promotion.number} needs review-checkpoint recovery; ` +
              "the dry run deferred its dependents without mutating the branch",
          };
        }
        const recoveryRoot = mkdtempSync(
          join(process.env.RUNNER_TEMP || os.tmpdir(), "promote-external-recovery-"),
        );
        const recoveryWorktree = join(recoveryRoot, "wt");
        let added = false;
        try {
          git(["worktree", "add", "--detach", recoveryWorktree, available.ref]);
          added = true;
          const recovered = recoverPromotionReviewCheckpoint(
            recoveryWorktree,
            loaded.sourcePr,
            reusable.promotionContext,
            reusable,
          );
          if (!recovered.ok) {
            return {
              ok: false,
              error:
                `external promotion #${promotion.number} review-checkpoint recovery failed: ` +
                recovered.error,
            };
          }
          results.recovered.push(
            `External promotion #${promotion.number} — completed/finalized review checkpoint ` +
            `\`${recovered.headSha}\` before extending its stack.`,
          );
        } finally {
          if (added) tryGit(["worktree", "remove", "--force", recoveryWorktree]);
          rmSync(recoveryRoot, { recursive: true, force: true });
        }
        available = ensureRemoteBranchAvailable(promotion.headRefName);
        if (!available.ok) return available;
        reusable = validateReusablePromotionForRun({
          branchRef: available.ref,
          actualBranchName: promotion.headRefName,
          expectedBaseRef,
          expectedBaseName,
          sourceTipSha: sourceSha,
          sourcePr: loaded.sourcePr,
          cwd: process.cwd(),
          plan: loaded.plan,
        });
        if (!reusable.ok || reusable.mode !== "ai-resolved") {
          return {
            ok: false,
            error:
              `external promotion #${promotion.number} did not validate as final after checkpoint recovery: ` +
              `${reusable.error || reusable.mode || "unknown state"}`,
          };
        }
      }
      if (reusable.mode === "ai-resolved" && !CFG.dryRun) {
        const finalized = finalizeAiPromotionMetadata(
          loaded.sourcePr,
          promotion.number,
          reusable.promotionContext,
          reusable.attestation,
        );
        if (!finalized.ok) {
          results.warnings.push(
            `External promotion #${promotion.number} is content-valid, but its bot review metadata ` +
            `could not be repaired yet: ${finalized.error}`,
          );
        }
      }
      if (!CFG.dryRun && !reusable.mode?.startsWith("ai-resolved") && reusable.mode !== "reservation") {
        const lineage = finalizeSourceLineageMetadata(
          loaded.sourcePr,
          promotion.number,
          loaded.plan,
        );
        if (!lineage.ok) {
          results.warnings.push(
            `External promotion #${promotion.number} source-lineage metadata ` +
            `could not be repaired yet: ${lineage.error}`,
          );
        }
      }
      if (sourceLineageReviewRequired(loaded.plan)) {
        return {
          ok: false,
          error:
            `external promotion #${promotion.number} requires explicit source-lineage review ` +
            `before later members can extend its stack`,
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

  // Metadata and checkpoint recovery must not depend on the source PR still
  // fitting inside LOOKBACK. A transient API outage can happen after a valid
  // branch/PR is published, so repair every open, bot-attested promotion
  // idempotently before planning new stack members.
  if (!CFG.dryRun) {
    for (const promotion of promotionPrs.filter((candidate) => candidate.state === "OPEN")) {
      try {
        const loaded = loadExternalPromotionPlan(promotion);
        // NEVER CANCEL. An open promotion whose source lineage degrades used to
        // be CLOSED here, pre-empting review of a PR a human had already been
        // given. It is now left open and handled by Lopu's review path
        // immediately below: `sourceLineageReviewRequired` re-stamps the
        // metadata and the `source-lineage-unverified` label, so the reviewer
        // sees the downgraded verdict on the PR rather than losing the PR.
        if (loaded.error || loaded.plan?.error || loaded.plan?.inTarget) continue;
        if (sourceLineageReviewRequired(loaded.plan)) {
          const warned = finalizeSourceLineageMetadata(
            loaded.sourcePr,
            promotion.number,
            loaded.plan,
          );
          if (!warned.ok) {
            results.warnings.push(
              `Promotion #${promotion.number} lineage warning repair deferred: ${warned.error}`,
            );
          }
        }
        const expectedBaseName = promotion.baseRefName;
        let expectedBaseRef = mainSha;
        if (expectedBaseName !== CFG.target) {
          const base = ensureRemoteBranchAvailable(expectedBaseName);
          if (!base.ok) {
            results.warnings.push(
              `Promotion #${promotion.number} metadata repair deferred: ${base.error}`,
            );
            continue;
          }
          expectedBaseRef = base.ref;
        }
        let available = ensureRemoteBranchAvailable(promotion.headRefName);
        if (!available.ok) {
          results.warnings.push(
            `Promotion #${promotion.number} metadata repair deferred: ${available.error}`,
          );
          continue;
        }
        let reusable = validateReusablePromotionForRun({
          branchRef: available.ref,
          actualBranchName: promotion.headRefName,
          expectedBaseRef,
          expectedBaseName,
          sourceTipSha: sourceSha,
          sourcePr: loaded.sourcePr,
          cwd: process.cwd(),
          plan: loaded.plan,
        });
        let comments = [];
        try {
          comments = listSourceIssueComments(loaded.sourcePr.number);
        } catch {
          // The ordinary warning below remains sufficient; never mutate a
          // stale branch unless its exact bot attestation can be loaded.
        }
        const activeRetirement = findBotPromotionRetirement(
          { ...promotion, state: "CLOSED" },
          loaded.sourcePr,
          comments,
        );
        const availableHead = tryGit([
          "rev-parse", "--verify", `${available.ref}^{commit}`,
        ]);
        if (
          activeRetirement &&
          availableHead.ok &&
          retiredBranchCleanupDisposition(activeRetirement, availableHead.out) === "preserve-moved"
        ) {
          const cancelled = cancelPromotionRetirement(
            promotion,
            loaded.sourcePr,
            `The promotion PR was already open and its branch moved to \`${availableHead.out}\`. ` +
              "The branch was preserved and future PR closure remains a reviewer decision.",
          );
          if (cancelled.ok) {
            results.recovered.push(
              `Promotion #${promotion.number} — cleared stale bot-retirement state after ` +
              `preserving newer branch \`${availableHead.out}\`.`,
            );
          } else {
            results.warnings.push(
              `Promotion #${promotion.number} stale retirement marker cleanup deferred: ${cancelled.error}`,
            );
          }
          continue;
        }
        if (!reusable.ok && reusable.promotionContext) {
          const exactRetirement = findBotPromotionRetirement(
            { ...promotion, state: "CLOSED" },
            loaded.sourcePr,
            comments,
          );
          const stale = validateStalePendingAiPromotionBranch(
            available.ref,
            reusable.promotionContext,
            comments,
            process.cwd(),
          );
          if (stale.ok && stale.present && (!exactRetirement || exactRetirement.retired_head === stale.liveHead)) {
            const retirement = {
              v: 1,
              source_pr: loaded.sourcePr.number,
              promotion_pr: promotion.number,
              branch: promotion.headRefName,
              retired_head: stale.liveHead,
              reservation_sha: stale.attestation.reservation_sha,
              plan_hash: stale.staleContext.planHash,
            };
            const retirementRecorded = upsertBotIssueComment(
              loaded.sourcePr.number,
              "thingtime-ai-promotion-retired:v1",
              [
                `🔄 Promotion #${promotion.number} is being retired because its base moved ` +
                  "before the automatic review-checkpoint completed.",
                "",
                "This durable bot marker allows a later run to resume the replacement safely if cleanup succeeds but this run stops early.",
                "",
                promotionRetirementMarker(retirement),
              ].join("\n"),
            );
            if (!retirementRecorded.ok) {
              results.warnings.push(
                `Promotion #${promotion.number} stale snapshot cleanup deferred because its ` +
                `durable retirement marker could not be recorded: ${retirementRecorded.error}`,
              );
              continue;
            }
            const closed = withActionsToken([
              "pr", "close", String(promotion.number), ...repoFlag(),
              "--comment",
              "The automatic promotion base moved before its review-checkpoint completed. " +
                "This exact bot-attested pending snapshot is being retired and replanned; " +
                "no user-authored branch state will be overwritten.",
            ]);
            if (!closed.ok) {
              results.warnings.push(
                `Promotion #${promotion.number} stale snapshot cleanup deferred: ${closed.error}`,
              );
              continue;
            }
            const deleted = exactBranchDeleteWithActionsToken(
              process.cwd(),
              promotion.headRefName,
              stale.liveHead,
            );
            if (!deleted.ok) {
              withActionsToken([
                "pr", "reopen", String(promotion.number), ...repoFlag(),
              ]);
              results.warnings.push(
                `Promotion #${promotion.number} moved during stale cleanup; its PR was reopened ` +
                `and no branch ref was changed: ${deleted.error}`,
              );
              continue;
            }
            promoBySource.delete(loaded.sourcePr.number);
            remoteBranches.delete(promotion.headRefName);
            promotion.state = "STALE_AI_CLEANED";
            if (!eligible.some((candidate) => candidate.number === loaded.sourcePr.number)) {
              eligible.push(loaded.sourcePr);
              plans.set(loaded.sourcePr.number, loaded.plan);
            }
            results.recovered.push(
              `Promotion #${promotion.number} — retired stale pending AI snapshot ` +
              `\`${stale.liveHead}\` after its base moved; source PR #${loaded.sourcePr.number} ` +
              "was re-queued against the current base without repeating or preserving stale state.",
            );
            upsertBotIssueComment(
              loaded.sourcePr.number,
              "thingtime-ai-promotion-status:v1",
              [
                `🔄 Promotion #${promotion.number} was retired because its base moved before ` +
                  "the review-checkpoint completed.",
                "",
                "The source PR has been re-queued automatically against the current promotion base.",
                "<!-- thingtime-ai-promotion-status:v1 -->",
              ].join("\n"),
            );
          }
          continue;
        }
        if (!reusable.ok || !reusable.mode?.startsWith("ai-resolved")) continue;
        if (
          reusable.mode === "ai-resolved-checkpoint-pending" ||
          reusable.mode === "ai-resolved-checkpoint-finalize"
        ) {
          const recoveryRoot = mkdtempSync(
            join(process.env.RUNNER_TEMP || os.tmpdir(), "promote-maintenance-recovery-"),
          );
          const recoveryWorktree = join(recoveryRoot, "wt");
          let added = false;
          try {
            git(["worktree", "add", "--detach", recoveryWorktree, available.ref]);
            added = true;
            const recovered = recoverPromotionReviewCheckpoint(
              recoveryWorktree,
              loaded.sourcePr,
              reusable.promotionContext,
              reusable,
            );
            if (!recovered.ok) {
              results.warnings.push(
                `Promotion #${promotion.number} review-checkpoint recovery deferred: ${recovered.error}`,
              );
              continue;
            }
            results.recovered.push(
              `Promotion #${promotion.number} — completed/finalized review checkpoint ` +
              `\`${recovered.headSha}\` during the all-open maintenance pass.`,
            );
          } finally {
            if (added) tryGit(["worktree", "remove", "--force", recoveryWorktree]);
            rmSync(recoveryRoot, { recursive: true, force: true });
          }
          available = ensureRemoteBranchAvailable(promotion.headRefName);
          if (!available.ok) continue;
          reusable = validateReusablePromotionForRun({
            branchRef: available.ref,
            actualBranchName: promotion.headRefName,
            expectedBaseRef,
            expectedBaseName,
            sourceTipSha: sourceSha,
            sourcePr: loaded.sourcePr,
            cwd: process.cwd(),
            plan: loaded.plan,
          });
        }
        if (reusable.ok && reusable.mode === "ai-resolved") {
          const finalized = finalizeAiPromotionMetadata(
            loaded.sourcePr,
            promotion.number,
            reusable.promotionContext,
            reusable.attestation,
          );
          if (!finalized.ok) {
            results.warnings.push(
              `Promotion #${promotion.number} bot review metadata repair deferred: ${finalized.error}`,
            );
          }
        } else if (reusable.ok && reusable.mode !== "reservation") {
          const lineage = finalizeSourceLineageMetadata(
            loaded.sourcePr,
            promotion.number,
            loaded.plan,
          );
          if (!lineage.ok) {
            results.warnings.push(
              `Promotion #${promotion.number} source-lineage metadata repair ` +
              `deferred: ${lineage.error}`,
            );
          }
        }
      } catch (error) {
        results.warnings.push(
          `Promotion #${promotion.number} maintenance recovery failed safely: ` +
          failureDetail({ err: String(error?.message || error) }),
        );
      }
    }
    for (const promotion of promotionPrs.filter((candidate) => candidate.state === "CLOSED")) {
      const loaded = loadExternalPromotionPlan(promotion);
      if (loaded.error || loaded.plan?.error || loaded.plan?.inTarget) continue;
      let comments;
      try {
        comments = listSourceIssueComments(loaded.sourcePr.number);
      } catch (error) {
        results.warnings.push(
          `Promotion #${promotion.number} retirement recovery deferred: ` +
          failureDetail({ err: String(error?.message || error) }),
        );
        continue;
      }
      const retirement = findBotPromotionRetirement(
        promotion,
        loaded.sourcePr,
        comments,
      );
      if (!retirement) continue;
      const liveBranch = withActionsToken([
        "api", `repos/${CFG.repo}/git/ref/heads/${encodeURIComponent(promotion.headRefName)}`,
        "--jq", ".object.sha",
      ]);
      const missingBranch =
        !liveBranch.ok && /(?:HTTP\s+404|Not Found)/i.test(liveBranch.error || "");
      if (!liveBranch.ok && !missingBranch) {
        results.warnings.push(
          `Promotion #${promotion.number} retirement recovery could not inspect its branch: ` +
          liveBranch.error,
        );
        continue;
      }
      const disposition = retiredBranchCleanupDisposition(
        retirement,
        liveBranch.ok ? liveBranch.out : "",
      );
      if (disposition === "preserve-moved") {
        const reopened = withActionsToken([
          "pr", "reopen", String(promotion.number), ...repoFlag(),
        ]);
        if (!reopened.ok) {
          results.warnings.push(
            `Promotion #${promotion.number} retirement recovery preserved user/newer branch state ` +
            `\`${liveBranch.out}\`, but its bot-closed PR could not yet be reopened: ${reopened.error}`,
          );
          continue;
        }
        promotion.state = "OPEN";
        const cancelled = cancelPromotionRetirement(
          promotion,
          loaded.sourcePr,
          `The branch moved to \`${liveBranch.out}\` after the bot initiated cleanup. ` +
            "The branch was preserved and the PR reopened; any later closure is treated as an intentional review decision.",
        );
        if (!cancelled.ok) {
          results.warnings.push(
            `Promotion #${promotion.number} was reopened after its branch moved, but its durable ` +
            `retirement marker still needs cleanup: ${cancelled.error}`,
          );
        } else {
          results.recovered.push(
            `Promotion #${promotion.number} — reopened bot-closed PR and cancelled stale retirement ` +
            `after preserving newer branch \`${liveBranch.out}\`.`,
          );
        }
        continue;
      }
      if (disposition === "delete-exact") {
        const deleted = exactBranchDeleteWithActionsToken(
          process.cwd(),
          promotion.headRefName,
          retirement.retired_head,
        );
        if (!deleted.ok) {
          results.warnings.push(
            `Promotion #${promotion.number} retirement recovery deferred: ${deleted.error}`,
          );
          continue;
        }
        remoteBranches.delete(promotion.headRefName);
      }
      promoBySource.delete(loaded.sourcePr.number);
      promotion.state = "STALE_AI_CLEANED";
      if (!eligible.some((candidate) => candidate.number === loaded.sourcePr.number)) {
        eligible.push(loaded.sourcePr);
        plans.set(loaded.sourcePr.number, loaded.plan);
      }
      results.recovered.push(
        `Promotion #${promotion.number} — resumed durable replan for bot-retired snapshot ` +
        `\`${retirement.retired_head}\`; source PR #${loaded.sourcePr.number} was re-queued ` +
        "against the current base.",
      );
    }
  }

  sortPromotionCandidates(eligible);
  state.eligibleCount = eligible.length;

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
          // The verdict has to reach the PR, not just this run's summary.
          const noted = noteSourceStandAside(pr, {
            reason: plan.error,
            heldBehind: Math.max(0, group.length - index - 1),
          });
          if (!noted.ok) {
            results.warnings.push(
              `could not post the stand-aside notice on #${pr.number}: ${noted.error}`,
            );
          }
          break;
        }
        if (CFG.requirePathPrefixes.length && Array.isArray(plan.picks) && plan.picks.length) {
          const planned = readPlannedPatch(plan.picks, undefined, {});
          if (!planned.ok) {
            results.blocked.push(...groupFailureMessages(
              group, index, `lane path guard could not read the planned patch: ${planned.error}`,
            ));
            break;
          }
          const outside = (planned.paths || []).filter(
            (path) => !CFG.requirePathPrefixes.some((prefix) => path.startsWith(prefix)),
          );
          if (outside.length) {
            skip(pr, `outside this lane's path prefixes (${CFG.requirePathPrefixes.join(", ")}): ${outside.slice(0, 3).join(", ")}${outside.length > 3 ? ", …" : ""}`);
            break;
          }
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
          if (!CFG.dryRun && sourceLineageReviewRequired(plan)) {
            const warned = finalizeSourceLineageMetadata(pr, record.number, plan);
            if (!warned.ok) {
              results.warnings.push(
                `#${pr.number} — promotion #${record.number} lineage warning ` +
                `repair was deferred: ${warned.error}`,
              );
            }
          }
          const expectedBaseRef = git(["rev-parse", "HEAD"], worktree);
          const checked = checkoutRemoteBranch(worktree, record.headRefName);
          if (!checked.ok) {
            results.blocked.push(...groupFailureMessages(group, index, checked.error));
            break;
          }
          const reusable = validateReusablePromotionForRun({
            branchRef: "HEAD",
            actualBranchName: record.headRefName,
            expectedBaseRef,
            expectedBaseName: baseName,
            sourceTipSha: sourceSha,
            sourcePr: pr,
            cwd: worktree,
            plan,
          });
          if (!reusable.ok) {
            results.blocked.push(...groupFailureMessages(group, index, reusable.error));
            break;
          }
          if (reusable.mode === "reservation") {
            const pause = promotionPauseStateForRun(pr, reusable.promotionContext);
            if (!pause.ok) {
              results.blocked.push(...groupFailureMessages(group, index, pause.error));
              break;
            }
            if (pause.paused) {
              results.blocked.push(...groupFailureMessages(
                group,
                index,
                `automatic promotion resolution is paused for immutable plan ` +
                  `\`${reusable.promotionContext.planHash}\`; remove the ` +
                  `\`${PROMOTION_PAUSE_LABEL}\` label from source PR #${pr.number} to retry automatically`,
              ));
              break;
            }
            const title = promotionTitleFor(pr, group.key, position);
            const body = promotionWorkerReviewBody(
              promotionBody(pr, group.key, position, group.prs, statusFor, plan),
              reusable.promotionContext,
            );
            if (!CFG.dryRun) {
              const redispatched = redispatchPromotionReservation(
                reusable.promotionContext,
                reusable.reservationSha,
                title,
                body,
              );
              if (!redispatched.ok) {
                results.blocked.push(...groupFailureMessages(
                  group,
                  index,
                  `valid reservation could not be re-dispatched safely: ${redispatched.error}`,
                ));
                break;
              }
            }
            results.queued.push(
              `#${pr.number} (**${pr.title}**) already has valid reservation ` +
              `\`${reusable.reservationSha}\` on \`${record.headRefName}\`; ` +
              `${CFG.dryRun ? "a dry run would re-dispatch" : "re-dispatched"} the same immutable ` +
              "trusted-resolver handoff without creating another branch.",
            );
            break;
          }
          let finalAttestation = reusable.attestation;
          if (
            reusable.mode === "ai-resolved-checkpoint-pending" ||
            reusable.mode === "ai-resolved-checkpoint-finalize"
          ) {
            if (CFG.dryRun) {
              results.recovered.push(
                `(dry-run) would finish the prior checkpoint recovery for promotion #${record.number}.`,
              );
            } else {
              const recovered = recoverPromotionReviewCheckpoint(
                worktree,
                pr,
                reusable.promotionContext,
                reusable,
              );
              if (!recovered.ok) {
                results.blocked.push(...groupFailureMessages(
                  group,
                  index,
                  `review-checkpoint recovery failed safely: ${recovered.error}`,
                ));
                break;
              }
              finalAttestation = recovered.attestation;
              results.recovered.push(
                `#${pr.number} — completed/finalized the approval-gated review checkpoint ` +
                `\`${recovered.headSha}\` without repeating the AI round.`,
              );
            }
          }
          if (!CFG.dryRun && reusable.mode?.startsWith("ai-resolved")) {
            const finalized = finalizeAiPromotionMetadata(
              pr,
              record.number,
              reusable.promotionContext,
              finalAttestation,
            );
            if (!finalized.ok) {
              results.warnings.push(
                `#${pr.number} — promotion content is verified, but bot review metadata ` +
                `could not be repaired yet: ${finalized.error}`,
              );
            }
          }
          if (!CFG.dryRun && !reusable.mode?.startsWith("ai-resolved")) {
            const lineage = finalizeSourceLineageMetadata(pr, record.number, plan);
            if (!lineage.ok) {
              results.warnings.push(
                `#${pr.number} — promotion #${record.number} is content-valid, but its ` +
                `source-lineage metadata could not be repaired yet: ${lineage.error}`,
              );
            }
          }
          skip(pr, `promotion #${record.number} already open`);
          if (sourceLineageReviewRequired(plan)) {
            results.lineageReview.push(
              `#${pr.number} — promotion #${record.number} remains open for explicit source-intent review; ` +
              "later members of this stack were deferred.",
            );
            break;
          }
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
          // A prior clean run may have pushed the branch before PR creation;
          // a conflict run leaves an exact empty reservation until the trusted
          // resolver publishes and attests the AI-resolved result.
          const expectedBaseRef = git(["rev-parse", "HEAD"], worktree);
          const checked = checkoutRemoteBranch(worktree, existingBranch);
          if (!checked.ok) {
            results.blocked.push(...groupFailureMessages(group, index, checked.error));
            break;
          }
          const reusable = validateReusablePromotionForRun({
            branchRef: "HEAD",
            actualBranchName: existingBranch,
            expectedBaseRef,
            expectedBaseName: baseName,
            sourceTipSha: sourceSha,
            sourcePr: pr,
            cwd: worktree,
            plan,
          });
          let removedStaleReservation = false;
          if (!reusable.ok) {
            if (!reusable.staleReservation) {
              results.blocked.push(...groupFailureMessages(group, index, reusable.error));
              break;
            }
            if (CFG.dryRun) {
              results.recovered.push(
                `(dry-run) would remove stale exact reservation ` +
                `\`${reusable.reservationSha}\` from \`${existingBranch}\` before replanning #${pr.number}.`,
              );
            } else {
              const removed = tryGit(
                exactReservationDeleteArgs(existingBranch, reusable.reservationSha),
                worktree,
              );
              if (!removed.ok) {
                results.blocked.push(...groupFailureMessages(
                  group,
                  index,
                  `stale reservation cleanup lease was refused; preserving remote state: ${failureDetail(removed)}`,
                ));
                break;
              }
              results.recovered.push(
                `#${pr.number} — removed stale exact reservation ` +
                `\`${reusable.reservationSha}\` from \`${existingBranch}\` before replanning.`,
              );
              remoteBranches.delete(existingBranch);
            }
            git(["checkout", "--detach", expectedBaseRef], worktree);
            removedStaleReservation = true;
          }
          if (!removedStaleReservation && reusable.mode === "reservation") {
            const pause = promotionPauseStateForRun(pr, reusable.promotionContext);
            if (!pause.ok) {
              results.blocked.push(...groupFailureMessages(group, index, pause.error));
              break;
            }
            if (pause.paused) {
              results.blocked.push(...groupFailureMessages(
                group,
                index,
                `automatic promotion resolution is paused for immutable plan ` +
                  `\`${reusable.promotionContext.planHash}\`; remove the ` +
                  `\`${PROMOTION_PAUSE_LABEL}\` label from source PR #${pr.number} to retry automatically`,
              ));
              break;
            }
            const title = promotionTitleFor(pr, group.key, position);
            const body = promotionWorkerReviewBody(
              promotionBody(pr, group.key, position, group.prs, statusFor, plan),
              reusable.promotionContext,
            );
            if (!CFG.dryRun) {
              const redispatched = redispatchPromotionReservation(
                reusable.promotionContext,
                reusable.reservationSha,
                title,
                body,
              );
              if (!redispatched.ok) {
                results.blocked.push(...groupFailureMessages(
                  group,
                  index,
                  `valid reservation could not be re-dispatched safely: ${redispatched.error}`,
                ));
                break;
              }
            }
            results.queued.push(
              `#${pr.number} (**${pr.title}**) already has valid reservation ` +
              `\`${reusable.reservationSha}\` on \`${existingBranch}\`; ` +
              `${CFG.dryRun ? "a dry run would re-dispatch" : "re-dispatched"} the same immutable ` +
              "trusted-resolver handoff without creating another branch.",
            );
            break;
          }
          if (!removedStaleReservation && createdCount >= CFG.maxNewPrs) {
            results.warnings.push(
              `MAX_NEW_PRS=${CFG.maxNewPrs} reached — #${pr.number}${group.key ? ` (and the rest of \`${group.key}\`)` : ""} deferred to the next run.`,
            );
            break;
          }
          let recoveredPromotionNumber = null;
          if (!removedStaleReservation && CFG.dryRun) {
            results.created.push(`(dry-run) would open PR for existing branch \`${existingBranch}\` → \`${baseName}\``);
            createdCount += 1;
          } else if (!removedStaleReservation) {
            const title = promotionTitleFor(pr, group.key, position);
            const plainBody = promotionBody(pr, group.key, position, group.prs, statusFor, plan);
            const body = reusable.mode?.startsWith("ai-resolved")
              ? promotionWorkerReviewBody(plainBody, reusable.promotionContext)
              : plainBody;
            const created = createPromotionPr({
              branch: existingBranch,
              base: baseName,
              title,
              body,
              token: "",
              sourceLineage: sourceLineageStatus(plan),
            });
            if (created.ok) {
              results.created.push(`${created.url} — ${title} (from existing branch)`);
              createdCount += 1;
              recoveredPromotionNumber = promotionNumberFromUrl(created.url);
              // A stale "not promoted" verdict must never outlive its fix.
              clearSourceStandAside(pr, { promotionNumber: recoveredPromotionNumber });
            } else {
              results.blocked.push(...groupFailureMessages(
                group,
                index,
                `PR creation for existing \`${existingBranch}\` failed: ${created.err}`,
              ));
              break;
            }
          }
          if (!removedStaleReservation && !CFG.dryRun && reusable.mode?.startsWith("ai-resolved")) {
            if (!recoveredPromotionNumber) {
              const found = findOpenPromotionNumber(existingBranch);
              if (!found.ok) {
                results.blocked.push(...groupFailureMessages(group, index, found.error));
                break;
              }
              recoveredPromotionNumber = found.number;
            }
            let finalAttestation = reusable.attestation;
            if (
              reusable.mode === "ai-resolved-checkpoint-pending" ||
              reusable.mode === "ai-resolved-checkpoint-finalize"
            ) {
              const recovered = recoverPromotionReviewCheckpoint(
                worktree,
                pr,
                reusable.promotionContext,
                reusable,
              );
              if (!recovered.ok) {
                results.blocked.push(...groupFailureMessages(
                  group,
                  index,
                  `review-checkpoint recovery failed safely: ${recovered.error}`,
                ));
                break;
              }
              finalAttestation = recovered.attestation;
              results.recovered.push(
                `#${pr.number} — completed/finalized review checkpoint ` +
                `\`${recovered.headSha}\` without repeating the AI round.`,
              );
            }
            const finalized = finalizeAiPromotionMetadata(
              pr,
              recoveredPromotionNumber,
              reusable.promotionContext,
              finalAttestation,
            );
            if (!finalized.ok) {
              results.warnings.push(
                `#${pr.number} — created the verified promotion PR, but its bot review metadata ` +
                `could not be repaired yet: ${finalized.error}`,
              );
            }
          }
          if (!removedStaleReservation && !CFG.dryRun && !reusable.mode?.startsWith("ai-resolved")) {
            if (!recoveredPromotionNumber) {
              const found = findOpenPromotionNumber(existingBranch);
              if (!found.ok) {
                results.blocked.push(...groupFailureMessages(group, index, found.error));
                break;
              }
              recoveredPromotionNumber = found.number;
            }
            const lineage = finalizeSourceLineageMetadata(pr, recoveredPromotionNumber, plan);
            if (!lineage.ok) {
              results.warnings.push(
                `#${pr.number} — created the promotion PR, but source-lineage metadata ` +
                `repair was deferred: ${lineage.error}`,
              );
            }
          }
          if (!removedStaleReservation) {
            if (sourceLineageReviewRequired(plan)) {
              results.lineageReview.push(
                `#${pr.number} — recovered promotion branch \`${existingBranch}\` as a ` +
                "source-lineage review candidate; later stack members were deferred.",
              );
              break;
            }
            baseName = existingBranch;
            continue;
          }
        }

        if (plan.warning) results.warnings.push(plan.warning);

        if (createdCount >= CFG.maxNewPrs) {
          results.warnings.push(
            `MAX_NEW_PRS=${CFG.maxNewPrs} reached — #${pr.number}${group.key ? ` (and the rest of \`${group.key}\`)` : ""} deferred to the next run.`,
          );
          break;
        }

        const beforeSha = git(["rev-parse", "HEAD"], worktree);
        const planned = buildPromotionPlanContext({
          sourcePr: pr,
          branch,
          baseRef: baseName,
          baseSha: beforeSha,
          sourceTipSha: sourceSha,
          plan,
          cwd: worktree,
        });
        if (!planned.ok) {
          results.blocked.push(...groupFailureMessages(
            group,
            index,
            `cannot build trusted promotion handoff: ${planned.error}`,
          ));
          break;
        }
        const applied = applyPicks(worktree, plan.picks);
        if (applied.status === "conflict") {
          const title = promotionTitleFor(pr, group.key, position);
          const body = promotionWorkerReviewBody(
            promotionBody(pr, group.key, position, group.prs, statusFor, plan),
            planned.context,
          );
          createdCount += 1; // conflict-resolution handoffs share MAX_NEW_PRS
          if (CFG.dryRun) {
            results.queued.push(
              `(dry-run) would reserve \`${branch}\` at exact base \`${baseName}\` ` +
              `(\`${beforeSha}\`) and dispatch its immutable plan to the trusted AI resolver ` +
              `for #${pr.number} (**${pr.title}**).`,
            );
            if (sourceLineageReviewRequired(plan)) {
              results.lineageReview.push(
                `(dry-run) #${pr.number} would be queued as a source-lineage review candidate ` +
                `with \`${SOURCE_LINEAGE_REVIEW_LABEL}\`.`,
              );
            }
            break;
          }
          const queued = queueTrustedPromotionWorker({
            worktree,
            context: planned.context,
            title,
            body,
            conflictPaths: applied.paths,
          });
          if (!queued.ok) {
            results.blocked.push(...groupFailureMessages(
              group,
              index,
              `automatic AI promotion handoff failed: ${queued.error}`,
            ));
            break;
          }
          remoteBranches.add(branch);
          results.queued.push(
            `#${pr.number} (**${pr.title}**) — reserved \`${branch}\` at exact base ` +
            `\`${baseName}\` (\`${beforeSha}\`) and dispatched the trusted AI resolver; ` +
            `reservation \`${queued.reservationSha}\`.`,
          );
          if (sourceLineageReviewRequired(plan)) {
            results.lineageReview.push(
              `#${pr.number} — queued the exact historical patch for conflict resolution with ` +
              `\`${SOURCE_LINEAGE_REVIEW_LABEL}\`; merging will still require source-intent review.`,
            );
          }
          if (queued.warning) results.warnings.push(queued.warning);
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
          createdCount += 1;
          if (sourceLineageReviewRequired(plan)) {
            results.lineageReview.push(
              `(dry-run) #${pr.number} would open as a source-lineage review candidate with ` +
              `\`${SOURCE_LINEAGE_REVIEW_LABEL}\`; later stack members would be deferred.`,
            );
            break;
          }
          baseName = branch;
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
        const body = promotionBody(pr, group.key, position, group.prs, statusFor, plan);
        const created = createPromotionPr({
          branch,
          base: baseName,
          title,
          body,
          sourceLineage: sourceLineageStatus(plan),
        });
        if (!created.ok) {
          results.blocked.push(`#${pr.number}: pushed \`${branch}\` but PR creation failed: ${created.err} — the next run will open it.`);
          break;
        }
        results.created.push(`${created.url} — ${title}`);
        createdCount += 1;
        remoteBranches.add(branch);
        const promotionNumber = promotionNumberFromUrl(created.url);
        // A stale "not promoted" verdict must never outlive its fix.
        clearSourceStandAside(pr, { promotionNumber });
        if (promotionNumber) {
          const lineage = finalizeSourceLineageMetadata(pr, promotionNumber, plan);
          if (!lineage.ok) {
            results.warnings.push(
              `#${pr.number} — promotion created, but source-lineage metadata repair ` +
              `was deferred: ${lineage.error}`,
            );
          }
        }
        if (CFG.commentOnSource) {
          tryGh(["pr", "comment", String(pr.number), ...repoFlag(),
            "--body", `🚀 Promotion PR for \`${CFG.target}\` opened: ${created.url}`]);
        }
        if (sourceLineageReviewRequired(plan)) {
          results.lineageReview.push(
            `#${pr.number} — opened ${created.url} from the exact historical patch with ` +
            `\`${SOURCE_LINEAGE_REVIEW_LABEL}\`; later stack members were deferred for review.`,
          );
          break;
        }
        baseName = branch;
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
    created: [], recovered: [], retargeted: [], closed: [], queued: [],
    lineageReview: [], blocked: [], warnings: [], skipped: [],
  };
  const state = { eligibleCount: 0, scanCompleted: false };
  // One full pass per configured target. A pass is independent: its own
  // promotion branches, its own promotion records, its own cherry-pick against
  // its own base. A source PR that owes changes to two branches therefore ends
  // up with two promotion PRs, and the pass whose replay does not apply cleanly
  // is handed to the trusted AI worker exactly as a single-target conflict is.
  const targets = promotionTargets();
  await runWithSummary(async () => {
    for (const target of targets) {
      CFG.target = target;
      if (targets.length > 1) {
        console.log(`\n=== Promotion pass: \`${CFG.source}\` → \`${target}\` ===`);
      }
      await runPromotion(results, state);
    }
    CFG.target = CFG.primaryTarget;
  }, results, state);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`::error::${String(error?.stack || error)}`);
    process.exitCode = 1;
  });
}
