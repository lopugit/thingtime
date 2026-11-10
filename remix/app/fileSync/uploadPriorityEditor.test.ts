import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUploadPriorityDraft } from './uploadPriorityEditor';
import { DEFAULT_SYNC_IGNORE_RULES } from './syncIgnore';
const policy = { ignoreRules: DEFAULT_SYNC_IGNORE_RULES, excludedPaths: ['Library', 'Applications', '.Trash'] };
test('priority paths preserve meaningful whitespace, order, Git files and overlapping folders', () => {
 assert.deepEqual(parseUploadPriorityDraft('things/code/project/.git\r\nthings/code/project\nFirst Creative/my file.txt\n leading-space\n', policy),
  ['things/code/project/.git', 'things/code/project', 'First Creative/my file.txt', ' leading-space']);
 assert.deepEqual(parseUploadPriorityDraft('', policy), []);
});
test('priority edits reject outside paths, aliases and excluded descendants without broadening sync scope', () => {
 for (const path of ['/Users/lopu/private', '../elsewhere', 'a/../b', 'folder\0name', 'Library/private.txt', 'project/node_modules/pkg/index.js']) {
  assert.throws(() => parseUploadPriorityDraft(path, policy), undefined, path);
 }
 assert.throws(() => parseUploadPriorityDraft('project\nPROJECT', policy), /Duplicate/);
 assert.deepEqual(parseUploadPriorityDraft('node_modules', policy), ['node_modules']);
});
