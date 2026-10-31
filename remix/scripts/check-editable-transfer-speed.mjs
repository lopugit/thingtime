import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const port = 28194, evidence = process.env.TT_SPEED_EVIDENCE || join(tmpdir(), 'thingtime-editable-speed-evidence');
if (!process.env.TT_SPEED_WORKER) {
	const dir = await mkdtemp(join(tmpdir(), 'thingtime-speed-qa-')), req = createRequire(root + '/remix/package.json');
	try {
		await createRequire(req.resolve('tsx/package.json'))('esbuild').build({ entryPoints: [join(root, 'remix/scripts/editable-transfer-speed.browser.tsx')], bundle: true, format: 'esm', platform: 'browser',
			tsconfig: join(root, 'remix/tsconfig.json'), outfile: join(dir, 'fixture.js'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'error' });
		const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir, TT_SPEED_WORKER: dir, TT_SPEED_EVIDENCE: evidence,
			...(process.env.TT_PLAYWRIGHT_MODULE ? { TT_PLAYWRIGHT_MODULE: process.env.TT_PLAYWRIGHT_MODULE } : {}) };
		await verifyAccountBackupIsolation(port, env);
		const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename], { env, stdio: 'inherit' }, port, true), timer = setTimeout(() => child.kill('SIGTERM'), 180000);
		try { const [code] = await once(child, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timer); }
	} finally { await rm(dir, { recursive: true, force: true }); }
} else {
	const dir = process.env.TT_SPEED_WORKER, req = createRequire(import.meta.url), { chromium } = req(process.env.TT_PLAYWRIGHT_MODULE || 'playwright'), bundle = await readFile(join(dir, 'fixture.js'));
	const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
		response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>[QA] Editable sync progress</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'); });
	server.listen(port, '127.0.0.1'); await once(server, 'listening'); let context, page;
	try {
		await mkdir(evidence, { recursive: true });
		context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, downloadsPath: join(dir, 'downloads'), acceptDownloads: false });
		page = context.pages()[0]; const errors = []; page.on('pageerror', error => errors.push(String(error)));
		await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`http://127.0.0.1:${port}`);
		const host = page.locator('[data-settings-document="file-sync-speed-trackers"]');
		await host.getByRole('heading', { name: 'Transfer speeds', exact: true }).waitFor();
		await host.getByText('Upload: 1 Mbps', { exact: true }).waitFor();
		await host.getByText('Download: 2 Mbps', { exact: true }).waitFor();
        const priority = page.locator('[data-settings-document="file-sync-priority-readiness"]');
        await priority.getByRole('heading', { name: 'Upload priority readiness', exact: true }).waitFor();
        await priority.getByText(/0 \/ 100,000 fixed observations checked/).waitFor();
        const states = [['partial', /4,096 \/ 100,000/], ['ready', /candidate is ready for preparation/],
            ['reserved', /operation must finish safely/], ['unsupported', /unsupported by this adapter/],
            ['unmeasured', /Waiting for the scheduler to check/], ['not-indexed', /does not prove backup completion/]];
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
            await page.setViewportSize({ width, height });
            for (const [state, text] of states) {
                await page.getByRole('button', { name: `Priority ${state}`, exact: true }).click();
                await priority.getByText(text).waitFor(); await priority.scrollIntoViewIfNeeded();
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await priority.screenshot({ path: join(evidence, `${name}-priority-${state}.png`) });
            }
        }
        await priority.getByRole('button', { name: 'Edit layout', exact: true }).click();
        await priority.locator('[data-block-id="sync-priority-readiness-title"]').click();
        for (const [field, text] of [['title', 'My priority readiness'], ['gate', 'Trusted gate: {sync.priorityGate}'],
            ['proof', 'Validation: {sync.priorityProof}'], ['candidate', 'Candidate: {sync.priorityCandidate}'], ['status', 'Why waiting: {sync.priorityStatus}']]) {
            await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('sync-priority-readiness-' + field);
            await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
        }
        await page.getByRole('button', { name: 'Close builder', exact: true }).click();
        await priority.getByRole('button', { name: 'Save layout', exact: true }).click();
        await priority.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
        await priority.getByRole('button', { name: 'Done editing layout', exact: true }).click();
        await page.reload(); await priority.getByRole('heading', { name: 'My priority readiness', exact: true }).waitFor();
        await priority.getByText(/Trusted gate:.*5 saved priorities.*revision 3/).waitFor();
        const priorityLayout = await page.evaluate(() => window.progressFixture.layout('file-sync-priority-readiness'));
        assert.ok(!/proofCursor|proofCutoff|candidateSequence/.test(JSON.stringify(priorityLayout)), 'Runtime observations are not saved into Builder layout');

		await host.getByRole('button', { name: 'Add tracker', exact: true }).click();
		let cards = host.getByRole('group', { name: 'Transfer speed tracker', exact: true });
		await cards.nth(1).waitFor();
		await cards.nth(1).getByRole('spinbutton', { name: 'Averaging timeframe', exact: true }).fill('2');
		await cards.nth(1).getByRole('combobox', { name: 'Averaging time unit', exact: true }).selectOption('minutes');
		await cards.nth(1).getByRole('combobox', { name: 'Transfer rate unit', exact: true }).selectOption('Files/ps');
		await cards.nth(1).getByRole('button', { name: 'Apply tracker', exact: true }).click();
		await cards.nth(1).getByText('Upload: 2 Files/ps', { exact: true }).waitFor();
		await cards.nth(1).getByText('Download: 4 Files/ps', { exact: true }).waitFor();
		await cards.nth(0).getByRole('spinbutton', { name: 'Averaging timeframe', exact: true }).fill('0');
		await cards.nth(0).getByRole('button', { name: 'Apply tracker', exact: true }).click();
		await host.getByRole('alert').filter({ hasText: 'Choose an averaging timeframe' }).waitFor();
		await cards.nth(0).getByRole('spinbutton', { name: 'Averaging timeframe', exact: true }).fill('1');
		await cards.nth(0).getByRole('button', { name: 'Apply tracker', exact: true }).click();
		for (const [unit, upload, download] of [['Kbps', '1,000', '2,000'], ['Gbps', '0.001', '0.002'], ['Folders/ps', '1', '2'], ['INodes/ps', '3', '6']]) {
			await cards.nth(0).getByRole('combobox', { name: 'Transfer rate unit', exact: true }).selectOption(unit);
			await cards.nth(0).getByRole('button', { name: 'Apply tracker', exact: true }).click();
			await cards.nth(0).getByText(`Upload: ${upload} ${unit}`, { exact: true }).waitFor();
			await cards.nth(0).getByText(`Download: ${download} ${unit}`, { exact: true }).waitFor();
		}
		await host.getByRole('button', { name: 'Save trackers', exact: true }).click();
        await host.getByRole('button', { name: 'Saving trackers…', exact: true }).waitFor();
        assert.ok(await host.getByRole('button', { name: 'Add tracker', exact: true }).isDisabled());
        assert.ok(await host.getByRole('button', { name: 'Edit layout', exact: true }).isDisabled());
        assert.ok(await cards.nth(0).getByRole('button', { name: 'Apply tracker', exact: true }).isDisabled());
		await host.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await page.reload(); await host.getByText('Upload: 3 INodes/ps', { exact: true }).waitFor();
		assert.equal(await cards.count(), 2);
		await host.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await host.locator('[data-block-id="tracker-default-upload"]').click();
		for (const [id, text] of [['tracker-default-title', 'My editable tracker'], ['tracker-default-upload', 'Sent: {speed.readings.tracker-default.upload}'], ['tracker-default-download', 'Received: {speed.readings.tracker-default.download}'], ['tracker-default-window-label', 'Custom window'], ['tracker-default-apply', 'Apply custom tracker']]) {
			await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
			await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
		}
		await page.getByRole('button', { name: 'Close builder', exact: true }).click();
		await host.getByRole('button', { name: 'Save layout', exact: true }).click();
		await host.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await host.getByRole('button', { name: 'Done editing layout', exact: true }).click();
		await page.reload(); await host.getByText('Sent: 3 INodes/ps', { exact: true }).waitFor();
		const layout = await page.evaluate(() => window.progressFixture.layout());
		assert.ok(JSON.stringify(layout.crystal.blocks).includes('My editable tracker'));
		assert.ok(!JSON.stringify(layout).includes('large-file-with-a-very-long-name'));
		assert.ok(!JSON.stringify(layout).includes('counters'));
		await cards.nth(1).getByRole('button', { name: 'Remove tracker', exact: true }).click();
		assert.equal(await cards.count(), 1);
		await host.getByRole('button', { name: 'Save trackers', exact: true }).click();
		await host.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await page.reload(); await host.getByText('Sent: 3 INodes/ps', { exact: true }).waitFor();
		assert.equal(await cards.count(), 1);
		for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
			await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
            for (const suffix of ['window-label', 'time-label', 'unit-label']) { const bounds = await host.locator(`[data-block-id="tracker-default-${suffix}"]`).boundingBox(); assert.ok(bounds && bounds.width >= 80 && bounds.height < 50, `Unreadable tracker label ${suffix}: ${JSON.stringify(bounds)}`); }
            let steps = 0;
			for (;;) { const bounds = await page.evaluate(() => ({ y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
				assert.ok(bounds.scrollWidth <= bounds.width, JSON.stringify(bounds)); if (bounds.y + bounds.height >= bounds.total - 1) break; assert.ok(++steps < 100); await page.evaluate(() => scrollBy(0, innerHeight * 0.8)); }
			await page.screenshot({ path: join(evidence, `${name}-bottom.png`) }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(evidence, `${name}.png`) });
		}
        await cards.nth(0).getByRole('spinbutton', { name: 'Averaging timeframe', exact: true }).fill('10');
        await cards.nth(0).getByRole('combobox', { name: 'Transfer rate unit', exact: true }).selectOption('Mbps');
        await cards.nth(0).getByRole('button', { name: 'Apply custom tracker', exact: true }).click();
        await page.getByRole('button', { name: 'Recover byte coverage', exact: true }).click();
        await host.getByText('Sent: 1 Mbps', { exact: true }).waitFor();
        await host.getByText(/Upload 1s \/ Download 10s measured/).waitFor();
        await host.getByText(/native uploads update on completed-part acknowledgment, not continuous wire progress/).waitFor();
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
            await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
            let steps = 0;
            for (;;) {
                const bounds = await page.evaluate(() => ({ y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
                assert.ok(bounds.scrollWidth <= bounds.width, JSON.stringify(bounds));
                if (bounds.y + bounds.height >= bounds.total - 1) break;
                assert.ok(++steps < 100); await page.evaluate(() => scrollBy(0, innerHeight * 0.8));
            }
            await page.screenshot({ path: join(evidence, `${name}-payload-coverage.png`) });
        }
        await page.getByRole('button', { name: 'Pause fixture', exact: true }).click();
        await host.getByText('Sent: Paused', { exact: true }).waitFor();
        await host.getByText('Received: Paused', { exact: true }).waitFor();
        await priority.getByText(/Why waiting: Saved observation/).waitFor();
        await page.reload(); await priority.getByText(/Why waiting: Saved observation/).waitFor();
        await host.getByText('Sent: Paused', { exact: true }).waitFor();
        await host.getByText('Received: Paused', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, 'mobile-paused.png') });
        await page.getByRole('button', { name: 'Complete fixture', exact: true }).click();
        await host.getByText('Sent: Complete', { exact: true }).waitFor();
        await host.getByText('Received: Complete', { exact: true }).waitFor();
        await host.getByText('Received: Complete', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(evidence, 'mobile-complete.png') });
        assert.equal(await host.getByText(/^(Sent|Received): Paused$/).count(), 0);
		assert.deepEqual(errors, []); await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, isolated: true, viewports: [1440, 390], nestedBlocksEdited: true, savedAndReloaded: true, independentWindows: true, terminalStates: ['paused', 'complete'], directions: ['upload', 'download'], units: ['Kbps', 'Mbps', 'Gbps', 'Files/ps', 'Folders/ps', 'INodes/ps'] }));
		console.log(`EDITABLE_TRANSFER_SPEED_OK ${evidence}`);
	} catch (error) {
		if (page) { await page.screenshot({ path: join(evidence, 'failed.png') }).catch(() => {}); await writeFile(join(evidence, 'failed-dom.txt'), await page.locator('body').innerText()).catch(() => {}); }
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
