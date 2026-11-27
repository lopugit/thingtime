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

test('owner library actions sit in Organise and never replace Delete or file ZIP actions', () => {
  const args = { thing: { ...component, thingtime: ['folder'] }, actCount: 1, clipboardCount: 0, ownerId: 'owner' };
  const archive = buildThingsItemMenu({ ...args, libraryAction: 'archive' });
  const organise = archive.sections.find(section => section.id === 'organise')?.actions;
  assert.deepEqual(organise?.map(item => item.command), ['move', 'archive']);
  assert.ok(archive.sections.some(section => section.actions.some(item => item.command === 'delete')));
  assert.ok(archive.sections.some(section => section.actions.some(item => item.command === 'download-archive')));
  assert.ok(LUCIDE_ICONS[organise[1].lucide!]);
  assert.ok(LUCIDE_FOR_EMOJI[organise[1].icon!]);
  const restore = buildThingsItemMenu({ ...args, actCount: 2, libraryAction: 'restore' });
  assert.equal(restore.sections.find(section => section.id === 'organise')?.actions[1].label, 'Restore 2 things');
  assert.ok(commands({ ...args, ownerId: 'other', libraryAction: 'archive' }).includes('archive'), 'server-provided permission is authoritative');
  assert.ok(!commands(args).includes('archive'));
});


test('protected archived metadata exposes restoration without unsupported content actions', () => {
  const thing: ThingsThing = { ...component, thingtime: ['chat-message'], libraryArchived: true, libraryArchiveEligible: true, libraryArchivePresentation: 'metadata', crystal: { name: 'Archived message' } };
  assert.deepEqual(commands({ thing, actCount: 1, clipboardCount: 0, ownerId: 'owner', libraryAction: 'restore' }), ['restore']);
});

test('pin verbs are shared across ordinary, timeline and archived metadata menus', () => {
  const base = { thing: component, actCount: 1, clipboardCount: 0, ownerId: 'owner', pinState: { pinned: false } };
  for (const thing of [component, { ...component, id: 'timeline-folder-a' }, { ...component, libraryArchivePresentation: 'metadata' as const }]) {
    const unpinned = commands({ ...base, thing });
    assert.ok(unpinned.includes('pin'));
    assert.ok(unpinned.includes('reorder-pins'));
    assert.ok(!unpinned.includes('unpin'));
    const pinned = commands({ ...base, thing, pinState: { pinned: true } });
    assert.ok(pinned.includes('unpin'));
    assert.ok(!pinned.includes('pin'));
  }
});
