/** Real browser -> built API acceptance. The handle is a protected disposable
 * account file; credentials stay in transient memory and never enter receipts. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, '../MCP/package.json'));
assert.ok(process.env.THINGTIME_DIAGNOSTICS_FIXTURE, 'Use the protected disposable fixture handle');
const account = JSON.parse(await readFile(process.env.THINGTIME_DIAGNOSTICS_FIXTURE, 'utf8'));
assert.match(account.base, /^http:\/\/127\.0\.0\.1:\d+$/);
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-device-debug-live'));
const dir = await mkdtemp(join(tmpdir(), 'thingtime-device-debug-live-'));
let context, other, page;
const errors = [], passed = [];
try {
	await mkdir(evidence, { recursive: true });
	const { chromium, request } = require('playwright');
	context = await chromium.launchPersistentContext(join(dir, 'profile'), { headless: true, acceptDownloads: true });
	const login = await context.request.post(account.base + '/api/v1/login', { data: { username: account.username, password: account.password } }); assert.equal(login.status(), 200, 'canonical disposable login');
	const me = await context.request.get(account.base + '/api/v1/auth/me'); assert.equal((await me.json()).user.id, account.userId, 'exact fixture owner');
	const options = { headers: { 'X-Thingtime-Expected-Actor': account.userId, 'X-Thingtime-Expected-Data-Plane': 'home' } };
	let before = await (await context.request.get(account.base + '/api/v1/devices/diagnostics', options)).json(); assert.ok(before.folder?.id); assert.ok(before.events.length > 0);
	const exact = await context.request.get(account.base + '/api/v1/things?id=' + encodeURIComponent(before.folder.id), options); assert.equal(exact.status(), 200); assert.deepEqual((await exact.json()).thing.acl, ['tt:user']);
	const rootList = await (await context.request.get(account.base + '/api/v1/things?folder=root&limit=100', options)).json(); assert.ok(!rootList.things.some(t => t.id === before.folder.id));
	other = await request.newContext(); const outsider = 'debug-ui-' + randomUUID().slice(0, 8);
	const registration = await other.post(account.base + '/api/v1/auth/register', { data: { username: outsider, email: outsider + '@example.invalid', password: randomUUID() + '-Fixture!' } }); assert.equal(registration.status(), 200);
	assert.equal((await other.get(account.base + '/api/v1/things?id=' + encodeURIComponent(before.folder.id))).status(), 404);
	assert.equal((await other.get(account.base + '/api/v1/things?id=' + encodeURIComponent(before.events[0].id))).status(), 404);
	passed.push('Actual API owner exact folder read and root hiding; independent other owner refuses both folder and event.');
	page = context.pages()[0]; page.on('pageerror', e => errors.push(e.message));
	await page.goto(account.base + '/things/debug'); await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor({ timeout: 45000 });
	await page.getByText('Event details', { exact: true }).first().waitFor();
	for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
		await page.setViewportSize({ width, height }); await page.getByText('Event details', { exact: true }).first().click();
		await page.getByText('NSURLErrorDomain · -1009', { exact: true }).waitFor();
		for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += height / 2) await page.evaluate(y => scrollTo(0, y), y);
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: join(evidence, name + '-live.png'), fullPage: true });
		await page.getByText('Event details', { exact: true }).first().click();
	}
	await page.reload(); await page.getByText('Event details', { exact: true }).first().waitFor();
	passed.push('Real built /things/debug route renders saved API event/code/counters, opened details, phone/desktop scroll and reload.');
	await page.getByText('Diagnostics settings', { exact: true }).click();
	if (before.settings.enabled) { await page.getByRole('button', { name: 'Pause diagnostics capture', exact: true }).click(); await page.getByRole('button', { name: 'Enable diagnostics capture', exact: true }).waitFor(); }
	else { await page.getByRole('button', { name: 'Enable diagnostics capture', exact: true }).click(); await page.getByRole('button', { name: 'Pause diagnostics capture', exact: true }).waitFor(); }
	const changed = await (await context.request.get(account.base + '/api/v1/devices/diagnostics', options)).json(); assert.equal(changed.settings.enabled, !before.settings.enabled); assert.equal(changed.events[0].id, before.events[0].id);
	await page.reload(); await page.getByText('Diagnostics settings', { exact: true }).click();
	await page.getByRole('button', { name: before.settings.enabled ? 'Enable diagnostics capture' : 'Pause diagnostics capture', exact: true }).click();
	await page.getByRole('button', { name: before.settings.enabled ? 'Pause diagnostics capture' : 'Enable diagnostics capture', exact: true }).waitFor();
	assert.equal((await (await context.request.get(account.base + '/api/v1/devices/diagnostics', options)).json()).settings.enabled, before.settings.enabled);
	passed.push('UI capture toggle persisted, survived reload, preserved event identity, and restored its original value.');
	await page.getByText('Clear diagnostic history', { exact: true }).click(); await page.getByRole('button', { name: 'Clear saved events', exact: true }).click();
	assert.ok((await (await context.request.get(account.base + '/api/v1/devices/diagnostics', options)).json()).events.length > 0, 'first clear click is only confirmation');
	await page.getByRole('button', { name: 'Confirm clear all saved events', exact: true }).click(); await page.getByText('0 saved events shown', { exact: true }).waitFor();
	const after = await (await context.request.get(account.base + '/api/v1/devices/diagnostics', options)).json(); assert.equal(after.folder.id, before.folder.id); assert.equal(after.events.length, 0); assert.equal(after.settings.enabled, before.settings.enabled);
	await page.reload(); await page.getByText('No events match these filters.', { exact: false }).waitFor();
	passed.push('Actual confirmed snapshot clear removes saved events, preserves the private folder/capture setting, and remains empty after reload.');
	await writeFile(join(evidence, 'results.json'), JSON.stringify({ passed, pageErrors: errors, isolatedProfile: true, actualApi: true, ownerVerified: true, credentialsLogged: false, base: account.base, folderId: before.folder.id, originalEventId: before.events[0].id, builtClient: (await (await context.request.get(account.base + '/index.html')).text()).match(/src="([^"]*assets\/index-[^"]+\.js)"/)?.[1] || 'unavailable' }, null, 2));
	console.log(JSON.stringify({ passed: passed.length, evidence }));
} catch (error) {
	await page?.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
	await writeFile(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), pageErrors: errors, body: await page?.locator('body').innerText().catch(() => '') }, null, 2)); throw error;
} finally { await other?.dispose(); await context?.close(); await rm(dir, { recursive: true, force: true }); }
