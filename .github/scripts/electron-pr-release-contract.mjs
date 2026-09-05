#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  resolve(here, "..", "workflows", "electron-pr-release.yml"),
  "utf8",
);

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function assertPrReleaseContract() {
  assert.match(workflow, /^  workflow_call:/mu, "release worker is reusable");
  assert.match(workflow, /^  workflow_dispatch:/mu, "release worker permits explicit owner dispatch");
  assert.doesNotMatch(
    workflow,
    /^  pull_request(?:_target)?:/mu,
    "the protected worker never trusts PR-branch workflow code as its entrypoint",
  );
  assert.match(workflow, /triggering_event:[\s\S]*required: true/u, "caller provenance is required");
  assert.match(workflow, /pr_number:[\s\S]*type: string/u, "release identity accepts a numeric PR input");
  assert.match(
    workflow,
    /github\.repository == 'lopugit\/thingtime'/u,
    "release worker is scoped to the canonical repository",
  );
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch'[\s\S]*github\.ref_name == 'github-actions'/u,
    "direct manual dispatch runs only from the protected control-plane ref",
  );
  assert.match(
    workflow,
    /github\.event_name == 'pull_request_target'[\s\S]*github\.ref_name == 'develop'[\s\S]*github\.ref_name == 'main'/u,
    "reusable release calls are accepted only from the protected product listeners",
  );
  assert.match(
    workflow,
    /inputs\.triggering_event == 'pull_request_target'/u,
    "automatic release provenance must come from the protected PR listener",
  );
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u,
    "fork sources are rejected before the release job starts",
  );
  assert.match(workflow, /author_association == 'OWNER'/u, "automatic releases require the repository owner");
  assert.match(workflow, /desktop-release/u, "automatic releases require the maintainer label");
  assert.match(
    workflow,
    /Unsupported release caller event/u,
    "source validation rejects event types outside the two trusted entrypoints",
  );
  assert.match(
    workflow,
    /Release worker must run directly on github-actions or through a develop\/main listener/u,
    "source validation repeats the protected-ref gate before checkout",
  );
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}"/u, "PR source is re-resolved through GitHub");
  assert.match(workflow, /test "\$\{head_repository\}" = "\$\{GITHUB_REPOSITORY\}"/u, "PR head repository is revalidated");
  assert.match(workflow, /ref: \$\{\{ steps\.source\.outputs\.head_sha \}\}/u, "checkout pins the validated immutable PR SHA");
  assert.match(workflow, /persist-credentials: false/u, "PR checkout never persists a GitHub write token");

  const jobHeader = workflow.slice(
    workflow.indexOf("  release:\n"),
    workflow.indexOf("    steps:\n"),
  );
  assert.doesNotMatch(jobHeader, /GH_TOKEN|GITHUB_TOKEN/u, "untrusted build steps do not inherit a job-wide GitHub token");
  assert.ok(count(workflow, "GH_TOKEN: ${{ github.token }}") >= 3, "GitHub token is scoped to API and final publish steps");

  const unsignedTests = workflow.indexOf("      - name: Test unsigned source before accessing signing credentials\n");
  const selectDistribution = workflow.indexOf("      - name: Select release distribution\n");
  const importCredentials = workflow.indexOf("      - name: Import Developer ID and notarization credentials\n");
  assert.ok(unsignedTests >= 0 && selectDistribution > unsignedTests, "source checks precede distribution selection");
  assert.ok(importCredentials > selectDistribution, "distribution selection precedes signing credential import");
  assert.match(workflow, /0\) distribution="unsigned"/u, "an entirely absent credential set selects the temporary unsigned lane");
  assert.match(workflow, /6\) distribution="signed"/u, "a complete credential set selects the signed lane");
  assert.match(workflow, /Incomplete signing configuration/u, "partial credential sets fail closed rather than publishing an ambiguous artifact");
  assert.match(workflow, /release_version="\$\{release_version\}\.unsigned"/u, "unsigned artifacts carry an explicit SemVer marker");
  assert.match(workflow, /corepack pnpm --dir electron run dist:unsigned/u, "the unsigned lane uses the dedicated unsigned builder");
  assert.match(workflow, /build-unsigned-release\.sh/u, "the unsigned lane builds the companion Recovery artifact without notarization");
  assert.match(workflow, /Thingtime-Electron-App-UNSIGNED-Release/u, "unsigned desktop assets have a non-ambiguous public name");
  assert.match(workflow, /Thingtime-Recovery-App-UNSIGNED-Release/u, "unsigned Recovery assets have a non-ambiguous public name");
  assert.match(workflow, /UNSIGNED Thingtime Desktop release/u, "unsigned release notes are unmistakable");
  assert.match(workflow, /Open Anyway/u, "unsigned release notes direct users to macOS's explicit approval path");
  assert.match(workflow, /MAC_CSC_LINK: \$\{\{ secrets\.MAC_CSC_LINK \}\}/u, "Developer ID certificate remains a release-only secret");
  assert.match(workflow, /APPLE_API_KEY_BASE64: \$\{\{ secrets\.APPLE_API_KEY_BASE64 \}\}/u, "notarization key remains a release-only secret");
  assert.match(workflow, /Thingtime-Recovery-App-Release-\*/u, "release publishes the companion Recovery asset");
  assert.match(workflow, /--prerelease/u, "PR artifacts are never published as stable releases");
}

assertPrReleaseContract();
console.log("electron-pr-release-contract-ok");
