import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Uses the real Builder list and hooks with synthetic HTTP responses only.
const base = process.env.TT_SHARED_TEST_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'Builder independently loads, retries and paginates content on mobile without leaking an old identity',
	{ skip: !base || !playwrightPath },
	async () => {
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
		const { chromium } = await import(pathToFileURL(playwrightPath!).href);
		const moduleText = await fetch(new URL('/app/components/Builder/BuilderPagesList.tsx', base)).then((response) => response.text());
		const moduleImport = (name: string) => {
			const path = [...moduleText.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]).find((path) => path.includes(`/${name}.js`));
			assert.ok(path, `Missing optimized ${name} import`);
			return JSON.stringify(path);
		};
		const entry = await fetch(new URL('/app/entry.client.tsx', base)).then((response) => response.text());
		const domImport = entry.match(/from\s+["']([^"']*react-dom_client\.js[^"']*)["']/)?.[1];
		assert.ok(domImport);
		const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH, args: ['--no-sandbox'] });
		try {
			const tab = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, deviceScaleFactor: 1 });
			const errors: string[] = [];
			tab.on('pageerror', (error: Error) => {
				errors.push(error.message);
				console.error('Builder fixture:', error.message);
			});
			await tab.clock.install();
			let mode: 'hold-pages' | 'ready' | 'fail-more' | 'component-error' | 'other-account' | 'other-database' | 'empty' = 'hold-pages';
			let releasePages: (() => Promise<void>) | undefined;
			const cursors: string[] = [];
			const row = (id: string) => ({ id, crystal: { name: id, blocks: [] } });
			const send = (route: any, things: any[], nextCursor: string | null = null) =>
				route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, things, nextCursor }) });
			await tab.route(`${new URL(base!).origin}/api/**`, (route) =>
				route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"Unexpected fixture request"}' })
			);
			await tab.route('**/.well-known/thingtime-capabilities.json', (route) =>
				route.fulfill({
					contentType: 'application/json',
					body: JSON.stringify({ schemaVersion: 1, origin: new URL(base!).origin, features: { 'api.things': { version: '1.14.0' } } })
				})
			);
			await tab.route('**/api/v1/things?*', async (route) => {
				const params = new URL(route.request().url()).searchParams;
				const kind = params.get('thingtime');
				const cursor = params.get('cursor');
				assert.equal(params.get('limit'), '50');
				assert.equal(route.request().method(), 'GET');
				if (mode === 'empty') return send(route, []);
				if (kind === 'component') {
					if (mode === 'component-error') return route.fulfill({ status: 503, body: '{}' });
					return send(route, [row(`${mode === 'other-account' ? 'Account B' : mode === 'other-database' ? 'Database B' : 'Saved'} component`)]);
				}
				if (mode === 'other-account' || mode === 'other-database')
					return send(route, [row(mode === 'other-account' ? 'Account B page' : 'Database B page')]);
				if (mode === 'hold-pages') {
					releasePages = () => send(route, [row('Stale page')]);
					return;
				}
				if (!cursor)
					return send(
						route,
						Array.from({ length: 50 }, (_, i) => row(`Page ${i + 1}`)),
						'older'
					);
				cursors.push(cursor);
				if (mode === 'fail-more') return route.fulfill({ status: 503, body: '{}' });
				// Visibility filtering can produce an empty page with a continuation.
				if (cursor === 'older') return send(route, [], 'oldest');
				return send(
					route,
					Array.from({ length: 26 }, (_, i) => row(`Page ${i + 50}`))
				);
			});
			await tab.route('**/__builder-list-fixture', (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
import React from ${moduleImport('react')};
import ReactDOM from ${JSON.stringify(domImport)};
import { createMemoryRouter, RouterProvider } from ${moduleImport('react-router')};
import { ChakraProvider } from ${moduleImport('@chakra-ui_react')};
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
const { BuilderPagesList } = await import('/app/components/Builder/BuilderPagesList.tsx');
let user = { id: 'viewer-a' }, dataPlane = 'home';
const router = createMemoryRouter([{ id: 'root', path: '*', loader: () => ({ user, dataPlane }), element: React.createElement(BuilderPagesList) }], { initialEntries: ['/builder'] });
window.changeIdentity = (id, plane = 'home') => { user = id ? { id } : null; dataPlane = plane; router.revalidate(); };
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ChakraProvider, null, React.createElement(RouterProvider, { router })));
</script>`
				})
			);
			await tab.goto(new URL('/__builder-list-fixture', base).href);
			try {
				await tab.getByText('Saved component', { exact: true }).waitFor({ timeout: 20000 });
			} catch (error) {
				console.error('Builder fixture body:', await tab.locator('body').innerText(), errors);
				throw error;
			}
			assert.equal(await tab.getByRole('status').filter({ hasText: 'Loading pages' }).count(), 1);
			assert.equal(await tab.getByText('No pages yet', { exact: false }).count(), 0);
			assert.equal(await tab.getByText('Global blocks 🌐', { exact: true }).count(), 1);
			await tab.clock.fastForward(30_001);
			await tab.getByRole('button', { name: 'Retry pages' }).waitFor();
			mode = 'ready';
			await releasePages?.();
			assert.equal(await tab.getByText('Stale page', { exact: true }).count(), 0);
			await tab.getByRole('button', { name: 'Retry pages' }).click();
			await tab.getByText('Page 50', { exact: true }).waitFor();
			mode = 'fail-more';
			await tab.getByRole('button', { name: 'Load more pages' }).click();
			await tab.getByRole('button', { name: 'Retry pages' }).waitFor();
			assert.equal(await tab.getByText('Page 1', { exact: true }).count(), 1);
			assert.equal(await tab.getByText('Saved component', { exact: true }).count(), 1);
			mode = 'ready';
			await tab.getByRole('button', { name: 'Retry pages' }).click();
			await tab.getByRole('button', { name: 'Load more pages' }).waitFor();
			await tab.getByRole('button', { name: 'Load more pages' }).click();
			await tab.getByText('Page 75', { exact: true }).waitFor();
			assert.equal(await tab.getByText('Page 50', { exact: true }).count(), 1);
			assert.equal(await tab.getByRole('button', { name: 'Load more pages' }).count(), 0);
			assert.deepEqual(cursors, ['older', 'older', 'oldest']);
			mode = 'component-error';
			await tab.evaluate(() => (window as any).changeIdentity('viewer-b'));
			await tab.getByRole('button', { name: 'Retry components' }).waitFor();
			await tab.getByText('Page 1', { exact: true }).waitFor();
			assert.equal(await tab.getByText('Saved component', { exact: true }).count(), 0);
			mode = 'other-account';
			await tab.getByRole('button', { name: 'Retry components' }).click();
			await tab.getByText('Account B component', { exact: true }).waitFor();
			mode = 'other-database';
			await tab.evaluate(() => (window as any).changeIdentity('viewer-b', 'custom-' + 'a'.repeat(64)));
			await tab.getByText('Database B page', { exact: true }).waitFor();
			assert.equal(await tab.getByText('Account B component', { exact: true }).count(), 0);
			assert.equal(await tab.getByText('Page 1', { exact: true }).count(), 0);
			if (process.env.TT_BUILDER_SCREENSHOT) await tab.screenshot({ path: process.env.TT_BUILDER_SCREENSHOT, fullPage: true });
			assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile list fits the viewport');
			mode = 'empty';
			await tab.evaluate(() => (window as any).changeIdentity('viewer-c'));
			await tab.getByText('No pages yet 🌱', { exact: true }).waitFor();
			await tab.getByText('No components yet.', { exact: true }).waitFor();
			await tab.evaluate(() => (window as any).changeIdentity(null));
			await tab.getByText('Sign in to build pages 🗝️', { exact: true }).waitFor();
			assert.equal(await tab.getByText('No pages yet 🌱', { exact: true }).count(), 0);
			assert.deepEqual(errors, []);
		} finally {
			await browser.close();
		}
	}
);
