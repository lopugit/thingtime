import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_FILE_SYNC_URL,
	adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH,
	artifacts = process.env.TT_LOCAL_FILE_SYNC_ARTIFACTS;
test(
	'account file adapter persists offline bytes and resumes the real private upload lifecycle',
	{ skip: !base || !adminFile || !playwrightPath, timeout: 120_000 },
	async () => {
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
		const { chromium } = await import(playwrightPath!),
			browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
			admin = await browser.newContext(),
			guest = await browser.newContext(),
			page = await context.newPage();
		page.setDefaultTimeout(20_000);
		const headers = { Origin: new URL(base!).origin },
			url = (path: string) => new URL(path, base).href,
			errors: string[] = [],
			writes: any[] = [];
		const folders: string[] = [];
		const modulePaths = new Map<string,string>();
		page.on('request', request => {
			const path = new URL(request.url()).pathname;
			if (['/app/local-workspace/runtime.client.ts','/app/local-workspace/accountApi.client.ts'].includes(path)) modulePaths.set(path,request.url());
		});
		let offline = false,
			remoteId = '',
			dropped = 0;
		page.on('framenavigated', (frame) => {
			if (frame === page.mainFrame()) writes.push({ navigation: frame.url(), offline });
		});
		page.on('console', (message) => {
			if (message.text().startsWith('[vite]')) writes.push({ vite: message.text(), offline });
		});
		page.on('pageerror', (error: Error) => errors.push(error.message));
		context.on('request', (request: any) => {
			if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
				writes.push({
					path: new URL(request.url()).pathname,
					method: request.method(),
					offline,
					actor: request.headers()['x-thingtime-expected-actor'],
					plane: request.headers()['x-thingtime-expected-data-plane']
				});
		});
		context.on('response', async (response: any) => {
			const path = new URL(response.url()).pathname;
			if (path.startsWith('/api/v1/attachments/uploads')) {
				const body = await response.json().catch(() => null);
				writes.push({
					response: path,
					status: response.status(),
					code: body?.code,
					fields: Object.keys(body || {}),
					partOrigins: body?.parts?.map((part: any) => {
						try {
							return new URL(part.url, base).origin;
						} catch {
							return 'invalid';
						}
					})
				});
			}
		});
		try {
			if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
			const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
			const adminLogin = await admin.request.post(url('/api/v1/login'), {
				headers,
				data: { username: administrator.username, password: administrator.password }
			});
			assert.equal(adminLogin.status(), 200);
			const username = 'file-reader-' + randomUUID().slice(0, 8),
				registered = await context.request.post(url('/api/v1/auth/register'), {
					headers,
					data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
				});
			assert.equal(registered.status(), 200, await registered.text());
			const owner = (await registered.json()).user;
			await page.goto(url('/things'));
			await page.getByRole('heading', { name: 'Things', exact: true }).waitFor();
			// Reuse the exact modules loaded by the real app. A bare import after
			// Vite HMR would instantiate a second, unbound workspace singleton.
			const loadedModules = ['/app/local-workspace/runtime.client.ts','/app/local-workspace/accountApi.client.ts'].map(path => modulePaths.get(path));
			assert.ok(loadedModules.every(Boolean), 'The real app loaded both workspace modules');
			await page.evaluate(paths => { (window as any).__fileFixtureModules = paths; }, loadedModules);
			const waitForAccount = async () => {
				for (let attempt = 0; attempt < 200; attempt++) {
					const ready = await page.evaluate(async () => {
						const paths = (window as any).__fileFixtureModules as string[];
						const [runtime, api] = await Promise.all(paths.map(path => import(path)));
						return !!runtime.currentAccountWorkspace() && !!api.accountApi;
					});
					if (ready) return;
					await new Promise(resolve => setTimeout(resolve,100));
				}
				throw Error('Account workspace binding did not settle');
			};
			await waitForAccount();
			// Imports can finish Vite dependency optimization; settle the actual app
			// before deliberately disconnecting its development server.
			await page.waitForLoadState('networkidle');
			offline = true;
			await context.setOffline(true);
			await waitForAccount();
			assert.equal(
				await page.evaluate(async () => {
					try {
						await fetch('/api/root-data?file-offline', { cache: 'no-store' });
						return false;
					} catch {
						return true;
					}
				}),
				true
			);
			const requestId = randomUUID(),
				text = 'Private bytes saved before account upload.';
			const localId = await page.evaluate(
				async ({ requestId, text }) => {
					const paths = (window as any).__fileFixtureModules as string[],
						[runtime, api] = await Promise.all(paths.map((path) => import(path))),
						scope = runtime.currentAccountWorkspace(),
						facade = api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane);
					const result = await facade.attachments.saveLocalFile({
						requestId,
						name: 'offline-file.txt',
						contentType: 'text/plain',
						bytes: new TextEncoder().encode(text),
						purpose: 'file'
					});
					const read = await facade.attachments.readLocalFile({ id: result.attachment.id });
					if (new TextDecoder().decode(read.bytes) !== text) throw Error('Device bytes changed');
					return result.attachment.id;
				},
				{ requestId, text }
			);
			await page.getByRole('region', { name: 'Account file sync', exact: true }).waitFor();
			assert.deepEqual(
				writes.filter((row) => row.offline && row.method),
				[]
			);
			await page.getByText('Review file sync', { exact: true }).click();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				await page.evaluate(() => scrollTo(0, 0));
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `file-sync-${width}.png`) });
			}
			offline = false;
			await context.setOffline(false);
			await page.evaluate(() => window.dispatchEvent(new Event('thingtime:root-data-refresh')));
			await page
				.getByRole('region', { name: 'Account file sync', exact: true })
				.getByRole('status')
				.filter({ hasText: 'Account upload needs attention.' })
				.waitFor();
			const blocked = await page.evaluate(async () => {
				const paths = (window as any).__fileFixtureModules as string[],
					[runtime, api] = await Promise.all(paths.map((path) => import(path)));
				return api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.status();
			});
			assert.equal(blocked[0].state, 'error');
			assert.equal(blocked[0].remoteId, undefined);
			const approval = await admin.request.post(url('/api/v1/admin/users/public-uploads'), {
				headers,
				data: { userId: owner.id, enabled: true, scope: 'private' }
			});
			assert.equal(approval.status(), 200, await approval.text());
			await context.route('**/api/v1/attachments/uploads/complete', async (route: any) => {
				if (!dropped) {
					const response = await route.fetch();
					if (response.status() === 200) {
						dropped++;
						return route.abort('failed');
					}
					return route.fulfill({ response });
				}
				return route.continue();
			});
			await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
			await page.getByRole('region', { name: 'Account file sync', exact: true }).waitFor({ state: 'hidden', timeout: 75_000 });
			remoteId = await page.evaluate(async (localId) => {
				const paths = (window as any).__fileFixtureModules as string[],
					[runtime, api] = await Promise.all(paths.map((path) => import(path)));
				return api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.remoteId(localId);
			}, localId);
			assert.ok(typeof remoteId === 'string' && remoteId.length > 0, 'completion supplies a canonical account file ID');
			const content = await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`));
			assert.equal(content.status(), 200, await content.text());
			assert.equal(await content.text(), text);
			assert.equal((await guest.request.get(url(`/api/v1/attachments/content?id=${remoteId}`))).status(), 404);
			const readRemote = async () => {
				const response = await context.request.get(url(`/api/v1/things?id=${remoteId}`));
				assert.equal(response.status(), 200);
				const thing = (await response.json()).thing;
				assert.equal(thing.author.id, owner.id);
				return thing;
			};
			const original = await readRemote();
			const annotate = (patch: any) => page.evaluate(async (patch) => {
				const paths = (window as any).__fileFixtureModules as string[];
				const [runtime, api] = await Promise.all(paths.map(path => import(path)));
				try { return { ok: true, ...await api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).transport.files.annotate(patch) }; }
				catch (error: any) { return { ok: false, status: error.status }; }
			}, { id: remoteId, ...patch });
			const edited = await annotate({ title: 'Offline file title', expectedUpdatedAt: original.updatedAt });
			assert.equal(edited.ok, true);
			assert.ok(Date.parse(edited.updatedAt) > Date.parse(original.updatedAt));
			assert.equal((await annotate({ title: 'Stale overwrite', expectedUpdatedAt: original.updatedAt })).status, 409);
			assert.equal((await annotate({ title: 'Malformed version', expectedUpdatedAt: 'invalid' })).status, 400);
			assert.equal((await readRemote()).crystal.title, 'Offline file title');
			const raced = await Promise.all([
				annotate({ title: 'First concurrent edit', expectedUpdatedAt: edited.updatedAt }),
				annotate({ title: 'Second concurrent edit', expectedUpdatedAt: edited.updatedAt })
			]);
			assert.equal(raced.filter(result => result.ok).length, 1);
			assert.equal(raced.filter(result => result.status === 409).length, 1);
			const beforeMove = await readRemote();
			const folder = await context.request.post(url('/api/v1/things'), { headers, data: { thingtime: ['folder'], crystal: { name: 'File placement fixture' }, visibility: 'private' } });
			assert.equal(folder.status(), 200);
			folders.push((await folder.json()).thing.id);
			const move = (expectedUpdatedAt: string) => page.evaluate(async ({ id, folderId, expectedUpdatedAt }) => {
				const paths = (window as any).__fileFixtureModules as string[];
				const [runtime, api] = await Promise.all(paths.map(path => import(path)));
				try { await api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).transport.files.move(id, folderId, expectedUpdatedAt); return { ok: true }; }
				catch (error: any) { return { ok: false, status: error.status }; }
			}, { id: remoteId, folderId: folders[0], expectedUpdatedAt });
			assert.equal((await move(original.updatedAt)).status, 409);
			assert.equal((await readRemote()).folderId ?? null, null);
			assert.equal((await move(beforeMove.updatedAt)).ok, true);
			assert.equal((await readRemote()).folderId, folders[0]);
			assert.equal((await move(beforeMove.updatedAt)).status, 409);
			assert.equal((await readRemote()).crystal.title, beforeMove.crystal.title);
			assert.equal(await (await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`))).text(), text);
			// Metadata authoring completes locally while the account is unreachable.
			offline = true; await context.setOffline(true);
			const localFolder = await page.evaluate(async (id) => {
				const paths = (window as any).__fileFixtureModules as string[];
				const [runtime, api] = await Promise.all(paths.map(path => import(path))), scope = runtime.currentAccountWorkspace();
				const facade = api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane);
				await facade.attachments.annotate({ id, title: 'Offline authored title', description: 'Retained while disconnected' });
				const folder = await facade.things.create({ thingtime: ['folder'], crystal: { name: 'Offline file folder' } });
				await facade.attachments.moveLocalFile({ id, folderId: folder.id });
				const read = await facade.attachments.readLocalFile({ id });
				if (read.attachment.title !== 'Offline authored title') throw Error('Local details were not saved');
				return folder.id;
			}, localId);
			folders.push(localFolder);
			assert.deepEqual(writes.filter(row => row.offline && row.method), []);
			offline = false; await context.setOffline(false);
			await page.evaluate(() => window.dispatchEvent(new Event('thingtime:root-data-refresh')));
			const fileRegion = page.getByRole('region', { name: 'Account file sync', exact: true });
			await fileRegion.getByRole('status').filter({ hasText: 'File changes need review.' }).waitFor();
			await fileRegion.getByText('Review file sync', { exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Compare file details', exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Keep device file details', exact: true }).waitFor();
			for (const width of [1440,390,320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `file-metadata-conflict-${width}.png`) });
			}
			let lostMetadata = 0;
			await context.route('**/api/v1/attachments/annotate', async (route: any) => {
				if (!lostMetadata) { const response = await route.fetch(); if (response.status() === 200) { lostMetadata++; return route.abort('failed'); } return route.fulfill({ response }); }
				return route.continue();
			});
			await fileRegion.getByRole('button', { name: 'Keep device file details', exact: true }).click();
			await fileRegion.waitFor({ state: 'hidden', timeout: 75_000 });
			const reconciled = await readRemote();
			assert.equal(reconciled.crystal.title, 'Offline authored title');
			assert.equal(reconciled.crystal.description, 'Retained while disconnected');
			assert.equal(reconciled.folderId, localFolder);
			assert.equal(lostMetadata, 1);
			assert.equal(await (await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`))).text(), text);
			assert.equal(dropped, 1);
			assert.equal(writes.filter((row) => row.method === 'PUT').length, 1);
			for (const row of writes.filter((row) => row.path?.startsWith('/api/v1/attachments/uploads'))) {
				assert.equal(row.actor, owner.id);
				assert.ok(row.plane);
			}
			// A finished file cannot be erased by a request-level cancellation.
			assert.equal((await context.request.post(url('/api/v1/attachments/uploads/abort'), { headers, data: { requestId } })).status(), 409);
			const cancelRequestId = randomUUID(), cancelText = 'Cancel this private device upload';
			let cancelledRemoteId = '', startedCancellation!: () => void;
			const cancellationStarted = new Promise<void>(resolve => { startedCancellation = resolve; });
			await context.route('**/api/v1/attachments/uploads', async (route: any) => {
				if (route.request().postDataJSON()?.requestId !== cancelRequestId) return route.continue();
				const response = await route.fetch();
				assert.equal(response.status(), 200);
				cancelledRemoteId = (await response.json()).upload.id;
				offline = true; await context.setOffline(true);
				await route.abort('failed'); startedCancellation();
			});
			const cancelLocalId = await page.evaluate(async ({ requestId, text }) => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path))), scope = runtime.currentAccountWorkspace();
				const facade = api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane);
				return (await facade.attachments.saveLocalFile({ requestId, name: 'cancel-offline.txt', contentType: 'text/plain', bytes: new TextEncoder().encode(text), purpose: 'file' })).attachment.id;
			}, { requestId: cancelRequestId, text: cancelText });
			await cancellationStarted;
			// This disposable account fills the real browser workspace to its exact
			// 64 MiB cap. Only fixture-owned filler bytes are written here.
			await page.evaluate(async () => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path))), scope = runtime.currentAccountWorkspace();
				const files = api.accountWorkspaceWorker(scope).files;
				await files.db.transaction(scope, 'readwrite', files.lease, async (tx: any) => {
					let remaining = 64 * 1024 * 1024 - (await tx.usage()).bytes, index = 0;
					while (remaining > 0) { const size = Math.min(16 * 1024 * 1024, remaining); await tx.putBytes('cancel-quota-fixture-' + index++, new Uint8Array(size)); remaining -= size; }
					if ((await tx.usage()).bytes !== 64 * 1024 * 1024) throw Error('Quota fixture did not fill exactly');
				});
			});
			await fileRegion.waitFor();
			await fileRegion.getByText('Review file sync', { exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Cancel upload', exact: true }).click();
			await fileRegion.getByText(/Cancellation queued; device bytes are retained/).waitFor();
			assert.equal(await page.evaluate(async id => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path)));
				return new TextDecoder().decode((await api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.things.readFile(id)).bytes);
			}, cancelLocalId), cancelText);
			for (const width of [1440,390,320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `file-cancellation-${width}.png`) });
			}
			assert.deepEqual(writes.filter(row => row.offline && row.method), []);
			let lostCancellation = 0;
			await context.route('**/api/v1/attachments/uploads/abort', async (route: any) => {
				if (!lostCancellation && route.request().postDataJSON()?.requestId === cancelRequestId) {
					const response = await route.fetch();
					if (response.status() === 200) { lostCancellation++; return route.abort('failed'); }
					return route.fulfill({ response });
				}
				return route.continue();
			});
			offline = false; await context.setOffline(false);
			await page.evaluate(() => window.dispatchEvent(new Event('thingtime:root-data-refresh')));
			await fileRegion.waitFor({ state: 'hidden', timeout: 75_000 });
			assert.equal(await page.evaluate(async id => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path)));
				try { await api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.things.readFile(id); return false; }
				catch (error: any) { return error.status === 404; }
			}, cancelLocalId), true);
			const replayCancelled = (id: string) => context.request.post(url('/api/v1/attachments/uploads'), { headers,
				data: { requestId: id, filename: 'cancel-offline.txt', contentType: 'text/plain', sizeBytes: new TextEncoder().encode(cancelText).length, purpose: 'file' } });
			assert.equal(lostCancellation, 1);
			const replay = await replayCancelled(cancelRequestId);
			assert.equal(replay.status(), 409); assert.equal((await replay.json()).code, 'upload_cancelled');
			assert.equal((await context.request.post(url('/api/v1/attachments/delete'), { headers, data: { id: cancelledRemoteId } })).status(), 200);
			assert.equal((await replayCancelled(cancelRequestId)).status(), 409, 'Legacy cleanup must retain the durable receipt');
			for (const client of [context, guest]) assert.equal((await client.request.get(url(`/api/v1/attachments/content?id=${cancelledRemoteId}`))).status(), 404);
			const beforeStart = randomUUID();
			const cancelledFirst = await context.request.post(url('/api/v1/attachments/uploads/abort'), { headers, data: { requestId: beforeStart } });
			assert.equal(cancelledFirst.status(), 200); assert.equal((await cancelledFirst.json()).cancelled, true);
			assert.equal((await replayCancelled(beforeStart)).status(), 409);
			const competing = randomUUID();
			const [raceStart, raceCancel] = await Promise.all([
				replayCancelled(competing), context.request.post(url('/api/v1/attachments/uploads/abort'), { headers, data: { requestId: competing } })
			]);
			assert.ok([200,409].includes(raceStart.status())); assert.equal(raceCancel.status(), 200);
			assert.equal((await replayCancelled(competing)).status(), 409);
			// Exercise conditional deletion on the real database and storage lifecycle.
			const deleteFile = (expectedUpdatedAt: unknown) => context.request.post(url('/api/v1/attachments/delete'), {
				headers, data: { id: remoteId, expectedUpdatedAt }
			});
			assert.equal((await deleteFile(null)).status(), 400);
			assert.equal((await deleteFile(original.updatedAt)).status(), 409);
			assert.equal(await (await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`))).text(), text);
			// Queue deletion offline against an account version edited elsewhere.
			const changed = await context.request.post(url('/api/v1/attachments/annotate'), { headers, data: { id: remoteId, title: 'Changed before offline deletion', expectedUpdatedAt: (await readRemote()).updatedAt } });
			assert.equal(changed.status(), 200);
			const queueDeletion = () => page.evaluate(async id => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path))), scope = runtime.currentAccountWorkspace();
				const files = api.accountWorkspaceWorker(scope).files;
				await files.db.transaction(scope, 'readwrite', files.lease, async (tx: any) => {
					const remaining = 64 * 1024 * 1024 - (await tx.usage()).bytes;
					if (remaining) await tx.putBytes('delete-quota-' + crypto.randomUUID(), new Uint8Array(remaining));
				});
				const facade = api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane);
				await facade.attachments.deleteLocalFile({ id });
				try { await files.things.get(id); throw Error('Deleted file remained visible'); } catch (error: any) { if (error.status !== 404) throw error; }
				await files.db.transaction(scope, 'readonly', files.lease, async (tx: any) => { if (!await tx.getBytes(id)) throw Error('Recovery bytes missing before acknowledgement'); });
			}, localId);
			offline = true; await context.setOffline(true); await queueDeletion();
			assert.deepEqual(writes.filter(row => row.offline && row.method), []);
			offline = false; await context.setOffline(false);
			await page.evaluate(() => window.dispatchEvent(new Event('thingtime:root-data-refresh')));
			await fileRegion.getByText('Review file sync', { exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Review file deletion', exact: true }).click();
			for (const width of [1440, 390, 320]) {
				await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
				assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
				if (artifacts) await page.screenshot({ path: resolve(artifacts, `file-deletion-review-${width}.png`), fullPage: true });
			}
			const reviewed = await readRemote();
			assert.equal((await context.request.post(url('/api/v1/attachments/annotate'), { headers, data: { id: remoteId, title: 'Changed after review', expectedUpdatedAt: reviewed.updatedAt } })).status(), 200);
			await fileRegion.getByRole('button', { name: 'Delete reviewed account file', exact: true }).click();
			await fileRegion.getByRole('alert').filter({ hasText: 'changed' }).waitFor();
			assert.equal(await (await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`))).text(), text);
			await fileRegion.getByRole('button', { name: 'Close review', exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Review file deletion', exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Keep device file', exact: true }).click();
			await fileRegion.waitFor({ state: 'hidden' });
			assert.equal(await page.evaluate(async id => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path)));
				return new TextDecoder().decode((await api.accountWorkspaceWorker(runtime.currentAccountWorkspace()).files.things.readFile(id)).bytes);
			}, localId), text);
			offline = true; await context.setOffline(true); await queueDeletion();
			let lostDeletion = 0, deletionRaced = false;
			let reportDeleteRace!: (status: number) => void;
			const deleteRaceFinished = new Promise<number>(resolve => { reportDeleteRace = resolve; });
			const deletionBodies: unknown[] = [];
			await context.route('**/api/v1/attachments/delete', async (route: any) => {
				const input = route.request().postDataJSON();
				if (input?.requestId !== requestId) return route.continue();
				deletionBodies.push(input);
				if (!lostDeletion) {
					let response;
					if (!deletionRaced) {
						deletionRaced = true;
						const [deleting, editing] = await Promise.all([route.fetch(), context.request.post(url('/api/v1/attachments/annotate'), { headers, data: { id: remoteId, title: 'Racing reviewed deletion', expectedUpdatedAt: input.expectedUpdatedAt } })]);
						assert.equal([deleting, editing].filter(r => r.status() === 200).length, 1, 'Reviewed deletion and concurrent edit must have exactly one winner');
						if (editing.status() === 200) { assert.equal(deleting.status(), 409); assert.equal(await (await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}&download=1`))).text(), text); }
						else assert.ok([404,409].includes(editing.status()));
						response = deleting; reportDeleteRace(deleting.status());
					} else response = await route.fetch();
					if (response.status() === 200) { assert.equal((await response.json()).deleted, true); lostDeletion++; return route.abort('failed'); }
					return route.fulfill({ response });
				}
				return route.continue();
			});
			offline = false; await context.setOffline(false);
			await page.evaluate(() => window.dispatchEvent(new Event('thingtime:root-data-refresh')));
			await fileRegion.getByText('Review file sync', { exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Review file deletion', exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Delete reviewed account file', exact: true }).click();
			if (await deleteRaceFinished === 409) {
				await fileRegion.getByRole('button', { name: 'Review file deletion', exact: true }).click();
				await fileRegion.getByRole('button', { name: 'Delete reviewed account file', exact: true }).click();
			}
			await fileRegion.waitFor({ state: 'hidden', timeout: 75_000 });
			assert.equal(deletionRaced, true); assert.equal(lostDeletion, 1); assert.ok(deletionBodies.length >= 2); assert.deepEqual(deletionBodies.at(-1), deletionBodies.at(-2));
			assert.equal((await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}`))).status(), 404);
			const lateStart = await context.request.post(url('/api/v1/attachments/uploads'), { headers, data: { requestId, filename: 'offline-file.txt', contentType: 'text/plain', sizeBytes: new TextEncoder().encode(text).length, purpose: 'file' } });
			assert.equal(lateStart.status(), 409); assert.equal((await lateStart.json()).code, 'upload_cancelled');
			assert.equal((await deleteFile(reconciled.updatedAt)).status(), 200, 'Legacy cleanup cannot remove the fence');
			offline = true; await context.setOffline(true);
			await page.evaluate(async () => {
				const paths = (window as any).__fileFixtureModules as string[], [runtime, api] = await Promise.all(paths.map(path => import(path))), scope = runtime.currentAccountWorkspace();
				const files = api.accountWorkspaceWorker(scope).files;
				await files.db.transaction(scope, 'readwrite', files.lease, (tx: any) => tx.deleteBytes('cancel-quota-fixture-0'));
				const facade = api.accountApi({ things: {}, attachments: {} }, { id: scope.ownerId }, scope.dataPlane);
				await facade.attachments.saveLocalFile({ requestId: crypto.randomUUID(), name: 'never-started.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('Never send'), purpose: 'file' });
				await files.db.transaction(scope, 'readwrite', files.lease, async (tx: any) => {
					let remaining = 64 * 1024 * 1024 - (await tx.usage()).bytes, index = 0;
					while (remaining > 0) { const size = Math.min(16 * 1024 * 1024, remaining); await tx.putBytes('cancel-never-started-fill-' + index++, new Uint8Array(size)); remaining -= size; }
				});
			});
			await fileRegion.waitFor();
			await fileRegion.getByText('Review file sync', { exact: true }).click();
			await fileRegion.getByRole('button', { name: 'Cancel upload', exact: true }).click();
			await fileRegion.waitFor({ state: 'hidden' });
			assert.deepEqual(writes.filter(row => row.offline && row.method), []);
			assert.deepEqual(errors, []);
			if (artifacts)
				await writeFile(
					resolve(artifacts, 'verification.json'),
					JSON.stringify(
						{
							adapterOnly: true,
							conditionalAnnotation: true,
							conditionalDeletion: true,
							durableCancellation: true,
							lostCancellationReceipt: true,
							fullQuotaCancellation: true,
							preStartAndConcurrentCancellation: true,
							cancelRequestId,
							cancelledRemoteId,
							editDeleteSingleWinner: true,
							durableOfflineDeletion: true,
							fullQuotaDeletionAndRestore: true,
							staleDeletionReviewRefused: true,
							lostDeletionReceipt: true,
							concurrentEditSingleWinner: true,
							conditionalPlacement: true,
							durableOfflineMetadata: true,
							reviewedConflictResolution: true,
							lostMetadataReceipt: true,
							folderDependency: true,
							offlineBytes: true,
							permissionRefusalPreservesBytes: true,
							privateUploadApprovedThroughAdminApi: true,
							lostCompletionReceipt: true,
							putCount: 1,
							remoteId,
							guestRefused: true,
							writes,
							errors
						},
						null,
						2
					)
				);
		} catch (error) {
			if (artifacts) {
				await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true });
				await writeFile(
					resolve(artifacts, 'failure.json'),
					JSON.stringify({ body: await page.locator('body').innerText(), writes, errors }, null, 2)
				);
			}
			throw error;
		} finally {
			try {
				await context.setOffline(false);
				if (remoteId) {
					const removed = await context.request.post(url('/api/v1/attachments/delete'), { headers, data: { id: remoteId } });
					assert.equal(removed.status(), 200, 'File fixture cleanup uses the dedicated attachment lifecycle');
					assert.equal((await context.request.get(url(`/api/v1/attachments/content?id=${remoteId}`))).status(), 404);
				}
				for (const id of folders) assert.equal((await context.request.delete(url(`/api/v1/things?id=${id}`), { headers })).status(), 200);
			} finally {
				try {
					for (const c of [context, admin, guest]) await c.request.post(url('/api/v1/auth/logout'), { headers });
				} finally { await browser.close(); }
			}
		}
	}
);
