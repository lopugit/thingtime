import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const build = readFileSync(new URL('./build_and_run.sh', import.meta.url), 'utf8');
const dispatch = build.slice(build.indexOf('# CI compiles and tests'));
const stubs = ['compile_all', 'bundle_all', 'resolve_signing_configuration', 'notarize_distribution_bundle', 'stop_installed_runtime', 'install_app', 'launch_installed_app']
  .map(name => `${name}() { echo ${name}; }`).join('\n');

test('prepare and packaging never stop or install the running app', () => {
  for (const [mode, expected] of [
    ['--prepare', ['compile_all']],
    ['--package-only', ['resolve_signing_configuration', 'bundle_all', 'notarize_distribution_bundle']],
    ['--build-only', ['resolve_signing_configuration', 'compile_all', 'bundle_all', 'notarize_distribution_bundle']],
  ]) {
    const result = spawnSync('bash', ['-c', `${stubs}\n${dispatch}`], {
      encoding: 'utf8', env: { ...process.env, MODE: mode, APP_BUNDLE: '/unused/Commander.app' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n').filter(line => !line.startsWith('Built:')), expected);
  }
});

test('installation stops the old runtime only after successful signing and notarization', () => {
  const success = spawnSync('bash', ['-c', `${stubs}\n${dispatch}`], { encoding: 'utf8', env: { ...process.env, MODE: 'run' } });
  assert.equal(success.status, 0, success.stderr);
  const steps = success.stdout.split('\n');
  assert.ok(steps.indexOf('stop_installed_runtime') > steps.indexOf('notarize_distribution_bundle'));
  const failure = spawnSync('bash', ['-ec', `${stubs}\nnotarize_distribution_bundle() { return 9; }\n${dispatch}`], { encoding: 'utf8', env: { ...process.env, MODE: 'run' } });
  assert.equal(failure.status, 9);
  assert.doesNotMatch(failure.stdout, /stop_installed_runtime|install_app/);
});

test('unknown mode fails before compiling or accessing the Keychain', () => {
  const result = spawnSync('bash', [new URL('./build_and_run.sh', import.meta.url).pathname, '--invalid'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown Commander build mode/);
});

test('published archive preserves and verifies the resource seal after extraction', () => {
  const production = readFileSync(new URL('./build-production-release.sh', import.meta.url), 'utf8');
  assert.match(production, /Commander-App-Release-.*-macos-/);
  assert.match(production, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(production, /ditto -x -k/);
  assert.match(production, /verify-production-bundle.sh" "\$work\/extracted\/Commander.app"/);
  assert.doesNotMatch(production, /codesign.*--sign -|SIGNING_MODE=development/);
});


test('the real architecture verification commands accept a native Mach-O bundle fixture', { skip: process.platform !== 'darwin' }, () => {
  const app = mkdtempSync(path.join(tmpdir(), 'commander-architecture-'));
  try {
    const architecture = spawnSync('/usr/bin/uname', ['-m'], { encoding: 'utf8' }).stdout.trim();
    const nativeFixture = path.join(app, 'native-fixture');
    const compile = spawnSync('/usr/bin/clang', ['-arch', architecture, '-x', 'c', '-', '-o', nativeFixture], {
      encoding: 'utf8', input: 'int main(void) { return 0; }\n',
    });
    assert.equal(compile.status, 0, compile.stderr);
    for (const name of ['Contents/MacOS/Commander', 'Contents/Resources/node/bin/node']) {
      mkdirSync(path.dirname(path.join(app, name)), { recursive: true });
      copyFileSync(nativeFixture, path.join(app, name));
    }
    const verification = readFileSync(new URL('./verify-production-bundle.sh', import.meta.url), 'utf8');
    const commands = verification.split('\n').filter(line => line.includes('/usr/bin/lipo'));
    assert.equal(commands.length, 2);
    const result = spawnSync('bash', ['-ec', commands.join('\n')], {
      encoding: 'utf8', env: { ...process.env, app, relative: 'Contents/MacOS/Commander' },
    });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(app, { recursive: true, force: true }); }
});


test('UI resource checks match the launcher and settings documents Vite actually builds', () => {
  const vite = readFileSync(new URL('../apps/desktop-ui/vite.config.ts', import.meta.url), 'utf8');
  const surfaces = [...vite.matchAll(/new URL\('\.\/(\w+\.html)'/g)].map(match => match[1]).sort();
  assert.deepEqual(surfaces, ['launcher.html', 'settings.html']);
  const verification = readFileSync(new URL('./verify-production-bundle.sh', import.meta.url), 'utf8');
  const checks = verification.split('\n').filter(line => line.startsWith('test -s "$app/Contents/Resources/ui/'));
  assert.deepEqual(checks.map(line => line.match(/ui\/([^"/]+)"/)[1]).sort(), surfaces);
  const app = mkdtempSync(path.join(tmpdir(), 'commander-ui-resources-'));
  try {
    mkdirSync(path.join(app, 'Contents/Resources/ui'), { recursive: true });
    for (const name of surfaces) copyFileSync(new URL(`../apps/desktop-ui/${name}`, import.meta.url), path.join(app, 'Contents/Resources/ui', name));
    const result = spawnSync('bash', ['-ec', checks.join('\n')], { encoding: 'utf8', env: { ...process.env, app } });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(app, { recursive: true, force: true }); }
});
