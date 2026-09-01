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
  'resolve-pr-conflicts.yml',
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
assert.doesNotMatch(codeqlCaller, /^\s+runs-on:|^\s+steps:|^\s+run:/m, 'CodeQL listener must remain executable-code-free');
assert.doesNotMatch(codeqlCaller, /\.github\/(?:actions|scripts)\//, 'CodeQL listener must not reference product-branch behavior files');
assert.equal((codeqlCaller.match(/^\s+uses:/gm) ?? []).length, 2, 'CodeQL listener must have exactly one analysis call and one target-event handoff call');
assert.match(
  codeqlTriggers,
  /^  pull_request:$/m,
  'codeql-analysis.yml must scan PRs targeting every branch without a base filter'
);
assert.match(
  codeqlTriggers,
  /^  pull_request_target:\n    types: \[opened, synchronize, reopened, ready_for_review, edited\]$/m,
  'codeql-analysis.yml must receive every PR target through the trusted default-branch listener'
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
assert.match(codeqlPermissions, /^  actions: write$/m, 'CodeQL caller must permit the metadata-only trusted handoff');
assert.match(
  codeqlCaller,
  /^  pr-handoff:\n    if: github\.event_name == 'pull_request_target'\n    uses: lopugit\/thingtime\/\.github\/workflows\/codeql-pr-handoff\.yml@github-actions$/m,
  'CodeQL target events must call the isolated protected metadata handoff'
);
assert.match(
  codeqlCaller,
  /^  control-plane:\n    if: github\.event_name != 'pull_request_target'\n    uses: lopugit\/thingtime\/\.github\/workflows\/codeql-analysis\.yml@github-actions$/m,
  'read-capped PR events must call only the unprivileged CodeQL analyzer'
);
assert.match(
  codeqlCaller,
  /^      pr_number: \$\{\{ inputs\.pr_number \|\| '' \}\}$/m,
  'CodeQL caller must forward only the optional trusted PR number'
);
assert.match(
  codeqlCaller,
  /^      expected_head_sha: \$\{\{ inputs\.expected_head_sha \|\| '' \}\}$/m,
  'CodeQL caller must bind a central scan to the event head SHA'
);

const resolverCaller = readFileSync(
  resolve(workflowsRoot, 'resolve-pr-conflicts.yml'),
  'utf8'
);
assert.match(resolverCaller, /^name: Lopu PR manager$/m, 'the public repository manager must be visibly named Lopu');
const resolverPermissionsStart = resolverCaller.indexOf('\npermissions:\n');
const resolverJobsStart = resolverCaller.indexOf('\njobs:\n');
assert.ok(
  resolverPermissionsStart >= 0 && resolverJobsStart > resolverPermissionsStart,
  'resolve-pr-conflicts.yml must retain a top-level permissions block'
);
const resolverTriggers = resolverCaller.slice(0, resolverPermissionsStart);
assert.match(resolverTriggers, /^  push:\n    branches: \["\*\*"\]$/m, 'Lopu must receive pushes on every branch');
assert.match(resolverTriggers, /^  issue_comment:\n    types: \[created, edited\]$/m, 'Lopu must receive PR conversations');
assert.match(resolverTriggers, /^  pull_request_review_comment:\n    types: \[created, edited\]$/m, 'Lopu must receive inline review conversations');
assert.match(resolverTriggers, /^  check_run:\n    types: \[completed\]$/m, 'Lopu must receive completed checks for repair review');
assert.match(
  resolverTriggers,
  /^  pull_request_target:\n(?:    .*\n)*?    types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft, edited, closed\]$/m,
  'Lopu must own every PR lifecycle signal that changes the wildcard union'
);
assert.match(
  resolverTriggers,
  /^    - cron: "53 \* \* \* \*"$/m,
  'Lopu must own the hourly wildcard-union backstop'
);
assert.match(
  resolverTriggers,
  /^  workflow_run:\n    workflows:\n(?:      - .*\n)+    types: \[completed\]$/m,
  'Lopu must receive the bounded first-party CI workflow completion list'
);
assert.doesNotMatch(
  resolverTriggers.slice(
    resolverTriggers.indexOf('\n  workflow_run:'),
    resolverTriggers.indexOf('\n  schedule:')
  ),
  /^      - Lopu PR manager$/m,
  'Lopu must not recursively review its own workflow failures'
);
assert.match(
  resolverTriggers,
  /^  repository_dispatch:\n(?:    .*\n)*?    types: \[resolve-conflicts-cascade, rebase-pr-stack-ai\]$/m,
  'Lopu must receive exact stack workers without a second public rebase listener'
);
assert.match(
  resolverTriggers,
  /^    - cron: "43 \*\/6 \* \* \*"$/m,
  'Lopu must own the former feature-promotion maintenance schedule'
);
for (const input of [
  'maintenance_operation',
  'promotion_dry_run',
  'promotion_lookback',
  'promotion_source_branch',
  'promotion_target_branch',
  'promotion_path_prefix',
  'feature_stack_plan_b64',
  'feature_stack_run_id'
]) {
  assert.match(
    resolverCaller,
    new RegExp(`^      ${input}: \\$\\{\\{ inputs\\.${input}`, 'm'),
    `Lopu listener must forward ${input} to the protected manager`
  );
}
assert.match(
  resolverCaller,
  /^      rebase_cascade: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.rebase_cascade \}\}$/m,
  'automatic Lopu events cascade stacks while an explicit CI Control retry may opt out'
);
const resolverPermissions = resolverCaller.slice(
  resolverPermissionsStart,
  resolverJobsStart
);
assert.match(
  resolverPermissions,
  /^  security-events: write$/m,
  'resolve-pr-conflicts.yml must permit the protected controller to inspect and disposition CodeQL alerts'
);

const developPreviewCaller = readFileSync(
  resolve(workflowsRoot, 'develop-pr-preview.yml'),
  'utf8'
);
assert.match(
  developPreviewCaller,
  /^      pr_number: \$\{\{ fromJSON\(inputs\.pr_number \|\| '0'\) \}\}$/m,
  'develop-pr-preview.yml must convert the manual dispatch string to the reusable workflow number type'
);

for (const retiredPublicWorkflow of [
  'all-branch.yml',
  'rebase-pr-stacks.yml',
  'promote-develop-to-main.yml',
  'promote-features-to-main.yml',
  'sync-main-into-develop.yml'
]) {
  assert.equal(
    existsSync(resolve(workflowsRoot, retiredPublicWorkflow)),
    false,
    `${retiredPublicWorkflow} must not remain as a competing product-branch workflow`
  );
}

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

console.log(`workflow caller contract: ${callers.length + 1} thin listeners pinned to github-actions`);
