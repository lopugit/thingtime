import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { PROTECTED_THINGTIME, isProtectedThingtime } from '../../../schemas/registry';
import { ownerLibraryMatch } from './ownerLibraryQuery';

// Evaluate the small Mongo query vocabulary against fixtures, so these tests
// assert which rows are returned rather than duplicating the query structure.
const matches = (doc: Record<string, any>, query: Record<string, any>): boolean => Object.entries(query).every(([key, value]) => {
  if (key === '$or') return value.some((part: any) => matches(doc, part));
  if (key === '$and') return value.every((part: any) => matches(doc, part));
  const actual = doc[key];
  if (value === null) return actual == null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).every(([op, operand]) => {
      if (op === '$exists') return (actual !== undefined) === operand;
      if (op === '$ne') return !isDeepStrictEqual(actual, operand);
      if (op === '$nin') return !(operand as unknown[]).some(item => (Array.isArray(actual) ? actual : [actual]).includes(item));
      if (op === '$in') return (operand as unknown[]).some(item => item === null ? actual == null : (Array.isArray(actual) ? actual : [actual]).includes(item));
      throw new Error(`Unsupported fixture query operator ${op}`);
    });
  }
  return isDeepStrictEqual(actual, value);
});

const recording = { ownerId: 'alice', thingtime: ['attachment'], attachmentPurpose: 'recording', attachmentState: 'ready' };

test('personal emoji library inclusion never exposes a community emoji or another owner', () => {
  const query = ownerLibraryMatch('alice', [...PROTECTED_THINGTIME, 'custom-emoji']);
  const own = { ownerId: 'alice', thingtime: ['custom-emoji'], targetId: null };
  assert.equal(matches(own, query), true);
  assert.equal(matches({ ...own, folderId: 'folder' }, query), true);
  assert.equal(matches({ ...own, targetId: 'community' }, query), false);
  assert.equal(matches({ ...own, ownerId: 'bob' }, query), false);
  assert.equal(matches({ ...own, thingtime: ['custom-emoji', 'data'] }, query), false);
});

test('owner library exposes exact managed content kinds without weakening mixed-kind or owner fences', () => {
  const query = ownerLibraryMatch('alice', PROTECTED_THINGTIME);
  for (const kind of ['theme', 'feed-algorithm']) {
    assert.equal(matches({ ownerId: 'alice', thingtime: [kind], folderId: 'folder' }, query), true);
    assert.equal(matches({ ownerId: 'bob', thingtime: [kind] }, query), false);
    assert.equal(matches({ ownerId: 'alice', thingtime: [kind, 'user'] }, query), false);
    assert.equal(isProtectedThingtime([kind]), true);
  }
});

test('owner library includes completed standalone recordings without exposing drafts, other owners or protected records', () => {
  const query = ownerLibraryMatch('alice', PROTECTED_THINGTIME);
  const rows = [
    { ...recording, id: 'saved-audio' },
    { ...recording, attachmentImportDraft: true, id: 'unfinished-import' },
    { ownerId: 'alice', thingtime: ['post'], id: 'post' },
    ...['pending', 'finalizing', 'deleting'].map(state => ({ ...recording, attachmentState: state, id: state })),
    ...['post', 'comment', 'message', 'profile', 'emoji'].map(purpose => ({ ...recording, attachmentPurpose: purpose, id: purpose })),
    { ...recording, ownerId: 'bob', id: 'foreign-audio' },
    { ...recording, targetId: 'parent', id: 'bound-audio' },
    { ...recording, thingtime: ['attachment', 'user'], id: 'mixed-protected-kind' },
    { ownerId: 'alice', thingtime: ['user'], id: 'account' },
    { ownerId: 'alice', thingtime: ['passkey'], id: 'credential' }
  ];
  assert.deepEqual(rows.filter(row => matches(row, query)).map(row => row.id), ['saved-audio', 'post']);
  assert.equal(isProtectedThingtime(['attachment']), true, 'Listing must never relax generic attachment mutation protection');
});

test('recording library query composes with root/folder, kind and token visibility fences before pagination', () => {
  const own = ownerLibraryMatch('alice', PROTECTED_THINGTIME);
  const root = { $and: [own, { folderId: { $in: [null] } }] };
  assert.equal(matches(recording, root), true);
  assert.equal(matches({ ...recording, folderId: 'folder-a' }, root), false);
  assert.equal(matches(recording, { $and: [own, { folderId: 'folder-a' }] }), false);
  assert.equal(matches(recording, { $and: [own, { thingtime: { $in: ['post'] } }] }), false);
  assert.equal(matches({ ...recording, acl: ['tt:user'] }, { $and: [own, { acl: { $in: ['tt:all'] } }] }), false);
});
