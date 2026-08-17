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
