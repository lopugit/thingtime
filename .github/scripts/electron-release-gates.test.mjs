import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../workflows/electron-pr-release.yml', import.meta.url), 'utf8');
const main = readFileSync(new URL('../workflows/electron-release.yml', import.meta.url), 'utf8');
const expression = workflow.match(/    if: >-\n([\s\S]*?)    runs-on:/)[1]
  .replace('github.event.pull_request.labels.*.name', 'github.event.pull_request.labels.map(label => label.name)');
const evaluate = new Function('github', 'inputs', 'contains', `return (${expression});`);
function allowed(event, ref, input = {}, overrides = {}) {
  const github = {
    repository: 'lopugit/thingtime', repository_owner: 'lopugit', actor: 'lopugit', event_name: event, ref_name: ref,
    event: { pull_request: { head: { repo: { full_name: 'lopugit/thingtime' } }, author_association: 'OWNER', labels: [{ name: 'desktop-release' }] } },
    ...overrides,
  };
  return evaluate(github, { release_kind: 'pr', triggering_event: event, ...input }, (array, item) => array.includes(item));
}

const xcodegenStepName = 'Provision XcodeGen for native password provider';
function xcodegenProvisioningStep() {
  const sections = workflow.split(`      - name: ${xcodegenStepName}\n`);
  assert.equal(sections.length, 2, 'the release workflow provisions XcodeGen exactly once');
  return sections[1].split('\n      - name: ')[0];
}

function runXcodegenProvisioning({ existing = 'missing', install = 'success' } = {}) {
  const step = xcodegenProvisioningStep();
  assert.match(step, /^        shell: bash$/m);
  const run = step.split('        run: |\n');
  assert.equal(run.length, 2, 'execute the actual provisioning shell from the workflow');
  const shell = run[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const directory = mkdtempSync(path.join(tmpdir(), 'thingtime xcodegen provisioning '));
  try {
    const bin = path.join(directory, 'bin');
    const trace = path.join(directory, 'trace');
    const template = path.join(directory, 'xcodegen-template');
    mkdirSync(bin);
    writeFileSync(trace, '');
    const xcodegen = `#!/bin/bash
printf 'xcodegen:%s\\n' "$*" >> "$PROVISION_TRACE"
[[ "$#" -eq 1 && "$1" == --version ]] || exit 65
printf 'fixture-xcodegen 1.0.0\\n'
exit ${existing === 'broken' ? 19 : 0}
`;
    writeFileSync(template, xcodegen, { mode: 0o755 });
    if (existing !== 'missing') {
      writeFileSync(path.join(bin, 'xcodegen'), existing === 'unlaunchable'
        ? `#!${path.join(directory, 'missing-interpreter')}\n`
        : xcodegen, { mode: 0o755 });
    }
    // Only these fixture commands are on PATH. The fake installer writes a
    // synthetic executable; it cannot reach Homebrew, native builds or signing.
    writeFileSync(path.join(bin, 'brew'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PROVISION_TRACE, 'brew:' + args.join(' ') + '\\n');
if (JSON.stringify(args) !== JSON.stringify(['install', 'xcodegen'])) process.exit(64);
if (process.env.PROVISION_INSTALL === 'failure') process.exit(23);
if (process.env.PROVISION_INSTALL === 'success') {
  const destination = path.join(process.env.PROVISION_BIN, 'xcodegen');
  fs.copyFileSync(process.env.PROVISION_TEMPLATE, destination);
  fs.chmodSync(destination, 0o755);
}
`, { mode: 0o755 });
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', shell], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        PATH: bin,
        PROVISION_BIN: bin,
        PROVISION_TRACE: trace,
        PROVISION_TEMPLATE: template,
        PROVISION_INSTALL: install,
      },
    });
    assert.ifError(result.error);
    return { ...result, calls: readFileSync(trace, 'utf8').split('\n').filter(Boolean) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('XcodeGen is provisioned before dependency tests and signing credential access', () => {
  const names = [...workflow.matchAll(/^      - name: (.+)$/gm)].map(match => match[1]);
  const provisioning = names.indexOf(xcodegenStepName);
  const corepack = names.indexOf('Enable Corepack');
  assert.notEqual(corepack, -1, 'the release still enables its package manager');
  assert.ok(provisioning > corepack);
  for (const name of [
    'Install release dependencies',
    'Test unsigned source before accessing signing credentials',
    'Select release distribution',
    'Import Developer ID and notarization credentials',
  ]) {
    assert.ok(names.indexOf(name) > provisioning, `${name} runs after XcodeGen provisioning`);
  }
  const step = xcodegenProvisioningStep();
  assert.doesNotMatch(step, /^        if:/m, 'both signed and unsigned releases need XcodeGen');
  assert.doesNotMatch(workflow.split(`      - name: ${xcodegenStepName}\n`)[0] + step, /\bsecrets\./);
});

test('XcodeGen provisioning verifies an installed tool without invoking Homebrew', () => {
  const result = runXcodegenProvisioning({ existing: 'working' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['xcodegen:--version']);
  assert.match(result.stdout, /fixture-xcodegen 1\.0\.0/);
});

test('XcodeGen provisioning installs a missing tool and verifies the installed executable', () => {
  const result = runXcodegenProvisioning();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['brew:install xcodegen', 'xcodegen:--version']);
  assert.match(result.stdout, /fixture-xcodegen 1\.0\.0/);
});

test('XcodeGen provisioning stops when Homebrew installation fails', () => {
  const result = runXcodegenProvisioning({ install: 'failure' });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.calls, ['brew:install xcodegen']);
});

test('XcodeGen provisioning rejects a successful installer that leaves no usable tool', () => {
  const result = runXcodegenProvisioning({ install: 'no-tool' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, ['brew:install xcodegen']);
});

test('XcodeGen provisioning rejects an installed tool whose version probe fails', () => {
  const result = runXcodegenProvisioning({ existing: 'broken' });
  assert.equal(result.status, 19, result.stderr);
  assert.deepEqual(result.calls, ['xcodegen:--version']);
});

test('XcodeGen provisioning rejects an executable that cannot launch', () => {
  const result = runXcodegenProvisioning({ existing: 'unlaunchable' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

test('real caller events reach the approved PR builder', () => {
  for (const ref of ['main', 'develop']) {
    assert.equal(allowed('pull_request_target', ref), true);
    assert.equal(allowed('workflow_dispatch', ref), true);
  }
  assert.equal(allowed('workflow_dispatch', 'github-actions'), true);
  assert.equal(allowed('workflow_call', 'main'), false);
});

test('untrusted callers, forks, missing labels and unrelated events cannot release', () => {
  assert.equal(allowed('pull_request_target', 'feature'), false);
  assert.equal(allowed('workflow_dispatch', 'feature'), false);
  assert.equal(allowed('workflow_dispatch', 'main', {}, { actor: 'outsider' }), false);
  assert.equal(allowed('push', 'main'), false);
  assert.equal(allowed('pull_request_target', 'main', {}, { repository: 'outsider/thingtime' }), false);
  for (const mutation of [
    pr => { pr.labels = []; },
    pr => { pr.author_association = 'CONTRIBUTOR'; },
    pr => { pr.head.repo.full_name = 'outsider/thingtime'; },
  ]) {
    const pull_request = { head: { repo: { full_name: 'lopugit/thingtime' } }, author_association: 'OWNER', labels: [{ name: 'desktop-release' }] };
    mutation(pull_request);
    assert.equal(allowed('pull_request_target', 'main', {}, { event: { pull_request } }), false);
  }
});

test('main release source is isolated to main pushes and explicit owner dispatch', () => {
  assert.equal(allowed('push', 'main', { release_kind: 'main' }), true);
  assert.equal(allowed('workflow_dispatch', 'github-actions', { release_kind: 'main' }), true);
  for (const [event, ref] of [['push', 'develop'], ['pull_request_target', 'main'], ['workflow_dispatch', 'feature']]) {
    assert.equal(allowed(event, ref, { release_kind: 'main' }), false);
  }
  assert.match(main, /uses: \.\/\.github\/workflows\/electron-pr-release.yml/);
  assert.match(main, /release_kind: main/);
  assert.doesNotMatch(main, /dist:unsigned|gh release create|^  push:/m);
});

test('actual version shell creates correct signed and unsigned versions for both sources', () => {
  const section = workflow.split('      - name: Derive SemVer PR release identity\n')[1].split('      - name: Stop if this release already exists\n')[0];
  const shell = section.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const directory = mkdtempSync(path.join(tmpdir(), 'thingtime-release-identity-'));
  try {
    mkdirSync(path.join(directory, 'electron'));
    writeFileSync(path.join(directory, 'electron/package.json'), '{"version":"0.1.0"}');
    for (const RELEASE_KIND of ['main', 'pr']) for (const DISTRIBUTION of ['signed', 'unsigned']) {
      const envFile = path.join(directory, 'environment');
      writeFileSync(envFile, '');
      const result = spawnSync('bash', ['-c', shell], { cwd: directory, encoding: 'utf8', env: { ...process.env, RELEASE_KIND, DISTRIBUTION, PR_NUMBER: '68', PR_REF: 'codex/recovery-sync', PR_SHA: 'a'.repeat(40), GITHUB_RUN_NUMBER: '6', GITHUB_ENV: envFile, GITHUB_OUTPUT: path.join(directory, 'output') } });
      assert.equal(result.status, 0, result.stderr);
      const version = readFileSync(envFile, 'utf8').match(/^THINGTIME_ELECTRON_RELEASE_VERSION=(.+)$/m)[1];
      assert.match(readFileSync(envFile, 'utf8'), /^THINGTIME_ELECTRON_BUILD_NUMBER=6$/m);
      assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
      assert.equal(version.endsWith('.unsigned'), DISTRIBUTION === 'unsigned');
      assert.equal(version.includes('-pr.68.'), RELEASE_KIND === 'pr');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('signing selection reuses the approved CI API key only after macOS opt-in', () => {
  const section = workflow.split('      - name: Select release distribution\n')[1].split('      - name: Derive SemVer PR release identity\n')[0];
  const shell = section.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const directory = mkdtempSync(path.join(tmpdir(), 'thingtime-signing-selection-'));
  const empty = Object.fromEntries(['MAC_CSC_LINK','MAC_CSC_KEY_PASSWORD','APPLE_API_KEY_BASE64','APPLE_API_KEY_ID','APPLE_API_ISSUER','APPLE_TEAM_ID','ASC_KEY_CONTENT','ASC_KEY_ID','ASC_ISSUER_ID'].map(key => [key, '']));
  const api = { ASC_KEY_CONTENT: 'test-key-content', ASC_KEY_ID: 'test-key-id', ASC_ISSUER_ID: 'test-issuer' };
  const mac = { MAC_CSC_LINK: 'test-p12', MAC_CSC_KEY_PASSWORD: 'test-password', APPLE_TEAM_ID: 'test-team' };
  try {
    for (const [values, expected] of [[{}, 'unsigned'], [api, 'unsigned'], [{...api, ...mac}, 'signed'], [{...api, MAC_CSC_LINK: 'test-p12'}, null], [mac, null]]) {
      const output = path.join(directory, 'output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-c', shell], {encoding: 'utf8', env: {...process.env, ...empty, ...values, GITHUB_OUTPUT: output}});
      assert.equal(result.status === 0, expected !== null, result.stderr);
      if (expected) assert.equal(readFileSync(output, 'utf8').trim(), `distribution=${expected}`);
      assert.doesNotMatch(result.stdout + result.stderr, /test-key-content|test-p12|test-password/);
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
