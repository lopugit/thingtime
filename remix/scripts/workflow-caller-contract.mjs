import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(remixRoot, '..');
const workflowsRoot = resolve(repositoryRoot, '.github', 'workflows');

const callers = [
  'all-branch.yml',
  'codeql-analysis.yml',
  'develop-pr-preview.yml',
  'electron-release.yml',
  'electron-pr-release.yml',
  'web-ci.yml',
  'promote-develop-to-main.yml',
  'promote-features-to-main.yml',
  'rebase-pr-stacks.yml',
  'resolve-pr-conflicts.yml',
  'sync-main-into-develop.yml'
];

for (const filename of callers) {
  const source = readFileSync(resolve(workflowsRoot, filename), 'utf8');
  const implementation = `uses: lopugit/thingtime/.github/workflows/${filename}@github-actions`;
  assert.match(source, new RegExp(`^\\s{4}${implementation.replaceAll('.', '\\.')}$`, 'm'), `${filename} must call the protected implementation`);
  assert.doesNotMatch(source, /^\s+runs-on:/m, `${filename} must not choose a runner`);
  assert.doesNotMatch(source, /^\s+steps:/m, `${filename} must not contain executable steps`);
  assert.doesNotMatch(source, /^\s+run:/m, `${filename} must not contain shell behavior`);
  assert.doesNotMatch(source, /\.github\/(?:actions|scripts)\//, `${filename} must not reference product-branch behavior files`);
  assert.equal((source.match(/^\s+uses:/gm) ?? []).length, 1, `${filename} must contain exactly one reusable-workflow call`);
}

const codeqlCaller = readFileSync(
  resolve(workflowsRoot, 'codeql-analysis.yml'),
  'utf8'
);
const codeqlTriggersEnd = codeqlCaller.indexOf('\npermissions:\n');
assert.ok(codeqlTriggersEnd > 0, 'codeql-analysis.yml must retain its trigger block');
const codeqlTriggers = codeqlCaller.slice(0, codeqlTriggersEnd);
assert.match(
  codeqlTriggers,
  /^  pull_request:$/m,
  'codeql-analysis.yml must scan PRs targeting every branch without a base filter'
);
assert.match(
  codeqlTriggers,
  /^  push:\n    branches: \["\*\*"\]$/m,
  'codeql-analysis.yml must scan direct pushes to every branch'
);
assert.match(codeqlTriggers, /^  schedule:$/m, 'codeql-analysis.yml must retain its scheduled backstop');
assert.match(codeqlTriggers, /^  workflow_dispatch:$/m, 'codeql-analysis.yml must support manual recovery');
const codeqlPermissions = codeqlCaller.slice(
  codeqlCaller.indexOf('\npermissions:\n'),
  codeqlCaller.indexOf('\njobs:\n')
);
assert.match(codeqlPermissions, /^  security-events: write$/m, 'CodeQL caller must permit SARIF upload');
assert.match(codeqlPermissions, /^  pull-requests: read$/m, 'CodeQL caller must permit duplicate-run ownership checks');

const developPreviewCaller = readFileSync(
  resolve(workflowsRoot, 'develop-pr-preview.yml'),
  'utf8'
);
assert.match(
  developPreviewCaller,
  /^      pr_number: \$\{\{ fromJSON\(inputs\.pr_number \|\| '0'\) \}\}$/m,
  'develop-pr-preview.yml must convert the manual dispatch string to the reusable workflow number type'
);

const promotionCaller = readFileSync(
  resolve(workflowsRoot, 'promote-features-to-main.yml'),
  'utf8'
);
const promotionPermissionsStart = promotionCaller.indexOf('\npermissions:\n');
const promotionJobsStart = promotionCaller.indexOf('\njobs:\n');
assert.ok(
  promotionPermissionsStart >= 0 && promotionJobsStart > promotionPermissionsStart,
  'promote-features-to-main.yml must retain a top-level permissions block'
);
const promotionPermissions = promotionCaller.slice(
  promotionPermissionsStart,
  promotionJobsStart
);
assert.match(
  promotionPermissions,
  /^  actions: write$/m,
  'promote-features-to-main.yml must grant the protected promoter permission to dispatch its resolver'
);

const electronPrReleaseCaller = readFileSync(
  resolve(workflowsRoot, 'electron-pr-release.yml'),
  'utf8'
);
assert.match(
  electronPrReleaseCaller,
  /^  pull_request_target:\n    types: \[labeled, reopened, synchronize\]$/m,
  'electron-pr-release.yml must receive trusted PR lifecycle events from the base branch'
);
assert.match(
  electronPrReleaseCaller,
  /^      pr_number: \$\{\{ inputs\.pr_number \|\| '' \}\}$/m,
  'electron-pr-release.yml must forward only the optional manual PR number'
);
assert.match(
  electronPrReleaseCaller,
  /^      triggering_event: \$\{\{ github\.event_name \}\}$/m,
  'electron-pr-release.yml must forward the trusted caller event provenance'
);
const electronPrReleasePermissionsStart = electronPrReleaseCaller.indexOf('\npermissions:\n');
const electronPrReleaseJobsStart = electronPrReleaseCaller.indexOf('\njobs:\n');
assert.ok(
  electronPrReleasePermissionsStart >= 0 && electronPrReleaseJobsStart > electronPrReleasePermissionsStart,
  'electron-pr-release.yml must retain its top-level permissions block'
);
const electronPrReleasePermissions = electronPrReleaseCaller.slice(
  electronPrReleasePermissionsStart,
  electronPrReleaseJobsStart
);
assert.match(
  electronPrReleasePermissions,
  /^  contents: write$/m,
  'electron-pr-release.yml must grant the protected publisher release access'
);
assert.match(
  electronPrReleasePermissions,
  /^  pull-requests: read$/m,
  'electron-pr-release.yml must let the protected publisher revalidate live PR state'
);

const electronPrReleaseCaller = readFileSync(
  resolve(workflowsRoot, 'electron-pr-release.yml'),
  'utf8'
);
assert.match(
  electronPrReleaseCaller,
  /^  pull_request_target:\n    types: \[labeled, reopened, synchronize\]$/m,
  'electron-pr-release.yml must receive trusted PR lifecycle events from the base branch'
);
assert.match(
  electronPrReleaseCaller,
  /^      pr_number: \$\{\{ inputs\.pr_number \|\| '' \}\}$/m,
  'electron-pr-release.yml must forward only the optional manual PR number'
);
assert.match(
  electronPrReleaseCaller,
  /^      triggering_event: \$\{\{ github\.event_name \}\}$/m,
  'electron-pr-release.yml must forward the trusted caller event provenance'
);
const electronPrReleasePermissionsStart = electronPrReleaseCaller.indexOf('\npermissions:\n');
const electronPrReleaseJobsStart = electronPrReleaseCaller.indexOf('\njobs:\n');
assert.ok(
  electronPrReleasePermissionsStart >= 0 && electronPrReleaseJobsStart > electronPrReleasePermissionsStart,
  'electron-pr-release.yml must retain its top-level permissions block'
);
const electronPrReleasePermissions = electronPrReleaseCaller.slice(
  electronPrReleasePermissionsStart,
  electronPrReleaseJobsStart
);
assert.match(
  electronPrReleasePermissions,
  /^  contents: write$/m,
  'electron-pr-release.yml must grant the protected publisher release access'
);
assert.match(
  electronPrReleasePermissions,
  /^  pull-requests: read$/m,
  'electron-pr-release.yml must let the protected publisher revalidate live PR state'
);

const filesUnder = (root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
};

assert.deepEqual(filesUnder(resolve(repositoryRoot, '.github', 'actions')), [], 'product branches must not retain local Actions behavior');
assert.deepEqual(
  filesUnder(resolve(repositoryRoot, '.github', 'scripts')).sort(),
  [],
  'product branches must not retain local Actions scripts; the develop-preview controller lives on github-actions'
);

console.log(`workflow caller contract: ${callers.length} thin listeners pinned to github-actions`);
