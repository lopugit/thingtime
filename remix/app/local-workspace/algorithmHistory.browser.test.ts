import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';
import { parseTimelineVersionExport } from '../timeline/exportVersion';
import { algorithmContentValue } from '../timeline/algorithmContent';

const base = process.env.TT_ALGORITHM_HISTORY_URL, artifacts = process.env.TT_ALGORITHM_HISTORY_ARTIFACTS;
for (const signedIn of [false, true]) test(`native ${signedIn ? 'account' : 'anonymous'} algorithm History restores offline through the dedicated writer`,
	{ skip: !base || !artifacts || !process.env.TT_SHARED_PLAYWRIGHT_PATH, timeout: 240_000 }, async t => {
	assert.equal(new URL(base!).hostname, '127.0.0.1');
	assert.ok(process.env.TT_RENDER_SESSION);
	const health = await (await fetch(base + '/api/v1/health/nitro')).json();
	assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
	assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
	for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
		const code = await new Promise(resolve => { const socket = net.connect({ host, port: 443 }); socket.setTimeout(1500); socket.on('error', (e: any) => resolve(e.code)); socket.on('timeout', () => { socket.destroy(); resolve('timeout'); }); socket.on('connect', () => { socket.destroy(); resolve('CONNECTED'); }); });
		assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)), `Direct egress must fail closed: ${code}`);
	}
	const output = resolve(artifacts!, signedIn ? 'account' : 'anonymous'); await mkdir(output, { recursive: true });
	const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	t.after(() => browser.close());
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), page = await context.newPage();
	const url = (path: string) => new URL(path, base).href;
	const errors: string[] = [], offlineWrites: string[] = [], checks: string[] = [];
	let offline = false, holdContent = true, contentRefusals = 0, remoteReceiptCount = 0, ownerId = 'local-workspace', thingId = '';
	page.setDefaultTimeout(30_000);
	page.on('pageerror', (error: Error) => errors.push(error.message));
	page.on('request', (request: any) => { if ((offline || !signedIn) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname); });
	await context.route('**/api/v1/algorithms/sync', async (route: any) => {
		if (holdContent && route.request().postDataJSON()?.operation === 'write') {
			contentRefusals++; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Disposable fixture: content sync unavailable' }) });
		} else await route.continue();
	});
	const network = await context.newCDPSession(page); await network.send('Network.enable');
	const connectivity = async (value: boolean) => { offline = value; await context.setOffline(value); await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
	const eventually = async (check: () => Promise<boolean>, message: string) => {
		const end = Date.now() + 90_000; while (!(await check())) { assert.ok(Date.now() < end, message); await new Promise(resolve => setTimeout(resolve, 1000)); }
	};
	const recorded = () => page.evaluate(async ({ ownerId, thingId }) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('thingtime.local-workspaces.v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
		try { return await new Promise<any[]>((resolve, reject) => { const r = db.transaction('records', 'readonly').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result.filter(row => row.collection === 'timeline-events' && row.value.event.ownerId === ownerId && row.value.event.thingId === thingId).map(row => row.value)); r.onerror = () => reject(r.error); }); }
		finally { db.close(); }
	}, { ownerId, thingId });
	const api = (path: string, data?: unknown) => page.evaluate(async ({ path, data, ownerId }) => {
		const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Actor': ownerId }, body: JSON.stringify(data) });
		return { status: response.status, body: await response.json() };
	}, { path, data, ownerId });
	const openManager = async () => {
		await page.goto(url('/settings/things'));
		const section = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Feed algorithms' }) });
		if (!(await section.evaluate((node: HTMLDetailsElement) => node.open))) await section.locator('summary').click();
		await page.getByTestId('algorithm-manager').waitFor();
	};
	const name = `History profile ${randomUUID().slice(0, 6)}`, alias = `Library alias ${randomUUID().slice(0, 6)}`;
	const history = page.getByRole('dialog', { name: 'History', exact: true });
	const openHistory = async () => {
		if (new URL(page.url()).pathname !== '/things') await page.goto(url('/things'));
		await page.getByRole('link', { name: alias, exact: true }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: /History/ }).click(); await history.waitFor();
	};
	try {
		await connectivity(false);
		await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
		if (signedIn) {
			const username = 'algorithm-history-' + randomUUID().slice(0, 8);
			const response = await context.request.post(url('/api/v1/auth/register'), { headers: { Origin: base! }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
			assert.equal(response.status(), 200); ownerId = (await response.json()).user.id;
		}
		await openManager();
		await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const name of await caches.keys()) if (name.startsWith('thingtime:offline-shell:') && await (await caches.open(name)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
		await connectivity(true); await openManager();
		await page.getByRole('button', { name: 'New algorithm ➕', exact: true }).click();
		await page.getByPlaceholder('Name this algorithm…').fill(name);
		await page.getByRole('button', { name: 'Create ➕', exact: true }).click();
		const card = page.getByTestId('algorithm-card').filter({ has: page.getByRole('button', { name, exact: true }) }); await card.waitFor();
		thingId = await card.getAttribute('data-algorithm-id'); assert.ok(thingId);
		const savedCard = page.locator(`[data-algorithm-id="${thingId}"]`);
		await savedCard.getByRole('button', { name, exact: true }).click();
		await savedCard.getByRole('textbox', { name: 'Algorithm name', exact: true }).fill(name + ' edited');
		await savedCard.getByRole('textbox', { name: 'Algorithm name', exact: true }).press('Enter');
		await page.getByRole('button', { name: name + ' edited', exact: true }).waitFor();
		await eventually(async () => (await recorded()).length === 2, 'Native edits must retain independent History');
		await page.goto(url('/things'));
		await page.getByRole('link', { name: name + ' edited', exact: true }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
		await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill(alias);
		await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		await page.reload(); await page.getByRole('link', { name: alias, exact: true }).waitFor();
		checks.push('offline native create/edit/library rename and cold reload');
		await openHistory();
		await history.getByRole('button', { name: /Created Thing/ }).first().click();
		await history.getByRole('tab', { name: 'Versions', exact: true }).click();
		const original = history.locator('.history-version').filter({ hasText: 'Created Thing' });
		const downloadWait = page.waitForEvent('download'); await original.getByRole('button', { name: 'Export', exact: true }).click();
		await (await downloadWait).saveAs(resolve(output, 'algorithm-history.json'));
		const raw = JSON.parse(await readFile(resolve(output, 'algorithm-history.json'), 'utf8'));
		const archive = parseTimelineVersionExport(raw, { ownerId, thingId, id: raw.event.id });
		assert.equal(algorithmContentValue(archive.content).crystal.name, name);
		await history.getByRole('tab', { name: 'Changes', exact: true }).click();
		await history.getByRole('button', { name: 'Restore this version…', exact: true }).click();
		await history.getByRole('heading', { name: 'Review restore', exact: true }).waitFor();
		const bounds = [];
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.evaluate(() => document.fonts.ready);
			const details = width === 1440 ? history : page.getByRole('dialog', { name: 'Version details', exact: true }); await details.waitFor();
			// The narrow details sheet remounts the editor. Review again in that
			// viewport before checking its actionable confirmation.
			const review = details.getByRole('button', { name: 'Restore this version…', exact: true });
			if (await review.count()) await review.click();
			const box = await details.boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
			await details.getByRole('button', { name: 'Restore this version', exact: true }).scrollIntoViewIfNeeded();
			await page.screenshot({ path: resolve(output, `algorithm-restore-${width}.png`), animations: 'disabled' }); bounds.push({ width, box });
		}
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.getByRole('dialog', { name: 'Version details', exact: true }).waitFor({ state: 'hidden' });
		const review = history.getByRole('button', { name: 'Restore this version…', exact: true });
		if (await review.count()) await review.click();
		await history.getByRole('button', { name: 'Restore this version', exact: true }).click();
		await eventually(async () => (await recorded()).some(row => row.event.operation === 'restore'), 'Restore must commit a new device version');
		await openManager(); await page.getByRole('button', { name, exact: true }).waitFor();
		await page.reload(); await openManager(); await page.getByRole('button', { name, exact: true }).waitFor();
		await page.goto(url('/things')); await page.getByRole('link', { name: alias, exact: true }).waitFor();
		checks.push('native History preview/export/restore preserves current title through offline reload');
		assert.deepEqual(offlineWrites, []);
		if (signedIn) {
			await openHistory(); await connectivity(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
			await eventually(async () => (await recorded()).every(row => !!row.receipt), 'Real account API must acknowledge the same History drafts');
			assert.ok(contentRefusals > 0);
			const pending = await api('/api/v1/algorithms/sync', { operation: 'snapshot', expectedOwnerId: ownerId });
			assert.equal(pending.status, 200); assert.ok(!pending.body.algorithms.some((row: any) => row.id === thingId), 'History acceptance cannot upload the algorithm');
			const endpoint = '/api/v1/timeline?' + new URLSearchParams({ ownerId, thingId, dataPlane: 'home', storage: 'home' });
			const accepted = await api(endpoint); assert.equal(accepted.status, 200);
			for (const row of await recorded()) assert.deepEqual(accepted.body.entries.find((entry: any) => entry.event.id === row.event.id)?.receipt, row.receipt);
			remoteReceiptCount = (await recorded()).length;
			await writeFile(resolve(output, 'accepted-history.json'), JSON.stringify(accepted.body, null, 2));
			const exported = await api('/api/v1/timeline?' + new URLSearchParams({ ownerId, dataPlane: 'home', storage: 'home', eventId: raw.event.id, export: '1' }));
			assert.equal(exported.status, 200); parseTimelineVersionExport(exported.body, { ownerId, thingId, id: raw.event.id }, true);
			await writeFile(resolve(output, 'account-version-export.json'), JSON.stringify(exported.body, null, 2));
			const guest = await browser.newContext(); assert.equal((await guest.request.get(url(endpoint))).status(), 401); await guest.close();
			holdContent = false; await openManager();
			const retry = page.getByRole('button', { name: 'Retry sync', exact: true }); if (await retry.count()) await retry.first().click();
			await eventually(async () => { const result = await api('/api/v1/algorithms/sync', { operation: 'snapshot', expectedOwnerId: ownerId }); return result.body.algorithms?.some((row: any) => row.id === thingId && row.content.name === name && row.content.title === alias); }, 'Independent algorithm content queue must recover');
			checks.push('real private History ingestion/receipts/export during failed content sync, followed by independent content retry');
		}
		assert.deepEqual(errors, []); assert.deepEqual(offlineWrites, []);
		await writeFile(resolve(output, 'verification.json'), JSON.stringify({ checks, errors, offlineWrites, contentRefusals, remoteReceiptCount, bounds }, null, 2));
	} catch (error) {
		await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
		await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), errors, offlineWrites, contentRefusals, remoteReceiptCount }, null, 2));
		throw error;
	}
});
