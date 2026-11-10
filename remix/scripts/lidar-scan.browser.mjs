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
	let layout;
	await page.route('**/api/v1/webpages/resolve?*', route => route.fulfill(layout ? { json: { ok: true, source: 'user', page: layout } } : { status: 404, json: { ok: false } }));
	await page.route('**/api/v1/things', route => {
		const request = route.request();
		assert.equal(request.method(), 'POST');
		assert.equal(request.headers()['x-thingtime-expected-actor'], 'fixture-lidar-owner');
		assert.equal(request.headers()['x-thingtime-expected-data-plane'], 'home');
		const body = request.postDataJSON();
		assert.deepEqual(body.acl, ['tt:user']);
		assert.equal(body.crystal.pageKey, 'settings-lidar-scan-controls');
		layout = { id: 'fixture-layout', updatedAt: new Date().toISOString(), author: { id: 'fixture-lidar-owner' }, ...body };
		return route.fulfill({ json: { ok: true, thing: layout } });
	});
	const panel = page.getByRole('region', { name: 'LiDAR scan' });
	const start = panel.getByRole('button', { name: 'Scan with LiDAR' });
	const capture = page.getByRole('button', { name: 'Builder scan action', exact: true });
	await page.goto(origin + '/lidar-fixture');
	await start.waitFor();
	assert.deepEqual(await readActions(page), ['status']);
	await capture.evaluate(button => button.click());
	await page.getByRole('button', { name: 'Builder scan with unknown arguments' }).click();
	assert.deepEqual(await readActions(page), ['status']);
	await capture.press('Enter');
	assert.deepEqual(await readActions(page), ['status', 'start']);
	await page.evaluate(() => {
		const request = window.lidarFixture.requests.at(-1);
		window.lidarFixture.reply(request, { state: 'capturing', scanId: request.requestId });
	});
	await panel.getByText('The scanner is open in Thingtime.').waitFor();
	await page.evaluate(() => {
		const request = window.lidarFixture.requests.at(-1);
		window.lidarFixture.reply(request, { state: 'saving', scanId: request.requestId });
	});
	const busy = panel.getByRole('status', { name: 'Saving LiDAR scan' });
	await busy.waitFor();
	assert.equal(await panel.locator('.ttLidarIndicator').count(), 1);
	assert.equal(await busy.evaluate(element => getComputedStyle(element).animationName), 'none');
	await page.evaluate(() => {
		const request = window.lidarFixture.requests.at(-1);
		window.lidarFixture.setStatus({ state: 'pending', scanId: request.requestId });
		document.dispatchEvent(new Event('visibilitychange'));
		window.lidarFixture.reply(request, { state: 'saved', scanId: request.requestId, fileThingId: request.requestId });
	});
	await panel.getByText('Saved on this device. Retry to finish saving to Things.').waitFor();
	await panel.getByRole('button', { name: 'Retry save' }).click();
	const fileId = randomUUID();
	await page.evaluate(fileThingId => {
		const request = window.lidarFixture.requests.at(-1);
		const state = { state: 'saved', scanId: request.scanId, fileThingId, isPartial: true, detail: 'The capture was interrupted.' };
		window.lidarFixture.reply(request, { ...state, ownerId: 'other-owner' });
		window.lidarFixture.reply(request, state);
		window.lidarFixture.reply(request, state);
	}, fileId);
	const saved = panel.getByRole('link', { name: 'Open saved scan' });
	await saved.waitFor();
	await panel.getByText('Partial scan saved to your private Things. The capture was interrupted.').waitFor();
	assert.equal(await saved.getAttribute('href'), '/thing/' + fileId + '?from=things');
	assert.deepEqual(await readActions(page), ['status', 'start', 'status', 'retry']);
	assert.equal(await page.evaluate(() => window.lidarFixture.savedNotifications()), 1);
	assert.equal(await panel.locator('.ttLidarIndicator').count(), 0);
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
	await page.screenshot({ path: join(evidence, profile + '-saved.png'), fullPage: true });
	await page.getByText('End of Things').scrollIntoViewIfNeeded();
	assert.ok(await page.evaluate(() => scrollY > 0 && document.documentElement.scrollWidth <= innerWidth + 1));

	const nativeScan = randomUUID();
	await page.evaluate(scanId => {
		window.lidarFixture.setStatus({ state: 'pending', scanId });
		window.lidarFixture.announceNativeChange({ ownerId: 'different-owner' });
		window.lidarFixture.announceNativeChange({ origin: 'https://different.invalid' });
	}, nativeScan);
	assert.deepEqual(await readActions(page), ['status', 'start', 'status', 'retry']);
	await page.evaluate(() => window.lidarFixture.announceNativeChange());
	await panel.getByRole('button', { name: 'Retry save' }).click();
	await page.evaluate(scanId => {
		const request = window.lidarFixture.requests.at(-1);
		if (request.scanId !== scanId) throw new Error('Retry changed the native scan identity');
		window.lidarFixture.reply(request, { state: 'saved', scanId, fileThingId: scanId });
	}, nativeScan);
	await saved.waitFor();
	assert.deepEqual(await readActions(page), ['status', 'start', 'status', 'retry', 'status', 'retry']);

	const host = page.locator('[data-settings-document="lidar-scan-controls"]');
	await enableCurrentPageBuilder(page);
	await host.getByRole('button', { name: 'Edit scan layout' }).click();
	await host.getByRole('button', { name: 'Open Builder inspector' }).click();
	const selector = page.getByRole('combobox', { name: 'Select block' });
	const text = page.getByRole('textbox', { name: 'Block text' });
	for (const [id, label] of [['lidar-title', 'Editable room scan'], ['lidar-start', 'Capture this room']]) {
		await selector.selectOption(id);
		await text.fill(label);
		await text.blur();
	}
	await page.getByRole('button', { name: 'Close builder' }).click();
	await Promise.all([
		page.waitForResponse(response => response.url().endsWith('/api/v1/things') && response.request().method() === 'POST'),
		host.getByRole('button', { name: 'Save layout', exact: true }).click()
	]);
	assert.equal(flatten(layout.crystal.blocks).find(block => block.id === 'lidar-title').text, 'Editable room scan');
	assert.equal(flatten(layout.crystal.blocks).find(block => block.id === 'lidar-start').text, 'Capture this room');
	await page.reload();
	await panel.getByRole('heading', { name: 'Editable room scan' }).waitFor();
	await panel.getByRole('button', { name: 'Capture this room' }).click();
	await page.evaluate(() => window.lidarFixture.changeIdentity());
	await panel.waitFor({ state: 'detached' });
	assert.deepEqual(await readActions(page), ['status', 'start', 'suspend']);
	assert.deepEqual(errors, []);
	await page.goto(origin + '/lidar-fixture?mode=unsupported');
	await panel.getByText('LiDAR scanning requires a supported iPhone or iPad.').waitFor();
	assert.equal(await panel.getByRole('button', { name: 'Capture this room' }).count(), 0);
	await page.goto(origin + '/lidar-fixture?mode=outdated');
	await panel.getByText('Update the Thingtime iOS app to use LiDAR scanning.').waitFor();
	assert.deepEqual(await readActions(page), []);
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
