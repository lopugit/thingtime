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
const codeqlBackfillScriptPath = resolve(scripts, "codeql-open-pr-backfill.mjs");

const IMPLEMENTATIONS = [
  "codeql-analysis.yml",
  "codeql-pr-handoff.yml",
  "develop-pr-preview.yml",
  "electron-release.yml",
  "electron-pr-release.yml",
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
// Composed option ids (`<model>[:<effort>][:fast]`) from the expanded Admin
// catalog. The loader stays a closed grammar: a charset that can never lead
// with `-` or contain a space, a closed effort segment set, and a closed
// Claude base-model pattern the CLI chain is rebuilt from.
const ADMIN_MODEL_ID_CHARSET = "[a-z0-9][a-z0-9.:-]{0,63}";
const ADMIN_MODEL_EFFORT_SEGMENTS = "none|minimal|low|medium|high|xhigh|max|ultra";
const ADMIN_CLAUDE_BASE_PATTERN = "^claude-[a-z0-9-]{1,48}$";
// Must stay identical to the promotion audit gate's own cap in
// resolve-pr-conflicts.yml; the loader-side guard exists to fail closed
// *before* that gate can hard-fail a finished resolution.
const ADMIN_MODEL_ARGS_CAP = 2048;
const AI_RUNTIME_YAML = [
  ".github/actions/lopu-agent/action.yml",
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

// One Admin dial drives every model-backed Lopu lane, so each copy of the
// loader must enforce the identical grammar. A copy that quietly accepts an id
// the others reject produces a split brain — the same setting routing one lane
// to a named model and another to `default`. Pin the grammar on every copy,
// including the build doctor's, which emits no `primary_model` and so cannot
// use the fuller `assertAdminLoader` below.
function assertAdminWaterfallGrammar(block, label) {
  assert.ok(
    block.includes(ADMIN_MODEL_ENDPOINT),
    `${label}: fetches Thingtime Admin endpoint`,
  );
  assert.ok(
    block.includes(ADMIN_MODEL_KEY),
    `${label}: validates the exact Admin setting key`,
  );
  assert.ok(
    block.includes(ADMIN_MODEL_ID_CHARSET),
    `${label}: validates the closed composed-id charset`,
  );
  assert.ok(
    block.includes(ADMIN_MODEL_EFFORT_SEGMENTS),
    `${label}: parses the closed effort segment set`,
  );
  assert.ok(
    block.includes(ADMIN_CLAUDE_BASE_PATTERN),
    `${label}: rebuilds Claude models from the closed base pattern`,
  );
  assert.ok(
    block.includes('. + ["default"]'),
    `${label}: appends the default hard fallback defensively`,
  );
  // A repeated segment (`model:fast:fast`, `model:high:low`) must fail the
  // whole mapping closed rather than being silently absorbed by one copy.
  assert.ok(
    block.includes('[ "$fast" -eq 0 ] || segments_ok=0'),
    `${label}: rejects a repeated fast segment`,
  );
  assert.ok(
    block.includes('[ -z "$effort" ] || segments_ok=0'),
    `${label}: rejects a repeated effort segment`,
  );
  assert.match(
    block,
    /--effort \$claude_effort/u,
    `${label}: appends the validated session effort to the model args`,
  );
  assert.match(
    block,
    /model_args=.*>> "\$GITHUB_OUTPUT"/u,
    `${label}: exports validated model args`,
  );
  assertAdminTransportCap(block, label);
}

// The promotion publish step rejects a `model_args` longer than
// ADMIN_MODEL_ARGS_CAP characters, so a valid-but-oversized chain has to
// collapse here rather than hard-fail after the resolution work is finished.
// Widening the waterfall to 256 ids made that reachable, and the guard now
// lives in three copies of the loader with the same split-brain risk as the
// grammar above — so pin its cap, its ordering, and its fail-closed body.
function assertAdminTransportCap(block, label) {
  const guard = new RegExp(
    `if \\[ "\\$\\{#(?:model_)?args\\}" -gt ${ADMIN_MODEL_ARGS_CAP} \\]; then\\n([\\s\\S]*?)\\n\\s*fi\\n`,
    "u",
  ).exec(block);
  assert.ok(
    guard,
    `${label}: caps the assembled model args at the ${ADMIN_MODEL_ARGS_CAP}-character transport limit`,
  );
  const body = guard[1];
  assert.match(
    body,
    /::warning::/u,
    `${label}: warns when the transport cap collapses the chain`,
  );
  assert.match(
    body,
    /claude_effort="max"/u,
    `${label}: transport-cap fallback resets the session effort`,
  );
  assert.match(
    body,
    /(?:model_)?args="--model \$\{?[a-z_]+.*--effort \$claude_effort"/u,
    `${label}: transport-cap fallback rebuilds the chain from validated variables`,
  );
  // Measuring anything but the finished chain would let an oversized value
  // through to the downstream gate, which is the failure this guard exists to
  // prevent — so pin assembly < guard < export.
  const assembled = block.search(
    /(?:model_)?args="\$(?:model_)?args --effort \$claude_effort"/u,
  );
  const capped = block.indexOf(`-gt ${ADMIN_MODEL_ARGS_CAP}`);
  const exported = block.search(/echo "model_args=/u);
  assert.ok(
    assembled >= 0 && assembled < capped && capped < exported,
    `${label}: measures the finished chain after assembly and before export`,
  );
}

function assertAdminLoader(block, label) {
  assertAdminWaterfallGrammar(block, label);
  assert.match(
    block,
    /primary_model=.*>> "\$GITHUB_OUTPUT"/u,
    `${label}: exports validated primary model`,
  );
}

function assertAdminModelRouting(resolver, rebase, allBranch) {
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
  const buildDoctorLoader = workflowBlock(
    allBranch,
    "      - name: Load the build-doctor model waterfall\n",
    "      - name: Lopu build doctor round 1\n",
    "build-doctor model loader",
  );

  assertAdminLoader(resolverLoader, "resolver model loader");
  assertAdminLoader(rebaseLoader, "rebase model loader");
  // The build doctor reuses the same Admin dial and hands its result to the
  // same Claude CLI, so it is held to the same grammar even though the rest of
  // all-branch.yml owns its bounded build-doctor policy separately.
  assertAdminWaterfallGrammar(buildDoctorLoader, "build-doctor model loader");
  assert.doesNotMatch(
    rebaseLoader,
    /steps\.start\.outputs\.complete/u,
    "rebase model loader: runs for clean rebases so Graphify receives the Admin model",
  );

  // The loader-side cap is only useful while it matches the promotion audit
  // gate it front-runs. If the two ever drift apart, an oversized chain is
  // either rejected for no reason or reaches the gate the guard exists to
  // keep it away from, so pin both ends of the shared constant.
  assert.ok(
    resolver.includes(`(( \${#MODEL_ARGS} <= ${ADMIN_MODEL_ARGS_CAP} ))`),
    `promotion audit gate: enforces the same ${ADMIN_MODEL_ARGS_CAP}-character model-args cap as the loaders`,
  );
  assert.ok(
    resolver.includes(
      `value.model_args.length <= ${ADMIN_MODEL_ARGS_CAP}`,
    ),
    `promotion attestation replay: enforces the same ${ADMIN_MODEL_ARGS_CAP}-character model-args cap as the loaders`,
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
      return /uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@|\bbackend=(?:["']?)claude(?:-cli)?(?:["']?)\b|GRAPHIFY_(?:CLAUDE_CLI|OPENAI)_MODEL|--model\b/u.test(
        source,
      );
    })
    .map((path) => relative(resolve(githubRoot, ".."), path))
    // all-branch.yml owns its bounded build-doctor policy separately; this
    // contract covers the Lopu resolver/rebase execution fleet.
    .filter((path) => path !== ".github/workflows/all-branch.yml")
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

  const lopuAgent = readFileSync(
    resolve(actions, "lopu-agent/action.yml"),
    "utf8",
  );
  assert.match(
    lopuAgent,
    /uses:\s*anthropics\/claude-code-action@1623c36729ac1cd5895198cded705a287de7db79/u,
    "the single Lopu action pins Claude's executable implementation",
  );
  assert.match(
    lopuAgent,
    /uses:\s*openai\/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e/u,
    "the single Lopu action pins Codex's executable implementation",
  );
  assert.match(
    lopuAgent,
    /classify-claude-credential-failure\.mjs/u,
    "the single Lopu action classifies primary account-capacity failures before failover",
  );
  assert.match(
    lopuAgent,
    /steps\.claude_1_failure\.outputs\.retryable == 'true'[\s\S]*steps\.claude_7_failure\.outputs\.retryable == 'true'/u,
    "every later vault credential is limited to classified credential or account-capacity failures",
  );
  assert.match(
    lopuAgent,
    /lopu-claude-credential-token/u,
    "the single Lopu action stores the selected credential for exact-session continuation",
  );
  for (const path of runtimeFiles.filter((path) => path !== ".github/actions/lopu-agent/action.yml")) {
    const source = readFileSync(resolve(githubRoot, "..", path), "utf8");
    assert.doesNotMatch(
      source,
      /uses:\s*(?:anthropics\/claude-code-action|openai\/codex-action)@/u,
      `${path}: model execution goes through the single protected Lopu action`,
    );
  }

  const claudeActionCount = runtimeFiles.reduce((count, path) => {
    const source = readFileSync(resolve(githubRoot, "..", path), "utf8");
    return count +
      (source.match(/uses:\s*anthropics\/claude-code-action@/gu)?.length ?? 0);
  }, 0);
  assert.equal(
    claudeActionCount,
    8,
    "only the single Lopu action owns the bounded eight-position Claude credential waterfall",
  );
  const credentialVaultProbe = resolver.slice(
    resolver.indexOf("\n  verify_credential_vault:"),
    resolver.indexOf("\n  route:"),
  );
  assert.match(
    credentialVaultProbe,
    /uses: \.\/\.github\/actions\/lopu-agent[\s\S]*--max-turns 1/u,
    "credential-vault maintenance bounds its authentication probe to one turn",
  );
  const resumableRuntimeSource = (path, source) =>
    path === ".github/workflows/resolve-pr-conflicts.yml"
      ? source.replace(credentialVaultProbe, "")
      : source;
  const turnBudgets = runtimeFiles.flatMap((path) => {
    const source = resumableRuntimeSource(
      path,
      readFileSync(resolve(githubRoot, "..", path), "utf8"),
    );
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
    .map((path) => resumableRuntimeSource(
      path,
      readFileSync(resolve(githubRoot, "..", path), "utf8"),
    ))
    .join("\n");
  const lopuCallCount =
    runtimeSource.match(/uses:\s*\.\/(?:trusted\/)?\.github\/actions\/lopu-agent/gu)?.length ?? 0;
  assert.ok(
    (runtimeSource.match(/steps\.[A-Za-z0-9_]+\.outcome == 'failure'/gu)?.length ?? 0) >=
      lopuCallCount,
    "each independently resumable Claude runtime classifies its failed result before continuation",
  );
  assert.ok(
    (runtimeSource.match(/RESULT_SUBTYPE[^\n]+error_max_turns/gu)?.length ?? 0) >=
      lopuCallCount,
    "only error_max_turns can enter exact-session continuation",
  );
  assert.equal(
    runtimeSource.match(/claude --resume "\$session_id" --print/gu)?.length,
    lopuCallCount,
    "every Lopu caller that can select Claude has an exact --resume continuation path",
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

function assertUserControlledMergePause(resolver, rebase) {
  for (const [name, source] of [
    ["merge resolver", resolver],
    ["rebase resolver", rebase],
  ]) {
    assert.doesNotMatch(
      source,
      /labels\/ai-merge-paused|labels:\s*\[\s*"ai-merge-paused"\s*\]|label create ai-merge-paused|remove_label(?:_verified)?\s+ai-merge-paused|--(?:add|remove)-label\s+ai-merge-paused/u,
      `${name}: never mutates the user-controlled ai-merge-paused label`,
    );
  }

  assert.match(
    resolver,
    /Honor user-controlled ai-merge-paused[\s\S]*skipping all automated resolution/u,
    "merge resolver: queued workers re-check the user pause before checkout or AI work",
  );
  assert.match(
    resolver,
    /select\(\[\.labels\[\]\.name\] \| index\("ai-merge-paused"\) == null\)/u,
    "merge resolver: detector excludes every user-paused PR without stale-snapshot recovery",
  );
  assert.match(
    rebase,
    /user-controlled ai-merge-paused is present[\s\S]*continue/u,
    "rebase resolver: detector stops on the same user pause",
  );
}

function assertResolverLockfileRecovery(resolver) {
  const prompt = workflowBlock(
    resolver,
    "      - name: Resolve conflicts with Lopu\n",
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

  const codeql = readWorkflow("codeql-analysis.yml");
  const codeqlHandoff = readWorkflow("codeql-pr-handoff.yml");
  const codeqlBackfill = readFileSync(codeqlBackfillScriptPath, "utf8");
  const codeqlTriggers = codeql.slice(0, codeql.indexOf("\npermissions:\n"));
  assert.match(
    codeql,
    /run-name:[\s\S]*Lopu CodeQL PR #\{0\} @ \{1\}[\s\S]*github\.event\.pull_request\.head\.sha/u,
    "current central and ordinary PR scans expose the immutable head in their run title",
  );
  assert.match(
    codeql,
    /^  pull_request:$/mu,
    "PRs targeting the protected branch receive a direct CodeQL analysis",
  );
  assert.match(
    codeql,
    /^  push:\n    branches: \[github-actions\]$/mu,
    "the protected branch scans its own direct pushes",
  );
  assert.match(codeql, /github\/codeql-action\/init@4c0873ef8656cb3c50b3f42fb63bc1ade0cfa827/u);
  assert.match(codeql, /github\/codeql-action\/analyze@4c0873ef8656cb3c50b3f42fb63bc1ade0cfa827/u);
  assert.match(codeql, /language: \[actions, javascript-typescript\]/u);
  assert.match(codeql, /^      security-events: write$/mu);
  assert.match(
    codeql,
    /group: >-\n\s+codeql-\$\{\{ matrix\.language \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ needs\.scope\.outputs\.analysis_sha \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
    "CodeQL concurrency is fenced to the language, event owner, and immutable analyzed snapshot",
  );
  assert.match(
    codeql,
    /queue: max\n\s+cancel-in-progress: false/u,
    "CodeQL preserves queued snapshots and never leaves a cancelled analyzer check",
  );
  assert.match(
    codeql,
    /any\(\.\[\]; \.headRefOid == \$sha\)/u,
    "an open PR owns one analysis instead of duplicating its branch push",
  );
  // The scope pre-flight samples ownership seconds after the push, so a branch
  // pushed first and adopted by a PR moments later still reaches the analyzer
  // believing it owns analysis. The resulting refs/heads analysis at a live PR
  // head makes GHAS open that PR's CodeQL check against the branch snapshot and
  // close it `timed_out` with only one of the two configurations present.
  assert.match(
    codeql,
    /- name: Initialize CodeQL[\s\S]*?- name: Confirm this push still owns the analysis[\s\S]*?- name: Analyze the triggering revision/u,
    "the ownership re-check sits after database init, so it absorbs the whole init window before the upload",
  );
  assert.match(
    codeql,
    /- name: Confirm this push still owns the analysis\n\s+id: ownership\n\s+if: github\.event_name == 'push' && needs\.scope\.outputs\.analysis_ref == ''/u,
    "only a branch-ref push re-checks ownership; PR and centrally dispatched runs are untouched",
  );
  assert.match(
    codeql,
    /- name: Analyze the triggering revision\n\s+if: needs\.scope\.outputs\.analysis_ref == '' && steps\.ownership\.outputs\.upload != 'false'/u,
    "the re-check suppresses only an adopted branch upload, and its skipped empty output still analyzes every other event",
  );
  assert.match(
    codeql,
    /if open_prs="\$\(gh pr list[\s\S]*?\)"; then[\s\S]*?\n          else\n\s+echo "::warning::Could not re-confirm PR ownership/u,
    "a transient ownership lookup keeps the prepared analysis instead of failing the CodeQL check it exists to protect",
  );
  assert.match(
    codeql,
    /^      actions: read\n      contents: read\n      packages: read\n      pull-requests: read\n      security-events: write$/mu,
    "the analyzer reads PR ownership without gaining any write beyond its security-events upload",
  );
  assert.match(codeql, /ADVANCED_ENABLED: \$\{\{ vars\.CODEQL_ADVANCED_ENABLED \}\}/u);
  assert.match(
    codeql,
    /backfill_listener_owned:[\s\S]*type: boolean/u,
    "a trusted manual activation can backfill PRs that predate their target's listener",
  );
  assert.match(
    codeql,
    /BACKFILL_LISTENER_OWNED: \$\{\{ inputs\.backfill_listener_owned \}\}/u,
    "the activation-backfill choice reaches only the unprivileged analyzer scope",
  );
  assert.match(
    codeql,
    /base_has_pr_listener[\s\S]*BACKFILL_LISTENER_OWNED[\s\S]*analysis_ref="\$merge_ref"/u,
    "listener-owned historical PRs can be centrally backfilled without changing their branch",
  );
  assert.match(
    codeql,
    /merge_sha=""[\s\S]*if candidate_merge_sha="\$\([\s\S]*git\/ref\/pull\/\$PR_NUMBER\/merge[\s\S]*\)"; then[\s\S]*\[\[ "\$candidate_merge_sha" =~ \^\[0-9a-f\]\{40,64\}\$ \]\][\s\S]*merge_sha="\$candidate_merge_sha"/u,
    "a missing synthetic merge ref cannot turn GitHub's 404 JSON body into a commit SHA",
  );
  assert.doesNotMatch(
    codeql,
    /merge_sha="\$\(gh api[^\n]*git\/ref\/pull\/\$PR_NUMBER\/merge[^\n]*\|\| true\)"/u,
    "the exact-head CodeQL fallback must preserve the gh api failure status",
  );
  assert.match(
    codeql,
    /\[ "\$ADVANCED_ENABLED" != true \][\s\S]*analyze=false/u,
    "advanced uploads remain cleanly inactive until the ordered default-setup transition completes",
  );
  assert.match(codeql, /persist-credentials: false/u);
  assert.doesNotMatch(
    codeqlTriggers,
    /^  pull_request_target:/mu,
    "the protected CodeQL implementation is never a direct privileged PR listener",
  );
  assert.doesNotMatch(codeql, /ANTHROPIC_API_KEY|OPENAI_API_KEY|secrets\./u, "CodeQL never receives an AI credential");
  assert.match(codeqlHandoff, /^  workflow_call:$/mu);
  assert.doesNotMatch(
    codeqlHandoff,
    /^  (?:pull_request|pull_request_target|push|schedule|workflow_dispatch|repository_dispatch):/mu,
    "the CodeQL handoff is reachable only through the product listener",
  );
  assert.match(codeqlHandoff, /github\.event_name == 'pull_request_target'/u);
  assert.match(codeqlHandoff, /CODEQL_CENTRAL_PR_ENABLED/u);
  assert.match(codeqlHandoff, /^      actions: write$/mu);
  assert.match(codeqlHandoff, /gh workflow run codeql-analysis\.yml/u);
  assert.match(codeqlHandoff, /--ref "\$DEFAULT_BRANCH"/u);
  assert.doesNotMatch(
    codeqlHandoff,
    /actions\/checkout|codeql-action\/(?:init|analyze)|LOPU_AGENT_BACKEND|ANTHROPIC|OPENAI|\bsecrets\./u,
    "the privileged target-context path only dispatches trusted metadata",
  );
  assert.doesNotMatch(
    codeql,
    /^  pull_request_target:|^      actions: write$/mu,
    "the unprivileged CodeQL analyzer never inherits the target-event write ceiling",
  );
  assert.match(codeql, /base_has_pr_listener/u);
  assert.match(codeql, /git\/ref\/pull\/\$PR_NUMBER\/merge/u);
  assert.match(codeql, /git\/commits\/\$merge_sha/u);
  // The property is that the freshness check still compares the merge commit's
  // first parent against a base and its second against the live head. Pin those
  // two comparisons separately rather than as one adjacent phrase: the jq
  // program is legitimately rewritten across more than one line the moment a
  // second accepted base is added (PR #579 widens `.[0]` to also accept the
  // live base branch tip, because `pulls/N.base.sha` and `refs/pull/N/merge`
  // are refreshed independently and skew whenever the base advances). Pinning
  // the single-line spelling made this contract fail on that rewrite while the
  // property it exists to protect was fully intact — and both PRs land on this
  // same base, so the union of the two is exactly the tree CI would run.
  assert.match(
    codeql,
    /\.\[0\] == \$base/u,
    "the merge-ref freshness check still compares the first parent against the PR base",
  );
  assert.match(
    codeql,
    /\.\[1\] == \$head/u,
    "the merge-ref freshness check still requires the second parent to be the live head",
  );
  // A stale merge ref and an absent one are different facts and must stay
  // separately recorded. The freshness check clears `merge_sha`; only a PR
  // GitHub cannot merge clears `mergeable_pr`, and only that PR has no
  // `pull_request` run of its own. Gating listener ownership on the cleared
  // `merge_sha` is what sent a dispatched backfill down the exact-head
  // fallback alongside a live `pull_request` merge-ref analysis, split one
  // PR's two languages across two refs, and closed its aggregate CodeQL check
  // `timed_out` (PR #557 @ bb151336, run 33624842347).
  assert.match(
    codeql,
    /mergeable_pr=true/u,
    "the analyzer scope records that GitHub published a merge ref independently of whether that ref is current",
  );
  assert.match(
    codeql,
    /if \[ "\$base_has_pr_listener" = true \] \\\n\s+&& \[ "\$mergeable_pr" = true \] \\\n\s+&& \[ "\$BACKFILL_LISTENER_OWNED" != true \]; then\n\s+analyze=false/u,
    "a mergeable listener-owned PR is never centrally re-analyzed on its exact head beside its own pull_request run",
  );
  assert.doesNotMatch(
    codeql,
    /if \[ "\$base_has_pr_listener" = true \] \\\n\s+&& \[ -n "\$merge_sha" \]/u,
    "listener ownership must not be decided by the freshness-cleared merge SHA",
  );
  // The three assertions above pin how `mergeable_pr` is read but not how it
  // is written, and the regression that matters is a write: adding
  // `mergeable_pr=false` beside the `merge_sha=""` in the freshness check
  // re-collapses the two facts and reproduces #557 exactly (`analyze=true`,
  // `ref=refs/pull/N/head` beside the live `pull_request` merge-ref run) while
  // leaving all three green. Pin the variable's whole lifecycle instead: two
  // assignments, in this order, and the `true` only where a well-formed
  // published merge SHA is captured. Nothing between the lookup and the
  // ownership gate may touch it.
  assert.deepEqual(
    codeql.match(/^\s*mergeable_pr=\S+$/gmu)?.map((assignment) => assignment.trim()),
    ["mergeable_pr=false", "mergeable_pr=true"],
    "`mergeable_pr` is initialized false and set true exactly once, so the freshness check cannot clear it",
  );
  assert.match(
    codeql,
    /merge_sha="\$candidate_merge_sha"\n\s+mergeable_pr=true$/mu,
    "`mergeable_pr` records the published merge SHA GitHub actually returned, never an unconditional default",
  );
  assert.match(codeql, /analysis_ref="refs\/pull\/\$PR_NUMBER\/head"/u);
  assert.match(codeql, /code-scanning\/analyses\?ref=\$encoded_ref/u);
  assert.match(codeql, /^      security-events: read$/mu);
  assert.match(codeql, /ref: \$\{\{ needs\.scope\.outputs\.analysis_ref \}\}/u);
  assert.match(codeql, /sha: \$\{\{ needs\.scope\.outputs\.analysis_sha \}\}/u);
  assert.match(codeqlBackfill, /backfill_listener_owned: "true"/u);
  assert.match(codeqlBackfill, /sort\(\(left, right\)[\s\S]*right\.updated_at/u);
  assert.match(codeqlBackfill, /ACTIVE_RUN_STATUSES/u);
  assert.match(codeqlBackfill, /git\/ref\/pull\/\$\{number\}\/merge/u);
  assert.match(codeqlBackfill, /parents\[0\] === baseSha[\s\S]*parents\[1\] === headSha/u);
  assert.match(codeqlBackfill, /analysisSnapshots\.get\(number\)/u);
  assert.doesNotMatch(
    codeqlBackfill,
    /pullRequest\.merge_commit_sha/u,
    "CodeQL inventory never trusts the lagging pull-list synthetic merge SHA",
  );
  assert.match(codeqlBackfill, /MAX_DISPATCHES must be an integer from 1 through 20/u);
  // This helper is the one read-failure classifier outside resolve-pr-conflicts.yml,
  // so the routing contract's "never classify transience by HTTP status alone"
  // assertion cannot see it. Pin the same transport and truncated-body patterns
  // here: status-only matching is what made an upstream blip fatal on the first
  // attempt in runs 33262097171 and 33316907281.
  assert.match(
    codeqlBackfill,
    /TRANSIENT_READ_FAILURE\s*=\s*\/[^\n]*\|stream error\|[^\n]*\|\[Uu\]nexpected end of JSON input\|/u,
    "the CodeQL inventory read helper retries transport resets and truncated bodies",
  );
  assert.match(
    codeqlBackfill,
    /const transient = TRANSIENT_READ_FAILURE\.test\(failure\)\n\s*\|\| isTruncatedJsonRead\(output, error\);\n\s*if \(attempt === attempts \|\| !transient\)/u,
    "the CodeQL inventory read helper branches on the widened classifier and the truncation test",
  );
  // That message pattern can only classify the half gh decodes: Go reports every
  // short body as `unexpected end of JSON input`, but when this script decodes,
  // V8's message is position-specific, so a body cut mid-string or mid-number
  // says `Unterminated string in JSON at position N` and matches no message
  // list. Pin the structural test that classifies the half this script decodes
  // -- comparing the parse position against the length received separates a
  // valid-but-short prefix from a corrupt payload without tracking V8's
  // wording, which has already changed once. Its behaviour is covered by the
  // self-test executed below, so this assertion only guards its removal.
  assert.match(
    codeqlBackfill,
    /export function isTruncatedJsonRead\(text, error\)[\s\S]*at position \(\\d\+\)[\s\S]*trimEnd\(\)\.length/u,
    "the CodeQL inventory read helper classifies a short body by parse position, not by V8 wording",
  );
  // The dispatch POST must keep the narrow status-only classifier: a reset
  // proves nothing about whether GitHub already queued the scan, so replaying
  // one could start a duplicate analysis.
  assert.match(
    codeqlBackfill,
    /!TRANSIENT_HTTP_STATUS\.test\(failure\)\) \{\n\s*throw new Error\(`CodeQL dispatch for PR/u,
    "the mutating CodeQL dispatch stays status-only and never replays on a transport reset",
  );
  assert.doesNotMatch(
    codeqlBackfill,
    /ANTHROPIC|OPENAI|actions\/checkout/u,
    "the CodeQL inventory helper receives no model credential and executes no PR code",
  );
  execFileSync(process.execPath, [codeqlBackfillScriptPath, "--self-test"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const developPreview = readWorkflow("develop-pr-preview.yml");
  assert.match(
    developPreview,
    /group: develop-pr-preview-\$\{\{ github\.event_name == 'pull_request_target' && 'handoff' \|\| 'worker' \}\}-/u,
    "develop preview keeps its metadata handoff separate from the dispatched worker",
  );
  assert.match(
    developPreview,
    /group: develop-pr-preview-[^\n]+\n\s*queue: max\n\s*cancel-in-progress: false/u,
    "develop preview queues per-PR requests without cancelling an active handoff or deployment",
  );
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
    /^    if: github\.event_name == 'pull_request_target'$/mu,
    "develop preview dispatches every PR event so the protected controller can resolve a bounded stack",
  );
  assert.match(
    developPreview,
    /PR_HEAD_REF:[\s\S]*head_ref: process\.env\.PR_HEAD_REF/u,
    "develop preview preserves the source head ref for closed-event provenance",
  );
  assert.match(
    developPreview,
    /^    if: github\.event_name != 'pull_request_target'$/mu,
    "develop preview always schedules its trusted controller outside PR listeners",
  );
  assert.doesNotMatch(
    developPreview,
    /inputs\.pr_number > 0/u,
    "develop preview never filters manual recovery on a reusable-workflow input",
  );
  assert.doesNotMatch(
    developPreview,
    /github\.ref == 'refs\/heads\/main'/u,
    "develop preview delegates the manual branch gate to its protected environment",
  );
  const developPreviewBuildJob = developPreview.match(/\n  build:\n[\s\S]*?\n  controller:\n/u)?.[0] ?? "";
  const developPreviewPrepareJob = developPreview.match(/\n  prepare:\n[\s\S]*?\n  build:\n/u)?.[0] ?? "";
  assert.match(
    developPreviewPrepareJob,
    /environment: vercel-develop-pr-control/u,
    "the protected authorizer can read its environment-scoped non-secret settings",
  );
  assert.doesNotMatch(
    developPreviewBuildJob,
    /environment: vercel-develop-pr-control/u,
    "untrusted product build code does not attach to the protected publisher environment",
  );
  assert.match(
    developPreviewBuildJob,
    /name: Build exact PR bundle without secrets[\s\S]*ref: \$\{\{ needs\.prepare\.outputs\.head_sha \}\}/u,
    "develop preview builds only the exact SHA authorized by the protected controller",
  );
  assert.match(
    developPreviewBuildJob,
    /node scripts\/vercel-build\.mjs[\s\S]*actions\/upload-artifact@[0-9a-f]{40}/u,
    "develop preview builds Vercel output on GitHub and hands it off through a pinned artifact action",
  );
  assert.doesNotMatch(
    developPreviewBuildJob,
    /secrets\.|VERCEL_API_TOKEN|THINGTIME_DEVELOP_S3_CORS_PROBE_URL/u,
    "untrusted product build code receives no preview deployment secret",
  );
  const developPreviewControllerJob = developPreview.match(/\n  controller:\n[\s\S]*$/u)?.[0] ?? "";
  assert.match(
    developPreviewControllerJob,
    /environment: vercel-develop-pr-control[\s\S]*actions\/download-artifact@[0-9a-f]{40}/u,
    "only the protected publisher downloads the GitHub-built artifact",
  );
  assert.match(
    developPreviewControllerJob,
    /extract-vercel-prebuilt\.py[\s\S]*vercel@59\.10\.0[\s\S]*VERCEL_PREBUILT_DIR/u,
    "the publisher validates the untrusted archive and uses a pinned prebuilt-only Vercel CLI",
  );
  assert.doesNotMatch(
    developPreviewControllerJob,
    /checkout[\s\S]{0,240}ref: \$\{\{ needs\.prepare\.outputs\.head_sha \}\}/u,
    "the secret-bearing publisher never checks out the product branch",
  );
  const developPreviewController = readFileSync(
    resolve(scripts, "deploy-develop-pr-preview.mjs"),
    "utf8",
  );
  assert.match(
    developPreviewController,
    /eventName === 'workflow_dispatch'[\s\S]*boundedInteger\(event\.inputs\?\.pr_number, 'PR number'\)/u,
    "develop preview validates the original manual PR input inside the trusted controller",
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
    if (name === "promote-features-to-main.yml") {
      assert.match(source, /always\(\)/, `${name}: custom lane may continue after the provider route is deliberately skipped`);
      assert.match(
        source,
        /inputs\.source_branch != ''[\s\S]*'ubuntu-latest'[\s\S]*needs\.route\.outputs\.runner_label/,
        `${name}: custom branch\/path authority remains on GitHub while standing work uses only the validated runner label`,
      );
    } else {
      assert.match(source, /runs-on: \$\{\{ needs\.route\.outputs\.runner_label \|\| 'ubuntu-latest' \}\}/, `${name}: uses only the validated runner label`);
    }
    assert.doesNotMatch(source, /runs-on:.*inputs\.runner_label/, `${name}: never schedules directly from caller metadata`);
  }

  const promotions = readWorkflow("promote-features-to-main.yml");
  assert.match(promotions, /^name: Lopu internal feature promotion$/m);
  assert.match(promotions, /^  workflow_call:$/m);
  assert.doesNotMatch(
    promotions,
    /^  (?:push|pull_request|pull_request_target|schedule|workflow_dispatch|repository_dispatch):/m,
    "feature promotion is reachable only through Lopu",
  );
  assert.match(promotions, /ref: github-actions/);
  assert.match(promotions, /workflow-control\/\.github\/scripts\/promote-features-to-main\.mjs/);
  assert.doesNotMatch(
    promotions,
    /promote-features-to-main\.mjs --self-test/u,
    "promoter contract examples never block a live promotion",
  );
  assert.match(promotions, /^  actions: write$/m);
  assert.match(promotions, /ACTIONS_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(
    promotions,
    /actions\/workflows\/promote-features-to-main\.yml\/dispatches/u,
    "the private feature-promotion implementation never dispatches itself as a public workflow",
  );
  assert.match(
    promotions,
    /maintenance_operation:"promote-features"[\s\S]*promotion_source_branch:\$source[\s\S]*promotion_target_branch:\$target[\s\S]*promotion_path_prefix:"\.github\/"[\s\S]*actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/u,
    "custom CI promotion lanes re-enter the one public Lopu manager",
  );
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
  assert.match(
    controlPlaneCi,
    /node --test \.github\/scripts\/rebase-related-edits\.test\.mjs/u,
    "control-plane CI executes the real stopped-rebase related-edit verifier fixture",
  );
  assert.match(
    controlPlaneCi,
    /node --test \.github\/scripts\/resolve-canonical-instruction-type-conflicts\.test\.mjs/u,
    "control-plane CI executes the canonical instruction type-conflict fixture",
  );
  assert.match(
    controlPlaneCi,
    /node --test \.github\/scripts\/lopu-pr-status\.test\.mjs/u,
    "control-plane CI executes the Lopu PR status renderer and classifier fixtures",
  );

  const omnibus = readWorkflow("promote-develop-to-main.yml");
  assert.match(omnibus, /^name: Lopu internal develop promotion$/m);
  assert.match(omnibus, /^  workflow_call:$/m);
  assert.doesNotMatch(
    omnibus,
    /^  (?:push|pull_request|pull_request_target|schedule|workflow_dispatch|repository_dispatch):/m,
    "standing promotion is reachable only through Lopu",
  );
  assert.match(omnibus, /ref: github-actions/);
  assert.match(omnibus, /workflow-control\/\.github\/scripts\/promotion-pr-changelog\.mjs/);
  const standingPromotion = workflowBlock(
    omnibus,
    "  promotion-pr:\n",
    "      - name: Check out trusted automation support\n",
    "promote-develop-to-main.yml standing promotion job",
  );
  assert.match(
    standingPromotion,
    /^    timeout-minutes: 30$/mu,
    "standing promotion cannot hang indefinitely on a slow checkout",
  );
  // Scope the checkout claims to the develop checkout itself. An unscoped
  // `[\s\S]*` chain over the whole file is satisfied by the later
  // workflow-control checkout, so it would keep passing after
  // `persist-credentials: false` is dropped from the step it is meant to pin.
  const developCheckout = workflowBlock(
    standingPromotion,
    "      - name: Check out develop with full history\n",
    "\n\n",
    "promote-develop-to-main.yml develop checkout",
  );
  assert.match(
    developCheckout,
    /^        uses: actions\/checkout@[0-9a-f]{40} #/mu,
    "the develop checkout pins its action by commit",
  );
  assert.match(
    developCheckout,
    /^          fetch-depth: 0$/mu,
    "standing promotion keeps complete commit history",
  );
  assert.match(
    developCheckout,
    /^          filter: blob:none$/mu,
    "standing promotion does not download every historical blob",
  );
  assert.match(
    developCheckout,
    /^          persist-credentials: false$/mu,
    "standing promotion retains no checkout credential",
  );

  const mainDevelopSync = readWorkflow("sync-main-into-develop.yml");
  assert.match(mainDevelopSync, /^name: Lopu internal main\/develop synchronization$/m);
  assert.match(mainDevelopSync, /^  workflow_call:$/m);
  assert.doesNotMatch(
    mainDevelopSync,
    /^  (?:push|pull_request|pull_request_target|schedule|workflow_dispatch|repository_dispatch):/m,
    "main/develop synchronization is reachable only through Lopu",
  );
  assert.match(
    mainDevelopSync,
    /SYNC_BRANCH: sync\/main-into-develop/u,
    "main/develop conflicts use an automation-owned PR branch",
  );
  assert.match(
    mainDevelopSync,
    /--force-with-lease="refs\/heads\/\$SYNC_BRANCH:\$remote_sha"/u,
    "the standing sync branch can move only from its exact observed remote SHA",
  );
  assert.match(
    mainDevelopSync,
    /-f head="\$SYNC_BRANCH"/u,
    "the safe sync PR never uses the protected main branch as its writable head",
  );
  assert.doesNotMatch(
    mainDevelopSync,
    /-f head=(?:"[^"\n]*:)?main"?(?:\s|$)/u,
    "main is never used as the writable head of a synchronization PR",
  );
  assert.match(
    mainDevelopSync,
    /git ls-remote --heads origin refs\/heads\/main refs\/heads\/develop/u,
    "safe sync publication revalidates both immutable branch endpoints against the remote",
  );
  assert.match(
    mainDevelopSync,
    /git merge-base --is-ancestor "\$EXPECTED_MAIN_SHA" "\$remote_sha"/u,
    "an already-resolved safe head containing current main is preserved",
  );
  assert.match(
    mainDevelopSync,
    /id: sync_pr[\s\S]*echo "pr_number=\$existing"[\s\S]*echo "head_sha=\$CANDIDATE_SHA"/u,
    "the standing sync PR publishes its exact identity for terminal merging",
  );
  assert.match(
    mainDevelopSync,
    /name: Check out the trusted sync merger[\s\S]*uses: actions\/checkout@[0-9a-f]{40} #[\s\S]*ref: github-actions[\s\S]*persist-credentials: false[\s\S]*sparse-checkout: \.github\/scripts\/merge-main-develop-sync-pr\.mjs/u,
    "the terminal merger is loaded without credentials from the protected control branch",
  );
  assert.match(
    mainDevelopSync,
    /name: Merge the standing sync PR when ready[\s\S]*SYNC_PR_NUMBER: \$\{\{ steps\.sync_pr\.outputs\.pr_number \}\}[\s\S]*EXPECTED_SYNC_HEAD_SHA: \$\{\{ steps\.sync_pr\.outputs\.head_sha \}\}[\s\S]*EXPECTED_MAIN_SHA: \$\{\{ steps\.merge\.outputs\.main_sha \}\}[\s\S]*EXPECTED_DEVELOP_SHA: \$\{\{ steps\.merge\.outputs\.develop_sha \}\}[\s\S]*node workflow-control\/\.github\/scripts\/merge-main-develop-sync-pr\.mjs/u,
    "a clean standing sync PR merges only with the workflow's exact branch snapshots",
  );
  assert.doesNotMatch(
    mainDevelopSync,
    /gh pr merge[^\n]*--auto/u,
    "main/develop synchronization does not depend on branch-protection-only native auto-merge",
  );

  const rebase = readWorkflow("rebase-pr-stacks.yml");
  const rebaseTriggers = rebase.slice(0, rebase.indexOf("\npermissions:\n"));
  assert.doesNotMatch(
    rebaseTriggers,
    /^  (?:push|pull_request|pull_request_target|repository_dispatch|schedule|workflow_dispatch):/mu,
    "the rebase implementation is reachable only through the unified Lopu manager",
  );
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
    /github\.event_name == 'repository_dispatch'[\s\S]*github\.event\.action == 'rebase-pr-stack-ai'[\s\S]*inputs\.worker_handoff == true/,
    "exact repository events and workflow-call workers are both identified before routing",
  );
  assert.match(rebase, /routing_proof:\$routing_proof/);
  assert.match(rebase, /routing_proof_issued_at:\$routing_proof_issued_at/);
  assert.match(rebase, /event_type:"rebase-pr-stack-ai"/u);
  assert.doesNotMatch(rebase, /actions\/workflows\/rebase-pr-stacks\.yml\/dispatches/u);
  assert.match(
    rebase,
    /name: Configure and begin the rebase[\s\S]*?promisor_fetch_failed\(\)[\s\S]*?could not fetch \[0-9a-f\]\{40\} from promisor remote[\s\S]*?--refetch --no-filter origin[\s\S]*?refs\/heads\/\$HEAD_REF:refs\/remotes\/origin\/\$HEAD_REF[\s\S]*?refs\/heads\/\$BASE_REF:refs\/remotes\/origin\/\$BASE_REF[\s\S]*?attempt_start \|\| status=\$\?[\s\S]*?complete-history retry still could not materialize/u,
    "rebase workers retry a failed lazy promisor fetch once from complete exact branch histories",
  );
  assert.match(
    rebase,
    /handoff:[\s\S]*?permissions:[\s\S]*?contents: write[\s\S]*?repos\/\$REPO\/dispatches/u,
    "repository-dispatch handoff receives Contents write rather than relying on Actions write",
  );
  assert.match(
    rebase,
    /steps\.push\.outputs\.remote_state == 'retry'[\s\S]*ref_race_handoff:true/u,
    "moving rebase refs re-enter the unified controller without manual-selector authority",
  );
  for (const input of ["routing_proof", "routing_proof_issued_at"]) {
    assert.equal(
      rebase.match(new RegExp(`^      ${input}:$`, "gm"))?.length,
      1,
      `rebase ${input}: is declared only for the reusable Lopu engine`,
    );
  }

  const resolver = readWorkflow("resolve-pr-conflicts.yml");
  assert.match(
    resolver,
    /bash trusted\/\.github\/scripts\/resolve-canonical-instruction-type-conflicts\.sh "\$base"/u,
    "the merge resolver normalizes proven canonical instruction type conflicts before AI resolution",
  );
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
  assert.match(
    resolver,
    /remote_head="\$\(gh api "repos\/\$REPO\/git\/ref\/heads\/\$head" --jq '\.object\.sha'\)"/u,
    "repository review publishers look up slash-containing branch refs without double-encoding them",
  );
  assert.doesNotMatch(
    resolver,
    /git\/ref\/heads\/\$\(jq[^\n]*@uri/u,
    "repository review publishers never pass a pre-encoded branch ref through gh api",
  );
  assert.match(resolver, /maintain_develop_promotion:/);
  assert.match(resolver, /maintain_feature_promotions:/);
  assert.match(resolver, /maintain_main_develop_sync:/);
  assert.match(resolver, /maintain_codeql_backfill:/);
  assert.match(
    resolver,
    /name: Merge the verified main to develop sync PR[\s\S]*steps\.push\.outputs\.remote_state == 'published'[\s\S]*matrix\.pr\.head == 'sync\/main-into-develop'[\s\S]*matrix\.pr\.base == 'develop'[\s\S]*EXPECTED_SYNC_HEAD_SHA: \$\{\{ steps\.push\.outputs\.remote_sha \}\}[\s\S]*EXPECTED_DEVELOP_SHA: \$\{\{ matrix\.pr\.base_sha \}\}[\s\S]*git\/ref\/heads\/main[\s\S]*node trusted\/\.github\/scripts\/merge-main-develop-sync-pr\.mjs/u,
    "the resolver terminally merges only the exact published standing main/develop sync PR",
  );
  assert.doesNotMatch(
    resolver,
    /actions\/workflows\/promote-features-to-main\.yml\/dispatches/u,
    "promotion recovery never calls the private implementation as a public workflow",
  );
  assert.equal(
    resolver.match(/maintenance_operation:"promote-features"[\s\S]{0,180}promotion_dry_run:false[\s\S]{0,180}promotion_lookback:"100"[\s\S]{0,220}actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/gu)?.length,
    2,
    "both successful-stack continuation and recoverable promotion retry re-enter Lopu",
  );
  assert.match(resolver, /github\.event\.schedule == '43 \*\/6 \* \* \*'/);
  assert.match(
    resolver,
    /types: \[resolve-conflicts-cascade, rebase-pr-stack-ai\]/u,
    "the single Lopu entrypoint accepts legacy exact stack-worker events",
  );
  assert.match(
    resolver,
    /github\.event\.action == 'rebase-pr-stack-ai'[\s\S]*inputs\.ref_race_handoff == true[\s\S]*&& 'rebase-stack'[\s\S]*\|\| 'resolve-conflicts'/u,
    "exact stack workers and their automatic retries preserve rebase provider policy through Lopu",
  );
  assert.match(
    resolver,
    /manage_rebases:[\s\S]*github\.event_name != 'repository_dispatch'[\s\S]*github\.event\.action == 'rebase-pr-stack-ai'/u,
    "rebase repository events have exactly one rebase owner",
  );
  assert.match(
    resolver,
    /detect:[\s\S]*github\.event_name != 'repository_dispatch'[\s\S]*github\.event\.action == 'resolve-conflicts-cascade'/u,
    "merge cascade repository events have exactly one merge owner",
  );
  assert.match(
    resolver,
    /detect:[\s\S]*inputs\.ref_race_handoff != true/u,
    "automatic rebase retries never also launch merge detection",
  );
  assert.match(
    resolver,
    /review_detect:[\s\S]*github\.event_name != 'repository_dispatch'[\s\S]*inputs\.ref_race_handoff != true/u,
    "internal worker events never launch a duplicate repository review",
  );
  assert.match(
    resolver,
    /pull_request_target:\n\s+types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft, edited, closed\]/u,
    "the public manager owns every lifecycle change that can alter the wildcard all branch",
  );
  assert.match(
    resolver,
    /- cron: "53 \* \* \* \*"/u,
    "the public manager owns the former hourly all-branch backstop",
  );
  assert.match(
    resolver,
    /options: \[manage-prs, promote-develop, promote-features, sync-main-develop, build-all, backfill-codeql, merge-feature-stack, verify-credential-vault\]/u,
    "manual Feature Stack, all-branch, and CodeQL recovery stay inside Lopu maintenance",
  );

  assert.match(
    resolver,
    /verify_credential_vault:[\s\S]*inputs\.maintenance_operation == 'verify-credential-vault'[\s\S]*ref: github-actions[\s\S]*persist-credentials: false[\s\S]*THINGTIME_CI_ROUTER_SECRET: \$\{\{ secrets\.THINGTIME_CI_ROUTER_SECRET \}\}[\s\S]*lopu-credential-vault\.mjs[\s\S]*stat -c '%a'[\s\S]*uses: \.\/\.github\/actions\/lopu-agent[\s\S]*prompt: Return exactly credential-ok[\s\S]*--max-turns 1[\s\S]*Live Claude authentication succeeded/u,
    'credential-vault maintenance must fetch the ordered Thingtime bundle through the stable router secret and prove the waterfall with one live Claude turn',
  );
  const featureStackMerge = resolver.slice(
    resolver.indexOf("\n  feature_stack_merge:"),
    resolver.indexOf("\n  # Clean PRs still need a principal-engineering review."),
  );
  assert.doesNotMatch(
    featureStackMerge,
    /actions\/checkout@[\s\S]{0,160}ref: \$\{\{ matrix\.base_sha \}\}/u,
    "privileged Feature Stack jobs never load candidate code through actions/checkout",
  );
  assert.match(
    featureStackMerge,
    /name: Check out the trusted controller[\s\S]{0,220}ref: github-actions[\s\S]{0,120}path: trusted[\s\S]{0,120}fetch-depth: 0/u,
    "Feature Stack workflow and action code always come from the protected controller",
  );
  assert.match(
    featureStackMerge,
    /git clone --shared --no-checkout "\$GITHUB_WORKSPACE\/trusted" "\$integration"[\s\S]{0,180}remote rename origin snapshot[\s\S]{0,1200}trusted_source=.*refs\/remotes\/origin\/\$head[\s\S]{0,500}update-ref "refs\/remotes\/origin\/\$head" "\$sha"/u,
    "candidate Git objects are admitted as data into a separate shared-object integration repository",
  );
  assert.match(
    featureStackMerge,
    /allowed-bots: "github-actions,thingtime-ci-control"/u,
    "Feature Stack dispatches trust only GitHub Actions and Thingtime's authenticated CI control bot",
  );
  assert.match(
    featureStackMerge,
    /group: lopu-feature-stack-\$\{\{ github\.repository \}\}-\$\{\{ matrix\.target \}\}[\s\S]*queue: max[\s\S]*cancel-in-progress: false/u,
    "admin Feature Stacks serialize per target without waiting behind unrelated Lopu fleet work",
  );
  assert.equal(
    featureStackMerge.match(/working-directory: integration/gu)?.length,
    4,
    "the model, continuations, verifier, and publisher remain inside the isolated integration repository",
  );
  const featureStackProgress = resolver.slice(
    resolver.indexOf("\n  feature_stack_progress:"),
    resolver.indexOf("\n  # Clean PRs still need a principal-engineering review."),
  );
  assert.match(featureStackProgress, /needs: \[feature_stack_plan, model_config\]/u);
  assert.match(featureStackProgress, /!cancelled\(\)[\s\S]*feature_stack_plan\.result == 'success'[\s\S]*model_config\.result == 'success'/u);
  assert.match(featureStackProgress, /continue-on-error: true/u);
  assert.match(featureStackProgress, /actions: read[\s\S]*contents: read/u);
  assert.match(featureStackProgress, /ref: github-actions[\s\S]*persist-credentials: false[\s\S]*sparse-checkout: \.github\/scripts\/feature-stack-progress\.mjs/u);
  assert.match(featureStackProgress, /THINGTIME_CI_ROUTER_SECRET: \$\{\{ secrets\.THINGTIME_CI_ROUTER_SECRET \}\}/u);
  assert.match(
    resolver,
    /feature_stack_plan:[\s\S]*recovery: \$\{\{ steps\.validate\.outputs\.recovery \}\}[\s\S]*pulls\?state=all&head=[\s\S]*\.merged_at != null[\s\S]*expected_source_count[\s\S]*Feature Stack id:[\s\S]*grep -Fxq -- "\$expected_source"[\s\S]*git\/commits\/\$merge_commit_sha[\s\S]*compare\/\$merge_commit_sha\.\.\.\$target[\s\S]*recovery=true/u,
    "completed Feature Stacks are recovered only from exact merged target PRs bound to the immutable source manifest whose published heads and merge commits remain on the target",
  );
  assert.match(
    featureStackMerge,
    /feature_stack_reconcile_receipt:[\s\S]*feature_stack_plan\.outputs\.recovery == 'true'[\s\S]*THINGTIME_CI_ROUTER_SECRET: \$\{\{ secrets\.THINGTIME_CI_ROUTER_SECRET \}\}[\s\S]*feature-stack-progress\.mjs --reconcile/u,
    "already-merged Feature Stacks publish one trusted terminal receipt without rerunning the model",
  );
  assert.match(
    featureStackMerge,
    /feature_stack_merge:[\s\S]*feature_stack_plan\.outputs\.recovery != 'true'[\s\S]*feature_stack_progress:[\s\S]*feature_stack_plan\.outputs\.recovery != 'true'[\s\S]*feature_stack_merge_gate:[\s\S]*feature_stack_plan\.outputs\.recovery != 'true'/u,
    "the recovery lane is mutually exclusive with merge, streaming, and gate workers",
  );
  assert.match(
    featureStackProgress,
    /pr_number=""[\s\S]*pulls\?state=all&head=[\s\S]*pulls\/\$pr_number[\s\S]*\.head\.ref[\s\S]*\.base\.ref/u,
    "Feature Stack completion pins the published PR identity and revalidates its branches after repair pushes",
  );
  assert.doesNotMatch(
    featureStackProgress,
    /select\(\.head\.sha == \$head_sha\)/u,
    "Feature Stack completion does not become permanently stale when the protected PR head advances",
  );
  const allBranchHandoff = resolver.slice(
    resolver.indexOf("\n  handoff_all_branch_event:"),
    resolver.indexOf("\n  maintain_all_branch:"),
  );
  const allBranchMaintenance = resolver.slice(
    resolver.indexOf("\n  maintain_all_branch:"),
    resolver.indexOf("\n  maintain_develop_promotion:"),
  );
  assert.match(allBranchHandoff, /github\.event_name == 'push'/u);
  assert.match(allBranchHandoff, /github\.event_name == 'pull_request_target'/u);
  assert.match(allBranchHandoff, /github\.event\.schedule == '53 \* \* \* \*'/u);
  assert.match(
    allBranchHandoff,
    /branch:"lopu-internal-all-branch"[\s\S]*maintenance_operation:"manage-prs"[\s\S]*actions\/workflows\/resolve-pr-conflicts\.yml\/dispatches/u,
    "every automatic union signal returns through one coalescing Lopu maintenance namespace",
  );
  assert.match(
    allBranchMaintenance,
    /inputs\.maintenance_operation == 'build-all'[\s\S]*inputs\.branch == 'lopu-internal-all-branch'[\s\S]*uses: \.\/\.github\/workflows\/all-branch\.yml/u,
    "manual and trusted central events call the internal all-branch implementation",
  );
  assert.doesNotMatch(
    allBranchMaintenance,
    /github\.event_name == '(?:pull_request_target|schedule)'/u,
    "PR and schedule listeners never enqueue one durable all-branch worker apiece",
  );
  assert.match(
    resolver,
    /maintain_codeql_backfill:[\s\S]*github\.event_name == 'schedule'[\s\S]*inputs\.maintenance_operation == 'backfill-codeql'[\s\S]*ref: github-actions[\s\S]*MAX_DISPATCHES: \$\{\{ github\.event_name == 'workflow_dispatch' && '12' \|\| '2' \}\}[\s\S]*codeql-open-pr-backfill\.mjs/u,
    "one bounded CodeQL backfill lane is scheduled and manually recoverable through Lopu",
  );
  assert.match(
    resolver,
    /maintain_codeql_backfill:[\s\S]*group: lopu-codeql-open-pr-backfill-\$\{\{ github\.repository \}\}[\s\S]*cancel-in-progress: false/u,
    "CodeQL inventory passes serialize without terminating active work",
  );
  assert.match(
    resolver,
    /Every entry must contain exactly those three keys[\s\S]{0,260}40 through 280 characters \(GitHub's CodeQL API limit\)[\s\S]{0,220}`Lopu evidence: `/u,
    "the model prompt states the exact trusted CodeQL disposition schema",
  );
  assert.match(
    resolver,
    /::warning::Skipping malformed CodeQL disposition proposals for PR #\$number; every referenced alert remains open for a later review\.[\s\S]{0,80}continue/u,
    "one malformed model disposition stays fail-closed without failing unrelated Lopu review work",
  );
  assert.doesNotMatch(
    resolver,
    /::error::Lopu proposed an invalid CodeQL disposition schema/u,
    "a malformed optional disposition never makes the repository-wide review job red",
  );
  assert.doesNotMatch(
    resolver,
    /::error::CodeQL alert #\$alert_number was proposed more than once/u,
    "one repository-level CodeQL alert appearing in several PR snapshots does not fail the review batch",
  );
  assert.match(
    resolver,
    /Coalescing CodeQL alert #\$alert_number across PR analysis snapshots with the same '\$proposed_reason' disposition/u,
    "compatible CodeQL dispositions are coalesced to one repository-level write",
  );
  assert.match(
    resolver,
    /Leaving CodeQL alert #\$alert_number open because this Lopu session proposed conflicting disposition reasons/u,
    "conflicting CodeQL dispositions fail closed per alert without failing unrelated reviews",
  );
  assert.match(
    resolver,
    /code-scanning\/alerts\/\$alert_number\/instances\?pr=\$pr_number&per_page=100/u,
    "the isolated writer revalidates the exact reviewed PR alert instance",
  );
  assert.match(
    resolver,
    /live_base_ref=.*\.base\.ref[\s\S]*?git\/ref\/heads\/\$live_base_ref_encoded/u,
    "the isolated writer binds dispositions to the live target branch tip instead of the PR's historical base snapshot",
  );
  const publicConcurrency = resolver.slice(
    resolver.indexOf("\nconcurrency:\n"),
    resolver.indexOf("\npermissions:\n"),
  );
  assert.match(
    publicConcurrency,
    /^  cancel-in-progress: false$/m,
    "the public Lopu queue never cancels active work",
  );
  assert.doesNotMatch(
    publicConcurrency,
    /^\s*queue: max$/m,
    "the public Lopu queue coalesces duplicate pending events by semantic PR or branch key",
  );
  assert.match(
    resolver,
    /\['openai','claude','claude-cli','failed','none','unavailable'\]\.includes\(value\.graphify_semantic\)/u,
    "interrupted-promotion recovery accepts Codex-backed Graphify attestations",
  );
  assert.equal(
    resolver.match(/^\s+openai\|claude\|claude-cli\)/gmu)?.length,
    3,
    "PR merge commits and status comments report OpenAI semantic Graphify runs accurately",
  );
  assert.match(
    resolver,
    /name: Check out PR head[\s\S]*fetch-depth: 0[\s\S]*filter: blob:none[\s\S]*persist-credentials: false/u,
    "resolver checkout keeps exact history while lazily fetching historical blobs",
  );
  assert.match(
    resolver,
    /name: Merge base into head[\s\S]*promisor_fetch_failed\(\)[\s\S]*could not fetch \[0-9a-f\]\{40\} from promisor remote[\s\S]*--refetch --no-filter origin[\s\S]*refs\/heads\/\$HEAD_REF:refs\/remotes\/origin\/\$HEAD_REF[\s\S]*refs\/heads\/\$BASE_REF:refs\/remotes\/origin\/\$BASE_REF[\s\S]*run_snapshot_merge \|\| clean=false[\s\S]*complete-history retry still could not materialize/u,
    "resolver retries a failed lazy promisor fetch once from complete exact branch histories",
  );
  assert.match(
    resolver,
    /name: Verify resolution and commit[\s\S]*if \[ "\$GRAPHIFY_RESET" = "true" \]; then[\s\S]*git rm -rfq --ignore-unmatch -- graphify-out\/[\s\S]*git checkout "\$merge_head" -- graphify-out\/[\s\S]*done < "\$RUNNER_TEMP\/conflicted-derived\.txt"[\s\S]*base_sub="\$\(git rev-parse --verify --quiet "\$merge_head:graphify-out" \|\| echo missing\)"/u,
    "resolver reasserts the exact immutable base Graphify subtree after model work and verifies the same snapshot",
  );
  for (const input of [
    "pr_batch_b64",
    "maintenance_operation",
    "promotion_dry_run",
    "promotion_lookback",
    "promotion_source_branch",
    "promotion_target_branch",
    "promotion_path_prefix",
    "rebase_cascade",
    "ref_race_retry",
    "ref_race_handoff",
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
  assert.match(
    resolver,
    /steps\.push\.outputs\.remote_state == 'retry'[\s\S]*ref_race_retry:\$retry/u,
    "moving refs are requeued with a bounded retry counter",
  );
  assert.equal(
    resolver.match(/steps\.push\.outputs\.remote_state == 'published'/gu)?.length,
    3,
    "only a live-ref-proven publication may post success, merge the standing sync PR, or cascade a stack",
  );

  assertUserControlledMergePause(resolver, rebase);
  assertAdminModelRouting(resolver, rebase, readWorkflow("all-branch.yml"));
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
// the branch; `graphify-out/` is a required portable repository map and
// `.gitattributes` preserves its generated graph merge contract. `PRs/` holds
// the required detailed notes for large control-plane changes. The AI
// instruction trio stays because agents work here too
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
  "PRs",
  "vercel.json",
  "graphify-out",
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
