import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';

const root = resolve(import.meta.dirname, '..'), port = 28191;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-stopped-sync-job-ui'));
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
        const url = `http://127.0.0.1:${port}/?platform=desktop&tasks&ignore`;
        await page.goto(url);
        const readStore = name => page.evaluate(async name => {
            const db = await new Promise((resolve, reject) => { const request = indexedDB.open('thingtime-file-sync-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
            try { return await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); }
        }, name);
        const readJobs = () => readStore('sync-admitted-jobs');
        await page.getByRole('button', { name: 'Lose next upload reply', exact: true }).click();
        await page.getByRole('button', { name: 'Upload now', exact: true }).click();
        await page.waitForFunction(() => window.syncInspectionFixture.task()?.status === 'error');
        const oldJob = (await readJobs())[0]; assert.equal(oldJob.state, 'attention'); assert.equal(oldJob.intervalMs, undefined);
        const pending = await readStore('sync-paged-operations'); assert.ok(pending.length > 0); assert.ok(pending.some(row => row.receipt === null));
        const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders'))); assert.equal(accepted.length, 1);
        const beforeSaveScans = await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures);
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await page.getByRole('textbox', { name: 'Gitignore rules', exact: true }).fill('node_modules/\nbuild/*\n!build/keep.txt');
        await page.getByRole('button', { name: 'Save connection', exact: true }).click();
        await page.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
        const stillOld = (await readJobs())[0]; assert.equal(stillOld.id, oldJob.id); assert.equal(stillOld.state, 'attention'); assert.equal(stillOld.reviewed.configuration.ignoreRules, undefined);
        assert.deepEqual(await readStore('sync-paged-operations'), pending);
        assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures), beforeSaveScans);
        const stop = page.getByRole('button', { name: 'Stop saved transfer', exact: true }); await stop.waitFor(); assert.equal(await stop.isEnabled(), true);
        const inspect = async suffix => {
            for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
                await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0)); let steps = 0;
                for (;;) { const m = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, y: scrollY, h: innerHeight, total: document.documentElement.scrollHeight })); assert.ok(m.sw <= m.w + 1, JSON.stringify(m)); if (m.y + m.h >= m.total - 1) break; assert.ok(steps++ < 60); await page.evaluate(() => scrollBy(0, innerHeight * .8)); }
                await page.screenshot({ path: join(evidence, label + '-' + suffix + '.png'), fullPage: true }); results.push({ label, state: suffix, steps });
            }
        };
        await inspect('legacy-attention');
        await stop.click();
        await page.waitForFunction(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('thingtime-file-sync-v1'); r.onsuccess = () => resolve(r.result); }); try { return await new Promise(resolve => { const r = db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll(); r.onsuccess = () => resolve(r.result[0]?.state === 'paused'); }); } finally { db.close(); } });
        assert.equal((await readJobs())[0].id, oldJob.id); assert.deepEqual(await readStore('sync-paged-operations'), pending);
        await page.reload();
        await page.getByRole('button', { name: 'Start automatic sync', exact: true }).waitFor();
        assert.equal((await readJobs())[0].state, 'paused'); assert.equal((await readJobs())[0].id, oldJob.id);
        assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures), 0);
        await page.getByRole('button', { name: 'Start automatic sync', exact: true }).click();
        // A changed-policy admission may replace only the explicit paused ticket.
        await page.waitForFunction(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('thingtime-file-sync-v1'); r.onsuccess = () => resolve(r.result); }); try { return await new Promise(resolve => { const r = db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll(); r.onsuccess = () => resolve(r.result[0]?.reviewed.configuration.configurationVersion === 2); }); } finally { db.close(); } });
        const nextJob = (await readJobs())[0]; assert.notEqual(nextJob.id, oldJob.id); assert.equal(nextJob.reviewed.configuration.ignoreRules, 'node_modules/\nbuild/*\n!build/keep.txt'); assert.ok(nextJob.intervalMs > 0);
        const after = await readStore('sync-paged-operations'); for (const row of pending) assert.ok(after.some(current => JSON.stringify(current) === JSON.stringify(row)), 'Pending operation journal must not be rewritten by policy replacement');
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders'))), accepted);
        await page.waitForFunction(() => window.syncInspectionFixture.task()?.status === 'error');
        await page.getByText('An unfinished transfer belongs to different settings. Restore its original settings before retrying; its work has been preserved.', { exact: true }).first().waitFor();
        assert.equal((await readJobs())[0].state, 'attention');
        assert.deepEqual(await readStore('sync-paged-operations'), pending);
        await inspect('pending-write-policy-fenced');
        // Independent synthetic profile: indexing failed before any operation.
        await context.close();
        context = await chromium.launchPersistentContext(join(dir, 'profile-no-pending'), { headless: true, downloadsPath: join(dir, 'downloads-no-pending'), acceptDownloads: false });
        page = context.pages()[0]; page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(url + '&diagnostic');
        await page.getByRole('button', { name: 'Upload now', exact: true }).click();
        await page.waitForFunction(() => window.syncInspectionFixture.task()?.status === 'error');
        const emptyJob = (await readJobs())[0]; assert.equal(emptyJob.state, 'attention'); assert.equal(emptyJob.intervalMs, undefined);
        assert.equal((await readStore('sync-paged-operations')).length, 0);
        const scansBeforeEmptySave = await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures);
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await page.getByRole('textbox', { name: 'Gitignore rules', exact: true }).fill('node_modules/\nbuild/*\n!build/keep.txt');
        await page.getByRole('button', { name: 'Save connection', exact: true }).click();
        await page.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
        assert.equal((await readJobs())[0].id, emptyJob.id); assert.equal((await readJobs())[0].state, 'attention');
        assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures), scansBeforeEmptySave);
        await page.getByRole('button', { name: 'Stop saved transfer', exact: true }).click();
        await page.waitForFunction(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('thingtime-file-sync-v1'); r.onsuccess = () => resolve(r.result); }); try { return await new Promise(resolve => { const r = db.transaction('sync-admitted-jobs').objectStore('sync-admitted-jobs').getAll(); r.onsuccess = () => resolve(r.result[0]?.state === 'paused'); }); } finally { db.close(); } });
        await page.goto(url);
        await page.getByRole('button', { name: 'Start automatic sync', exact: true }).waitFor();
        assert.equal((await readJobs())[0].state, 'paused');
        assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.captures), 0);
        await page.getByRole('button', { name: 'Start automatic sync', exact: true }).click();
        await page.waitForFunction(() => window.syncInspectionFixture.task()?.status === 'complete');
        const completed = (await readJobs())[0]; assert.equal(completed.state, 'scheduled'); assert.notEqual(completed.id, emptyJob.id);
        assert.equal(completed.reviewed.configuration.ignoreRules, 'node_modules/\nbuild/*\n!build/keep.txt'); assert.equal(completed.reviewed.configuration.configurationVersion, 2);
        assert.ok(await page.evaluate(() => window.syncInspectionFixture.observations.captures > 0));
        const policies = await page.evaluate(() => window.syncInspectionFixture.observations.ignorePolicies);
        assert.ok(policies.length > 0); assert.ok(policies.every(policy => policy === completed.reviewed.configuration.ignoreRules));
        assert.deepEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders')))).map(row => row.name), ['Upload sample']);
        await inspect('zero-operation-new-policy-complete');

        assert.deepEqual(errors, []);
        const result = { ok: true, checks: ['legacy-one-shot-attention-with-pending-accepted-write', 'save-new-ignore-rules-does-not-start-or-replace-admission', 'enabled-stop-saved-transfer-without-interval', 'explicit-stop-durable-across-reload', 'explicit-start-admits-changed-policy', 'pending-write-execution-remains-explicitly-fenced', 'zero-operation-indexing-failure-starts-fresh-v2-capture-and-completes', 'pending-operation-journal-not-rewritten', 'no-duplicate-accepted-remote-write', 'desktop-mobile-top-bottom-no-overflow'], results,
            coverage: 'Production automation/ignore UI and IndexedDB; synthetic scoped native+HTTP grants; private Chromium and verified OS network isolation. Changed-policy pending writes remain fenced; independent zero-operation indexing failure recovers through fresh v2 capture and schedules its next automatic cycle.' };
        await writeFile(join(evidence, 'browser-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
	} catch (error) {
		if (context) { await writeFile(join(evidence, 'failed-dom.txt'), await context.pages()[0].locator('body').innerText()); await context.pages()[0].screenshot({ path: join(evidence, 'failed.png'), fullPage: true }); }
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
