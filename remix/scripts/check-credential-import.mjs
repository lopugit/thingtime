import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const dir = await mkdtemp(join(tmpdir(), 'thingtime-credential-browser-'));
const path = name => fileURLToPath(new URL(name, import.meta.url));
const fixtureFile = join(dir, 'fixture.js');
let server;
let browser;
try {
	await build({
		entryPoints: [path('./credential-import.browser.tsx')], bundle: true, format: 'esm', platform: 'browser',
		tsconfig: path('../tsconfig.json'), outfile: fixtureFile, define: { 'process.env.NODE_ENV': '"development"' },
		loader: { '.png': 'dataurl', '.svg': 'dataurl', '.wasm': 'file' }, logLevel: 'error'
	});
	const bundle = await readFile(fixtureFile);
	let status = 'pending';
	let directWrites = 0;
	let replacementReads = 0;
	const replacementId = 'secret_fixture';
	const oldRevision = '2026-01-01T00:00:00.000Z';
	const newRevision = '2026-01-02T00:00:00.000Z';
	const calls = [];
	const layouts = new Map();
	const json = (response, body, statusCode = 200) => {
		response.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
		response.end(JSON.stringify(body));
	};
	const readBody = async request => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		return Buffer.concat(chunks).toString();
	};
	server = createServer(async (request, response) => {
		const origin = `http://${request.headers.host}`;
		const url = new URL(request.url, origin);
		if (url.pathname === '/fixture.js') {
			response.writeHead(200, { 'Content-Type': 'text/javascript' });
			response.end(bundle);
		} else if (url.pathname === '/.well-known/thingtime-capabilities.json') {
			json(response, { schemaVersion: 1, origin, features: Object.fromEntries(Object.entries({
				'api.credentials-import': '1.0.0', 'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.7.0',
				'api.things': '1.36.0', 'api.mongodb-endpoint': '1.1.0'
			}).map(([key, version]) => [key, { version }])) });
		} else if (url.pathname === '/api/v1/webpages/resolve') {
			const page = layouts.get(url.searchParams.get('id'));
			json(response, page ? { ok: true, page, source: 'user' } : {}, page ? 200 : 404);
		} else if (url.pathname === '/api/v1/things' && request.method === 'POST') {
			const body = JSON.parse(await readBody(request));
			const page = { id: body.shareId, updatedAt: new Date().toISOString(), author: { id: 'synthetic-admin' }, crystal: body.crystal };
			layouts.set(page.crystal.pageKey, page);
			json(response, { ok: true, thing: page });
		} else if (url.pathname.startsWith('/api/v1/credentials/import/')) {
			const action = url.pathname.split('/').pop();
			const payload = action === 'inspect' ? JSON.parse(await readBody(request)) : null;
			calls.push(payload?.label ? 'inspect-label' : action);
			if (request.headers['x-thingtime-expected-actor'] !== 'synthetic-admin') {
				json(response, { ok: false }, 403);
				return;
			}
			if (payload?.label) {
				const secret = payload.label === 'Synthetic replacement'
					? { id: replacementId, label: payload.label, updatedAt: ++replacementReads === 1 ? oldRevision : newRevision }
					: null;
				json(response, { ok: true, secret });
				return;
			}
			if (action === 'direct') {
				const data = await readBody(request);
				const target = JSON.parse(Buffer.from(request.headers['x-thingtime-import-target'], 'base64url'));
				const correctDestination = target.label === 'Synthetic provider' && target.overwrite.mode === 'create' ||
					target.label === 'Synthetic replacement' && target.overwrite.mode === 'replace' &&
					target.overwrite.expectedId === replacementId && target.overwrite.expectedUpdatedAt === newRevision;
				if (target.format !== 'text' || !correctDestination || data !== 'fixture-value-only') {
					json(response, { ok: false }, 422);
					return;
				}
				directWrites++;
				json(response, { ok: true, receipt: { credentialId: target.overwrite.expectedId || 'fixture-credential', ...target } });
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
			if (action === 'approve') status = 'approved';
			if (action === 'revoke') status = 'revoked';
			json(response, { ok: true, intent: {
				requestId: 'synthetic-handoff', expectedAccountId: 'synthetic-admin', status,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				target: { destination: 'admin-provider-vault', format: 'google-oauth', label: 'connections-google-oauth',
					environment: 'development', callbackUrl: origin + '/api/v1/connections/oauth/callback', overwrite: { mode: 'create' } }
			} });
		} else {
			response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
			response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	browser = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, acceptDownloads: false });
	const page = browser.pages()[0];
	const pageErrors = [];
	page.on('pageerror', error => pageErrors.push(error.message));
	const origin = 'http://127.0.0.1:' + server.address().port;
	await page.goto(origin);
	await page.evaluate(() => {
		const frame = document.createElement('iframe');
		frame.id = 'framed-credential-fixture';
		frame.src = location.origin + '/frame-fixture';
		document.body.append(frame);
	});
	const framed = page.frameLocator('#framed-credential-fixture');
	await framed.getByText('Open credential handoff in its own tab to continue.', { exact: true }).waitFor();
	assert.equal(await framed.getByRole('button', { name: 'Approve this handoff' }).count(), 0);
	assert.equal(await framed.getByRole('button', { name: 'Cancel handoff' }).count(), 0);
	assert.equal(await framed.getByRole('heading', { name: 'Import provider credentials' }).count(), 0);
	await page.locator('#framed-credential-fixture').evaluate(frame => frame.remove());
	await page.getByText('Awaiting approval.').waitFor();
	await page.getByText(`Callback: ${origin}/api/v1/connections/oauth/callback`, { exact: true }).waitFor();
	assert.equal(await page.getByRole('progressbar').count(), 0);
	await page.getByLabel('Choose credential file').setInputFiles({
		name: 'synthetic-wrong.json', mimeType: 'application/json', buffer: Buffer.from('{"installed":{"client_id":"fixture"}}')
	});
	await page.getByRole('button', { name: 'Review import', exact: true }).focus();
	await page.keyboard.press('Enter');
	await page.getByRole('alert').filter({ hasText: 'Web application' }).waitFor();
	assert.equal(directWrites, 0);

	await page.getByLabel('Credential format').selectOption('text');
	await page.getByLabel('Vault label').fill('Synthetic provider');
	await page.getByRole('button', { name: 'Paste a value instead' }).click();
	const password = page.getByLabel('Paste credential value');
	assert.equal(await password.getAttribute('type'), 'password');
	await password.fill('fixture-value-only');
	await page.getByRole('button', { name: 'Review import', exact: true }).click();
	await page.getByRole('heading', { name: 'Review vault destination' }).waitFor();
	assert.ok(!(await page.locator('body').innerText()).includes('fixture-value-only'));
	await page.getByRole('button', { name: 'Discard', exact: true }).click();
	await page.getByText('Import discarded.').waitFor();
	assert.equal(await password.inputValue(), '');
	await password.fill('fixture-value-only');
	await page.getByRole('button', { name: 'Review import', exact: true }).click();
	await page.getByRole('button', { name: 'Save encrypted credential' }).click();
	await page.getByText('Credential saved in the encrypted integration vault.').waitFor();
	assert.equal(directWrites, 1);

	await page.getByLabel('Vault label').fill('Synthetic provider');
	await page.getByRole('button', { name: 'Choose a file instead' }).click();
	await page.getByLabel('Choose credential file').setInputFiles({
		name: 'synthetic-valid.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture-value-only')
	});
	await page.getByRole('button', { name: 'Review import', exact: true }).click();
	await page.getByRole('button', { name: 'Save encrypted credential' }).click();
	await page.getByText('Credential saved in the encrypted integration vault.').waitFor();
	assert.equal(directWrites, 2);

	await page.getByLabel('Vault label').fill('Synthetic replacement');
	await page.getByLabel('Choose credential file').setInputFiles({
		name: 'synthetic-rotation.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture-value-only')
	});
	const review = page.getByRole('button', { name: 'Review import', exact: true });
	const replacement = page.getByRole('checkbox', { name: 'Replace the existing vault credential' });
	await review.click();
	await page.getByText(`This label is already in use. Confirm replacement of revision ${oldRevision}.`).waitFor();
	await replacement.check();
	await review.click();
	await page.getByText(`This label is already in use. Confirm replacement of revision ${newRevision}.`).waitFor();
	assert.equal(await replacement.isChecked(), false);
	assert.equal(directWrites, 2);
	await replacement.check();
	await review.click();
	await page.getByText(`Credential ID: ${replacementId}`, { exact: true }).waitFor();
	await page.getByRole('button', { name: 'Save encrypted credential' }).click();
	await page.getByText('Credential saved in the encrypted integration vault.').waitFor();
	assert.equal(directWrites, 3);


	await page.getByRole('button', { name: 'Approve this handoff' }).click();
	await page.getByRole('progressbar').waitFor();
	assert.equal(await page.getByRole('progressbar').count(), 1);
	await page.getByText('Approved. The sender can now deliver the credential.').waitFor();
	await page.getByRole('button', { name: 'Cancel handoff' }).click();
	await page.getByText('Handoff cancelled.').waitFor();
	assert.deepEqual(calls, ['inspect', 'inspect-label', 'inspect-label', 'direct', 'inspect-label', 'direct', 'inspect-label', 'inspect-label', 'inspect-label', 'direct', 'approve', 'revoke']);

	await enableCurrentPageBuilder(page);
	await page.getByRole('button', { name: 'Edit import layout' }).click();
	await page.getByRole('button', { name: 'Open Builder inspector' }).click();

	for (const [id, title] of [['credential-import-heading', 'Import a provider credential'], ['import-review', 'Review the destination']]) {
		await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
		await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(title);
	}
	await page.getByRole('button', { name: 'Close builder', exact: true }).click();
	await page.getByRole('button', { name: 'Save layout', exact: true }).click();
	await page.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
	await page.getByRole('button', { name: 'Done editing layout', exact: true }).click();
	assert.ok(!JSON.stringify([...layouts.values()]).includes('fixture-value-only'));
	await page.reload();
	await page.getByRole('heading', { name: 'Import a provider credential' }).waitFor();
	await page.getByRole('button', { name: 'Review the destination' }).waitFor();
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await page.evaluate(() => scrollTo(0, 0));
		for (let step = 0; step < 20; step++) {
			const bounds = await page.evaluate(() => ({ y: scrollY, h: innerHeight, total: document.documentElement.scrollHeight, width: innerWidth, scroll: document.documentElement.scrollWidth }));
			assert.ok(bounds.scroll <= bounds.width);
			if (bounds.y + bounds.h >= bounds.total - 1) break;
			assert.ok(step < 19);
			await page.evaluate(() => scrollBy(0, innerHeight * 0.8));
		}
	}
	await page.getByRole('button', { name: 'Switch account' }).click();
	await page.getByRole('heading', { name: 'Import a provider credential' }).waitFor({ state: 'hidden' });
	await page.getByRole('heading', { name: 'Credential handoff', exact: true }).waitFor({ state: 'hidden' });
	assert.deepEqual(pageErrors, []);
	console.log('Credential import browser checks passed (isolated Chromium, synthetic API, desktop and mobile).');
} finally {
	await browser?.close();
	if (server?.listening) {
		server.close();
		await once(server, 'close');
	}
	await rm(dir, { recursive: true, force: true });
}
