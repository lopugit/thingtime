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
const port = 28191, evidence = process.env.TT_PROGRESS_EVIDENCE || join(tmpdir(), 'thingtime-editable-progress-evidence');
if (!process.env.TT_PROGRESS_WORKER) {
	const dir = await mkdtemp(join(tmpdir(), 'thingtime-progress-qa-')), req = createRequire(root + '/remix/package.json');
	try {
		await createRequire(req.resolve('tsx/package.json'))('esbuild').build({ entryPoints: [join(root, 'remix/scripts/editable-sync-progress.browser.tsx')], bundle: true, format: 'esm', platform: 'browser',
			tsconfig: join(root, 'remix/tsconfig.json'), outfile: join(dir, 'fixture.js'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'error' });
		const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir, TT_PROGRESS_WORKER: dir, TT_PROGRESS_EVIDENCE: evidence,
			...(process.env.TT_PLAYWRIGHT_MODULE ? { TT_PLAYWRIGHT_MODULE: process.env.TT_PLAYWRIGHT_MODULE } : {}) };
		await verifyAccountBackupIsolation(port, env);
		const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename], { env, stdio: 'inherit' }, port, true), timer = setTimeout(() => child.kill('SIGTERM'), 180000);
		try { const [code] = await once(child, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timer); }
	} finally { await rm(dir, { recursive: true, force: true }); }
} else {
	const dir = process.env.TT_PROGRESS_WORKER, req = createRequire(import.meta.url), { chromium } = req(process.env.TT_PLAYWRIGHT_MODULE || 'playwright'), bundle = await readFile(join(dir, 'fixture.js'));
	const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
		response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>[QA] Editable sync progress</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'); });
	server.listen(port, '127.0.0.1'); await once(server, 'listening'); let context, page;
	try {
		await mkdir(evidence, { recursive: true });
		context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, downloadsPath: join(dir, 'downloads'), acceptDownloads: false });
		page = context.pages()[0]; const errors = []; page.on('pageerror', error => errors.push(String(error)));
		await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`http://127.0.0.1:${port}`);
		await page.getByRole('heading', { name: 'Sync progress', exact: true }).waitFor();
		// Cached connections can mount this child before the parent passive effect.
		// Read priorities on first mount (including StrictMode), without Reload.
		await page.getByText('Saved priorities loaded.', { exact: true }).waitFor();
		assert.equal(await page.getByText('The account or storage destination changed. Your draft is preserved.', { exact: true }).count(), 0);
		await page.getByText(/^50\.5%/).waitFor();
		assert.equal(await page.locator('[data-block-id="sync-node-bar-fill"]').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(113, 113, 122)');
		await page.getByRole('button', { name: 'Save upload priorities', exact: true }).waitFor();
		await page.getByRole('textbox', { name: 'Priority paths', exact: true }).fill('Documents\nDeep');
		await page.getByRole('button', { name: 'Save upload priorities', exact: true }).click();
		await page.getByText('1. Documents', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Move Deep up', exact: true }).click();
		await page.getByText('1. Deep', { exact: true }).waitFor();
		await page.reload(); await page.getByText('1. Deep', { exact: true }).waitFor();
		assert.equal(await page.getByRole('textbox', { name: 'Priority paths', exact: true }).inputValue(), 'Deep\nDocuments');
		await page.getByRole('button', { name: 'Upload Documents next', exact: true }).click();
		await page.getByText('1. Documents', { exact: true }).waitFor();
		await page.getByRole('textbox', { name: 'Priority paths', exact: true }).fill('Private/unsaved.txt');
		await page.getByRole('button', { name: 'Save upload priorities', exact: true }).click();
		await page.getByText(/This path is excluded by the saved sync rules/).waitFor();
		assert.equal(await page.getByRole('textbox', { name: 'Priority paths', exact: true }).inputValue(), 'Private/unsaved.txt');
		await page.getByRole('button', { name: 'Upload Deep next', exact: true }).click();
		await page.getByText('Save your priority draft before choosing another file.', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Reload saved priorities', exact: true }).click();
		await page.getByText('Saved priorities loaded.', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Remove priority Deep', exact: true }).click();
		await page.getByRole('button', { name: 'Remove priority Deep', exact: true }).waitFor({ state: 'hidden' });
		await page.locator('[data-settings-document="file-sync-upload-priorities"]').getByRole('button', { name: 'Edit layout', exact: true }).click();
		await page.locator('[data-block-id="priority-title"]').click();
		for (const [id, text] of [['priority-title', 'Upload priorities'], ['priority-row-label', 'Priority {item.position}: {item.path}'], ['priority-up', 'Move up']]) {
			await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
			await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
		}
		await page.getByRole('button', { name: 'Close builder', exact: true }).click();
		await page.locator('[data-settings-document="file-sync-upload-priorities"]').getByRole('button', { name: 'Save layout', exact: true }).click();
		await page.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await page.locator('[data-settings-document="file-sync-upload-priorities"]').getByRole('button', { name: 'Done editing layout', exact: true }).click();
		await page.reload(); await page.getByText('Priority 1: Documents', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Open Deep', exact: true }).click();
		let deep = 'Deep';
		for (let index = 1; index <= 12; index++) {
			deep += `/level-${String(index).padStart(2, '0')}`;
			await page.getByRole('button', { name: `Open ${deep}`, exact: true }).click();
			await page.getByRole('heading', { name: deep, exact: true }).waitFor();
		}
		await page.getByText('deepest.txt', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Parent folder', exact: true }).click();
		await page.getByRole('heading', { name: deep.split('/').slice(0, -1).join('/'), exact: true }).waitFor();
		await page.getByRole('button', { name: 'Root folder', exact: true }).click();
		await page.getByRole('button', { name: 'Expand Documents', exact: true }).click();
		await page.getByRole('button', { name: 'Expand Documents/Nested', exact: true }).click();
		await page.getByText('large-file-with-a-very-long-name-that-must-wrap-on-mobile.bin', { exact: true }).waitFor();
		assert.ok(await page.getByRole('progressbar').count() > 32);
		await page.getByRole('button', { name: 'Collapse Documents/Nested', exact: true }).click();
		await page.getByRole('button', { name: 'Collapse Documents', exact: true }).click();
		await page.getByRole('button', { name: 'Next items', exact: true }).click();
		await page.getByText('file-39.txt', { exact: true }).first().waitFor();
		await page.getByRole('button', { name: 'Previous items', exact: true }).click();
		await page.getByRole('button', { name: 'Expand Documents', exact: true }).waitFor();
		await page.locator('[data-settings-document="file-sync-progress"]').getByRole('button', { name: 'Edit layout', exact: true }).click();
		await page.locator('[data-block-id="sync-node-name"]').first().click();
		for (const [id, text] of [['sync-node-name', 'Item: {item.name}'], ['sync-node-counts', 'Counts: {item.counts}'], ['sync-node-icon', '{item.icon}'], ['sync-folder-toggle', '{item.toggle}']]) {
			await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
			await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
		}
		await page.getByRole('button', { name: 'Close builder', exact: true }).click();
		await page.locator('[data-settings-document="file-sync-progress"]').getByRole('button', { name: 'Save layout', exact: true }).click();
		await page.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await page.locator('[data-settings-document="file-sync-progress"]').getByRole('button', { name: 'Done editing layout', exact: true }).click();
		const layout = await page.evaluate(() => window.progressFixture.layout()); assert.ok(JSON.stringify(layout.crystal.blocks).includes('Counts: {item.counts}'));
		assert.ok(!JSON.stringify(layout).includes('large-file-with-a-very-long-name'));
		await page.reload(); await page.getByText('Item: Documents', { exact: true }).waitFor();
		await page.getByRole('button', { name: 'Expand Documents', exact: true }).click();
		await page.getByRole('button', { name: 'Expand Documents/Nested', exact: true }).click();
		for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
			await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0)); let steps = 0;
			for (;;) { const bounds = await page.evaluate(() => ({ y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
				assert.ok(bounds.scrollWidth <= bounds.width, JSON.stringify(bounds)); if (bounds.y + bounds.height >= bounds.total - 1) break; assert.ok(++steps < 100); await page.evaluate(() => scrollBy(0, innerHeight * 0.8)); }
			await page.screenshot({ path: join(evidence, `${name}-bottom.png`) }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(evidence, `${name}.png`) });
		}
		await page.getByRole('button', { name: 'Index fixture', exact: true }).click(); await page.getByText(/^128 entries indexed.*still being discovered/).waitFor();
		await page.getByRole('button', { name: 'Prepare fixture', exact: true }).click();
		await page.getByText(/Preparing cloud destinations · 1,000,000 \/ 3,653,988 items processed/).waitFor();
		await page.getByText(/^Preparing upload · 0 \/ 0 operations confirmed/).waitFor();
		for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
			await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0)); let steps = 0;
			for (;;) {
				const b = await page.evaluate(() => ({ y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
				assert.ok(b.scrollWidth <= b.width, JSON.stringify(b)); if (b.y + b.height >= b.total - 1) break;
				assert.ok(++steps < 100); await page.evaluate(() => scrollBy(0, innerHeight * 0.8));
			}
			await page.screenshot({ path: join(evidence, `${name}-preparation-bottom.png`) });
			await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(evidence, `${name}-preparation.png`) });
		}
		for (const direction of ['upload', 'download']) {
			await page.getByRole('button', { name: `Stream ${direction} fixture`, exact: true }).click();
			await page.getByRole('heading', { name: `2. ${direction === 'upload' ? 'Upload' : 'Download'} files and folders`, exact: true }).waitFor();
			await page.getByText(/^Indexing while files transfer/).waitFor();
			await page.getByText(direction === 'upload' ? /^Uploading ·.*Total may grow/ : /^Downloading ·.*Total may grow/).waitFor();
			if (direction === 'download') {
				assert.equal(await page.getByRole('button', { name: /^Upload .* next$/ }).count(), 0);
				assert.equal(await page.locator('[data-block-id="sync-node-status"]').filter({ hasText: 'Uploading' }).count(), 0);
			}
			for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
				await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0)); let steps = 0;
				for (;;) {
					const b = await page.evaluate(() => ({ y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
					assert.ok(b.scrollWidth <= b.width, JSON.stringify(b)); if (b.y + b.height >= b.total - 1) break;
					assert.ok(++steps < 100); await page.evaluate(() => scrollBy(0, innerHeight * 0.8));
				}
				await page.screenshot({ path: join(evidence, `${name}-stream-${direction}-bottom.png`) });
				await page.locator('[data-settings-document="file-sync-progress"]').screenshot({ path: join(evidence, `${name}-stream-${direction}.png`) });
			}
		}
		await page.getByRole('button', { name: 'Watch fixture', exact: true }).click();
		await page.getByText(/Initial scan finished. Watching for new and changed files/).waitFor();
		await page.getByText(/^Waiting for new indexed files/).waitFor();
		await page.getByRole('button', { name: 'Indexed backlog fixture', exact: true }).click();
		await page.getByText(/^Initial scan finished. Preparing remaining indexed entries/).waitFor();
		await page.getByText(/^Downloading · 3 \/ 4 operations confirmed so far · Total may grow/).waitFor();
		await page.getByRole('button', { name: 'Transfer fixture', exact: true }).click();
		await page.getByRole('button', { name: 'Fail fixture', exact: true }).click(); await page.getByText(/^Error ·/).waitFor();
		await page.getByRole('button', { name: 'Pause fixture', exact: true }).click(); await page.getByText(/^Paused ·/).waitFor();
		await page.getByRole('button', { name: 'Complete fixture', exact: true }).click(); await page.getByText(/^Complete ·/).waitFor();
		await page.waitForFunction(() => [...document.querySelectorAll('[role="progressbar"]')].every(element => element.getAttribute('aria-valuenow') === '100'));
		assert.deepEqual(errors, []); await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, isolated: true, viewports: [1440, 390], nestedBlocksEdited: true, savedAndReloaded: true, focusedDepth: 13, parentAndRootNavigation: true, states: ['partial-bytes', 'index-unknown-total', 'preparation-counts', 'stream-upload', 'stream-download', 'watching', 'error', 'paused', 'complete'] }));
		console.log(`EDITABLE_SYNC_PROGRESS_OK ${evidence}`);
	} catch (error) {
		if (page) { await page.screenshot({ path: join(evidence, 'failed.png') }).catch(() => {}); await writeFile(join(evidence, 'failed-dom.txt'), await page.locator('body').innerText()).catch(() => {}); }
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
