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
import { readFileSync } from "node:fs";

const WORKFLOW_URL = new URL("../workflows/resolve-pr-conflicts.yml", import.meta.url);

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
    ref === "develop" &&
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
  const modelBlock = source.slice(
    source.indexOf("\n  model_config:"),
    source.indexOf("\n  resolve:"),
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
  assert.match(source, /github\.ref_name == 'develop'/);
  assert.match(source, /inputs\.detector_handoff == true/);
  assert.match(source, /manual_retry is internal routing state and requires detector_handoff/);
  assert.match(source, /--base "\$HEAD_REF" --state open --limit 1000/);
  assert.match(source, /ref:"develop"/);
  assert.match(source, /detector_handoff:true/);
  assert.match(source, /manual_retry:false/);
  assert.match(source, /actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/g);
  assert.doesNotMatch(source, /gh api "repos\/\$REPO\/dispatches"/);
  assert.doesNotMatch(cascadeBlock, /if: env\.HAS_WORKFLOW_PUSH/);

  for (const [name, block] of [["model_config", modelBlock], ["resolve", resolveBlock]]) {
    assert.match(block, /github\.event_name == 'workflow_dispatch'/, `${name}: event gate`);
    assert.match(block, /inputs\.detector_handoff == true/, `${name}: handoff gate`);
    assert.match(block, /github\.actor == 'github-actions\[bot\]'/, `${name}: actor gate`);
    assert.match(block, /github\.ref_name == 'develop'/, `${name}: ref gate`);
    assert.match(block, /inputs\.pr_number != ''/, `${name}: PR gate`);
    assert.match(block, /inputs\.branch == ''/, `${name}: empty branch gate`);
  }

  const dispatchCount =
    source.match(/actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/g)?.length || 0;
  assert.equal(dispatchCount, 2, "detector handoff and stacked cascade both use fixed workflow dispatch");
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
    event: "workflow_dispatch", ref: "develop", actor: "github-actions[bot]",
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

  assertRoute("machine retry worker", {
    event: "workflow_dispatch", ref: "develop", actor: "github-actions[bot]",
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
      event: "workflow_dispatch", ref: "develop", actor: "github-actions[bot]",
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
