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

const allBranchCaller = readFileSync(
  resolve(workflowsRoot, 'all-branch.yml'),
  'utf8'
);
const allBranchPermissionsStart = allBranchCaller.indexOf('\npermissions:\n');
const allBranchJobsStart = allBranchCaller.indexOf('\njobs:\n');
assert.ok(
  allBranchPermissionsStart >= 0 && allBranchJobsStart > allBranchPermissionsStart,
  'all-branch.yml must retain a top-level permissions block'
);
const allBranchPermissions = allBranchCaller.slice(
  allBranchPermissionsStart,
  allBranchJobsStart
);
assert.match(
  allBranchPermissions,
  /^  actions: write$/m,
  'all-branch.yml must let the protected push handoff dispatch its supported-event worker'
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
