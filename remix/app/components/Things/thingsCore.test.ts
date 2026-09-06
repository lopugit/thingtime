import assert from 'node:assert/strict';
import test from 'node:test';

import { groupThings, schemaRenderOf, thingLink, thingOpenHref, type ThingsThing } from './thingsCore';

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

test('thingLink routes every kind to its dedicated page and the rest to /thing/:id', () => {
  assert.equal(thingLink(makeThing('folder-1', 'folder')), '/things?folder=folder-1');
  assert.equal(thingLink(makeThing('post-1', 'post')), '/post/post-1');
  assert.equal(thingLink({ id: 'comment-1', thingtime: ['post', 'comment'] }), '/post/comment-1');
  assert.equal(thingLink(makeThing('action-demo-orders-place', 'action')), '/actions/action-demo-orders-place');
  assert.equal(thingLink(makeThing('webpage-pokeworld', 'webpage')), '/p/webpage-pokeworld');
  assert.equal(thingLink(makeThing('schema-1', 'schema')), '/schemas/schema-1');
  assert.equal(thingLink(makeThing('component-1', 'component')), '/thing/component-1');
  assert.equal(thingLink(makeThing('data-1', 'data')), '/thing/data-1');
  assert.equal(thingLink(makeThing('future-1', 'future-kind')), '/thing/future-1');
  // ids are URL-encoded so an odd id can never break out of the path
  assert.equal(thingLink(makeThing('a b/c', 'data')), '/thing/a%20b%2Fc');
});

test('thingOpenHref carries the referrer hint only onto the universal page', () => {
  assert.equal(thingOpenHref(makeThing('component-1', 'component'), 'things'), '/thing/component-1?from=things');
  assert.equal(thingOpenHref(makeThing('data-1', 'data'), 'actions'), '/thing/data-1?from=actions');
  assert.equal(thingOpenHref(makeThing('post-1', 'post'), 'things'), '/post/post-1');
  assert.equal(thingOpenHref(makeThing('folder-1', 'folder'), 'things'), '/things?folder=folder-1');
  assert.equal(thingOpenHref(makeThing('action-1', 'action'), 'things'), '/actions/action-1');
});

test('schemaRenderOf reads a schema thing render template and nothing else', () => {
  const render = { kind: 'element', tag: 'div', children: ['{name}'] };
  assert.deepEqual(schemaRenderOf({ thingtime: ['schema'], crystal: { render } }), render);
  assert.equal(schemaRenderOf({ thingtime: ['schema'], crystal: {} }), null);
  assert.equal(schemaRenderOf({ thingtime: ['schema'], crystal: { render: ['not', 'a', 'tree'] } }), null);
  assert.equal(schemaRenderOf({ thingtime: ['data'], crystal: { render } }), null);
  assert.equal(schemaRenderOf(null), null);
  assert.equal(schemaRenderOf(undefined), null);
});
