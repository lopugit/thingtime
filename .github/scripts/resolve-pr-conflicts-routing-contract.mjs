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
import { fileURLToPath } from "node:url";

const WORKFLOW_URL = new URL("../workflows/resolve-pr-conflicts.yml", import.meta.url);
const REBASE_WORKFLOW_URL = new URL("../workflows/rebase-pr-stacks.yml", import.meta.url);
const REBASE_ACTION_URL = new URL("../actions/rebase-conflict-round/action.yml", import.meta.url);
const LOPU_ACTION_URL = new URL("../actions/lopu-agent/action.yml", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const positiveDecimal = (value) => /^[1-9][0-9]*$/.test(value);
const validDepth = (value) => /^[0-9]+$/.test(value) && Number(value) <= 3;

export function route(input) {
  const event = String(input.event || "");
  const ref = String(input.ref || "");
  const actor = String(input.actor || "");
  const prNumber = String(input.prNumber || "");
  const eventPrNumber = String(input.eventPrNumber || "");
  const branch = String(input.branch || "");
  const target = branch || String(input.target || ref);
  const depth = String(input.depth ?? "0");
  const detectorHandoff = input.detectorHandoff === true;
  const routedManualRetry = input.manualRetry === true;
  const refRaceHandoff = input.refRaceHandoff === true;

  const errors = [];
  if (!validDepth(depth)) errors.push("invalid depth");
  if (prNumber && !positiveDecimal(prNumber)) errors.push("invalid PR number");
  if (routedManualRetry && !detectorHandoff) {
    errors.push("manual retry without detector handoff");
  }

  const internalShape =
    event === "workflow_dispatch" &&
    detectorHandoff &&
    ref === "github-actions" &&
    actor === "github-actions[bot]" &&
    positiveDecimal(prNumber) &&
    branch === "";
  if (detectorHandoff && !internalShape) errors.push("invalid internal handoff");

  const valid = errors.length === 0;
  const internalWorker = valid && internalShape;
  const humanDispatch =
    event === "workflow_dispatch" && !detectorHandoff && !refRaceHandoff;
  const humanExplicit = humanDispatch && Boolean(prNumber || branch);
  const conversationEvent =
    event === "issue_comment" || event === "pull_request_review_comment";
  const failedCheckEvent = event === "check_run";
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
    : (conversationEvent || failedCheckEvent) && eventPrNumber
      ? `pr:${eventPrNumber}`
    : scanAll
      ? "all"
      : scanHead
        ? `base-or-head:${target}`
        : `base:${target}`;

  let concurrency;
  if (internalShape) concurrency = `resolve-pr${prNumber}`;
  else if (event === "workflow_dispatch" && prNumber) {
    concurrency = `resolve-detect-pr${prNumber}`;
  } else if (event === "workflow_dispatch" && branch) {
    concurrency = `resolve-detect-selector-${branch}`;
  } else if (failedCheckEvent && eventPrNumber) {
    concurrency = `lopu-check-fix-pr${eventPrNumber}`;
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
  assert.match(source, /format\('resolve-pr\{0\}'/);
  assert.match(source, /github\.actor == 'github-actions\[bot\]'/);
  assert.doesNotMatch(
    source,
    /github\.actor == 'thingtime-ci-control\[bot\]'/,
    "CI Control App runs are detectors only; GITHUB_TOKEN creates exact workers",
  );
  assert.match(source, /github\.ref_name == 'github-actions'/);
  assert.match(source, /inputs\.detector_handoff == true/);
  assert.match(source, /manual_retry is internal routing state and requires detector_handoff/);
  assert.match(
    source,
    /gh_read_retry\(\) \{[\s\S]*for attempt in 1 2 3 4[\s\S]*HTTP \(408\|429\|500\|502\|503\|504\)[\s\S]*1 << attempt/u,
    "read-only GitHub API calls retry a bounded set of transient failures with backoff",
  );
  assert.match(
    source,
    /gh_read_retry graphql --paginate --slurp[\s\S]*successful but malformed PR inventory response/u,
    "the GraphQL PR inventory is parsed only after transport success and response-shape validation",
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
  assert.match(source, /issue_comment:\n    types: \[created, edited\]/u, "human PR comments wake Lopu");
  assert.match(
    source,
    /pull_request_review_comment:\n    types: \[created, edited\]/u,
    "human inline review comments wake Lopu",
  );
  assert.match(source, /check_run:\n    types: \[completed\]/u, "failed PR checks wake Lopu");
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
    reviewDetectBlock,
    /github\.event_name != 'repository_dispatch'[\s\S]*inputs\.ref_race_handoff != true/u,
    "internal events and automatic rebase retries never launch a duplicate whole-PR review",
  );
  assert.match(
    source,
    /github\.event\.check_run\.pull_requests\[0\]\.number[\s\S]*?github\.event\.check_run\.conclusion == 'failure'/u,
    "only PR-associated failing checks enter the Lopu route",
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
    graphifyBlock.indexOf("graphify update .") < graphifyBlock.indexOf("graphify extract ."),
    "structural Graphify extraction runs before LLM semantic extraction",
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
    assert.match(block, /inputs\.branch == ''/, `${name}: empty branch gate`);
  }

  const dispatchCount =
    source.match(/actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/g)?.length || 0;
  assert.equal(
    dispatchCount,
    7,
    "conflict detector, Lopu review batch, all-branch push normalization, stacked cascade, moving-ref retry, and both promotion continuations (stack resume, recoverable retry) use fixed workflow dispatch",
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
  assert.match(codeqlDispositionBlock, /security-events: write/u, "only the isolated writer can dismiss CodeQL alerts");
  assert.doesNotMatch(
    codeqlDispositionBlock,
    /ANTHROPIC_API_KEY|OPENAI_API_KEY|claude-code-action|codex-action/u,
    "the CodeQL writer is credential-free apart from GitHub's scoped token",
  );
  assert.match(codeqlDispositionBlock, /\.head\.sha/u, "writer revalidates the live PR head");
  assert.match(codeqlDispositionBlock, /\.base\.sha/u, "writer revalidates the live PR base");
  assert.match(codeqlDispositionBlock, /\$alert_ref" != "\$analysis_ref/u, "writer revalidates the exact head-or-merge analysis ref");
  assert.match(codeqlDispositionBlock, /\$alert_sha" != "\$analysis_sha/u, "writer revalidates the exact analysis SHA");
  assert.match(codeqlDispositionBlock, /most_recent_instance\.commit_sha/u, "writer revalidates the alert's reviewed commit");
  assert.match(codeqlDispositionBlock, /\.state' <<<"\$alert"\)" != open/u, "writer only changes open alerts");
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
  // Thingtime's Admin catalog is open and spans providers, and entries compose
  // as `<model>[:<effort>][:fast]`. The loader therefore validates entry SHAPE
  // against an injection-safe charset (no space, quote, comma, or leading dash
  // survives it) and takes provider eligibility from the response's own
  // catalog, instead of pinning a model list that would drift out of date.
  assert.ok(
    block.includes('^[a-z0-9][a-z0-9.-]{0,47}(:[a-z]{1,8}){0,2}$'),
    `${label}: charset-gates every stored waterfall entry`,
  );
  assert.ok(block.includes("length >= 1 and length <= 512"), `${label}: bounds the stored order`);
  assert.ok(block.includes("select(length == (unique | length))"), `${label}: rejects duplicates`);
  assert.ok(block.includes('.provider == "anthropic"'), `${label}: provider eligibility from the response`);
  assert.ok(block.includes('base="${id%%:*}"'), `${label}: strips variant segments before the CLI`);
  assert.ok(block.includes("default"), `${label}: keeps the default sentinel`);
  assert.doesNotMatch(block, /\bclaude-(?:[a-z]+-)?\d[a-z0-9.-]*/iu, `${label}: pins no model id`);
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
    /cp -pR "\$safe_trusted_abs\/\.github\/actions\/lopu-agent\/\."[\s\S]*?"\$restored\/\.github\/actions\/lopu-agent\/"/u,
    "round cleanup restores the protected nested Lopu action for the next bounded conflict round",
  );
  assert.match(
    lopuActionSource,
    /anthropic-api-key-fallback:[\s\S]*claude-code-oauth-token-fallback:/u,
    "the protected Lopu action exposes an ordered secondary Anthropic account slot",
  );
  assert.match(
    lopuActionSource,
    /classify-claude-credential-failure\.mjs[\s\S]*claude_primary_failure\.outputs\.retryable == 'true'/u,
    "the protected Lopu action falls back only after classified account-capacity or credential failures",
  );
  assert.match(
    rebaseActionSource,
    /lopu-claude-credential-slot/u,
    "rebase continuations stay on the Claude credential slot that owns the exact session",
  );
  assert.match(
    resolveBlock,
    /name: Check out the fixed trusted github-actions control plane[\s\S]*ref: github-actions[\s\S]*path: trusted/u,
    "the conflict worker materializes the protected Lopu action after checking out the PR head",
  );

  const aiRuntimePattern =
    /(?:anthropics\/claude-code-action|openai\/codex-action)@|uses:\s*\.\/(?:trusted\/|control-plane\/)?\.github\/actions\/lopu-agent|\bbackend=(?:"|')?(?:claude|openai)(?:"|')?\b/;
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
    /for secret in "\$\{OPENAI_API_KEY:-\}" "\$primary_anthropic_api_key"[\s\S]*"\$primary_claude_code_oauth_token" "\$\{ANTHROPIC_API_KEY_FALLBACK:-\}"[\s\S]*"\$\{CLAUDE_CODE_OAUTH_TOKEN_FALLBACK:-\}"/u,
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
    for (let index = 0; index < lines.length; index += 1) {
      if (!/uses:\s*\.\/(?:trusted\/)?\.github\/actions\/lopu-agent/u.test(lines[index])) {
        continue;
      }
      const call = lines.slice(index, index + 32).join("\n");
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
    concurrency: "resolve-pr190",
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
