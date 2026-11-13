/** Synthetic browser regression for URL-backed saved-page sources and target fences. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = `http://127.0.0.1:${ports.web}`;
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const html = '<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="/scripts/live-source-navigation.browser.fixture.tsx"></script></html>';
const server = await createServer({
	root, configFile: false, envDir: false, publicDir: false,
	resolve: { alias: { '~': join(root, 'app') } },
	server: { host: '127.0.0.1', port: ports.web, strictPort: true, hmr: false },
	plugins: [{ name: 'source-navigation-fixture', configureServer(vite) {
		vite.middlewares.use(async (request, response, next) => {
			if (!request.url?.startsWith('/p/fixture')) return next();
			try { response.setHeader('content-type', 'text/html'); response.end(await vite.transformIndexHtml(request.url, html)); }
			catch (error) { next(error); }
		});
	} }]
});

let browser;
try {
	await server.listen();
	browser = await chromium.launch({ chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
	for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
		const page = await browser.newPage({ viewport });
		page.setDefaultTimeout(12000);
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(request.url().replace(origin, '')); });
		let releaseSlow, releaseTarget, releaseReload;
		let holdReload = false;
		const slowGate = new Promise(resolve => { releaseSlow = resolve; });
		const targetGate = new Promise(resolve => { releaseTarget = resolve; });
		const reloadGate = new Promise(resolve => { releaseReload = resolve; });
		await page.route(origin + '/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: {
			schemaVersion: 1, origin, features: { 'api.actions-run': { version: '1.46.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } }
		} }));
		await page.route(origin + '/api/v1/actions/run', async route => {
			const { action, inputs } = route.request().postDataJSON();
			if (action === 'fixture-list' && inputs.q === 'slow') await slowGate;
			if (action === 'fixture-list' && inputs.q === 'fast' && holdReload) await reloadGate;
			if (action === 'fixture-target' && inputs.id === 'second') await targetGate;
			const text = action === 'fixture-list' ? `List ${inputs.q || 'all'}` : action === 'fixture-target' ? `Target ${inputs.id || 'none'}` : null;
			assert.ok(text, `unexpected Action ${action}`);
			await route.fulfill({ json: { ok: true, status: 'ok', cache: 'private', result: { text } } });
		});
		try {
			await page.goto(origin + '/p/fixture?q=initial', { timeout: 60000 });
			await page.getByText('List initial').waitFor();
			await page.getByText('Target none').waitFor();
			await page.getByRole('button', { name: 'Edit local draft' }).click();
			await page.getByText('Draft edited').waitFor();
			const input = page.getByRole('searchbox', { name: 'Filter records' });
			await input.fill('slow');
			await input.evaluate(node => { window.fixtureInput = node; });
			const slowRequest = page.waitForRequest(req => req.url().endsWith('/actions/run') && req.postDataJSON().action === 'fixture-list' && req.postDataJSON().inputs.q === 'slow');
			await input.press('Enter');
			await slowRequest;
			await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === 'slow');
			assert.equal(await page.getByText('List initial').count(), 1, 'filter keeps previous same-scope content');
			assert.equal(JSON.parse(await page.locator('#runtime-state').innerText()).refreshing, true);
			assert.equal(await input.evaluate(node => node === window.fixtureInput && node === document.activeElement), true, 'query route retains input and focus');
			await input.fill('fast');
			await input.press('Enter');
			await page.getByText('List fast').waitFor();
			const slowResponse = page.waitForResponse(res => res.url().endsWith('/actions/run') && res.request().postDataJSON().action === 'fixture-list' && res.request().postDataJSON().inputs.q === 'slow');
			releaseSlow();
			await slowResponse;
			assert.equal(await page.getByText('List slow').count(), 0, 'late filter result cannot replace the latest query');
			assert.equal(JSON.parse(await page.locator('#runtime-state').innerText()).refreshing, false);
			assert.equal(await page.getByText('Draft edited').count(), 1, 'filter query retains the same target draft');
			const targetRequest = page.waitForRequest(req => req.url().endsWith('/actions/run') && req.postDataJSON().action === 'fixture-target' && req.postDataJSON().inputs.id === 'second');
			await page.getByRole('button', { name: 'Open another record' }).click();
			await targetRequest;
			assert.equal(await page.getByText('Target none').count(), 0, 'new target clears the prior record');
			assert.equal(await page.getByText('Draft edited').count(), 0, 'new target clears the prior local draft');
			releaseTarget();
			await page.getByText('Target second').waitFor();
			await page.goBack();
			await page.getByText('Target none').waitFor();
			holdReload = true;
			const reloadRequest = page.waitForRequest(req => req.url().endsWith('/actions/run') && req.postDataJSON().action === 'fixture-list' && req.postDataJSON().inputs.q === 'fast');
			await page.reload();
			await reloadRequest;
			assert.equal(await page.getByText('List fast').count(), 1, 'exact cached result paints during reload');
			assert.equal(JSON.parse(await page.locator('#runtime-state').innerText()).state, 'ok');
			releaseReload();
			await page.getByRole('button', { name: 'Change viewer' }).click();
			await page.waitForFunction(() => !document.body.textContent.includes('List fast'));
			assert.equal(await page.getByText('Target none').count(), 0, 'viewer change clears protected target');
			assert.deepEqual(errors, []);
		} catch (error) {
			console.error('source fixture', { url: page.url(), errors, requests: requests.slice(-12), html: (await page.locator('body').innerHTML()).slice(0, 900), text: (await page.locator('body').innerText()).slice(0, 700) });
			throw error;
		} finally {
			releaseSlow(); releaseTarget(); releaseReload();
			await page.close();
		}
	}
} finally {
	await browser?.close();
	await server.close();
}
console.log('Live source URL navigation, retention, target, race, cache and viewer fences passed at desktop and mobile widths.');
