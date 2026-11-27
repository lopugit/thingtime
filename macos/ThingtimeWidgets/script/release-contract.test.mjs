import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(new URL('../../../.github/workflows/widgets-release.yml', import.meta.url), 'utf8');

// Read the source-selection subset used by these real XcodeGen targets. Refuse
// unfamiliar selection syntax instead of silently approximating a native build.
function targetSources(project, target, platform) {
  const spec = readFileSync(project, 'utf8');
  const targets = spec.split('\ntargets:\n')[1];
  assert.ok(targets, 'the XcodeGen spec declares targets');
  const lines = targets.split('\n');
  const start = lines.indexOf(`  ${target}:`);
  assert.notEqual(start, -1, `target ${target} exists`);
  const end = lines.findIndex((line, index) => index > start && /^\S|^  \S/.test(line));
  const body = lines.slice(start + 1, end === -1 ? undefined : end);
  assert.ok(body.includes(`    platform: ${platform}`));
  const sourceStart = body.indexOf('    sources:');
  assert.notEqual(sourceStart, -1, `target ${target} declares sources`);
  const sourceEnd = body.findIndex((line, index) => index > sourceStart && /^    \S/.test(line));
  const entries = [];
  let readingExcludes = false;
  for (const line of body.slice(sourceStart + 1, sourceEnd === -1 ? undefined : sourceEnd)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const source = /^      - path: ([^#]+)$/.exec(line);
    if (source) {
      entries.push({ path: path.resolve(path.dirname(project), source[1].trim()), excludes: [] });
      readingExcludes = false;
    } else if (line === '        excludes:' && entries.length) {
      readingExcludes = true;
    } else {
      const exclusion = readingExcludes && /^          - ([^#]+)$/.exec(line);
      assert.ok(exclusion, `unsupported source-selection syntax: ${line}`);
      assert.match(exclusion[1], /^[A-Za-z0-9_./-]+\.swift$/, 'these target exclusions use literal Swift file paths');
      entries.at(-1).excludes.push(exclusion[1].trim());
    }
  }
  return entries;
}

const lopuDirectory = path.join(root, 'iOS/Thingtime/Lopu');
const lopuFiles = readdirSync(lopuDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.swift'))
  .map(entry => entry.name).sort();
const chatActivityFiles = [
  'LopuChatActivityClient.swift',
  'LopuChatActivityController.swift',
  'LopuChatActivitySnapshot.swift',
];
function selectsFile(entries, file) {
  return entries.some(entry => {
    const relative = path.relative(entry.path, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      && !entry.excludes.includes(relative.split(path.sep).join('/'));
  });
}
function selectedLopuFiles(entries) {
  return lopuFiles.filter(file => selectsFile(entries, path.join(lopuDirectory, file)));
}

test('macOS selects shared Lopu voice and recording sources without iOS ChatActivity sources', () => {
  const entries = targetSources(path.join(root, 'macos/ThingtimeWidgets/project.yml'), 'ThingtimeWidgets', 'macOS');
  for (const file of [
    ...chatActivityFiles,
    'LopuVoiceHistory.swift', 'LopuVoiceSessionController.swift', 'LopuVoiceCaptures.swift',
    'LopuRecordingUploads.swift', 'LopuVoiceContract.swift',
  ]) assert.ok(lopuFiles.includes(file), `the actual shared source directory retains ${file}`);
  assert.deepEqual(selectedLopuFiles(entries), lopuFiles.filter(file => !chatActivityFiles.includes(file)),
    'the macOS target must retain every shared source except the iOS-only ChatActivity trio');
  const lopuEntries = entries.filter(entry => entry.path === lopuDirectory);
  assert.equal(lopuEntries.length, 1, 'retain the shared Lopu directory source entry');
  assert.deepEqual([...lopuEntries[0].excludes].sort(), [...chatActivityFiles].sort());
});

test('the iOS app still selects the actual ChatActivity and shared Lopu sources', () => {
  const entries = targetSources(path.join(root, 'iOS/project.yml'), 'Thingtime', 'iOS');
  assert.deepEqual(selectedLopuFiles(entries), lopuFiles,
    'macOS exclusions must not remove any Lopu source from the iOS app target');
});

test('the iOS test target still selects its existing ChatActivity regressions', () => {
  const entries = targetSources(path.join(root, 'iOS/project.yml'), 'ThingtimeTests', 'iOS');
  const chatActivityTests = path.join(root, 'iOS/ThingtimeTests/LopuChatActivityTests.swift');
  assert.ok(statSync(chatActivityTests).isFile(), 'the existing ChatActivity test source remains present');
  assert.ok(selectsFile(entries, chatActivityTests), 'ThingtimeTests still includes the ChatActivity regressions');
});

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
