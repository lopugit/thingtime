import assert from 'node:assert/strict';
import test from 'node:test';

import { buildThingsItemMenu } from './thingsMenuModel';
import type { ThingsThing } from './thingsCore';

const component = {
  id: 'component-1', thingtime: ['component'], author: { id: 'owner', username: 'owner', displayName: null, avatarUrl: null },
  visibility: 'private', acl: ['tt:user'], targetId: null, folderId: null, crystal: { name: 'Card' }, extended: null,
  tags: [], createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z'
} satisfies ThingsThing;

const commands = (args: Parameters<typeof buildThingsItemMenu>[0]) =>
  buildThingsItemMenu(args).sections.flatMap(section => section.actions.map(action => action.command));

test('Builder offers definition editing only for an owned, single Component', () => {
  const base = { thing: component, actCount: 1, clipboardCount: 0, ownerId: 'owner', builderMode: true };
  assert.ok(commands(base).includes('edit-definition'));
  assert.ok(!commands({ ...base, builderMode: false }).includes('edit-definition'));
  assert.ok(!commands({ ...base, ownerId: 'other' }).includes('edit-definition'));
  assert.ok(!commands({ ...base, actCount: 2 }).includes('edit-definition'));
  assert.ok(!commands({ ...base, thing: { ...component, thingtime: ['data'] } }).includes('edit-definition'));
});
