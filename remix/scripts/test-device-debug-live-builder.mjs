import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
assert.ok(process.env.THINGTIME_DIAGNOSTICS_FIXTURE);
const account = JSON.parse(await readFile(process.env.THINGTIME_DIAGNOSTICS_FIXTURE, 'utf8'));
assert.match(account.base, /^http:\/\/127\.0\.0\.1:\d+$/);
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-device-debug-live-builder'));
const dir = await mkdtemp(join(tmpdir(), 'thingtime-device-debug-builder-'));
let context, page;
try {
	await mkdir(evidence, { recursive: true });
	context = await require('playwright').chromium.launchPersistentContext(join(dir, 'profile'), { headless: true });
	assert.equal((await context.request.post(account.base + '/api/v1/login', { data: { username: account.username, password: account.password } })).status(), 200);
	assert.equal((await (await context.request.get(account.base + '/api/v1/auth/me')).json()).user.id, account.userId);
	page = context.pages()[0]; await page.goto(account.base + '/things/debug'); await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
	await page.getByRole('button', { name: 'Open menu', exact: true }).click();
	await page.getByRole('button', { name: 'Builder on current page', exact: true }).click();
	if (await page.getByRole('button', { name: 'Close menu', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close menu', exact: true }).click();
	await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
	for (const [id, text] of [['debug-title', 'Device activity'], ['debug-field-reason-label', 'Wait reason']]) {
		await page.locator(`[data-block-id="${id}"]`).click();
		if (!await page.getByLabel('Block text', { exact: true }).isVisible()) await page.getByTestId('builder-drawer-reopen').click();
		await page.getByLabel('Block text', { exact: true }).fill(text); await page.getByTestId('builder-close').click();
	}
	await page.locator('[data-block-id="debug-field-reason"]').click();
	if (!await page.getByLabel('Block text', { exact: true }).isVisible()) await page.getByTestId('builder-drawer-reopen').click();
	assert.equal(await page.getByLabel('Block text', { exact: true }).inputValue(), '{item.reasonLabel}');
	await page.screenshot({ path: join(evidence, 'nested-binding-selected.png'), fullPage: true }); await page.getByTestId('builder-close').click();
	const saved = page.waitForResponse(r => r.url().endsWith('/api/v1/things') && r.request().method() === 'POST');
	await page.getByRole('button', { name: 'Save layout', exact: true }).click(); assert.equal((await saved).status(), 200);
	await page.getByRole('button', { name: 'Done editing layout', exact: true }).click();
	const result = await (await context.request.get(account.base + '/api/v1/webpages/resolve?id=settings-private-device-debug')).json();
	assert.equal(result.source, 'user'); assert.equal(result.page.author.id, account.userId); assert.deepEqual(result.page.acl, ['tt:user']);
	const find = (items, id) => items.flatMap(item => [item, ...flatten(item.children || [])]).find(item => item.id === id);
	const flatten = items => items.flatMap(item => [item, ...flatten(item.children || [])]);
	assert.equal(find(result.page.crystal.blocks, 'debug-title').text, 'Device activity'); assert.equal(find(result.page.crystal.blocks, 'debug-field-reason-label').text, 'Wait reason'); assert.equal(find(result.page.crystal.blocks, 'debug-field-reason').text, '{item.reasonLabel}');
	const publicRead = await fetch(account.base + '/api/v1/things?id=' + encodeURIComponent(result.page.id)); assert.equal(publicRead.status, 404);
	await page.reload(); await page.getByRole('heading', { name: 'Device activity', exact: true }).waitFor(); await page.screenshot({ path: join(evidence, 'saved-layout-reloaded.png'), fullPage: true });
	await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed: true, actualApi: true, layoutId: result.page.id, ownerVerified: true, acl: result.page.acl, independentlyEdited: ['debug-title', 'debug-field-reason-label'], bindingRetained: 'debug-field-reason', savedAndReloaded: true, anonymousRefused: true }, null, 2));
	console.log(JSON.stringify({ passed: true, evidence }));
} catch (error) { await page?.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), body: await page?.locator('body').innerText().catch(() => '') }, null, 2)); throw error; }
finally { await context?.close(); await rm(dir, { recursive: true, force: true }); }
