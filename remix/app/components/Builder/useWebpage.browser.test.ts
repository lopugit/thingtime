import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Actual hook lifecycle against the local Vite module graph. All page/Thing
// responses below are intercepted fixtures; this test never writes live data.
const base = process.env.TT_SHARED_TEST_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test('webpage drafts retain transient failures but isolate identity changes and stale landings', { skip: !base || !playwrightPath }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
	const { chromium } = await import(pathToFileURL(playwrightPath!).href);
	// Match Vite's exact optimized-module URL: a second query variant would
	// create another Router context and test the harness rather than the hook.
	const userModule = await fetch(new URL('/app/hooks/useCurrentUser.tsx', base)).then((response) => response.text());
	const routerImport = userModule.match(/from\s+["']([^"']*react-router\.js[^"']*)["']/)?.[1];
	assert.ok(routerImport, 'Run this hook fixture against the local Vite server');
	const hookModule = await fetch(new URL('/app/components/Builder/useWebpage.ts', base)).then((response) => response.text());
	const reactImport = hookModule.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)?.[1];
	assert.ok(reactImport);
	const entryModule = await fetch(new URL('/app/entry.client.tsx', base)).then((response) => response.text());
	const domImport = entryModule.match(/from\s+["']([^"']*react-dom_client\.js[^"']*)["']/)?.[1];
	assert.ok(domImport);
	const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
	try {
		const tab = await browser.newPage();
		tab.on('pageerror', (error: Error) => console.error('Draft harness:', error.message));
		const pending = new Set<string>();
		tab.on('request', (request: any) => pending.add(new URL(request.url()).pathname));
		tab.on('requestfinished', (request: any) => pending.delete(new URL(request.url()).pathname));
		tab.on('requestfailed', (request: any) => { pending.delete(new URL(request.url()).pathname); console.error('Harness request failed:', new URL(request.url()).pathname, request.failure()); });
		let mode: 'ready' | 'error' | 'missing' | 'hold' = 'ready';
		const waiting: Array<() => Promise<void>> = [];
		let finishComponent: (() => Promise<void>) | undefined;
		await tab.route('**/api/v1/things?*', async (route: any) => {
			if (new URL(route.request().url()).searchParams.get('id') !== 'held-component') return route.continue();
			return new Promise<void>((resolve) => {
				finishComponent = async () => {
					await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, thing: { id: 'held-component', crystal: { render: { tag: 'div' } } } }) });
					resolve();
				};
			});
		});
		await tab.route('**/api/v1/webpages/resolve?*', async (route: any) => {
			const id = new URL(route.request().url()).searchParams.get('id');
			const respond = () => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, page: { id, crystal: { name: id, blocks: [] } }, source: 'user', components: [], refs: {} }) });
			if (mode === 'hold') return new Promise<void>((resolve) => waiting.push(async () => { await respond(); resolve(); }));
			if (mode === 'error') return route.fulfill({ status: 503, body: '{}' });
			if (mode === 'missing') return route.fulfill({ status: 404, body: '{}' });
			return respond();
		});
		await tab.route('**/__webpage-draft-fixture', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="root"></div><script type="module">
import React from ${JSON.stringify(reactImport)};
import ReactDOM from ${JSON.stringify(domImport)};
import { createMemoryRouter, RouterProvider } from ${JSON.stringify(routerImport)};
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
const { useWebpageDraft } = await import('/app/components/Builder/useWebpage.ts');
let user = { id: 'viewer-a' };
let captured;
window.draftCommits = [];
function Harness() {
  const [target, setTarget] = React.useState({ kind: 'id', id: 'first', key: 'key-one' });
  const draft = useWebpageDraft(target);
  const snapshot = { page: draft.resolved?.page?.id || null, error: draft.error, loading: draft.loading, dirty: draft.dirty, components: Object.keys(draft.componentsByRef), target: target.id, key: target.key };
  React.useLayoutEffect(() => { window.draftCommits.push(snapshot); });
  return React.createElement('main', null,
    React.createElement('pre', { id: 'state' }, JSON.stringify(snapshot)),
    React.createElement('button', { onClick: draft.refresh }, 'Refresh'),
    React.createElement('button', { onClick: () => { captured = draft; draft.ensureComponent('held-component'); } }, 'Hold component'),
    React.createElement('button', { onClick: () => { captured.setBlocks([]); captured.addComponent('stale', { crystal: { render: {} } }); captured.markSaved({ id: 'first', crystal: { blocks: [] } }); } }, 'Stale callbacks'),
    React.createElement('button', { onClick: () => setTarget({ kind: 'id', id: 'second', key: 'key-one' }) }, 'Change target'),
    React.createElement('button', { onClick: () => setTarget({ kind: 'id', id: 'second', key: 'key-two' }) }, 'Change key'),
    React.createElement('button', { onClick: () => { user = null; router.revalidate(); } }, 'Sign out'),
    React.createElement('button', { onClick: () => draft.setBlocks([]) }, 'Dirty'));
}
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user }), element: React.createElement(Harness) }]);
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(RouterProvider, { router }));
</script>` }));
		await tab.goto(new URL('/__webpage-draft-fixture', base).href);
		const state = () => tab.locator('#state').innerText().then(JSON.parse);
		const settled = () => tab.waitForFunction(() => { const node = document.querySelector('#state'); return node && !JSON.parse(node.textContent!).loading; }, undefined, { timeout: 60000 });
		try { await settled(); } catch (error) { console.error('Harness initial state:', await tab.locator('body').innerText(), [...pending]); throw error; }
		assert.equal((await state()).page, 'first');
		mode = 'error';
		await tab.getByRole('button', { name: 'Refresh', exact: true }).click();
		await tab.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).error);
		assert.equal((await state()).page, 'first', 'a failed refresh retains same-scope content');
		mode = 'hold';
		await tab.getByRole('button', { name: 'Refresh', exact: true }).click();
		await tab.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).loading);
		assert.equal((await state()).error, true, 'retry keeps the last error UI until the response lands');
		assert.equal(waiting.length, 1);
		await waiting.shift()!();
		mode = 'ready';
		await tab.waitForFunction(() => { const state = JSON.parse(document.querySelector('#state')!.textContent!); return !state.loading && !state.error; });
		assert.equal((await state()).error, false);
		const componentRequest = tab.waitForRequest((request: any) => new URL(request.url()).searchParams.get('id') === 'held-component');
		await tab.getByRole('button', { name: 'Hold component', exact: true }).click();
		await componentRequest;
		mode = 'hold';
		await tab.getByRole('button', { name: 'Change target', exact: true }).click();
		assert.equal((await state()).page, null, 'a new target cannot paint the old page');
		await tab.waitForTimeout(100);
		assert.equal(waiting.length, 1);
		assert.ok(finishComponent);
		await finishComponent();
		await tab.getByRole('button', { name: 'Change key', exact: true }).click();
		await waiting.shift()!();
		await tab.waitForTimeout(100);
		assert.equal((await state()).page, null, 'the superseded key response must not land');
		assert.equal(waiting.length, 1);
		await waiting.shift()!();
		await settled();
		assert.equal((await state()).page, 'second');
		await tab.getByRole('button', { name: 'Stale callbacks', exact: true }).click();
		assert.equal((await state()).page, 'second');
		assert.equal((await state()).dirty, false);
		assert.deepEqual((await state()).components, [], 'late component results and old draft handles cannot enter the new scope');
		await tab.getByRole('button', { name: 'Dirty', exact: true }).click();
		mode = 'missing';
		await tab.getByRole('button', { name: 'Refresh', exact: true }).click();
		await tab.waitForFunction(() => { const state = JSON.parse(document.querySelector('#state')!.textContent!); return !state.loading && !state.page; });
		assert.equal((await state()).page, null, 'a revocation clears even a dirty draft');
		assert.equal((await state()).dirty, false);
		mode = 'ready';
		await tab.getByRole('button', { name: 'Refresh', exact: true }).click();
		await tab.waitForFunction(() => { const state = JSON.parse(document.querySelector('#state')!.textContent!); return !state.loading && state.page === 'second'; });
		assert.equal((await state()).page, 'second');
		mode = 'hold';
		await tab.getByRole('button', { name: 'Sign out', exact: true }).click();
		await tab.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).loading);
		assert.equal((await state()).page, null, 'sign-out clears prior viewer content before the next resolve');
		for (const commit of await tab.evaluate(() => (window as any).draftCommits)) {
			assert.ok(commit.target !== 'second' || commit.page !== 'first', 'no intermediate render leaks the former target');
		}
		await waiting.shift()!();
		await settled();
	} finally {
		await browser.close();
	}
});
