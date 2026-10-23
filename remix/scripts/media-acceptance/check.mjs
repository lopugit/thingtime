import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mediaWorkerCsp, platformRuntimeCsp } from '../csp.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(appRoot, 'tmp/media-acceptance'),
	port = 18641;
const server = createServer(async (req, res) => {
	try {
		const path = new URL(req.url, 'http://127.0.0.1').pathname;
		if (path === '/redirect') {
			res.writeHead(302, { location: 'https://example.com' });
			return res.end();
		}
		const file = path.startsWith('/platform/')
			? resolve(appRoot, 'dist', '.' + path)
			: resolve(root, 'built', '.' + (path === '/' ? '/index.html' : path));
		if (!file.startsWith(resolve(appRoot, 'dist/platform') + '/') && !file.startsWith(root + '/built/')) throw Error('path');
		if (/^\/assets\/mediaWorker-[A-Za-z0-9_-]+\.js$/.test(path)) res.setHeader('content-security-policy', mediaWorkerCsp);
		if (path === '/platform/runtime.html') res.setHeader('content-security-policy', platformRuntimeCsp);
		res.setHeader('content-type', extname(file) === '.js' ? 'text/javascript' : 'text/html');
		res.end(await readFile(file));
	} catch {
		res.statusCode = 404;
		res.end();
	}
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
// Fail closed before any browser launch: both direct IP and redirected outbound
// requests must be refused by the inherited OS sandbox, not route interception.
await new Promise((resolve, reject) => {
	const socket = createConnection({ host: '1.1.1.1', port: 443 });
	socket.on('connect', () => {
		socket.destroy();
		reject(Error('Outbound boundary failed'));
	});
	socket.on('error', (e) => {
		assert.ok(['EPERM', 'EACCES'].includes(e.code));
		resolve();
	});
	socket.setTimeout(3000, () => {
		socket.destroy();
		reject(Error('Boundary was not proven'));
	});
});
await assert.rejects(fetch(`http://127.0.0.1:${port}/redirect`, { signal: AbortSignal.timeout(5000) }));
const browser = await chromium.launch({ executablePath: process.env.CHROME_FOR_TESTING_PATH || chromium.executablePath(), headless: false });
let context;
try {
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
	await context.tracing.start({ screenshots: true, snapshots: true });
	const probe = await context.newPage();
	await assert.rejects(probe.goto('https://1.1.1.1', { timeout: 7000 }));
	await probe.close();
	console.log('OS isolation preflight passed for backend, redirects and browser.');
	const page = await context.newPage();
	page.setDefaultTimeout(20000);
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto(`http://127.0.0.1:${port}`);
	console.log('Fixture loaded');
	await page.getByLabel('Output format (mp4 or webm)').fill('webm');
	await page.getByLabel('Maximum width', { exact: true }).fill('640');
	await page.getByLabel('Maximum height', { exact: true }).fill('360');
	await page.getByLabel('Video bitrate (bits/second)', { exact: true }).fill('350000');
	await page.getByRole('button', { name: 'Run example', exact: true }).click();
	const frame = page.frameLocator('iframe');
	await frame.locator('#media-file').setInputFiles(root + '/source.mp4');
	await frame.getByRole('button', { name: 'Start', exact: true }).click();
	await frame
		.locator('#media-status')
		.filter({ hasText: /Complete|cannot|failed|unexpected|not expose/ })
		.waitFor({ timeout: 120000 });
	console.log('ENCODE_STATUS', await frame.locator('#media-status').innerText());
	console.log('RECEIPT', await page.getByLabel('Execution result').innerText());
	const link = page.getByRole('link', { name: 'Download output', exact: true });
	await link.waitFor();
	const pending = page.waitForEvent('download');
	await link.click();
	const download = await pending;
	await download.saveAs(root + '/output.webm');
	await frame.locator('video').evaluate((v) => v.play());
	await page.waitForTimeout(500);
	assert.ok((await frame.locator('video').evaluate((v) => v.currentTime)) > 0);
	await frame.locator('video').evaluate((v) => v.pause());
	await page.evaluate(() => scrollTo(0, 0));
	await frame.locator('body').evaluate(() => scrollTo(0, 0));
	await page.waitForTimeout(300);
	console.log('FRAME_BOUNDS', await frame.locator('#media-tool').boundingBox());
	await page.screenshot({ path: root + '/desktop.png', fullPage: true });
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 600) {
			await page.evaluate((y) => scrollTo(0, y), y);
			await page.waitForTimeout(50);
		}
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		await page.getByText('Edit reusable program', { exact: true }).click();
		await page.getByLabel('Web Platform program').scrollIntoViewIfNeeded();
		const bounds = await frame.locator('#media-tool').boundingBox();
		assert.ok(bounds.width > width / 6);
		await frame.locator('body').evaluate(() => scrollTo(0, document.body.scrollHeight));
		await frame.locator('body').evaluate(() => scrollTo(0, 0));
		await page.evaluate(() => scrollTo(0, 0));
		await page.waitForTimeout(300);
		await page.screenshot({ path: root + `/layout-${width}.png`, fullPage: true });
		await page.getByText('Edit reusable program', { exact: true }).click();
	}
	await frame.locator('#media-file').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not video') });
	assert.equal(await link.count(), 0);
	await frame.getByRole('button', { name: 'Start', exact: true }).click();
	await frame
		.locator('#media-status')
		.filter({ hasText: /unsupported|unrecognizable/ })
		.waitFor();
	console.log('INVALID_STATUS', await frame.locator('#media-status').innerText());
	await frame.locator('#media-file').setInputFiles(root + '/source.mp4');
	await frame.getByRole('button', { name: 'Start', exact: true }).click();
	await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
	assert.match(await frame.locator('#media-status').innerText(), /Canceled/);
	await page.waitForTimeout(500);
	assert.equal(await link.count(), 0);
	await page.getByRole('button', { name: 'Stop / clear', exact: true }).click();
	assert.equal(await page.locator('iframe').count(), 0);
	for (const [format, audio] of [
		['mp4', 'keep'],
		['webm', 'remove']
	]) {
		await page.getByLabel('Output format (mp4 or webm)').fill(format);
		await page.getByLabel('Audio (keep or remove)', { exact: true }).fill(audio);
		await page.getByRole('button', { name: 'Run example', exact: true }).click();
		await frame.locator('#media-file').setInputFiles(root + '/source.mp4');
		await frame.getByRole('button', { name: 'Start', exact: true }).click();
		await frame
			.locator('#media-status')
			.filter({ hasText: /Complete|cannot|failed|unexpected|not expose/ })
			.waitFor({ timeout: 120000 });
		console.log(format, audio, await frame.locator('#media-status').innerText());
		await link.waitFor();
		const pending = page.waitForEvent('download');
		await link.click();
		await (await pending).saveAs(root + `/output-${audio}.${format}`);
		const saved = JSON.parse(await page.locator('input[name="program"]').inputValue());
		assert.equal(saved.parameters.find((p) => p.name === 'format').default, format);
		assert.equal(saved.parameters.find((p) => p.name === 'audio').default, audio);
		await page.getByRole('button', { name: 'Stop / clear', exact: true }).click();
	}
	// An independent decoder verifies container, codec, dimensions and audio tracks.
	for (const [name, video, audio] of [
		['output.webm', 'vp9', 'opus'],
		['output-keep.mp4', 'h264', 'aac'],
		['output-remove.webm', 'vp9', null]
	]) {
		const probe = JSON.parse(
			execFileSync(
				'ffprobe',
				[
					'-v',
					'error',
					'-show_entries',
					'stream=codec_name,codec_type,width,height',
					'-show_entries',
					'format=duration,size',
					'-of',
					'json',
					root + '/' + name
				],
				{ encoding: 'utf8' }
			)
		);
		const videoTrack = probe.streams.find((s) => s.codec_type === 'video'),
			audioTrack = probe.streams.find((s) => s.codec_type === 'audio');
		assert.equal(videoTrack.codec_name, video);
		assert.equal(videoTrack.width, 640);
		assert.equal(videoTrack.height, 360);
		assert.equal(audioTrack?.codec_name, audio || undefined);
		assert.ok(Number(probe.format.duration) >= 4);
		console.log('INDEPENDENT_PROBE', name, probe);
	}
	assert.deepEqual(errors, []);
	console.log('ACCEPTANCE_PASS');
} finally {
	await context?.tracing.stop({ path: root + '/trace.zip' });
	await browser.close();
	await new Promise((r) => server.close(r));
}
