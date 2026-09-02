#!/usr/bin/env node
// Deterministic contract tests for resolve-pr-conflicts.yml routing.
//
// The resolver intentionally separates untrusted/external detector runs from
// secret-bearing workers. Keep this model and the source assertions aligned
// with the workflow whenever its trigger or handoff shape changes.
//
// Local validation:
//   node .github/scripts/resolve-pr-conflicts-routing-contract.mjs --self-test

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const WORKFLOW_URL = new URL("../workflows/resolve-pr-conflicts.yml", import.meta.url);
const REBASE_WORKFLOW_URL = new URL("../workflows/rebase-pr-stacks.yml", import.meta.url);
const REBASE_ACTION_URL = new URL("../actions/rebase-conflict-round/action.yml", import.meta.url);
const LOPU_ACTION_URL = new URL("../actions/lopu-agent/action.yml", import.meta.url);
const LOPU_STATUS_URL = new URL("./lopu-pr-status.mjs", import.meta.url);
const LOPU_STATUS_TEST_URL = new URL("./lopu-pr-status.test.mjs", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const positiveDecimal = (value) => /^[1-9][0-9]*$/.test(value);
const validDepth = (value) => /^[0-9]+$/.test(value) && Number(value) <= 3;
const MAX_BATCH = 200;
const standardBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function encodeBatch(items) {
  const canonical = items
    .map((item) => ({ manual_retry: item.manual_retry === true, number: Number(item.number) }))
    .sort((left, right) => left.number - right.number);
  return Buffer.from(JSON.stringify(canonical), "utf8").toString("base64");
}

function decodeBatch(encoded) {
  if (!encoded || encoded.length > 20000 || !standardBase64.test(encoded)) {
    throw new Error("invalid PR batch");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > 15000 || bytes.toString("base64") !== encoded) {
    throw new Error("invalid PR batch");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH) {
    throw new Error("invalid PR batch");
  }
  let previous = 0;
  for (const item of value) {
    if (!item || Array.isArray(item) || Object.keys(item).join(",") !== "manual_retry,number") {
      throw new Error("invalid PR batch");
    }
    if (
      typeof item.manual_retry !== "boolean" ||
      !Number.isSafeInteger(item.number) ||
      item.number <= previous
    ) {
      throw new Error("invalid PR batch");
    }
    previous = item.number;
  }
  if (JSON.stringify(value) !== text) throw new Error("invalid PR batch");
  return value;
}

export function route(input) {
  const event = String(input.event || "");
  const ref = String(input.ref || "");
  const actor = String(input.actor || "");
  const prNumber = String(input.prNumber || "");
  const prBatchB64 = String(input.prBatchB64 || "");
  const eventPrNumber = String(input.eventPrNumber || "");
  const branch = String(input.branch || "");
  const target = branch || String(input.target || ref);
  const depth = String(input.depth ?? "0");
  const detectorHandoff = input.detectorHandoff === true;
  const routedManualRetry = input.manualRetry === true;
  const refRaceHandoff = input.refRaceHandoff === true;

  const errors = [];
  let batch = null;
  if (!validDepth(depth)) errors.push("invalid depth");
  if (prNumber && !positiveDecimal(prNumber)) errors.push("invalid PR number");
  if (prNumber && prBatchB64) errors.push("mutually exclusive PR selectors");
  if (prBatchB64) {
    try {
      batch = decodeBatch(prBatchB64);
    } catch {
      errors.push("invalid PR batch");
    }
    if (!detectorHandoff) errors.push("batch without detector handoff");
    if (routedManualRetry) errors.push("batch with top-level manual retry");
  }
  if (routedManualRetry && !detectorHandoff) {
    errors.push("manual retry without detector handoff");
  }

  const internalShape =
    event === "workflow_dispatch" &&
    detectorHandoff &&
    ref === "github-actions" &&
    actor === "github-actions[bot]" &&
    ((positiveDecimal(prNumber) && prBatchB64 === "") ||
      (prNumber === "" && batch !== null)) &&
    branch === "";
  if (detectorHandoff && !internalShape) errors.push("invalid internal handoff");

  const valid = errors.length === 0;
  const internalWorker = valid && internalShape;
  const humanDispatch =
    event === "workflow_dispatch" &&
    !detectorHandoff &&
    prBatchB64 === "" &&
    !refRaceHandoff;
  const humanExplicit = humanDispatch && Boolean(prNumber || branch);
  const conversationEvent =
    event === "issue_comment" || event === "pull_request_review_comment";
  const failedCheckEvent = event === "check_run";
  const failedWorkflowEvent = event === "workflow_run";
  const scanAll =
    event === "schedule" ||
    (humanDispatch && prNumber === "" && branch === "");
  const scanHead =
    event === "push" ||
    (humanDispatch && prNumber === "" && branch !== "");
  const manualRetry =
    event === "workflow_dispatch" &&
    ((detectorHandoff && routedManualRetry) || humanExplicit);
  const selector = prNumber
    ? `pr:${prNumber}`
    : batch
      ? `batch:${batch.length}`
      : (conversationEvent || failedCheckEvent || failedWorkflowEvent) && eventPrNumber
        ? `pr:${eventPrNumber}`
        : scanAll
          ? "all"
          : scanHead
            ? `base-or-head:${target}`
            : `base:${target}`;

  let concurrency;
  if (internalShape) concurrency = `resolve-worker-${input.runId || "run"}`;
  else if (prBatchB64) concurrency = `resolve-invalid-batch-${input.runId || "run"}`;
  else if (event === "workflow_dispatch" && prNumber) {
    concurrency = `resolve-detect-pr${prNumber}`;
  } else if (event === "workflow_dispatch" && branch) {
    concurrency = `resolve-detect-selector-${branch}`;
  } else if (failedCheckEvent && eventPrNumber) {
    concurrency = `lopu-check-fix-pr${eventPrNumber}`;
  } else if (failedWorkflowEvent && eventPrNumber) {
    concurrency = `lopu-workflow-fix-pr${eventPrNumber}`;
  } else if (conversationEvent && eventPrNumber) {
    concurrency = `lopu-conversation-pr${eventPrNumber}`;
  } else if (event === "workflow_dispatch" || event === "schedule") {
    concurrency = "resolve-detect-all-open";
  } else if (event === "repository_dispatch") {
    concurrency = `resolve-detect-legacy-${target}`;
  } else if (event === "pull_request_target" && input.eventPrNumber) {
    concurrency = `resolve-detect-pr${input.eventPrNumber}`;
  } else {
    concurrency = `resolve-detect-${target}`;
  }

  return {
    valid,
    errors,
    internalWorker,
    detectorOnly: !internalWorker,
    handoffEligible: valid && !internalWorker,
    humanExplicit,
    scanAll,
    scanHead,
    manualRetry,
    batchSize: batch?.length ?? 0,
    refRaceHandoff,
    selector,
    concurrency,
    cancelInProgress: !internalShape,
    modelAndResolve: internalWorker,
  };
}

function assertRoute(name, input, expected) {
  const actual = route(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `${name}: ${key}`);
  }
}

function assertWorkflowSource() {
  const source = readFileSync(WORKFLOW_URL, "utf8");
  const rebaseSource = readFileSync(REBASE_WORKFLOW_URL, "utf8");
  const rebaseActionSource = readFileSync(REBASE_ACTION_URL, "utf8");
  const lopuActionSource = readFileSync(LOPU_ACTION_URL, "utf8");
  const lopuStatusSource = readFileSync(LOPU_STATUS_URL, "utf8");
  const lopuStatusTestSource = readFileSync(LOPU_STATUS_TEST_URL, "utf8");
  const modelBlock = source.slice(
    source.indexOf("\n  model_config:"),
    source.indexOf("\n  resolve_promotion:"),
  );
  const reviewBlock = source.slice(
    source.indexOf("\n  review:"),
    source.indexOf("\n  resolve_promotion:"),
  );
  const codeqlDispositionBlock = source.slice(
    source.indexOf("\n  codeql_dispositions:"),
    source.indexOf("\n  resolve_promotion:"),
  );
  const reviewHandoffBlock = source.slice(
    source.indexOf("\n  review_handoff:"),
    source.indexOf("\n  model_config:"),
  );
  const manageRebasesBlock = source.slice(
    source.indexOf("\n  manage_rebases:"),
    source.indexOf("\n  maintain_develop_promotion:"),
  );
  const detectBlock = source.slice(
    source.indexOf("\n  detect:"),
    source.indexOf("\n  handoff:"),
  );
  const progressBlock = source.slice(
    source.indexOf("\n  progress:"),
    source.indexOf("\n  resolve:"),
  );
  const reviewDetectBlock = source.slice(
    source.indexOf("\n  review_detect:"),
    source.indexOf("\n  review_handoff:"),
  );
  const resolveBlock = source.slice(source.indexOf("\n  resolve:"));
  const mergePushBlock = source.slice(
    source.indexOf("      - name: Push merge commit"),
    source.indexOf("      - name: Requeue after a moving-ref race"),
  );
  const rebaseContextBlock = rebaseSource.slice(
    rebaseSource.indexOf("      - name: Validate dispatch against live PR and branch refs"),
    rebaseSource.indexOf("      - name: Comment on PR (rebase starting)"),
  );
  const rebasePushBlock = rebaseSource.slice(
    rebaseSource.indexOf("      - name: Force-push the fully verified rewritten history once"),
    rebaseSource.indexOf("      - name: Requeue after a moving-ref rebase race"),
  );
  const rebaseProvenanceBlock = rebaseSource.slice(
    rebaseSource.indexOf("      - name: Stamp exact Lopu rebase provenance on the rewritten tip"),
    rebaseSource.indexOf("      - name: Revalidate live refs and final local state"),
  );
  const rebaseMaintenanceBlock = rebaseSource.slice(
    rebaseSource.indexOf("      - name: Queue repository maintenance after the rebase fleet settles"),
    rebaseSource.indexOf("      - name: Clean up after a pre-push failure"),
  );
  const rebaseHandoffBlock = rebaseSource.slice(
    rebaseSource.indexOf("\n  handoff:"),
    rebaseSource.indexOf("\n  rebase:"),
  );
  const rebaseChildDispatchBlock = rebaseSource.slice(
    rebaseSource.indexOf("      - name: Dispatch exact child transplants"),
    rebaseSource.indexOf("      - name: Release current PR and report success"),
  );
  const cascadeBlock = source.slice(
    source.indexOf("      - name: Cascade to PRs stacked on this head"),
    source.indexOf("      - name: Comment on PR (needs attention)"),
  );
  const startCommentBlock = source.slice(
    source.indexOf("      - name: Comment on PR (resolution starting)"),
    source.indexOf("      - name: Check out PR head"),
  );
  const admissionBlock = source.slice(
    source.indexOf("      - name: Revalidate queued PR snapshot before expensive work"),
    source.indexOf("      - name: Comment on PR (resolution starting)"),
  );
  const checkoutBlock = source.slice(
    source.indexOf("      - name: Check out PR head"),
    source.indexOf("      - name: Clear deliberately retried rebase ownership pauses"),
  );
  const resolvedCommentBlock = source.slice(
    source.indexOf("      - name: Comment on PR (resolved)"),
    source.indexOf("      - name: Cascade to PRs stacked on this head"),
  );
  const failureCommentBlock = source.slice(
    source.indexOf("      - name: Comment on PR (needs attention)"),
  );
  const graphifyBlock = source.slice(
    source.indexOf("      - name: Rebuild Graphify structure, then LLM semantics"),
    source.indexOf("      - name: Push merge commit"),
  );

  assert.match(source, /description: "PR base or head branch to scan;/);
  assert.doesNotMatch(source, /unique head|exact PR snapshot/);
  assert.match(source, /No open PR matched the manual selector/);
  assert.match(source, /Manual selector matched, but no merge worker is needed/);
  assert.match(source, /format\('resolve-detect-pr\{0\}'/);
  assert.match(source, /format\('resolve-worker-\{0\}', github\.run_id\)/);
  assert.match(resolveBlock, /queue: max/);
  // The detector bounds the fully materialized matrix below the durable fleet
  // limit. `max-parallel` would hide latent jobs from exact-owner deduplication.
  assert.doesNotMatch(resolveBlock, /max-parallel:/);
  assert.match(resolveBlock, /fail-fast: false/);
  assert.equal(
    source.match(/chore: refresh graphify outputs after PR branch merge/g)?.length,
    3,
    "the terminal commit and both per-event deferrals share one exact marker",
  );
  assert.match(
    resolveBlock,
    /RESOLUTION_TRAILER: "Lopu-Conflict-Resolution: run=\$\{\{ github\.run_id \}\} pr=\$\{\{ matrix\.pr\.number \}\}"/,
    "every resolver commit carries a controller-run and PR-bound trailer",
  );
  assert.equal(
    resolveBlock.match(/-m "\$RESOLUTION_TRAILER"/g)?.length,
    2,
    "AI-resolved and terminal Graphify commits preserve the resolver trailer",
  );
  assert.match(
    resolveBlock,
    /git merge --no-edit[\s\S]*?printf "Merge branch '%s' into %s\\n\\n%s"[\s\S]*?\$RESOLUTION_TRAILER/u,
    "clean and marker-free merge commits preserve the resolver trailer",
  );
  const allBranchDeferralBlock = source.slice(
    source.indexOf("  handoff_all_branch_event:"),
    source.indexOf("  maintain_all_branch:"),
  );
  const reviewDeferralBlock = source.slice(
    source.indexOf("  review_detect:"),
    source.indexOf("  review_dispatch:"),
  );
  for (const [name, block] of [
    ["all-branch", allBranchDeferralBlock],
    ["review", reviewDeferralBlock],
  ]) {
    assert.match(block, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/);
    assert.match(block, /'github-actions\[bot\]'\|"\$REPOSITORY_OWNER"/);
    assert.match(block, /actions\/runs\/\$run_id/);
    assert.match(block, /\.event == "workflow_dispatch"/);
    assert.match(block, /\.head_branch == "github-actions"/);
    assert.match(block, /\.actor\.login == "github-actions\[bot\]"/);
    assert.match(block, /\.path == "\.github\/workflows\/resolve-pr-conflicts\.yml"/);
    assert.match(block, /\[ "\$pr_number" = "\$EVENT_PR_NUMBER" \]/);
    assert.match(
      block,
      /Lopu-Conflict-Resolution: run=\(\[1-9\]\[0-9\]\*\) pr=\(\[1-9\]\[0-9\]\*\)/,
      `${name} deferral requires an exact run/PR trailer`,
    );
    assert.match(
      block,
      /Lopu-Rebase-Completion: run=\(\[1-9\]\[0-9\]\*\) pr=\(\[1-9\]\[0-9\]\*\)/,
      `${name} deferral recognizes the exact rebase run/PR trailer`,
    );
    assert.match(block, /\.event == "repository_dispatch"/);
    assert.match(block, /actions\/runs\/\$run_id\/jobs\?per_page=100/);
    assert.match(block, /expected_job=" \/ Rebase PR #\$pr_number"/);
    assert.match(block, /endswith\(\$expected_job\)/);
  }
  assert.match(source, /Deferring the all-branch rebuild to the conflict-batch finalizer/);
  assert.match(source, /Deferring the all-branch rebuild to the rebase-fleet finalizer/);
  assert.match(source, /Verified Lopu conflict resolution is reviewed once by the batch finalizer/);
  assert.match(source, /Verified Lopu rebase is reviewed once by the rebase-fleet finalizer/);
  assert.match(
    rebaseProvenanceBlock,
    /trailer="Lopu-Rebase-Completion: run=\$GITHUB_RUN_ID pr=\$PR_NUMBER"/,
  );
  assert.match(
    rebaseProvenanceBlock,
    /Lopu-\(Conflict-Resolution\|Rebase-Completion\): run=\[1-9\]\[0-9\]\* pr=\[1-9\]\[0-9\]\*\$\/d/,
    "a new rebase replaces stale Lopu publication provenance on the rewritten tip",
  );
  assert.match(rebaseProvenanceBlock, /git interpret-trailers/);
  assert.match(rebaseProvenanceBlock, /--if-exists replace/);
  assert.match(rebaseProvenanceBlock, /--if-missing add/);
  assert.match(rebaseProvenanceBlock, /git commit --amend --no-verify -q -F "\$message"/);
  assert.match(rebaseMaintenanceBlock, /labels=ai-rebase-in-progress/);
  assert.match(
    rebaseMaintenanceBlock,
    /\.display_title == "Lopu resolves a PR batch from the control plane"/,
  );
  assert.match(rebaseMaintenanceBlock, /\.event == "workflow_dispatch"/);
  assert.match(rebaseMaintenanceBlock, /\.head_branch == "github-actions"/);
  assert.match(rebaseMaintenanceBlock, /\.actor\.login == "github-actions\[bot\]"/);
  assert.match(rebaseMaintenanceBlock, /lopu-internal-all-branch/);
  assert.match(rebaseMaintenanceBlock, /lopu-review:rebase-fleet:\$GITHUB_RUN_ID/);
  assert.equal(
    rebaseMaintenanceBlock.match(/resolve-pr-conflicts\.yml\/dispatches/g)?.length,
    2,
    "the last rebase worker dispatches exactly one repository maintenance pair",
  );
  const batchFinalizerBlock = source.slice(
    source.indexOf("  finalize_conflict_batch_maintenance:"),
  );
  assert.match(batchFinalizerBlock, /needs: \[route, detect, resolve\]/);
  assert.match(batchFinalizerBlock, /needs\.resolve\.result == 'success'/);
  assert.match(batchFinalizerBlock, /lopu-internal-all-branch/);
  assert.match(batchFinalizerBlock, /lopu-review:conflict-batch:\$BATCH_RUN_ID/);
  assert.equal(
    batchFinalizerBlock.match(/resolve-pr-conflicts\.yml\/dispatches/g)?.length,
    2,
    "one completed conflict batch dispatches exactly one maintenance pair",
  );
  const handoffBlock = source.slice(
    source.indexOf("  handoff:"),
    source.indexOf("  review_detect:"),
  );
  assert.match(handoffBlock, /status=queued/);
  assert.match(source, /Lopu resolves a fully materialized PR batch from the control plane/);
  assert.match(
    handoffBlock,
    /\.display_title == "Lopu resolves a PR batch from the control plane"[\s\S]*?Legacy Lopu batch run\(s\) \$legacy_label still own latent conflict selections/u,
    "pre-migration generic batch runs drain without receiving unknowable duplicate replacements",
  );
  assert.match(handoffBlock, /\.actor\.login == "github-actions\[bot\]"/);
  assert.doesNotMatch(
    handoffBlock,
    /status=\$pending_status|status=pending/,
    "a pending workflow can contain active matrix work and must never be coalesced",
  );
  assert.match(handoffBlock, /case "\$live_status" in[\s\S]*?queued\)/u);
  assert.match(handoffBlock, /actions\/runs\/\$queued_run_id\/cancel/);
  assert.match(handoffBlock, /changed state before cancellation; preserving it/);
  assert.match(handoffBlock, /did not release queue capacity within 60 seconds/);
  assert.match(
    handoffBlock,
    /actions\/concurrency_groups\/\$fleet_group_encoded[\s\S]*?\.group_members\[\]\?[\s\S]*?Resolve\|Rebase[\s\S]*?owned_numbers/u,
    "new conflict detectors read pending and in-progress exact PR owners from the durable Lopu fleet queue",
  );
  assert.match(
    handoffBlock,
    /\[\.\[\] \| select\(\.number as \$number \| \$owned \| index\(\$number\) == null\)\]/u,
    "already-owned merge and rebase PRs are removed before replacement batch dispatch",
  );
  assert.match(
    handoffBlock,
    /Every detected conflict already has a durable Lopu merge\/rebase owner; no replacement batch was dispatched/u,
    "an entirely owned detector result exits successfully without creating an empty or duplicate worker batch",
  );
  assert.match(
    handoffBlock,
    /Could not read the durable Lopu fleet queue; deferring conflict dispatch to a later repository scan/u,
    "a transient queue-inventory failure defers rather than risking an over-capacity matrix",
  );
  assert.match(handoffBlock, /fleet_capacity=90/);
  assert.match(handoffBlock, /\.total_count \/\/ \(\.group_members \| length\)/);
  assert.match(handoffBlock, /\.'\?\[0:\$available_slots\]|'\.\[0:\$available_slots\]'/);
  assert.match(
    handoffBlock,
    /deferring \$deferred_count conflict\(s\) to the next scan/u,
    "only capacity-bounded conflict matrices are dispatched; overflow remains discoverable",
  );
  assert.ok(
    handoffBlock.indexOf("Coalescing obsolete queued Lopu worker run") <
      handoffBlock.indexOf("for priority_sync in true false"),
    "never-started queued workers are coalesced before replacement batches dispatch",
  );
  assert.match(resolveBlock, /Revalidate queued PR snapshot/);
  assert.match(admissionBlock, /\.state/);
  assert.match(admissionBlock, /no-ai-merge/);
  assert.match(admissionBlock, /ai-rebase-in-progress/);
  assert.equal(
    resolveBlock.match(/steps\.admission\.outputs\.current == 'true'/g)?.length,
    19,
    "every post-admission resolution step is gated",
  );
  assert.match(source, /github\.actor == 'github-actions\[bot\]'/);
  assert.doesNotMatch(
    source,
    /github\.actor == 'thingtime-ci-control\[bot\]'/,
    "CI Control App runs are detectors only; GITHUB_TOKEN creates exact workers",
  );
  assert.match(source, /github\.ref_name == 'github-actions'/);
  assert.match(source, /inputs\.detector_handoff == true/);
  assert.match(source, /manual_retry is internal routing state and requires detector_handoff/);
  assert.match(source, /pr_batch_b64 is internal routing state and requires detector_handoff/);
  assert.match(source, /PR batch must contain from 1 through 200 selections/);
  assert.match(
    source,
    /gh_read_retry\(\) \{[\s\S]*for attempt in 1 2 3 4[\s\S]*HTTP \(408\|429\|500\|502\|503\|504\)[\s\S]*1 << attempt/u,
    "read-only GitHub API calls retry a bounded set of transient failures with backoff",
  );
  // A mid-response HTTP/2 reset carries no status line, so status-only
  // classification made a retryable edge blip fatal (run 33262097171).
  // Count the helper definitions instead of hard-coding today's three: an
  // absolute count is exactly inverted for a fourth copy. It stays green when
  // that copy ships the status-only predicate (the outage shape, silently
  // reintroduced) and goes red when the copy is correct. The floor keeps the
  // pair from passing vacuously if the helper is ever renamed away.
  const readRetryCopies =
    source.match(/^[ \t]*gh_read_retry\(\) \{[ \t]*$/gmu)?.length ?? 0;
  assert.ok(
    readRetryCopies >= 1,
    "the control plane still defines its read-only GitHub API retry helper",
  );
  assert.equal(
    source.match(/^\s*transport='stream error\|/gmu)?.length,
    readRetryCopies,
    "every gh_read_retry copy also treats transport-level resets as retryable",
  );
  // A body truncated after a clean status line surfaces as gh's encoding/json
  // decode error, not as a transport string, so the status-and-reset predicate
  // still classified it as fatal (run 33316907281 reported red on #92 for an
  // upstream blip). Pin the decode message per copy for the same reason the
  // reset pattern is pinned: a copy that drops it silently restores the outage.
  assert.equal(
    source.match(/\|unexpected end of JSON input\|/gu)?.length,
    readRetryCopies,
    "every gh_read_retry copy retries a response body that ended mid-document",
  );
  // Declaring the pattern is not the same as branching on it: a copy that
  // keeps `transport=` but drops the predicate reintroduces the exact
  // outage. Assert the predicate is actually wired into every retry branch,
  // independent of how each copy formats its condition.
  assert.equal(
    source.match(/\|\| grep -Eq "\$transport" "\$errors"/gu)?.length,
    readRetryCopies,
    "every gh_read_retry copy branches on the transport predicate, not just declares it",
  );
  assert.doesNotMatch(
    source,
    /if grep -Eq 'HTTP \(408\|429\|500\|502\|503\|504\)\(\[\^0-9\]\|\$\)' "\$errors"; then/u,
    "no gh_read_retry copy classifies transience by HTTP status alone",
  );
  assert.match(
    source,
    /if ! gh_read_retry graphql --paginate --slurp[\s\S]*Could not read the open PR inventory from GitHub[\s\S]*successful but malformed PR inventory response/u,
    "the GraphQL PR inventory is parsed only after transport success and response-shape validation",
  );
  assert.match(
    source,
    /PRIORITY_SYNC_EVENT:[\s\S]*pull_request_target[\s\S]*github\.event\.action != 'closed'[\s\S]*sync\/main-into-develop[\s\S]*develop[\s\S]*'true'[\s\S]*'false'/u,
    "the exact standing synchronizer event is identified from trusted open pull-request context",
  );
  assert.match(
    source,
    /exact_sync_open_pr\(\) \{[\s\S]*gh_read_retry "repos\/\$REPO\/pulls\/\$ONLY_PR"[\s\S]*stale or malformed exact standing sync PR response[\s\S]*mergeStateStatus:\(\(\.mergeable_state \/\/ "unknown"\) \| ascii_upcase\)/u,
    "the priority synchronizer hydrates and validates one exact REST PR snapshot",
  );
  assert.match(
    source,
    /all_open_prs\(\) \{[\s\S]*if \[ "\$PRIORITY_SYNC_EVENT" = true \]; then\s+exact_sync_open_pr\s+return\s+fi[\s\S]*gh_read_retry graphql --paginate --slurp/u,
    "the priority synchronizer bypasses the repository-wide GraphQL inventory without changing ordinary sweeps",
  );
  assert.match(
    source,
    /all_open="\$\(all_open_prs\)"\n\s+prs="\$\(query\)"/u,
    "the detector filters and classifies one complete PR inventory snapshot",
  );
  assert.doesNotMatch(
    source,
    /query\(\) \{\n\s+local open\n\s+open="\$\(all_open_prs\)"/u,
    "query filters must not issue a redundant full-repository GraphQL request",
  );
  assert.match(source, /--base "\$HEAD_REF" --state open --limit 1000/);
  assert.match(source, /ref:"github-actions"/);
  assert.doesNotMatch(source, /ref:"develop"/);
  assert.match(source, /detector_handoff:true/);
  assert.match(source, /manual_retry:false/);
  assert.match(
    source,
    /for priority_sync in true false; do[\s\S]*\.head == "sync\/main-into-develop" and \.base == "develop"[\s\S]*== \$priority_sync/u,
    "the standing main-to-develop synchronizer is partitioned into the first conflict handoff",
  );
  assert.match(
    source,
    /priority main-to-develop synchronizer batch/u,
    "priority synchronizer dispatches remain observable in the run log",
  );
  assert.match(
    handoffBlock,
    /priority_fleet_group="lopu-priority-main-develop-\$REPO"[\s\S]*?priority_owned_numbers[\s\S]*?\$ordinary \+ \$priority \| sort \| unique/u,
    "detectors deduplicate exact synchronizer owners from the independent priority queue",
  );
  assert.match(
    handoffBlock,
    /grep -q 'HTTP 404'[\s\S]*?Could not read the priority synchronizer queue; deferring conflict dispatch/u,
    "a missing priority group starts empty while other queue-read failures defer safely",
  );
  assert.match(
    handoffBlock,
    /priority_candidates="\$\(jq -c '[\s\S]*?sync\/main-into-develop[\s\S]*?ordinary_candidates="\$\(jq -c '[\s\S]*?available_slots[\s\S]*?\$priority \+ \$ordinary/u,
    "priority synchronizers remain dispatchable when the ordinary Lopu fleet is full",
  );
  assert.match(
    source,
    /for priority_sync in true false; do[\s\S]*sort_by\(\.number\)[\s\S]*unique_by\(\.number\)[\s\S]*range\(0; length; 200\)/u,
    "each priority partition remains a canonical, bounded, number-sorted batch",
  );
  assert.equal(
    source.match(/pr_batch_b64:\$pr_batch_b64/g)?.length,
    2,
    "detector handoff and cascade both carry canonical PR batches",
  );
  assert.match(
    resolveBlock,
    /group: >-[\s\S]*?matrix\.pr\.head == 'sync\/main-into-develop'[\s\S]*?matrix\.pr\.base == 'develop'[\s\S]*?lopu-priority-main-develop-\{0\}[\s\S]*?lopu-agent-fleet-\{0\}[\s\S]*?queue: max[\s\S]*?cancel-in-progress: false/u,
    "only the standing synchronizer bypasses the ordinary serialized model backlog",
  );
  // Per-PR retry intent lives INSIDE the canonical batch, so both dispatch
  // payloads pin the top-level flag to the literal false. Binding the lowercase
  // per-PR shell variable the batch refactor deleted (the detector's own
  // uppercase `$MANUAL_RETRY` env stays valid) is an unbound variable under
  // `set -u`, which aborts the handoff before a single worker is dispatched.
  assert.doesNotMatch(
    source,
    /--argjson manual_retry "\$manual_retry"/u,
    "batch dispatchers pin top-level manual_retry to false instead of a per-PR variable",
  );
  assert.match(source, /issue_comment:\n    types: \[created, edited\]/u, "human PR comments wake Lopu");
  assert.match(
    source,
    /pull_request_review_comment:\n    types: \[created, edited\]/u,
    "human inline review comments wake Lopu",
  );
  assert.match(source, /check_run:\n    types: \[completed\]/u, "failed PR checks wake Lopu");
  assert.match(
    source,
    /workflow_run:\n    workflows:[\s\S]*?- Web CI[\s\S]*?- Build all branch\n    types: \[completed\]/u,
    "GitHub Actions-produced PR workflow failures wake Lopu",
  );
  assert.doesNotMatch(
    source.slice(source.indexOf("\n  workflow_run:"), source.indexOf("\n  schedule:")),
    /- Lopu PR manager\s*$/mu,
    "the workflow-run bridge cannot recursively review Lopu's own runs",
  );
  assert.match(
    source,
    /github\.event\.issue\.pull_request[\s\S]*?github\.event\.comment\.user\.type == 'User'/u,
    "only human PR conversation comments enter the Lopu route",
  );
  assert.match(
    source,
    /pr_number: \$\{\{ inputs\.pr_number \|\| github\.event\.client_payload\.pr_number \|\| github\.event\.issue\.number/u,
    "issue comments select their exact PR",
  );
  assert.match(
    source,
    /manage_rebases:[\s\S]*?github\.event_name != 'issue_comment'/u,
    "conversation events do not launch unrelated rebases",
  );
  assert.match(
    manageRebasesBlock,
    /github\.event_name != 'workflow_run'/u,
    "CI workflow completions do not launch unrelated rebases",
  );
  assert.match(
    source,
    /detect:[\s\S]*?github\.event_name != 'pull_request_review_comment'/u,
    "conversation events do not launch unrelated conflict scans",
  );
  assert.match(
    manageRebasesBlock,
    /github\.event_name != 'repository_dispatch'[\s\S]*github\.event\.action == 'rebase-pr-stack-ai'/u,
    "exact rebase repository events are owned only by the rebase engine",
  );
  assert.match(
    source,
    /github\.event\.action == 'rebase-pr-stack-ai'[\s\S]*inputs\.ref_race_handoff == true[\s\S]*&& 'rebase-stack'/u,
    "automatic rebase race retries retain the rebase compute-provider policy",
  );
  assert.match(
    detectBlock,
    /github\.event_name != 'repository_dispatch'[\s\S]*github\.event\.action == 'resolve-conflicts-cascade'/u,
    "merge cascade repository events are owned only by the conflict detector",
  );
  assert.match(
    detectBlock,
    /inputs\.ref_race_handoff != true/u,
    "automatic rebase race retries cannot also enter the merge detector",
  );
  assert.match(
    detectBlock,
    /github\.event_name != 'workflow_run'/u,
    "CI workflow completions do not launch unrelated conflict scans",
  );
  assert.match(
    reviewDetectBlock,
    /github\.event_name != 'repository_dispatch'[\s\S]*inputs\.ref_race_handoff != true/u,
    "internal events and automatic rebase retries never launch a duplicate whole-PR review",
  );
  for (const [name, block] of [
    ["review selector", reviewDetectBlock],
    ["review worktree preparation", reviewBlock],
  ]) {
    assert.match(
      block,
      /gh_read_retry\(\) \{[\s\S]*for attempt in 1 2 3 4[\s\S]*HTTP \(408\|429\|500\|502\|503\|504\)/u,
      `${name} retries bounded transient GitHub metadata failures`,
    );
    assert.match(
      block,
      /open="\$\(gh_read_retry pr list[\s\S]*default_ref="\$\(gh_read_retry api/u,
      `${name} routes both initial metadata reads through the retry helper`,
    );
  }
  assert.match(
    source,
    /github\.event\.check_run\.pull_requests\[0\]\.number[\s\S]*?github\.event\.check_run\.conclusion == 'failure'/u,
    "only PR-associated failing checks enter the Lopu route",
  );
  assert.match(
    source,
    /github\.event\.workflow_run\.pull_requests\[0\]\.number[\s\S]*?github\.event\.workflow_run\.conclusion == 'failure'/u,
    "only PR-associated failing Actions workflows enter the Lopu route",
  );
  assert.match(source, /actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/g);
  assert.doesNotMatch(source, /gh api "repos\/\$REPO\/dispatches"/);
  assert.doesNotMatch(cascadeBlock, /if: env\.HAS_WORKFLOW_PUSH/);
  assert.match(source, /mergeStateStatus/u, "detector reads GitHub's behind/current state");
  assert.match(
    source,
    /select\(\.mergeable == "CONFLICTING" or \.mergeStateStatus == "BEHIND"\)/u,
    "conflicting and clean-but-behind PRs both enter Lopu's base-merge lane",
  );
  assert.match(
    source,
    /mode: \(if \.mergeable == "CONFLICTING" then "conflict" else "outdated" end\)/u,
    "workers retain why the PR needs a base merge",
  );
  assert.match(
    source,
    /select\(\.mergeStateStatus != "BEHIND" and \.mergeStateStatus != "UNKNOWN"\)/u,
    "whole-PR review waits until its head is current",
  );
  assert.match(
    graphifyBlock,
    /steps\.admission\.outputs\.current == 'true'/u,
    "every completed base merge gets a Graphify rebuild",
  );
  assert.doesNotMatch(
    graphifyBlock,
    /if:.*graphify_reset/u,
    "Graphify refresh is not limited to graph-tree conflicts",
  );
  assert.ok(
    graphifyBlock.indexOf('node "$graphify_router" update .') <
      graphifyBlock.indexOf('node "$graphify_router" extract .'),
    "structural Graphify extraction runs before LLM semantic extraction",
  );
  assert.match(
    graphifyBlock,
    /trusted\/\.github\/scripts\/graphify-cas\.mjs/u,
    "privileged Graphify publication executes only the trusted router",
  );
  assert.match(
    graphifyBlock,
    /git clean -qffdx -e trusted\//u,
    "Graphify cleanup preserves the local Lopu action until runner post steps finish",
  );
  assert.doesNotMatch(
    graphifyBlock,
    /git clean -qffdx\s*\n/u,
    "Graphify cleanup cannot delete the protected local-action checkout",
  );
  assert.match(
    graphifyBlock,
    /node "\$graphify_stager"/u,
    "only immutable portable snapshots and additive cache entries are staged",
  );
  assert.match(
    graphifyBlock,
    /preserving the completed structural refresh/u,
    "semantic failure retains the completed structural graph",
  );

  assert.match(
    resolveBlock,
    /RUN_STATUS_MARKER: '<!-- thingtime-ai-resolve-status:v2 run_id=\$\{\{ github\.run_id \}\} -->'/u,
    "resolver status marker is scoped to the workflow run",
  );
  assert.match(
    detectBlock,
    /thingtime-lopu-progress:v1 pr=\$number head=\$head_sha base=\$base_sha/u,
    "detected work has an immutable PR/head/base progress marker",
  );
  assert.match(
    detectBlock,
    /conflicting="\$snapshots"[\s\S]*?ensure_progress_comment[\s\S]*?echo "prs=\$conflicting"/u,
    "the detector comments before handing actionable snapshots to the worker queue",
  );
  assert.match(
    detectBlock,
    /Next automatic check-in: within \*\*10 minutes\*\*/u,
    "the first detection comment promises the human heartbeat cadence",
  );
  assert.match(
    detectBlock,
    /Check out the trusted Lopu PR-status helper[\s\S]*ref: github-actions[\s\S]*sparse-checkout: \.github\/scripts\/lopu-pr-status\.mjs/u,
    "detector classification executes only the fixed controller helper",
  );
  assert.match(
    detectBlock,
    /files\(first: 100\)[\s\S]*totalCount[\s\S]*nodes \{ path \}/u,
    "one open-PR inventory includes changed paths for overlap classification",
  );
  assert.match(
    detectBlock,
    /complete_large_pr_files[\s\S]*pulls\/\$number\/files\?per_page=100[\s\S]*--slurpfile response "\$pages"/u,
    "large PRs receive an exact file-backed paginated changed-file inventory",
  );
  assert.doesNotMatch(
    detectBlock,
    /--argjson (?:files|classification|all|prs)\b/u,
    "large changed-path, classification, PR, and repository arrays never cross the process argument-size boundary",
  );
  assert.match(
    detectBlock,
    /--slurpfile classifications "\$classification_file"/u,
    "relationship metadata is joined from a file instead of a process argument",
  );
  assert.match(
    detectBlock,
    /lopu-all-open-prs\.json[\s\S]*--slurpfile all_open_inventory "\$all_open_file"/u,
    "stack ownership joins use the same file-backed repository inventory",
  );
  assert.match(
    detectBlock,
    /classify --default-ref "\$default_ref"[\s\S]*sync_lopu_fact_labels/u,
    "every open PR receives reconciled Lopu fact labels from repository topology",
  );
  assert.match(
    detectBlock,
    /permissions:\n\s+actions: read[\s\S]*issues: write/u,
    "the detector can read the durable Lopu fleet before reconciling lane labels",
  );
  assert.match(
    detectBlock,
    /actions\/concurrency_groups\/\$fleet_group_encoded[\s\S]*lane-plan/u,
    "queue and resolving labels are projected from the live durable fleet",
  );
  assert.match(
    detectBlock,
    /sync_lopu_lane_labels[\s\S]*--slurpfile classification "\$classification_file"[\s\S]*lane-plan/u,
    "the full PR classification reaches lane planning through a file-backed join",
  );
  assert.match(
    detectBlock,
    /EVENT_ACTION: \$\{\{ github\.event\.action \}\}[\s\S]*EVENT_ACTION" = closed[\s\S]*managed_all[\s\S]*'\[\]'/u,
    "closed PRs lose every dynamic Lopu label while unrelated labels remain untouched",
  );
  assert.match(
    detectBlock,
    /--method PATCH "repos\/\$REPO\/labels\/[\s\S]*new_name="\$name"[\s\S]*description="\$description"/u,
    "managed label colors and descriptions are updated when their definitions change",
  );
  assert.match(
    detectBlock,
    /repo_stats:\$classification\.stats[\s\S]*overlapPrNumbers:\$metadata\.overlapPrNumbers/u,
    "immutable resolver snapshots carry queue and file-overlap context",
  );
  assert.match(
    detectBlock,
    /render-context/u,
    "the immediate comment renders UTC conversions and queue context",
  );
  assert.match(
    detectBlock,
    /upsert_legacy_status_context[\s\S]*?thingtime-lopu-status-context:v1/u,
    "legacy exact-snapshot work receives one separately marked status dashboard",
  );
  assert.match(
    detectBlock,
    /original timeline remains untouched[\s\S]*?render-context/u,
    "the companion dashboard cannot erase the pre-existing progress history",
  );
  assert.match(
    detectBlock,
    /context_comment_id[\s\S]*?upsert_legacy_status_context "\$item" "\$context_comment_id"/u,
    "repeat detector passes update the same legacy companion instead of adding duplicates",
  );
  assert.match(
    detectBlock,
    /thingtime-lopu-status-native:v1/u,
    "new progress comments identify themselves as dashboard-native singletons",
  );
  assert.match(
    progressBlock,
    /name: Keep PR reviewers updated every 10 minutes/u,
    "one dedicated human progress monitor accompanies a resolver batch",
  );
  assert.doesNotMatch(
    progressBlock,
    /\n\s+strategy:/u,
    "the progress monitor is one batch job, never one idle runner per PR",
  );
  assert.match(progressBlock, /continue-on-error: true/u, "comment telemetry cannot fail valid resolution work");
  assert.match(progressBlock, /actions: read[\s\S]*contents: read[\s\S]*pull-requests: read[\s\S]*issues: write/u);
  assert.match(progressBlock, /HEARTBEAT_SECONDS: "600"/u, "active work checks in every ten minutes");
  assert.match(progressBlock, /POLL_SECONDS: "60"/u, "phase transitions are detected promptly");
  assert.match(
    progressBlock,
    /actions\/runs\/\$RUN_ID\/jobs\?filter=all&per_page=100/u,
    "the monitor reads live sibling resolver phases instead of inventing status",
  );
  assert.match(progressBlock, /job_name="Resolve PR #\$number"/u, "each update follows its exact matrix worker");
  assert.match(progressBlock, /10-minute check-in: still working/u, "unchanged long phases append a heartbeat");
  assert.match(progressBlock, /thingtime-lopu-progress-timeline:start/u, "progress history is retained in place");
  assert.match(progressBlock, /Rebuilding Graphify structure and semantic context/u, "Graphify has a visible phase");
  assert.match(progressBlock, /repos\/\$REPO\/pulls\/\$number/u, "completion reads the live PR verdict");
  assert.match(progressBlock, /this PR is mergeable/u, "the human status confirms GitHub's final mergeability verdict");
  assert.match(progressBlock, /wait_elapsed[\s\S]*-lt 180/u, "a completed worker gives GitHub a bounded verdict-refresh window");
  assert.match(progressBlock, /there is no need to find the Actions run/u, "the PR comment is the human control surface");
  assert.match(
    progressBlock,
    /batch_counts[\s\S]*batch-counts/u,
    "the monitor derives live resolving, waiting, and finished batch counts",
  );
  assert.match(progressBlock, /read_live_stats/u, "repository PR counts refresh while a batch is active");
  assert.match(progressBlock, /sync_progress_labels/u, "queue and resolving labels follow the real worker phase");
  assert.match(progressBlock, /render-context/u, "every progress update includes time, queue, and relationship tables");
  assert.match(progressBlock, /thingtime-lopu-status-native:v1/u, "new monitors retain the native dashboard marker");
  assert.doesNotMatch(progressBlock, /secrets\./u, "the comment monitor never receives AI or push credentials");

  const featureStackProgressBlock = source.slice(
    source.indexOf("\n  feature_stack_progress:"),
    source.indexOf("\n  # Clean PRs still need a principal-engineering review."),
  );
  assert.match(featureStackProgressBlock, /name: Stream Feature Stack progress to Thingtime every 10 minutes/u);
  assert.match(featureStackProgressBlock, /continue-on-error: true/u, 'stack telemetry cannot fail a valid merge');
  assert.match(featureStackProgressBlock, /actions: read[\s\S]*contents: read/u);
  assert.match(featureStackProgressBlock, /HEARTBEAT_SECONDS: "600"/u);
  assert.match(featureStackProgressBlock, /POLL_SECONDS: "60"/u);
  assert.match(featureStackProgressBlock, /THINGTIME_CI_ROUTER_SECRET: \$\{\{ secrets\.THINGTIME_CI_ROUTER_SECRET \}\}/u);
  assert.match(featureStackProgressBlock, /feature-stack-progress\.mjs/u);

  for (const label of [
    "lopu: conflicting",
    "lopu: out-of-date",
    "lopu: mergeable",
    "lopu: queued",
    "lopu: resolving",
    "lopu: part of stack",
    "lopu: target PR not open",
    "lopu: overlapping files",
    "lopu: needs attention",
  ]) {
    assert.match(lopuStatusSource, new RegExp(label, "u"), `managed status helper defines ${label}`);
  }
  assert.match(lopuStatusSource, /America\/Los_Angeles/u, "time guide uses Los Angeles' IANA zone");
  assert.match(lopuStatusSource, /Australia\/Melbourne/u, "time guide uses Melbourne's IANA zone");
  assert.match(lopuStatusSource, /Time conversion \(UTC source\)/u, "UTC remains the canonical displayed time");
  assert.match(lopuStatusSource, /Currently resolving/u, "queue table exposes active resolver count");
  assert.match(lopuStatusSource, /Changed-file overlap/u, "related PRs disclose overlapping changed paths");
  assert.match(lopuStatusSource, /export function labelDelta/u, "label mutation is a tested managed-subset diff");
  assert.match(lopuStatusSource, /export function summarizeBatch/u, "worker queue counts use one tested classifier");
  assert.match(lopuStatusTestSource, /daylight-saving aware/u, "timezone offsets have deterministic DST fixtures");
  assert.match(lopuStatusTestSource, /missing parents, file overlap/u, "relationship labels have deterministic fixtures");
  assert.match(lopuStatusTestSource, /exact matrix worker names/u, "queue counts reject unrelated jobs");
  assert.match(admissionBlock, /id: admission/u, "queued workers have an admission gate");
  assert.match(
    admissionBlock,
    /live_head_sha[\s\S]*?EXPECTED_HEAD_SHA[\s\S]*?live_base_sha[\s\S]*?EXPECTED_BASE_SHA/u,
    "admission revalidates both immutable ref snapshots",
  );
  assert.match(
    admissionBlock,
    /checkout, AI, Graphify, and publication were skipped/u,
    "superseded queued workers document the bounded no-op",
  );
  assert.ok(
    resolveBlock.indexOf("Revalidate queued PR snapshot before expensive work") <
      resolveBlock.indexOf("Check out PR head"),
    "snapshot admission runs before checkout",
  );
  assert.match(
    checkoutBlock,
    /steps\.admission\.outputs\.current == 'true'/u,
    "checkout is impossible for a superseded queued snapshot",
  );
  assert.match(
    startCommentBlock,
    /steps\.admission\.outputs\.current == 'true'/u,
    "superseded queued work does not post a misleading start comment",
  );
  assert.doesNotMatch(
    resolveBlock,
    /thingtime-ai-resolve-start:v1/u,
    "resolver never reuses the historical global start marker",
  );
  assert.match(
    startCommentBlock,
    /this status comment updates with the result/u,
    "start comment promises the in-place terminal update",
  );
  for (const [name, block] of [
    ["start", startCommentBlock],
    ["resolved", resolvedCommentBlock],
    ["failure", failureCommentBlock],
  ]) {
    assert.match(block, /--arg marker "\$RUN_STATUS_MARKER"/u, `${name}: searches for this run's marker`);
    assert.match(block, /contains\(\$marker\)/u, `${name}: matches the complete run marker`);
    assert.match(block, /issues\/comments\/\$comment_id/u, `${name}: updates this run's existing comment`);
    assert.match(block, /issues\/\$PR_NUMBER\/comments/u, `${name}: creates this run's missing comment`);
    assert.match(block, /"\$RUN_STATUS_MARKER"/u, `${name}: preserves the marker in the comment body`);
  }
  for (const [name, block] of [
    ["resolved", resolvedCommentBlock],
    ["failure", failureCommentBlock],
  ]) {
    assert.doesNotMatch(block, /gh pr comment/u, `${name}: does not append a second result comment`);
  }

  for (const [name, block] of [["model_config", modelBlock], ["resolve", resolveBlock]]) {
    assert.match(block, /github\.event_name == 'workflow_dispatch'/, `${name}: event gate`);
    assert.match(block, /inputs\.detector_handoff == true/, `${name}: handoff gate`);
    assert.match(block, /github\.actor == 'github-actions\[bot\]'/, `${name}: actor gate`);
    assert.match(block, /github\.ref_name == 'github-actions'/, `${name}: ref gate`);
    assert.match(block, /inputs\.pr_number != ''/, `${name}: PR gate`);
    assert.match(block, /inputs\.pr_batch_b64 != ''/, `${name}: batch gate`);
    assert.match(block, /inputs\.branch == ''/, `${name}: empty branch gate`);
  }

  const dispatchCount =
    source.match(/actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/g)?.length || 0;
  assert.equal(
    dispatchCount,
    9,
    "conflict detector, Lopu review batch, all-branch push normalization, stacked cascade, moving-ref retry, both promotion continuations, and the post-conflict maintenance pair use fixed workflow dispatch",
  );
  assert.match(
    rebaseSource,
    /event_type:"rebase-pr-stack-ai"/u,
    "rebase roots and children return through the unified Lopu repository event",
  );
  assert.equal(
    rebaseSource.match(/event_type:"rebase-pr-stack-ai"/gu)?.length,
    2,
    "root and child handoffs use the same exact rebase event",
  );
  assert.equal(
    rebaseSource.match(/worker:\{/gu)?.length,
    2,
    "immutable root and child snapshots are nested under one bounded worker payload",
  );
  assert.match(
    rebaseHandoffBlock,
    /permissions:\s+#[^\n]*\n(?:\s+#[^\n]*\n)*\s+contents: write/u,
    "root repository dispatch has the documented Contents write permission",
  );
  const boundedPayloadShape =
    /client_payload:\{\s+pr_number:\$pr_number,\s+execution_provider:\$execution_provider,\s+runner_label:\$runner_label,\s+control_dispatch_id:\$control_dispatch_id,\s+routing_proof:\$routing_proof,\s+routing_proof_issued_at:\$routing_proof_issued_at,\s+worker:\{/u;
  assert.match(
    rebaseHandoffBlock,
    boundedPayloadShape,
    "root dispatch keeps six routing properties plus one nested worker object",
  );
  assert.match(
    rebaseChildDispatchBlock,
    boundedPayloadShape,
    "child dispatch keeps six routing properties plus one nested worker object",
  );
  assert.doesNotMatch(
    rebaseSource,
    /actions\/workflows\/rebase-pr-stacks\.yml\/dispatches/u,
    "the triggerless reusable rebase engine never tries to workflow-dispatch itself",
  );
  assert.match(
    rebaseSource,
    /steps\.push\.outputs\.remote_state == 'retry'[\s\S]*ref_race_handoff:true/u,
    "moving rebase refs release ownership and re-enter Lopu as an automatic detector",
  );
  for (const [name, block] of [
    ["merge publication", mergePushBlock],
    ["rebase publication", rebasePushBlock],
  ]) {
    assert.ok(
      block.indexOf("defer_ref_race()") >= 0 &&
        block.indexOf("defer_ref_race()") < block.indexOf("|| defer_ref_race"),
      `${name}: moving-ref helper is defined in the same Actions step before use`,
    );
  }
  assert.doesNotMatch(
    detectBlock,
    /defer_ref_race\(\)/u,
    "merge detector does not define a publication-only shell helper",
  );
  assert.doesNotMatch(
    rebaseContextBlock,
    /defer_ref_race\(\)/u,
    "rebase context validation does not define a publication-only shell helper",
  );
  assert.match(source, /review_detect:/, "clean PRs have a Lopu review selector");
  assert.match(source, /review_handoff:/, "one review selector handoff exists");
  assert.match(
    source,
    /review_handoff:[\s\S]*?github\.ref_name == 'github-actions'[\s\S]*?workflow_ref[\s\S]*?refs\/heads\/develop[\s\S]*?workflow_ref[\s\S]*?refs\/heads\/main/,
    "the review handoff originates only from the protected controller or a thin main/develop listener",
  );
  assert.match(
    reviewHandoffBlock,
    /format\('lopu-review:\{0\}', github\.run_id\)/u,
    "review handoff uses a default-branch-compatible marker",
  );
  assert.match(
    reviewHandoffBlock,
    /lopu-review:issue-comment:\{0\}:\{1\}/u,
    "issue-comment handoffs preserve the triggering comment id",
  );
  assert.match(
    reviewHandoffBlock,
    /lopu-review:inline-comment:\{0\}:\{1\}/u,
    "inline-comment handoffs preserve the triggering comment id",
  );
  assert.match(
    reviewHandoffBlock,
    /lopu-review:check-run:\{0\}:\{1\}/u,
    "failing-check handoffs preserve the triggering check-run id",
  );
  assert.match(
    reviewHandoffBlock,
    /lopu-review:workflow-run:\{0\}:\{1\}/u,
    "failing-workflow handoffs preserve the triggering workflow-run id",
  );
  assert.match(
    reviewHandoffBlock,
    /concurrency:[\s\S]*?group: lopu-review-handoff-\$\{\{ needs\.review_detect\.outputs\.pr_number \|\| needs\.review_detect\.outputs\.branch \|\| 'all' \}\}[\s\S]*?cancel-in-progress: false/u,
    "review-event handoffs serialize by PR or branch without interrupting an admitted handoff",
  );
  assert.match(
    reviewHandoffBlock,
    /actions\/workflows\/resolve-pr-conflicts\.yml\/runs\?event=workflow_dispatch&per_page=100[\s\S]*?\.display_title == \$title[\s\S]*?\.status == "pending"[\s\S]*?Skipping duplicate Lopu review handoff/u,
    "simultaneous check and PR events coalesce behind one unstarted Lopu review for the same scope",
  );
  assert.match(
    reviewHandoffBlock,
    /An already-running review is deliberately not suppressed/u,
    "a head move during an active review retains one newest follow-up waiter",
  );
  assert.match(
    reviewHandoffBlock,
    /EVENT_NAME: \$\{\{ github\.event_name \}\}/u,
    "the review handoff knows which event it is coalescing",
  );
  assert.match(
    reviewHandoffBlock,
    /case "\$EVENT_NAME" in\n\s+issue_comment \| pull_request_review_comment\) coalescible=false ;;[\s\S]*?if \[ "\$coalescible" = true \]; then[\s\S]*?Skipping duplicate Lopu review handoff/u,
    "human conversation always gets its own session because no queued review carries its comment id",
  );
  assert.match(source, /review:\n\s+name: Lopu reviews selected PRs/, "Lopu has a repository review worker");
  assert.match(source, /group: lopu-agent-fleet-\$\{\{ github\.repository \}\}/, "review shares the single Lopu fleet lock");
  assert.match(source, /lopu-review-\{0\}/, "review batches have a stable concurrency scope");
  assert.match(reviewBlock, /GH_TOKEN: \$\{\{ github\.token \}\}/u, "Lopu receives authenticated GitHub CLI access");
  assert.match(reviewBlock, /no\s+comment quota, template, or topic restriction/u, "Lopu comments are not capped or templated");
  assert.match(reviewBlock, /POST repos\/\$REPO\/issues\/<PR_NUMBER>\/comments/u, "Lopu can post PR conversation comments");
  assert.match(reviewBlock, /POST repos\/\$REPO\/pulls\/<PR_NUMBER>\/comments\/<COMMENT_ID>\/replies/u, "Lopu can reply inline");
  assert.match(reviewBlock, /thingtime-lopu-conversation:v1/u, "Lopu marks its free-form conversational comments");
  assert.match(reviewBlock, /Never\n            edit another actor's comment/u, "Lopu edits only its own comments");
  assert.match(
    reviewBlock,
    /Using \*\*%s\*\*[\s\S]*\$\{REVIEW_BACKEND_LABEL:-Claude Code default\}/u,
    "published Lopu review comments name the actual configured model backend",
  );
  assert.doesNotMatch(
    reviewBlock,
    /\$\{BACKEND_LABEL:-Claude Code default\}/u,
    "review comments never fall back because they read an unset backend-label variable",
  );
  assert.match(reviewBlock, /uses: \.\/trusted\/\.github\/actions\/lopu-agent/u, "review runs through the single protected Lopu action");
  assert.match(reviewBlock, /OPENAI_API_KEY/u, "Codex review uses a GitHub Actions secret");
  assert.match(modelBlock, /LOPU_AGENT_BACKEND/u, "Lopu's global agent backend is repository-configurable");
  assert.match(modelBlock, /LOPU_REVIEW_BACKEND/u, "the historical review backend remains a compatibility fallback");
  assert.match(modelBlock, /gpt-5\.6-terra/u, "Terra is an allowed Lopu Codex model");
  assert.match(modelBlock, /gpt-5\.6-sol/u, "Sol is an allowed Lopu Codex model");
  assert.match(lopuActionSource, /effort: \$\{\{ inputs\.codex-reasoning-effort \}\}/u, "Codex reasoning effort is configured explicitly");
  assert.match(lopuActionSource, /allow-bot-users: \$\{\{ inputs\.allowed-bots \}\}/u, "Codex receives the same closed bot identity as Claude");
  assert.match(lopuActionSource, /anthropics\/claude-code-action@1623c36729ac1cd5895198cded705a287de7db79/u, "Lopu pins its Claude implementation");
  assert.match(lopuActionSource, /openai\/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e/u, "Lopu pins its Codex implementation");
  assert.match(lopuActionSource, /gpt-5\.6-terra\) model_label=/u, "Lopu accepts Terra");
  assert.match(lopuActionSource, /gpt-5\.6-sol\) model_label=/u, "Lopu accepts Sol");
  assert.doesNotMatch(source, /uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/u, "controller workflows never bypass the protected Lopu action");
  assert.doesNotMatch(rebaseSource, /uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/u, "rebase workflows never bypass the protected Lopu action");
  assert.doesNotMatch(rebaseActionSource, /uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/u, "rebase conflict rounds never bypass the protected Lopu action");
  assert.match(reviewBlock, /Publish Lopu's controller\/workflow fix as a PR/u, "controller failures have a dedicated Lopu PR publisher");
  assert.match(
    reviewBlock,
    /gh api repos\/\$REPO\/actions\/runs\/<WORKFLOW_RUN_ID>/u,
    "Lopu retrieves the exact first-party workflow run before diagnosing it",
  );
  assert.match(reviewBlock, /--base github-actions/u, "controller fixes target the protected controller branch");
  assert.match(reviewBlock, /Never push `github-actions`, `main`, or\s+another target\/default branch directly/u, "model may not directly publish protected branches");
  assert.match(reviewBlock, /security-events: read/u, "the model receives read-only CodeQL evidence access");
  assert.doesNotMatch(
    source.slice(source.indexOf("\n  review:"), source.indexOf("\n  codeql_dispositions:")),
    /security-events: write/u,
    "the model-bearing review job cannot mutate CodeQL alert state",
  );
  assert.match(reviewBlock, /codeql_alerts_path/u, "each reviewed PR carries exact CodeQL evidence");
  assert.match(reviewBlock, /codeql_dispositions_path/u, "the model has a structured disposition channel");
  assert.match(reviewBlock, /codeql_authority_b64/u, "pre-model CodeQL authority crosses an immutable step output");
  assert.match(
    reviewBlock,
    /bounded immutable authority snapshot/u,
    "model proposals must match the trusted pre-model CodeQL snapshot",
  );
  assert.match(reviewBlock, /the next CodeQL scan\n\s+will mark it fixed/u, "real findings are fixed through code and a fresh scan");
  assert.match(reviewBlock, /Never dismiss a real issue/u, "real CodeQL findings cannot be greenwashed");
  assert.match(reviewBlock, /Do not use `won't fix`/u, "Lopu never chooses the won't-fix disposition");
  assert.match(
    reviewBlock,
    /\[ "\$current_head" != "\$reviewed_head" \][\s\S]*\[ "\$current_base" != "\$reviewed_base" \]/u,
    "dispositions wait for a fresh scan whenever the reviewed PR head or base changed",
  );
  assert.match(reviewBlock, /current_base_ref=.*\.base\.ref/u, "disposition validation reads the live base ref name");
  assert.match(reviewBlock, /current_base_ref_encoded=.*@uri/u, "live base refs are safely encoded for the GitHub API");
  assert.match(reviewBlock, /git\/ref\/heads\/\$current_base_ref_encoded/u, "disposition validation resolves the current base branch tip");
  assert.doesNotMatch(
    reviewBlock,
    /current_base=.*\.base\.sha/u,
    "disposition validation never confuses the PR's historical base snapshot with the live base branch tip",
  );
  assert.match(reviewBlock, /refs\/pull\/\$number\/head/u, "snapshot accepts default-setup PR-head analyses");
  assert.match(reviewBlock, /refs\/pull\/\$number\/merge/u, "snapshot accepts advanced-setup PR-merge analyses");
  assert.match(reviewBlock, /\.reviewed_base_sha == \$reviewed_base_sha/u, "authority binds the reviewed base revision");
  assert.match(reviewBlock, /\.merge_sha' <<<"\$record"/u, "merge-ref alerts bind the captured merge SHA");
  assert.match(
    reviewBlock,
    /"false positive" \| "used in tests"/u,
    "model proposals use the two evidence-backed disposition reasons",
  );
  assert.match(
    reviewBlock,
    /40 through 280 characters \(GitHub's CodeQL API limit\)/u,
    "the model receives GitHub's live dismissal-comment size boundary",
  );
  assert.equal(
    (source.match(/length >= 40 and length <= 280/g) || []).length,
    2,
    "both trusted CodeQL disposition validators enforce GitHub's 280-character comment limit",
  );
  assert.doesNotMatch(
    reviewBlock,
    /length >= 40 and length <= 1000/u,
    "CodeQL disposition validation cannot accept comments GitHub will reject",
  );
  assert.match(codeqlDispositionBlock, /security-events: write/u, "only the isolated writer can dismiss CodeQL alerts");
  assert.match(
    codeqlDispositionBlock,
    /pull-requests: write/u,
    "the isolated writer can publish its evidence-backed disposition report on the PR timeline",
  );
  assert.doesNotMatch(
    codeqlDispositionBlock,
    /ANTHROPIC_API_KEY|OPENAI_API_KEY|claude-code-action|codex-action/u,
    "the CodeQL writer is credential-free apart from GitHub's scoped token",
  );
  assert.match(codeqlDispositionBlock, /\.head\.sha/u, "writer revalidates the live PR head");
  assert.match(codeqlDispositionBlock, /live_base_ref=.*\.base\.ref/u, "writer reads the live PR base ref name");
  assert.match(codeqlDispositionBlock, /live_base_ref_encoded=.*@uri/u, "writer safely encodes the live base ref");
  assert.match(
    codeqlDispositionBlock,
    /git\/ref\/heads\/\$live_base_ref_encoded/u,
    "writer resolves the live target branch tip rather than trusting a historical PR base snapshot",
  );
  assert.doesNotMatch(
    codeqlDispositionBlock,
    /live_base=.*\.base\.sha/u,
    "writer never confuses the PR's historical base snapshot with the live target branch tip",
  );
  assert.match(
    codeqlDispositionBlock,
    /code-scanning\/alerts\/\$alert_number\/instances\?pr=\$pr_number&per_page=100/u,
    "writer asks GitHub for the alert instances attached to the reviewed PR",
  );
  assert.match(codeqlDispositionBlock, /\.ref == \$analysis_ref/u, "writer revalidates the exact head-or-merge analysis ref");
  assert.match(codeqlDispositionBlock, /\.commit_sha == \$analysis_sha/u, "writer revalidates the exact analysis SHA");
  assert.match(codeqlDispositionBlock, /\.state == "open"/u, "writer requires the exact reviewed alert instance to remain open");
  assert.match(codeqlDispositionBlock, /alert_state=.*\.state \/\/ empty/u, "writer reads GitHub's nullable repository-level alert state");
  assert.match(
    codeqlDispositionBlock,
    /\[ -z "\$alert_state" \][\s\S]*?\.dismissed_at == null[\s\S]*?\.fixed_at == null[\s\S]*?\.most_recent_instance\.state == "open"[\s\S]*?\.most_recent_instance\.ref == \$analysis_ref[\s\S]*?\.most_recent_instance\.commit_sha == \$analysis_sha/u,
    "a transient null alert state is accepted only with the same open immutable instance and no terminal metadata",
  );
  assert.match(
    codeqlDispositionBlock,
    /\.reason == "false positive" or \.reason == "used in tests"/u,
    "writer independently restricts disposition reasons",
  );
  assert.match(codeqlDispositionBlock, /code-scanning\/alerts\/\$alert_number/u, "writer uses the exact alert endpoint");
  assert.match(codeqlDispositionBlock, /thingtime-lopu-codeql:v1/u, "each applied disposition is audited on its PR");
  assert.match(
    reviewBlock,
    /jq -e 'length > 0' "\$proposals"/u,
    "an untouched `[]` disposition file short-circuits before the live head lookup",
  );

  // `${x:-{}}` does not mean "default to an empty object": bash closes the
  // expansion at the first `}`, so the default is `{` and the trailing `}` is
  // appended to whatever the variable held. A populated variable therefore
  // becomes `<value>}`, which fails every downstream `jq` under `set -e`.
  for (const [name, controllerSource] of [
    ["resolve-pr-conflicts.yml", source],
    ["rebase-pr-stacks.yml", rebaseSource],
    ["rebase-conflict-round/action.yml", rebaseActionSource],
  ]) {
    assert.doesNotMatch(
      controllerSource,
      /:-\{\}\}/u,
      `${name} must not use the \${x:-{}} brace-default expansion, which appends a stray brace`,
    );
  }

  assertAdminModelRouting(
    source,
    rebaseSource,
    rebaseActionSource,
    lopuActionSource,
    modelBlock,
    resolveBlock,
  );
}

// Blank lines and `#` comments are not structure. YAML allows both anywhere,
// at any column, and neither one ends a step -- but a boundary scan that reads
// indentation alone treats them as the end, and the window then answers for
// the wrong lines in both directions: backwards it opens below the step's own
// `id:`, forwards it closes above keys the step still owns.
const isStructuralYamlLine = (line) => line.trim() !== "" && !/^\s*#/u.test(line);
const yamlIndent = (line) => /^ */u.exec(line)[0].length;

// Ordinary YAML quoting and spacing are not semantic here, so match the scalar
// rather than one exact spelling of it. `id: 'live_probe'` is the same step as
// `id: live_probe`, and reading it as a different one is not a harmless miss:
// it costs the credential probe its exemption and reports the generic
// slot message against it instead, which is the misdirection
// `assertAdminModelRouting` goes to some length elsewhere to head off.
const yamlScalarPattern = (key, value) =>
  new RegExp(`^[ \\t]*(?:- )?${key}:[ \\t]*(['"]?)${value}\\1[ \\t]*$`, "mu");

// The whole step that owns `lines[index]`: the `- ` marker that opens it,
// every key under that marker, and nothing of the step or job that follows.
// Both bounds come from the step's own indentation, so this does not assume
// the six-space step depth of a workflow job over a composite action's.
//
// The end is keyed to the marker rather than to the matched line, because
// those differ for a step written `- uses:` first: there the matched line *is*
// the marker, every sibling step starts at that same column, and a strictly
// less-indented bound would run the window past them to the end of the job.
export function yamlStepAt(lines, index) {
  const lineIndent = yamlIndent(lines[index]);
  // Not every `- ` line opens a step. One opens *this* step only if it sits
  // shallower than the matched line -- or is that line itself, for a step
  // written `- uses:` first. A sequence nested inside the step is deeper: an
  // `env:` list, an `allowedTools` list, a `- ` bullet inside one of the
  // prompt block scalars these calls all carry. Reading one of those as the
  // marker collapses the window onto that single item, which drops the step's
  // own `id:` out of view -- so the probe falls through to the generic rule
  // and the suite reports "every Lopu call receives the secondary API-key
  // slot" against it. That is exactly the misdirection this window exists to
  // prevent, and a maintainer who applies that message literally hands the
  // vault probe the static slot the exemption is there to keep off it.
  // Verified: adding an `env:` list above the probe's `uses:` reproduces that
  // message on the probe line; the fixtures pin it.
  const opensStep = (cursor) =>
    /^ *- /u.test(lines[cursor]) && (cursor === index || yamlIndent(lines[cursor]) < lineIndent);
  let start = index;
  while (
    start > 0 &&
    !opensStep(start) &&
    (!isStructuralYamlLine(lines[start - 1]) || yamlIndent(lines[start - 1]) >= lineIndent)
  ) {
    start -= 1;
  }
  if (start > 0 && opensStep(start - 1)) start -= 1;
  // Without a marker the step's extent is unknown, so fall back to the matched
  // line's own indentation instead of guessing a wider one.
  const bound = opensStep(start) ? yamlIndent(lines[start]) : lineIndent - 1;
  const offset = lines
    .slice(start + 1)
    .findIndex((line) => isStructuralYamlLine(line) && yamlIndent(line) <= bound);
  return lines.slice(start, offset === -1 ? lines.length : start + 1 + offset).join("\n");
}

function aiRuntimeSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...aiRuntimeSourceFiles(path));
    else if (entry.isFile() && /\.(?:ya?ml|sh)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function assertAdminLoader(block, label) {
  assert.match(block, /https:\/\/thingtime\.com\/api\/v1\/settings\/pr-conflict-auto-resolver-model-waterfall/, `${label}: endpoint`);
  assert.match(block, /Thingtime\.PRConflictAutoResolverModelWaterfall/, `${label}: singleton key`);
  // Composed option ids (`<model>[:<effort>][:fast]`): the loader keeps a
  // closed grammar — id charset, effort segment set, and the Claude base
  // pattern the CLI chain is rebuilt from — instead of a closed id list.
  assert.ok(block.includes("[a-z0-9][a-z0-9.:-]{0,63}"), `${label}: closed composed-id charset`);
  assert.ok(block.includes("none|minimal|low|medium|high|xhigh|max|ultra"), `${label}: closed effort segments`);
  assert.ok(block.includes("^claude-[a-z0-9-]{1,48}$"), `${label}: closed Claude base pattern`);
  assert.ok(block.includes('. + ["default"]'), `${label}: default hard fallback`);
  assert.match(block, /--effort \$claude_effort/, `${label}: session effort in model args`);
  assert.match(block, /model_args=.*GITHUB_OUTPUT/, `${label}: full waterfall output`);
  assert.match(block, /primary_model=.*GITHUB_OUTPUT/, `${label}: primary model output`);
}

function assertAdminModelRouting(
  source,
  rebaseSource,
  rebaseActionSource,
  lopuActionSource,
  modelBlock,
  resolveBlock,
) {
  const rebaseModelBlock = rebaseSource.slice(
    rebaseSource.indexOf("      - name: Load the conflict-resolver model waterfall"),
    rebaseSource.indexOf("      - name: Isolate the real rebasing repository outside model workspace"),
  );
  assertAdminLoader(modelBlock, "merge resolver");
  assertAdminLoader(rebaseModelBlock, "rebase resolver");

  assert.ok(
    !rebaseModelBlock.includes("steps.start.outputs.complete != 'true'"),
    "rebase model loader must also run for clean rebases whose Graphify refresh uses AI",
  );
  assert.ok(source.includes('PREFERRED_MODEL: ${{ needs.model_config.outputs.primary_model }}'));
  assert.ok(rebaseSource.includes('PREFERRED_MODEL: ${{ steps.models.outputs.primary_model }}'));
  for (const [label, yaml] of [["merge resolver", source], ["rebase resolver", rebaseSource]]) {
    assert.ok(yaml.includes('case "${PREFERRED_MODEL:-default}"'), `${label}: validated primary mapping`);
    assert.ok(yaml.includes('graphify_model_args=(--model "$PREFERRED_MODEL")'), `${label}: API model override`);
    assert.ok(yaml.includes('export GRAPHIFY_CLAUDE_CLI_MODEL="$PREFERRED_MODEL"'), `${label}: CLI model override`);
    assert.ok(yaml.includes('"${graphify_model_args[@]}"'), `${label}: Graphify receives primary`);
    assert.doesNotMatch(yaml, /GRAPHIFY_CLAUDE_CLI_MODEL:\s*(?:sonnet|haiku|opus)/, `${label}: no hard-coded Graphify model`);
  }

  assert.ok(source.includes('${{ needs.model_config.outputs.model_args }}'));
  assert.ok(rebaseActionSource.includes('${{ inputs.model-args }}'));
  assert.doesNotMatch(rebaseActionSource, /--model\s+claude-/, "composite action must not choose its own model");
  assert.match(
    rebaseSource,
    /uses: &thingtime_rebase_conflict_round_action \.\/trusted\/\.github\/actions\/rebase-conflict-round/,
    "rebase chain anchors the trusted local action",
  );
  assert.match(
    rebaseSource,
    /name: Check out the exact PR head[\s\S]*?fetch-depth: 0[\s\S]*?filter: blob:none[\s\S]*?persist-credentials: false/u,
    "rebase workers keep complete ancestry while lazily fetching historical blobs",
  );
  assert.match(
    rebaseSource,
    /name: Configure and begin the rebase[\s\S]*?promisor_fetch_failed\(\)[\s\S]*?could not fetch \[0-9a-f\]\{40\} from promisor remote[\s\S]*?--refetch --no-filter origin[\s\S]*?refs\/heads\/\$HEAD_REF:refs\/remotes\/origin\/\$HEAD_REF[\s\S]*?refs\/heads\/\$BASE_REF:refs\/remotes\/origin\/\$BASE_REF[\s\S]*?attempt_start \|\| status=\$\?[\s\S]*?complete-history retry still could not materialize/u,
    "rebase workers retry a refused lazy promisor fetch once from complete exact branch histories",
  );
  assert.match(
    rebaseSource,
    /uses: \*thingtime_rebase_conflict_round_action/,
    "rebase retry step reuses the trusted local action anchor",
  );
  const rebaseRoundAliasCount =
    rebaseSource.match(/^\s{6}- \*thingtime_rebase_conflict_retry$/gmu)?.length || 0;
  const rebaseRoundCount = 2 + rebaseRoundAliasCount;
  const rebaseModelArgsCount = rebaseSource.match(/model-args: \$\{\{ steps\.models\.outputs\.model_args \}\}/g)?.length || 0;
  assert.equal(rebaseRoundCount, 500, "expected 500 bounded rebase conflict rounds");
  assert.equal(rebaseModelArgsCount, 1, "the aliased rebase input map receives the Admin waterfall");
  assert.match(
    rebaseSource,
    /env\.THINGTIME_AI_REBASE_COMPLETE != 'true'/,
    "later aliases stop after the composite records completion",
  );
  assert.match(
    rebaseActionSource,
    /round_number <= 500/,
    "the composite independently enforces the 500-round ceiling",
  );
  assert.equal(
    rebaseActionSource.match(/find \.github\/actions\/lopu-agent -type f -print0/g)?.length || 0,
    3,
    "the protected Lopu action participates in every trusted-tree hash",
  );
  assert.match(
    rebaseActionSource,
    /cp -pR "\$source_trusted\/\.github\/actions\/lopu-agent\/\."[\s\S]*?"\$safe_trusted\/\.github\/actions\/lopu-agent\/"/u,
    "the round bootstrap preserves the protected nested Lopu action outside the model workspace",
  );
  assert.match(
    rebaseActionSource,
    /prepare-round\.sh[\s\S]*?cp -pR "\$SAFE_TRUSTED_PATH\/\.github\/actions\/lopu-agent\/\."[\s\S]*?"\$WORKSPACE_PATH\/trusted\/\.github\/actions\/lopu-agent\/"/u,
    "the protected nested Lopu action is rematerialized after scratch preparation wipes the workspace",
  );
  assert.match(
    rebaseActionSource,
    /Discard the temporary nested action before scratch verification[\s\S]*?\[\[ "\$scratch_abs" == "\$workspace_abs" \]\][\s\S]*?rm -rf -- "\$scratch_abs\/trusted"[\s\S]*?Scratch omitted one or more required conflict files/u,
    "the temporary nested action is discarded before every required-conflict scratch comparison",
  );
  assert.match(
    rebaseActionSource,
    /comm -23 "\$expected_ai_files" "\$actual_files"[\s\S]*?comm -13 "\$expected_ai_files" "\$actual_files"[\s\S]*?additional_file_count > 32 \|\| additional_path_bytes > 8192/u,
    "the round requires every conflict while tightly bounding related scratch edits",
  );
  assert.match(
    rebaseActionSource,
    /strictly\s+read-only inspection context:[\s\S]*?Your only writable\s+submission surface is the current conflict-scratch workspace/u,
    "the model is told that the real rebase checkout is inspection-only",
  );
  assert.match(
    rebaseActionSource,
    /first copy\s+the exact tracked file from the read-only inspection checkout to the\s+same relative path in the current scratch, then edit only that scratch\s+copy/u,
    "related edits are explicitly submitted through verified scratch copies",
  );
  assert.match(
    rebaseActionSource,
    /Creating this scratch submission copy is permitted and does not\s+create a new repository path/u,
    "the related-edit contract does not contradict the no-new-repository-path rule",
  );
  assert.match(
    rebaseActionSource,
    /git ls-files --stage -- ":\(literal\)\$path"[\s\S]*?"\$extra_mode" == 100644[\s\S]*?"\$extra_stage" == 0[\s\S]*?"\$extra_path" == "\$path"/u,
    "related scratch edits are admitted only for exact existing stage-0 regular files",
  );
  assert.match(
    rebaseActionSource,
    /sort -u -- "\$expected_conflicts_full" "\$additional_files" >"\$allowed_staged_paths"[\s\S]*?is_listed "\$path" "\$allowed_staged_paths"/u,
    "the final staged-tree guard includes only conflicts and validated related edits",
  );
  assert.match(
    rebaseActionSource,
    /hash_index_entries\(\)[\s\S]*?git ls-files --stage -z \| sha256_stdin[\s\S]*?EXPECTED_INDEX_ENTRIES_SHA256/u,
    "the rebase verifier fingerprints semantic index entries instead of volatile index-file bytes",
  );
  assert.doesNotMatch(
    rebaseActionSource,
    /sha256_file "\$index_path"/u,
    "the rebase verifier must not compare the volatile on-disk index encoding",
  );
  assert.match(
    rebaseActionSource,
    /cp -pR "\$safe_trusted_abs\/\.github\/actions\/lopu-agent\/\."[\s\S]*?"\$restored\/\.github\/actions\/lopu-agent\/"/u,
    "round cleanup restores the protected nested Lopu action for the next bounded conflict round",
  );
  assert.match(
    rebaseActionSource,
    /cp -p[\s\S]*?"\$source_trusted\/\.github\/scripts\/graphify-cas\.mjs"[\s\S]*?"\$source_trusted\/\.github\/scripts\/stage-graphify-snapshots\.mjs"[\s\S]*?"\$safe_trusted\/\.github\/scripts\/"/u,
    "the safe round copy preserves the trusted Graphify helpers outside the model workspace",
  );
  assert.match(
    rebaseActionSource,
    /cp -p[\s\S]*?"\$safe_trusted_abs\/\.github\/scripts\/graphify-cas\.mjs"[\s\S]*?"\$safe_trusted_abs\/\.github\/scripts\/stage-graphify-snapshots\.mjs"[\s\S]*?"\$restored\/\.github\/scripts\/"/u,
    "round cleanup restores the trusted Graphify helpers needed after conflict replay",
  );
  const roundCleanupBlock = rebaseActionSource.slice(
    rebaseActionSource.indexOf("    - name: Wipe scratch and restore the local action for the next round"),
  );
  assert.match(
    roundCleanupBlock,
    /hash_trusted_tree\(\)[\s\S]*?find \.github\/scripts\/rebase-stack -type f -print0[\s\S]*?\.github\/scripts\/graphify-cas\.mjs[\s\S]*?\.github\/scripts\/stage-graphify-snapshots\.mjs/u,
    "round cleanup fingerprints the same trusted Graphify helpers as bootstrap and verification",
  );
  const verifySafeCopyAt = roundCleanupBlock.indexOf(
    '[[ "$safe_hash" == "$EXPECTED_TRUSTED_SHA256" ]]',
  );
  const clearWorkspaceAt = roundCleanupBlock.indexOf('clear_workspace "$workspace_abs"');
  assert.ok(verifySafeCopyAt >= 0, "round cleanup verifies its immutable safe copy");
  assert.ok(clearWorkspaceAt >= 0, "round cleanup clears model scratch after verification");
  assert.ok(
    verifySafeCopyAt < clearWorkspaceAt,
    "round cleanup must verify the safe copy before clearing the parsed local action",
  );
  assert.match(
    lopuActionSource,
    /thingtime-ci-router-secret:[\s\S]*lopu-credential-vault\.mjs[\s\S]*LOPU_CLAUDE_TOKEN_8/u,
    "the protected Lopu action fetches and exposes the bounded ordered Thingtime credential waterfall",
  );
  assert.match(
    lopuActionSource,
    /classify-claude-credential-failure\.mjs[\s\S]*claude_1_failure\.outputs\.retryable == 'true'[\s\S]*claude_7_failure\.outputs\.retryable == 'true'/u,
    "the protected Lopu action advances slots only after classified account-capacity or credential failures",
  );
  assert.match(
    rebaseActionSource,
    /lopu-claude-credential-token/u,
    "rebase continuations stay on the selected vault credential that owns the exact session",
  );
  assert.match(
    resolveBlock,
    /name: Check out the fixed trusted github-actions control plane[\s\S]*ref: github-actions[\s\S]*path: trusted/u,
    "the conflict worker materializes the protected Lopu action after checking out the PR head",
  );
  assert.match(
    source,
    /  review:\n[\s\S]*?name: Check out the fixed trusted github-actions control plane[\s\S]*?fetch-depth: 0[\s\S]*?filter: blob:none[\s\S]*?persist-credentials: false[\s\S]*?path: trusted/u,
    "repository review keeps complete ancestry while lazily materializing selected PR blobs",
  );

  // One definition of a Lopu call, used both to select the files this contract
  // scans and to pick the calls it enforces credential slots on below. Those
  // were two copies, and they drifted: selection accepted `control-plane/` and
  // enforcement did not, so `all-branch.yml` was pulled into the scanned set by
  // its three lopu-agent calls and then every one of them was skipped. Deriving
  // the wide pattern from the narrow one makes "enforce on every call you
  // selected" a property of the code instead of a comment asking for it.
  const lopuAgentCallPattern = /uses:\s*\.\/(?:trusted\/|control-plane\/)?\.github\/actions\/lopu-agent/u;
  const aiRuntimePattern = new RegExp(
    `(?:anthropics/claude-code-action|openai/codex-action)@|${lopuAgentCallPattern.source}|\\bbackend=(?:"|')?(?:claude|openai)(?:"|')?\\b`,
  );
  const actualRuntimeFiles = [
    ...aiRuntimeSourceFiles(join(REPO_ROOT, ".github", "workflows")),
    ...aiRuntimeSourceFiles(join(REPO_ROOT, ".github", "actions")),
    ...aiRuntimeSourceFiles(join(REPO_ROOT, ".github", "scripts")),
  ]
    .filter((path) => aiRuntimePattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path))
    .sort();
  assert.deepEqual(actualRuntimeFiles, [
    ".github/actions/lopu-agent/action.yml",
    ".github/actions/rebase-conflict-round/action.yml",
    ".github/scripts/rebase-stack/refresh-promotion-graphify.sh",
    ".github/workflows/all-branch.yml",
    ".github/workflows/rebase-pr-stacks.yml",
    ".github/workflows/resolve-pr-conflicts.yml",
  ], "new AI runtime source must be added to the Admin-model contract");

  const promotionGraphify = readFileSync(
    join(REPO_ROOT, ".github/scripts/rebase-stack/refresh-promotion-graphify.sh"),
    "utf8",
  );
  assert.match(promotionGraphify, /GRAPHIFY_BACKEND_PREFERENCE/u, "promotion Graphify follows Lopu's provider choice");
  assert.match(promotionGraphify, /backend=openai/u, "promotion Graphify supports the OpenAI backend");
  assert.match(promotionGraphify, /LOPU_OPENAI_MODEL/u, "promotion Graphify receives Lopu's Terra or Sol model");
  assert.match(
    promotionGraphify,
    /lopu-credential-vault\.mjs" needles "\$needles"[\s\S]*for secret in "\$\{OPENAI_API_KEY:-\}"/u,
    "promotion Graphify scans every provider credential before committing derived output",
  );
  assert.match(promotionGraphify, /--api-timeout 7200/u, "promotion semantic extraction has the repository timeout budget");

  const requiredModelBindings = new Map([
    [".github/actions/lopu-agent/action.yml", "${{ inputs.codex-model }}"],
    [".github/actions/rebase-conflict-round/action.yml", "${{ inputs.model-args }}"],
    [".github/scripts/rebase-stack/refresh-promotion-graphify.sh", 'case "${PREFERRED_MODEL:-default}"'],
    [".github/workflows/all-branch.yml", "${{ steps.models.outputs.model_args }}"],
    [".github/workflows/rebase-pr-stacks.yml", 'PREFERRED_MODEL: ${{ steps.models.outputs.primary_model }}'],
    [".github/workflows/resolve-pr-conflicts.yml", 'PREFERRED_MODEL: ${{ needs.model_config.outputs.primary_model }}'],
  ]);

  for (const path of actualRuntimeFiles) {
    const runtime = readFileSync(join(REPO_ROOT, path), "utf8");
    assert.ok(
      runtime.includes(requiredModelBindings.get(path)),
      `${path}: runtime must consume its validated Admin-model handoff`,
    );
    assert.doesNotMatch(runtime, /claude-opus-4-8/, `${path}: obsolete hard-coded model`);
    assert.doesNotMatch(
      runtime,
      /GRAPHIFY_CLAUDE_CLI_MODEL\s*[:=]\s*["']?(?:sonnet|haiku|opus|claude-)/,
      `${path}: Graphify model must come from the Admin handoff`,
    );

    const lines = runtime.split("\n");
    // Nearest enclosing job for a step line. Inside `jobs:` the only
    // two-space-indented bare key is a job name (a job's own `env:`/`steps:`
    // sit at four, its steps at six), so walking back to the first one names
    // the job that owns this call. Outside `jobs:` it returns whatever
    // two-space key happens to precede -- `steps` in a composite `action.yml`,
    // whose `runs:` sits at zero -- so treat the result as a name to compare,
    // never as proof that a job was found. Only the exact string below is
    // exempt, so every other answer, right or meaningless, denies the
    // exemption and applies the generic rule.
    const enclosingJob = (line) => {
      for (let cursor = line; cursor >= 0; cursor -= 1) {
        const header = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(lines[cursor]);
        if (header) return header[1];
      }
      return null;
    };
    // The probe exemption below keys on this job name, so losing the name
    // retires the exemption without retiring the probe. That direction is
    // fail-closed, but its message is not: the probe falls through to the
    // generic rule and reports "every Lopu call receives the secondary
    // API-key slot", and a maintainer who acts on that message literally
    // hands the vault probe a static slot -- the masking regression the
    // exemption exists to prevent -- whereupon the contract goes green on it.
    // Verified: rename the job and the suite reports exactly that line, and
    // adding the two slots it asks for turns the suite green. Name the real
    // cause here so that misdirecting message is never the one that gets read.
    if (path === ".github/workflows/resolve-pr-conflicts.yml") {
      assert.ok(
        lines.some((line) => /^ {2}verify_credential_vault:\s*$/u.test(line)),
        `${path}: the credential-probe exemption keys on the verify_credential_vault job, which is missing`,
      );
    }
    for (let index = 0; index < lines.length; index += 1) {
      // The same pattern `aiRuntimePattern` is built from, so this rule cannot
      // cover fewer call sites than the scan that selected the file. Widening
      // it to `control-plane/` is what brings `all-branch.yml`'s three calls
      // under the slot assertions below; they all pass both slots today, so
      // this closed a latent hole rather than a live one.
      if (!lopuAgentCallPattern.test(lines[index])) {
        continue;
      }
      const call = lines.slice(index, index + 32).join("\n");
      // The live credential-vault probe is the one deliberate exception. Its
      // whole job is to prove Thingtime's ordered waterfall still authenticates
      // on its own, so it passes only `thingtime-ci-router-secret` and none of
      // the legacy static slots. Handing it a fallback would let it pass on the
      // fallback while the vault is down -- masking exactly the outage the probe
      // exists to catch. Exempt it, but require it to still be vault-driven, so
      // this stays a checked exception rather than an unconditional skip.
      //
      // The exemption is keyed on the JOB as well as the step id, because a
      // bare `id: live_probe` is not an identity: any step in any job may
      // adopt that id, and a real secret-bearing worker that did would
      // silently shed both fallback-slot assertions below while this contract
      // stayed green. A job boundary cannot be adopted that way. Rename or
      // drop `verify_credential_vault` and the probe simply stops being
      // exempt -- it then fails the generic rule, which is the fail-closed
      // direction for a credential contract.
      const inVaultProbeJob = enclosingJob(index) === "verify_credential_vault";
      // This call's whole step, used both to find its `id:` and to scope the
      // probe assertions below: the `- ` marker that opens the step, every key
      // under it, and nothing of the step or job that follows. `call` is a
      // fixed 32-line window that here runs past this step and into the next
      // job, so a negative assertion over it would answer for lines the step
      // does not own. Both bounds come from the `uses:` line's own
      // indentation, so this does not assume the six-space step depth of a
      // workflow job over a composite action's.
      //
      // The id is taken from the step rather than from a fixed count of lines
      // above the `uses:`, because that window is what decides whether the
      // exemption applies and a fixed one ties it to the probe's current
      // shape. Give the probe a `continue-on-error:` and a small `env:` and
      // the `id:` slides out of view: the probe falls through to the generic
      // rule, and the suite reports "every Lopu call receives the secondary
      // API-key slot" against the probe line. A maintainer who applies that
      // message literally hands the vault probe a static slot -- the masking
      // regression this exemption exists to prevent -- and the suite goes
      // green on it. That is the same misdirection the missing-job assertion
      // above is there to head off, reached by ordinary step maintenance
      // instead of a rename, so bound it by the step and it cannot happen.
      // `yamlStepAt` is what makes that bound hold for ordinary YAML: a blank
      // line or a `#` note inside the probe, or an `id:` someone quoted, each
      // used to drop the step's `id:` out of the window and produce exactly
      // that message. Its fixtures pin all three.
      const step = yamlStepAt(lines, index);
      if (inVaultProbeJob && yamlScalarPattern("id", "live_probe").test(step)) {
        // Assert both halves of the exemption, not just the positive one.
        // Requiring the router secret proves the probe can reach the
        // waterfall; it does not stop the probe from *also* being handed a
        // static slot, and a probe carrying one authenticates on that slot and
        // reports green while the vault is down -- the exact outage it exists
        // to catch, and the exact reason the paragraph above gives for
        // exempting it. Left unasserted, the exemption rests on a property
        // nothing checks, which is how it silently becomes an unconditional
        // skip for the one call site allowed to carry no slots.
        // Carrying the router secret is not the same as using it. The action
        // fetches the ordered bundle in a step gated on
        // `inputs.backend == 'claude'` (lopu-agent/action.yml), so on any other
        // backend the secret is inert and the waterfall is never touched.
        // Verified: flip this step to `backend: codex` and every one of the
        // eleven advisory contracts stays green while the live vault check the
        // job is named for silently stops running -- the exemption would go on
        // paying out for a probe that no longer probes anything, which is the
        // unconditional skip the paragraph above refuses to grant.
        assert.match(
          step,
          yamlScalarPattern("backend", "claude"),
          `${path}:${index + 1}: the credential probe must run the Claude backend that fetches the Thingtime waterfall`,
        );
        assert.match(
          step,
          /^\s+thingtime-ci-router-secret:/mu,
          `${path}:${index + 1}: the credential probe must authenticate through the Thingtime waterfall`,
        );
        assert.doesNotMatch(
          step,
          /^\s+(?:anthropic-api-key|claude-code-oauth-token)(?:-preferred|-fallback)?:/mu,
          `${path}:${index + 1}: the credential probe must exercise only the Thingtime waterfall, never a static slot`,
        );
        continue;
      }
      assert.match(
        call,
        /anthropic-api-key-fallback:/u,
        `${path}:${index + 1}: every Lopu call receives the secondary API-key slot`,
      );
      assert.match(
        call,
        /claude-code-oauth-token-fallback:/u,
        `${path}:${index + 1}: every Lopu call receives the secondary subscription slot`,
      );
    }
  }
}

export function selfTest() {
  const trustedBatch = encodeBatch([
    { number: 190, manual_retry: true },
    { number: 220, manual_retry: false },
  ]);

  assertRoute("human blank", {
    event: "workflow_dispatch", ref: "feature/ref", actor: "lopugit",
  }, {
    valid: true,
    detectorOnly: true,
    handoffEligible: true,
    scanAll: true,
    manualRetry: false,
    selector: "all",
    concurrency: "resolve-detect-all-open",
    cancelInProgress: true,
    modelAndResolve: false,
  });

  for (const label of ["human base", "human head"]) {
    assertRoute(label, {
      event: "workflow_dispatch", ref: "develop", actor: "lopugit",
      branch: label === "human base" ? "develop" : "feature/friends",
    }, {
      valid: true,
      detectorOnly: true,
      handoffEligible: true,
      scanHead: true,
      manualRetry: true,
      selector: `base-or-head:${label === "human base" ? "develop" : "feature/friends"}`,
      modelAndResolve: false,
    });
  }

  assertRoute("human exact PR", {
    event: "workflow_dispatch", ref: "feature/ref", actor: "lopugit", prNumber: "190",
  }, {
    valid: true,
    detectorOnly: true,
    handoffEligible: true,
    manualRetry: true,
    selector: "pr:190",
    concurrency: "resolve-detect-pr190",
    cancelInProgress: true,
    modelAndResolve: false,
  });

  assertRoute("automatic moving-ref retry", {
    event: "workflow_dispatch",
    ref: "github-actions",
    actor: "github-actions[bot]",
    prNumber: "190",
    refRaceHandoff: true,
  }, {
    valid: true,
    detectorOnly: true,
    handoffEligible: true,
    humanExplicit: false,
    manualRetry: false,
    refRaceHandoff: true,
    selector: "pr:190",
    concurrency: "resolve-detect-pr190",
    cancelInProgress: true,
    modelAndResolve: false,
  });

  for (const [name, event] of [
    ["human PR conversation", "issue_comment"],
    ["human inline review conversation", "pull_request_review_comment"],
  ]) {
    assertRoute(name, {
      event, ref: "main", actor: "lopugit", eventPrNumber: "190",
    }, {
      valid: true,
      detectorOnly: true,
      handoffEligible: true,
      selector: "pr:190",
      concurrency: "lopu-conversation-pr190",
      modelAndResolve: false,
    });
  }

  assertRoute("failing PR check", {
    event: "check_run", ref: "main", actor: "github-actions[bot]", eventPrNumber: "190",
  }, {
    valid: true,
    detectorOnly: true,
    handoffEligible: true,
    selector: "pr:190",
    concurrency: "lopu-check-fix-pr190",
    modelAndResolve: false,
  });

  assertRoute("failing PR workflow", {
    event: "workflow_run", ref: "main", actor: "github-actions[bot]", eventPrNumber: "190",
  }, {
    valid: true,
    detectorOnly: true,
    handoffEligible: true,
    selector: "pr:190",
    concurrency: "lopu-workflow-fix-pr190",
    modelAndResolve: false,
  });

  assertRoute("machine worker", {
    event: "workflow_dispatch", ref: "github-actions", actor: "github-actions[bot]",
    prNumber: "190", detectorHandoff: true,
  }, {
    valid: true,
    internalWorker: true,
    detectorOnly: false,
    handoffEligible: false,
    manualRetry: false,
    selector: "pr:190",
    concurrency: "resolve-worker-run",
    cancelInProgress: false,
    modelAndResolve: true,
  });

  assertRoute("machine batch worker", {
    event: "workflow_dispatch", ref: "github-actions", actor: "github-actions[bot]",
    prBatchB64: trustedBatch, detectorHandoff: true, runId: "batch-123",
  }, {
    valid: true,
    internalWorker: true,
    detectorOnly: false,
    handoffEligible: false,
    manualRetry: false,
    batchSize: 2,
    selector: "batch:2",
    concurrency: "resolve-worker-batch-123",
    cancelInProgress: false,
    modelAndResolve: true,
  });

  assertRoute("CI control App cannot become an exact secret-bearing worker", {
    event: "workflow_dispatch", ref: "github-actions", actor: "thingtime-ci-control[bot]",
    prNumber: "190", detectorHandoff: true,
  }, {
    valid: false,
    internalWorker: false,
    detectorOnly: true,
    handoffEligible: false,
    modelAndResolve: false,
  });

  assertRoute("machine retry worker", {
    event: "workflow_dispatch", ref: "github-actions", actor: "github-actions[bot]",
    prNumber: "190", detectorHandoff: true, manualRetry: true,
  }, {
    valid: true,
    internalWorker: true,
    manualRetry: true,
    modelAndResolve: true,
  });

  const unsortedBatch = Buffer.from(JSON.stringify([
    { manual_retry: false, number: 220 },
    { manual_retry: false, number: 190 },
  ])).toString("base64");
  for (const [name, overrides, error] of [
    ["machine malformed batch", { prBatchB64: "not-base64" }, "invalid PR batch"],
    ["machine unsorted batch", { prBatchB64: unsortedBatch }, "invalid PR batch"],
    ["machine batch plus exact PR", { prNumber: "190", prBatchB64: trustedBatch }, "mutually exclusive PR selectors"],
    ["machine batch plus top-level retry", { prBatchB64: trustedBatch, manualRetry: true }, "batch with top-level manual retry"],
    [
      "machine oversized batch",
      { prBatchB64: encodeBatch(Array.from({ length: 201 }, (_, index) => ({ number: index + 1 }))) },
      "invalid PR batch",
    ],
  ]) {
    const result = route({
      event: "workflow_dispatch", ref: "github-actions", actor: "github-actions[bot]",
      prNumber: "", detectorHandoff: true, ...overrides,
    });
    assert.equal(result.valid, false, name);
    assert.equal(result.modelAndResolve, false, `${name}: no secret-bearing worker`);
    assert.ok(result.errors.includes(error), `${name}: ${error}`);
  }

  assertRoute("human cannot inject a PR batch", {
    event: "workflow_dispatch", ref: "github-actions", actor: "lopugit",
    prBatchB64: trustedBatch,
  }, {
    valid: false,
    internalWorker: false,
    handoffEligible: false,
    scanAll: false,
    concurrency: "resolve-invalid-batch-run",
    modelAndResolve: false,
  });

  for (const [name, overrides, error] of [
    ["machine wrong ref", { ref: "main" }, "invalid internal handoff"],
    ["machine wrong actor", { actor: "lopugit" }, "invalid internal handoff"],
    ["machine branch present", { branch: "develop" }, "invalid internal handoff"],
    ["machine missing PR", { prNumber: "" }, "invalid internal handoff"],
    ["machine zero PR", { prNumber: "0" }, "invalid PR number"],
    ["machine non-decimal PR", { prNumber: "190x" }, "invalid PR number"],
    ["machine excessive depth", { depth: "4" }, "invalid depth"],
    ["machine non-decimal depth", { depth: "x" }, "invalid depth"],
  ]) {
    const result = route({
      event: "workflow_dispatch", ref: "github-actions", actor: "github-actions[bot]",
      prNumber: "190", detectorHandoff: true, ...overrides,
    });
    assert.equal(result.valid, false, name);
    assert.equal(result.modelAndResolve, false, `${name}: no secret-bearing worker`);
    assert.ok(result.errors.includes(error), `${name}: ${error}`);
  }

  assertRoute("human cannot inject retry metadata", {
    event: "workflow_dispatch", ref: "develop", actor: "lopugit",
    prNumber: "190", manualRetry: true,
  }, {
    valid: false,
    modelAndResolve: false,
  });

  assertRoute("legacy repository dispatch", {
    event: "repository_dispatch", ref: "main", actor: "github-actions[bot]",
    target: "feature/parent", depth: "1",
  }, {
    valid: true,
    detectorOnly: true,
    handoffEligible: true,
    manualRetry: false,
    selector: "base:feature/parent",
    concurrency: "resolve-detect-legacy-feature/parent",
    cancelInProgress: true,
    modelAndResolve: false,
  });

  assertWorkflowSource();
  console.log("resolve-pr-conflicts routing contract: self-test OK");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.error("Pass --self-test to run the resolver routing contract.");
  process.exitCode = 2;
}
