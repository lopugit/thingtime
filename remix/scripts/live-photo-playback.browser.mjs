import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const output = await mkdtemp(join(tmpdir(), 'tt-live-photo-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-live-photo-playback-evidence'));
const port = Number(process.env.TT_LIVE_PHOTO_PORT || 23874);
const origin = `http://127.0.0.1:${port}`;
let server, browser, denyStill = false;
try {
	await mkdir(evidence, { recursive: true });
	await createRequire(require.resolve('tsx'))('esbuild').build({ entryPoints: [join(root, 'scripts/live-photo-playback.fixture.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(output, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.wasm': 'dataurl' }, logLevel: 'error' });
	server = createServer(async (request, response) => {
		try {
			if (request.url?.startsWith('/api/v1/attachments/content?')) {
				const id = new URL(request.url, origin).searchParams.get('id');
				if (id === 'still' && denyStill) { response.writeHead(403); response.end(); return; }
				const video = id === 'motion' || id === 'ordinary' || id === 'hiddenmotion';
				response.setHeader('Cache-Control', 'no-store');
				response.setHeader('Content-Type', video ? 'video/mp4' : 'image/jpeg');
				response.end(await readFile(join(root, `scripts/fixtures/live-photo-${video ? 'motion.mp4' : 'still.jpeg'}`)));
				return;
			}
			if (request.url === '/.well-known/thingtime-capabilities.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ origin, schemaVersion: 1, features: { 'api.attachment-content': { version: '1.99.0' } } })); return; }
			if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(output, 'fixture.js'))); return; }
			if (request.url === '/still.jpeg') { response.setHeader('Content-Type', 'image/jpeg'); response.end(await readFile(join(root, 'scripts/fixtures/live-photo-still.jpeg'))); return; }
			if (request.url === '/motion.mp4') { response.setHeader('Content-Type', 'video/mp4'); response.end(await readFile(join(root, 'scripts/fixtures/live-photo-motion.mp4'))); return; }
			response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>[LC] Live Photo playback</title><div id="root"></div><script type="module" src="/fixture.js"></script>');
		} catch { response.writeHead(404); response.end(); }
	});
	server.listen(port, '127.0.0.1'); await once(server, 'listening');
	const runtime = process.env.TT_PLAYWRIGHT_MODULE ? await import(process.env.TT_PLAYWRIGHT_MODULE) : require('playwright');
	const browserName = process.env.TT_PLAYWRIGHT_BROWSER || 'chromium';
	assert.ok(['chromium', 'webkit'].includes(browserName), 'Use chromium or webkit');
	browser = await runtime[browserName].launch({ headless: true, ...(browserName === 'chromium' ? { chromiumSandbox: true } : {}) });
	for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
		const page = await browser.newPage({ viewport, hasTouch: name === 'mobile' });
		const errors = []; page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(origin);
		const control = page.locator('[data-testid=live] [data-live-photo]'); await control.waitFor({ timeout: 5000 }).catch(async (error) => { console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 1000) }); throw error; });
		await page.waitForFunction(() => document.querySelector('[data-live-photo] img')?.naturalWidth > 0);
		const gallery = page.getByTestId('gallery');
		assert.equal(await gallery.locator('[data-live-photo]').count(), 1);
		assert.equal(await gallery.getByRole('button', { name: /View ordinary/ }).count(), 1);
		assert.equal(await gallery.getByText('NSFW').count(), 1);
		const bounds = await control.boundingBox(); assert.ok(bounds);
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		await page.mouse.down(); await page.waitForTimeout(500);
		await page.waitForFunction(() => { const video = document.querySelector('[data-live-photo] video'); return video && !video.paused && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime > 0; });
		assert.equal(await control.getAttribute('data-playing'), 'true');
		await page.mouse.up();
		await page.waitForFunction(() => document.querySelector('[data-live-photo] video')?.paused);
		assert.equal(await page.getByTestId('opens').textContent(), '0');
		await control.click(); assert.equal(await page.getByTestId('opens').textContent(), '1');
		await control.focus(); await page.keyboard.down('Space'); await page.waitForTimeout(500);
		await page.waitForFunction(() => !document.querySelector('[data-live-photo] video')?.paused);
		await page.keyboard.up('Space');
		assert.equal(await page.getByTestId('opens').textContent(), '1');
		if (name === 'mobile') {
			await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
			assert.equal(await page.getByTestId('opens').textContent(), '2');
			// Chromium exposes trusted long-touch input through CDP. WebKit still
			// exercises touch tap, held pointer playback, keyboard and mobile layout.
			if (browserName === 'chromium') {
			const touch = await page.context().newCDPSession(page);
			const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
			await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
			await page.waitForTimeout(500);
			await page.waitForFunction(() => !document.querySelector('[data-live-photo] video')?.paused);
			await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await page.waitForFunction(() => document.querySelector('[data-live-photo] video')?.paused);
			assert.equal(await page.getByTestId('opens').textContent(), '2');
			}
		}
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForFunction(() => document.querySelector('[data-live-photo] video')?.paused);
		await gallery.scrollIntoViewIfNeeded();
		await page.screenshot({ path: join(evidence, `${name}-gallery.png`), fullPage: true });
		const galleryLive = gallery.locator('[data-live-photo]').first();
		const galleryBounds = await galleryLive.boundingBox(); assert.ok(galleryBounds);
		await page.mouse.move(galleryBounds.x + galleryBounds.width / 2, galleryBounds.y + galleryBounds.height / 2);
		await page.mouse.down(); await page.waitForTimeout(500);
		await page.waitForFunction(() => { const video = document.querySelector('[data-testid=gallery] [data-live-photo] video'); return video && !video.paused && video.readyState >= 2 && video.videoWidth > 0; });
		await page.mouse.up();
		assert.equal(await page.getByRole('dialog').count(), 0);
		await galleryLive.click();
		await page.getByRole('dialog').waitFor();
		assert.equal(await page.getByRole('link', { name: /Download Live Photo motion/ }).count(), 1);
		const lightboxLive = page.getByRole('dialog').locator('[data-live-photo]');
		await page.screenshot({ path: join(evidence, `${name}-lightbox.png`) });
		const lightboxVideo = await lightboxLive.locator('video').elementHandle();
		const lightboxBounds = await lightboxLive.boundingBox(); assert.ok(lightboxBounds);
		await page.mouse.move(lightboxBounds.x + lightboxBounds.width / 2, lightboxBounds.y + lightboxBounds.height / 2);
		await page.mouse.down(); await page.waitForTimeout(500);
		await page.waitForFunction(() => { const video = document.querySelector('[role=dialog] [data-live-photo] video'); return video && !video.paused && video.readyState >= 2 && video.videoWidth > 0; });
		await page.mouse.up();
		await page.waitForFunction(() => document.querySelector('[role=dialog] [data-live-photo] video')?.paused);
		await page.getByRole('button', { name: 'Close media popup' }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		assert.equal(await lightboxVideo.evaluate((video) => video.paused), true);
		await gallery.getByRole('button', { name: 'Show Anyway' }).click();
		assert.equal(await gallery.locator('[data-live-photo]').count(), 2);
		if (name === 'desktop') {
			denyStill = true;
			await page.reload();
			await page.getByTestId('gallery').locator('[data-live-photo]').first().click();
			await page.getByRole('button', { name: 'Retry still photo' }).waitFor();
			denyStill = false;
			await page.getByRole('button', { name: 'Retry still photo' }).click();
			await page.waitForFunction(() => document.querySelector('[role=dialog] [data-live-photo] img')?.naturalWidth > 0);
			await page.getByRole('button', { name: 'Close media popup' }).click();
		}
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.deepEqual(errors, []);
		console.log(`${name}: decoded held playback, feed/lightbox, release, tap, keyboard, scroll, layout passed`);
		await page.close();
	}
	console.log(`evidence: ${evidence}`);
} finally { await browser?.close(); server?.close(); await rm(output, { recursive: true, force: true }); }
