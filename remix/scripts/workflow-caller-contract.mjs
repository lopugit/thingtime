import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(remixRoot, '..');
const workflowsRoot = resolve(repositoryRoot, '.github', 'workflows');

const callers = [
  'develop-pr-preview.yml',
  'electron-release.yml',
  'electron-pr-release.yml',
  'web-ci.yml',
  'resolve-pr-conflicts.yml'
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

for (const retired of [
  'all-branch.yml',
  'promote-develop-to-main.yml',
  'promote-features-to-main.yml',
  'rebase-pr-stacks.yml',
  'sync-main-into-develop.yml'
]) {
  assert.equal(
    existsSync(resolve(workflowsRoot, retired)),
    false,
    `${retired} must stay retired; Lopu PR manager owns its former public triggers`
  );
}

const codeqlCaller = readFileSync(
  resolve(workflowsRoot, 'codeql-analysis.yml'),
  'utf8'
);
const codeqlTriggersEnd = codeqlCaller.indexOf('\npermissions:\n');
assert.ok(codeqlTriggersEnd > 0, 'codeql-analysis.yml must retain its trigger block');
const codeqlTriggers = codeqlCaller.slice(0, codeqlTriggersEnd);
assert.doesNotMatch(codeqlCaller, /^\s+runs-on:|^\s+steps:|^\s+run:/m, 'CodeQL listener must remain executable-code-free');
assert.doesNotMatch(codeqlCaller, /\.github\/(?:actions|scripts)\//, 'CodeQL listener must not reference product-branch behavior files');
assert.equal((codeqlCaller.match(/^\s+uses:/gm) ?? []).length, 2, 'CodeQL listener must contain exactly the analyzer and target-handoff calls');
assert.match(
  codeqlCaller,
  /^\s{4}uses: lopugit\/thingtime\/\.github\/workflows\/codeql-pr-handoff\.yml@github-actions$/m,
  'pull_request_target must call the protected metadata-only handoff'
);
assert.match(
  codeqlCaller,
  /^\s{4}uses: lopugit\/thingtime\/\.github\/workflows\/codeql-analysis\.yml@github-actions$/m,
  'unprivileged analysis events must call the protected analyzer'
);
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
assert.match(
  codeqlTriggers,
  /^  pull_request_target:\n(?:    #.*\n)*    types: \[opened, synchronize, reopened, ready_for_review, edited\]$/m,
  'the default branch must hand off every PR-head lifecycle update'
);
assert.match(codeqlTriggers, /^  schedule:$/m, 'codeql-analysis.yml must retain its scheduled backstop');
assert.match(codeqlTriggers, /^  workflow_dispatch:$/m, 'codeql-analysis.yml must support manual recovery');
const codeqlPermissions = codeqlCaller.slice(
  codeqlCaller.indexOf('\npermissions:\n'),
  codeqlCaller.indexOf('\njobs:\n')
);
assert.match(codeqlPermissions, /^  security-events: write$/m, 'CodeQL caller must permit SARIF upload');
assert.match(codeqlPermissions, /^  pull-requests: read$/m, 'CodeQL caller must permit duplicate-run ownership checks');
assert.match(codeqlPermissions, /^  actions: write$/m, 'CodeQL caller must permit only the target handoff to dispatch an unprivileged scan');
assert.match(
  codeqlCaller,
  /^  target-handoff:\n    if: github\.event_name == 'pull_request_target'[\s\S]*?^  control-plane:\n    if: github\.event_name != 'pull_request_target'/m,
  'the target-event token must never reach the analyzer job'
);

const resolverCaller = readFileSync(
  resolve(workflowsRoot, 'resolve-pr-conflicts.yml'),
  'utf8'
);
assert.match(
  resolverCaller,
  /^name: Lopu PR manager$/m,
  'the public repository manager must be visibly named Lopu'
);
assert.match(
  resolverCaller,
  /^  pull_request_target:\n(?:    #.*\n)*    types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft, edited, closed\]$/m,
  'Lopu must receive every PR-head lifecycle update even when the PR branch has an old or missing push listener'
);
assert.match(
  resolverCaller,
  /^  repository_dispatch:\n(?:    #.*\n)*    types: \[resolve-conflicts-cascade, rebase-pr-stack-ai\]$/m,
  'merge cascades and rebase-stack workers must enter through the one public Lopu listener'
);
for (const trigger of ['issue_comment', 'pull_request_review_comment', 'check_run']) {
  assert.match(
    resolverCaller,
    new RegExp(`^  ${trigger}:$`, 'm'),
    `Lopu must receive ${trigger} repository-management signals from the default branch`
  );
}
assert.match(resolverCaller, /^  security-events: write$/m, 'the thin Lopu caller must grant the maximum permission used by its separately fenced CodeQL disposition job');
for (const input of [
  'maintenance_operation',
  'promotion_dry_run',
  'promotion_lookback',
  'promotion_source_branch',
  'promotion_target_branch',
  'promotion_path_prefix'
]) {
  assert.match(
    resolverCaller,
    new RegExp(`^      ${input}: \\\${\\\{ inputs\\.${input}`, 'm'),
    `the public Lopu caller must forward ${input} to the protected controller`
  );
}

const developPreviewCaller = readFileSync(
  resolve(workflowsRoot, 'develop-pr-preview.yml'),
  'utf8'
);
assert.match(
  developPreviewCaller,
  /^      pr_number: \$\{\{ fromJSON\(inputs\.pr_number \|\| '0'\) \}\}$/m,
  'develop-pr-preview.yml must convert the manual dispatch string to the reusable workflow number type'
);

assert.match(
  resolverCaller,
  /^  actions: write$/m,
  'Lopu PR manager must grant its protected maintenance lanes permission to dispatch trusted workers'
);
assert.match(
  resolverCaller,
  /^    - cron: "53 \* \* \* \*"$/m,
  'the one public Lopu manager must retain the hourly wildcard-all backstop'
);
assert.match(
  resolverCaller,
  /options: \[manage-prs, promote-develop, promote-features, sync-main-develop, build-all, backfill-codeql\]/m,
  'manual wildcard-all and CodeQL recovery must remain Lopu maintenance choices'
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
