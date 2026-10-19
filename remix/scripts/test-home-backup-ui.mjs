import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';

const root = resolve(import.meta.dirname, '..'), port = 28189;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-home-upload-ui'));
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
		await page.goto(`http://127.0.0.1:${port}/?platform=desktop&home`);
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		const field = name => page.getByRole('textbox', { name, exact: true });
		const exclusions = field('Excluded paths · one per line');
		assert.equal(await exclusions.inputValue(), 'CustomSkip');
		assert.equal(await page.getByRole('combobox', { name: 'Direction', exact: true }).inputValue(), 'two-way');
		assert.equal(await page.getByRole('checkbox', { name: 'Paused', exact: true }).isChecked(), false);
		await page.getByRole('button', { name: 'Use home backup preset', exact: true }).click();
		assert.equal(await page.getByRole('combobox', { name: 'Direction', exact: true }).inputValue(), 'backup');
		assert.equal(await page.getByRole('checkbox', { name: 'Paused', exact: true }).isChecked(), true);
		assert.deepEqual((await exclusions.inputValue()).split('\n'), ['CustomSkip', 'Library', 'Applications', '.Trash']);
		assert.equal(await page.getByRole('checkbox', { name: 'Move deleted files to Trash on the other side', exact: true }).isChecked(), false);
		const savedBefore = await page.evaluate(() => window.syncInspectionFixture.savedRows());
		assert.equal(savedBefore.find(row => row.thingtime.includes('file-sync'))?.crystal.mode, 'two-way'); // Preset has not saved the remote connection.
		await field('Connection name').fill('Home upload acceptance');
		await exclusions.fill((await exclusions.inputValue()) + '\nEditableLater');
		await page.getByRole('combobox', { name: 'Network', exact: true }).selectOption('wifi');
		await page.getByRole('combobox', { name: 'Device folder', exact: true }).selectOption('11111111-1111-4111-8111-111111111111');
		await page.getByRole('combobox', { name: 'Private cloud folder', exact: true }).selectOption('cloud-documents');
		const layout = page.locator('[data-settings-document="file-sync-home-backup"]');
		await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await page.locator('[data-block-id="home-backup-title"]').click();
		await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('My home folder backup');
		for (const [id, text] of [['home-backup-help', 'Choose the approved home folder, then review every exclusion.'], ['home-backup-action', 'Apply my home preset']]) {
			await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
			await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
		}
		await page.screenshot({ path: join(evidence, 'home-preset-builder-edit.png'), fullPage: true });
		await page.getByRole('button', { name: 'Close builder', exact: true }).click();
		await layout.getByRole('button', { name: 'Save layout', exact: true }).click();
		await layout.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
		await page.reload();
		await page.getByRole('button', { name: 'Apply my home preset', exact: true }).waitFor();
		await page.getByText('My home folder backup', { exact: true }).waitFor();
		assert.equal(await field('Connection name').inputValue(), 'Home upload acceptance');
		assert.ok((await exclusions.inputValue()).includes('EditableLater'));
		const inspectLayout = async suffix => {
			for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
				await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
				let steps = 0;
				for (;;) {
					const m = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, y: scrollY, h: innerHeight, total: document.documentElement.scrollHeight }));
					assert.ok(m.sw <= m.w + 1, JSON.stringify(m)); if (m.y + m.h >= m.total - 1) break;
					assert.ok(steps++ < 60); await page.evaluate(() => scrollBy(0, innerHeight * .8));
				}
				await page.screenshot({ path: join(evidence, label + '-' + suffix + '.png'), fullPage: true }); results.push({ label, state: suffix, steps });
			}
		};
		await inspectLayout('home-preset');
		await page.getByRole('button', { name: 'Apply my home preset', exact: true }).click();
		await page.getByRole('button', { name: 'Save connection', exact: true }).click();
		await page.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
		const readSaved = () => page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-editor-database') || '[]').find(row => row.thingtime.includes('file-sync'))?.crystal);
		let saved = await readSaved();
		assert.equal(saved.mode, 'backup'); assert.equal(saved.paused, true); assert.equal(saved.propagateDeletes, false);
		assert.deepEqual(saved.excludedPaths, ['CustomSkip', 'Library', 'Applications', '.Trash', 'EditableLater']);
		assert.equal(await page.getByRole('button', { name: 'Upload now', exact: true }).isDisabled(), true);
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.getByRole('checkbox', { name: 'Paused', exact: true }).focus();
		await page.getByRole('checkbox', { name: 'Paused', exact: true }).press('Space');
		assert.equal(await page.getByRole('checkbox', { name: 'Paused', exact: true }).isChecked(), false);
		await page.getByRole('button', { name: 'Save connection', exact: true }).click();
		await page.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
		await page.getByRole('button', { name: 'Upload now', exact: true }).click();
		await page.getByText('Last transfer finished.', { exact: true }).waitFor();
		const uploads = await page.evaluate(() => JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders') || '[]'));
		assert.deepEqual(uploads.map(row => row.name).sort(), ['Documents', 'Keep', 'LibraryExtra']);
		const observed = await page.evaluate(() => window.syncInspectionFixture.observations);
		assert.ok(observed.captures > 0, JSON.stringify(observed));
		assert.ok(observed.scanPolicies.some(paths => JSON.stringify(paths) === JSON.stringify(['.trash', 'applications', 'customskip', 'editablelater', 'library'])), JSON.stringify(observed));
		const progress = page.getByRole('region', { name: 'File sync progress', exact: true });
		await progress.locator('[data-block-id="sync-upload-description"]').filter({ hasText: 'Complete · 3 / 3 operations confirmed' }).waitFor();
		await progress.getByRole('button', { name: 'Expand Documents', exact: true }).click();
		await progress.getByText('Documents/Keep', { exact: true }).waitFor();
		await inspectLayout('upload-complete-progress');
		await progress.getByRole('button', { name: 'Collapse Documents', exact: true }).click();
		await progress.getByText('Documents/Keep', { exact: true }).waitFor({ state: 'hidden' });
		assert.deepEqual(errors, []);
		const result = { ok: true, checks: ['preset-edits-selected-draft-only', 'backup-paused-no-delete-propagation', 'preserves-existing-exclusions', 'editable-form-fields', 'nested-title-help-button-builder-save-reload', 'paused-save-prevents-transfer', 'Mac-1.6-native-filtered-capture', 'excluded-subtrees-absent-and-prefix-sibling-retained', 'desktop-mobile-top-bottom-no-overflow', 'integrated-progress-complete-with-independent-three-folder-receipts', 'progress-expand-collapse-nested-folder'], results, observations: observed,
			coverage: 'Production preset/editor/Builder/transfer/progress UI with synthetic scoped HTTP/native grants, private Chromium profile and verified OS network isolation. Installed app, real home folder and real cloud upload unverified.' };
		await writeFile(join(evidence, 'browser-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
	} catch (error) {
		if (context) { await writeFile(join(evidence, 'failed-dom.txt'), await context.pages()[0].locator('body').innerText()); await context.pages()[0].screenshot({ path: join(evidence, 'failed.png'), fullPage: true }); }
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
