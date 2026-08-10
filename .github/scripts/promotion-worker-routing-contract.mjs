#!/usr/bin/env node

// No-network source and predicate contract for the pre-PR promotion worker.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../workflows/resolve-pr-conflicts.yml", import.meta.url),
  "utf8",
);
const action = readFileSync(
  new URL("../actions/rebase-conflict-round/action.yml", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("./rebase-stack/promotion-worker.sh", import.meta.url),
  "utf8",
);
const prepareRound = readFileSync(
  new URL("./rebase-stack/prepare-round.sh", import.meta.url),
  "utf8",
);
const graphify = readFileSync(
  new URL("./rebase-stack/refresh-promotion-graphify.sh", import.meta.url),
  "utf8",
);
const promoter = readFileSync(
  new URL("./promote-features-to-main.mjs", import.meta.url),
  "utf8",
);

export function trustedPromotionRoute(input) {
  return input.event === "workflow_dispatch" &&
    input.actor === "github-actions[bot]" &&
    input.ref === "github-actions" &&
    /^[1-9][0-9]*$/.test(String(input.sourcePr || "")) &&
    typeof input.planB64 === "string" && input.planB64.length > 0 &&
    input.executionProvider === "github-actions" &&
    !input.runnerLabel &&
    !input.controlDispatchId &&
    !input.prNumber &&
    !input.branch &&
    input.detectorHandoff !== true &&
    input.manualRetry !== true &&
    input.depth === "0";
}

assert.equal(trustedPromotionRoute({
  event: "workflow_dispatch", actor: "github-actions[bot]",
  ref: "github-actions", sourcePr: "207", planB64: "e30=", executionProvider: "github-actions", prNumber: "", branch: "", detectorHandoff: false,
  manualRetry: false, depth: "0",
}), true);
for (const override of [
  { event: "push" }, { actor: "lopugit" }, { ref: "main" }, { sourcePr: "" }, { planB64: "" },
  { executionProvider: "vercel-sandbox" }, { runnerLabel: "thingtime-runner" }, { controlDispatchId: "dispatch-1" },
  { sourcePr: "0" }, { sourcePr: "207x" }, { prNumber: "207" },
  { branch: "develop" }, { detectorHandoff: true }, { manualRetry: true }, { depth: "1" },
]) {
  assert.equal(trustedPromotionRoute({
    event: "workflow_dispatch", actor: "github-actions[bot]",
    ref: "github-actions", sourcePr: "207", planB64: "e30=", executionProvider: "github-actions", prNumber: "", branch: "", detectorHandoff: false,
    manualRetry: false, depth: "0",
    ...override,
  }), false);
}

assert.match(workflow, /if: inputs\.promotion_source_pr == '' && inputs\.promotion_plan_b64 == ''/);
assert.doesNotMatch(workflow, /promotion_handoff:/);
assert.match(workflow, /Promotion handoff cannot use external compute routing/);
assert.match(workflow, /Promotion handoff cannot carry external runner metadata/);
assert.match(workflow, /promotion_plan_b64:/);
assert.match(
  workflow,
  /const keys = \['base_ref','base_sha','branch','reservation_sha','source_tip_sha','source_start_sha','source_end_sha','source_lineage_status','plan_hash','title_b64','body_b64'\]/,
);
assert.doesNotMatch(workflow, /promotion_base_sha:\s*\n\s*description:/);
assert.match(workflow, /resolve-invalid-promotion-\{0\}/);
assert.match(workflow, /github\.actor == 'github-actions\[bot\]'/);
assert.match(workflow, /github\.ref_name == 'github-actions'/);
assert.doesNotMatch(workflow, /github\.ref_name == 'develop'/);
assert.match(workflow, /inputs\.pr_number == ''/);
assert.match(workflow, /inputs\.branch == ''/);
assert.match(workflow, /inputs\.detector_handoff != true/);
assert.match(workflow, /inputs\.manual_retry != true/);
assert.match(workflow, /inputs\.depth == '0'/);
assert.match(workflow, /conflict-policy: promotion/);
assert.match(workflow, /Independently re-derive the source patch boundary/);
assert.match(workflow, /--force-with-lease="refs\/heads\/\$PROMOTION_BRANCH:\$RESERVATION_SHA"/);
assert.match(workflow, /thingtime-ai-promotion-resolved:v1/);
assert.match(workflow, /thingtime-ai-promotion-paused:v1/);
assert.match(workflow, /\[ "\$SOURCE_LINEAGE_STATUS" = verified \]/);
assert.match(workflow, /source-lineage safety block: trusted promotion workers require a historical patch proven present at current develop/);
assert.doesNotMatch(workflow, /verified\|review-required-removed\|review-required-ambiguous/);
assert.match(workflow, /source_lineage_status: \$\{\{ steps\.validate\.outputs\.source_lineage_status \}\}/);
assert.match(workflow, /SOURCE_LINEAGE_STATUS: \$\{\{ needs\.promotion_validate\.outputs\.source_lineage_status \}\}/);
assert.match(workflow, /value\.source_lineage_status === process\.env\.SOURCE_LINEAGE_STATUS/);
assert.match(workflow, /source_lineage_status:\$source_lineage_status/);
assert.match(workflow, /actions\/workflows\/promote-features-to-main\.yml\/dispatches/);
assert.match(workflow, /paused_label=.*ai-promotion-paused/);
assert.match(workflow, /\[ "\$paused" = true \] && \[ "\$paused_label" = true \]/);
assert.match(workflow, /CONFLICT_PATHS: \$\{\{ steps\.promotion_ai_round\.outputs\.ai_conflict_paths \}\}/);
assert.doesNotMatch(workflow, /CONFLICT_PATHS: \$\{\{ steps\.prepare_promotion\.outputs\.conflict_paths \}\}/);
assert.match(workflow, /CI_SENSITIVE_PATHS: \$\{\{ steps\.prepare_promotion\.outputs\.ci_sensitive_paths \}\}/);
assert.match(workflow, /REVIEW_GATED: \$\{\{ steps\.prepare_promotion\.outputs\.review_gated \}\}/);
assert.match(workflow, /\[skip ci\]/);
assert.match(workflow, /Thingtime-Promotion-Review-Checkpoint: v1/);
assert.match(workflow, /Thingtime-Promotion-Content-Head: \$content_head/);
assert.match(workflow, /echo "\$attestation"\s+echo "\$checkpoint_attestation"/);
assert.match(workflow, /thingtime-ai-promotion-checkpoint-pending:v1 \$PLAN_HASH/);
assert.match(workflow, /Remove the pending marker only after the live remote accepted/);
assert.match(workflow, /model_args:\$model_args,graphify_mode:\$graphify_mode,graphify_semantic:\$graphify_semantic,ci_sensitive:\$ci_sensitive/);
assert.match(workflow, /MODEL_ARGS} <= 2048/);
assert.match(workflow, /payload.*wc -c.*<= 30000/s);
assert.match(workflow, /checkpoint_basic=.*DEFAULT_TOKEN/);
assert.match(workflow, /if \[ "\$REVIEW_GATED" = true \]; then/);
assert.match(workflow, /unexpectedly retained an authentication header/);
assert.match(workflow, /--force-with-lease="refs\/heads\/\$PROMOTION_BRANCH:\$content_head"/);
assert.match(workflow, /\$checkpoint_head:refs\/heads\/\$PROMOTION_BRANCH/);
const pendingMarker = "thingtime-ai-promotion-checkpoint-pending:v1 $PLAN_HASH";
const firstPending = workflow.indexOf(pendingMarker);
const contentPush = workflow.indexOf('--force-with-lease="refs/heads/$PROMOTION_BRANCH:$RESERVATION_SHA"', firstPending);
const checkpointPending = workflow.indexOf(pendingMarker, firstPending + pendingMarker.length);
const checkpointPush = workflow.indexOf('--force-with-lease="refs/heads/$PROMOTION_BRANCH:$content_head"', checkpointPending);
const pendingRemoval = workflow.indexOf("Remove the pending marker only after the live remote accepted", checkpointPush);
assert.ok(firstPending > 0 && firstPending < contentPush);
assert.ok(contentPush < checkpointPending && checkpointPending < checkpointPush);
assert.ok(checkpointPush < pendingRemoval);
assert.match(workflow, /retry_without_pause=true/);
assert.match(workflow, /TERMINAL_REVIEW_NEEDED:/);

const aiBlock = workflow.slice(
  workflow.indexOf("      - name: Resolve the synthetic promotion conflict in repo-less scratch"),
  workflow.indexOf("      - name: Verify the complete resolved source patch"),
);
assert.doesNotMatch(aiBlock, /CONFLICT_RESOLVER_PAT|PUSH_PAT|PROMOTION_PAT/);
assert.match(aiBlock, /github-token: \$\{\{ github\.token \}\}/);

assert.match(action, /terminal_review_needed:/);
assert.match(action, /ai_started:/);
assert.match(action, /ai_conflict_paths:/);
assert.match(action, /Wipe scratch and restore the local action for the next round/);
assert.match(worker, /:\(literal\)\$path/);
assert.match(worker, /ci_sensitive_paths true/);
assert.match(worker, /promotion-ci-sensitive-paths\.txt/);
assert.match(worker, /review_gated true/);
assert.match(worker, /promotion-review-gated\.txt/);
assert.match(worker, /\[\[ "\$SOURCE_LINEAGE_STATUS" == verified \]\]/);
assert.match(worker, /\[\[ "\$observed_lineage" == verified \]\]/);
assert.match(worker, /source-lineage safety block: current develop does not prove this historical patch remains present/);
assert.doesNotMatch(worker, /verified\|review-required-removed\|review-required-ambiguous/);
assert.match(worker, /Review-gated promotion source commit is missing \[skip ci\]/);
assert.match(worker, /classify_source_lineage\(\)/);
assert.match(worker, /git apply --cached --check --reverse --whitespace=nowarn/);
assert.match(worker, /observed_lineage.*SOURCE_LINEAGE_STATUS/s);
assert.match(worker, /source_end_sha:\$source_end_sha,source_lineage_status:\$source_lineage_status,paths:/);
assert.match(worker, /Thingtime-Promotion-Source-Lineage: \$SOURCE_LINEAGE_STATUS/);
assert.doesNotMatch(worker, /\^\(<<<<<<<\|\|\|\|\|\|\|\|=======\|>>>>>>>\)/);
assert.match(prepareRound, /^\s+assert_safe_regular_text_conflict "\$path"$/m);
assert.doesNotMatch(prepareRound, /if ! assert_safe_regular_text_conflict/);
assert.match(graphify, /graphify extract/);
assert.match(graphify, /graph_not_collapsed/);
assert.match(graphify, /contains credential material/);
assert.match(graphify, /REVIEW_GATED/);
assert.equal(
  workflow.match(/PREFERRED_MODEL: \$\{\{ needs\.model_config\.outputs\.primary_model \}\}/g)?.length,
  2,
  "ordinary and promotion Graphify refreshes share the Admin primary",
);
assert.match(graphify, /case "\$\{PREFERRED_MODEL:-default\}"/);
assert.match(graphify, /default\)\s+unset GRAPHIFY_CLAUDE_CLI_MODEL/);
assert.match(graphify, /graphify_model_args=\(--model "\$PREFERRED_MODEL"\)/);
assert.match(graphify, /export GRAPHIFY_CLAUDE_CLI_MODEL="\$PREFERRED_MODEL"/);
assert.match(
  graphify,
  /graphify extract \. --backend "\$backend" "\$\{graphify_model_args\[@\]\}"/,
);
assert.doesNotMatch(graphify, /GRAPHIFY_CLAUDE_CLI_MODEL=.*sonnet/);

assert.match(promoter, /function cleanReplayQuarantinePolicy/);
assert.match(promoter, /path\.startsWith\("\.github\/"\)/);
assert.match(promoter, /sourceLineageReviewRequired\(context\)/);
assert.match(promoter, /"--name-only", "-z"/);
assert.match(promoter, /selectedPaths\.map\(literalPathspec\)/);
assert.match(promoter, /requiresReviewGateReplan: true/);
assert.match(promoter, /refusing PR creation or stack-base reuse/);
assert.match(promoter, /cannot build immutable context for reusable promotion branch/);
const reusableRuntime = promoter.slice(
  promoter.indexOf("function validateReusablePromotionForRun"),
  promoter.indexOf("// Collapse possibly-multiple promotion records"),
);
assert.doesNotMatch(reusableRuntime, /promotionContext:\s*null|:\s*\{\};/);
assert.equal(
  promoter.match(/const reusable = validateReusablePromotionForRun\(\{/g)?.length,
  2,
  "OPEN and orphan direct-branch restart paths share fail-closed validation",
);
assert.match(promoter, /actualFiles\.out\.split\("\\0"\)/);
assert.match(promoter, /\["ls-tree", "HEAD", "--", literalPathspec\(path\)\]/);
assert.match(promoter, /\["ls-tree", branchRef, "--", literalPathspec\(path\)\]/);
assert.match(
  promoter,
  /const reviewGated =[\s\S]{0,300}ai-resolved-checkpoint-pending[\s\S]{0,300}cleanReplayQuarantinePolicy\(reusable\.promotionContext\)\.quarantine/,
);
const quarantineGate = promoter.indexOf(
  "const quarantine = cleanReplayQuarantinePolicy(planned.context);",
);
const cleanWorkerDispatch = promoter.indexOf(
  "const queued = queueTrustedPromotionWorker({",
  quarantineGate,
);
const historicalReplay = promoter.indexOf(
  "const applied = applyPicks(worktree, plan.picks);",
  quarantineGate,
);
assert.ok(quarantineGate > 0);
assert.ok(cleanWorkerDispatch > quarantineGate && cleanWorkerDispatch < historicalReplay);

console.log("promotion worker routing contract: self-test OK");
