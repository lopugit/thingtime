import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

const origin = process.env.TT_SHARED_COPY_ORIGIN, session = process.env.TT_SHARED_COPY_SESSION;
const artifacts = process.env.TT_SHARED_COPY_ARTIFACTS, fixture = process.env.TT_SHARED_COPY_FIXTURE;
const puppeteerPath = process.env.TT_SHARED_COPY_PUPPETEER, executablePath = process.env.TT_SHARED_COPY_CHROME;
const largeFile = process.env.TT_SHARED_COPY_LARGE_FILE === '1';
const adminFile = process.env.TT_SHARED_COPY_ADMIN_FIXTURE;
const safeCode = (body: any) => typeof body?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(body.code) ? body.code : 'NO_SAFE_ERROR_CODE';

test('native anonymous shared-copy button retains editable closure offline; normal saved profile Action Run button uses device adapters', {
	skip: !origin || !session || !artifacts || !fixture || !puppeteerPath || !executablePath, timeout: 240_000
}, async testContext => {
	assert.equal(new URL(origin!).hostname, '127.0.0.1');
	const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
	assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
	const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
	assert.equal(manifest.origin, origin); assert.ok(capabilitySatisfies(manifest.features['api.things-export'].version, '1.18.0'));
	if (largeFile) assert.ok(capabilitySatisfies(manifest.features['api.attachment-content'].version, '1.18.0'), 'Large shared files require the actual 1.18 stream contract');
	const { default: puppeteer } = await import(puppeteerPath!);
	const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 30_000,
		args: ['--no-proxy-server', '--disable-background-networking'] });
	testContext.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
	const ownerContext = await browser.createBrowserContext(), guestContext = await browser.createBrowserContext();
	const ownerPage = await ownerContext.newPage(), page = await guestContext.newPage(); page.setDefaultTimeout(20_000);
	const setupSteps: { method: string; path: string; status: number; code: string; phase?: string; validationError?: string }[] = [];
	const actionBounds: unknown[] = [];
	let phase = 'shared-copy-setup';
	const errors: string[] = [], requests: { method: string; path: string; mode?: string }[] = [], bounds: unknown[] = [];
	page.on('pageerror', (error: Error) => errors.push(error.message));
	page.on('request', (request: any) => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname, ...(url.searchParams.has('cache') ? {mode: url.searchParams.get('cache')!} : {}) }); });
	const click = async (label: string) => {
		// Responsive Builder shells may replace a button before pointer input.
		// Retry only the pre-input detached-node failure, never an uncertain click.
		for (let attempt = 0; attempt < 2; attempt++) {
			const handle = await page.waitForFunction((text: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text && !button.disabled && button.getBoundingClientRect().width), {}, label);
			try { await handle.asElement().click(); return; }
			catch (error) {
				if (attempt || !(error instanceof Error) || error.message !== 'Node is detached from document' || !error.stack?.includes('assertConnectedElement')) throw error;
			} finally { await handle.dispose(); }
		}
	};
	const shellReady = () => page.waitForFunction(async () => {
		await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
		for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
		return false;
	}, { timeout: 90_000 });
	await mkdir(artifacts!, { recursive: true });
	try {
		for (const target of [page, ownerPage]) {
			const network = await target.createCDPSession(); await network.send('Network.enable');
			await network.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
		}
		await ownerPage.goto(origin + '/feed', { waitUntil: 'domcontentloaded' });
		const registration = await ownerPage.evaluate(async () => {
			const username = 'sharedcopy-' + crypto.randomUUID().slice(0, 8);
			// Generated credential stays inside this one disposable browser call.
			const response = await fetch('/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, email: `${username}@example.test`, password: crypto.randomUUID() + crypto.randomUUID() }) });
			const data = await response.json();
			return { status: response.status, ok: data.ok, code: typeof data.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.code) ? data.code : 'NO_SAFE_ERROR_CODE',
				user: data.user ? { id: data.user.id, isAdmin: data.user.isAdmin, publicUploadsEnabled: data.user.publicUploadsEnabled, privateUploadsEnabled: data.user.privateUploadsEnabled } : null };
		});
		setupSteps.push({ method: 'POST', path: '/api/v1/auth/register', status: registration.status, code: registration.code });
		assert.ok(registration.status === 200 && registration.ok && registration.user?.id,
			`Synthetic setup POST /api/v1/auth/register (${registration.status}; ${registration.code})`);
		assert.equal(registration.user!.isAdmin, false, 'The source owner must remain an ordinary account');
		if (largeFile) {
			assert.equal(registration.user!.publicUploadsEnabled, false);
			assert.equal(registration.user!.privateUploadsEnabled, false);
			// Same bootstrap as runtime/application.cjs: an API-created disposable
			// administrator is allowlisted by the isolated harness after signup.
			// Only its private task-local fixture may supply this test credential.
			assert.ok(Object.values(networkInterfaces()).flat().every(address => address?.internal), 'Upload approval requires the network-none test namespace');
			assert.ok(adminFile?.startsWith('/home/pwuser/') && adminFile.endsWith('.json'), 'Provide the isolated TT_SHARED_COPY_ADMIN_FIXTURE');
			const metadata = await lstat(adminFile!);
			assert.ok(metadata.isFile() && (metadata.mode & 0o777) === 0o600 && metadata.uid === process.getuid!(), 'Administrator fixture must be owned and private');
			const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
			assert.equal(administrator.base, origin); assert.equal(administrator.sessionId, session);
			assert.ok(typeof administrator.username === 'string' && typeof administrator.password === 'string' && typeof administrator.ownerId === 'string', 'Generated administrator fixture is incomplete');
			const adminContext = await browser.createBrowserContext();
			try {
				const adminPage = await adminContext.newPage();
				await adminPage.goto(origin + '/.well-known/thingtime-capabilities.json', { waitUntil: 'domcontentloaded' });
				const login = await adminPage.evaluate(async credentials => {
					const response = await fetch('/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
					const data = await response.json(); return { status: response.status, code: data.code, id: data.user?.id, isAdmin: data.user?.isAdmin };
				}, { username: administrator.username, password: administrator.password });
				setupSteps.push({ method: 'POST', path: '/api/v1/login', status: login.status, code: safeCode(login) });
				assert.ok(login.status === 200 && login.id === administrator.ownerId && login.isAdmin === true,
					`Synthetic setup POST /api/v1/login (${login.status}; ${safeCode(login)})`);
				const grant = await adminPage.evaluate(async userId => {
					const response = await fetch('/api/v1/admin/users/public-uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ userId, enabled: true, scope: 'public' }) });
					const data = await response.json(); return { status: response.status, ok: data.ok, code: data.code };
				}, registration.user!.id);
				setupSteps.push({ method: 'POST', path: '/api/v1/admin/users/public-uploads', status: grant.status, code: safeCode(grant) });
				assert.ok(grant.status === 200 && grant.ok, `Synthetic setup POST /api/v1/admin/users/public-uploads (${grant.status}; ${safeCode(grant)})`);
			} finally { await adminContext.close(); }
			const approved = await ownerPage.evaluate(async () => {
				const data = await (await fetch('/api/v1/auth/me')).json();
				return { id: data.user?.id, isAdmin: data.user?.isAdmin, publicUploadsEnabled: data.user?.publicUploadsEnabled, privateUploadsEnabled: data.user?.privateUploadsEnabled };
			});
			assert.equal(approved.id, registration.user!.id); assert.equal(approved.isAdmin, false);
			assert.equal(approved.publicUploadsEnabled, true); assert.equal(approved.privateUploadsEnabled, false);
		}
		const source = await ownerPage.evaluate(async (largeFile: boolean) => {
			const steps: { method: string; path: string; status: number; code: string; phase: string; validationError?: string }[] = [];
			(window as any).__sharedCopySourceSetupSteps = steps;
			const send = async (path: string, body: unknown, phase: string) => {
				const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
				const data = await response.json();
				const pathname = new URL(path, location.origin).pathname;
				const code = typeof data.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.code) ? data.code : 'NO_SAFE_ERROR_CODE';
				// Only synthetic Thing-schema validation failures are readable here.
				// Auth/upload responses and arbitrary exception bodies stay excluded.
				const validationError = pathname === '/api/v1/things' && response.status === 400 && typeof data.error === 'string'
					? data.error.slice(0, 200).replace(/[\r\n\t]/g, ' ') : undefined;
				steps.push({ method: 'POST', path: pathname, status: response.status, code, phase, ...(validationError ? { validationError } : {}) });
				if (!response.ok || !data.ok) throw new Error(`Synthetic setup ${phase}: POST ${pathname} (${response.status}; ${code})${validationError ? ': ' + validationError : ''}`);
				return data;
			};
			let file: { id: string; size: number; sha256: string } | null = null;
			if (largeFile) {
				const bytes = new Uint8Array(17 * 1024 * 1024 + 3).fill(61);
				const digest = async (part: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', part));
				const start = await send('/api/v1/attachments/uploads', { requestId: crypto.randomUUID(), filename: 'shared-original.bin', contentType: 'application/octet-stream', sizeBytes: bytes.length, purpose: 'post' }, 'upload-start');
				const parts: { partNumber: number; data: Uint8Array<ArrayBuffer>; checksumSha256: string }[] = [];
				for (let partNumber = 1; partNumber <= start.upload.partCount; partNumber++) {
					const data = bytes.slice((partNumber - 1) * start.upload.partSizeBytes, partNumber * start.upload.partSizeBytes);
					parts.push({ partNumber, data, checksumSha256: btoa(String.fromCharCode(...await digest(data))) });
				}
				const targets = await send('/api/v1/attachments/uploads/parts', { uploadId: start.upload.id, parts: parts.map(({partNumber, checksumSha256}) => ({partNumber, checksumSha256})) }, 'upload-parts');
				for (const target of targets.parts) {
					const url = new URL(target.url, location.origin);
					if (url.origin !== location.origin) throw new Error('Isolated upload fixture requires same-origin storage');
					const response = await fetch(url, {method: 'PUT', credentials: 'omit', redirect: 'error', headers: target.headers, body: parts.find(part => part.partNumber === target.partNumber)!.data});
					if (!response.ok) throw new Error(`Synthetic setup PUT ${url.pathname} (${response.status}; NO_SAFE_ERROR_CODE)`);
				}
				const complete = await send('/api/v1/attachments/uploads/complete', { uploadId: start.upload.id }, 'upload-complete');
				file = { id: complete.attachment.id, size: bytes.length, sha256: Array.from(await digest(bytes), byte => byte.toString(16).padStart(2, '0')).join('') };
				await send('/api/v1/things', { thingtime: ['post'], acl: ['tt:all'], crystal: {type: 'text', text: 'Shared original fixture'}, attachmentIds: [file.id] }, 'post');
			}
			const componentResponse = await send('/api/v1/things', { thingtime: ['component'], acl: ['tt:all'], crystal: {
				name: 'Shared offline component', componentKey: 'shared-offline-component', version: 1, render: { tag: 'p', children: file
					? ['Shared component survives offline', {tag: 'a', props: {href: '/api/v1/attachments/content?id=' + file.id + '&download=1', style: { display: 'block', marginTop: '8px' }}, children: 'Download shared original'}]
					: 'Shared component survives offline' }
			} }, 'component');
			const component = componentResponse.thing;
			if (!component?.id) throw new Error('Synthetic setup component: response is missing thing.id');
			const webpageResponse = await send('/api/v1/things', { thingtime: ['webpage'], acl: ['tt:all'], crystal: { name: 'Shared offline page', version: 1,
				blocks: [{ id: 'frame', type: 'container', direction: 'column', gap: 4, css: { padding: '24px', 'max-width': '600px', margin: '0 auto' }, children: [
					{ id: 'title', type: 'element', tag: 'h1', text: 'Shared source title' }, { id: 'card', type: 'component', component: component.id }
				] }]
			} }, 'webpage');
			const webpage = webpageResponse.thing;
			if (!webpage?.id) throw new Error('Synthetic setup webpage: response is missing thing.id');
			return { pageId: webpage.id, componentId: component.id, file, setupSteps: steps };
		}, largeFile);
		setupSteps.push(...source.setupSteps);
		await page.setViewport({ width: 1440, height: 1000 });
		await page.goto(origin + '/thing/' + source.pageId, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('[data-testid="fork-shared-thing"]', { visible: true });
		for (const width of [1440, 390, 320]) {
			await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
			await page.evaluate(() => { for (const root of [document.scrollingElement!, ...document.querySelectorAll('#lopuPageScroll')]) root.scrollTop = 0; });
			bounds.push(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth })));
			await page.screenshot({ path: resolve(artifacts!, `shared-copy-${width}.png`) });
			await page.evaluate(async () => { for (const root of [document.scrollingElement!, ...document.querySelectorAll('#lopuPageScroll')]) {
				for (let top = 0; top < root.scrollHeight; top += Math.max(1, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); }
			} });
			await page.screenshot({ path: resolve(artifacts!, `shared-copy-${width}-bottom.png`) });
		}
		assert.ok(bounds.every((value: any) => !value.overflow));
		await page.setViewport({ width: 1440, height: 1000 }); await page.click('[data-testid="fork-shared-thing"]');
		await page.waitForFunction(() => location.pathname === '/builder' && new URLSearchParams(location.search).has('page'));
		const copyId = new URL(page.url()).searchParams.get('page')!; assert.notEqual(copyId, source.pageId);
		await page.waitForFunction(() => document.body.innerText.includes('Shared component survives offline'));
		if (!await page.$('select[aria-label="Select block"]')) await click('Builder');
		await page.select('select[aria-label="Select block"]', 'title');
		const text = await page.waitForSelector('textarea[aria-label="Block text"]', { visible: true });
		await text.click(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
		await text.type('Shared copy edited locally'); await click('Save');
		await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save' && button.disabled));
		await shellReady(); await page.addScriptTag({ path: fixture });
		const copied = await page.evaluate(id => (window as any).sharedCopyFixture.proof(id), copyId);
		const component = copied.things.find((thing: any) => thing.thingtime.includes('component'));
		assert.ok(component); assert.notEqual(component.id, source.componentId);
		assert.equal(copied.page.crystal.blocks[0].children[1].component, component.id);
		assert.equal(copied.page.crystal.blocks[0].children[0].text, 'Shared copy edited locally');
		assert.equal(source.file ? component.crystal.render.children[0] : component.crystal.render.children, 'Shared component survives offline');
		if (source.file) {
			assert.ok(requests.some(request => request.path === '/api/v1/attachments/content' && request.mode === 'original-bytes'));
			assert.equal(copied.media.length, 1); assert.notEqual(copied.media[0].id, source.file.id);
			assert.equal(copied.media[0].bytes, source.file.size); assert.equal(copied.media[0].sha256, source.file.sha256);
		}
		phase = 'saved-action-seed';
		const builderUrl = page.url();
		const { actionId } = await page.evaluate(() => (window as any).sharedCopyFixture.seedProfileAction());
		// Load the normal route and its code before taking the browser offline.
		// The fixture only seeds synthetic state; the real UI owns execution.
		phase = 'saved-action-route';
		await page.goto(origin + '/actions/' + encodeURIComponent(actionId), { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Saved profile browser acceptance') &&
			[...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Run action' && !button.disabled));
		await shellReady(); await page.addScriptTag({ path: fixture });
		const beforeRun = await page.evaluate(id => (window as any).sharedCopyFixture.profileProof(id), actionId);
		assert.equal(beforeRun.runs.length, 0, 'Seeding must not execute the Action');
		const beforeOffline = requests.length; await page.setOfflineMode(true);
		phase = 'saved-action-offline-run';
		await click('Run action');
		await page.waitForFunction(() => [...document.querySelectorAll('pre')].some(element => {
			try { const result = JSON.parse(element.textContent || ''); return typeof result.themeId === 'string' && typeof result.algorithmId === 'string'; }
			catch { return false; }
		}));
		const renderedResult = await page.evaluate(() => [...document.querySelectorAll('pre')].map(element => {
			try { return JSON.parse(element.textContent || ''); } catch { return null; }
		}).find(result => typeof result?.themeId === 'string' && typeof result?.algorithmId === 'string'));
		await page.waitForFunction(() => /recent execution details/i.test(document.body.textContent || '') && document.body.innerText.includes('This device'));
		const profiles = await page.evaluate(id => (window as any).sharedCopyFixture.profileProof(id), actionId);
		assert.equal(profiles.runs.length, 1); assert.equal(profiles.runs[0].status, 'ok', profiles.runs[0].error);
		assert.equal(profiles.runs[0].localOnly, true); assert.deepEqual(profiles.runs[0].result, renderedResult);
		assert.equal(profiles.themes.activeThemeId, renderedResult.themeId);
		assert.equal(profiles.algorithms.activeAlgorithmId, renderedResult.algorithmId);
		assert.equal(profiles.historyCounts.length, 2); assert.ok(profiles.historyCounts.every((count: number) => count >= 2));
		const offlineRunApiRequests = requests.length - beforeOffline;
		assert.equal(offlineRunApiRequests, 0, 'Normal Run action button executes device adapters without API requests');
		await page.screenshot({ path: resolve(artifacts!, 'profile-action-offline-run.png') });
		phase = 'saved-action-responsive-layout';
		for (const width of [1440, 390, 320]) {
			await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
			await page.evaluate(() => { for (const root of [document.scrollingElement!, ...document.querySelectorAll('#lopuPageScroll')]) root.scrollTop = 0; });
			for (const position of ['top', 'bottom']) {
				if (position === 'bottom') await page.evaluate(async () => {
					for (const root of [document.scrollingElement!, ...document.querySelectorAll('#lopuPageScroll')]) {
						const height = root.scrollHeight, step = Math.max(1, root.clientHeight / 2);
						for (let top = 0; top <= height; top += step) { root.scrollTop = top; await new Promise(requestAnimationFrame); }
						root.scrollTop = height;
					}
				});
				const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
					overflow: document.documentElement.scrollWidth > innerWidth, overflowing: [...document.querySelectorAll('main *, h1, pre, button')].flatMap(element => {
						const rect = element.getBoundingClientRect();
						return rect.width && (rect.left < -1 || rect.right > innerWidth + 1) ? [{ tag: element.tagName, left: rect.left, right: rect.right, width: rect.width }] : [];
					}) }));
				actionBounds.push({ ...measured, position });
				await writeFile(resolve(artifacts!, 'profile-action-bounds.json'), JSON.stringify(actionBounds, null, 2));
				await page.screenshot({ path: resolve(artifacts!, `profile-action-${width}-${position}.png`) });
				assert.equal(measured.overflow, false, `Action ${width}px ${position}: ${JSON.stringify(measured)}`);
			}
		}
		await page.setViewport({ width: 1440, height: 1000 });
		phase = 'saved-action-offline-reload';
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Saved profile browser acceptance') &&
			/recent execution details/i.test(document.body.textContent || '') && document.body.innerText.includes('This device'));
		await page.screenshot({ path: resolve(artifacts!, 'profile-action-offline-reloaded.png') });
		phase = 'shared-copy-offline-reload';
		await page.goto(builderUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => document.body.innerText.includes('Shared copy edited locally'));
		await click('View'); await page.waitForFunction(() => document.body.innerText.includes('Shared component survives offline'));
		await page.addScriptTag({ path: fixture });
		const reloaded = await page.evaluate(({ copyId, actionId }) => Promise.all([(window as any).sharedCopyFixture.proof(copyId), (window as any).sharedCopyFixture.profileProof(actionId)]), { copyId, actionId });
		assert.equal(reloaded[0].json, copied.json); assert.equal(reloaded[1].runs.length, 1);
		assert.deepEqual(reloaded[0].media, copied.media);
		assert.deepEqual(reloaded[1].runs, profiles.runs);
		assert.deepEqual(reloaded[1].historyCounts, profiles.historyCounts);
		// Cold shell boots emit read-only root/health/account-hint requests even
		// offline; request events do not prove a backend request succeeded. Keep
		// the Action's zero-request proof separate and forbid offline mutations.
		const offlineReloadRequests = requests.slice(beforeOffline);
		assert.ok(offlineReloadRequests.every(request => request.method === 'GET'), 'Offline reload must not enqueue or send mutations');
		assert.equal(reloaded[1].themes.themes.find((theme: any) => theme.id === reloaded[1].themes.activeThemeId)?.name, 'Browser Action theme edited');
		assert.equal(reloaded[1].algorithms.algorithms.find((algorithm: any) => algorithm.id === reloaded[1].algorithms.activeAlgorithmId)?.name, 'Browser Action algorithm edited');
		await page.screenshot({ path: resolve(artifacts!, 'shared-copy-offline-reloaded.png') });
		const original = await ownerPage.evaluate(async id => (await (await fetch('/api/v1/things?id=' + encodeURIComponent(id))).json()).thing, source.pageId);
		assert.equal(original.crystal.blocks[0].children[0].text, 'Shared source title');
		const writes = requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method));
		assert.deepEqual(writes, [{ method: 'POST', path: '/api/v1/things/export' }, { method: 'POST', path: '/api/v1/things/export' }]);
		assert.deepEqual(errors, []);
		await writeFile(resolve(artifacts!, 'shared-copy-offline.json'), copied.json);
		await writeFile(resolve(artifacts!, 'profile-action-offline.json'), profiles.json);
		await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ normalSharedCopyButton: true, individuallyEditableCopiedHeading: true,
			coldOfflineDependencyReload: true, sourceUnchanged: true, savedProfileAction: { setup: 'isolated synthetic seed only', route: '/actions/:key', button: 'Run action', normalUiRun: true, offlineRunApiRequests, offlineReloadRequestEvents: offlineReloadRequests, offlineMutationRequests: 0, coldOfflineExecutionDetailsReload: true },
			profileHistoryRetained: true, media: source.file ? {largeSharedOriginal: true, bytes: source.file.size, sha256: source.file.sha256, independentOfflineBytes: true}
				: 'Large shared-original acceptance not enabled; set TT_SHARED_COPY_LARGE_FILE=1', bounds, actionBounds, writes, errors, setupSteps, sourceOwner: { isAdmin: false, publicUploadApproval: largeFile ? 'canonical admin API for this disposable owner only' : 'not needed' } }, null, 2));
	} catch (error) {
		const sourceSteps = await ownerPage.evaluate(() => (window as any).__sharedCopySourceSetupSteps ?? []).catch(() => []);
		if (sourceSteps.length && !setupSteps.some(step => step.phase)) setupSteps.push(...sourceSteps);
		await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
		await writeFile(resolve(artifacts!, 'failure.txt'), await page.$eval('body', (element: HTMLElement) => element.innerText).catch(() => 'Unavailable'));
		await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), stack: (error as Error).stack, phase, bounds, actionBounds, setupSteps, errors, requests }, null, 2));
		throw error;
	} finally { await guestContext.close(); await ownerContext.close(); await browser.close(); }
});
