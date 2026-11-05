import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const base = process.env.TT_SHARED_TEST_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
// Real provider/hooks, local API, IndexedDB and interpreter. The isolated browser
// owns all fixture data; every account request is refused by the test transport.
test('anonymous page sources execute locally, refresh, and retire at workspace boundaries', { skip: !base || !playwrightPath }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
	const { chromium } = await import(pathToFileURL(playwrightPath!).href);
	const moduleText = await fetch(new URL('/app/components/Builder/webpageRuntime.tsx', base)).then(r => r.text());
	const dep = (name: string) => {
		const found = [...moduleText.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]).find(p => p.includes(`/${name}.js`));
		assert.ok(found); return JSON.stringify(found);
	};
	const liveText = await fetch(new URL('/app/components/Builder/liveComponent.tsx', base)).then(r => r.text());
	const apiText = await fetch(new URL('/app/local-workspace/api.client.ts', base)).then(r => r.text());
	const reference = (text: string, path: string) => {
		const url = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]).find(p => p.split('?')[0] === path);
		assert.ok(url, path); return JSON.stringify(url);
	};
	const entry = await fetch(new URL('/app/entry.client.tsx', base)).then(r => r.text());
	const dom = entry.match(/from\s+["']([^"']*react-dom_client\.js[^"']*)["']/)?.[1];
	assert.ok(dom);
	const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
	try {
		const tab = await browser.newPage();
		const requests: string[] = [], errors: string[] = [];
		tab.on('pageerror', (e: Error) => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
		await tab.route(`${new URL(base!).origin}/api/**`, route => {
			requests.push(new URL(route.request().url()).pathname);
			return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"Fixture denies remote access"}' });
		});
		await tab.route('**/__local-source-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="root"></div><script type="module">
import React from ${dep('react')};
import ReactDOM from ${JSON.stringify(dom)};
import { createMemoryRouter, RouterProvider } from ${dep('react-router')};
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
const { WebpageRuntimeProvider, useWebpageRuntime } = await import(${reference(liveText, '/app/components/Builder/webpageRuntime.tsx')});
const { useThingSource } = await import('/app/components/Builder/liveComponent.tsx');
const { useCollectionSource } = await import('/app/components/Builder/useCollectionSource.ts');
const { NativeControlsEnabled } = await import(${reference(liveText, '/app/components/Builder/NativeComponentControls.tsx')});
const { anonymousApi } = await import('/app/local-workspace/api.client.ts');
const { bindLocalWorkspace } = await import(${reference(apiText, '/app/local-workspace/runtime.client.ts')});
const { rootIdentity } = await import('/app/utils/rootIdentity.ts');
bindLocalWorkspace(true, rootIdentity.read().generation);
const api = anonymousApi({ things: {}, actions: {} });
const schema = await api.things.create({ thingtime: ['schema'], crystal: { name: 'source-fixture', fields: [{ name: 'text', type: 'string' }] } });
const record = await api.things.create({ thingtime: ['data'], crystal: { schemaId: schema.id, text: 'Before local control' } });
const action = await api.things.create({ thingtime: ['action'], crystal: { name: 'Local source', actionKey: 'source-fixture', version: 1,
 capabilities: [{ capability: 'things.read', schemas: ['source-fixture'] }], steps: [{ op: 'things.search', schema: 'source-fixture' }, { op: 'return', value: { items: '$step.1' } }] } });
const bad = await api.things.create({ thingtime: ['action'], crystal: { name: 'Malformed source', version: 1, steps: [{ op: 'return', value: { items: 'bad' } }] } });
let user = null;
window.sourceCommits = [];
function Probe({ source, interactive }) {
 const runtime = useWebpageRuntime();
 const a = useThingSource({ source, cacheId: 'card-a', argValues: {}, interactive });
 const b = useThingSource({ source, cacheId: 'card-b', argValues: {}, interactive });
 const collection = useCollectionSource(source);
 const state = { signedIn: runtime.viewer.signedIn, scope: runtime.cacheScope, canRun: runtime.canRunSources,
 a: a.scope, b: b.scope, collection, last: runtime.last };
 React.useLayoutEffect(() => { window.sourceCommits.push(JSON.parse(JSON.stringify(state))); });
 return React.createElement(React.Fragment, null,
  React.createElement('pre', { id: 'state' }, JSON.stringify(state)),
  React.createElement('button', { onClick: async () => { await api.things.update({ id: record.id, crystal: { text: 'After local control' } }); runtime.report({ action: 'fixture-control', ok: true, result: null, error: null }); } }, 'Change and refresh'),
  React.createElement('button', { onClick: async () => { const runs = await api.actions.runs({ action: action.id }); document.getElementById('runs').textContent = String(runs.runs.length); } }, 'Count runs'));
}
function Harness() {
 const [enabled, setEnabled] = React.useState(true), [source, setSource] = React.useState({ action: action.id });
 return React.createElement(React.Fragment, null,
  React.createElement('output', { id: 'runs' }),
  React.createElement('button', { onClick: () => setEnabled(v => !v) }, 'Toggle inert'),
  React.createElement('button', { onClick: () => setSource({ action: bad.id }) }, 'Malformed'),
  React.createElement('button', { onClick: () => { rootIdentity.changed(); } }, 'Retire workspace'),
  React.createElement(WebpageRuntimeProvider, { enabled, pageId: 'fixture-page', pageKey: null, suiteKey: null, source: 'user' },
   React.createElement(NativeControlsEnabled.Provider, { value: enabled }, React.createElement(Probe, { source, interactive: enabled }))));
}
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user }), element: React.createElement(Harness) }]);
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(RouterProvider, { router }));
</script>` }));
		await tab.goto(new URL('/__local-source-fixture', base).href);
		const state = () => tab.locator('#state').innerText().then(JSON.parse);
		const settled = () => tab.waitForFunction(() => {
			const el = document.querySelector('#state'); if (!el) return false;
			const s = JSON.parse(el.textContent!); return s.a.state === 'ok' && s.b.state === 'ok' && s.collection.items.length === 1 && !s.collection.loading;
		}, undefined, { timeout: 60000 });
		try { await settled(); } catch (e) { console.error(errors, await tab.locator('body').innerText()); throw e; }
		let current = await state();
		assert.equal(current.signedIn, false);
		assert.equal(current.canRun, true);
		assert.equal(current.a.result.items[0].crystal.text, 'Before local control');
		assert.equal(current.collection.items[0].crystal.text, 'Before local control');
		await tab.getByRole('button', { name: 'Count runs' }).click();
		await tab.waitForFunction(() => document.querySelector('#runs')?.textContent === '2'); // sibling cards share one run; collection one
		await tab.getByRole('button', { name: 'Change and refresh' }).click();
		await tab.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).collection.items[0]?.crystal.text === 'After local control');
		await settled();
		assert.equal((await state()).a.result.items[0].crystal.text, 'After local control');
		assert.equal(requests.length, 0, requests.join(', '));
		await tab.getByRole('button', { name: 'Toggle inert' }).click();
		current = await state();
		assert.equal(current.a.state, 'inert'); assert.equal(current.a.result, undefined); assert.deepEqual(current.collection.items, []);
		await tab.getByRole('button', { name: 'Toggle inert' }).click(); await settled();
		await tab.getByRole('button', { name: 'Malformed', exact: true }).click();
		await tab.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).collection.error.includes('list of records'));
		assert.deepEqual((await state()).collection.items, []);
		await tab.getByRole('button', { name: 'Retire workspace' }).click();
		current = await state();
		assert.equal(current.canRun, false); assert.equal(current.scope, null); assert.equal(current.a.result, undefined); assert.deepEqual(current.collection.items, []); assert.equal(current.last, null);
		assert.equal(requests.length, 0); assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});
