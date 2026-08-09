#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const githubRoot = resolve(here, "..");
const workflows = resolve(githubRoot, "workflows");

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

  console.log("workflow control-plane contract: self-test OK");
}

if (process.argv.includes("--self-test")) {
  assertControlPlaneContract();
} else {
  console.error("Pass --self-test to run the workflow control-plane contract.");
  process.exitCode = 2;
}
