import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(remixRoot, '..');
const workflowsRoot = resolve(repositoryRoot, '.github', 'workflows');

const callers = [
  'all-branch.yml',
  'develop-pr-preview.yml',
  'electron-release.yml',
  'web-ci.yml',
  'promote-develop-to-main.yml',
  'promote-features-to-main.yml',
  'rebase-pr-stacks.yml',
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

const resolver = readFileSync(
  resolve(workflowsRoot, 'resolve-pr-conflicts.yml'),
  'utf8'
);
assert.match(resolver, /^name: Lopu PR resolver$/m, 'the canonical resolver must use Lopu as its user-facing identity');
assert.doesNotMatch(
  resolver,
  /^\s{2}push:/m,
  'the write-capable resolver must not execute workflow content supplied by a pushed branch'
);
assert.match(
  resolver,
  /^\s{2}pull_request:/m,
  "the detector must run from GitHub's unprivileged pull_request event"
);
assert.doesNotMatch(
  resolver,
  /^\s{2}pull_request_target:/m,
  'the resolver must not combine a privileged pull_request_target trigger with a PR-head checkout'
);
assert.doesNotMatch(
  resolver,
  /resolve-pr-conflicts\.yml@github-actions/,
  'resolve-pr-conflicts.yml must be the canonical workflow, not another thin caller'
);
assert.match(
  resolver,
  /pull_request:\n[\s\S]*?Unprivileged detector only/,
  'the pull_request entry point must be documented as unprivileged and detector-only'
);
assert.match(
  resolver,
  /inputs\.internal_handoff == true\n\s*&& github\.actor == 'github-actions\[bot\]'/,
  'only a bot-authored internal workflow_dispatch may enter the resolver job'
);
assert.match(resolver, /persist-credentials: false/, 'the AI workspace checkout must not retain a GitHub credential');
assert.match(resolver, /git diff --name-only --diff-filter=U/, 'the resolver must derive the AI edit scope from Git conflict paths');
assert.match(
  resolver,
  /git diff --quiet \|\| \{[\s\S]*?unstaged edits/,
  'the resolver must reject unscoped or unstaged AI edits'
);
assert.match(
  resolver,
  /--force-with-lease=refs\/heads\/\$HEAD_REF:\$HEAD_SHA/,
  'publication must retain the exact head lease captured before Lopu works'
);
assert.match(
  resolver,
  /anthropics\/claude-code-action@1623c36729ac1cd5895198cded705a287de7db79/,
  'the current Lopu backend action must stay pinned to its reviewed immutable revision'
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

console.log(`workflow caller contract: ${callers.length} thin listeners plus one guarded canonical Lopu resolver`);
