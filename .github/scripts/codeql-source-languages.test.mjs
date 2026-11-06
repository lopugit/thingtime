import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  actionsRequiredForSource,
  symlinkBlobShasForSource,
  symlinkTargetForBlob,
} from './codeql-source-languages.mjs';
import {
  completeAnalysisKeys,
  resolveActionsRequirementsForSnapshots,
  resolveNoActionsReceipts,
} from './codeql-open-pr-backfill.mjs';

const REPOSITORY = 'lopugit/thingtime';
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'c'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const LINK_SHA = 'f'.repeat(40);
const OTHER_LINK_SHA = '1'.repeat(40);
const REF = 'refs/pull/1184/head';
const OTHER_REF = 'refs/pull/1146/head';
const ACTIONS = '/language:actions';
const JAVASCRIPT = '/language:javascript-typescript';
const workflow = readFileSync(new URL('../workflows/codeql-analysis.yml', import.meta.url), 'utf8');
const embeddedPolicy = workflow.match(
  /^[^\n]*BEGIN shared actionsRequiredForSource policy[^\n]*\n([\s\S]*?)^[^\n]*END shared actionsRequiredForSource policy[^\n]*$/mu,
);
assert.ok(embeddedPolicy, 'CodeQL workflow must embed the shared Actions source policy');
const embeddedPolicies = new Function(
  embeddedPolicy[1] + '\nreturn { actionsRequiredForSource, symlinkBlobShasForSource, symlinkTargetForBlob };',
)();

function entry(path, overrides = {}) {
  return { path, mode: '100644', type: 'blob', sha: 'd'.repeat(40), ...overrides };
}

function completeEntries(entries) {
  const parents = new Map();
  for (const candidate of entries) {
    const parts = candidate.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const path = parts.slice(0, index).join('/');
      if (!entries.some((item) => item.path === path)) {
        parents.set(path, entry(path, { mode: '040000', type: 'tree' }));
      }
    }
  }
  return [...parents.values(), ...entries];
}

function source(entries = completeEntries([entry('README.md'), entry('src/index.js')]), length = 40) {
  const expectedSha = 'a'.repeat(length);
  const treeSha = 'b'.repeat(length);
  return {
    expectedSha,
    commit: { sha: expectedSha, tree: { sha: treeSha } },
    tree: { sha: treeSha, truncated: false, tree: entries },
  };
}

function requiresActions(snapshot) {
  const result = actionsRequiredForSource(
    snapshot.commit, snapshot.tree, snapshot.expectedSha, snapshot.symlinkTargets,
  );
  assert.equal(
    embeddedPolicies.actionsRequiredForSource(
      snapshot.commit, snapshot.tree, snapshot.expectedSha, snapshot.symlinkTargets,
    ),
    result,
    'workflow and standalone policy must agree for every source fixture',
  );
  return result;
}

function analysis(category, overrides = {}) {
  return {
    ref: REF,
    commit_sha: SHA,
    category,
    tool: { name: 'CodeQL' },
    ...overrides,
  };
}

function receipt(ref = REF, sha = SHA) {
  return ref + '\0' + sha;
}

function snapshots(...items) {
  return new Map(items.map((snapshot, index) => [index + 1, snapshot]));
}

function sourceReader(snapshot = source(), blobs = new Map()) {
  const calls = [];
  const readJson = (args) => {
    calls.push(args);
    assert.deepEqual(args.slice(0, 1), ['api']);
    assert.equal(args.length, 2);
    if (args[1] === 'repos/' + REPOSITORY + '/git/commits/' + snapshot.expectedSha) {
      return structuredClone(snapshot.commit);
    }
    if (args[1] === 'repos/' + REPOSITORY + '/git/trees/' + snapshot.commit.tree.sha + '?recursive=1') {
      return structuredClone(snapshot.tree);
    }
    for (const [sha, blob] of blobs) {
      if (args[1] === 'repos/' + REPOSITORY + '/git/blobs/' + sha) return structuredClone(blob);
    }
    assert.fail('Unexpected source metadata request: ' + args[1]);
  };
  return { calls, readJson };
}

function symlinkShas(snapshot) {
  const actual = symlinkBlobShasForSource(snapshot.commit, snapshot.tree, snapshot.expectedSha);
  assert.deepEqual(
    embeddedPolicies.symlinkBlobShasForSource(snapshot.commit, snapshot.tree, snapshot.expectedSha),
    actual,
    'workflow and standalone symlink inventory policies must agree',
  );
  return actual;
}

function targetBlob(target, sha = LINK_SHA) {
  const bytes = Buffer.from(target, 'utf8');
  return { sha, encoding: 'base64', content: bytes.toString('base64'), size: bytes.length };
}

function decodeTarget(blob, sha = LINK_SHA) {
  const actual = symlinkTargetForBlob(blob, sha);
  assert.equal(
    embeddedPolicies.symlinkTargetForBlob(blob, sha),
    actual,
    'workflow and standalone blob-decoding policies must agree',
  );
  return actual;
}

function linkedSource(count = 6) {
  return source(completeEntries([
    entry('raycast/src/commander.tsx'),
    ...Array.from({ length: count }, (_, index) =>
      entry('raycast/src/commander-' + index + '.tsx', { mode: '120000', sha: LINK_SHA })),
  ]));
}

test('a complete verified source with no Actions files can omit Actions', () => {
  assert.equal(requiresActions(source()), false);
  assert.equal(requiresActions(source([])), false);
  assert.equal(requiresActions(source([
    entry('src', { mode: '040000', type: 'tree' }),
    entry('src/index.js'),
    entry('scripts', { mode: '040000', type: 'tree' }),
    entry('scripts/check', { mode: '100755' }),
    entry('.github', { mode: '040000', type: 'tree' }),
    entry('.github/README.md'),
    entry('.github/workflows-extra', { mode: '040000', type: 'tree' }),
    entry('.github/workflows-extra/build.yml'),
    entry('config', { mode: '040000', type: 'tree' }),
    entry('config/workflow.yaml'),
    entry('action.yml.example'),
  ])), false);
  assert.equal(requiresActions(source([entry('README.md', { sha: 'd'.repeat(64) })], 64)), false);
});

test('workflow paths and action metadata anywhere keep Actions required', () => {
  for (const candidate of [
    entry('.github/workflows', { mode: '040000', type: 'tree' }),
    entry('.github/workflows/build.yml'),
    entry('.github/workflows/build.yaml'),
    entry('.github/workflows/nested/build.yml'),
    entry('action.yml'),
    entry('action.yaml'),
    entry('tools/custom-action/action.yml'),
    entry('tools/custom-action/action.yaml'),
    entry('.GitHub/WORKFLOWS/build.YML'),
    entry('tools/custom-action/Action.YAML'),
  ]) {
    assert.equal(requiresActions(source(completeEntries([candidate]))), true, candidate.path);
  }
});

test('eligibility follows the exact selected tree when Actions files are added or removed', () => {
  const head = source();
  const merge = source(completeEntries([entry('.github/workflows/inherited.yml')]));
  merge.expectedSha = OTHER_SHA;
  merge.commit.sha = OTHER_SHA;
  merge.commit.tree.sha = 'e'.repeat(40);
  merge.tree.sha = merge.commit.tree.sha;
  assert.equal(requiresActions(head), false);
  assert.equal(requiresActions(merge), true);
  assert.equal(requiresActions({ ...merge, tree: head.tree }), true);
  assert.equal(requiresActions({ ...head, tree: merge.tree }), true);
});

test('missing or mismatched commit and tree identities never prove Actions absent', () => {
  const mutations = [
    ['missing expected SHA', (s) => { s.expectedSha = undefined; }],
    ['non-hex expected SHA', (s) => { s.expectedSha = 'g'.repeat(40); }],
    ['short expected SHA', (s) => { s.expectedSha = 'a'.repeat(39); }],
    ['intermediate expected SHA', (s) => { s.expectedSha = 'a'.repeat(48); }],
    ['long expected SHA', (s) => { s.expectedSha = 'a'.repeat(65); }],
    ['missing commit', (s) => { s.commit = null; }],
    ['wrong commit SHA', (s) => { s.commit.sha = OTHER_SHA; }],
    ['missing commit SHA', (s) => { delete s.commit.sha; }],
    ['missing commit tree', (s) => { delete s.commit.tree; }],
    ['malformed commit tree SHA', (s) => { s.commit.tree.sha = 'not-a-sha'; }],
    ['missing tree', (s) => { s.tree = null; }],
    ['wrong returned tree SHA', (s) => { s.tree.sha = OTHER_SHA; }],
    ['missing returned tree SHA', (s) => { delete s.tree.sha; }],
    ['truncated tree', (s) => { s.tree.truncated = true; }],
    ['missing completeness flag', (s) => { delete s.tree.truncated; }],
    ['non-boolean completeness flag', (s) => { s.tree.truncated = 'false'; }],
    ['missing entries', (s) => { delete s.tree.tree; }],
    ['null entries', (s) => { s.tree.tree = null; }],
    ['non-array entries', (s) => { s.tree.tree = {}; }],
  ];
  for (const [name, mutate] of mutations) {
    const snapshot = source();
    mutate(snapshot);
    assert.equal(requiresActions(snapshot), true, name);
  }
});

test('malformed entries, duplicate paths, symlinks and submodules remain conservative', () => {
  const malformed = [
    null,
    {},
    entry('README.md', { sha: undefined }),
    entry('README.md', { sha: 'invalid' }),
    entry('README.md', { mode: undefined }),
    entry('README.md', { type: undefined }),
    entry('README.md', { mode: '100664' }),
    entry('README.md', { type: 'unknown' }),
    entry('README.md', { size: -1 }),
    entry('README.md', { size: 1.5 }),
    entry('README.md', { size: '1' }),
    entry('README.md', { mode: '040000' }),
    entry('README.md', { type: 'tree' }),
    entry('linked-source', { mode: '120000' }),
    entry('vendor', { mode: '160000', type: 'commit' }),
    ...[undefined, null, 5, '', '/README.md', './README.md', '../README.md',
      'src/../README.md', 'src/./README.md', 'src//README.md', 'src/',
      'src\\README.md', 'src/\0README.md', 'src/\nREADME.md'].map((path) => entry(path)),
  ];
  for (const candidate of malformed) {
    assert.equal(requiresActions(source([candidate])), true, JSON.stringify(candidate));
  }
  assert.equal(requiresActions(source([entry('README.md'), entry('README.md')])), true);
  assert.equal(requiresActions(source([
    entry('src', { mode: '040000', type: 'tree' }), entry('src'),
  ])), true);
  assert.equal(requiresActions(source([entry('src/index.js')])), true, 'missing parent directory');
  assert.equal(requiresActions(source([
    entry('src'), entry('src/index.js'),
  ])), true, 'parent path is a blob, not a directory');
});

test('verified same-directory symlinks to regular files do not invent Actions source', () => {
  const sibling = source(completeEntries([
    entry('src/target.ts'),
    entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
  ]));
  sibling.symlinkTargets = new Map([[LINK_SHA, 'target.ts']]);
  assert.equal(requiresActions(sibling), false);

  const relative = source(completeEntries([
    entry('src/shared.ts'),
    entry('src/links/alias.ts', { mode: '120000', sha: LINK_SHA }),
  ]));
  relative.symlinkTargets = new Map([[LINK_SHA, '../shared.ts']]);
  assert.equal(requiresActions(relative), true, 'cross-directory targets remain conservative');

  const sixLinks = source(completeEntries([
    entry('raycast/src/commander.tsx'),
    ...Array.from({ length: 6 }, (_, index) =>
      entry('raycast/src/commander-' + index + '.tsx', { mode: '120000', sha: LINK_SHA })),
  ]));
  sixLinks.symlinkTargets = new Map([[LINK_SHA, 'commander.tsx']]);
  assert.equal(requiresActions(sixLinks), false);
});

test('unproven or unsafe symlink targets keep Actions required', () => {
  for (const target of [
    undefined, null, 3, '', '/src/target.ts', '../../../outside.ts',
    'missing.ts', '../target.ts', './target.ts', 'subdir/target.ts',
    '..\\target.ts', 'target.ts\n', 'target.ts\0',
  ]) {
    const snapshot = source(completeEntries([
      entry('src/target.ts'),
      entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
    ]));
    snapshot.symlinkTargets = new Map([[LINK_SHA, target]]);
    assert.equal(requiresActions(snapshot), true, JSON.stringify(target));
  }
  const missingTarget = source(completeEntries([
    entry('src/target.ts'),
    entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
  ]));
  missingTarget.symlinkTargets = new Map([[OTHER_LINK_SHA, 'target.ts']]);
  assert.equal(requiresActions(missingTarget), true, 'wrong blob target key');

  for (const targetEntry of [
    entry('src/target', { mode: '040000', type: 'tree' }),
    entry('src/target', { mode: '160000', type: 'commit' }),
    entry('src/target', { mode: '120000', sha: OTHER_LINK_SHA }),
  ]) {
    const snapshot = source(completeEntries([
      targetEntry, entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
    ]));
    snapshot.symlinkTargets = new Map([[LINK_SHA, 'target'], [OTHER_LINK_SHA, 'link.ts']]);
    assert.equal(requiresActions(snapshot), true, targetEntry.mode);
  }
  const self = source(completeEntries([
    entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
  ]));
  self.symlinkTargets = new Map([[LINK_SHA, 'link.ts']]);
  assert.equal(requiresActions(self), true, 'self-link');

  const mixed = source(completeEntries([
    entry('src/target.ts'),
    entry('src/safe.ts', { mode: '120000', sha: LINK_SHA }),
    entry('src/unknown.ts', { mode: '120000', sha: OTHER_LINK_SHA }),
  ]));
  mixed.symlinkTargets = new Map([[LINK_SHA, 'target.ts']]);
  assert.equal(requiresActions(mixed), true, 'one unresolved link cannot borrow another proof');
});

test('Actions-named symlinks keep Actions required even when their targets are regular files', () => {
  for (const path of ['action.yml', 'tools/action.yaml', '.github/workflows/check.yml']) {
    const snapshot = source(completeEntries([
      entry('target.txt'), entry(path, { mode: '120000', sha: LINK_SHA }),
    ]));
    const depth = path.split('/').length - 1;
    snapshot.symlinkTargets = new Map([[LINK_SHA, '../'.repeat(depth) + 'target.txt']]);
    assert.equal(requiresActions(snapshot), true, path);
  }
});

test('symlink inventory deduplicates blob reads and refuses unsafe or over-budget source metadata', () => {
  assert.deepEqual(symlinkShas(linkedSource()), [LINK_SHA]);
  const invalid = [
    { ...linkedSource(), tree: { ...linkedSource().tree, truncated: true } },
    { ...linkedSource(), commit: { ...linkedSource().commit, sha: OTHER_SHA } },
    source(completeEntries([
      entry('.github/workflows/build.yml'),
      entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
    ])),
    source(completeEntries([
      entry('src/link.ts', { mode: '120000', sha: LINK_SHA }),
      entry('bad', { mode: '160000', type: 'commit' }),
    ])),
    source(completeEntries(Array.from({ length: 33 }, (_, index) =>
      entry('src/link-' + index + '.ts', {
        mode: '120000', sha: (index + 1).toString(16).padStart(40, '0'),
      })))),
  ];
  for (const snapshot of invalid) {
    const shas = symlinkShas(snapshot);
    assert.ok(!Array.isArray(shas) || shas.length === 0, 'uncertain source must not trigger blob reads');
  }
});

test('symlink blob decoding verifies immutable identity, canonical bytes, size and UTF-8', () => {
  const valid = targetBlob('commander.tsx');
  assert.equal(decodeTarget(valid), 'commander.tsx');
  assert.equal(decodeTarget({ ...valid, content: valid.content + '\n' }), 'commander.tsx');
  assert.equal(decodeTarget(targetBlob('café.ts')), 'café.ts');
  assert.equal(decodeTarget(targetBlob('a'.repeat(4096))), 'a'.repeat(4096));
  for (const blob of [
    null,
    {},
    { ...valid, sha: OTHER_LINK_SHA },
    { ...valid, encoding: 'utf8' },
    { ...valid, size: 0 },
    { ...valid, size: 4097 },
    { ...valid, size: 1.5 },
    { ...valid, size: String(valid.size) },
    { ...valid, size: valid.size + 1 },
    { ...valid, content: '!!!!' },
    { ...targetBlob('a'), content: 'YR==' },
    { ...targetBlob('a'), content: 'YQ' },
    { ...targetBlob('a'), content: 'YQ==\n' + '\n'.repeat(8192) },
    { ...valid, size: 2, content: Buffer.from([0xff, 0xfe]).toString('base64') },
  ]) {
    assert.notEqual(typeof decodeTarget(blob), 'string', JSON.stringify(blob)?.slice(0, 100));
  }
});

test('ordinary complete analyses retain both languages unless source absence and a receipt are verified', () => {
  const both = [analysis(ACTIONS), analysis(JAVASCRIPT)];
  const complete = completeAnalysisKeys(both);
  assert.equal(complete.size, 1);
  assert.deepEqual(completeAnalysisKeys(both, new Map([[SHA, false]])), complete);
  for (const requirements of [
    undefined,
    new Map(),
    new Map([[OTHER_SHA, false]]),
    new Map([[SHA, true]]),
    new Map([[SHA, undefined]]),
    new Map([[SHA, null]]),
    new Map([[SHA, 0]]),
  ]) {
    assert.equal(completeAnalysisKeys([analysis(JAVASCRIPT)], requirements).size, 0);
    assert.equal(
      completeAnalysisKeys([analysis(JAVASCRIPT)], requirements, new Set([receipt()])).size,
      0,
      'a receipt cannot replace explicit verified source absence',
    );
  }
  const absent = new Map([[SHA, false]]);
  assert.equal(completeAnalysisKeys([analysis(JAVASCRIPT)], absent).size, 0);
  assert.deepEqual(
    completeAnalysisKeys([analysis(JAVASCRIPT)], absent, new Set([receipt()])),
    complete,
  );
  for (const wrongReceipt of [receipt(OTHER_REF), receipt(REF, OTHER_SHA)]) {
    assert.equal(
      completeAnalysisKeys([analysis(JAVASCRIPT)], absent, new Set([wrongReceipt])).size,
      0,
    );
  }
  assert.equal(completeAnalysisKeys([], absent, new Set([receipt()])).size, 0);
  assert.equal(completeAnalysisKeys([analysis(ACTIONS)], absent, new Set([receipt()])).size, 0);
});

test('analysis completeness never combines different refs, SHAs, tools or categories', () => {
  for (const javascript of [
    analysis(JAVASCRIPT, { ref: OTHER_REF }),
    analysis(JAVASCRIPT, { commit_sha: OTHER_SHA }),
    analysis(JAVASCRIPT, { tool: { name: 'Other scanner' } }),
    analysis(JAVASCRIPT, { tool: undefined }),
    analysis('/language:javascript'),
    analysis('/language:javascript-typescript-extra'),
  ]) {
    assert.equal(completeAnalysisKeys([analysis(ACTIONS), javascript]).size, 0);
  }
  assert.equal(completeAnalysisKeys([analysis(JAVASCRIPT), analysis(JAVASCRIPT)]).size, 0);
});

test('failed analysis records cannot prove completeness or justify a source probe', () => {
  const absent = new Map([[SHA, false]]);
  const receipts = new Set([receipt()]);
  const current = snapshots({ analysisRef: REF, analysisSha: SHA });
  for (const error of ['extraction failed', null, false, 0, { message: 'extraction failed' }]) {
    const failed = analysis(JAVASCRIPT, { error });
    assert.equal(completeAnalysisKeys([analysis(ACTIONS), failed]).size, 0);
    assert.equal(completeAnalysisKeys([failed], absent, receipts).size, 0);
    const result = resolveActionsRequirementsForSnapshots(REPOSITORY, current, [failed], () => {
      assert.fail('A failed JavaScript analysis must not cause a source probe');
    });
    assert.notEqual(result.get(SHA), false);
    assert.equal(completeAnalysisKeys([analysis(ACTIONS, { error }), analysis(JAVASCRIPT)]).size, 0);
    const reader = sourceReader();
    const retryable = resolveActionsRequirementsForSnapshots(
      REPOSITORY, current,
      [analysis(ACTIONS, { error }), analysis(JAVASCRIPT)], reader.readJson,
    );
    assert.equal(retryable.get(SHA), false, 'failed Actions analysis must not hide missing coverage');
    assert.equal(reader.calls.length, 2);
  }
  assert.equal(completeAnalysisKeys([analysis(ACTIONS), analysis(JAVASCRIPT, { error: '' })]).size, 1);
});

test('source probing only reads live snapshots with CodeQL JavaScript present and Actions missing', () => {
  const current = snapshots({ analysisRef: REF, analysisSha: SHA });
  for (const analyses of [
    [],
    [analysis(ACTIONS)],
    [analysis(ACTIONS), analysis(JAVASCRIPT)],
    [analysis(JAVASCRIPT, { ref: OTHER_REF })],
    [analysis(JAVASCRIPT, { commit_sha: OTHER_SHA })],
    [analysis(JAVASCRIPT, { tool: { name: 'Other scanner' } })],
    [analysis('/language:javascript')],
  ]) {
    const result = resolveActionsRequirementsForSnapshots(REPOSITORY, current, analyses, () => {
      assert.fail('Ineligible snapshot must not cause a source API read');
    });
    assert.notEqual(result.get(SHA), false);
  }
  const reader = sourceReader();
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY, current, [analysis(JAVASCRIPT)], reader.readJson,
  );
  assert.equal(result.get(SHA), false);
  assert.deepEqual(reader.calls, [
    ['api', 'repos/' + REPOSITORY + '/git/commits/' + SHA],
    ['api', 'repos/' + REPOSITORY + '/git/trees/' + TREE_SHA + '?recursive=1'],
  ]);
});

test('source probing caches an immutable source SHA across multiple live refs', () => {
  const reader = sourceReader();
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY,
    snapshots({ analysisRef: REF, analysisSha: SHA }, { analysisRef: OTHER_REF, analysisSha: SHA }),
    [analysis(JAVASCRIPT), analysis(JAVASCRIPT, { ref: OTHER_REF })],
    reader.readJson,
  );
  assert.deepEqual(result, new Map([[SHA, false]]));
  assert.equal(reader.calls.length, 2);
});

test('source probing keeps different source SHAs independent', () => {
  const plain = source();
  const withActions = source(completeEntries([entry('.github/workflows/build.yml')]));
  withActions.expectedSha = OTHER_SHA;
  withActions.commit.sha = OTHER_SHA;
  withActions.commit.tree.sha = 'e'.repeat(40);
  withActions.tree.sha = withActions.commit.tree.sha;
  const readers = [sourceReader(plain), sourceReader(withActions)];
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY,
    snapshots({ analysisRef: REF, analysisSha: SHA }, { analysisRef: OTHER_REF, analysisSha: OTHER_SHA }),
    [analysis(JAVASCRIPT), analysis(JAVASCRIPT, { ref: OTHER_REF, commit_sha: OTHER_SHA })],
    (args) => {
      const index = args[1].includes(OTHER_SHA) || args[1].includes(withActions.tree.sha) ? 1 : 0;
      return readers[index].readJson(args);
    },
  );
  assert.deepEqual(result, new Map([[SHA, false], [OTHER_SHA, true]]));
  assert.equal(readers[0].calls.length, 2);
  assert.equal(readers[1].calls.length, 2);
});

test('source probing preserves Actions for matching source and uncertain metadata reads', () => {
  const current = snapshots({ analysisRef: REF, analysisSha: SHA });
  for (const snapshot of [
    source(completeEntries([entry('.github/workflows/build.yml')])),
    { ...source(), tree: null },
    { ...source(), tree: { ...source().tree, truncated: true } },
    { ...source(), commit: { ...source().commit, sha: OTHER_SHA } },
    { ...source(), tree: { ...source().tree, sha: OTHER_SHA } },
  ]) {
    const result = resolveActionsRequirementsForSnapshots(
      REPOSITORY, current, [analysis(JAVASCRIPT)], sourceReader(snapshot).readJson,
    );
    assert.equal(result.get(SHA), true);
  }
  for (const failAt of [1, 2]) {
    const reader = sourceReader();
    let calls = 0;
    const result = resolveActionsRequirementsForSnapshots(
      REPOSITORY, current, [analysis(JAVASCRIPT)], (args) => {
        if (++calls === failAt) throw new Error('Source metadata unavailable');
        return reader.readJson(args);
      },
    );
    assert.equal(result.get(SHA), true);
  }
});

test('source probing propagates API budget exhaustion instead of proving absence', () => {
  for (const failAt of [1, 2]) {
    const reader = sourceReader();
    let calls = 0;
    const error = Object.assign(new Error('API budget exhausted'), { budgetExhausted: true });
    assert.throws(() => resolveActionsRequirementsForSnapshots(
      REPOSITORY,
      snapshots({ analysisRef: REF, analysisSha: SHA }),
      [analysis(JAVASCRIPT)],
      (args) => {
        if (++calls === failAt) throw error;
        return reader.readJson(args);
      },
    ), (caught) => caught === error);
  }
});

test('source probing resolves six same-directory aliases with one bounded blob read', () => {
  const reader = sourceReader(linkedSource(), new Map([[LINK_SHA, targetBlob('commander.tsx')]]));
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY,
    snapshots({ analysisRef: REF, analysisSha: SHA }),
    [analysis(JAVASCRIPT)],
    reader.readJson,
  );
  assert.equal(result.get(SHA), false);
  assert.deepEqual(reader.calls, [
    ['api', 'repos/' + REPOSITORY + '/git/commits/' + SHA],
    ['api', 'repos/' + REPOSITORY + '/git/trees/' + TREE_SHA + '?recursive=1'],
    ['api', 'repos/' + REPOSITORY + '/git/blobs/' + LINK_SHA],
  ]);
});

test('source probing caches shared symlink blobs across different immutable source snapshots', () => {
  const first = linkedSource();
  const second = linkedSource();
  second.expectedSha = OTHER_SHA;
  second.commit.sha = OTHER_SHA;
  second.commit.tree.sha = 'e'.repeat(40);
  second.tree.sha = second.commit.tree.sha;
  const reads = [];
  const responses = new Map([
    ['repos/' + REPOSITORY + '/git/commits/' + SHA, first.commit],
    ['repos/' + REPOSITORY + '/git/trees/' + TREE_SHA + '?recursive=1', first.tree],
    ['repos/' + REPOSITORY + '/git/commits/' + OTHER_SHA, second.commit],
    ['repos/' + REPOSITORY + '/git/trees/' + second.tree.sha + '?recursive=1', second.tree],
    ['repos/' + REPOSITORY + '/git/blobs/' + LINK_SHA, targetBlob('commander.tsx')],
  ]);
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY,
    snapshots({ analysisRef: REF, analysisSha: SHA }, { analysisRef: OTHER_REF, analysisSha: OTHER_SHA }),
    [analysis(JAVASCRIPT), analysis(JAVASCRIPT, { ref: OTHER_REF, commit_sha: OTHER_SHA })],
    (args) => {
      reads.push(args[1]);
      assert.ok(responses.has(args[1]));
      return structuredClone(responses.get(args[1]));
    },
  );
  assert.deepEqual(result, new Map([[SHA, false], [OTHER_SHA, false]]));
  assert.equal(reads.length, 5);
  assert.equal(reads.filter((path) => path.includes('/git/blobs/')).length, 1);
});

test('a symlink blob failure or malformed response preserves Actions and budget exhaustion propagates', () => {
  const current = snapshots({ analysisRef: REF, analysisSha: SHA });
  for (const blob of [
    null,
    { ...targetBlob('commander.tsx'), sha: OTHER_LINK_SHA },
    { ...targetBlob('commander.tsx'), encoding: 'utf8' },
    { ...targetBlob('commander.tsx'), size: 0 },
  ]) {
    const reader = sourceReader(linkedSource(), new Map([[LINK_SHA, blob]]));
    const result = resolveActionsRequirementsForSnapshots(
      REPOSITORY, current, [analysis(JAVASCRIPT)], reader.readJson,
    );
    assert.equal(result.get(SHA), true);
    assert.equal(reader.calls.length, 3);
  }
  const reader = sourceReader(linkedSource());
  let failedAtBlob = false;
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY, current, [analysis(JAVASCRIPT)], (args) => {
      if (args[1].includes('/git/blobs/')) {
        failedAtBlob = true;
        throw new Error('Blob unavailable');
      }
      return reader.readJson(args);
    },
  );
  assert.equal(failedAtBlob, true);
  assert.equal(result.get(SHA), true);
  const budget = Object.assign(new Error('API budget exhausted'), { budgetExhausted: true });
  assert.throws(() => resolveActionsRequirementsForSnapshots(
    REPOSITORY, current, [analysis(JAVASCRIPT)], (args) => {
      if (args[1].includes('/git/blobs/')) throw budget;
      return reader.readJson(args);
    },
  ), (caught) => caught === budget);
});

test('the symlink read budget is shared across snapshots rather than multiplied by PR count', () => {
  const responses = new Map();
  const inputs = [];
  for (const [index, sha] of [SHA, OTHER_SHA].entries()) {
    const treeSha = (index ? 'e' : 'b').repeat(40);
    const entries = [];
    for (let position = 0; position < 20; position += 1) {
      const blobSha = (index * 20 + position + 1).toString(16).padStart(40, '0');
      const target = 'target-' + position + '.ts';
      entries.push(entry('links/' + target), entry('links/alias-' + position + '.ts', {
        mode: '120000', sha: blobSha,
      }));
      responses.set('repos/' + REPOSITORY + '/git/blobs/' + blobSha, targetBlob(target, blobSha));
    }
    const snapshot = source(completeEntries(entries));
    snapshot.expectedSha = sha;
    snapshot.commit.sha = sha;
    snapshot.commit.tree.sha = treeSha;
    snapshot.tree.sha = treeSha;
    responses.set('repos/' + REPOSITORY + '/git/commits/' + sha, snapshot.commit);
    responses.set('repos/' + REPOSITORY + '/git/trees/' + treeSha + '?recursive=1', snapshot.tree);
    inputs.push({ analysisRef: index ? OTHER_REF : REF, analysisSha: sha });
  }
  const reads = [];
  const result = resolveActionsRequirementsForSnapshots(
    REPOSITORY, snapshots(...inputs),
    [analysis(JAVASCRIPT), analysis(JAVASCRIPT, { ref: OTHER_REF, commit_sha: OTHER_SHA })],
    (args) => {
      reads.push(args[1]);
      assert.ok(responses.has(args[1]));
      return structuredClone(responses.get(args[1]));
    },
  );
  assert.equal(result.get(SHA), false);
  assert.equal(result.get(OTHER_SHA), true);
  assert.equal(reads.filter((path) => path.includes('/git/blobs/')).length, 32);
});

function receiptFixture() {
  const controllerSha = '9'.repeat(40);
  const fixture = {
    pulls: [{ number: 1184, head: { sha: SHA } }],
    snapshots: new Map([[1184, { analysisRef: REF, analysisSha: SHA }]]),
    requirements: new Map([[SHA, false]]),
    run: {
      id: 42, run_attempt: 2, path: '.github/workflows/codeql-analysis.yml',
      repository: { full_name: REPOSITORY }, head_branch: 'github-actions',
      event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
      head_sha: controllerSha, display_title: 'Lopu CodeQL PR #1184 @ ' + SHA,
    },
    jobs: { total_count: 2, jobs: [
      {
        id: 101, run_id: 42, run_attempt: 2, head_sha: controllerSha,
        name: 'Analyze (actions)', status: 'completed', conclusion: 'success',
        steps: [{ number: 3, name: 'No Actions inputs at ' + SHA, status: 'completed', conclusion: 'success' }],
      },
      { id: 102, name: 'Analyze (javascript-typescript)' },
    ] },
    calls: [],
  };
  fixture.readJson = (args) => {
    fixture.calls.push(args);
    assert.equal(args[0], 'api');
    if (args[1] === 'repos/' + REPOSITORY + '/actions/workflows/codeql-analysis.yml/runs?event=workflow_dispatch&status=completed&per_page=100') {
      return { workflow_runs: [structuredClone(fixture.run)], total_count: 1 };
    }
    if (args[1] === 'repos/' + REPOSITORY + '/actions/runs/' + fixture.run.id
      + '/attempts/' + fixture.run.run_attempt + '/jobs?per_page=100') {
      return structuredClone(fixture.jobs);
    }
    assert.fail('Unexpected receipt metadata request: ' + args[1]);
  };
  return fixture;
}

function resolveReceipts(fixture, readJson = fixture.readJson) {
  return resolveNoActionsReceipts(
    REPOSITORY, fixture.pulls, fixture.snapshots, fixture.requirements, readJson,
  );
}

test('only an exact successful no-Actions job attempt supplies a completion receipt', () => {
  const fixture = receiptFixture();
  assert.deepEqual(resolveReceipts(fixture), new Set([receipt()]));
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1][1], 'repos/' + REPOSITORY + '/actions/runs/42/attempts/2/jobs?per_page=100');
  const merge = receiptFixture();
  const mergeRef = 'refs/pull/1184/merge';
  merge.snapshots.set(1184, { analysisRef: mergeRef, analysisSha: OTHER_SHA });
  merge.requirements = new Map([[OTHER_SHA, false]]);
  merge.jobs.jobs[0].steps[0].name = 'No Actions inputs at ' + OTHER_SHA;
  assert.deepEqual(resolveReceipts(merge), new Set([receipt(mergeRef, OTHER_SHA)]));
});

test('receipt resolution performs no API reads without a bound Actions-free live candidate', () => {
  for (const mutate of [
    (f) => { f.pulls = []; },
    (f) => { f.snapshots.clear(); },
    (f) => { f.requirements.clear(); },
    (f) => { f.requirements.set(SHA, true); },
    (f) => { f.snapshots.set(1184, { analysisRef: OTHER_REF, analysisSha: SHA }); },
    (f) => {
      f.snapshots.set(1184, { analysisRef: REF, analysisSha: OTHER_SHA });
      f.requirements.set(OTHER_SHA, false);
    },
    (f) => {
      f.snapshots.set(1184, { analysisRef: REF, analysisSha: 'not-a-sha' });
      f.requirements.set('not-a-sha', false);
    },
  ]) {
    const fixture = receiptFixture();
    mutate(fixture);
    assert.equal(resolveReceipts(fixture, () => assert.fail('Ineligible candidate caused an API read')).size, 0);
  }
});

test('receipt resolution rejects wrong run provenance, stale PR heads and unsuccessful runs', () => {
  for (const mutate of [
    (r) => { r.display_title = 'Lopu CodeQL PR #1184 @ ' + OTHER_SHA; },
    (r) => { r.display_title = 'Lopu CodeQL PR #1146 @ ' + SHA; },
    (r) => { r.path = '.github/workflows/other.yml'; },
    (r) => { r.repository.full_name = 'other/repository'; },
    (r) => { r.head_branch = 'develop'; },
    (r) => { r.head_sha = 'invalid'; },
    (r) => { r.event = 'push'; },
    (r) => { r.status = 'in_progress'; },
    (r) => { r.conclusion = 'failure'; },
    (r) => { r.conclusion = 'skipped'; },
    (r) => { r.id = 0; },
    (r) => { r.run_attempt = 1.5; },
  ]) {
    const fixture = receiptFixture();
    mutate(fixture.run);
    assert.equal(resolveReceipts(fixture).size, 0);
  }
});

test('receipt resolution rejects incomplete job inventories and wrong or skipped receipt evidence', () => {
  for (const mutate of [
    (f) => { f.jobs.total_count = 3; },
    (f) => { f.jobs.total_count = 101; },
    (f) => { delete f.jobs.total_count; },
    (f) => { f.jobs.jobs[0].run_id = 43; },
    (f) => { f.jobs.jobs[0].run_attempt = 1; },
    (f) => { f.jobs.jobs[0].head_sha = OTHER_SHA; },
    (f) => { f.jobs.jobs[0].status = 'in_progress'; },
    (f) => { f.jobs.jobs[0].conclusion = 'failure'; },
    (f) => { f.jobs.jobs[0].conclusion = 'skipped'; },
    (f) => { f.jobs.jobs[0].name = 'Analyze (javascript-typescript)'; },
    (f) => { f.jobs.jobs[0].steps = []; },
    (f) => { f.jobs.jobs[0].steps[0].name = 'No Actions inputs at ' + OTHER_SHA; },
    (f) => { f.jobs.jobs[0].steps[0].conclusion = 'skipped'; },
    (f) => { f.jobs.jobs[0].steps[0].status = 'in_progress'; },
    (f) => { f.jobs.jobs[0].steps.push(structuredClone(f.jobs.jobs[0].steps[0])); },
    (f) => { f.jobs.jobs.push(structuredClone(f.jobs.jobs[0])); f.jobs.total_count += 1; },
  ]) {
    const fixture = receiptFixture();
    mutate(fixture);
    assert.equal(resolveReceipts(fixture).size, 0);
  }
});

test('receipt read failures do not produce receipts and quota exhaustion still propagates', () => {
  for (const failAt of [1, 2]) {
    const fixture = receiptFixture();
    let calls = 0;
    assert.equal(resolveReceipts(fixture, (args) => {
      if (++calls === failAt) throw new Error('Receipt metadata unavailable');
      return fixture.readJson(args);
    }).size, 0);
    assert.equal(calls, failAt);
    const budget = Object.assign(new Error('API budget exhausted'), { budgetExhausted: true });
    calls = 0;
    assert.throws(() => resolveReceipts(fixture, (args) => {
      if (++calls === failAt) throw budget;
      return fixture.readJson(args);
    }), (caught) => caught === budget);
  }
});

// Extract the single-line fields these behavioral assertions evaluate. This
// intentionally fails when the workflow shape changes instead of introducing
// a Python/YAML dependency into the dependency-free controller verify lane.
function workflowJob() {
  const blocks = workflow.split('\n  analyze:\n');
  assert.equal(blocks.length, 2);
  const body = blocks[1];
  const property = (text, spaces, key) => {
    const matches = [...text.matchAll(new RegExp('^' + ' '.repeat(spaces) + key + ': (.+)$', 'gm'))];
    assert.ok(matches.length <= 1, 'ambiguous workflow property: ' + key);
    return matches[0]?.[1];
  };
  const matrix = /^        language: \[([^\]]+)\]$/mu.exec(body);
  assert.ok(matrix, 'expected explicit matrix languages');
  const headings = [...body.matchAll(/^      - name: (.+)$/gmu)];
  assert.ok(headings.length > 0);
  const steps = headings.map((heading, index) => {
    const text = body.slice(heading.index, headings[index + 1]?.index ?? body.length);
    return {
      name: heading[1], if: property(text, 8, 'if'), uses: property(text, 8, 'uses'),
      with: {
        ref: property(text, 10, 'ref'),
        'persist-credentials': property(text, 10, 'persist-credentials') === 'false' ? false : undefined,
      },
    };
  });
  return {
    name: property(body, 4, 'name'), if: property(body, 4, 'if'), steps,
    strategy: { matrix: { language: matrix[1].split(',').map((value) => value.trim()) } },
  };
}

function context(language, required, central = true) {
  return {
    matrix: { language },
    needs: { scope: { outputs: {
      analyze: 'true', actions_required: required, analysis_ref: central ? REF : '', analysis_sha: SHA,
    } } },
    steps: { preinit: { outputs: { own: 'true' } }, ownership: { outputs: { upload: 'true' } } },
    github: { event_name: central ? 'workflow_dispatch' : 'push', sha: '9'.repeat(40) },
    strategy: { jobTotal: 2 },
  };
}

function expressionValue(expression, values) {
  const expressionBody = expression.trim().replace(/^\$\{\{\s*|\s*\}\}$/gu, '')
    .replaceAll('strategy.job-total', 'strategy.jobTotal');
  return new Function('matrix', 'needs', 'steps', 'github', 'strategy', 'return (' + expressionBody + ');')(
    values.matrix, values.needs, values.steps, values.github, values.strategy,
  );
}

test('actual workflow guards skip only proven-absent Actions and retain JavaScript analysis', () => {
  const job = workflowJob();
  const step = (name) => {
    const found = job.steps.filter((item) => item.name === name);
    assert.equal(found.length, 1, name);
    return found[0];
  };
  const initialize = step('Initialize CodeQL');
  const wait = step('Wait for every sibling language leg to start');
  const hold = step('Hold the faster analysis until the slowest language lands');
  const confirm = step('Confirm this push still owns the analysis');
  const push = step('Analyze the triggering revision');
  const central = step('Analyze the exact centrally dispatched PR head');
  for (const language of ['actions', 'javascript-typescript']) {
    for (const required of ['false', 'true', '']) {
      const eligible = language !== 'actions' || required !== 'false';
      const dispatched = context(language, required);
      const pushed = context(language, required, false);
      assert.equal(Boolean(expressionValue(job.if, dispatched)), true, 'retain both check contexts');
      assert.equal(Boolean(expressionValue(initialize.if, dispatched)), eligible);
      assert.equal(Boolean(expressionValue(wait.if, dispatched)), eligible);
      assert.equal(Boolean(expressionValue(hold.if, dispatched)), eligible && language !== 'javascript-typescript');
      assert.equal(Boolean(expressionValue(central.if, dispatched)), eligible);
      assert.equal(Boolean(expressionValue(push.if, pushed)), eligible);
      assert.equal(Boolean(expressionValue(confirm.if, pushed)), eligible);
      assert.equal(Boolean(expressionValue(push.if, dispatched)), false);
      assert.equal(Boolean(expressionValue(central.if, pushed)), false);
      pushed.steps.preinit.outputs.own = 'false';
      assert.equal(Boolean(expressionValue(initialize.if, pushed)), false);
      assert.equal(Boolean(expressionValue(wait.if, pushed)), false);
      assert.equal(Boolean(expressionValue(hold.if, pushed)), false);
      assert.equal(Boolean(expressionValue(push.if, pushed)), false);
    }
  }
  const single = context('javascript-typescript', 'false');
  single.strategy.jobTotal = 1;
  assert.equal(Boolean(expressionValue(wait.if, single)), false);
  const lost = context('javascript-typescript', 'false', false);
  lost.steps.ownership.outputs.upload = 'false';
  assert.equal(Boolean(expressionValue(push.if, lost)), false);
});

test('the successful no-Actions receipt follows immutable checkout verification and names the analyzed SHA', () => {
  const job = workflowJob();
  assert.deepEqual(job.strategy.matrix.language, ['actions', 'javascript-typescript']);
  const checkout = job.steps.findIndex((item) => item.uses?.startsWith('actions/checkout@'));
  const verification = job.steps.findIndex((item) => item.name === 'Verify the immutable analyzed checkout');
  const receiptIndex = job.steps.findIndex((item) => item.name?.startsWith('No Actions inputs at '));
  const initialize = job.steps.findIndex((item) => item.name === 'Initialize CodeQL');
  assert.ok(checkout >= 0 && checkout < verification && verification < receiptIndex && receiptIndex < initialize);
  const receiptStep = job.steps[receiptIndex];
  const central = context('actions', 'false');
  const render = (text, values) => text.replace(/\$\{\{\s*([^}]+)\s*\}\}/gu, (_, expression) =>
    String(expressionValue(expression, values)));
  assert.equal(render(job.steps[checkout].with.ref, central), SHA);
  assert.equal(render(receiptStep.name, central), 'No Actions inputs at ' + SHA);
  assert.equal(render(job.name, central), 'Analyze (actions)');
  assert.equal(Boolean(expressionValue(receiptStep.if, central)), true);
  assert.equal(Boolean(expressionValue(receiptStep.if, context('actions', 'true'))), false);
  assert.equal(Boolean(expressionValue(receiptStep.if, context('actions', ''))), false);
  assert.equal(Boolean(expressionValue(receiptStep.if, context('javascript-typescript', 'false'))), false);
  assert.equal(job.steps[checkout].with['persist-credentials'], false);
});
