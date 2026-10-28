import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { ComponentDataScope } from '../Builder/ComponentSelect';
import { ThingtimeContext } from '~/Providers/ThingtimeProvider';
import { useDrawer } from './Drawer/useDrawer';
import { customDrawerBlocks, upgradeCustomDrawerBlocks } from './Drawer/customDrawerBlocks';
import { drawerChildParentIds, drawerParentOptions, removeCustomDrawerItem, type CustomDrawerItem } from './Drawer/drawerCustomItems';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
function render(scope: Record<string, unknown>, chrome?: any, blocks = customDrawerBlocks(false)) {
 const element = React.createElement(ComponentDataScope.Provider, { value: scope }, React.createElement(WebpageBlocksRenderer, {
  blocks: settingsDocumentBlocks(blocks), componentsByRef: {}, bare: true, chrome
 }));
 const router = createMemoryRouter([{ id: 'root', path: '*', element }], { initialEntries: ['/'], hydrationData: { loaderData: { root: { user: null, dataPlane: null } } } });
 try { return renderToStaticMarkup(React.createElement(RouterProvider, { router })); } finally { router.dispose(); }
}
test('real drawer renderer repeats supplied context rows without database controls', () => {
 const html = render({ drawer: { items: [{ id: 'custom-test', emoji: '⭐', title: 'Saved destination', tooltip: 'A tooltip', url: '/things' }], draft: { title: 'Typed title', emoji: '⭐', url: '/things', tooltip: 'A tooltip' }, results: [] } });
 assert.ok(html.includes('Saved destination'));
 assert.ok(html.includes('href="/things"'));
 assert.ok(html.includes('value="Typed title"'));
 assert.ok(html.includes('word-break:break-word'));
 assert.ok(html.includes('min-width:0'));
 assert.ok(html.includes('max-width:100%'));
 assert.ok(!html.includes('Search records'));
});
test('empty transparent collection templates stay selectable in Builder edit mode', () => {
 const html = render({ drawer: { items: [], draft: {}, results: [] } }, { seamlessMode: 'edit', onHover() {}, onSelect() {}, selectedId: null, hoverId: null });
 for (const id of ['custom-drawer-items', 'custom-drawer-title', 'drawer-results', 'drawer-result-label']) assert.ok(html.includes(`data-block-id="${id}"`), id);
 assert.ok(html.includes('List template'));
});

test('drawer save refuses incomplete hydration before enqueueing preferences', async () => {
 let writes = 0; let save!: ReturnType<typeof useDrawer>['setCustomItems'];
 const Probe = () => { save = useDrawer().setCustomItems; return null; };
 renderToStaticMarkup(React.createElement(ThingtimeContext.Provider, { value: { Everything: {
  thingtime: {}, thingtimeRef: { current: {} }, loading: true, canPersistThingtime: false,
  setThingtime: () => { writes++; }, flushThingtimePersistence: async () => {}, set: null, getThingtime: null, paths: [], events: null
 } } }, React.createElement(Probe)));
 await assert.rejects(save([]), /not ready/);
 assert.equal(writes, 0);
});

test('menu Add and custom links use shared rows with independently editable icon and labels', () => {
 const blocks = settingsDocumentBlocks(customDrawerBlocks(false));
 const flat: any[] = []; const visit = (nodes: any[]) => nodes.forEach(node => { flat.push(node); if (node.children) visit(node.children); }); visit(blocks);
 const byId = (id: string) => flat.find(block => block.id === id);
 assert.equal(byId('custom-drawer-add').props.className, 'tt-drawer-row');
 assert.equal(byId('custom-drawer-link').props.className, 'tt-drawer-row');
 assert.equal(byId('custom-drawer-add-icon').text, '➕');
 assert.equal(byId('custom-drawer-add-label').text, 'Add +');
 const rootChildren = blocks[0].children!;
 assert.ok(rootChildren.findIndex(block => block.id === 'custom-drawer-items') < rootChildren.findIndex(block => block.id === 'custom-drawer-add'));
 assert.equal(byId('custom-drawer-add').css, undefined);
});


test('submenu controls follow actual children through add, remove and reparent at every depth', () => {
 const row = (id: string, parentId?: string): CustomDrawerItem => ({ id, parentId, title: id, url: `/things?item=${id}`, emoji: '⭐', tooltip: '' });
 const root = row('custom-root'); const child = row('custom-child', root.id); const grandchild = row('custom-grandchild', child.id);
 const verify = (items: CustomDrawerItem[], expected: string[], blocks = customDrawerBlocks(false)) => {
  const ids = drawerChildParentIds(drawerParentOptions(items, true, false, () => true));
  // Render each level through the actual saved-block renderer and its item binding scope.
  for (const item of items) {
   const html = render({ drawer: { browse: true, items: [{ ...item, hasChildren: ids.has(item.id) }], draft: {}, results: [] } }, undefined, blocks);
   assert.equal(html.includes(`Open submenu for ${item.title}`), expected.includes(item.id), item.id);
   assert.ok(html.includes(`href="${item.url}"`));
   assert.ok(html.includes('Add +'));
  }
 };
 verify([root], []);
 verify([root, child], [root.id]);
 verify([root, child, grandchild], [root.id, child.id]);
 verify(removeCustomDrawerItem([root, child, grandchild], grandchild.id), [root.id]);
 verify(removeCustomDrawerItem([root, child], child.id), []);
 verify([root, { ...child, parentId: undefined }], []);
 const legacy = customDrawerBlocks(false);
 legacy[0].props!['data-tt-drawer-template-version'] = '2';
 const browse = legacy[0].children![0].children![0].children!.find(block => block.id === 'custom-drawer-browse-visible')!;
 browse.children = browse.children![0].children;
 browse.children![0].css = { color: 'red' };
 const upgraded = upgradeCustomDrawerBlocks(legacy, false);
 verify([root, child, grandchild], [root.id, child.id], upgraded);
 verify([root], [], upgraded);
 assert.equal(upgraded[0].children![0].children![0].children!.find(block => block.id === browse.id)!.children![0].children![0].css?.color, 'red');
 assert.equal(upgradeCustomDrawerBlocks(upgraded, false), upgraded);
});
