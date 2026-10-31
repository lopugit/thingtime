import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';

const root = resolve(import.meta.dirname, '..'), port = 28192;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-ios-sync-evidence'));
if (!process.env.TT_IOS_SYNC_WORKER) {
	const dir = await mkdtemp(join(tmpdir(), 'thingtime-ios-sync-'));
	try {
		const require = createRequire(join(root, '../MCP/package.json'));
		await require('esbuild').build({ entryPoints: [join(root, 'scripts/mobile-sync-editor.browser.tsx')], bundle: true,
			format: 'esm', platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
			define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error' });
		const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir, TT_IOS_SYNC_WORKER: dir };
		await verifyAccountBackupIsolation(port, env);
		const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename, evidence], { env, stdio: 'inherit' }, port, true);
		const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
		try { const [code] = await once(child, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timer); }
	} finally { await rm(dir, { recursive: true, force: true }); }
} else {
	const dir = process.env.TT_IOS_SYNC_WORKER;
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
		let page;
		const open = async (suffix = '') => {
			if (context) await context.close();
			context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, downloadsPath: join(dir, 'downloads'), acceptDownloads: false });
			page = context.pages()[0]; page.on('pageerror', error => errors.push(error.message));
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`http://127.0.0.1:${port}/?platform=ios&tasks${suffix}`);
		};
		const readJobs = () => page.evaluate(async () => {
			const db = await new Promise((resolve, reject) => { const request = indexedDB.open('thingtime-file-sync-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			try { return await new Promise((resolve, reject) => { const request = db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); }
		});
		const idle = () => page.waitForFunction(() => window.syncInspectionFixture.task()?.active === false);
		const hidden = async value => page.evaluate(hidden => {
			Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
			document.dispatchEvent(new Event('visibilitychange'));
		}, value);
		await open();
		await page.getByRole('button', { name: 'Upload now', exact: true }).waitFor();
		const probe = await context.newPage(); await assert.rejects(probe.goto('http://192.0.2.1:443/blocked', { timeout: 3000 })); await probe.close();
		await page.getByRole('button', { name: 'Hold accepted upload reply', exact: true }).click();
		await page.getByRole('button', { name: 'Hold next scan', exact: true }).click();
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByText('Checking both folders…', { exact: true }).waitFor();
		await page.waitForFunction(() => window.syncInspectionFixture.pendingScans() === 1);
		await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
		assert.equal(await page.evaluate(() => window.syncInspectionFixture.task()?.active), true);
		await page.getByRole('button', { name: 'Release scan', exact: true }).click();
		await page.waitForFunction(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders') || '[]').length === 1);
		const interrupted = (await readJobs())[0]; assert.equal(interrupted.state, 'runnable');
		const before = await page.evaluate(() => localStorage.getItem('tt:fixture:sync-transfer-folders'));
		results.push('Leaving Files preserves app-owned execution until the synthetic cloud write is accepted.');
		for (const refused of ['other-account', 'revoked-device', 'revoked-root']) {
			await open('&away&' + refused);
			await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).waitFor();
			await page.waitForTimeout(500);
			assert.equal((await readJobs())[0].state, 'runnable', refused);
			assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), 0, refused);
			assert.equal(await page.evaluate(() => localStorage.getItem('tt:fixture:sync-transfer-folders')), before, refused);
		}
		await open('&away'); await idle();
		assert.equal((await readJobs())[0].state, 'complete');
		assert.equal((await readJobs())[0].id, interrupted.id);
		assert.equal(await page.evaluate(() => localStorage.getItem('tt:fixture:sync-transfer-folders')), before);
		results.push('A real Chromium process restart recovers the same durable job after a lost reply without replay; wrong account, revoked device and grant cannot scan.');
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
		await page.getByText('Last transfer finished.', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Hold next scan', exact: true }).click();
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByText('Checking both folders…', { exact: true }).waitFor();
		await page.waitForFunction(() => window.syncInspectionFixture.pendingScans() === 1);
		const beforeHidden = await page.evaluate(() => window.syncInspectionFixture.observations.requests);
			await hidden(true); await idle();
			await page.waitForTimeout(100);
			assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.requests), beforeHidden, 'No folder-list refresh may start when suspension releases the native runner');
		await page.getByText('Transfer saved. It will resume when Thingtime returns to the foreground.', { exact: true }).waitFor();
		const paused = (await readJobs())[0]; assert.equal(paused.state, 'runnable');
		const scans = await page.evaluate(() => window.syncInspectionFixture.observations.scans);
		await page.evaluate(() => dispatchEvent(new Event('online'))); await page.waitForTimeout(300);
		assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), scans);
		await page.screenshot({ path: join(evidence, 'ios-foreground-wait.png'), fullPage: true });
		await hidden(false);
		await page.waitForFunction(() => window.syncInspectionFixture.task()?.progress.stage === 'complete'); await idle();
		assert.equal((await readJobs())[0].id, paused.id); assert.equal((await readJobs())[0].state, 'complete');
		results.push('Synthetic iOS visibility suspension preserves runnable admission, blocks hidden discovery and resumes automatically on foreground.');
		await page.getByRole('button', { name: 'Hold next scan', exact: true }).click();
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByText('Checking both folders…', { exact: true }).waitFor();
		await page.waitForFunction(() => window.syncInspectionFixture.pendingScans() === 1);
		await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
		await page.getByRole('button', { name: 'Stop transfer', exact: true }).click(); await idle();
		assert.equal((await readJobs())[0].state, 'paused');
		await open('&away'); await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).waitFor();
		await page.waitForTimeout(500); assert.equal((await readJobs())[0].state, 'paused');
		assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans), 0);
		await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
		await page.getByRole('button', { name: 'Retry transfer', exact: true }).waitFor();
		assert.equal(await page.locator('[data-settings-document="file-sync-automation"]').count(), 0);
		for (const [label, width, height] of [['phone', 390, 844], ['tablet', 1024, 768]]) {
			await page.setViewportSize({ width, height });
			for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += height / 2) {
				await page.evaluate(y => scrollTo(0, y), y);
				assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
			}
			await page.screenshot({ path: join(evidence, 'ios-' + label + '.png'), fullPage: true });
		}
		results.push('Reattached Stop persists across process restart. Phone/tablet full-scroll layouts have no horizontal overflow; Mac scheduling controls stay Mac-only.');
		assert.deepEqual(errors, []);
		await writeFile(join(evidence, 'verification.json'), JSON.stringify({ results, errors, limitations: 'Production UI and journal; synthetic native/account/API/visibility. Physical iOS background and relaunch acceptance remain required.' }, null, 2));
		console.log('IOS_SYNC_LIFECYCLE_OK', results.length);
	} catch (error) {
		if (context) {
			const page = context.pages()[0];
			await writeFile(join(evidence, 'failure.txt'), String(error) + '\n' + await page.locator('body').innerText());
			await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true });
		}
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
