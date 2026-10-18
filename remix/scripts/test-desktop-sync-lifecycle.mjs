import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';

const root = resolve(import.meta.dirname, '..'), port = 28188;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-desktop-sync-evidence'));
if (!process.env.TT_DESKTOP_SYNC_WORKER) {
	const dir = await mkdtemp(join(tmpdir(), 'thingtime-desktop-sync-'));
	try {
		const require = createRequire(join(root, '../MCP/package.json'));
		await require('esbuild').build({ entryPoints: [join(root, 'scripts/mobile-sync-editor.browser.tsx')], bundle: true,
			format: 'esm', platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
			define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
		const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir, TT_DESKTOP_SYNC_WORKER: dir };
		await verifyAccountBackupIsolation(port, env);
		const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename, evidence], { env, stdio: 'inherit' }, port, true);
		const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
		try { const [code] = await once(child, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timer); }
	} finally { await rm(dir, { recursive: true, force: true }); }
} else {
	const dir = process.env.TT_DESKTOP_SYNC_WORKER;
	const require = createRequire(join(root, '../MCP/package.json'));
	const { chromium } = require('playwright');
	const bundle = await readFile(join(dir, 'fixture.js'));
	const server = createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': req.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
		res.end(req.url === '/fixture.js' ? bundle : '<!doctype html><title>[QA] App-owned file sync</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
	});
	server.listen(port, '127.0.0.1'); await once(server, 'listening');
	let context;
	const errors = [], results = [];
	try {
		await mkdir(evidence, { recursive: true });
		context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, downloadsPath: join(dir, 'downloads'), acceptDownloads: false });
		let page = context.pages()[0]; page.on('pageerror', error => errors.push(error.message));
		const probe = await context.newPage(); await assert.rejects(probe.goto('http://192.0.2.1:443/blocked', { timeout: 3000 })); await probe.close();
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto(`http://127.0.0.1:${port}/?platform=desktop&tasks`);
		await page.getByRole('button', { name: 'Upload now', exact: true }).waitFor();
		await page.getByRole('button', { name: 'Hold accepted upload reply', exact: true }).click();
		await page.getByRole('button', { name: 'Hold next scan', exact: true }).click();
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByText('Checking both folders…', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
		await page.getByText('App transfer lease: active', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Release scan', exact: true }).click();
		// The remote receipt exists, but the renderer has never seen its reply.
		await page.waitForFunction(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders') || '[]').length === 1);
		const readJobs = () => page.evaluate(async () => {
			const db = await new Promise((resolve, reject) => { const request = indexedDB.open('thingtime-file-sync-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			try { return await new Promise((resolve, reject) => { const request = db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); }
		});
		const interrupted = (await readJobs())[0]; assert.equal(interrupted.state, 'runnable');
		const remoteBeforeRestart = await page.evaluate(() => localStorage.getItem('tt:fixture:sync-transfer-folders'));
		const restart = async (url) => {
			await context.close();
			context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, downloadsPath: join(dir, 'downloads'), acceptDownloads: false });
			page = context.pages()[0]; page.on('pageerror', error => errors.push(error.message));
			await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(url);
		};
		for (const refused of ['other-account', 'other-origin', 'revoked-root']) {
			await restart(`http://127.0.0.1:${port}/?platform=desktop&tasks&away&${refused}`);
			await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).waitFor();
			await page.waitForTimeout(500);
			assert.equal((await readJobs())[0].state, 'runnable', refused);
			assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), 0, refused);
			assert.equal(await page.evaluate(() => localStorage.getItem('tt:fixture:sync-transfer-folders')), remoteBeforeRestart, refused);
		}
		await restart(`http://127.0.0.1:${port}/?platform=desktop&tasks&away`);
		// Production bootstrap resumes while the Files view remains unmounted.
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).waitFor();
		await page.waitForFunction(async () => {
			const db = await new Promise(resolve => { const request = indexedDB.open('thingtime-file-sync-v1'); request.onsuccess = () => resolve(request.result); });
			try { return await new Promise(resolve => { const request = db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll(); request.onsuccess = () => resolve(request.result[0]?.state === 'complete'); }); } finally { db.close(); }
		});
		assert.equal((await readJobs())[0].id, interrupted.id);
		assert.equal(await page.evaluate(() => localStorage.getItem('tt:fixture:sync-transfer-folders')), remoteBeforeRestart);
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
		await page.getByText('Last transfer finished.', { exact: true }).waitFor();
		const first = await page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders')));
		assert.equal(first.length, 1); assert.equal(first[0].name, 'Upload sample');
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByRole('button', { name: 'Stop transfer', exact: true }).waitFor({ state: 'hidden' });
		assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders'))), first);
		// Cancel an interrupted app-owned scan through the reattached view.
		await page.getByRole('button', { name: 'Hold next scan', exact: true }).click();
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByText('Checking both folders…', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
		await page.getByRole('button', { name: 'Stop transfer', exact: true }).click();
		await page.getByText('Transfer stopped. Retry to recover saved work.', { exact: true }).waitFor();
		await page.getByText('App transfer lease: idle', { exact: true }).waitFor();
		assert.equal((await readJobs())[0].state, 'paused');
		await restart(`http://127.0.0.1:${port}/?platform=desktop&tasks&away`);
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).waitFor();
		await page.waitForTimeout(500);
		assert.equal((await readJobs())[0].state, 'paused');
		assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), 0);
		await page.goto(`http://127.0.0.1:${port}/?platform=desktop&tasks&capture&inspect&inventory`);
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByRole('button', { name: 'Save versions and ignore', exact: true }).waitFor();
		await page.getByRole('combobox').first().selectOption('local');
		await page.getByText('1 of 2 choices ready', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
		await page.getByText('App transfer lease: active', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
		await page.getByText('1 of 2 choices ready', { exact: true }).waitFor();
		assert.equal(await page.getByRole('combobox').first().inputValue(), 'local');
		for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
			await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
			let steps = 0;
			for (;;) {
				const m = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, y: scrollY, h: innerHeight, total: document.documentElement.scrollHeight }));
				assert.ok(m.sw <= m.w + 1, JSON.stringify(m)); if (m.y + m.h >= m.total - 1) break;
				assert.ok(steps++ < 60); await page.evaluate(() => scrollBy(0, innerHeight * .8));
			}
			await page.screenshot({ path: join(evidence, label + '-review.png'), fullPage: true }); results.push({ label, steps });
		}
		await page.getByRole('button', { name: 'Save versions and ignore', exact: true }).click();
		await page.getByText('App transfer lease: idle', { exact: true }).waitFor();
		await page.getByText('Captured versions: 2.', { exact: false }).waitFor();
		assert.deepEqual(errors, []);
		const result = { ok: true, checks: ['view-unmount-during-scan', 'complete-without-view', 'browser-restart-after-accepted-write-before-reply', 'same-job-and-operation-after-restart', 'durable-stop-does-not-auto-resume', 'other-account-origin-and-revoked-root-refused', 'reopen-progress', 'unchanged-no-replay', 'reattached-stop', 'saved-review-choice-after-reattach', 'retain-both-versions'], results,
			coverage: 'Production UI, app-owned adapter and IndexedDB; synthetic HTTP/native grants, OS network isolation. Real persistent Chromium process restart verified; installed Mac Quit/relaunch and OS reboot remain unverified.' };
		await writeFile(join(evidence, 'browser-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
	} catch (error) {
		if (context) { await writeFile(join(evidence, 'failed-dom.txt'), await context.pages()[0].locator('body').innerText()); await context.pages()[0].screenshot({ path: join(evidence, 'failed.png') }); }
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
