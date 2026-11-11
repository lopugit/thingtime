import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildThingEntityMenu } from '../Thingtime/ContextMenu/thingEntityMenu';
import { buildThingsItemMenu } from './thingsMenuModel';
import { THING_ACTIONS, type ThingActionId } from '~/schemas/thingActions';
import { supportsThingActions } from '../Lopu/recordingsCapabilities';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';
import { clampMenuAxisShift } from '../Thingtime/ContextMenu/contextMenuGeometry';

test('menu geometry keeps tall menus and scrollbar edges reachable without offset drift', () => {
  assert.equal(clampMenuAxisShift(218, 264, 371), -119);
  assert.equal(clampMenuAxisShift(438, 480, 844), -82);
  assert.equal(clampMenuAxisShift(-40, 264, 390), 48);
  assert.equal(clampMenuAxisShift(20, 264, 390), 0);
  const shift = clampMenuAxisShift(438, 480, 844);
  assert.equal(clampMenuAxisShift((438 + shift) - shift, 480, 844), shift);
  assert.equal(clampMenuAxisShift(438, 136, 844), 0);
});

test('entity schemas inherit canonical verbs while extending their own sections', () => {
  const capabilities = {
    open: true,
    inspect: true,
    'storage-placement': true,
    history: true,
    'copy-link': true,
    'share-preview': true,
    download: true,
    rename: true,
    edit: true,
    share: true,
    archive: true,
    restore: true,
    delete: true,
    'send-to-lopu': true
  } satisfies Record<ThingActionId, true>;
  const menu = buildThingEntityMenu(capabilities,
    [{ id: 'extension', actions: [{ id: 'flair', command: 'flair', label: 'Flair', icon: '🏷️' }] }]);
  const actions = menu.sections.flatMap(section => section.actions);
  for (const base of Object.values(THING_ACTIONS)) assert.deepEqual(actions.find(action => action.id === base.id), base);
  assert.equal(actions.at(-1)?.command, 'delete');
  assert.ok(actions.some(action => action.command === 'flair'));
  assert.deepEqual(buildThingEntityMenu({}).sections, []);
});
test('Drive right-click and touch menus inherit the same model and retain bulk safety', () => {
  const thing: any = { id: 'watch-upload-test', thingtime: ['post'], author: { id: 'owner' }, acl: ['tt:user'], tags: ['apple-watch'] };
  const menu = buildThingsItemMenu({ thing, ownerId: 'owner', actCount: 1, clipboardCount: 0, dataPlane: 'drive-plane' });
  const actions = menu.sections.flatMap(section => section.actions);
  for (const action of actions) {
    const base = THING_ACTIONS[action.id as keyof typeof THING_ACTIONS];
    if (base) assert.equal(action.label, base.label);
  }
  assert.ok(actions.some(action => action.command === 'history'));
  assert.equal(actions.find(action => action.command === 'storage-placement')?.href,
    '/thing/watch-upload-test?dataPlane=drive-plane&from=things#thing-storage');
  const bulk = buildThingsItemMenu({ thing, ownerId: 'owner', actCount: 3, clipboardCount: 0 });
  const bulkCommands = bulk.sections.flatMap(section => section.actions).map(action => action.command);
  for (const command of ['send-to-lopu', 'history', 'storage-placement']) assert.ok(!bulkCommands.includes(command), command);
  const other = buildThingsItemMenu({ thing, ownerId: 'another-user', actCount: 1, clipboardCount: 0 });
  const otherCommands = other.sections.flatMap(section => section.actions).map(action => action.command);
  for (const command of ['history', 'storage-placement']) assert.ok(!otherCommands.includes(command), command);
  const views = readFileSync(new URL('./ThingsViews.tsx', import.meta.url), 'utf8');
  assert.match(views, /buildThingsItemMenu\(/); assert.doesNotMatch(views, /<MenuList/);
  for (const file of ['../Feed/PostCard.tsx', '../Lopu/RecordingAutomationPage.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /PostThingMenu|PersistedThingMenu/);
  }
});
test('Thing actions are origin-scoped and deliberately negotiated', () => {
  const origin = 'https://thingtime.test';
  const manifest = thingtimeCapabilityManifest(origin);
  assert.equal(supportsThingActions(manifest, origin), true);
  assert.equal(supportsThingActions(manifest, 'https://other.test'), false);
  for (const version of [undefined, '0.9.0', '2.0.0', '1.0.0-beta', '1.0.0', '1.0.1']) {
    assert.equal(supportsThingActions({ origin, features: { 'api.things-actions': { version } } }, origin), false);
  }
  for (const version of ['1.1.0', '1.1.1', '1.2.0'])
    assert.equal(supportsThingActions({ origin, features: { 'api.things-actions': { version } } }, origin), true);
});

test('archive menus offer portable copy/cut/download without live sharing or generic history edits', () => {
  const menu = buildThingsItemMenu({ thing: { id: 'archive', thingtime: ['chat-archive'], author: { id: 'owner' } } as any, ownerId: 'owner', actCount: 1, clipboardCount: 0 });
  const actions = menu.sections.flatMap(section => section.actions);
  const commands = actions.map(action => action.command);
  for (const command of ['copy', 'cut', 'download', 'move']) assert.ok(commands.includes(command));
  for (const command of ['share', 'edit', 'duplicate', 'delete', 'preview', 'inspect']) assert.ok(!commands.includes(command));
  assert.equal(actions.find(action => action.command === 'storage-placement')?.href,
    '/thing/archive?archive=true&from=things#thing-storage');
});

test('the managed Timeline folder offers opening and linking, not ordinary folder mutations', () => {
  const menu = buildThingsItemMenu({ thing: { id: 'timeline-folder-owner', thingtime: ['folder'], author: { id: 'owner' } } as any, ownerId: 'owner', actCount: 1, clipboardCount: 0 });
  assert.deepEqual(menu.sections.flatMap(section => section.actions).map(action => action.command), ['open', 'copy-link']);
});
