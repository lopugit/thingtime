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

test('nested drawer preferences retain legacy roots and reject orphan and cyclic branches', async () => {
 const { normalizeCustomDrawerItems } = await import('./Drawer/drawerCustomItems');
 const row = (id: string, parentId?: string) => ({ id, title: id, emoji: '⭐', tooltip: '', url: '/', ...(parentId ? { parentId } : {}) });
 const legacy = row('custom-root');
 const deep = Array.from({ length: 150 }, (_, i) => row(`custom-depth-${i}`, i ? `custom-depth-${i - 1}` : 'home-welcome'));
 assert.deepEqual(normalizeCustomDrawerItems([legacy]), [legacy]);
 assert.equal(normalizeCustomDrawerItems(deep).length, 150);
 assert.deepEqual(normalizeCustomDrawerItems([row('custom-a', 'custom-b'), row('custom-b', 'custom-a'), row('custom-c', 'missing'), row('custom-d', 'custom-c')]), []);
});

test('nested parents inherit built-in ancestor auth and publication visibility', async () => {
 const { drawerParentOptions, drawerAncestorPath } = await import('./Drawer/drawerCustomItems');
 const row = (id: string, parentId: string) => ({ id, parentId, title: id, emoji: '⭐', tooltip: '', url: '/' });
 const items = [row('custom-mail', 'mail'), row('custom-deep', 'custom-mail'), row('custom-welcome', 'home-welcome')];
 const guest = drawerParentOptions(items, false, false, () => false);
 assert.equal(guest.some(item => item.id === 'custom-mail' || item.id === 'custom-deep'), false);
 assert.deepEqual(drawerAncestorPath('custom-welcome', guest).map(item => item.id), ['home', 'home-welcome', 'custom-welcome']);
 const owner = drawerParentOptions(items, true, false, () => false);
 assert.equal(owner.some(item => item.id === 'custom-deep'), true);
});

test('moving siblings never reorders another parent and deleting a container retains descendants', async () => {
 const { moveCustomDrawerSibling, removeCustomDrawerItem } = await import('./Drawer/drawerCustomItems');
 const row = (id: string, parentId?: string) => ({ id, parentId, title: id, emoji: '⭐', tooltip: '', url: '/' });
 const items = [row('custom-a', 'home'), row('custom-other', 'feed'), row('custom-b', 'home'), row('custom-child', 'custom-a'), row('custom-grandchild', 'custom-child')];
 assert.deepEqual(moveCustomDrawerSibling(items, 'custom-b', -1).map(item => item.id), ['custom-b', 'custom-other', 'custom-a', 'custom-child', 'custom-grandchild']);
 const removed = removeCustomDrawerItem(items, 'custom-a');
 assert.equal(removed.find(item => item.id === 'custom-child')?.parentId, 'home');
 assert.equal(removed.find(item => item.id === 'custom-grandchild')?.parentId, 'custom-child');
});

test('legacy authored drawer templates gain nesting controls without replacing edited row fields', async () => {
 const { upgradeCustomDrawerBlocks } = await import('./Drawer/customDrawerBlocks');
 const legacy: any[] = [{ id: 'custom-drawer-row', type: 'element', tag: 'div', css: { color: 'red' }, children: [{ id: 'custom-drawer-title', type: 'element', tag: 'span', text: 'My edited title' }] }, { id: 'custom-drawer-form', type: 'element', tag: 'fieldset', children: [] }];
 const upgraded = upgradeCustomDrawerBlocks(legacy, false);
 assert.deepEqual(upgraded[0].css, { color: 'red' });
 assert.equal(upgraded[0].children?.[0].text, 'My edited title');
 assert.equal(upgraded[0].children?.some(node => node.id === 'custom-drawer-browse-visible'), true);
 assert.equal(upgraded[1].children?.some(node => node.id === 'drawer-parent-field'), true);
 assert.deepEqual(upgradeCustomDrawerBlocks(upgraded, false), upgraded);
});

test('built-in branches support deeper descendants and inherit every ancestor visibility rule', async () => {
 const { drawerBuiltinNodes } = await import('./Drawer/drawerMenu');
 const { drawerParentOptions } = await import('./Drawer/drawerCustomItems');
 const menu = [{ id: 'root', label: 'Root', icon: '⭐', children: [{ id: 'middle', label: 'Middle', authOnly: true, children: [{ id: 'deep', label: 'Deep', children: [{ id: 'leaf', label: 'Leaf', to: '/leaf' }] }] }] }];
 assert.deepEqual(drawerBuiltinNodes(menu).map(({ item, parentId }) => [item.id, parentId]), [['root', undefined], ['middle', 'root'], ['deep', 'middle'], ['leaf', 'deep']]);
 assert.deepEqual(drawerParentOptions([], false, false, () => true, menu).map(item => item.id), ['root']);
 assert.deepEqual(drawerParentOptions([], true, false, () => true, menu).map(item => item.id), ['root', 'middle', 'deep', 'leaf']);
});

test('template migration happens once and preserves subsequent authored deletion', async () => {
 const { upgradeCustomDrawerBlocks } = await import('./Drawer/customDrawerBlocks');
 const legacy: any[] = [{ id: 'custom-drawer-root', type: 'element', tag: 'section', children: [{ id: 'custom-drawer-row', type: 'element', tag: 'div', children: [] }] }];
 const migrated = settingsDocumentBlocks(upgradeCustomDrawerBlocks(legacy, false));
 assert.equal(migrated[0].props?.['data-tt-drawer-template-version'], '3');
 migrated[0].children![0].children = [];
 assert.deepEqual(upgradeCustomDrawerBlocks(migrated, false)[0].children![0].children, []);
});


test('submenu visibility migration preserves controls intentionally deleted from v2 templates', async () => {
 const { upgradeCustomDrawerBlocks } = await import('./Drawer/customDrawerBlocks');
 const blocks = customDrawerBlocks(false);
 blocks[0].props!['data-tt-drawer-template-version'] = '2';
 blocks[0].children![0].children![0].children = [];
 assert.deepEqual(upgradeCustomDrawerBlocks(blocks, false)[0].children![0].children![0].children, []);
});
