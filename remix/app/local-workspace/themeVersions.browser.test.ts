import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';
import { parseTimelineVersionExport } from '../timeline/exportVersion';
import { themeContentValue } from '../timeline/themeContent';
import { decodeThingtime } from '../Providers/thingtimeSerialization';
import { workspaceScopeKey } from './storage';

const base = process.env.TT_THEME_VERSIONS_URL,
	output = process.env.TT_THEME_VERSIONS_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

for (const { account, customPlane } of [
	{ account: false, customPlane: false },
	{ account: true, customPlane: false },
	{ account: true, customPlane: true }
])
	test(
		`native ${account ? (customPlane ? 'custom-plane account' : 'account') : 'anonymous'} theme History reviews restore, undo and merge offline`,
		{ skip: !base || !output || !playwrightPath, timeout: 180_000 },
		async (t) => {
			assert.equal(new URL(base!).hostname, '127.0.0.1');
			const health = await (await fetch(base + '/api/v1/health/nitro')).json();
			assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
			assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
			for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
				const code = await new Promise((resolve) => {
					const socket = net.connect({ host, port: 443 });
					socket.setTimeout(1500);
					socket.on('error', (error: any) => resolve(error.code));
					socket.on('timeout', () => {
						socket.destroy();
						resolve('timeout');
					});
					socket.on('connect', () => {
						socket.destroy();
						resolve('CONNECTED');
					});
				});
				assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)), `Direct egress must fail closed: ${code}`);
			}
			const artifacts = resolve(output!, account ? (customPlane ? 'custom-plane-account' : 'account') : 'anonymous');
			await mkdir(artifacts, { recursive: true });
			const { chromium } = await import(playwrightPath!);
			const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
			t.after(() => browser.close());
			const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }),
				page = await context.newPage();
			const errors: string[] = [],
				writes: string[] = [];
			let offline = false,
				ownerId = 'local-workspace',
				selectedPlane = 'home';
			page.setDefaultTimeout(25_000);
			page.on('pageerror', (error: Error) => errors.push(error.message));
			page.on('request', (request: any) => {
				if ((offline || !account) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname);
			});
			const network = await context.newCDPSession(page);
			await network.send('Network.enable');
			const connectivity = async (value: boolean) => {
				if (!value) offline = false;
				await context.setOffline(value);
				await network.send('Network.overrideNetworkState', {
					offline: value,
					latency: 1,
					downloadThroughput: 100_000_000,
					uploadThroughput: 100_000_000,
					connectionType: 'ethernet'
				});
				if (value) offline = true;
			};
			const eventually = async (check: () => Promise<boolean>, label: string) => {
				for (let i = 0; i < 150; i++) {
					if (await check()) return;
					await new Promise((resolve) => setTimeout(resolve, 200));
				}
				assert.fail(label);
			};
			const name = 'History design ' + randomUUID().slice(0, 6),
				initial = '#885544',
				second = '#aa6644',
				third = '#bb7755';
			const history = page.getByRole('dialog', { name: 'History', exact: true });
			const records = () =>
				page.evaluate(async (name) => {
					const db = await new Promise<IDBDatabase>((resolve, reject) => {
						const r = indexedDB.open('thingtime.local-workspaces.v1');
						r.onsuccess = () => resolve(r.result);
						r.onerror = () => reject(r.error);
					});
					try {
						return await new Promise<any[]>((resolve, reject) => {
							const r = db.transaction('records', 'readonly').objectStore('records').getAll();
							r.onsuccess = () =>
								resolve(
									r.result
										.filter(
											(row) =>
												row.collection === 'timeline-events' &&
												(row.value.event.after?.value?.crystal?.name === name || row.value.event.before?.value?.crystal?.name === name)
										)
										.map((row) => ({ ...row.value, workspaceScope: row.scope }))
								);
							r.onerror = () => reject(r.error);
						});
					} finally {
						db.close();
					}
				}, name);
			const applySaved = async (accent: string) => {
				await page.getByRole('button', { name: 'Apply', exact: true }).click();
				await page.locator(`input:not([type="color"])[value="${accent}"]`).waitFor();
				await eventually(async () => {
					const trees = await page.evaluate(async () => {
						const db = await new Promise<IDBDatabase>((resolve, reject) => {
							const r = indexedDB.open('thingtime.local-workspaces.v1');
							r.onsuccess = () => resolve(r.result);
							r.onerror = () => reject(r.error);
						});
						try {
							return await new Promise<string[]>((resolve, reject) => {
								const r = db.transaction('records', 'readonly').objectStore('records').getAll();
								r.onsuccess = () =>
									resolve(r.result.filter((row) => row.id === 'editor-tree:root:v1').map((row) => new TextDecoder().decode(row.value)));
								r.onerror = () => reject(r.error);
							});
						} finally {
							db.close();
						}
					});
					return trees.some((tree: string) => decodeThingtime(tree).value.settings?.theme?.overrides?.colors?.accent === accent);
				}, 'Applied restored design must finish its durable editor save');
			};
			const openEdit = async (first = false) => {
				await page.getByRole('button', { name: 'History', exact: true }).click();
				await history
					.getByRole('button', { name: /Edited Thing/ })
					.first()
					.click();
				await history.getByRole('tab', { name: 'Versions', exact: true }).click();
				const edits = history.locator('.history-version').filter({ hasText: 'Edited Thing' });
				await (first ? edits.first() : edits.last()).getByRole('button').first().click();
				await history.getByRole('tab', { name: 'Changes', exact: true }).click();
			};
			try {
				await connectivity(false);
				await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
				if (account) {
					const username = 'theme-versions-' + randomUUID().slice(0, 8);
					const response = await context.request.post(base + '/api/v1/auth/register', {
						headers: { Origin: base! },
						data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
					});
					assert.equal(response.status(), 200);
					ownerId = (await response.json()).user.id;
				}
				await page.goto(base + '/themes');
				const browserApi = async (path: string, data?: unknown) =>
					page.evaluate(
						async ({ path, data, ownerId }) => {
							const response = await fetch(
								path,
								data === undefined
									? {}
									: {
											method: 'POST',
											headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': ownerId },
											body: JSON.stringify(data)
									  }
							);
							return { status: response.status, body: await response.json() };
						},
						{ path, data, ownerId }
					);
				if (account) {
					const root = await browserApi('/api/root-data');
					assert.equal(root.body.user.id, ownerId);
				}
				if (customPlane) {
					const { body: storage } = await browserApi('/api/v1/mongodb/status');
					assert.equal(storage.host, '127.0.0.1:27017');
					assert.match(storage.replicaSet, /^tt-agent-/);
					const database = 'theme_history_' + randomUUID().replace(/-/g, '');
					const activated = await browserApi('/api/v1/mongodb/endpoint', {
						url: `mongodb://127.0.0.1:27017/${database}?replicaSet=${encodeURIComponent(storage.replicaSet)}`
					});
					assert.equal(activated.status, 200, JSON.stringify(activated.body));
					assert.equal(activated.body.endpoint.custom, true);
					const root = await browserApi('/api/root-data');
					selectedPlane = root.body.dataPlane;
					assert.match(selectedPlane, /^custom-/);
					await page.reload();
				}
				await page.getByRole('button', { name: 'Save theme 💾', exact: true }).waitFor();
				await page.waitForFunction(async () => {
					await navigator.serviceWorker.ready;
					if (!navigator.serviceWorker.controller) return false;
					for (const key of await caches.keys())
						if (key.startsWith('thingtime:offline-shell:') && (await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')))
							return true;
					return false;
				});
				await page.waitForLoadState('networkidle');
				await connectivity(true);
				await page.reload();
				await page.waitForLoadState('networkidle');
				await page.locator('input:not([type="color"])[value="hotpink"]').first().fill(initial);
				await page.getByPlaceholder(/^e.g. .* remix/).fill(name);
				await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
				await eventually(async () => (await records()).length === 1, 'Creation must commit locally');
				await eventually(() => page.getByRole('button', { name: 'Save theme 💾', exact: true }).isEnabled(), 'Save must finish');
				await page.getByText(name + ' ⭐', { exact: true }).waitFor();
				await page.reload();
				await page.locator(`input:not([type="color"])[value="${initial}"]`).waitFor();
				for (const [before, after, count] of [
					[initial, second, 2],
					[second, third, 3]
				] as const) {
					await page.locator(`input:not([type="color"])[value="${before}"]`).fill(after);
					await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
					await eventually(async () => (await records()).length === count, 'Edit must commit locally');
					await eventually(() => page.getByRole('button', { name: 'Save theme 💾', exact: true }).isEnabled(), 'Save must finish');
					await page.reload();
					await page.locator(`input:not([type="color"])[value="${after}"]`).waitFor();
				}
				const expectedScope = workspaceScopeKey(
					account ? { kind: 'account', ownerId, origin: new URL(base!).origin, dataPlane: 'home' } : { kind: 'anonymous' }
				);
				for (const row of await records())
					assert.equal(row.workspaceScope, expectedScope, 'Theme Studio child controls must author Home History under a custom selection');
				// Undo the earlier edit while a later edit overlaps: the normal comparison
				// must require a reviewed choice and preserve all recorded versions.
				await openEdit(true);
				await history.getByRole('button', { name: 'Undo this change…', exact: true }).click();
				await history.getByText('Both versions changed', { exact: false }).waitFor();
				await history.getByRole('button', { name: 'Use the earlier value', exact: true }).click();
				await history.getByRole('button', { name: 'Review choices', exact: true }).click();
				await history.getByRole('button', { name: 'Undo this change', exact: true }).click();
				await eventually(async () => (await records()).length === 4, 'Reviewed undo must commit once');
				await history.getByRole('button', { name: 'Close', exact: true }).click();
				// Applying a saved theme is separate from restoring its recorded design.
				await applySaved(initial);
				await page.reload();
				await page.locator(`input:not([type="color"])[value="${initial}"]`).waitFor();
				await openEdit(true);
				await history.getByRole('button', { name: 'Restore this version…', exact: true }).click();
				const bounds = [];
				for (const width of [1440, 390, 320]) {
					await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
					await page.evaluate(() => document.fonts.ready);
					const details = width === 1440 ? history : page.getByRole('dialog', { name: 'Version details', exact: true });
					await details.waitFor();
					const review = details.getByRole('button', { name: 'Restore this version…', exact: true });
					if (await review.isVisible()) await review.click();
					const button = details.getByRole('button', { name: 'Restore this version', exact: true });
					await button.scrollIntoViewIfNeeded();
					const box = await button.boundingBox();
					const geometry = await button.evaluate((node: HTMLElement) => {
						const rect = node.getBoundingClientRect();
						let port: HTMLElement | null = node.parentElement;
						while (port && !['auto', 'scroll'].includes(getComputedStyle(port).overflowY)) port = port.parentElement;
						const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
						return {
							button: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
							scrollport: port
								? { height: port.clientHeight, top: port.scrollTop, scrollHeight: port.scrollHeight, bounds: port.getBoundingClientRect().toJSON() }
								: null,
							hit: !!hit && (hit === node || node.contains(hit))
						};
					});
					await writeFile(resolve(artifacts, `restore-${width}-geometry.json`), JSON.stringify(geometry, null, 2));
					assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= (width === 1440 ? 1000 : 844));
					const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
					assert.equal(scrollWidth, width);
					assert.equal(geometry.hit, true, 'Restore must receive pointer input above floating controls');
					bounds.push({ width, scrollWidth, button: box });
					await page.screenshot({ path: resolve(artifacts, `restore-${width}.png`), animations: 'disabled' });
				}
				await page.setViewportSize({ width: 1440, height: 1000 });
				const reviewAgain = history.getByRole('button', { name: 'Restore this version…', exact: true });
				if (await reviewAgain.isVisible()) await reviewAgain.click();
				await history.getByRole('button', { name: 'Restore this version', exact: true }).click();
				await eventually(async () => (await records()).length === 5, 'Restore must commit once');
				await history.getByRole('button', { name: 'Close', exact: true }).click();
				// Applying a saved theme is separate from restoring its recorded design.
				await applySaved(second);
				await page.reload();
				await page.locator(`input:not([type="color"])[value="${second}"]`).waitFor();
				await openEdit(false);
				await history.getByRole('button', { name: 'Review and combine…', exact: true }).click();
				await history.getByRole('button', { name: 'Apply merge', exact: true }).click();
				await eventually(async () => (await records()).length === 6, 'Merge must preserve the ancestry as a new version');
				await history.getByRole('button', { name: 'Close', exact: true }).click();
				// Applying a saved theme is separate from restoring its recorded design.
				await applySaved(second);
				await page.reload();
				await page.locator(`input:not([type="color"])[value="${second}"]`).waitFor();
				await openEdit(true);
				await history.getByRole('tab', { name: 'Versions', exact: true }).click();
				const [download] = await Promise.all([
					page.waitForEvent('download'),
					history.locator('.history-version').filter({ hasText: 'Edited Thing' }).first().getByRole('button', { name: 'Export', exact: true }).click()
				]);
				const exportedPath = resolve(artifacts, 'theme-history.json');
				await download.saveAs(exportedPath);
				const raw = JSON.parse(await readFile(exportedPath, 'utf8'));
				const exported = parseTimelineVersionExport(raw, { ownerId, thingId: raw.event.thingId, id: raw.event.id });
				if (account) {
					assert.equal(exported.receipt, null);
					assert.deepEqual(exported.context, { source: 'device', complete: false });
				}
				const colors = themeContentValue(exported.content).crystal.theme.colors;
				assert.ok(colors && typeof colors === 'object' && !Array.isArray(colors));
				assert.equal(colors.accent, second);
				await history.getByRole('button', { name: 'Close', exact: true }).click();
				let remoteHome = false,
					guestStatus: number | null = null;
				if (customPlane) {
					await connectivity(false);
					await page.reload();
					await page.getByText(name + ' ⭐', { exact: true }).waitFor();
					await eventually(async () => {
						const result = await page.evaluate(
							async ({ selectedPlane, ownerId }) => {
								const response = await fetch('/api/v1/themes/sync', {
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										'X-Thingtime-Expected-Data-Plane': selectedPlane,
										'X-Thingtime-Expected-Actor': ownerId
									},
									body: JSON.stringify({ operation: 'snapshot', expectedOwnerId: ownerId })
								});
								return { status: response.status, body: await response.json() };
							},
							{ selectedPlane, ownerId }
						);
						if (result.status !== 200) return false;
						remoteHome =
							result.body.storagePlane === 'home' &&
							result.body.themes?.some((row: any) => row.id === raw.event.thingId && row.theme.colors.accent === second);
						return remoteHome;
					}, 'Custom-selected session must synchronize the restored theme to Home');
					const guest = await browser.newContext();
					try {
						guestStatus = (await guest.request.get(base + '/api/v1/themes/shared?id=' + raw.event.thingId)).status();
						assert.equal(guestStatus, 404);
					} finally {
						await guest.close();
					}
				}
				assert.deepEqual(errors, []);
				assert.deepEqual(writes, []);
				await writeFile(
					resolve(artifacts, 'verification.json'),
					JSON.stringify(
						{
							account,
							customPlane,
							selectedPlane,
							remoteHome,
							guestStatus,
							nativeExport: true,
							nativeRestore: true,
							nativeUndoConflict: true,
							nativeMerge: true,
							explicitApplyAfterHistory: true,
							coldOfflineReload: true,
							bounds,
							errors,
							writes
						},
						null,
						2
					)
				);
			} catch (error) {
				await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
				await writeFile(
					resolve(artifacts, 'failure.json'),
					JSON.stringify(
						{
							error: String(error),
							body: await page
								.locator('body')
								.innerText()
								.catch(() => ''),
							inputs: await page
								.locator('input')
								.evaluateAll((inputs: HTMLInputElement[]) => inputs.map((input) => ({ type: input.type, value: input.value })))
								.catch(() => []),
							records: await records().catch(() => []),
							errors,
							writes
						},
						null,
						2
					)
				);
				throw error;
			}
		}
	);
