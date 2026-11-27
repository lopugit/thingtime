/** Isolated Chromium verification of the production Builder and scanner controls.
 * The bridge responses and layout API are synthetic. No iOS app is launched.
 * Run: TT_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node remix/scripts/lidar-scan.browser.mjs <evidence dir>
 */
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), 'thingtime-lidar-browser-'));
await mkdir(evidence, { recursive: true, mode: 0o700 });
const origin = 'http://127.0.0.1:' + ports.web;
const browserOrigin = 'https://lidar-scan-fixture.invalid';
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
#root { max-width: 860px; margin: 24px auto; padding: 0 16px; }
h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
[data-block-id^="fixture-authored-"] { min-height: 44px; padding: 6px 12px; margin: 0 6px 8px 0; border: 1px solid #d4d4d8; border-radius: 8px; }
</style>
<div id="root"></div><script type="module" src="/scripts/lidar-scan.browser.fixture.tsx"></script></html>`;
const server = await createServer({
	root, configFile: false, envDir: false, publicDir: false, cacheDir: join(evidence, 'vite'),
	resolve: { alias: { '~': join(root, 'app') } },
	server: { host: '127.0.0.1', port: ports.web, strictPort: true, hmr: false },
	plugins: [{ name: 'lidar-fixture', configureServer(vite) {
		vite.middlewares.use(async (request, response, next) => {
			if (!request.url?.startsWith('/lidar-fixture')) return next();
			try {
				response.setHeader('content-type', 'text/html');
				response.end(await vite.transformIndexHtml(request.url, html));
			} catch (error) { next(error); }
		});
	} }]
});
const manifest = origin => ({ origin, schemaVersion: 1, features: Object.fromEntries([
	['api.webpages-resolve', '1.6.0'], ['api.actions-run', '1.7.0'], ['api.mongodb-endpoint', '1.1.0'], ['api.things', '1.36.0']
].map(([key, version]) => [key, { version }])) });
const flatten = blocks => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
const readActions = page => page.evaluate(() => window.lidarFixture.requests.map(request => request.action));

let browser;
try {
	await server.listen();
	browser = await chromium.launch({ chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
	for (const [profile, viewport] of Object.entries({ desktop: { width: 1280, height: 840 }, mobile: { width: 390, height: 844 } })) {
		const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile', reducedMotion: 'reduce' });
		try { await exercise(context, profile); }
		catch (error) { for (const page of context.pages()) { await page.screenshot({ path: join(evidence, profile + '-failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-1800)); } throw error; }
		finally { await context.close(); }
	}
	await exerciseBrowserFallback();
	console.log('LIDAR_BROWSER_FIXTURE_PASS ' + evidence);
} finally {
	await browser?.close();
	await server.close();
}

async function exercise(context, profile) {
	const page = await context.newPage();
	page.setDefaultTimeout(20_000);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('**/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: manifest(origin) }));
	const layouts = new Map();
	await page.route('**/api/v1/webpages/resolve?*', route => { const layout = layouts.get(new URL(route.request().url()).searchParams.get('id')); return route.fulfill(layout ? { json: { ok: true, source: 'user', page: layout } } : { status: 404, json: { ok: false } }); });
	await page.route('**/api/v1/things', route => {
		const request = route.request();
		assert.equal(request.method(), 'POST');
		assert.equal(request.headers()['x-thingtime-expected-actor'], 'fixture-lidar-owner');
		assert.equal(request.headers()['x-thingtime-expected-data-plane'], 'home');
		const body = request.postDataJSON();
		assert.deepEqual(body.acl, ['tt:user']);
		assert.ok(['settings-lidar-scan-controls', 'settings-lidar-library-save-button', 'settings-lidar-library-toolbar'].includes(body.crystal.pageKey));
		const layout = { id: 'fixture-layout', updatedAt: new Date().toISOString(), author: { id: 'fixture-lidar-owner' }, ...body };
		layouts.set(body.crystal.pageKey, layout);
		return route.fulfill({ json: { ok: true, thing: layout } });
	});
	const panel = page.getByRole('region', { name: 'LiDAR scan' });
	await page.goto(origin + '/lidar-fixture');
	await page.getByRole('heading', { name: 'LiDAR scans', exact: true }).waitFor();
	await panel.getByRole('button', { name: 'Scan with LiDAR' }).waitFor();
	const scanId = '510fbf8b-5c32-4ddc-8089-c70b392d3aae';
	const card = page.locator('[data-thing-id="' + scanId + '"]');
	await card.getByText('Not saved to Thingtime · 10.6 GiB · Partial', { exact: true }).waitFor();
	const starting = await readActions(page);
	assert.ok(starting.every(action => action === 'status'));
	const before = starting.length;
	await enableCurrentPageBuilder(page);
	for (const [key, id, text] of [['lidar-library-toolbar', 'lidar-library-title', 'My LiDAR scans'], ['lidar-library-save-button', 'scan-save', 'Save this scan']]) {
		const host = key === 'lidar-library-save-button' ? card.locator('[data-settings-document="' + key + '"]') : page.locator('[data-settings-document="' + key + '"]');
		await host.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await host.getByRole('button', { name: 'Open Builder inspector' }).click();
		await page.getByRole('combobox', { name: 'Select block' }).selectOption(id);
		await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
		await page.getByRole('textbox', { name: 'Block text', exact: true }).blur();
		await page.getByRole('button', { name: 'Close builder', exact: true }).click();
		await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/v1/things') && response.request().method() === 'POST'), host.getByRole('button', { name: 'Save layout', exact: true }).click()]);
		assert.equal(flatten(layouts.get('settings-' + key).crystal.blocks).find(block => block.id === id).text, text);
	}
	await page.getByRole('button', { name: 'Builder on current page', exact: true }).press('Enter');

	await card.getByRole('button', { name: 'Save this scan', exact: true }).click();
	assert.ok(await page.getByRole('menu').last().evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }));
	await page.screenshot({ path: join(evidence, profile + '-device-save-menu.png'), fullPage: true });
	await page.getByRole('menuitem', { name: /Device only/ }).click();
	await page.evaluate(() => {
		const request = window.lidarFixture.requests.at(-1);
		if (request.action !== 'save' || request.destination !== 'device') throw Error('Wrong local save');
		const scans = [
			{ scanId: request.scanId, createdAt: '2026-11-12T01:00:00Z', byteCount: 11360000000, frameCount: 40, available: true, deviceSaved: true, isPartial: true }
		];
		window.lidarFixture.setStatus({ state: 'idle', scans });
		window.lidarFixture.reply(request, { state: 'device-saved', scanId: request.scanId, scans });
	});
	await card.getByText('Device only · 10.6 GiB · Partial', { exact: true }).waitFor();
	assert.deepEqual((await readActions(page)).slice(before), ['save']);
	await card.click({ button: 'right' });
	await page.getByRole('menuitem', { name: /Save to Thingtime/ }).click();
	assert.ok(await page.getByRole('menu').last().evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }));
	await page.screenshot({ path: join(evidence, profile + '-cloud-save-menu.png'), fullPage: true });
	await page.getByRole('menuitem', { name: /Cloud/ }).click();
	await page.evaluate(() => {
		const request = window.lidarFixture.requests.at(-1);
		if (request.action !== 'save' || request.destination !== 'cloud') throw Error('Wrong cloud save');
		window.lidarFixture.reply(request, { state: 'saving', scanId: request.scanId });
	});
	await panel.getByRole('status', { name: 'Saving LiDAR scan' }).waitFor();
	assert.equal(await page.locator('.ttLidarIndicator').count(), 1);
	assert.equal(await card.count(), 1);
	await page.evaluate(() => {
		const request = window.lidarFixture.requests.at(-1);
		const scans = [{ scanId: request.scanId, createdAt: '2026-11-12T01:00:00Z', byteCount: 11360000000, frameCount: 40, available: true, deviceSaved: true, isPartial: true, fileThingId: request.scanId }];
		window.lidarFixture.reply(request, { state: 'saved', scanId: request.scanId, fileThingId: request.scanId, scans });
	});
	await card.getByText('Cloud · 10.6 GiB · Partial', { exact: true }).waitFor();
	assert.equal(await card.getByRole('button', { name: 'Save this scan', exact: true }).count(), 0);
	await page.getByRole('combobox', { name: 'Scan view' }).selectOption('list');
	await card.waitFor();
	await page.getByRole('textbox', { name: 'Search LiDAR scans' }).fill('no match');
	await page.getByText('No scans match your search.').waitFor();
	await page.getByRole('textbox', { name: 'Search LiDAR scans' }).fill('');
	await card.waitFor();
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
	await page.screenshot({ path: join(evidence, profile + '-library.png'), fullPage: true });
	await page.getByText('End of Things').scrollIntoViewIfNeeded();
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
	await page.reload();
	await page.getByRole('heading', { name: 'My LiDAR scans', exact: true }).waitFor();
	await card.getByRole('button', { name: 'Save this scan', exact: true }).waitFor();
	await page.evaluate(() => window.lidarFixture.changeIdentity());
	await card.waitFor({ state: 'detached' });
	assert.equal((await readActions(page)).at(-1), 'suspend');
	assert.deepEqual(errors, []);
	await page.goto(origin + '/lidar-fixture?mode=outdated');
	await page.getByText('Update the Thingtime iOS app to browse all scans and choose Device only or Cloud.').waitFor();
	assert.equal(await page.getByRole('button', { name: 'Scan with LiDAR', exact: true }).count(), 0);
}

async function exerciseBrowserFallback() {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
		userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
	try {
		await context.route(browserOrigin + '/**', async route => {
			const { pathname, search } = new URL(route.request().url());
			if (pathname === '/.well-known/thingtime-capabilities.json') return route.fulfill({ json: manifest(browserOrigin) });
			if (pathname === '/api/v1/webpages/resolve') return route.fulfill({ status: 404, json: { ok: false } });
			const response = await route.fetch({ url: origin + pathname + search });
			await route.fulfill({ response });
		});
		const page = await context.newPage();
		await page.goto(browserOrigin + '/lidar-fixture?mode=browser');
		await page.getByRole('button', { name: 'Open Thingtime scanner' }).waitFor();
		assert.equal(await page.evaluate(() => window.lidarFixture.appLink()), 'thingtime://scan/lidar?origin=https%3A%2F%2Flidar-scan-fixture.invalid');
		assert.deepEqual(await readActions(page), []);
		await page.screenshot({ path: join(evidence, 'mobile-browser-handoff.png') });
	} finally { await context.close(); }
}
