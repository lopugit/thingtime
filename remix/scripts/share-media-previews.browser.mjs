/** Actual components and decoded media; synthetic authorized HTTP responses. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, 'package.json'));
const build = await mkdtemp(join(tmpdir(), 'thingtime-share-previews-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-share-preview-evidence'));
const port = Number(process.env.TT_SHARE_PREVIEW_PORT || 23873), origin = `http://127.0.0.1:${port}`;
let server, browser;
try {
	await mkdir(evidence, { recursive: true });
	const png = await require('sharp')({ create: { width: 640, height: 480, channels: 3, background: '#59bdff' } }).png().toBuffer();
	execFileSync(process.env.FFMPEG || 'ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=12', '-t', '1', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', join(build, 'video.webm')]);
	await createRequire(require.resolve('tsx'))('esbuild').build({ entryPoints: [join(root, 'scripts/share-media-previews.fixture.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(build, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' } });
	server = createServer(async (request, response) => {
		try {
			if (request.url === '/poster.png') { response.setHeader('Content-Type', 'image/png'); response.end(png); return; }
			if (request.url === '/video.webm') { response.setHeader('Content-Type', 'video/webm'); response.end(await readFile(join(build, 'video.webm'))); return; }
			if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(build, 'fixture.js'))); return; }
			if (request.url === '/media-cache-sw.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end('self.addEventListener("install",()=>self.skipWaiting())'); return; }
			response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>[LC] Shared media preview test</title><div id="root"></div><script type="module" src="/fixture.js"></script>');
		} catch { response.writeHead(404); response.end(); }
	});
	server.listen(port, '127.0.0.1'); await once(server, 'listening');
	const { chromium } = process.env.TT_PLAYWRIGHT_MODULE ? await import(process.env.TT_PLAYWRIGHT_MODULE) : createRequire(join(root, '../MCP/package.json'))('playwright');
	browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
	const results = [];
	for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
		const context = await browser.newContext({ viewport, hasTouch: name === 'mobile', reducedMotion: 'reduce' });
		const page = await context.newPage(), reads = [], errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.clock.install();
		await page.route('**/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: { origin, schemaVersion: 1, features: { 'api.attachment-content': { version: '1.99.0' } } } }));
		let mode = 'normal';
		const held = [];
		await page.route('**/api/v1/attachments/content?*', route => {
			const params = new URL(route.request().url()).searchParams;
			reads.push(Object.fromEntries(params));
			assert.equal(params.get('character'), 'fixture');
			if (mode === 'denied') return route.fulfill({ status: 403 });
			if (mode === 'stalled' && params.has('width') && params.get('width') !== '64') { held.push(route); return; }
			return route.fulfill({ contentType: 'image/png', body: png });
		});
		const sharp = page.getByTestId('image').locator('img').last();
		const decoded = () => page.waitForFunction(() => { const image = document.querySelector('[data-testid=image] img:last-of-type'); return image?.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1'; });
		await page.goto(origin); await decoded().catch(async error => { console.error(JSON.stringify({ reads, errors, html: (await page.locator('body').innerHTML()).slice(0, 1800) })); throw error; });
		assert.equal(await sharp.getAttribute('loading'), 'eager');
		assert.equal(reads.some(read => read.id === 'lazy'), false);
		await page.getByTestId('poster').locator('img').waitFor();
		assert.equal(await page.getByTestId('poster').locator('video').count(), 0);
		await page.waitForFunction(() => { const v = document.querySelector('[data-testid=video] video'); return v?.readyState >= 2 && v.videoWidth > 0 && v.paused; }).catch(async error => { console.error(await page.locator('[data-testid=video] video').evaluate(v => ({ readyState:v.readyState,networkState:v.networkState,currentTime:v.currentTime,duration:v.duration,paused:v.paused,error:v.error?.message,src:v.currentSrc }))); throw error; });
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.getByTestId('lazy').locator('img').last().waitFor();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
		mode = 'stalled'; await page.goto(origin); await sharp.waitFor();
		await page.clock.fastForward(31_000); await decoded();
		assert.ok(reads.some(read => read.id === 'photo' && !read.width));
		for (const route of held.splice(0)) await route.abort().catch(() => {});
		mode = 'denied'; await page.getByRole('button', { name: 'Change image' }).click();
		await page.getByRole('button', { name: 'Retry Shared photo' }).waitFor();
		assert.equal(await page.getByTestId('image').locator('img').count(), 0);
		mode = 'normal'; await page.getByRole('button', { name: 'Retry Shared photo' }).click(); await decoded();
		assert.deepEqual(errors, []); results.push({ name, passed: true, checks: ['decoded sharp image', 'native poster is image', 'paused video frame', 'lazy scroll', 'stalled variant fallback', 'identity reset', 'error/retry', 'no overflow'] });
		await context.close();
	}
	await writeFile(join(evidence, 'results.json'), JSON.stringify({ source: 'actual React components with synthetic HTTP and media', results }, null, 2));
	console.log(JSON.stringify({ evidence, results }));
} finally { await browser?.close(); server?.close(); await rm(build, { recursive: true, force: true }); }
