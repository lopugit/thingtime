import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const remixRoot = path.resolve(import.meta.dirname, '..');
const configPath = path.join(remixRoot, 'nitro.config.ts');
const config = readFileSync(configPath, 'utf8');

// Keep the supported Nitro scan roots explicit. A newly-authored directive
// outside them must fail this contract rather than being silently skipped.
const rootsMatch = config.match(/workflow:\s*\{\s*dirs:\s*\[([^\]]*)\]/s);
assert.ok(rootsMatch, 'nitro.config.ts must configure workflow.dirs explicitly');
const scanRoots = [...rootsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
assert.ok(scanRoots.length > 0, 'workflow.dirs must include at least one authored source root');

const authoredFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'app', 'server', 'workflows'], {
  cwd: remixRoot
}).toString().split('\0').filter(Boolean).filter((file) => /\.(?:[cm]?[jt]sx?)$/i.test(file));
const directive = /(?:^|[;{}\n])\s*['"]use (?:workflow|step)['"]\s*;?/m;
const directiveFiles = authoredFiles.filter((file) => directive.test(readFileSync(path.join(remixRoot, file), 'utf8')));

function isInsideRoot(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

test('Nitro workflow scan roots cover every authored directive without scanning generated draft bundles', () => {
  assert.ok(directiveFiles.length > 0, 'expected authored use workflow/use step entrypoints');
  const outside = directiveFiles.filter((file) => !scanRoots.some((root) => isInsideRoot(file, root)));
  assert.deepEqual(outside, [], `authored workflow directives outside workflow.dirs: ${outside.join(', ')}`);

  const generatedDraftRunner = 'dist/draft-preview/runner.js';
  assert.ok(!scanRoots.some((root) => isInsideRoot(generatedDraftRunner, root)),
    `${generatedDraftRunner} must not be included in workflow.dirs`);
});
