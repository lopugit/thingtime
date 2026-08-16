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
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const positiveDecimal = (value) => /^[1-9][0-9]*$/.test(value);
const validDepth = (value) => /^[0-9]+$/.test(value) && Number(value) <= 3;

export function route(input) {
  const event = String(input.event || "");
  const ref = String(input.ref || "");
  const actor = String(input.actor || "");
  const prNumber = String(input.prNumber || "");
  const branch = String(input.branch || "");
  const target = branch || String(input.target || ref);
  const depth = String(input.depth ?? "0");
  const detectorHandoff = input.detectorHandoff === true;
  const routedManualRetry = input.manualRetry === true;

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
  const humanDispatch = event === "workflow_dispatch" && !detectorHandoff;
  const humanExplicit = humanDispatch && Boolean(prNumber || branch);
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
  const modelBlock = source.slice(
    source.indexOf("\n  model_config:"),
    source.indexOf("\n  resolve_promotion:"),
  );
  const resolveBlock = source.slice(source.indexOf("\n  resolve:"));
  const cascadeBlock = source.slice(
    source.indexOf("      - name: Cascade to PRs stacked on this head"),
    source.indexOf("      - name: Comment on PR (needs attention)"),
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
  assert.match(source, /--base "\$HEAD_REF" --state open --limit 1000/);
  assert.match(source, /ref:"github-actions"/);
  assert.doesNotMatch(source, /ref:"develop"/);
  assert.match(source, /detector_handoff:true/);
  assert.match(source, /manual_retry:false/);
  assert.match(source, /actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/g);
  assert.doesNotMatch(source, /gh api "repos\/\$REPO\/dispatches"/);
  assert.doesNotMatch(cascadeBlock, /if: env\.HAS_WORKFLOW_PUSH/);

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
  assert.equal(dispatchCount, 2, "detector handoff and stacked cascade both use fixed workflow dispatch");

  assertAdminModelRouting(source, rebaseSource, rebaseActionSource, modelBlock);
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
  for (const model of ["default", "claude-fable-5", "claude-opus-5"]) {
    assert.ok(block.includes(model), `${label}: closed model ${model}`);
  }
  assert.match(block, /model_args=.*GITHUB_OUTPUT/, `${label}: full waterfall output`);
  assert.match(block, /primary_model=.*GITHUB_OUTPUT/, `${label}: primary model output`);
}

function assertAdminModelRouting(source, rebaseSource, rebaseActionSource, modelBlock) {
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

  const aiRuntimePattern = /anthropics\/claude-code-action@|\bbackend=(?:"|')?claude(?:"|')?\b/;
  const actualRuntimeFiles = [
    ...aiRuntimeSourceFiles(join(REPO_ROOT, ".github", "workflows")),
    ...aiRuntimeSourceFiles(join(REPO_ROOT, ".github", "actions")),
    ...aiRuntimeSourceFiles(join(REPO_ROOT, ".github", "scripts")),
  ]
    .filter((path) => aiRuntimePattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path))
    .sort();
  assert.deepEqual(actualRuntimeFiles, [
    ".github/actions/rebase-conflict-round/action.yml",
    ".github/scripts/rebase-stack/refresh-promotion-graphify.sh",
    ".github/workflows/rebase-pr-stacks.yml",
    ".github/workflows/resolve-pr-conflicts.yml",
  ], "new AI runtime source must be added to the Admin-model contract");

  const requiredModelBindings = new Map([
    [".github/actions/rebase-conflict-round/action.yml", "${{ inputs.model-args }}"],
    [".github/scripts/rebase-stack/refresh-promotion-graphify.sh", 'case "${PREFERRED_MODEL:-default}"'],
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
