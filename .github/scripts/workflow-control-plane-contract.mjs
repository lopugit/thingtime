#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const githubRoot = resolve(here, "..");
const workflows = resolve(githubRoot, "workflows");
const actions = resolve(githubRoot, "actions");

const IMPLEMENTATIONS = [
  "electron-release.yml",
  "promote-develop-to-main.yml",
  "promote-features-to-main.yml",
  "rebase-pr-stacks.yml",
  "resolve-pr-conflicts.yml",
  "sync-main-into-develop.yml",
  "web-ci.yml",
];

const PROVIDER_ROUTED_IMPLEMENTATIONS = [
  "promote-develop-to-main.yml",
  "promote-features-to-main.yml",
  "rebase-pr-stacks.yml",
  "resolve-pr-conflicts.yml",
  "sync-main-into-develop.yml",
];

const readWorkflow = (name) =>
  readFileSync(resolve(workflows, name), "utf8");

const ADMIN_MODEL_ENDPOINT =
  "https://thingtime.com/api/v1/settings/pr-conflict-auto-resolver-model-waterfall";
const ADMIN_MODEL_KEY = "Thingtime.PRConflictAutoResolverModelWaterfall";
const ALLOWED_MODELS = ["default", "claude-fable-5", "claude-opus-5"];
const AI_RUNTIME_YAML = [
  ".github/actions/rebase-conflict-round/action.yml",
  ".github/workflows/rebase-pr-stacks.yml",
  ".github/workflows/resolve-pr-conflicts.yml",
];

function yamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/u.test(entry.name) ? [path] : [];
  });
}

function workflowBlock(source, start, end, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label}: starts with ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label}: ends before ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertAdminLoader(block, label) {
  assert.ok(
    block.includes(ADMIN_MODEL_ENDPOINT),
    `${label}: fetches Thingtime Admin endpoint`,
  );
  assert.ok(
    block.includes(ADMIN_MODEL_KEY),
    `${label}: validates the exact Admin setting key`,
  );
  for (const model of ALLOWED_MODELS) {
    assert.ok(block.includes(model), `${label}: allowlists ${model}`);
  }
  assert.match(
    block,
    /model_args=.*>> "\$GITHUB_OUTPUT"/u,
    `${label}: exports validated model args`,
  );
  assert.match(
    block,
    /primary_model=.*>> "\$GITHUB_OUTPUT"/u,
    `${label}: exports validated primary model`,
  );
}

function assertAdminModelRouting(resolver, rebase) {
  const resolverLoader = workflowBlock(
    resolver,
    "  model_config:\n",
    "  resolve:\n",
    "resolver model loader",
  );
  const rebaseLoader = workflowBlock(
    rebase,
    "      - name: Load the conflict-resolver model waterfall\n",
    "      - name: Isolate the real rebasing repository outside model workspace\n",
    "rebase model loader",
  );

  assertAdminLoader(resolverLoader, "resolver model loader");
  assertAdminLoader(rebaseLoader, "rebase model loader");
  assert.doesNotMatch(
    rebaseLoader,
    /steps\.start\.outputs\.complete/u,
    "rebase model loader: runs for clean rebases so Graphify receives the Admin model",
  );

  assert.ok(
    resolver.includes(
      "PREFERRED_MODEL: ${{ needs.model_config.outputs.primary_model }}",
    ),
    "resolver Graphify: receives the validated Admin primary model",
  );
  assert.ok(
    rebase.includes("PREFERRED_MODEL: ${{ steps.models.outputs.primary_model }}"),
    "rebase Graphify: receives the validated Admin primary model",
  );

  for (const [label, source] of [
    ["resolver Graphify", resolver],
    ["rebase Graphify", rebase],
  ]) {
    assert.ok(
      source.includes('case "${PREFERRED_MODEL:-default}" in'),
      `${label}: fails closed on model output`,
    );
    assert.ok(
      source.includes('graphify_model_args=(--model "$PREFERRED_MODEL")'),
      `${label}: passes Admin model to the API backend`,
    );
    assert.ok(
      source.includes(
        'export GRAPHIFY_CLAUDE_CLI_MODEL="$PREFERRED_MODEL"',
      ),
      `${label}: passes Admin model to the CLI backend`,
    );
    assert.ok(
      source.includes('"${graphify_model_args[@]}"'),
      `${label}: applies model args to Graphify extraction`,
    );
  }

  assert.ok(
    resolver.includes("${{ needs.model_config.outputs.model_args }}"),
    "resolver Claude action: uses the validated Admin waterfall",
  );

  const rebaseAction = readFileSync(
    resolve(actions, "rebase-conflict-round/action.yml"),
    "utf8",
  );
  assert.ok(
    rebaseAction.includes("${{ inputs.model-args }}"),
    "rebase Claude action: uses the validated Admin waterfall passed by the workflow",
  );
  const rebaseActionCalls = rebase.match(
    /uses: \.\/trusted\/\.github\/actions\/rebase-conflict-round/gu,
  ) ?? [];
  const rebaseModelInputs = rebase.match(
    /model-args: \$\{\{ steps\.models\.outputs\.model_args \}\}/gu,
  ) ?? [];
  assert.ok(rebaseActionCalls.length > 0, "rebase workflow: invokes conflict action");
  assert.equal(
    rebaseModelInputs.length,
    rebaseActionCalls.length,
    "rebase workflow: every conflict round receives the Admin waterfall",
  );

  const runtimeFiles = [...yamlFiles(workflows), ...yamlFiles(actions)]
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return /uses:\s*anthropics\/claude-code-action@|\bbackend=(?:["']?)claude(?:-cli)?(?:["']?)\b|GRAPHIFY_(?:CLAUDE_CLI|OPENAI)_MODEL|--model\b/u.test(
        source,
      );
    })
    .map((path) => relative(resolve(githubRoot, ".."), path))
    .sort();
  assert.deepEqual(
    runtimeFiles,
    AI_RUNTIME_YAML,
    "AI runtime inventory changed; every new action/workflow must be wired to Thingtime Admin",
  );

  for (const path of runtimeFiles) {
    const source = readFileSync(resolve(githubRoot, "..", path), "utf8");
    assert.doesNotMatch(
      source,
      /\bclaude-opus-4-8\b|\bsonnet\b|\bhaiku\b/iu,
      `${path}: contains no legacy model`,
    );
    assert.doesNotMatch(
      source,
      /--model(?:=|\s+)["']?(?:default|claude-[A-Za-z0-9.-]+|opus|sonnet|haiku)\b/iu,
      `${path}: contains no hardcoded --model selection`,
    );
    assert.doesNotMatch(
      source,
      /^\s*GRAPHIFY_(?:CLAUDE_CLI|OPENAI)_MODEL:\s*(?!\$\{\{)[^\s#]+/mu,
      `${path}: contains no hardcoded Graphify model environment value`,
    );
    assert.doesNotMatch(
      source,
      /(?:export\s+)?GRAPHIFY_(?:CLAUDE_CLI|OPENAI)_MODEL=["']?(?:default|claude-[A-Za-z0-9.-]+|opus|sonnet|haiku)\b/iu,
      `${path}: contains no hardcoded Graphify shell model assignment`,
    );
  }
}

export function assertControlPlaneContract() {
  for (const name of IMPLEMENTATIONS) {
    const source = readWorkflow(name);
    assert.match(source, /\non:\n(?:[\s\S]*?\n)?  workflow_call:/, `${name}: exposes workflow_call`);
    assert.match(source, /\njobs:\n/, `${name}: contains implementation jobs`);
  }

  const providerRouter = readWorkflow("ci-provider-router.yml");
  assert.match(providerRouter, /workflow_call:/, "provider router is reusable only");
  assert.match(providerRouter, /THINGTIME_CI_ROUTER_SECRET/, "provider router uses the signed route secret");
  assert.match(providerRouter, /execution_provider=github-actions/, "provider router fails open to GitHub");
  assert.match(providerRouter, /thingtime-ci-control\[bot\]/, "provider router restricts routed fallback actors");
  assert.match(providerRouter, /CONTROL_DISPATCH_ID/, "provider router requires dispatch provenance for fallback");

  for (const name of PROVIDER_ROUTED_IMPLEMENTATIONS) {
    const source = readWorkflow(name);
    assert.match(source, /uses: \.\/\.github\/workflows\/ci-provider-router\.yml/, `${name}: calls the provider router`);
    assert.match(source, /control_dispatch_id:/, `${name}: carries the Thingtime dispatch id`);
    assert.match(source, /needs: route/, `${name}: implementation waits for provider selection`);
    assert.match(source, /needs\.route\.outputs\.execute == 'true'/, `${name}: implementation obeys provider selection`);
  }

  const promotions = readWorkflow("promote-features-to-main.yml");
  assert.match(promotions, /ref: github-actions/);
  assert.match(promotions, /workflow-control\/\.github\/scripts\/promote-features-to-main\.mjs/);

  const omnibus = readWorkflow("promote-develop-to-main.yml");
  assert.match(omnibus, /ref: github-actions/);
  assert.match(omnibus, /workflow-control\/\.github\/scripts\/promotion-pr-changelog\.mjs/);

  const rebase = readWorkflow("rebase-pr-stacks.yml");
  assert.match(rebase, /ref: github-actions/);
  assert.match(rebase, /origin\/github-actions/);
  assert.doesNotMatch(rebase, /ref: \$\{\{ github\.sha \}\}/);

  const resolver = readWorkflow("resolve-pr-conflicts.yml");
  assert.match(resolver, /github\.ref_name == 'github-actions'/);
  assert.match(resolver, /ref:"github-actions"/);
  assert.doesNotMatch(resolver, /ref:"develop"/);
  assert.match(resolver, /github\.actor == 'github-actions\[bot\]'/);
  assert.match(resolver, /github\.actor == 'thingtime-ci-control\[bot\]'/);

  assertAdminModelRouting(resolver, rebase);

  console.log("workflow control-plane contract: self-test OK");
}

if (process.argv.includes("--self-test")) {
  assertControlPlaneContract();
} else {
  console.error("Pass --self-test to run the workflow control-plane contract.");
  process.exitCode = 2;
}
