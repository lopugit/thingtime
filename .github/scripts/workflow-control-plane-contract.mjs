#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const githubRoot = resolve(here, "..");
const workflows = resolve(githubRoot, "workflows");
const actions = resolve(githubRoot, "actions");
const scripts = resolve(githubRoot, "scripts");

const IMPLEMENTATIONS = [
  "develop-pr-preview.yml",
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

const ROUTING_PROOF_DOMAIN = "thingtime-ci-routing-proof:v1";

function makeRoutingProof({ workflow, provider, runnerLabel, dispatchId, issuedAt, secret }) {
  const canonical = [
    ROUTING_PROOF_DOMAIN,
    workflow,
    provider,
    runnerLabel,
    dispatchId,
    String(issuedAt),
    "",
  ].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function acceptsBotRoutingProof(input) {
  if (input.event !== "workflow_dispatch") return false;
  if (input.ref !== "github-actions") return false;
  if (input.actor !== "github-actions[bot]") return false;
  if (!input.internalWorker) return false;
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(input.dispatchId)) return false;
  if (input.provider === "vercel-sandbox") {
    if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(input.runnerLabel)) return false;
  } else if (input.provider === "github-actions") {
    if (input.runnerLabel !== "") return false;
  } else {
    return false;
  }
  if (!/^\d{10}$/u.test(String(input.issuedAt))) return false;
  const age = input.now - Number(input.issuedAt);
  if (age < -300 || age > 7200) return false;
  if (!/^[0-9a-f]{64}$/u.test(input.proof)) return false;
  return input.proof === makeRoutingProof({
    workflow: input.workflow,
    provider: input.provider,
    runnerLabel: input.runnerLabel,
    dispatchId: input.dispatchId,
    issuedAt: input.issuedAt,
    secret: input.secret,
  });
}

function appReentryDisposition(input) {
  if (
    input.event !== "workflow_dispatch" ||
    input.ref !== "github-actions" ||
    input.actor !== "thingtime-ci-control[bot]"
  ) {
    return "route";
  }
  const token = (value) => /^[A-Za-z0-9._:-]{1,160}$/u.test(String(value || ""));
  if (
    input.provider === "vercel-sandbox" &&
    token(input.runnerLabel) &&
    token(input.dispatchId)
  ) {
    return "mint-proof";
  }
  if (
    input.provider === "github-actions" &&
    String(input.runnerLabel || "") === "" &&
    token(input.dispatchId)
  ) {
    return "mint-proof";
  }
  return "local-fallback";
}

function assertRoutingProofContract(providerRouter) {
  const now = 1_786_300_000;
  const valid = {
    event: "workflow_dispatch",
    ref: "github-actions",
    actor: "github-actions[bot]",
    internalWorker: true,
    workflow: "resolve-conflicts",
    provider: "vercel-sandbox",
    runnerLabel: "thingtime-ci-123",
    dispatchId: "dispatch:123",
    issuedAt: now - 60,
    now,
    secret: "contract-only-secret",
  };
  valid.proof = makeRoutingProof(valid);
  assert.equal(acceptsBotRoutingProof(valid), true, "fresh exact worker proof is accepted");
  assert.equal(
    acceptsBotRoutingProof({ ...valid, now: valid.issuedAt + 7_199 }),
    true,
    "same-workflow cascade proof remains valid within the bounded lifetime",
  );
  for (const mutation of [
    { workflow: "rebase-stack" },
    { provider: "github-actions" },
    { runnerLabel: "thingtime-ci-other" },
    { dispatchId: "dispatch:other" },
    { actor: "lopugit" },
    { actor: "thingtime-ci-control[bot]" },
    { ref: "develop" },
    { event: "repository_dispatch" },
    { internalWorker: false },
    { proof: "" },
  ]) {
    assert.equal(
      acceptsBotRoutingProof({ ...valid, ...mutation }),
      false,
      `routing proof mutation is rejected: ${JSON.stringify(mutation)}`,
    );
  }
  for (const issuedAt of [now - 7_201, now + 301]) {
    const outOfWindow = { ...valid, issuedAt };
    outOfWindow.proof = makeRoutingProof(outOfWindow);
    assert.equal(
      acceptsBotRoutingProof(outOfWindow),
      false,
      `cryptographically valid proof outside freshness window is rejected: ${issuedAt}`,
    );
  }
  const githubFallback = {
    ...valid,
    provider: "github-actions",
    runnerLabel: "",
  };
  githubFallback.proof = makeRoutingProof(githubFallback);
  assert.equal(
    acceptsBotRoutingProof(githubFallback),
    true,
    "authenticated GitHub fallback metadata is accepted",
  );
  assert.equal(
    appReentryDisposition({
      event: "workflow_dispatch",
      ref: "github-actions",
      actor: "thingtime-ci-control[bot]",
      provider: "vercel-sandbox",
      runnerLabel: "thingtime-ci-123",
      dispatchId: "dispatch:123",
    }),
    "mint-proof",
    "complete App Vercel re-entry mints bounded worker provenance",
  );
  assert.equal(
    appReentryDisposition({
      event: "workflow_dispatch",
      ref: "github-actions",
      actor: "thingtime-ci-control[bot]",
      provider: "github-actions",
      runnerLabel: "",
      dispatchId: "",
    }),
    "local-fallback",
    "App re-entry missing its dispatch id cannot be routed back into a loop",
  );
  assert.equal(
    appReentryDisposition({
      event: "workflow_dispatch",
      ref: "github-actions",
      actor: "github-actions[bot]",
      provider: "github-actions",
      runnerLabel: "",
      dispatchId: "",
    }),
    "route",
    "ordinary bot-authored detector dispatches still consult provider policy",
  );

  assert.match(providerRouter, /GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(providerRouter, /GITHUB_REF_NAME.*github-actions/);
  assert.match(providerRouter, /GITHUB_ACTOR.*github-actions\[bot\]/);
  assert.match(providerRouter, /INTERNAL_WORKER.*true/);
  assert.match(providerRouter, /ROUTING_PROOF.*\^\[0-9a-f\]\{64\}\$/);
  assert.match(providerRouter, /proof_is_fresh/);
}

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
    "  resolve_promotion:\n",
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
  assert.match(
    rebase,
    /uses: &thingtime_rebase_conflict_round_action \.\/trusted\/\.github\/actions\/rebase-conflict-round/u,
    "rebase workflow: anchors the trusted conflict action",
  );
  assert.match(
    rebase,
    /uses: \*thingtime_rebase_conflict_round_action/u,
    "rebase workflow: reuses the trusted conflict action anchor",
  );
  const rebaseActionCalls = 2 +
    (rebase.match(/^\s{6}- \*thingtime_rebase_conflict_retry$/gmu)?.length ?? 0);
  const rebaseModelInputs = rebase.match(
    /model-args: \$\{\{ steps\.models\.outputs\.model_args \}\}/gu,
  ) ?? [];
  assert.equal(rebaseActionCalls, 500, "rebase workflow: exposes 500 conflict rounds");
  assert.equal(rebaseModelInputs.length, 1, "rebase workflow: aliased rounds share the Admin waterfall");

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

  const claudeActionCount = runtimeFiles.reduce((count, path) => {
    const source = readFileSync(resolve(githubRoot, "..", path), "utf8");
    return count +
      (source.match(/uses:\s*anthropics\/claude-code-action@/gu)?.length ?? 0);
  }, 0);
  const turnBudgets = runtimeFiles.flatMap((path) => {
    const source = readFileSync(resolve(githubRoot, "..", path), "utf8");
    return [...source.matchAll(/--max-turns\s+(\d+)/gu)].map((match) => ({
      path,
      value: Number(match[1]),
    }));
  });
  assert.ok(
    turnBudgets.length >= claudeActionCount,
    "every Claude action and exact-session continuation declares a turn budget",
  );
  for (const budget of turnBudgets) {
    assert.equal(
      budget.value,
      500,
      `${budget.path}: Claude turn budget remains 500`,
    );
  }
  const runtimeSource = runtimeFiles
    .map((path) => readFileSync(resolve(githubRoot, "..", path), "utf8"))
    .join("\n");
  assert.equal(
    runtimeSource.match(/steps\.[A-Za-z0-9_]+\.outcome == 'failure'/gu)?.length,
    claudeActionCount,
    "each Claude action classifies its failed result before continuation",
  );
  assert.ok(
    (runtimeSource.match(/RESULT_SUBTYPE[^\n]+error_max_turns/gu)?.length ?? 0) >=
      claudeActionCount,
    "only error_max_turns can enter exact-session continuation",
  );
  assert.equal(
    runtimeSource.match(/claude --resume "\$session_id" --print/gu)?.length,
    claudeActionCount,
    "every Claude action has an exact --resume continuation path",
  );
}

function assertObservableLabelCleanup(rebase) {
  const scan = workflowBlock(
    rebase,
    "      - name: Scan open same-repository PRs via the API\n",
    "  handoff:\n",
    "rebase detector label cleanup",
  );
  assert.match(
    scan,
    /LABEL_WRITE_TOKEN: \$\{\{ secrets\.CONFLICT_RESOLVER_PAT \}\}/u,
    "rebase detector label cleanup: has a configured write-token fallback",
  );
  assert.match(
    scan,
    /for attempt in 1 2 3/u,
    "rebase detector label cleanup: retries transient API failures",
  );
  assert.match(
    scan,
    /GH_TOKEN="\$token" gh api --method DELETE/u,
    "rebase detector label cleanup: switches credentials without exposing them",
  );
  assert.match(
    scan,
    /\[redacted-token\]/u,
    "rebase detector label cleanup: sanitizes surfaced API errors",
  );
  assert.match(
    scan,
    /refusing another DELETE that could erase a newer hold/u,
    "rebase detector label cleanup: never retries a successful mutation",
  );
  assert.match(
    scan,
    /label_cleanup_failed=true/u,
    "rebase detector label cleanup: records failures instead of swallowing them",
  );
  assert.match(
    scan,
    /One or more stale resolver labels remain after cleanup/u,
    "rebase detector label cleanup: fails closed before dispatch",
  );
  assert.doesNotMatch(
    scan,
    /remove_label_verified ai-(?:rebase|merge)-paused \|\| true/u,
    "rebase detector label cleanup: never reports success after a failed removal",
  );
}

function assertResolverLockfileRecovery(resolver) {
  const prompt = workflowBlock(
    resolver,
    "      - name: Resolve conflicts with Claude\n",
    "      - name: Continue the exact conflict-resolution session until it finishes\n",
    "resolver model prompt",
  );
  assert.match(
    prompt,
    /SUCCESSFUL HANDOFF, not a manual-/u,
    "resolver prompt: a true-union pinned pnpm lockfile is a successful deterministic handoff",
  );
  assert.match(
    prompt,
    /--lockfile-only, --ignore-scripts, and\n\s+--ignore-pnpmfile/u,
    "resolver prompt: tells the model exactly how the trusted next step completes the lockfile",
  );

  const recovery = workflowBlock(
    resolver,
    "      - name: Regenerate a lone pinned pnpm lockfile without credentials\n",
    "      - name: Verify resolution and commit\n",
    "resolver lockfile recovery",
  );
  assert.match(recovery, /env -i "\$\{clean_env\[@\]\}"/u);
  assert.match(recovery, /pnpm@10\.12\.1/u);
  assert.match(recovery, /--lockfile-only/u);
  assert.match(recovery, /--ignore-scripts/u);
  assert.match(recovery, /--ignore-pnpmfile/u);
  assert.match(recovery, /--frozen-lockfile/u);
  assert.match(recovery, /git show ":3:\$lockfile" >"\$lockfile"/u);
  assert.match(recovery, /cmp -s "\$before_patch" "\$after_patch"/u);
  assert.match(recovery, /cmp -s "\$before_status" "\$after_status"/u);
  assert.doesNotMatch(
    recovery,
    /\$\{\{\s*(?:secrets\.|github\.token)|\bGH_TOKEN:|\bGITHUB_TOKEN:/u,
    "resolver lockfile recovery: receives no AI or repository-write credential expression",
  );
  assert.doesNotMatch(
    recovery,
    /\bgit (?:add|commit|push)\b/u,
    "resolver lockfile recovery: leaves all staging, commit, and publication to the existing verifier",
  );

  const commentStart = resolver.indexOf("      - name: Comment on PR (needs attention)\n");
  assert.notEqual(commentStart, -1, "resolver failure comment exists");
  const comment = resolver.slice(commentStart);
  assert.match(comment, /residual-conflicts\.txt/u);
  assert.match(comment, /Residual conflicted files:/u);
  assert.doesNotMatch(
    comment,
    /conflicted-derived\.txt|conflicted\.txt/u,
    "resolver failure comment: never falls back to the pre-model conflict list",
  );
}

export function assertControlPlaneContract() {
  for (const name of IMPLEMENTATIONS) {
    const source = readWorkflow(name);
    assert.match(source, /\non:\n(?:[\s\S]*?\n)?  workflow_call:/, `${name}: exposes workflow_call`);
    assert.match(source, /\njobs:\n/, `${name}: contains implementation jobs`);
  }

  const developPreview = readWorkflow("develop-pr-preview.yml");
  assert.doesNotMatch(
    developPreview,
    /^  (?:pull_request_target|repository_dispatch|schedule|workflow_dispatch):/mu,
    "develop preview implementation is reusable only",
  );
  assert.match(
    developPreview,
    /^          ref: github-actions$/mu,
    "develop preview controller checks out the protected control plane",
  );
  assert.doesNotMatch(
    developPreview,
    /^          ref: main$/mu,
    "develop preview controller never loads executable behavior from a product branch",
  );
  assert.doesNotMatch(
    developPreview,
    /deploy-develop-pr-preview\.mjs --self-test/u,
    "develop preview contract examples never block the live controller",
  );
  assert.match(
    developPreview,
    /github\.event\.pull_request\.base\.ref == 'develop'/u,
    "develop preview dispatches events that currently target develop",
  );
  assert.match(
    developPreview,
    /github\.event\.changes\.base\.ref\.from == 'develop'/u,
    "develop preview preserves cleanup when a PR is retargeted away from develop",
  );

  const providerRouter = readWorkflow("ci-provider-router.yml");
  assertRoutingProofContract(providerRouter);
  assert.match(providerRouter, /workflow_call:/, "provider router is reusable only");
  assert.match(providerRouter, /THINGTIME_CI_ROUTER_SECRET/, "provider router uses the signed route secret");
  assert.match(providerRouter, /execution_provider=github-actions/, "provider router fails open to GitHub");
  assert.match(providerRouter, /thingtime-ci-control\[bot\]/, "provider router restricts routed fallback actors");
  assert.match(providerRouter, /CONTROL_DISPATCH_ID/, "provider router requires dispatch provenance for fallback");
  assert.match(providerRouter, /ROUTING_PROOF/, "provider router carries a signed routing capability");
  assert.match(providerRouter, /ROUTING_PROOF_ISSUED_AT/, "provider routing capability is time bounded");
  assert.match(providerRouter, /INTERNAL_WORKER/, "bot proof reuse requires an exact internal worker shape");
  assert.match(providerRouter, /thingtime-ci-routing-proof:v1/, "routing proof uses a versioned canonical domain");
  assert.match(providerRouter, /age.*-le 7200/, "routing proof has a bounded two-hour lifetime");
  assert.match(providerRouter, /Bot-carried Vercel routing proof is missing or invalid/);
  assert.match(providerRouter, /without re-routing/, "invalid bot metadata fails over locally instead of looping");
  assert.match(
    providerRouter,
    /Malformed CI Control re-entry was rejected; continuing on GitHub-hosted compute without re-routing/,
    "unmatched App re-entry fails over locally rather than re-entering CI Control",
  );
  assert.match(
    providerRouter,
    /GITHUB_EVENT_NAME" == "repository_dispatch"[\s\S]*WORKFLOW" == "rebase-stack"[\s\S]*Legacy exact rebase handoff is pinned to GitHub-hosted compute/,
    "legacy exact rebase payloads retain their snapshot by bypassing external routing",
  );
  assert.match(providerRouter, /runs-on: ubuntu-latest/, "router secret stays on GitHub-hosted compute");
  assert.doesNotMatch(
    providerRouter,
    /runs-on:.*inputs\.runner_label/,
    "unvalidated caller labels never select the secret-bearing router runner",
  );
  assert.match(providerRouter, /runner_label: \$\{\{ steps\.route\.outputs\.runner_label \}\}/);
  assert.match(providerRouter, /routing_proof: \$\{\{ steps\.route\.outputs\.routing_proof \}\}/);
  assert.match(providerRouter, /routing_proof_issued_at: \$\{\{ steps\.route\.outputs\.routing_proof_issued_at \}\}/);

  for (const name of PROVIDER_ROUTED_IMPLEMENTATIONS) {
    const source = readWorkflow(name);
    assert.match(source, /uses: \.\/\.github\/workflows\/ci-provider-router\.yml/, `${name}: calls the provider router`);
    assert.match(source, /control_dispatch_id:/, `${name}: carries the Thingtime dispatch id`);
    assert.match(source, /needs: route/, `${name}: implementation waits for provider selection`);
    assert.match(source, /needs\.route\.outputs\.execute == 'true'/, `${name}: implementation obeys provider selection`);
    assert.match(source, /runs-on: \$\{\{ needs\.route\.outputs\.runner_label \|\| 'ubuntu-latest' \}\}/, `${name}: uses only the validated runner label`);
    assert.doesNotMatch(source, /runs-on:.*inputs\.runner_label/, `${name}: never schedules directly from caller metadata`);
  }

  const promotions = readWorkflow("promote-features-to-main.yml");
  assert.match(promotions, /ref: github-actions/);
  assert.match(promotions, /workflow-control\/\.github\/scripts\/promote-features-to-main\.mjs/);
  assert.doesNotMatch(
    promotions,
    /promote-features-to-main\.mjs --self-test/u,
    "promoter contract examples never block a live promotion",
  );
  assert.match(promotions, /^  actions: write$/m);
  assert.match(promotions, /ACTIONS_TOKEN: \$\{\{ github\.token \}\}/);
  const promoter = readFileSync(
    resolve(scripts, "promote-features-to-main.mjs"),
    "utf8",
  );
  assert.match(promoter, /ref: "github-actions"/);
  assert.doesNotMatch(promoter, /ref: "develop"/);

  const controlPlaneCi = readWorkflow("control-plane-ci.yml");
  assert.match(
    controlPlaneCi,
    /pull_request:\n\s+branches: \[github-actions\]/,
  );
  assert.doesNotMatch(controlPlaneCi, /^\s+secrets:/m);
  assert.match(
    controlPlaneCi,
    /Contract advisories \(non-blocking\)/u,
    "automation contracts run in their advisory-only lane",
  );
  assert.match(
    controlPlaneCi,
    /thingtime-control-plane-contract-advisories:v1/u,
    "automation contract warnings are surfaced through one PR comment",
  );

  const omnibus = readWorkflow("promote-develop-to-main.yml");
  assert.match(omnibus, /ref: github-actions/);
  assert.match(omnibus, /workflow-control\/\.github\/scripts\/promotion-pr-changelog\.mjs/);

  const rebase = readWorkflow("rebase-pr-stacks.yml");
  assert.match(rebase, /ref: github-actions/);
  assert.match(rebase, /origin\/github-actions/);
  assert.doesNotMatch(rebase, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(
    rebase,
    /Rebase ownership routing self-test/u,
    "rebase ownership examples never block live target detection",
  );
  assert.match(rebase, /routing_proof: \$\{\{ inputs\.routing_proof/);
  assert.match(rebase, /routing_proof_issued_at: \$\{\{ inputs\.routing_proof_issued_at/);
  assert.match(rebase, /internal_worker: >-/);
  assert.match(
    rebase,
    /github\.event_name == 'repository_dispatch'[\s\S]*inputs\.worker_handoff == true/,
    "legacy repository_dispatch and modern exact workers are both identified before routing",
  );
  assert.match(rebase, /routing_proof:\$routing_proof/);
  assert.match(rebase, /routing_proof_issued_at:\$routing_proof_issued_at/);
  for (const input of ["routing_proof", "routing_proof_issued_at"]) {
    assert.equal(
      rebase.match(new RegExp(`^      ${input}:$`, "gm"))?.length,
      2,
      `rebase ${input}: declared for workflow_call and workflow_dispatch`,
    );
  }

  const resolver = readWorkflow("resolve-pr-conflicts.yml");
  assert.match(resolver, /github\.ref_name == 'github-actions'/);
  assert.match(resolver, /ref:"github-actions"/);
  assert.doesNotMatch(resolver, /ref:"develop"/);
  assert.match(resolver, /github\.actor == 'github-actions\[bot\]'/);
  assert.doesNotMatch(
    resolver,
    /github\.actor == 'thingtime-ci-control\[bot\]'/,
    "CI Control App selects detector compute; exact workers are GITHUB_TOKEN-authored",
  );
  assert.match(resolver, /\[ "\$EVENT_REF" = github-actions \]/);
  assert.doesNotMatch(resolver, /\[ "\$EVENT_REF" = develop \]/);
  assert.doesNotMatch(resolver, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(resolver, /routing_proof: \$\{\{ inputs\.routing_proof/);
  assert.match(resolver, /routing_proof_issued_at: \$\{\{ inputs\.routing_proof_issued_at/);
  assert.match(resolver, /internal_worker: >-/);
  assert.match(resolver, /routing_proof:\$routing_proof/);
  assert.match(resolver, /routing_proof_issued_at:\$routing_proof_issued_at/);
  for (const input of [
    "promotion_source_pr",
    "promotion_plan_b64",
    "routing_proof",
    "routing_proof_issued_at",
  ]) {
    assert.equal(
      resolver.match(new RegExp(`^      ${input}:$`, "gm"))?.length,
      2,
      `${input}: declared for workflow_call and workflow_dispatch`,
    );
  }

  assertAdminModelRouting(resolver, rebase);
  assertResolverLockfileRecovery(resolver);
  assertObservableLabelCleanup(rebase);
  assertBareControlPlaneTree();
  assertControlPlaneVercelConfig();
  // Cover the assertion itself, so it is verified even where the checkout is
  // not the control plane.
  assert.throws(
    () =>
      assertBareControlPlaneTree({
        entries: [".github", "README.md", "CHANGELOG.md", "vercel.json", "remix"],
      }),
    /unexpected root path\(s\): remix/,
    "a regrown product tree must fail the bare-tree invariant",
  );
  assert.throws(
    () => assertBareControlPlaneTree({ entries: [".github", "README.md", "vercel.json"] }),
    /must keep CHANGELOG\.md/,
    "the control plane must keep its own changelog",
  );
  assert.throws(
    () => assertBareControlPlaneTree({ entries: [".github", "README.md", "CHANGELOG.md"] }),
    /must keep vercel\.json/,
    "the control plane must keep its Vercel deployment kill-switch",
  );
  assertBareControlPlaneTree({
    entries: [
      ".github",
      ".gitignore",
      "AI_ALL.md",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "CHANGELOG.md",
      "vercel.json",
    ],
  });
  assertControlPlaneVercelConfig({
    config: {
      framework: null,
      ignoreCommand: "exit 0",
      git: { deploymentEnabled: false },
    },
  });
  assert.throws(
    () =>
      assertControlPlaneVercelConfig({
        config: {
          framework: null,
          ignoreCommand: "exit 0",
          git: { deploymentEnabled: true },
        },
      }),
    /must disable every Git deployment/,
  );

  console.log("workflow control-plane contract: self-test OK");
}

// The only paths this branch may hold at its root. `.github/**` is the point of
// the branch; `.gitattributes` preserves the generated graph's merge contract,
// and the AI instruction trio stays because agents work here too
// (`AGENTS.md` and `CLAUDE.md` are symlinks to `AI_ALL.md`, so all three must
// travel together or the links dangle).
export const CONTROL_PLANE_ROOTS = new Set([
  ".github",
  ".gitattributes",
  ".gitignore",
  "AI_ALL.md",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "CHANGELOG.md",
  "vercel.json",
]);

// The bare-tree invariant. Without it the branch regrows silently — someone
// merges a product branch in to fix a path, and the drift this branch was
// stripped to eliminate is back, with CI once again testing a stale copy of an
// app that nothing reads. Runs only on the control plane: a product-branch
// checkout legitimately has remix/, docs/, iOS/ and the rest, and this contract
// is invoked exclusively by control-plane-ci.yml.
export function assertBareControlPlaneTree({ root = resolve(githubRoot, ".."), entries = null } = {}) {
  // Read git's tracked INDEX, not the filesystem and not HEAD: what the branch
  // carries is the invariant. The filesystem holds untracked node_modules and
  // editor droppings that must not fail the contract, and HEAD would miss a
  // staged strip — the index is what a clean CI checkout materialises.
  const present = entries ?? [...new Set(
    execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .map((path) => path.trim().split("/")[0])
      .filter(Boolean),
  )];
  const unexpected = present.filter((name) => !CONTROL_PLANE_ROOTS.has(name)).sort();
  assert.deepEqual(
    unexpected,
    [],
    `the control plane must stay bare; unexpected root path(s): ${unexpected.join(", ")}. ` +
      "Add a genuinely required path to CONTROL_PLANE_ROOTS in the same commit, " +
      "so it is reviewed rather than discovered later.",
  );
  for (const required of [".github", "README.md", "CHANGELOG.md", "vercel.json"]) {
    assert.ok(present.includes(required), `the control plane must keep ${required}`);
  }
}

export function assertControlPlaneVercelConfig({
  root = resolve(githubRoot, ".."),
  config = null,
} = {}) {
  const value = config ?? JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

  assert.equal(value.framework, null, "the control plane must use Vercel's Other preset");
  assert.equal(
    value.git?.deploymentEnabled,
    false,
    "the control plane must disable every Git deployment",
  );
  assert.equal(value.ignoreCommand, "exit 0", "the control plane must ignore any fallback build");

  for (const forbidden of ["buildCommand", "installCommand", "outputDirectory"]) {
    assert.equal(
      Object.hasOwn(value, forbidden),
      false,
      `the control plane must not declare ${forbidden}`,
    );
  }
}

if (process.argv.includes("--self-test")) {
  assertControlPlaneContract();
} else {
  console.error("Pass --self-test to run the workflow control-plane contract.");
  process.exitCode = 2;
}
