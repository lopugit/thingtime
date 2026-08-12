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
const promoteWorkflow = readFileSync(
  new URL("../workflows/promote-features-to-main.yml", import.meta.url),
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
  /const keys = \['base_ref','base_sha','source_ref','branch','reservation_sha','source_tip_sha','source_start_sha','source_end_sha','source_lineage_status','plan_hash','title_b64','body_b64'\]/,
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
// NEVER CANCEL (owner decision, 2026-08-12): the refusal this contract used
// to pin — and the tripwire that forbade the allow-list below — are retired
// deliberately. The workflow ACCEPTS the closed review-required lineage set,
// and what protects an unproven patch is publication posture, so pin that:
// the closed set (unknown values still fail), the `source-lineage-unverified`
// label, the release-decision warning on the promotion PR, and the mirrored
// warning on the source PR. Nothing merges automatically either way.
assert.match(workflow, /verified\|review-required-removed\|review-required-ambiguous\) ;;/);
assert.match(workflow, /source_lineage_status must be verified, review-required-removed, or review-required-ambiguous/);
assert.doesNotMatch(workflow, /source-lineage safety block: trusted promotion workers require/);
assert.match(workflow, /--add-label source-lineage-unverified/);
assert.match(workflow, /Merge this promotion only if restoring that historical feature is desired/);
assert.match(workflow, /published for an explicit human decision instead of being dropped/);
assert.match(workflow, /promotion PR is labelled \\\`source-lineage-unverified\\\` and must be reviewed before merge/);
assert.match(workflow, /source_lineage_status: \$\{\{ steps\.validate\.outputs\.source_lineage_status \}\}/);
assert.match(workflow, /SOURCE_LINEAGE_STATUS: \$\{\{ needs\.promotion_validate\.outputs\.source_lineage_status \}\}/);
assert.match(workflow, /value\.source_lineage_status === process\.env\.SOURCE_LINEAGE_STATUS/);
assert.match(workflow, /source_lineage_status:\$source_lineage_status/);
assert.match(workflow, /actions\/workflows\/promote-features-to-main\.yml\/dispatches/);
assert.match(workflow, /paused_label=.*ai-promotion-paused/);
assert.match(workflow, /\[ "\$paused" = true \] && \[ "\$paused_label" = true \]/);
assert.match(workflow, /CONFLICT_PATHS: \$\{\{ steps\.promotion_ai_round_3\.outputs\.ai_conflict_paths \|\| steps\.promotion_ai_round_2\.outputs\.ai_conflict_paths \|\| steps\.promotion_ai_round\.outputs\.ai_conflict_paths \}\}/);
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
// The worker accepts the same closed set; its independent re-derivation must
// still agree with the trusted handoff EXACTLY (both classify against the
// immutable SOURCE_TIP_SHA, so disagreement means forgery or staleness, never
// honest drift), and any non-verified lineage review-gates publication the
// same way CI-sensitive paths do ([skip ci] content commits, checkpoint).
assert.match(worker, /verified\|review-required-removed\|review-required-ambiguous\) ;;/);
assert.match(worker, /"\$observed_lineage" == "\$SOURCE_LINEAGE_STATUS"/);
assert.match(worker, /\|\| \[\[ "\$observed_lineage" != verified \]\]/);
assert.doesNotMatch(worker, /refusing every replay or publication/);
// Delete-shaped conflicts (no zdiff3 markers possible) resolve
// deterministically toward the source patch — the model never sees them —
// and the promotion PR's review comment names every path resolved that way.
assert.match(worker, /git checkout -q --theirs -- ":\(literal\)\$path"/);
assert.match(worker, /git rm -q -f -- ":\(literal\)\$path"/);
assert.match(worker, /deterministic_conflict_paths/);
assert.match(workflow, /DETERMINISTIC_PATHS: \$\{\{ steps\.prepare_promotion\.outputs\.deterministic_conflict_paths \}\}/);
assert.match(workflow, /resolved deterministically toward the source patch/);
assert.match(worker, /promotion-discarded-changes\.md/);
assert.match(worker, /note_discarded/);
assert.match(worker, /promotion-unmerged-paths\.zlist/);
// Replay rounds (owner decision, 2026-08-12): the promotion chain keeps the
// model with bounded retries, prompts it for a FAITHFUL REPLAY (never the
// stack flow's semantic-union framing), and settles provably-superseded
// content deterministically. The final round must stay strict.
assert.match(action, /allow-unresolved/);
assert.match(action, /retry_needed=true/);
assert.match(action, /FAITHFUL REPLAY/);
assert.match(action, /preserve the semantic\n? *union/);
assert.match(workflow, /id: promotion_ai_round_2/);
assert.match(workflow, /id: promotion_ai_round_3/);
assert.match(workflow, /steps\.promotion_ai_round_2\.outputs\.retry_needed == 'true'/);
assert.match(worker, /already contained in the source history/);
// The advisory release analysis (owner request, 2026-08-12): a model pass
// over precomputed three-branch history + PR inventory, posted on the
// promotion PR under one marker. Advisory by construction: continue-on-error,
// Write scoped to its single output file, the runner temp tree denied, and
// the deterministic post step size-caps and secret-scans before commenting.
assert.match(workflow, /id: release_analysis_inputs/);
assert.match(workflow, /id: release_analysis\n/);
assert.match(workflow, /thingtime-ai-release-analysis:v1/);
assert.match(workflow, /Model-authored release analysis \(advisory\)/);
assert.match(workflow, /Write\(\$\{\{ steps\.release_analysis_inputs\.outputs\.dir \}\}\/out\/\*\*\)/);
assert.match(workflow, /commits-only-on-main\.txt/);
assert.match(promoter, /A model-authored release analysis is posted as a comment/);
assert.doesNotMatch(promoter, /did not ask AI to infer/);
// Reverse lane (owner request, 2026-08-12): source/target/path-prefix are
// dispatch inputs, github-actions is a legal promotion base, and the lane
// guard skips any PR whose planned patch leaves the lane's prefixes.
assert.match(workflow, /"\$BASE_REF" = github-actions/);
assert.match(promoter, /REQUIRE_PATH_PREFIXES/);
assert.match(promoter, /outside this lane/);
// Auto lanes: every default develop→main run fans out the two CI lanes
// (main→github-actions, develop→github-actions) with the .github/ prefix
// guard, and lane branch names always suffix --to-<target> because the
// primary namespace is pinned to main.
assert.match(promoteWorkflow, /Fan out the CI promotion lanes/);
assert.match(promoteWorkflow, /"main github-actions" "develop github-actions"/);
assert.match(promoteWorkflow, /require_path_prefix:"\.github\/"/);
assert.match(promoter, /PRIMARY_TARGET_BRANCH/);
// Uniform lane naming (owner request, 2026-08-12): every promotion branch
// carries --to-<target>; legacy unsuffixed branches stay recognized as
// main-lane history so live promotions are never orphaned.
assert.match(promoter, /--to-\$\{slugify\(target\)\}/);
assert.match(promoter, /legacyPromotionBranchFor/);
assert.match(promoter, /promotionBranchMatches/);
// Lane-aware trusted validation: the envelope carries source_ref, the
// validator's closed source set is develop|main, merged-into and live-tip
// checks follow the lane, and the deterministic branch check accepts the
// uniform --to-<target> shape plus legacy pre-uniform main-lane names.
assert.match(workflow, /Promotion source must be develop or main/);
assert.match(workflow, /Source PR was not merged to \$SOURCE_REF/);
assert.match(workflow, /live_ref_sha "\$SOURCE_REF"/);
assert.match(workflow, /--to-\$\{target_slug\}/);
assert.match(promoter, /source_ref: CFG\.source/);
// Deterministically settled paths are absent from the live pre-model set but
// always present in the immutable merge-tree recompute: the round compares
// against the union, and stages their content only from the expected rebase
// head — model output can never reach them.
assert.match(action, /deterministic-conflict-paths/);
assert.match(action, /EXPECTED_DETERMINISTIC_PATHS/);
assert.match(action, /expected_conflicts_full/);
assert.match(action, /git checkout-index -f -- "\$path"/);
assert.match(workflow, /deterministic-conflict-paths: \$\{\{ steps\.prepare_promotion\.outputs\.deterministic_conflict_paths \}\}/);
// Owner decision (2026-08-12): there is NO sensitive-path deny-list. The
// model may be shown any conflicted repo file; safety lives in the mechanical
// shape checks, the scope verifier, and [skip ci]+approval publication
// gating. These pins hold the ABSENCE, so a deny-list cannot quietly return.
assert.doesNotMatch(prepareRound, /\bsensitive_path\b/);
assert.doesNotMatch(prepareRound, /Sensitive configuration\/security conflict/);
assert.doesNotMatch(worker, /\bsensitive_path\b/);
// ci_sensitive_paths (the [skip ci]/approval publication gate) is NOT a
// deny-list and deliberately survives; the word-boundary pins above leave it
// alone while still catching any resurrected sensitive_path().
assert.match(worker, /ci_sensitive_paths true/);
assert.match(prepareRound, /deliberately NO sensitive-path deny-list/);
assert.match(workflow, /Base-side changes affected by deterministic resolutions/);
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
