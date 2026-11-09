/** Isolated real Builder runtime with synthetic account and API replies.
 * Run from remix/: node scripts/webpage-activation.browser.mjs <private screenshot directory>
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { platformRuntimePlugin } from './platform-runtime-plugin.mjs';

const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const root = fileURLToPath(new URL('../', import.meta.url));
const screenshots = resolve(process.argv[2] ?? '/tmp/thingtime-webpage-activation');
const origin = 'http://127.0.0.1:' + ports.web;
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body { margin:0; font:16px system-ui; } #root button { padding: 8px 12px; min-height:44px; }</style>
<div id="root"></div><script type="module" src="/scripts/webpage-activation.browser.fixture.tsx"></script></html>`;
const vite = await createServer({
	root, configFile: false, envDir: false, publicDir: false,
	resolve: { alias: { '~': join(root, 'app') } },
	server: { host: '127.0.0.1', port: ports.web, strictPort: true, hmr: false },
	plugins: [platformRuntimePlugin({ external: true }), { name: 'webpage-activation-fixture', configureServer(server) {
		server.middlewares.use(async (request, response, next) => {
			if (!request.url?.startsWith('/p/fixture-activation') && !request.url?.startsWith('/builder')) return next();
			try {
				const markup = await server.transformIndexHtml(request.url, html);
				response.setHeader('content-type', 'text/html');
				response.end(markup);
			} catch (error) { next(error); }
		});
	} }]
});

let browser;
try {
	await vite.listen();
	await mkdir(screenshots, { recursive: true, mode: 0o700 });
	browser = await chromium.launch({ chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
	for (const [mode, viewport] of Object.entries({ desktop: { width: 1280, height: 840 }, mobile: { width: 390, height: 844 } })) {
		const context = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
		try { await exercise(context, mode); } finally { await context.close(); }
	}
} finally {
	await browser?.close();
	await vite.close();
}

async function exercise(context, mode) {
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('console', message => { if (message.type() === 'error' && message.text().includes('Error handled by React Router')) errors.push(message.text()); });
	const records = new Set();
	const requests = [];
	let preference = true, failNext = false, blockNext;
	const pagePath = origin + '/p/fixture-activation';
	await page.route(origin + '/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: {
		schemaVersion: 1, origin, features: { 'api.webpages-resolve': { version: '1.15.0' }, 'api.actions-run': { version: '1.45.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } }
	} }));
	await page.route(origin + '/api/v1/actions/run', async route => {
		const body = route.request().postDataJSON();
		assert.equal(body.source, 'activation');
		assert.equal(body.action, 'fixture-ensure');
		assert.equal(body.activationPageId, 'fixture-activation');
		assert.equal(body.activationPageRevision, '2026-11-08T11:55:00.000Z');
		assert.equal(body.inputs, undefined);
		assert.equal(route.request().headers()['x-thingtime-expected-actor'], 'fixture-owner');
		assert.equal(route.request().headers()['x-thingtime-expected-data-plane'], 'home');
		requests.push(body.activationOnceKey);
		const key = body.activationOnceKey;
		if (blockNext) {
			const blocked = blockNext;
			blockNext = null;
			await blocked;
		}
		if (failNext) {
			failNext = false;
			return route.fulfill({ status: 503, json: { ok: false, error: 'Synthetic temporarily unavailable' } });
		}
		if (!preference) return route.fulfill({ json: { ok: true, status: 'ok', result: {} } });
		records.add(key);
		return route.fulfill({ json: { ok: true, status: 'ok', result: { record: { id: 'daily-' + key } } } });
	});
	await page.clock.install({ time: new Date('2026-11-08T12:58:30Z') });
	await page.goto(pagePath);
	try { await page.getByText('Selection: daily-2026-11-08', { exact: true }).waitFor(); }
	catch (error) {
		throw new Error(JSON.stringify({ requests, errors, content: (await page.locator('body').innerText()).slice(0, 600) }), { cause: error });
	}
	assert.deepEqual(requests, ['2026-11-08']);
	await page.getByRole('button', { name: 'Refresh displayed data' }).click();
	await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
	assert.equal(requests.length, 1);
	await page.clock.fastForward(120000);
	await page.getByText('Selection: daily-2026-11-09', { exact: true }).waitFor();
	assert.deepEqual(requests, ['2026-11-08', '2026-11-09']);
	await page.getByText('End of the workspace', { exact: true }).scrollIntoViewIfNeeded();
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
	await page.screenshot({ path: join(screenshots, mode + '-daily-open.png'), fullPage: true });
	await page.reload();
	await page.getByText('Selection: daily-2026-11-09', { exact: true }).waitFor();
	assert.equal(records.size, 2, 'a repeat opening uses the same civil key');

	let release;
	blockNext = new Promise(resolveBlock => { release = resolveBlock; });
	await page.reload();
	await page.getByRole('status', { name: 'Preparing this page' }).waitFor();
	await page.getByRole('button', { name: 'Choose different record' }).click();
	await page.getByText('Selection: manual', { exact: true }).waitFor();
	release();
	await page.getByRole('status', { name: 'Preparing this page' }).waitFor({ state: 'hidden' });
	await page.getByText('Selection: manual', { exact: true }).waitFor();

	await page.goto(pagePath + '?selectedId=linked');
	await page.getByRole('status', { name: 'Preparing this page' }).waitFor({ state: 'hidden' });
	await page.getByText('Selection: linked', { exact: true }).waitFor();
	const beforeInert = requests.length;
	for (const url of [pagePath + '?unconfigured=1', pagePath + '?shared=1', pagePath + '?branch=1', pagePath + '?unverified-device=1', origin + '/builder?mode=builder']) {
		await page.goto(url);
		await page.getByRole('heading', { name: 'Daily workspace' }).waitFor();
		await page.clock.runFor(150);
	}
	assert.equal(requests.length, beforeInert, 'preview, shared, branch, unverified device and unconfigured pages are inert');

	preference = false;
	await page.goto(pagePath);
	await page.getByRole('heading', { name: 'Daily workspace' }).waitFor();
	await page.getByRole('status', { name: 'Preparing this page' }).waitFor({ state: 'hidden' });
	assert.equal(await page.getByText('Selection: daily-2026-11-09', { exact: true }).count(), 0, 'opt-out Action returns no selection');

	preference = true;
	failNext = true;
	await page.reload();
	await page.getByText('Couldn’t run the page setup.', { exact: true }).waitFor();
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
	await page.screenshot({ path: join(screenshots, mode + '-activation-retry.png') });
	const attempts = requests.length;
	await page.getByRole('button', { name: 'Retry' }).click();
	await page.getByText('Selection: daily-2026-11-09', { exact: true }).waitFor();
	assert.equal(requests.length, attempts + 1);
	assert.equal(requests.at(-1), requests.at(-2), 'explicit retry uses the same civil key');
	assert.deepEqual(errors, []);
	console.log(mode + ': live startup, civil rollover, refresh, manual/deep-link selection, inert modes, opt-out and retry');
}
