import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(new URL('../../../.github/workflows/widgets-release.yml', import.meta.url), 'utf8');

test('only trusted main source reaches signing and publication', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.doesNotMatch(workflow, /pull_request_target:|pull_request:|inputs\.ref/);
  assert.match(workflow, /github\.repository == 'lopugit\/thingtime'/);
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  assert.match(workflow, /ref: \$\{\{ steps\.source\.outputs\.head_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(workflow.indexOf('Compile and test source') < workflow.indexOf('Import Developer ID'));
  assert.match(workflow, /--latest=false/);
  assert.match(workflow, /SHA256SUMS.txt/);
  assert.match(workflow, /if: always\(\)/);
});

test('release version comes from the XcodeGen marketing version', () => {
  const result = spawnSync('python3', ['macos/ThingtimeWidgets/script/release-version.py'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('production packaging rejects development signing before building', () => {
  const result = spawnSync('bash', ['macos/ThingtimeWidgets/script/build-production-release.sh'], {
    cwd: root, encoding: 'utf8', env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      THINGTIME_WIDGETS_SIGNING_IDENTITY: 'Apple Development: test',
      THINGTIME_WIDGETS_RELEASE_VERSION: '1.0.0+build.1.gabcdef123456',
      THINGTIME_WIDGETS_BUILD_NUMBER: '1', THINGTIME_WIDGETS_GIT_COMMIT: 'a'.repeat(40),
      APPLE_TEAM_ID: 'TESTTEAM01', APPLE_API_KEY: '/unused', APPLE_API_KEY_ID: 'unused', APPLE_API_ISSUER: 'unused',
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no development\/ad-hoc fallback/);
});

test('both artifacts must verify before publication', () => {
  assert.match(workflow, /macos\/ThingtimeWidgets\/script\/build-production-release.sh/);
  assert.match(workflow, /macos\/ThingtimeRecovery\/script\/build-production-release.sh/);
  const script = readFileSync(new URL('./build-production-release.sh', import.meta.url), 'utf8');
  assert.match(script, /verify-production-bundle.sh "\$verify\/Thingtime Widgets.app"/);
  assert.match(script, /notarytool submit/);
  assert.match(script, /stapler staple/);
  assert.match(workflow, /Thingtime-Widgets-App-Release-.*macos-arm64.zip/);
});
