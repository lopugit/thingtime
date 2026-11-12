import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseTransfer } from '../utils/thingTransfer/format';
const base = process.env.TT_RETAINED_THEMES_URL,
	artifacts = process.env.TT_RETAINED_THEMES_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'native retained theme review and recovery export work offline without moving the source or publishing either copy',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 180000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			page = await context.newPage();
		const headers: Record<string, string> = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' };
		const url = (path: string) => new URL(path, origin).href,
			errors: string[] = [],
			writes: string[] = [];
		let offline = false;
		page.setDefaultTimeout(25000);
		page.on('pageerror', (error: Error) => errors.push(error.message));
		page.on('request', (request: any) => {
			if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname);
		});
		await mkdir(resolve(artifacts!), { recursive: true });
		try {
			const status = await context.request.get(url('/api/v1/mongodb/status'));
			assert.equal(status.status(), 200);
			const storage = await status.json();
			assert.equal(storage.host, '127.0.0.1:22463');
			assert.equal(storage.custom, false);
			assert.equal(storage.connected, true);
			const username = 'retained-' + randomUUID().slice(0, 8),
				name = 'Home original ' + randomUUID().slice(0, 6);
			const registered = await context.request.post(url('/api/v1/auth/register'), {
				headers,
				data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
			});
			assert.equal(registered.status(), 200);
			const owner = (await registered.json()).user.id;
			headers['X-Thingtime-Expected-Actor'] = owner;
			await page.goto(url('/themes'));
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
			await page.waitForFunction(async () => {
				await navigator.serviceWorker.ready;
				if (!navigator.serviceWorker.controller) return false;
				for (const key of await caches.keys())
					if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
						return true;
				return false;
			});
			offline = true;
			await context.setOffline(true);
			await page.reload();
			await page.getByPlaceholder(/^e.g. .* remix/).fill(name);
			await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
			await page.getByText(name + ' ⭐', { exact: true }).waitFor();
			// Reproduce a pre-migration device partition using the real UI's newly saved
			// records. Only this disposable browser's own IDB is seeded; no Mongo writes.
			const fixture = await page.evaluate(
				async ({ owner, origin, name }: any) => {
					const db = await new Promise<IDBDatabase>((done, fail) => {
						const r = indexedDB.open('thingtime.local-workspaces.v1');
						r.onsuccess = () => done(r.result);
						r.onerror = () => fail(r.error);
					});
					try {
						const home = JSON.stringify(['account', origin, owner, 'home']),
							legacy = JSON.stringify(['account', origin, owner, 'custom-' + 'a'.repeat(64)]);
						const tx = db.transaction(['records', 'usage'], 'readwrite'),
							records = tx.objectStore('records');
						const all: any[] = await new Promise((done, fail) => {
							const r = records.getAll();
							r.onsuccess = () => done(r.result);
							r.onerror = () => fail(r.error);
						});
						const source = all.find((r) => r.scope === home && r.collection === 'things' && r.value.crystal?.name === name);
						if (!source) throw Error('Missing real saved theme');
						const originals = all.filter((r) => r.scope === home && r.id === source.id && ['things', 'account-theme-sync'].includes(r.collection));
						if (originals.length !== 2) throw Error('Incomplete real theme intent');
						const cloned = originals.map((r) => {
							const row = structuredClone(r);
							row.scope = legacy;
							if (row.collection === 'things') {
								row.value.crystal.name = 'Retained peach';
								row.value.crystal.title = 'Retained title';
								row.value.crystal.theme.colors.accent = '#bf8068';
							}
							row.bytes = new TextEncoder().encode(JSON.stringify(row.value)).byteLength;
							return row;
						});
						for (const row of cloned) records.put(row);
						const usage = { scope: legacy, records: cloned.length, bytes: cloned.reduce((sum, r) => sum + r.bytes, 0) };
						tx.objectStore('usage').put(usage);
						await new Promise<void>((done, fail) => {
							tx.oncomplete = () => done();
							tx.onabort = () => fail(tx.error);
						});
						return { legacy, sourceId: source.id, records: cloned, usage };
					} finally {
						db.close();
					}
				},
				{ owner, origin, name }
			);
			await page.reload();
			const panel = page.getByLabel('Retained theme edits', { exact: true });
			await panel.waitFor();
			await panel.getByRole('button', { name: 'Review Retained peach', exact: true }).click();
			await panel.getByLabel('Retained theme comparison').waitFor();
			await panel.getByText('Theme data', { exact: true }).click();
			assert.ok((await panel.innerText()).includes('#bf8068'));
			await panel.getByText('Theme data', { exact: true }).click();
			await panel.getByRole('button', { name: 'Keep a private home copy', exact: true }).click();
			await panel.getByRole('status').waitFor();
			await page.getByText(name + ' ⭐', { exact: true }).waitFor();
			const exportedIds: string[] = [];
			for (const width of [1440, 390, 320]) {
				// Dismiss this fixture's completed-operation notices before visual
				// capture; stacked download notices otherwise cover the phone controls.
				for (const button of await page.locator('.lopuToast').getByRole('button', {name:'Close',exact:true}).elementHandles())
					if (await button.isVisible()) await button.click();
				await page.waitForFunction(() => !document.querySelector('.lopuToast'));
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				await panel.scrollIntoViewIfNeeded();
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				await page.screenshot({ path: resolve(artifacts!, `review-${width}.png`), animations: 'disabled' });
				await panel.getByRole('button', { name: 'Download recovered theme', exact: true }).click();
				await page.getByLabel('Download format', { exact: true }).selectOption('json');
				const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
				const path = resolve(artifacts!, `recovered-${width}.json`);
				await download.saveAs(path);
				const manifest = parseTransfer(await readFile(path, 'utf8'));
				assert.equal(manifest.things.length, 1);
				assert.equal(manifest.things[0].crystal.name, 'Retained peach (device copy)');
				assert.equal(manifest.things[0].crystal.title, 'Retained title');
				assert.equal((manifest.things[0].crystal.theme as any).colors.accent, '#bf8068');
				assert.notEqual(manifest.roots[0], fixture.sourceId);
				exportedIds.push(manifest.roots[0]);
				await page.getByRole('dialog').waitFor({ state: 'hidden' });
			}
			assert.equal(new Set(exportedIds).size, 1);
			await page.reload();
			await page.getByRole('button', { name: 'Review Retained peach', exact: true }).click();
			await page.getByRole('button', { name: 'Keep a private home copy', exact: true }).click();
			await page.getByLabel('Retained theme edits', { exact: true }).getByRole('status').waitFor();
			await page.getByText(name + ' ⭐', { exact: true }).waitFor();
			const after = await page.evaluate(async ({ legacy, home }: any) => {
				const db = await new Promise<IDBDatabase>((done, fail) => {
					const r = indexedDB.open('thingtime.local-workspaces.v1');
					r.onsuccess = () => done(r.result);
					r.onerror = () => fail(r.error);
				});
				try {
					const tx = db.transaction(['records', 'usage'], 'readonly');
					const values: any[] = await new Promise((done) => {
						const r = tx.objectStore('records').getAll();
						r.onsuccess = () => done(r.result);
					});
					return {source: values.filter((row) => row.scope === legacy),
						copies: values.filter(row => row.scope === home && row.collection === 'things' && row.value.crystal?.name === 'Retained peach (device copy)').map(row => row.id)};
				} finally {
					db.close();
				}
			}, {...fixture,home:JSON.stringify(['account',origin,owner,'home'])});
			assert.deepEqual(after.copies,[exportedIds[0]],'reload and retry preserve one recovered identity');
			assert.deepEqual(
				after.source.sort((a: any, b: any) => a.collection.localeCompare(b.collection)),
				fixture.records.sort((a: any, b: any) => a.collection.localeCompare(b.collection))
			);
			const remote = await context.request.post(url('/api/v1/themes/sync'), { headers, data: { operation: 'snapshot', expectedOwnerId: owner } });
			assert.equal(remote.status(), 200);
			assert.deepEqual((await remote.json()).themes, []);
			assert.deepEqual(writes, []);
			assert.deepEqual(errors, []);
			await writeFile(
				resolve(artifacts!, 'verification.json'),
				JSON.stringify(
					{ viewports: [1440, 390, 320], offlineWrites: writes, errors, sourcePreserved: true, activeThemePreserved: true, recoveredCopies: 1, canonicalExports: 3, remoteThemes: 0 },
					null,
					2
				)
			);
		} catch (error) {
			await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }).catch(() => {});
			throw error;
		} finally {
			await context.close();
			await browser.close();
		}
	}
);
