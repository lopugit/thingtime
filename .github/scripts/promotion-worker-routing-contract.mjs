#!/usr/bin/env node

// No-network contract for Lopu's direct promotion and unified PR-manager path.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../workflows/resolve-pr-conflicts.yml", import.meta.url),
  "utf8",
);
const rebaseWorkflow = readFileSync(
  new URL("../workflows/rebase-pr-stacks.yml", import.meta.url),
  "utf8",
);
const allBranchWorkflow = readFileSync(
  new URL("../workflows/all-branch.yml", import.meta.url),
  "utf8",
);
const developPromotionWorkflow = readFileSync(
  new URL("../workflows/promote-develop-to-main.yml", import.meta.url),
  "utf8",
);
const featurePromotionWorkflow = readFileSync(
  new URL("../workflows/promote-features-to-main.yml", import.meta.url),
  "utf8",
);
const mainDevelopSyncWorkflow = readFileSync(
  new URL("../workflows/sync-main-into-develop.yml", import.meta.url),
  "utf8",
);
const action = readFileSync(
  new URL("../actions/rebase-conflict-round/action.yml", import.meta.url),
  "utf8",
);
const lopuAgent = readFileSync(
  new URL("../actions/lopu-agent/action.yml", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("./rebase-stack/promotion-worker.sh", import.meta.url),
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

assert.match(workflow, /^name: Lopu PR manager$/m);
assert.match(workflow, /manage_rebases:/);
assert.match(workflow, /uses: \.\/\.github\/workflows\/rebase-pr-stacks\.yml/);
assert.match(workflow, /name: Lopu scans rebases and stack cascades/);
assert.match(workflow, /maintain_develop_promotion:/);
assert.match(workflow, /maintain_feature_promotions:/);
assert.match(workflow, /maintain_main_develop_sync:/);
assert.match(workflow, /uses: \.\/\.github\/workflows\/promote-develop-to-main\.yml/);
assert.match(workflow, /uses: \.\/\.github\/workflows\/promote-features-to-main\.yml/);
assert.match(workflow, /uses: \.\/\.github\/workflows\/sync-main-into-develop\.yml/);
assert.match(mainDevelopSyncWorkflow, /SYNC_BRANCH: sync\/main-into-develop/);
assert.match(mainDevelopSyncWorkflow, /--force-with-lease="refs\/heads\/\$SYNC_BRANCH:\$remote_sha"/);
assert.match(mainDevelopSyncWorkflow, /git ls-remote --heads origin refs\/heads\/main refs\/heads\/develop/);
assert.match(mainDevelopSyncWorkflow, /git merge-base --is-ancestor "\$EXPECTED_MAIN_SHA" "\$remote_sha"/);
assert.doesNotMatch(mainDevelopSyncWorkflow, /-f head=(?:"[^"\n]*:)?main"?(?:\s|$)/);
assert.match(workflow, /github\.event\.schedule == '43 \*\/6 \* \* \*'/);
assert.match(workflow, /review_detect:/);
assert.match(workflow, /review_handoff:/);
assert.match(workflow, /review:\s+name: Lopu reviews selected PRs/);
assert.match(workflow, /startsWith\(inputs\.control_dispatch_id, 'lopu-review:'\)/);
assert.match(workflow, /Lopu prepared \$count complete PR worktree\(s\) for one repository review session/);
assert.match(
  workflow,
  /manage_rebases:[\s\S]*?permissions:\s+actions: write\s+contents: write\s+pull-requests: write\s+issues: write/,
);
assert.match(workflow, /group: lopu-agent-fleet-\$\{\{ github\.repository \}\}/);
assert.match(workflow, /LOPU_AGENT_BACKEND/);
assert.match(workflow, /uses: \.\/trusted\/\.github\/actions\/lopu-agent/);
const durableFleetQueue =
  /group: lopu-agent-fleet-\$\{\{ github\.repository \}\}\n(?:\s*#.*\n)*\s*queue: max\s+cancel-in-progress: false/g;
assert.equal(
  [...workflow.matchAll(durableFleetQueue)].length,
  2,
  "review and promotion workers use the durable ordinary Lopu queue",
);
assert.match(
  workflow,
  /feature_stack_merge:[\s\S]*group: lopu-feature-stack-\$\{\{ github\.repository \}\}-\$\{\{ matrix\.target \}\}[\s\S]*queue: max[\s\S]*cancel-in-progress: false/u,
  "admin Feature Stacks use a durable per-target priority lane",
);
assert.match(
  workflow,
  /matrix\.pr\.head == 'sync\/main-into-develop'[\s\S]*lopu-priority-main-develop-\{0\}[\s\S]*lopu-agent-fleet-\{0\}/,
  "the conflict worker selects a dedicated serialized lane only for the standing synchronizer",
);
assert.match(workflow, /feature_stack_plan:\s+name: Validate the immutable Feature Stack/);
assert.match(workflow, /feature_stack_run_id:/);
assert.match(workflow, /Feature Stack run identity does not match its immutable plan/);
assert.match(
	workflow,
	/jq -r '\.plan\.runId' \"\$decoded\"/,
	"Feature Stack admission validates the run id inside the decoded immutable plan",
);
assert.match(workflow, /feature_stack_merge:\s+name: Merge Feature Stack into \$\{\{ matrix\.target \}\}/);
// The rule is that this job leads with `!cancelled()` and then states an
// explicit success check for each of its two `needs`, so a skipped job
// elsewhere in the graph cannot silently skip it. Assert those three
// requirements inside the job's own `if:` block instead of pinning them as
// adjacent text: an extra orthogonal guard is legitimate -- d5e984a0 added
// `recovery != 'true'` between them -- and demanding adjacency did not make
// the rule stricter, it just made it permanently red, so it stopped checking
// anything at all. Scoping to the block is what keeps this strict.
const featureStackMergeIf =
	/\n {2}feature_stack_merge:\n(?:.*\n)*? {4}if: >-\n((?: {6}.*\n)+)/u.exec(workflow);
assert.ok(featureStackMergeIf, "feature_stack_merge declares a multi-line if: guard");
for (const clause of [
	/^ *!cancelled\(\)\s*\n/u,
	/\n *&& needs\.feature_stack_plan\.result == 'success'\s*\n/u,
	/\n *&& needs\.model_config\.result == 'success'\s*\n/u,
]) {
	assert.match(
		featureStackMergeIf[1],
		clause,
		"Feature Stack workers still run when skipped indirect dependencies are expected",
	);
}
assert.match(workflow, /feature-stack-plan\.mjs verify/);
assert.match(workflow, /git clone --shared --no-checkout "\$GITHUB_WORKSPACE\/trusted" "\$integration"/);
assert.match(workflow, /git -C "\$integration" update-ref "refs\/remotes\/origin\/\$head" "\$sha"/);
assert.doesNotMatch(workflow, /git -C "\$integration" fetch --no-tags snapshot/);
assert.match(workflow, /gh pr merge "\$pr_url" --auto --merge/);
assert.match(workflow, /CLAUDE_CODE_OAUTH_TOKEN_THINGTIME/);
assert.match(rebaseWorkflow, /uses: &thingtime_rebase_conflict_round_action \.\/trusted\/\.github\/actions\/rebase-conflict-round/);
assert.match(rebaseWorkflow, /backend: \$\{\{ vars\.LOPU_AGENT_BACKEND/);
assert.match(workflow, /--dangerously-skip-permissions/);
assert.match(workflow, /--allowedTools "Bash\(\*\),Read,Edit,Write,Glob,Grep,WebFetch,WebSearch"/);
assert.doesNotMatch(workflow, /DISALLOWED_TOOLS/);
assert.doesNotMatch(workflow, /Gate publication of AI-resolved workflow files before model spend/);
assert.doesNotMatch(workflow, /Workflow-file promotion requires the review-gated publication token/);
assert.match(workflow, /graphify_scope_args=\(--exclude trusted\/\)/);
assert.match(
  workflow,
  /node "\$graphify_router" update \. "\$\{graphify_scope_args\[@\]\}"/,
);
assert.match(
  workflow,
  /node "\$graphify_router" extract \. "\$\{graphify_scope_args\[@\]\}"/,
);

assert.match(rebaseWorkflow, /^name: Lopu rebase engine$/m);
assert.match(rebaseWorkflow, /workflow_dispatch\|workflow_call\)/);
assert.doesNotMatch(rebaseWorkflow, /^  push:$/m);
assert.doesNotMatch(rebaseWorkflow, /^  pull_request_target:$/m);
assert.doesNotMatch(rebaseWorkflow, /^  schedule:$/m);
assert.doesNotMatch(rebaseWorkflow, /^  workflow_dispatch:$/m);
assert.match(rebaseWorkflow, /event_type:"rebase-pr-stack-ai"/);
assert.equal(rebaseWorkflow.match(/event_type:"rebase-pr-stack-ai"/g)?.length, 2);
assert.equal(rebaseWorkflow.match(/worker:\{/g)?.length, 2);
assert.doesNotMatch(rebaseWorkflow, /actions\/workflows\/rebase-pr-stacks\.yml\/dispatches/);
assert.match(rebaseWorkflow, /handoff:[\s\S]*?permissions:[\s\S]*?contents: write[\s\S]*?repos\/\$REPO\/dispatches/);
assert.match(rebaseWorkflow, /group: lopu-agent-fleet-\$\{\{ github\.repository \}\}/);
assert.equal(
  [...rebaseWorkflow.matchAll(durableFleetQueue)].length,
  1,
  "the rebase and stack worker shares the durable single-Lopu queue",
);

for (const [label, source] of [
  ["develop promotion", developPromotionWorkflow],
  ["feature promotion", featurePromotionWorkflow],
  ["main/develop synchronization", mainDevelopSyncWorkflow],
]) {
  assert.match(source, /^  workflow_call:$/m, `${label} remains an internal reusable component`);
  assert.doesNotMatch(
    source,
    /^  (?:push|pull_request|pull_request_target|schedule|workflow_dispatch|repository_dispatch):/m,
    `${label} must not compete with the public Lopu workflow`,
  );
  assert.match(source, /^\s+cancel-in-progress: false$/m, `${label} never cancels in-flight work`);
}
assert.match(developPromotionWorkflow, /^name: Lopu internal develop promotion$/m);
assert.match(featurePromotionWorkflow, /^name: Lopu internal feature promotion$/m);
assert.match(
  featurePromotionWorkflow,
  /route:[\s\S]*inputs\.source_branch == ''[\s\S]*inputs\.target_branch == ''[\s\S]*inputs\.require_path_prefix == ''/,
  "custom promotion authority stays on the reviewed GitHub runner",
);
assert.match(featurePromotionWorkflow, /promote:\s+needs: route\s+if: >-\s+always\(\)/);
assert.match(mainDevelopSyncWorkflow, /^name: Lopu internal main\/develop synchronization$/m);
for (const input of ["source_branch", "target_branch", "require_path_prefix"]) {
  assert.equal(
    featurePromotionWorkflow.match(new RegExp(`^      ${input}:$`, "gm"))?.length,
    1,
    `feature promotion ${input}: is exposed only through workflow_call`,
  );
}

assert.match(allBranchWorkflow, /^name: Lopu internal all-branch integration$/m);
assert.match(allBranchWorkflow, /^  workflow_call:$/m);
assert.doesNotMatch(
  allBranchWorkflow,
  /^  (?:push|pull_request|pull_request_target|schedule|workflow_dispatch|repository_dispatch):/m,
  "the all-branch doctor remains an internal Lopu component",
);
assert.equal(
  [...allBranchWorkflow.matchAll(durableFleetQueue)].length,
  1,
  "the all-branch build doctor shares the durable single-Lopu queue",
);
assert.match(allBranchWorkflow, /uses: \.\/control-plane\/\.github\/actions\/lopu-agent/);
assert.match(allBranchWorkflow, /LOPU_AGENT_BACKEND/);

assert.match(action, /You are Lopu, Thingtime's principal PR and repository manager/);
assert.match(action, /uses: \.\/trusted\/\.github\/actions\/lopu-agent/);
assert.match(action, /--dangerously-skip-permissions/);
assert.match(action, /--allowedTools "Bash\(\*\),Read,Edit,Write,Glob,Grep,WebFetch,WebSearch"/);
assert.doesNotMatch(action, /DISALLOWED_TOOLS/);
assert.match(lopuAgent, /name: Lopu agent/);
assert.match(lopuAgent, /anthropics\/claude-code-action@1623c36729ac1cd5895198cded705a287de7db79/);
assert.match(lopuAgent, /openai\/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e/);
for (const [label, source] of [
  ["resolver workflow", workflow],
  ["rebase workflow", rebaseWorkflow],
  ["all-branch workflow", allBranchWorkflow],
  ["rebase conflict action", action],
]) {
  assert.doesNotMatch(
    source,
    /uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/,
    `${label} must not bypass the single Lopu action`,
  );
}
assert.match(worker, /git commit -q/);
assert.doesNotMatch(worker, /review_gated/);
assert.doesNotMatch(worker, /ci_sensitive_paths/);
assert.doesNotMatch(worker, /\[skip ci\]/);
assert.doesNotMatch(graphify, /REVIEW_GATED/);
assert.match(graphify, /GRAPHIFY_BACKEND_PREFERENCE/);
assert.match(graphify, /OPENAI_API_KEY/);
assert.match(graphify, /backend=openai/);
assert.match(graphify, /LOPU_OPENAI_MODEL/);
assert.match(graphify, /--api-timeout 7200/);
assert.doesNotMatch(promoter, /cleanReplayQuarantinePolicy/);
assert.doesNotMatch(promoter, /promotionQuarantineReviewBody/);
assert.doesNotMatch(promoter, /Protected clean-replay review/);
assert.doesNotMatch(promoter, /review-gated/);
assert.doesNotMatch(promoter, /ciSensitive/);
assert.match(promoter, /const applied = applyPicks\(worktree, plan\.picks\);/);

console.log("Lopu PR manager contract: self-test OK");
