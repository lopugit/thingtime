/** Real Builder rendering and input transport with synthetic account/API records. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { ports } = require('./worktree-ports.cjs').resolveDevContext();
const origin = 'http://127.0.0.1:' + ports.web;
const screenshots = resolve(process.argv[2] || '/tmp/thingtime-component-arguments');
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui}#root{padding:16px;max-width:900px;margin:auto}button,input{min-height:44px;margin:4px}article{border-top:1px solid #ddd;padding:8px 0}</style><div id="root"></div><script type="module" src="/scripts/component-arguments.browser.fixture.tsx"></script>';
const server = await createServer({
	root, configFile: false, envDir: false, publicDir: false,
	cacheDir: join(screenshots, '.vite-cache'),
	resolve: { alias: { '~': join(root, 'app') } },
	server: { host: '127.0.0.1', port: ports.web, strictPort: true, hmr: false },
	plugins: [{ name: 'synthetic-component-arguments', configureServer(vite) {
		vite.middlewares.use(async (request, response, next) => {
			if (!request.url?.startsWith('/p/fixture-arguments')) return next();
			try { response.setHeader('content-type', 'text/html'); response.end(await vite.transformIndexHtml(request.url, html)); }
			catch (error) { next(error); }
		});
	} }]
});
let browser;
try {
	await server.listen();
	await mkdir(screenshots, { recursive: true, mode: 0o700 });
	browser = await chromium.launch({ chromiumSandbox: true });
	for (const [mode, viewport] of Object.entries({ desktop: { width: 1280, height: 840 }, mobile: { width: 390, height: 844 } })) {
		const context = await browser.newContext({ viewport, isMobile: mode === 'mobile', hasTouch: mode === 'mobile' });
		try { await exercise(context, mode); } finally { await context.close(); }
	}
} finally { await browser?.close(); await server.close(); }

async function exercise(context, mode) {
	const page = await context.newPage();
	page.setDefaultTimeout(12000);
	const errors = [], reads = [], saves = [];
	const pendingRequests = new Set();
	page.on('pageerror', error => errors.push(error.message));
	page.on('request', request => pendingRequests.add(request.url()));
	page.on('requestfinished', request => pendingRequests.delete(request.url()));
	page.on('requestfailed', request => pendingRequests.delete(request.url()));
	let releaseSlow;
	const slow = new Promise(resolve => { releaseSlow = resolve; });
	let holdNextSave = false, releaseSave;
	const heldSave = new Promise(resolve => { releaseSave = resolve; });
	await page.route(origin + '/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: {
		schemaVersion: 1, origin, features: { 'api.things': { version: '1.62.0' }, 'api.things-update': { version: '1.27.0' },
			'api.webpages-resolve': { version: '1.19.0' }, 'api.actions-run': { version: '1.46.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } }
	} }));
	await page.route(origin + '/api/v1/actions/run', async route => {
		const { action, inputs, sharedRoot } = route.request().postDataJSON();
		assert.equal(sharedRoot, undefined);
		let result;
		if (action === 'fixture-read-record') {
			reads.push(inputs.id);
			assert.equal(typeof inputs.id, 'string');
			assert.equal(inputs.id.includes('{'), false, 'row binding reaches the existing source as a scalar ID');
			if (inputs.id === 'slow-record') await slow;
			result = { record: { id: inputs.id, title: inputs.id ? 'Title ' + inputs.id : '' } };
		} else if (action === 'fixture-save-record') {
			saves.push(inputs);
			if (holdNextSave && inputs.id === 'record-a') { holdNextSave = false; await heldSave; }
			result = { silent: true };
		} else throw new Error('Unexpected executable reference ' + action);
		try { await route.fulfill({ json: { status: 'ok', result, opsUsed: 1, durationMs: 1 } }); } catch { /* A replaced source may abort its request. */ }
	});
	try { await page.goto(origin + '/p/fixture-arguments', { waitUntil: 'domcontentloaded', timeout: 120000 }); }
	catch (error) { throw new Error(error.message + '\nPending synthetic requests: ' + [...pendingRequests].join(', ') + '\n' + errors.join('\n')); }
	await page.getByText('Record title: Title record-a', { exact: true }).waitFor();
	await page.getByText('Record title: Title record-b', { exact: true }).waitFor();
	assert.deepEqual(reads.sort(), ['record-a', 'record-b']);
	assert.equal(await page.getByText('Literals: {item.linkId} / {item.linkId} / {item.linkId}', { exact: true }).count(), 2);
	await page.getByRole('button', { name: 'Expand record record-a', exact: true }).click();
	await page.getByText('Editor state record-a: 1', { exact: true }).waitFor();
	assert.equal(await page.getByText('Editor state record-b: 1', { exact: true }).count(), 0);
	await page.getByRole('checkbox', { name: 'Flag record-a', exact: true }).check();
	await page.getByText('Flag state record-a: true', { exact: true }).waitFor();
	assert.equal(await page.getByText('Outer flag:', { exact: true }).count(), 1);
	await page.getByRole('textbox', { name: 'Draft record-a' }).fill('Draft A');
	await page.getByRole('textbox', { name: 'Draft record-b' }).fill('Draft B');
	const firstSaveResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/actions/run') &&
		response.request().postDataJSON()?.action === 'fixture-save-record' && response.request().postDataJSON()?.inputs?.id === 'record-a');
	await page.getByRole('textbox', { name: 'Draft record-a' }).press('Enter');
	await firstSaveResponse;
	assert.equal(saves.length, 1);
	assert.equal(saves[0].id, 'record-a');
	assert.equal(saves[0].title, 'Draft A');
	assert.equal(await page.getByRole('textbox', { name: 'Draft record-b' }).inputValue(), 'Draft B');
	await page.getByRole('button', { name: 'Toggle expanded blocks' }).click();
	await page.getByText('Record title: Title record-b', { exact: true }).waitFor();
	assert.equal(await page.getByText('Literals: {item.linkId} / {item.linkId} / {item.linkId}', { exact: true }).count(), 2);
	await page.getByRole('button', { name: 'Toggle expanded blocks' }).click();
	holdNextSave = true;
	await page.getByRole('button', { name: 'Use stable marker identity' }).click();
	const pendingSave = page.waitForRequest(request => request.url().endsWith('/api/v1/actions/run') &&
		request.postDataJSON()?.action === 'fixture-save-record' && request.postDataJSON()?.inputs?.id === 'record-a');
	await page.getByRole('button', { name: 'Save record', exact: true }).nth(0).click();
	await pendingSave;
	await page.getByRole('button', { name: 'Choose new record' }).click();
	await page.getByText('Record title: Title new-record', { exact: true }).waitFor();
	await page.getByRole('button', { name: 'Expand record new-record' }).click();
	await page.getByRole('textbox', { name: 'Draft new-record' }).fill('Newer draft');
	const newSave = page.waitForRequest(request => request.url().endsWith('/api/v1/actions/run') &&
		request.postDataJSON()?.action === 'fixture-save-record' && request.postDataJSON()?.inputs?.id === 'new-record');
	await page.getByRole('button', { name: 'Save record', exact: true }).click();
	await newSave;
	const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/actions/run') &&
		response.request().postDataJSON()?.action === 'fixture-save-record' && response.request().postDataJSON()?.inputs?.id === 'record-a');
	releaseSave();
	await (await oldResponse).finished();
	assert.equal(await page.getByText('Editor state new-record: 1', { exact: true }).count(), 1);
	assert.equal(await page.getByRole('textbox', { name: 'Draft new-record' }).inputValue(), 'Newer draft');
	const slowRequest = page.waitForRequest(request => request.url().endsWith('/api/v1/actions/run') && request.postDataJSON()?.inputs?.id === 'slow-record');
	await page.getByRole('button', { name: 'Choose slow record' }).click();
	await page.waitForFunction(() => !document.body.textContent.includes('Title record-a'));
	await slowRequest;
	await page.getByRole('button', { name: 'Choose new record' }).click();
	await page.getByText('Record title: Title new-record', { exact: true }).waitFor();
	await page.getByRole('textbox', { name: 'Draft new-record' }).fill('New draft');
	await page.getByRole('button', { name: 'Reset runtime identity' }).click();
	await page.getByText('Record title: Title new-record', { exact: true }).waitFor();
	assert.notEqual(await page.getByRole('textbox', { name: 'Draft new-record' }).inputValue(), 'New draft');
	releaseSlow();
	await page.waitForTimeout(80);
	assert.equal(await page.getByText('Record title: Title slow-record', { exact: true }).count(), 0);
	await page.getByRole('button', { name: 'Remove row link' }).click();
	await page.waitForFunction(() => !document.body.textContent.includes('Title new-record'));
	await page.getByRole('textbox', { name: 'Draft', exact: true }).waitFor();
	assert.ok(reads.includes(''));
	await page.getByRole('button', { name: 'Toggle inspector' }).click();
	const binding = page.getByLabel('Parent data binding for recordId');
	await binding.waitFor();
	assert.equal(await binding.inputValue(), '{item.linkId}');
	const checkbox = page.getByRole('checkbox', { name: 'Use parent data for recordId' });
	const checkboxLabel = checkbox.locator('xpath=..');
	assert.equal(await checkboxLabel.evaluate(node => node.tagName), 'LABEL');
	if (mode === 'mobile') await checkboxLabel.tap(); else await checkboxLabel.click();
	assert.equal(await checkbox.isChecked(), false);
	await binding.waitFor({ state: 'detached' });
	await checkbox.focus();
	await checkbox.press('Space');
	assert.equal(await checkbox.isChecked(), true);
	await page.getByLabel('Parent data binding for recordId').fill('{item.linkId}');
	const scrolling = await page.getByTestId('builder-drawer').evaluate(drawer => {
		const content = Array.from(drawer.children).find(node => getComputedStyle(node).overflowY === 'auto');
		if (!(content instanceof HTMLElement)) throw new Error('Inspector scroll container missing');
		content.scrollTop = content.scrollHeight;
		const overflow = content.scrollWidth > content.clientWidth;
		const reachedBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
		content.scrollTop = 0;
		return { overflow, reachedBottom };
	});
	assert.deepEqual(scrolling, { overflow: false, reachedBottom: true });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await page.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); scrollTo(0, 0); });
	await page.screenshot({ path: join(screenshots, mode + '-argument-inspector.png'), fullPage: true });
	assert.deepEqual(errors, []);
	console.log(mode + ' nested row bindings, local controls, draft isolation, expansion, stale reads/saves and inspector passed');
}
