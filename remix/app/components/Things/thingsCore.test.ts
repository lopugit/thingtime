import assert from 'node:assert/strict';
import test from 'node:test';

import { groupThings, type ThingsThing } from './thingsCore';

const makeThing = (id: string, kind: string): ThingsThing => ({
  id,
  thingtime: [kind],
  author: null,
  visibility: 'private',
  acl: [],
  targetId: null,
  folderId: null,
  crystal: {},
  extended: null,
  tags: [],
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z'
});

test('kind grouping resolves canonical icons for populated sections', () => {
  const groups = groupThings(
    [makeThing('post-1', 'post'), makeThing('folder-1', 'folder'), makeThing('future-1', 'future-kind')],
    'kind'
  );

  assert.deepEqual(
    groups.map((group) => ({ key: group.key, label: group.label, icon: group.icon, ids: group.items.map((item) => item.id) })),
    [
      { key: 'folder', label: 'Folders', icon: '📁', ids: ['folder-1'] },
      { key: 'post', label: 'Posts', icon: '📝', ids: ['post-1'] },
      { key: 'future-kind', label: 'Future-kinds', icon: '🌀', ids: ['future-1'] }
    ]
  );
});
