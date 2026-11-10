import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_DRAFT_WEB_BASE, output = process.env.TT_DRAFT_ARTIFACT_DIR;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('native offline import accepts twenty independent transfers and retains exact copies after cold reload', {
	skip: !base || !output || !playwrightPath, timeout: 180_000
}, async t => {
	assert.equal(new URL(base!).hostname, '127.0.0.1');
	const health = await (await fetch(base + '/api/v1/health/nitro')).json();
	assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
	assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
	for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
		const code = await new Promise(resolve => {
			const socket = net.connect({ host, port: 443 }); socket.setTimeout(1500);
			socket.on('error', (error: any) => resolve(error.code));
			socket.on('timeout', () => { socket.destroy(); resolve('timeout'); });
			socket.on('connect', () => { socket.destroy(); resolve('CONNECTED'); });
		});
		assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)), `Direct egress must fail closed: ${code}`);
	}
	await mkdir(output!, { recursive: true });
	const { chromium } = await import(playwrightPath!);
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	t.after(() => browser.close());
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
	page.setDefaultTimeout(25_000);
	const errors: string[] = [], writes: string[] = [], bounds: { width: number; dialogWidth: number; scrollWidth: number }[] = [];
	page.on('pageerror', (error: Error) => errors.push(error.message));
	page.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
	const network = await context.newCDPSession(page); await network.send('Network.enable');
	try {
		await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
		await page.goto(base + '/things');
		await page.getByRole('button', { name: 'Import…', exact: true }).waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
			return false;
		});
		await context.setOffline(true);
		await network.send('Network.overrideNetworkState', { offline: true, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
		assert.equal(await page.evaluate(() => navigator.onLine), false);
		await page.getByRole('button', { name: 'Import…', exact: true }).click();
		const files = Array.from({ length: 20 }, (_, index) => ({
			name: `independent-${index}.thingtime.json`, mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['same-portable-id'],
				things: [{ id: 'same-portable-id', thingtime: ['data'], crystal: { name: `Capacity transfer ${index}`, text: `独立 ${index} 🌿` } }], files: [] }))
		}));
		await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles(files);
		await page.getByText('20 transfers ready to import', { exact: true }).waitFor();
		const dialog = page.getByRole('dialog');
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			const box = await dialog.evaluate((node: HTMLElement) => ({ dialogWidth: node.getBoundingClientRect().width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
			assert.ok(box.dialogWidth <= width); assert.equal(box.clientWidth, box.scrollWidth);
			await dialog.getByRole('button', { name: 'Import all 20 transfers', exact: true }).scrollIntoViewIfNeeded();
			bounds.push({ width, dialogWidth: box.dialogWidth, scrollWidth: box.scrollWidth });
			await page.screenshot({ path: resolve(output!, `transfer-batch-${width}.png`), animations: 'disabled' });
		}
		await dialog.getByRole('button', { name: 'Import all 20 transfers', exact: true }).click();
		await dialog.waitFor({ state: 'hidden', timeout: 90_000 });
		await page.reload();
		await page.getByRole('button', { name: 'Import…', exact: true }).waitFor();
		const retained = await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('thingtime.local-workspaces.v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			try {
				const rows = await new Promise<any[]>((resolve, reject) => { const request = db.transaction('records', 'readonly').objectStore('records').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
				return { records: rows.filter(row => row.collection === 'things' && row.value.crystal.name?.startsWith('Capacity transfer ')).map(row => ({ id: row.id, scope: row.scope, crystal: row.value.crystal })),
					accountRecords: rows.filter(row => row.scope !== JSON.stringify(['anonymous', 1])).length };
			} finally { db.close(); }
		});
		assert.equal(retained.records.length, 20); assert.equal(new Set(retained.records.map(row => row.id)).size, 20);
		assert.ok(retained.records.every(row => row.id !== 'same-portable-id' && row.scope === JSON.stringify(['anonymous', 1])));
		for (let index = 0; index < 20; index++) assert.equal(retained.records.find(row => row.crystal.name === `Capacity transfer ${index}`)?.crystal.text, `独立 ${index} 🌿`);
		assert.equal(retained.accountRecords, 0); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
		await writeFile(resolve(output!, 'verification.json'), JSON.stringify({ anonymous: true, offline: true, transfers: 20, independentIds: true, exactUnicode: true, coldReload: true, retained, bounds, writes, errors }, null, 2));
	} catch (error) {
		await page.screenshot({ path: resolve(output!, 'failure.png') }).catch(() => {});
		await writeFile(resolve(output!, 'failure.txt'), await page.locator('body').innerText().catch(() => ''));
		await writeFile(resolve(output!, 'failure.json'), JSON.stringify({ errors, writes, bounds, error: error instanceof Error ? error.message : String(error) }, null, 2));
		throw error;
	}
});
