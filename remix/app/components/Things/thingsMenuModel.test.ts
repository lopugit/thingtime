import assert from 'node:assert/strict';
import test from 'node:test';

import { LUCIDE_ICONS, LUCIDE_FOR_EMOJI } from '~/theme/icons';
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


test('Builder navigation appears on recognized Things throughout the library and keeps ownership and bulk scope', () => {
  const base = { thing: component, actCount: 1, clipboardCount: 0, ownerId: 'owner' };
  const actions = buildThingsItemMenu(base).sections.flatMap(section => section.actions);
  assert.equal(actions.find(action => action.command === 'open-builder')?.href, '/builder?thing=component-1');
  assert.equal(actions.find(action => action.command === 'open-live')?.href, '/thing/component-1');
  assert.equal(actions.find(action => action.command === 'inspect')?.href, '/thing/component-1?from=things');
  assert.equal(actions.find(action => action.command === 'open')?.href, '/builder?thing=component-1');
  assert.ok(!commands({ ...base, ownerId: 'other' }).includes('open-builder'));
  assert.ok(commands({ ...base, ownerId: 'other' }).includes('open-live'));
  assert.ok(!commands({ ...base, actCount: 2 }).includes('open-builder'));
  assert.ok(!commands({ ...base, thing: { ...component, thingtime: ['data'] } }).includes('open-builder'));
  const data = { ...base, thing: { ...component, thingtime: ['data', 'builder-thing'] } };
  assert.ok(commands(data).includes('open-builder'));
  assert.ok(!commands(data).includes('open-live'));
});


test('Builder navigation has registered icons in both icon themes', () => {
  const actions = buildThingsItemMenu({ thing: component, actCount: 1, clipboardCount: 0, ownerId: 'owner' }).sections.flatMap(section => section.actions);
  for (const action of actions.filter(action => action.command === 'open-builder' || action.command === 'open-live')) {
    assert.ok(action.lucide && LUCIDE_ICONS[action.lucide]);
    assert.ok(action.icon && LUCIDE_FOR_EMOJI[action.icon]);
  }
});
