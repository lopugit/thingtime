import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeTransferArchive, encodeTransferArchive, transferChecksum } from '../utils/thingTransfer/archive';
import { orderedTransferAttachments, validateTransfer, type ThingTransfer } from '../utils/thingTransfer/format';

const base = process.env.TT_LINKED_GALLERY_URL, artifacts = process.env.TT_LINKED_GALLERY_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE;

for (const account of [false, true]) test(`native ${account ? 'account' : 'anonymous'} linked gallery import preserves mixed order offline${account ? ' and recovers a lost link receipt privately' : ''}`, {
	skip: !base || !artifacts || !playwrightPath || (account && !adminFile), timeout: 360_000
}, async t => {
	assert.equal(new URL(base!).hostname, '127.0.0.1');
	assert.ok(process.env.TT_RENDER_SESSION, 'Use the disposable isolated full-app runtime.');
	const origin = new URL(base!).origin, evidence = resolve(artifacts!, account ? 'account' : 'anonymous');
	const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
	assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
	assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
	await mkdir(evidence, { recursive: true });
	const { chromium } = await import(playwrightPath!);
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	t.after(() => browser.close());
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
	const page = await context.newPage(), guest = await browser.newContext();
	const url = (path: string) => new URL(path, origin).href;
	const runId = randomUUID(), folderName = 'Linked gallery ' + runId.slice(0, 8), postText = 'Private mixed gallery · 独立 🌿 ' + runId;
	const bytes = Buffer.from('Stored gallery bytes\n' + runId + '\n');
	const links = [
		{ id: 'first-link', targetId: 'post', url: 'https://gallery.example.test/first.txt?view=1#leaf', mediaKind: 'file', title: 'First URL 🌿', description: 'First description\n第二行', filenamePreview: 'first-display.txt' },
		{ id: 'second-link', targetId: 'post', url: 'https://gallery.example.test/second.txt?view=2', mediaKind: 'file', title: 'Second URL 🍑', description: 'Second description\nExact spacing.', filenamePreview: 'second-display.txt' }
	];
	const manifest = validateTransfer({ format: 'thingtime.transfer', version: 1, roots: ['folder'], things: [
		{ id: 'folder', thingtime: ['folder'], crystal: { name: folderName } },
		{ id: 'post', thingtime: ['post'], folderId: 'folder', crystal: { type: 'text', text: postText } }
	], files: [{ id: 'stored', targetId: 'post', path: 'files/000000', name: 'stored.txt', mime: 'text/plain', bytes: bytes.length,
		sha256: await transferChecksum(bytes) }],
	links, attachmentOrder: ['second-link', 'stored', 'first-link'] });
	const archive = Buffer.from(await encodeTransferArchive({ manifest, files: new Map([['stored', bytes]]) }));
	const writes: any[] = [], externalRequests: any[] = [], errors: string[] = [], bounds: any[] = [], linkAttempts: any[] = [];
	let offline = false, importing = false, ownerId = '', sourceRoot = '', copyRoot = '', sourcePost = '', copyPost = '';
	let lostRequestId = '', lostReceipt: any = null, holdLostRetry = true;
	const network = await context.newCDPSession(page);
	await network.send('Network.enable');
	const connectivity = async (value: boolean) => {
		if (!value) offline = false;
		await context.setOffline(value);
		await network.send('Network.overrideNetworkState', { offline: value, latency: 1,
			downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
		if (value) offline = true;
		assert.equal(await page.evaluate(() => navigator.onLine), !value);
	};
	page.setDefaultTimeout(25_000);
	page.on('pageerror', (error: Error) => errors.push(error.message));
	page.on('request', (request: any) => {
		const target = new URL(request.url());
		if (target.hostname === 'gallery.example.test') externalRequests.push({ url: target.href, importing, offline });
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ path: target.pathname, offline,
			actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] });
	});
	const api = (method: string, path: string, data?: unknown) => page.evaluate(async ({ method, path, data, ownerId }) => {
		const response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
			headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': 'home', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
			...(data === undefined ? {} : { body: JSON.stringify(data) }) });
		return { status: response.status, body: await response.json() };
	}, { method, path, data, ownerId });
	const poll = async (read: () => Promise<any>, accepts: (value: any) => boolean) => {
		const deadline = Date.now() + 95_000; let last: any;
		while (Date.now() < deadline) { last = await read(); if (accepts(last)) return last; await page.waitForTimeout(350); }
		throw Error('Linked gallery did not converge: ' + JSON.stringify(last));
	};
	// Read only this disposable browser's current partition. Writes use native UI/API.
	const snapshot = () => page.evaluate(async ({ account, ownerId }) => {
		const scope = account ? JSON.stringify(['account', location.origin, ownerId, 'home']) : JSON.stringify(['anonymous', 1]);
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('thingtime.local-workspaces.v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			const rows = await new Promise<any[]>((resolve, reject) => {
				const request = db.transaction('records').objectStore('records').getAll();
				request.onsuccess = () => resolve(request.result.filter((row: any) => row.scope === scope)); request.onerror = () => reject(request.error);
			});
			return { things: rows.filter(row => row.collection === 'things').map(row => row.value),
				files: rows.filter(row => row.collection === 'account-files').map(row => ({ id: row.id, state: row.value.state,
					request: row.value.request, remote: row.value.remote, phase: row.value.phase, error: row.value.error })),
				byteIds: rows.filter(row => row.collection === '@bytes').map(row => row.id) };
		} finally { db.close(); }
	}, { account, ownerId });
	const folderLink = (id: string) => page.locator(`[data-thing-id="${id}"]`).first();
	const importArchive = async (content: Buffer, expectedFolders: number) => {
		await page.goto(url('/things'));
		await page.getByRole('button', { name: 'Import…', exact: true }).click();
		importing = true;
		await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles({ name: 'linked-gallery.thingtime.zip', mimeType: 'application/zip', buffer: content });
		await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		const state = await poll(snapshot, value => value.things.filter((row: any) => row.thingtime.includes('folder')).length === expectedFolders);
		importing = false;
		return state;
	};
	const portableContent = (value: ThingTransfer) => orderedTransferAttachments(value).map(item => ({
		...('url' in item ? { url: item.url, mediaKind: item.mediaKind } : { name: item.name, mime: item.mime, bytes: item.bytes, sha256: item.sha256 }),
		title: item.title, description: item.description, filenamePreview: item.filenamePreview
	}));
	const exportFolder = async (id: string, label: string) => {
		await page.goto(url('/things'));
		await folderLink(id).click({ button: 'right' });
		await page.getByRole('menuitem', { name: '📥 Download…', exact: true }).click();
		await page.getByLabel('Download format', { exact: true }).selectOption('zip');
		const waiting = page.waitForEvent('download');
		await page.getByRole('dialog').getByRole('button', { name: 'Download', exact: true }).click();
		const download = await waiting, path = resolve(evidence, label + '.thingtime.zip');
		await download.saveAs(path);
		const content = await readFile(path), bundle = await decodeTransferArchive(content);
		assert.equal(bundle.manifest.things.length, 2); assert.equal(bundle.manifest.links?.length, 2); assert.equal(bundle.files.size, 1);
		assert.deepEqual(portableContent(bundle.manifest), portableContent(manifest));
		assert.deepEqual(Buffer.from([...bundle.files.values()][0]), bytes);
		assert.doesNotMatch(JSON.stringify(bundle.manifest), /localLinkedAttachment|localAttachment|objectKey|ownerId|requestId|visibility/);
		return { content, manifest: bundle.manifest };
	};
	const loseLinkReply = async (route: any) => {
		if (route.request().method() !== 'POST') return route.continue();
		const input = route.request().postDataJSON(); linkAttempts.push(input);
		assert.ok(input.requestId);
		if (!lostRequestId) {
			lostRequestId = input.requestId;
			const response = await route.fetch(); assert.equal(response.status(), 200, await response.text());
			lostReceipt = await response.json();
			return route.abort('failed'); // Real server commit; its first response never reaches the app.
		}
		if (input.requestId === lostRequestId && holdLostRetry) return route.fulfill({ status: 503, contentType: 'application/json',
			body: JSON.stringify({ ok: false, error: 'Isolated receipt retry hold' }) });
		return route.continue();
	};
	try {
		await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
		if (account) {
			const username = 'linkedgallery-' + runId.slice(0, 8);
			const registration = await context.request.post(url('/api/v1/auth/register'), { headers: { Origin: origin },
				data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
			assert.equal(registration.status(), 200, await registration.text()); ownerId = (await registration.json()).user.id;
			const credentials = JSON.parse(await readFile(adminFile!, 'utf8')), admin = await browser.newContext(), adminPage = await admin.newPage();
			await adminPage.goto(url('/.well-known/thingtime-capabilities.json'));
			assert.equal(await adminPage.evaluate(async credentials => (await fetch('/api/v1/login', { method: 'POST',
				headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })).status,
			{ username: credentials.username, password: credentials.password }), 200);
			// Post/comment byte uploads use the public-purpose approval gate even
			// when their eventual parent audience is private. Grant through its API.
			for (const scope of ['private', 'public']) assert.equal(await adminPage.evaluate(async ({ userId, scope }) =>
				(await fetch('/api/v1/admin/users/public-uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ userId, enabled: true, scope }) })).status, { userId: ownerId, scope }), 200);
			await admin.close();
		}
		await connectivity(false); await page.goto(url('/things'));
		await page.getByRole('button', { name: 'Import…', exact: true }).waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') &&
				await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
			return false;
		});
		await page.waitForLoadState('networkidle'); await connectivity(true); await page.reload();
		const original = await importArchive(archive, 1);
		sourceRoot = original.things.find((row: any) => row.thingtime.includes('folder')).id;
		sourcePost = original.things.find((row: any) => row.thingtime.includes('post')).id;
		assert.equal(original.things.filter((row: any) => row.targetId === sourcePost).length, 3);
		await page.reload();
		const first = await exportFolder(sourceRoot, 'source-cold-offline');
		const importedAgain = await importArchive(first.content, 2);
		copyRoot = importedAgain.things.find((row: any) => row.thingtime.includes('folder') && row.id !== sourceRoot).id;
		copyPost = importedAgain.things.find((row: any) => row.thingtime.includes('post') && row.id !== sourcePost).id;
		await page.reload();
		const copied = await exportFolder(copyRoot, 'reimport-cold-offline');
		const priorIds = new Set([...first.manifest.things, ...first.manifest.files, ...(first.manifest.links || [])].map(row => row.id));
		assert.ok([...copied.manifest.things, ...copied.manifest.files, ...(copied.manifest.links || [])].every(row => !priorIds.has(row.id)));
		assert.deepEqual((await exportFolder(sourceRoot, 'source-unchanged')).manifest, first.manifest);
		await page.goto(url('/post/' + copyPost)); await page.getByText(postText, { exact: true }).first().waitFor(); await page.reload();
		await page.getByText(postText, { exact: true }).first().waitFor();
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			await page.getByText('stored.txt', { exact: true }).first().scrollIntoViewIfNeeded();
			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
			assert.equal(scrollWidth, width); bounds.push({ width, scrollWidth });
			await page.screenshot({ path: resolve(evidence, `gallery-${width}.png`), animations: 'disabled' });
		}
		assert.deepEqual(writes.filter(row => row.offline), []); assert.deepEqual(externalRequests, []);
		const local = await snapshot();
		const galleryMedia = local.things.filter((row: any) => [sourcePost, copyPost].includes(row.targetId));
		assert.equal(galleryMedia.filter((row: any) => local.byteIds.includes(row.id)).length, 2);
		assert.ok(galleryMedia.filter((row: any) => row.localLinkedAttachment).every((row: any) => !local.byteIds.includes(row.id)),
			'Only stored files receive byte records; linked records contain metadata.');
		if (account) {
			assert.equal(local.files.length, 6); assert.ok(local.files.every((row: any) => !row.remote));
			await page.route('**/api/v1/attachments/link', loseLinkReply);
			await page.setViewportSize({ width: 1440, height: 1000 });
			await connectivity(false); await page.goto(url('/things'));
			await poll(async () => lostReceipt, value => !!value);
			const firstRequest = linkAttempts.find(row => row.requestId === lostRequestId);
			const lostId = lostReceipt.attachment.id;
			assert.ok(lostId);
			const interrupted = await snapshot(), interruptedFile = interrupted.files.find((row: any) => row.request.requestId === lostRequestId);
			assert.ok(interruptedFile); assert.equal(interruptedFile.remote, undefined);
			const waitingParent = interrupted.things.find((row: any) => row.id === interruptedFile.id).targetId;
			assert.ok([sourcePost, copyPost].includes(waitingParent));
			assert.equal((await api('GET', '/api/v1/things?id=' + waitingParent)).status, 404);
			const otherParent = waitingParent === sourcePost ? copyPost : sourcePost;
			await poll(() => api('GET', '/api/v1/things?id=' + otherParent), value => value.status === 200 && value.body.post?.attachments?.length === 3);
			holdLostRetry = false;
			await page.reload();
			const settled = await poll(snapshot, value => value.files.length === 6 && value.files.every((row: any) => row.state === 'synced' && row.remote?.id));
			assert.equal(settled.files.find((row: any) => row.request.requestId === lostRequestId).remote.id, lostId);
			const retries = linkAttempts.filter(row => row.requestId === lostRequestId);
			assert.ok(retries.length >= 2); for (const retry of retries) assert.deepEqual(retry, firstRequest);
			assert.equal(new Set(settled.files.map((row: any) => row.remote.id)).size, 6);
			for (const postId of [sourcePost, copyPost]) {
				const remote = await poll(() => api('GET', '/api/v1/things?id=' + postId), value => {
					const media = value.body.post?.attachments;
					return value.status === 200 && media?.length === 3 &&
						JSON.stringify(media.map((row: any) => row.title || row.name)) === JSON.stringify(['Second URL 🍑', 'stored.txt', 'First URL 🌿']) &&
						links.every(expected => {
							const actual = media.find((row: any) => row.url === expected.url);
							return actual && ['url', 'mediaKind', 'title', 'description', 'filenamePreview'].every(field => actual[field] === (expected as any)[field]);
						});
				});
				assert.equal(remote.body.thing.author.id, ownerId); assert.equal(remote.body.thing.visibility, 'private');
				const media = remote.body.post.attachments;
				assert.deepEqual(media.map((row: any) => row.title || row.name), ['Second URL 🍑', 'stored.txt', 'First URL 🌿']);
				for (const expected of links) {
					const actual = media.find((row: any) => row.url === expected.url); assert.ok(actual);
					for (const field of ['url', 'mediaKind', 'title', 'description', 'filenamePreview']) assert.equal(actual[field], (expected as any)[field]);
				}
				const storedId = media[1].id;
				const stored = await page.evaluate(async id => {
					const response = await fetch('/api/v1/attachments/content?id=' + encodeURIComponent(id) + '&download=1', { redirect: 'error' });
					return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
				}, storedId);
				assert.equal(stored.status, 200); assert.deepEqual(Buffer.from(stored.bytes), bytes);
				assert.equal((await guest.request.get(url('/api/v1/attachments/content?id=' + storedId + '&download=1'))).status(), 404);
				assert.equal((await guest.request.get(url('/api/v1/things?id=' + postId))).status(), 404);
				for (const item of media) assert.equal((await guest.request.get(url('/api/v1/things?id=' + item.id))).status(), 404);
			}
			assert.equal(writes.some(row => row.path === '/api/v1/things/import'), false);
			for (const row of writes.filter(row => ['/api/v1/attachments/link', '/api/v1/attachments/uploads', '/api/v1/things'].includes(row.path))) {
				assert.equal(row.actor, ownerId); assert.equal(row.plane, 'home');
			}
		}
		assert.deepEqual(writes.filter(row => row.offline), []); assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
		await writeFile(resolve(evidence, 'verification.json'), JSON.stringify({ account, runId, sourceRoot, copyRoot, sourcePost, copyPost,
			nativeImport: true, coldOfflineReload: true, mixedOrder: true, exactMetadata: true, exactStoredBytes: true,
			canonicalExportReimport: true, independentIds: true, noExternalUrlFetch: true, lostRequestId, lostReceipt, linkAttempts,
			privateGuestRefusal: account, bounds, writes, externalRequests, errors }, null, 2));
	} catch (error) {
		await page.screenshot({ path: resolve(evidence, 'failure.png'), timeout: 5000 }).catch(() => {});
		await writeFile(resolve(evidence, 'failure.json'), JSON.stringify({ error: String(error), sourceRoot, copyRoot, sourcePost, copyPost,
			body: await page.locator('body').innerText().catch(() => ''), local: await snapshot().catch(() => null),
			lostRequestId, lostReceipt, linkAttempts, writes, externalRequests, errors }, null, 2));
		throw error;
	} finally { await page.unroute('**/api/v1/attachments/link', loseLinkReply).catch(() => {}); await context.setOffline(false).catch(() => {}); }
});

for (const account of [false, true]) test(`native ${account ? 'account' : 'anonymous'} URL composer drafts and templates keep independent links through offline posting`, {
	skip: !base || !artifacts || !playwrightPath, timeout: 300_000
}, async t => {
	assert.equal(new URL(base!).hostname, '127.0.0.1');
	assert.ok(process.env.TT_RENDER_SESSION);
	const origin = new URL(base!).origin, evidence = resolve(artifacts!, account ? 'account-composer' : 'anonymous-composer');
	const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
	assert.equal(health.testEnvironment?.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
	await mkdir(evidence, { recursive: true });
	const { chromium } = await import(playwrightPath!);
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	t.after(() => browser.close());
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), guest = await browser.newContext();
	const page = await context.newPage(), network = await context.newCDPSession(page), url = (path: string) => new URL(path, origin).href;
	await network.send('Network.enable');
	const runId = randomUUID(), text = 'Offline URL draft ' + runId.slice(0, 8), copiedText = 'Independent URL template ' + runId.slice(0, 8);
	const linkedUrls = ['https://gallery.example.test/direct-first.txt?draft=' + runId, 'https://gallery.example.test/direct-second.txt?draft=' + runId];
	const writes: any[] = [], externalRequests: string[] = [], draftRequests: string[] = [], errors: string[] = [], bounds: any[] = [];
	let offline = false, ownerId = '', sourceId = '', postId = '', templateId = '', draftId = '';
	const connectivity = async (value: boolean) => {
		if (!value) offline = false;
		await context.setOffline(value);
		await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000,
			uploadThroughput: 100_000_000, connectionType: 'ethernet' });
		if (value) offline = true;
		assert.equal(await page.evaluate(() => navigator.onLine), !value);
	};
	page.setDefaultTimeout(25_000);
	page.on('pageerror', (error: Error) => errors.push(error.message));
	page.on('request', (request: any) => {
		const target = new URL(request.url());
		if (target.hostname === 'gallery.example.test') externalRequests.push(target.href);
		if (target.pathname === '/api/v1/drafts') draftRequests.push(request.method());
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ path: target.pathname, offline,
			actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] });
	});
	const records = () => page.evaluate(async ({ account, ownerId }) => {
		const scope = account ? JSON.stringify(['account', location.origin, ownerId, 'home']) : JSON.stringify(['anonymous', 1]);
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('thingtime.local-workspaces.v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try { return await new Promise<any[]>((resolve, reject) => {
			const request = db.transaction('records').objectStore('records').getAll();
			request.onsuccess = () => resolve(request.result.filter((row: any) => row.scope === scope)); request.onerror = () => reject(request.error);
		}); } finally { db.close(); }
	}, { account, ownerId });
	const poll = async (read: () => Promise<any>, accepts: (value: any) => boolean) => {
		const deadline = Date.now() + 95_000; let last: any;
		while (Date.now() < deadline) { last = await read(); if (accepts(last)) return last; await page.waitForTimeout(300); }
		throw Error('URL draft did not converge: ' + JSON.stringify(last));
	};
	const expand = async () => {
		const collapsed = page.getByRole('button', { name: "What's on your mind? ✨", exact: true });
		if (await collapsed.count()) await collapsed.click();
		await page.locator('.ce-paragraph[contenteditable="true"]').first().waitFor();
	};
	const publish = async (content: string) => {
		const drafts = (await records()).filter((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.draft?.mode === 'draft').map((row: any) => row.id);
		await page.getByRole('button', { name: account ? 'Post ✨' : 'Save on this device', exact: true }).click();
		const rows = await poll(records, rows => rows.some((row: any) => row.collection === 'things' && row.value.thingtime.includes('post') && row.value.crystal.text === content));
		const id = rows.find((row: any) => row.collection === 'things' && row.value.thingtime.includes('post') && row.value.crystal.text === content).id;
		// The content transaction can precede the native success handler. Wait
		// for that UI and its spent-draft marker before changing the route.
		if (account) await page.locator(`[data-thing-id="${id}"]`).waitFor();
		else await page.waitForURL(value => value.pathname === '/post/' + id);
		await poll(records, rows => drafts.every((id: string) => !rows.some((row: any) => row.collection === 'drafts' && row.id === id && !row.value.deleted)));
		await page.goto(url('/post/' + id)); await page.getByText(content, { exact: true }).first().waitFor();
		return id;
	};
	const api = (path: string) => page.evaluate(async path => {
		const response = await fetch(path, { credentials: 'same-origin', redirect: 'error' });
		return { status: response.status, body: await response.json() };
	}, path);
	try {
		await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
		if (account) {
			const username = 'urldraft-' + runId.slice(0, 8);
			const registration = await context.request.post(url('/api/v1/auth/register'), { headers: { Origin: origin },
				data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
			assert.equal(registration.status(), 200, await registration.text()); ownerId = (await registration.json()).user.id;
		}
		await connectivity(false); await page.goto(url('/feed'));
		await page.getByRole('button', { name: "What's on your mind? ✨", exact: true }).waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
			return false;
		});
		await page.waitForLoadState('networkidle'); await connectivity(true); await page.reload(); await expand();
		if (account) await page.getByLabel('Who can see this post', { exact: true }).selectOption('private');
		await page.locator('.ce-paragraph[contenteditable="true"]').first().pressSequentially(text);
		await page.getByRole('button', { name: '🖼️ Photos', exact: true }).click();
		const media = page.getByRole('group', { name: 'Post attachments', exact: true });
		for (const linkedUrl of linkedUrls) {
			await media.getByRole('textbox', { name: 'Add media by URL', exact: true }).fill(linkedUrl);
			await media.getByRole('button', { name: 'Add', exact: true }).click();
		}
		const savedRows = await poll(records, rows => rows.some((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.draft?.mode === 'draft' && row.value.draft.attachmentIds?.length === 2));
		const saved = savedRows.find((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.draft?.mode === 'draft' && row.value.draft.attachmentIds?.length === 2).value.draft;
		draftId = saved.id;
		assert.equal(new Set(saved.attachmentIds).size, 2);
		await page.reload(); await expand();
		await poll(() => page.locator('.ce-paragraph[contenteditable="true"]').first().innerText(), value => value === text);
		for (const name of ['direct-first.txt', 'direct-second.txt']) await page.getByText(name, { exact: true }).first().waitFor();
		sourceId = await publish(text);
		await page.reload(); await page.getByText(text, { exact: true }).first().waitFor();
		await page.getByRole('button', { name: 'Post options', exact: true }).first().click();
		await page.getByText('Save as template', { exact: true }).click();
		const templated = await poll(records, rows => rows.some((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.draft?.mode === 'template'));
		const template = templated.find((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.draft?.mode === 'template').value.draft;
		templateId = template.id;
		const sourceLinks = templated.filter((row: any) => row.collection === 'things' && row.value.targetId === sourceId && row.value.localLinkedAttachment).map((row: any) => row.id);
		assert.equal(sourceLinks.length, 2); assert.equal(template.attachmentIds.length, 2);
		assert.ok(template.attachmentIds.every((id: string) => !sourceLinks.includes(id)));
		await page.getByRole('button', { name: 'Post options', exact: true }).first().click(); await page.getByText('Delete', { exact: true }).click();
		await poll(records, rows => !rows.some((row: any) => row.collection === 'things' && row.id === sourceId));
		await page.goto(url('/feed')); await expand();
		await page.getByRole('button', { name: 'Load drafts & templates', exact: true }).click();
		const picker = page.getByRole('dialog').filter({ hasText: 'Your drafts & templates' });
		await picker.getByRole('button', { name: 'Templates', exact: true }).click();
		await picker.getByRole('button', { name: new RegExp(text) }).click(); await picker.waitFor({ state: 'hidden' });
		await poll(() => page.locator('.ce-paragraph[contenteditable="true"]').first().innerText(), value => value === text);
		const working = await poll(records, rows => rows.some((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.source?.id === templateId));
		const copy = working.find((row: any) => row.collection === 'drafts' && !row.value.deleted && row.value.source?.id === templateId).value.draft;
		assert.equal(copy.attachmentIds.length, 2); assert.ok(copy.attachmentIds.every((id: string) => !template.attachmentIds.includes(id)));
		const editor = page.locator('.ce-paragraph[contenteditable="true"]').first();
		await editor.press('ControlOrMeta+A'); await editor.pressSequentially(copiedText);
		postId = await publish(copiedText);
		await page.reload(); await page.getByText(copiedText, { exact: true }).first().waitFor();
		const completed = await records(), postLinks = completed.filter((row: any) => row.collection === 'things' && row.value.targetId === postId && row.value.localLinkedAttachment)
			.sort((a: any, b: any) => a.value.localLinkedAttachment.order - b.value.localLinkedAttachment.order);
		assert.deepEqual(postLinks.map((row: any) => row.value.crystal.url), linkedUrls);
		assert.ok(postLinks.every((row: any) => !sourceLinks.includes(row.id) && !template.attachmentIds.includes(row.id)));
		assert.ok(postLinks.every((row: any) => !completed.some((entry: any) => entry.collection === '@bytes' && entry.id === row.id)));
		assert.ok(completed.some((row: any) => row.collection === 'drafts' && row.id === templateId && !row.value.deleted));
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			await page.getByText('direct-first.txt', { exact: true }).first().scrollIntoViewIfNeeded();
			const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth); assert.equal(scrollWidth, width);
			bounds.push({ width, scrollWidth }); await page.screenshot({ path: resolve(evidence, `url-post-${width}.png`), animations: 'disabled' });
		}
		assert.deepEqual(writes.filter(row => row.offline), []); assert.deepEqual(externalRequests, []);
		if (account) {
			await connectivity(false); await page.reload();
			const remote = await poll(() => api('/api/v1/things?id=' + postId), value => value.status === 200 && value.body.post?.attachments?.length === 2);
			assert.equal(remote.body.thing.author.id, ownerId); assert.deepEqual(remote.body.thing.acl, ['tt:user']);
			assert.deepEqual(remote.body.post.attachments.map((row: any) => row.url), linkedUrls);
			const remoteTemplate = await poll(() => api('/api/v1/drafts?id=' + templateId), value => value.status === 200 && value.body.draft?.attachmentIds?.length === 2);
			assert.ok(remoteTemplate.body.draft.attachmentIds.every((id: string) => !remote.body.post.attachments.some((row: any) => row.id === id)));
			assert.equal((await api('/api/v1/things?id=' + sourceId)).status, 404);
			assert.equal((await guest.request.get(url('/api/v1/things?id=' + postId))).status(), 404);
			assert.equal((await guest.request.get(url('/api/v1/drafts?id=' + templateId))).status(), 401);
			for (const id of [...remoteTemplate.body.draft.attachmentIds, ...remote.body.post.attachments.map((row: any) => row.id)])
				assert.equal((await guest.request.get(url('/api/v1/things?id=' + id))).status(), 404);
		} else { assert.deepEqual(draftRequests, []); assert.deepEqual(writes, []); }
		assert.deepEqual(writes.filter(row => row.offline), []); assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
		await writeFile(resolve(evidence, 'verification.json'), JSON.stringify({ account, runId, draftId, sourceId, templateId, postId,
			nativeUrlComposer: true, coldOfflineDraftReload: true, independentTemplateLinks: true, sourceDeleted: true,
			privatePostBinding: true, noExternalUrlFetch: true, noLinkedBytes: true, bounds, writes, draftRequests, errors }, null, 2));
	} catch (error) {
		await page.screenshot({ path: resolve(evidence, 'failure.png'), timeout: 5000 }).catch(() => {});
		await writeFile(resolve(evidence, 'failure.json'), JSON.stringify({ error: String(error), draftId, sourceId, templateId, postId,
			body: await page.locator('body').innerText().catch(() => ''), records: await records().catch(() => []), writes, draftRequests, externalRequests, errors }, null, 2));
		throw error;
	} finally { await context.setOffline(false).catch(() => {}); }
});
