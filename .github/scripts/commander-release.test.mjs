import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../workflows/commander-release.yml', import.meta.url), 'utf8');
const expression = workflow.match(/    if: >-\n([\s\S]*?)    runs-on:/)[1];
const allowed = new Function('github', `return (${expression});`);
function event(event_name, ref_name, overrides = {}) {
  return { repository: 'lopugit/thingtime', repository_owner: 'lopugit', actor: 'lopugit', event_name, ref_name, ...overrides };
}
function shell(name) {
  return workflow.split(`      - name: ${name}\n`)[1].split('      - name: ')[0]
    .split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
}

test('only main pushes and explicit owner dispatches can access the release job', () => {
  for (const entry of [event('push', 'main'), event('workflow_dispatch', 'main'), event('workflow_dispatch', 'github-actions')]) assert.equal(allowed(entry), true);
  for (const entry of [event('push', 'develop'), event('pull_request_target', 'main'), event('workflow_dispatch', 'feature'), event('workflow_dispatch', 'main', { actor: 'outsider' }), event('push', 'main', { repository: 'fork/thingtime' })]) assert.equal(allowed(entry), false);
});

test('dispatch resolves main through GitHub instead of releasing the controller checkout', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'commander-source-'));
  try {
    for (const [name, ref, expected, status] of [['push', 'main', 'a'.repeat(40), 0], ['workflow_dispatch', 'github-actions', 'b'.repeat(40), 0], ['push', 'feature', '', 1]]) {
      const output = path.join(root, 'output'); writeFileSync(output, '');
      const result = spawnSync('bash', ['-c', `gh() { echo ${'b'.repeat(40)}; }\n${shell('Resolve protected main source')}`], {
        encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: name, GITHUB_REF_NAME: ref, GITHUB_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'lopugit/thingtime', GITHUB_REPOSITORY_OWNER: 'lopugit', GITHUB_ACTOR: 'lopugit', GITHUB_OUTPUT: output },
      });
      assert.equal(result.status, status, result.stderr);
      if (status === 0) assert.equal(readFileSync(output, 'utf8').trim(), `head_sha=${expected}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('GitHub failures cannot be treated as a missing release', () => {
  const result = spawnSync('bash', ['-c', `gh() { return 17; }\n${shell('Stop if this release already exists')}`], { encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'lopugit/thingtime' } });
  assert.equal(result.status, 17);
});

test('signing and publication are scoped after source checks with complete credentials', () => {
  assert.ok(workflow.indexOf('Commander/script/build_and_run.sh --prepare') < workflow.indexOf('MAC_CSC_LINK:'));
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow.split('    steps:')[0], /GH_TOKEN:/);
  for (const key of ['ASC_KEY_CONTENT', 'ASC_KEY_ID', 'ASC_ISSUER_ID']) assert.ok(workflow.includes(`secrets.${key}`));
  assert.match(shell('Import Developer ID and notarization credentials'), /MAC_CSC_LINK:\?/);
  assert.match(workflow, /if: always\(\)[\s\S]*security delete-keychain/);
  assert.doesNotMatch(workflow, /--sign -|SIGNING_MODE=development|dist:unsigned/);
});

test('publication includes both verified product archives and portable checksums without stealing latest', () => {
  const assets = shell('Collect verified assets and notes');
  assert.match(assets, /Commander-App-Release-/);
  assert.match(assets, /Thingtime-Recovery-App-Release-/);
  assert.match(assets, /cd "\$asset_dir" && shasum -a 256/);
  assert.match(shell('Publish complete release'), /--target "\$COMMANDER_GIT_COMMIT"/);
  assert.match(shell('Publish complete release'), /--latest=false/);
  assert.match(shell('Resolve release identity'), /g\$\{SOURCE_SHA:0:12\}/);
});
