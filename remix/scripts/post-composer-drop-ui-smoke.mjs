import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
// Run against a local dev stack. Every API write is intercepted in a fresh
// browser context; fixture upload completion does not prove object-store I/O.
const origin = process.env.TT_POST_DROP_ORIGIN || 'http://localhost:11130';
const parsedOrigin = new URL(origin);
assert.ok(['localhost', '127.0.0.1'].includes(parsedOrigin.hostname) && parsedOrigin.protocol === 'http:');
const output = await mkdtemp(join(tmpdir(), 'thingtime-post-drop-'));
const root = await (await fetch(origin + '/api/root-data')).json();
const user = {
	id: 'drop-fixture',
	username: 'drop-fixture',
	accountKind: 'user',
	displayName: 'Drop fixture',
	emailVerified: true,
	publicUploadsEnabled: true,
	privateUploadsEnabled: true,
	storage: { status: 'ready', remainingBytes: 524288000 }
};
root.user = user;
const starts = [],
	completes = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
await context.route('**/api/**', async (route) => {
	const req = route.request(),
		path = new URL(req.url()).pathname;
	if (!path.startsWith('/api/')) return route.continue();
	const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
	if (path === '/api/root-data') return json(root);
	if (path === '/api/v1/auth/me') return json({ ok: true, user });
	if (path === '/api/v1/attachments/uploads') {
		const data = req.postDataJSON();
		const id = 'fixture-' + starts.length;
		starts.push({ ...data, id });
		return json({ ok: true, upload: { id, state: 'ready', partSizeBytes: 1048576, partCount: 1 } });
	}
	if (path === '/api/v1/attachments/uploads/complete') {
		const { uploadId } = req.postDataJSON();
		const f = starts.find((f) => f.id === uploadId);
		completes.push(uploadId);
		return json({ ok: true, attachment: { id: f.id, name: f.filename, contentType: f.contentType, size: f.sizeBytes } });
	}
	if (path === '/api/v1/attachments/content') return route.fulfill({ status: 200, contentType: 'image/png', body: png });
	if (!['GET', 'HEAD'].includes(req.method())) return json({ ok: true });
	if (path === '/api/v1/things') return json({ ok: true, things: [], posts: [], hasMore: false });
	if (path === '/api/v1/subspaces') return json({ ok: true, subspaces: [] });
	return json({ ok: true });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const drop = async (selector, name = 'drop.txt', type = 'text/plain') => {
	await page
		.locator(selector)
		.first()
		.evaluate(
			(el, { name, type }) => {
				const d = new DataTransfer();
				d.items.add(new File(['synthetic file'], name, { type }));
				el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: d }));
				el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d }));
			},
			{ name, type }
		);
};
const waitUploads = async (n) => {
	await page.waitForFunction(() => ![...document.querySelectorAll('[role="list"]')].some((e) => /Uploading|Preparing|Verifying/.test(e.textContent)));
	for (let i = 0; i < 100 && completes.length < n; i++) await new Promise((r) => setTimeout(r, 100));
	assert.equal(starts.length, n);
	assert.equal(completes.length, n);
};
try {
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(origin + '/feed');
		await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).waitFor();
		let n = starts.length;
		await drop('button:has-text("What\'s on your mind?")', 'collapsed.txt');
		await waitUploads(++n);
		const composer = page.locator('[data-editor-scope="post-composer"]');
		assert.equal(await composer.getByRole('button', { name: '🖼️ Photos', exact: true }).getAttribute('aria-pressed'), 'true');
		await composer.getByRole('button', { name: 'Close composer', exact: true }).click();
		await drop('button:has-text("What\'s on your mind?")', 'reopened.txt');
		await waitUploads(++n);
		await composer.getByRole('button', { name: '📝 Text', exact: true }).click();
		await composer.getByRole('button', { name: '🏪 Marketplace', exact: true }).click();
		await composer.getByRole('button', { name: '📦 Things', exact: true }).click();
		await page.getByPlaceholder('What are you selling?').fill('Keep my listing');
		await drop('[data-editor-scope="post-composer"] [contenteditable="true"]', 'image.png', 'image/png');
		await waitUploads(++n);
		for (const name of ['🖼️ Photos', '🏪 Marketplace', '📦 Things'])
			assert.equal(await composer.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'), 'true');
		assert.equal(await page.getByPlaceholder('What are you selling?').inputValue(), 'Keep my listing');
		await drop('[data-attachment-drop-zone]', 'inside.txt');
		await waitUploads(++n);
		await drop('[data-editor-scope="post-composer"] [contenteditable="true"]', 'outside.wav', 'audio/wav');
		await waitUploads(++n);
		assert.equal(await page.getByRole('group', { name: 'Post attachments', exact: true }).count(), 1);
		await composer.getByRole('button', { name: '🗳️ Poll', exact: true }).click();
		await page.getByPlaceholder('Option 1').fill('Keep option one');
		await drop('[data-editor-scope="post-composer"] [contenteditable="true"]', 'poll.txt');
		await waitUploads(++n);
		assert.equal(await composer.getByRole('button', { name: '🗳️ Poll', exact: true }).getAttribute('aria-pressed'), 'true');
		assert.equal(await composer.getByRole('button', { name: '🖼️ Photos', exact: true }).getAttribute('aria-pressed'), 'true');
		assert.equal(await page.getByPlaceholder('Option 1').inputValue(), 'Keep option one');
		await page.screenshot({ path: join(output, `post-drop-${width}.png`), fullPage: true });
		const height = await page.evaluate(() => document.documentElement.scrollHeight);
		for (let y = 0; y < height; y += 650) {
			await page.evaluate((y) => window.scrollTo(0, y), y);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		}
		console.log(JSON.stringify({ width, uploadStarts: starts.length, completions: completes.length, modePreservation: true, overflow: false }));
	}
	console.log(`Screenshots: ${output}`);
} finally {
	await browser.close();
}
