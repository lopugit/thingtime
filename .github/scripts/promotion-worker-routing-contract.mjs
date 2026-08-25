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
  3,
  "every review, promotion, and conflict worker uses the durable single-Lopu queue",
);
assert.match(rebaseWorkflow, /uses: &thingtime_rebase_conflict_round_action \.\/trusted\/\.github\/actions\/rebase-conflict-round/);
assert.match(rebaseWorkflow, /backend: \$\{\{ vars\.LOPU_AGENT_BACKEND/);
assert.match(workflow, /--dangerously-skip-permissions/);
assert.match(workflow, /--allowedTools "Bash\(\*\),Read,Edit,Write,Glob,Grep,WebFetch,WebSearch"/);
assert.doesNotMatch(workflow, /DISALLOWED_TOOLS/);
assert.doesNotMatch(workflow, /Gate publication of AI-resolved workflow files before model spend/);
assert.doesNotMatch(workflow, /Workflow-file promotion requires the review-gated publication token/);

assert.match(rebaseWorkflow, /^name: Lopu rebase engine$/m);
assert.match(rebaseWorkflow, /workflow_dispatch\|workflow_call\)/);
assert.doesNotMatch(rebaseWorkflow, /^  push:$/m);
assert.doesNotMatch(rebaseWorkflow, /^  pull_request_target:$/m);
assert.doesNotMatch(rebaseWorkflow, /^  schedule:$/m);
assert.doesNotMatch(rebaseWorkflow, /^  workflow_dispatch:$/m);
assert.match(rebaseWorkflow, /group: lopu-agent-fleet-\$\{\{ github\.repository \}\}/);
assert.equal(
  [...rebaseWorkflow.matchAll(durableFleetQueue)].length,
  1,
  "the rebase and stack worker shares the durable single-Lopu queue",
);

assert.match(allBranchWorkflow, /^name: Lopu all-branch integration$/m);
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
