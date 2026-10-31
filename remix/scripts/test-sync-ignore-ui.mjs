import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';

const root = resolve(import.meta.dirname, '..'), port = 28190;
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-ignore-ui'));
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
        await page.goto(`http://127.0.0.1:${port}/?platform=desktop&home&ignore`);
        // Exercise production editable ignore controls; synthetic account only.
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        const exclusions = page.getByRole('textbox', { name: 'Excluded paths · one per line', exact: true });
        assert.equal(await exclusions.inputValue(), 'CustomSkip');
        await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('backup');
        const inspectLayout = async suffix => {
            for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
                await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
                await page.screenshot({ path: join(evidence, label + '-' + suffix + '-top.png') });
                let steps = 0;
                for (;;) {
                    const m = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, y: scrollY, h: innerHeight, total: document.documentElement.scrollHeight }));
                    assert.ok(m.sw <= m.w + 1, JSON.stringify(m)); if (m.y + m.h >= m.total - 1) break;
                    assert.ok(steps++ < 60); await page.evaluate(() => scrollBy(0, innerHeight * .8));
                }
                await page.screenshot({ path: join(evidence, label + '-' + suffix + '-bottom.png') });
                await page.screenshot({ path: join(evidence, label + '-' + suffix + '.png'), fullPage: true }); results.push({ label, state: suffix, steps });
            }
        };
        const rules = page.getByRole('textbox', { name: 'Gitignore rules', exact: true });
        const tester = page.getByRole('textbox', { name: 'Ignore test path', exact: true });
        const kind = page.getByRole('combobox', { name: 'Ignore test path type', exact: true });
        const answer = page.getByRole('status', { name: 'Ignore test result', exact: true });
        await rules.fill('# My connection\n*.tmp\n!keep.tmp');
        await page.getByRole('button', { name: 'Add dependency ignore defaults', exact: true }).click();
        const defaults = await rules.inputValue();
        assert.ok(defaults.includes('node_modules/')); assert.ok(defaults.endsWith('# My connection\n*.tmp\n!keep.tmp'));
        assert.equal(await exclusions.inputValue(), 'CustomSkip');
        await page.getByRole('button', { name: 'Add dependency ignore defaults', exact: true }).click();
        assert.equal(await rules.inputValue(), defaults);
        const updated = defaults.split('\n').filter(line => line !== 'Pods/').join('\n') + '\nbuild/\n!build/keep.txt\ncustom-cache/';
        await rules.fill(updated); assert.ok(!(await rules.inputValue()).split('\n').includes('Pods/'));
        await tester.fill('projects/app/node_modules/package/index.js'); await answer.filter({ hasText: /Ignored by rule .*node_modules/ }).waitFor();
        await tester.fill('Pods/Package'); await answer.filter({ hasText: 'Included. No ignore rule matches this path.' }).waitFor();
        await tester.fill('keep.tmp'); await answer.filter({ hasText: /Included by rule .* !keep.tmp/ }).waitFor();
        await tester.fill('build/keep.txt'); await answer.filter({ hasText: /Ignored by rule .*build\/.*parent build/ }).waitFor();
        await rules.fill(updated.replace('\nbuild/\n', '\nbuild/*\n'));
        await answer.filter({ hasText: /Included by rule .* !build\/keep.txt/ }).waitFor();
        await tester.fill('node_modules'); await kind.selectOption('folder'); await answer.filter({ hasText: /Ignored by rule .*node_modules/ }).waitFor();
        await kind.selectOption('file'); await answer.filter({ hasText: 'Included. No ignore rule matches this path.' }).waitFor();
        await tester.fill('CustomSkip/kept.tmp'); await answer.filter({ hasText: 'Ignored by exact excluded path: CustomSkip' }).waitFor();
        const savedRules = await rules.inputValue();
        await inspectLayout('ignore-editor');
        const layout = page.locator('[data-settings-document="file-sync-ignore"]');
        await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
        await layout.locator('[data-block-id="ignore-title"]').click();
        for (const [id, text] of [['ignore-title', 'My device ignore rules'], ['ignore-help', 'Review each rule and test a relative path before saving.'], ['ignore-defaults', 'Insert my dependency defaults'], ['ignore-test-result', 'Path result: {ignore.result}'], ['ignore-test-file', 'Regular file']]) {
            await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
            await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
        }
        await page.screenshot({ path: join(evidence, 'ignore-builder.png'), fullPage: true });
        await page.getByRole('button', { name: 'Close builder', exact: true }).click();
        await layout.getByRole('button', { name: 'Save layout', exact: true }).click();
        await layout.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
        await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
        await page.getByRole('button', { name: 'Save connection', exact: true }).click();
        await page.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
        const saved = await page.evaluate(() => window.syncInspectionFixture.savedRows().find(row => row.thingtime.includes('file-sync'))?.crystal);
        assert.equal(saved.mode, 'backup'); assert.equal(saved.paused, false);
        assert.equal(await page.getByRole('button', { name: 'Upload now', exact: true }).isEnabled(), true);
        assert.equal(saved.configurationVersion, 2); assert.equal(saved.ignoreRules, savedRules); assert.deepEqual(saved.excludedPaths, ['CustomSkip']);
        assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures), 0);
        await page.reload(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
        assert.equal(await rules.inputValue(), savedRules); assert.equal(await exclusions.inputValue(), 'CustomSkip');
        await page.getByText('My device ignore rules', { exact: true }).waitFor();
        await page.getByText('Review each rule and test a relative path before saving.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Insert my dependency defaults', exact: true }).waitFor();
        assert.equal(await kind.locator('option').first().textContent(), 'Regular file');
        await tester.fill('build/keep.txt'); await answer.filter({ hasText: /Path result: Included by rule .* !build\/keep.txt/ }).waitFor();
        assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.scans + window.syncInspectionFixture.observations.captures), 0);
        await inspectLayout('ignore-reloaded');

        assert.deepEqual(errors, []);
        const result = { ok: true, checks: ['defaults-preserve-exact-exclusions-and-custom-rules', 'defaults-idempotent', 'remove-and-add-rules', 'directory-negation-distinguishes-parent-ignore-from-content-ignore', 'directory-file-kind-tester', 'exact-exclusion-remains-authoritative', 'nested-block-title-help-control-option-result-builder-save-reload', 'configuration-v2-ignore-rules-persist-reload', 'save-and-reload-never-start-transfer', 'desktop-mobile-top-bottom-no-overflow'], results,
            coverage: 'Production ignore editor and Builder UI; synthetic scoped HTTP/native grants; private Chromium profile and verified OS network isolation. Native matcher, Electron IPC, installed app and real home upload require independent acceptance.' };
        await writeFile(join(evidence, 'browser-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
	} catch (error) {
		if (context) { await writeFile(join(evidence, 'failed-dom.txt'), await context.pages()[0].locator('body').innerText()); await context.pages()[0].screenshot({ path: join(evidence, 'failed.png'), fullPage: true }); }
		throw error;
	} finally { await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
