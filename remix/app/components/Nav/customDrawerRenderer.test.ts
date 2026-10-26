import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { ComponentDataScope } from '../Builder/ComponentSelect';
import { ThingtimeContext } from '~/Providers/ThingtimeProvider';
import { useDrawer } from './Drawer/useDrawer';
import { customDrawerBlocks } from './Drawer/customDrawerBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
function render(scope: Record<string, unknown>, chrome?: any) {
 const element = React.createElement(ComponentDataScope.Provider, { value: scope }, React.createElement(WebpageBlocksRenderer, {
  blocks: settingsDocumentBlocks(customDrawerBlocks(false)), componentsByRef: {}, bare: true, chrome
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
