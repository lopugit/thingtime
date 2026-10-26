import assert from 'node:assert/strict';
import test from 'node:test';
import { customDrawerUrl, normalizeCustomDrawerItems, updateCustomDrawerDraft } from './Drawer/drawerCustomItems';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { customDrawerBlocks } from './Drawer/customDrawerBlocks';
test('drawer destinations accept relative routes and explicit web origins only', () => {
 for (const url of ['/things?q=hello', 'things', '../things', '#section', '?tab=one', 'https://example.com/a', 'http://localhost:1234/a']) assert.equal(customDrawerUrl(url), url);
 for (const url of ['', '//example.com', 'javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:password@example.com', '\nhttps://example.com', '/a\\b', '/path with space']) assert.equal(customDrawerUrl(url), null);
});
test('persisted custom rows cannot override built-in identities or carry unsafe URLs', () => {
 const item = { id: 'custom-one', emoji: '⭐', title: ' Saved ', tooltip: 'Open saved', url: '/things', thingId: 'thing-one' };
 assert.deepEqual(normalizeCustomDrawerItems([item, item, { ...item, id: 'home' }, { ...item, id: 'custom-two', url: 'javascript:evil()' }]), [{ ...item, title: 'Saved' }]);
 assert.deepEqual(normalizeCustomDrawerItems(null), []);
 assert.equal(customDrawerUrl('  https://example.com  '), 'https://example.com');
});
test('drawer document exposes constituent form fields and repeated templates', () => {
 const all: any[] = [];
 const walk = (blocks: any[]) => blocks.forEach(block => { all.push(block); if (block.children) walk(block.children); });
 walk(settingsDocumentBlocks(customDrawerBlocks(true)));
 for (const name of ['emoji', 'title', 'tooltip', 'url']) {
  const field = all.find(block => block.id === `drawer-${name}`);
  assert.equal(field.props.value, `{drawer.draft.${name}}`);
  assert.equal('defaultValue' in field.props, false);
 }
 for (const id of ['drawer-emoji', 'drawer-title', 'drawer-tooltip', 'drawer-url', 'drawer-query']) assert.equal(all.find(block => block.id === id)?.tag, 'input');
 assert.equal(all.find(block => block.id === 'custom-drawer-items')?.type, 'collection');
 assert.equal(all.find(block => block.id === 'custom-drawer-items')?.props?.transparent, true);
 assert.equal(all.find(block => block.id === 'drawer-results')?.props?.transparent, true);
 assert.equal(all.find(block => block.id === 'drawer-results')?.type, 'collection');
 assert.equal(all.find(block => block.id === 'custom-drawer-dialog')?.tag, 'dialog');
});

test('manual attachment URL edits detach before a search snapshot can replace the baseline', () => {
 const selected = { id: 'custom-attached', emoji: '⭐', title: 'Selected', tooltip: '', url: '/thing/original', thingId: 'original', thingTitle: 'Selected Thing' };
 const unchanged = updateCustomDrawerDraft(selected, { ...selected, title: 'Renamed' });
 assert.equal(unchanged.thingId, 'original');
 const searchSnapshot = updateCustomDrawerDraft(selected, { emoji: selected.emoji, title: selected.title, tooltip: '', url: '/things?different' });
 assert.equal(searchSnapshot.thingId, undefined);
 assert.equal(searchSnapshot.thingTitle, undefined);
 const saved = updateCustomDrawerDraft(searchSnapshot, { ...searchSnapshot });
 assert.equal(saved.thingId, undefined);
 const attachedAgain = { ...searchSnapshot, thingId: 'new-selection', url: '/thing/new-selection' };
 assert.equal(updateCustomDrawerDraft(attachedAgain, { ...attachedAgain }).thingId, 'new-selection');
});

test('failed durable item mutations roll back their own optimistic changes and propagate failure', async () => {
 const { commitCustomDrawerItems } = await import('./Drawer/drawerCustomItems');
 const before = [{ id: 'custom-before', emoji: '⭐', title: 'Before', tooltip: '', url: '/before' }];
 const after = [{ ...before[0], title: 'After' }];
 let items = before; let writes = 0;
 await assert.rejects(commitCustomDrawerItems(after, { read: () => items, write: value => { items = value; writes++; }, flush: async () => { throw new Error('disk full'); } }), /disk full/);
 assert.deepEqual(items, before); assert.equal(writes, 2);
 const controller = new AbortController();
 await assert.rejects(commitCustomDrawerItems(after, { read: () => items, write: value => { items = value; }, signal: controller.signal,
  flush: async () => { controller.abort(); items = before; throw new Error('account changed'); } }), /account changed/);
 assert.deepEqual(items, before);
});

test('an older failed item commit never rolls back a newer write', async () => {
 const { commitCustomDrawerItems } = await import('./Drawer/drawerCustomItems');
 const item = { id: 'custom-record', emoji: '⭐', title: 'Before', tooltip: '', url: '/before' };
 const newer = [{ ...item, title: 'Newer edit' }];
 let items = [item]; let writes = 0;
 await assert.rejects(commitCustomDrawerItems([{ ...item, title: 'Older edit' }], {
  read: () => items, write: value => { writes++; items = value; }, flush: async () => { items = newer; throw new Error('older write failed'); }
 }), /older write failed/);
 assert.deepEqual(items, newer); assert.equal(writes, 1);
});
