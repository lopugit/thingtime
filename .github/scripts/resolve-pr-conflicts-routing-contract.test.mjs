#!/usr/bin/env node
// Fixtures for the YAML step window the conflict-resolver routing contract
// scopes its credential-probe exemption to.
//
// The exemption that lets the live vault probe carry no static credential slot
// is decided by whether the probe's `id:` is inside this window. When the
// window is wrong the probe silently loses the exemption and the suite reports
// the generic "every Lopu call receives the secondary API-key slot" against it
// -- a message that, applied literally, hands the vault probe the static slot
// the exemption exists to keep off it, and turns the suite green on exactly
// the masking regression it is there to catch. So the cost of a mis-bounded
// window is not a missing check, it is a misdirecting one. Pin the bounds.
//
// Local validation:
//   node --test .github/scripts/resolve-pr-conflicts-routing-contract.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { yamlStepAt } from "./resolve-pr-conflicts-routing-contract.mjs";

const USES = "uses: ./.github/actions/lopu-agent";

// Index of the `uses:` line the contract's scan stops on, so each fixture is
// entered the same way the real scan enters it.
const stepAroundUses = (yaml) => {
  const lines = yaml.split("\n");
  const index = lines.findIndex((line) => line.includes(USES));
  assert.notEqual(index, -1, "fixture must contain the lopu-agent call");
  return yamlStepAt(lines, index);
};

test("keeps the whole step, from its `- ` marker to its last key", () => {
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
        ${USES}
        with:
          backend: claude
          thingtime-ci-router-secret: \${{ secrets.THINGTIME_CI_ROUTER_SECRET }}

      - name: Report the live credential result
        run: echo done
`);
  assert.match(step, /- name: Verify the credential waterfall/u);
  assert.match(step, /id: live_probe/u);
  assert.match(step, /thingtime-ci-router-secret:/u);
  assert.doesNotMatch(step, /Report the live credential result/u);
});

test("a blank line inside the step does not close the window", () => {
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe

        ${USES}
        with:
          backend: claude
`);
  assert.match(step, /id: live_probe/u);
});

test("a `#` comment inside the step does not close the window", () => {
  // Legal at any column: YAML does not indent-scope comments.
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
  # keep this probe free of every static credential slot
        ${USES}
        with:
          backend: claude
`);
  assert.match(step, /id: live_probe/u);
});

test("a `#` comment below the call does not hide a later key from the window", () => {
  // The negative slot assertion answers over this window, so a comment that
  // closed it early would read as "the probe carries no static slot" for a
  // probe that carries one below the comment.
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
        ${USES}
        with:
          backend: claude
# stray note at column zero
          anthropic-api-key-fallback: \${{ secrets.ANTHROPIC_API_KEY_FALLBACK }}
`);
  assert.match(step, /anthropic-api-key-fallback:/u);
});

test("a step written `- uses:` first stops at its sibling, not at the job", () => {
  // Here the matched line is itself the `- ` marker, so every sibling step
  // starts at the same column: a strictly-less-indented bound would run this
  // window through them to the end of the job.
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - ${USES}
        id: live_probe
        with:
          backend: claude

      - name: A later secret-bearing worker
        with:
          anthropic-api-key-fallback: \${{ secrets.ANTHROPIC_API_KEY_FALLBACK }}
`);
  assert.match(step, /id: live_probe/u);
  assert.doesNotMatch(step, /A later secret-bearing worker/u);
  assert.doesNotMatch(step, /anthropic-api-key-fallback:/u);
});

test("the window never reaches back into the preceding step", () => {
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: An earlier secret-bearing worker
        id: lopu_review
        with:
          anthropic-api-key-fallback: \${{ secrets.ANTHROPIC_API_KEY_FALLBACK }}
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
        ${USES}
        with:
          backend: claude
`);
  assert.doesNotMatch(step, /An earlier secret-bearing worker/u);
  assert.doesNotMatch(step, /id: lopu_review/u);
  assert.doesNotMatch(step, /anthropic-api-key-fallback:/u);
});

test("the window stops at the next job when the call ends its own job", () => {
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
        ${USES}
        with:
          backend: claude

  route:
    steps:
      - name: Something else
        with:
          anthropic-api-key-fallback: \${{ secrets.ANTHROPIC_API_KEY_FALLBACK }}
`);
  assert.match(step, /id: live_probe/u);
  assert.doesNotMatch(step, /anthropic-api-key-fallback:/u);
});

test("a sequence nested inside the step is not read as its marker", () => {
  // Ordinary step maintenance: a sequence-valued key above the `uses:` line.
  // Its items are `- ` lines too, and taking the nearest one as the marker
  // collapses the window onto that single item -- dropping the `id:` and
  // reporting the generic slot message against the vault probe.
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
        env:
          NEEDLES:
            - alpha
            - beta
        ${USES}
        with:
          backend: claude
`);
  assert.match(step, /- name: Verify the credential waterfall/u);
  assert.match(step, /id: live_probe/u);
  assert.match(step, /backend: claude/u);
});

test("a `- ` bullet inside a prompt block scalar is not read as a marker", () => {
  // Every one of these calls carries a prose `prompt:`, and Lopu's prompts are
  // full of markdown bullets. Block-scalar text is not YAML structure at all,
  // so a bullet there is a marker only to a scan that reads the raw line --
  // and `with:` may legally precede `uses:`, which puts one above the call.
  const step = stepAroundUses(`jobs:
  verify_credential_vault:
    steps:
      - name: Verify the credential waterfall with one live Claude turn
        id: live_probe
        with:
          backend: claude
          prompt: |
            Return exactly credential-ok:
            - do not inspect the repository
            - do not use tools
        ${USES}
`);
  assert.match(step, /- name: Verify the credential waterfall/u);
  assert.match(step, /id: live_probe/u);
  assert.match(step, /backend: claude/u);
});

test("composite-action step depth is read from the step, not assumed", () => {
  // `rebase-conflict-round/action.yml` nests its steps two columns shallower
  // than a workflow job's.
  const step = stepAroundUses(`runs:
  using: "composite"
  steps:
    - name: Resolve one conflict round as Lopu
      id: round
      ${USES}
      with:
        anthropic-api-key-fallback: \${{ secrets.ANTHROPIC_API_KEY_FALLBACK }}

    - name: Report
      run: echo done
`);
  assert.match(step, /- name: Resolve one conflict round as Lopu/u);
  assert.match(step, /anthropic-api-key-fallback:/u);
  assert.doesNotMatch(step, /- name: Report/u);
});
