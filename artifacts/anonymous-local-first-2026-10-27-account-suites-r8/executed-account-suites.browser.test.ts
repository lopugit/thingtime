import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDataPlane } from '../utils/dataPlane';
import { accountSuiteBrowserWorkspace, accountSuiteScrollCheckpoints } from './accountSuiteBrowserContract';

const origin = process.env.TT_ACCOUNT_SUITE_URL, session = process.env.TT_RENDER_SESSION;
const artifacts = process.env.TT_ACCOUNT_SUITE_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

/** Invoked inside the task-owned, manager-verified network-none runtime. API
 * setup uses a disposable private identity; all acceptance mutations below
 * use the normal Install, Run, Save, Rename and conflict-review controls. */
test('signed-in bundled suite installs and edits offline, then adopts the uncached canonical graph without duplicate definitions', {
	skip: !origin || !session || !artifacts || !playwrightPath, timeout: 360_000
}, async t => {
	assert.equal(new URL(origin!).hostname, '127.0.0.1');
	assert.ok(Object.values(networkInterfaces()).flat().every(address => address?.internal), 'Requires the network-none browser/backend namespace.');
	const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
	assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
	assert.equal(health.testEnvironment.sessionId, session);
	await mkdir(artifacts!, { recursive: true });
	const { chromium } = await import(playwrightPath!);
	const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
	t.after(() => browser.close());
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
	page.setDefaultTimeout(25_000);
	const errors: string[] = [], mutations: { path: string; offline: boolean; source: string; requestId?: string; status?: number; failed?: boolean }[] = [], bounds: unknown[] = [];
	const requests = new Map<any, typeof mutations[number]>();
	const controlPages = new Set<any>();
	const networkSessions = new Map<any, any>(), connectivityEvents: unknown[] = [];
	let connectionPhase: 'online' | 'disconnecting' | 'offline' | 'reconnecting' = 'online';
	let ownerId = '', dataPlane = '', acceptanceStarted = false;
	let fixturePassword = '', controlContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
	const phase = (name: string) => process.stdout.write(`[suite-ui] ${name}\n`);
	const networkSession = async (target: any) => {
		let network = networkSessions.get(target);
		if (!network) {
			network = await target.context().newCDPSession(target);
			await network.send('Network.enable');
			networkSessions.set(target, network);
		}
		return network;
	};
	page.on('pageerror', (error: Error) => errors.push(error.message));
	const observeRequests = (observedContext: typeof context) => {
		observedContext.on('request', (request: any) => {
			if (!acceptanceStarted || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return;
			let sender: unknown = null;
			try { sender = request.frame().page(); } catch { /* Service-worker requests may have no frame. */ }
			const control = controlPages.has(sender);
			let requestId: string | undefined;
			if (new URL(request.url()).pathname === '/api/v1/webpages/suites/install') {
				try { requestId = request.postDataJSON()?.requestId; } catch { /* Non-JSON requests have no suite identity. */ }
			}
			const value = { path: new URL(request.url()).pathname, offline: control ? false : connectionPhase === 'offline',
				source: control ? 'control' : sender === page ? 'primary' : 'concurrent', ...(requestId ? { requestId } : {}) };
			mutations.push(value); requests.set(request, value);
		});
		observedContext.on('response', (response: any) => { const value = requests.get(response.request()); if (value) value.status = response.status(); });
		observedContext.on('requestfailed', (request: any) => { const value = requests.get(request); if (value) value.failed = true; });
	};
	observeRequests(context);
	const url = (path: string) => new URL(path, origin).href;
	const headers = () => ({ Origin: origin!, 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': dataPlane });
	const api = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown, client = page) => {
		const response = await client.evaluate(async ({ method, path, headers, data }) => {
			const response = await fetch(path, { method: method.toUpperCase(), credentials: 'same-origin', redirect: 'error',
				headers: { ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
				...(data === undefined ? {} : { body: JSON.stringify(data) }) });
			return { status: response.status, body: await response.json().catch(() => null) };
		}, { method, path, headers: headers(), data });
		const body = response.body;
		if (response.status !== 200) {
			const code = typeof body?.code === 'string' && /^[A-Z_0-9]{1,64}$/.test(body.code) ? body.code : null;
			const error = typeof body?.error === 'string' && !/password|secret|bearer|mongodb:|token[=:]/i.test(body.error) ? body.error.slice(0, 600) : 'Server error details unavailable or redacted.';
			const refusal = { method: method.toUpperCase(), path, status: response.status, code, error, ownerId, dataPlane };
			await writeFile(resolve(artifacts!, 'api-refusal.json'), JSON.stringify(refusal, null, 2));
			assert.fail(JSON.stringify(refusal));
		}
		return body;
	};
	const state = () => page.evaluate(async ({ ownerId, origin, dataPlane }) => {
		const opening = indexedDB.open('thingtime.local-workspaces.v1');
		const db = await new Promise<IDBDatabase>((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
		try {
			const request = db.transaction('records', 'readonly').objectStore('records').getAll();
			const all = await new Promise<any[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			const rows = all.filter(row => row.scope === JSON.stringify(['account', origin, ownerId, dataPlane]));
			return {
				intent: rows.find(row => row.collection === 'account-suite-installs' && row.id === 'web-standards')?.value,
				things: rows.filter(row => row.collection === 'things').map(row => row.value),
				sync: rows.filter(row => row.collection === 'thing-sync').map(row => ({ id: row.id, ...row.value })),
				holds: rows.filter(row => row.collection === 'account-suite-parts').map(row => row.id),
				aliases: rows.filter(row => row.collection === 'account-suite-aliases').map(row => row.value)
			};
		} finally { db.close(); }
	}, { ownerId, origin: origin!, dataPlane });
	const connectivity = async (value: boolean) => {
		connectionPhase = value ? 'disconnecting' : 'reconnecting'; phase(connectionPhase);
		await context.setOffline(value);
		// Playwright owns request blocking. Keep the CDP navigator-state owner
		// alive across navigation and every disconnect/reconnect; a short-lived
		// detached override cannot represent loopback connectivity reliably in
		// this network-none namespace.
		for (const target of context.pages()) {
			const network = await networkSession(target);
			await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: -1, uploadThroughput: -1, connectionType: value ? 'none' : 'ethernet' });
		}
		await Promise.all(context.pages().map(target => target.waitForFunction(expected => navigator.onLine === expected, !value, { timeout: 5000 }).catch(() => null)));
		const probe = await page.evaluate(async () => {
			try {
				const response = await fetch('/api/root-data', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
				return { failed: false, status: response.status, body: await response.json() };
			} catch { return { failed: true, status: null, body: null }; }
		});
		const online = await Promise.all(context.pages().map(async target => ({ source: target === page ? 'primary' : controlPages.has(target) ? 'control' : 'concurrent', online: await target.evaluate(() => navigator.onLine) })));
		connectivityEvents.push({ expectedOffline: value, online, transportFailed: probe.failed, status: probe.status,
			actorMatches: probe.body?.user?.id === ownerId, planeMatches: probe.body?.dataPlane === dataPlane, at: Date.now() });
		await writeFile(resolve(artifacts!, 'connectivity.json'), JSON.stringify(connectivityEvents, null, 2));
		for (const target of online) assert.equal(target.online, !value, `${target.source}: navigator must match the requested network state.`);
		if (value) assert.equal(probe.failed, true, 'The real authenticated root-data transport must fail offline.');
		else {
			assert.equal(probe.failed, false, 'The real authenticated root-data transport must recover online.');
			assert.equal(probe.status, 200);
			assert.equal(accountSuiteBrowserWorkspace(probe.body, ownerId).dataPlane, dataPlane);
		}
		connectionPhase = value ? 'offline' : 'online'; phase(`${connectionPhase}: navigator and authenticated transport verified`);
	};
	const capture = async (label: string) => {
		await page.bringToFront();
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
			await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 32)); });
			const requireReview = /conflict|recovery/.test(label);
			for (let attempt = 0; attempt < 2; attempt++) {
				const ready = await page.evaluate(async requireReview => {
					let previous = '', stable = 0;
					const observations: Array<{ height: number; reviewPanes: number; componentReady: boolean; notFound: boolean }> = [];
					for (let sample = 0; sample < 60; sample++) {
						const review = document.querySelector('[data-testid="account-sync-status"] [data-lopu-launcher-clearance]');
						const notFound = document.body.textContent?.includes('No component answers to') || false;
						const componentReady = [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Component settings');
						const reviewPanes = review?.querySelectorAll('pre').length || 0;
						const geometry = [...document.querySelectorAll('pre')].filter(element => element.checkVisibility()).map(element => [element.clientWidth, element.clientHeight, element.scrollHeight]);
						const current = { height: document.scrollingElement!.scrollHeight, reviewPanes, componentReady, notFound };
						const signature = JSON.stringify([current, geometry]);
						stable = signature === previous ? stable + 1 : 0; previous = signature;
						if (!observations.length || JSON.stringify(observations.at(-1)) !== JSON.stringify(current)) observations.push(current);
						if (stable >= 5 && (!requireReview || (componentReady && !notFound && reviewPanes >= 2))) return { stable: true, observations };
						await new Promise(resolve => setTimeout(resolve, 100));
					}
					return { stable: false, observations };
				}, requireReview);
				await writeFile(resolve(artifacts!, `view-ready-${label}-${width}-${attempt}.json`), JSON.stringify(ready, null, 2));
				assert.equal(ready.stable, true, `${label}: component and current conflict review must settle without a missing old-ID view`);
				const discovery = await page.evaluate(() => {
					for (const element of document.querySelectorAll('[data-tt-suite-scroll-root]')) element.removeAttribute('data-tt-suite-scroll-root');
					const scroller = document.scrollingElement;
					const candidates = new Set<Element>([...(scroller ? [scroller] : []), ...document.querySelectorAll('body *')]);
					const roots: Array<{ marker: string; tag: string; kind: 'page' | 'pane'; reviewPane: boolean; clientHeight: number; scrollHeight: number; maxScroll: number; rect: { width: number; height: number } }> = [];
					let skippedHidden = 0;
					for (const candidate of candidates) {
						const element = candidate as HTMLElement, style = getComputedStyle(element), rect = element.getBoundingClientRect();
						if (element !== scroller && !/auto|scroll/.test(style.overflowY)) continue;
						if (!element.clientHeight || !element.clientWidth || !rect.width || !rect.height || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) { skippedHidden++; continue; }
						if (element !== scroller && element.scrollHeight <= element.clientHeight + 1) continue;
						// Standards-mode body overflow can share the document surface.
						if (element === document.body && scroller !== element && element.scrollHeight === scroller?.scrollHeight && element.clientHeight === scroller.clientHeight) continue;
						const marker = String(roots.length);
						element.setAttribute('data-tt-suite-scroll-root', marker);
						roots.push({ marker, tag: element.tagName, reviewPane: !!element.closest('[data-testid="account-sync-status"] [data-lopu-launcher-clearance]'), kind: element === scroller || (element.tagName !== 'PRE' && element.clientHeight >= innerHeight * 0.65) ? 'page' : 'pane',
							clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, maxScroll: Math.max(0, element.scrollHeight - element.clientHeight), rect: { width: rect.width, height: rect.height } });
					}
					return { roots, skippedHidden };
				});
				const roots = discovery.roots.map(root => ({ ...root, points: accountSuiteScrollCheckpoints(root.maxScroll, root.clientHeight, root.kind), observed: [] as number[] }));
				const report = { label, width, attempt, ready, skippedHidden: discovery.skippedHidden, roots, phase: 'discovered', completedRoots: 0 };
				const reportPath = resolve(artifacts!, `scroll-${label}-${width}${attempt ? '-rediscovery' : ''}.json`);
				const checkpoint = async () => writeFile(reportPath, JSON.stringify(report, null, 2));
				await checkpoint();
				phase(`capture ${label} ${width}: ${roots.length} visible roots, ${roots.reduce((sum, root) => sum + root.points.length, 0)} checkpoints`);
				const move = async (marker: string, top: number, reveal = false) => page.evaluate(async ({ marker, top, reveal }) => {
					const root = document.querySelector<HTMLElement>(`[data-tt-suite-scroll-root="${marker}"]`);
					if (!root) return { disappeared: true, top: 0, max: 0 };
					if (reveal) root.scrollIntoView({ block: 'center', behavior: 'instant' });
					root.scrollTo({ top, behavior: 'instant' });
					// Paint is flushed by screenshots; background-tab animation frames
					// must not turn finite observation into an unbounded wait.
					await new Promise(resolve => setTimeout(resolve, 32));
					return { disappeared: !root.isConnected, top: root.scrollTop, max: Math.max(0, root.scrollHeight - root.clientHeight) };
				}, { marker, top, reveal });
				const screenshot = async (bottom: boolean) => {
					if (requireReview) {
						await page.getByRole('button', { name: 'Component settings', exact: true }).waitFor();
						assert.equal(await page.getByRole('button', { name: 'Keep this device’s version', exact: true }).count(), 1, 'Current comparison cannot disappear during capture.');
					}
					const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
					assert.equal(geometry.scrollWidth, width, `${label}: horizontal overflow`);
					bounds.push({ label, bottom, ...geometry });
					await page.screenshot({ path: resolve(artifacts!, `${label}-${width}${bottom ? '-bottom' : ''}.png`), fullPage: false });
				};
				try {
				for (const root of [...roots].reverse()) { if ((await move(root.marker, 0)).disappeared) throw Error('SUITE_CAPTURE_TOPOLOGY_CHANGED'); }
				await screenshot(false);
				for (const root of roots) {
					for (const top of root.points) {
						const observed = await move(root.marker, top, root.kind === 'pane');
						if (observed.disappeared || Math.abs(observed.max - root.maxScroll) > 1) throw Error('SUITE_CAPTURE_TOPOLOGY_CHANGED');
						assert.ok(Math.abs(observed.top - Math.min(top, observed.max)) <= 1, `${label}: scroll checkpoint was not reached`);
						root.observed.push(observed.top);
					}
					report.completedRoots++; report.phase = 'traversing'; await checkpoint();
				}
				// Revealing nested panes moves their ancestors. Restore page bottoms.
				for (const root of roots.filter(root => root.kind === 'page').reverse()) { if ((await move(root.marker, Number.MAX_SAFE_INTEGER)).disappeared) throw Error('SUITE_CAPTURE_TOPOLOGY_CHANGED'); }
				await screenshot(true);
				report.phase = 'complete'; await checkpoint();
				phase(`capture ${label} ${width}: all scroll endpoints observed`);
				break;
				} catch (failure) {
					if (!(failure instanceof Error) || !failure.message.includes('SUITE_CAPTURE_TOPOLOGY_CHANGED')) throw failure;
					report.phase = 'topology-changed'; await checkpoint();
					if (attempt) throw Error(`${label}: scroll topology changed again after one complete rediscovery`);
					phase(`capture ${label} ${width}: view changed; preserving observations and rediscovering once`);
				}
			}
		}
		await page.setViewportSize({ width: 1440, height: 1000 });
	};
	const awaitState = async (accept: (value: Awaited<ReturnType<typeof state>>) => boolean) => {
		phase('waiting for durable queue convergence');
		const until = Date.now() + 110_000;
		let latest: Awaited<ReturnType<typeof state>>;
		do {
			latest = await state();
			if (accept(latest)) { phase('durable queue state converged'); return latest; }
			await new Promise(resolve => setTimeout(resolve, 1000));
		} while (Date.now() < until);
		const alerts = await page.locator('[data-testid="account-sync-status"] [role="alert"]').allTextContents();
		const safeText = (value: unknown) => typeof value === 'string' && !/password|secret|bearer|mongodb:|token[=:]/i.test(value) ? value.slice(0, 1200) : 'Unavailable or redacted.';
		await writeFile(resolve(artifacts!, `queue-timeout-${Date.now()}.json`), JSON.stringify({
			intent: latest!.intent ? { state: latest!.intent.state, attempts: latest!.intent.attempts } : null,
			sync: latest!.sync.map(row => ({ id: row.id, state: row.state, attempts: row.attempts, error: row.error ? safeText(row.error) : null,
				baseUpdatedAt: row.base?.updatedAt, localRevision: latest!.things.find(thing => thing.id === row.id)?.revision,
				pending: row.pending ? { operationId: row.pending.operationId, method: row.pending.method, version: row.pending.version } : null,
				claimed: !!row.claim })), alerts: alerts.map(safeText), mutations
		}, null, 2));
		throw new Error(`Suite state did not converge: ${JSON.stringify(latest!.sync.map(row => ({ id: row.id, state: row.state, error: row.error ? safeText(row.error) : null })))}`);
	};
	try {
		await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
		const username = `offline-suite-${randomUUID().slice(0, 8)}`;
		await page.goto(url('/.well-known/thingtime-capabilities.json'));
		// This disposable isolated-test credential stays only in fixture memory
		// and normal registration/login request bodies. It is never logged,
		// returned by browser calls, persisted in artifacts or placed in the DOM.
		fixturePassword = randomUUID() + randomUUID();
		const registration = await page.evaluate(async ({ username, password }) => {
			const response = await fetch('/api/v1/auth/register', { method: 'POST', credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email: `${username}@example.test`, password }) });
			const body = await response.json();
			return { status: response.status, ownerId: body.user?.id };
		}, { username, password: fixturePassword });
		assert.equal(registration.status, 200);
		assert.equal(typeof registration.ownerId, 'string');
		ownerId = registration.ownerId;
		const rootResponse = await page.evaluate(async () => {
			const response = await fetch('/api/root-data', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
			return { status: response.status, contentType: response.headers.get('Content-Type'), body: await response.json() };
		});
		assert.equal(rootResponse.status, 200);
		try { dataPlane = accountSuiteBrowserWorkspace(rootResponse.body, ownerId).dataPlane; }
		catch (error) {
			const root = rootResponse.body;
			await writeFile(resolve(artifacts!, 'root-workspace-refusal.json'), JSON.stringify({
				status: rootResponse.status, contentType: rootResponse.contentType,
				rootKeys: root && typeof root === 'object' ? Object.keys(root).slice(0, 30) : [],
				userKind: root?.user === null ? 'null' : typeof root?.user,
				authenticated: typeof root?.user?.id === 'string' && root?.user?.temporary !== true,
				effectiveActorMatches: root?.user?.id === ownerId,
				dataPlane: isDataPlane(root?.dataPlane) ? root.dataPlane : null,
				error: error instanceof Error ? error.message : 'Root workspace verification failed.'
			}, null, 2));
			throw error;
		}
		phase('authenticated root workspace verified');
		// Exercise the exact reconnect edge before the longer UI path, with no
		// app worker mounted and no mutation being retried by the fixture.
		await connectivity(true); await connectivity(false);
		phase('offline/online signal and authenticated transport preflight passed');
		const canonical = await api('post', '/api/v1/webpages/suites/install', { key: 'web-standards', onlyMissing: true });
		const canonicalComponentId = Object.values(canonical.componentIds)[0] as string;
		const before = (await api('get', `/api/v1/things?id=${encodeURIComponent(canonicalComponentId)}`)).thing;
		const remoteName = `Account suite component ${username}`, deviceName = `Device suite component ${username}`;
		const customized = await api('patch', '/api/v1/things', { id: canonicalComponentId, expectedUpdatedAt: before.updatedAt,
			crystal: { name: remoteName, description: 'Existing account customization must survive reconciliation.' } });
		assert.equal(customized.thing.crystal.name, remoteName);
		phase('existing canonical suite seeded and customized');
		await page.goto(url('/builder/demos/web-standards'));
		await page.getByTestId('suite-detail-install').waitFor();
		await page.waitForFunction(async () => {
			await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
			for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') &&
				await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
			return false;
		}, undefined, { timeout: 90_000 });
		const initial = await state();
		assert.equal(initial.intent, undefined);
		assert.equal(initial.things.some(row => row.id === canonicalComponentId), false, 'The existing account definition must be uncached.');
		const secondTab = await context.newPage();
		secondTab.setDefaultTimeout(25_000);
		secondTab.on('pageerror', (error: Error) => errors.push(error.message));
		await secondTab.goto(url('/builder/demos/web-standards'));
		await secondTab.getByTestId('suite-detail-install').waitFor();
		acceptanceStarted = true;
		await connectivity(true);
		await Promise.all([page.getByTestId('suite-detail-install').click(), secondTab.getByTestId('suite-detail-install').click()]);
		await Promise.all([page.waitForURL('**/p/web-standards', { waitUntil: 'commit' }), secondTab.waitForURL('**/p/web-standards', { waitUntil: 'commit' })]);
		const installed = await state(), local = installed.intent.local;
		assert.notEqual(Object.values(local.componentIds)[0], canonicalComponentId);
		assert.equal(installed.holds.length, installed.intent.baseline.length);
		phase('concurrent offline Install buttons committed one held local graph');
		assert.equal(installed.things.filter(row => installed.intent.baseline.some((part: any) => part.id === row.id)).length, installed.intent.baseline.length, 'Concurrent Install buttons share one local graph.');
		await capture('offline-installed-suite');
		await page.locator('a[href*="feature=html-element-button-"]').click();
		await page.getByRole('textbox', { name: 'Content', exact: true }).fill('Account example saved offline');
		await page.getByRole('button', { name: 'Run example', exact: true }).click();
		await page.frameLocator('iframe[title="button interactive preview"]').getByRole('button', { name: 'Account example saved offline', exact: true }).waitFor();
		await page.getByLabel('Execution result', { exact: true }).filter({ hasText: 'HTMLButtonElement' }).waitFor();
		await page.getByRole('button', { name: 'Save edited component', exact: true }).click();
		await page.getByRole('link', { name: 'Open saved Thing →', exact: true }).click();
		await page.getByRole('textbox', { name: 'Content', exact: true }).waitFor();
		const savedUrl = page.url();
		await page.reload();
		assert.equal(await page.getByRole('textbox', { name: 'Content', exact: true }).inputValue(), 'Account example saved offline');
		await capture('offline-saved-example');
		phase('offline Run example, saved component and cold reload verified');
		const componentId = Object.values(local.componentIds)[0] as string;
		await page.goto(url(`/components/${encodeURIComponent(componentId)}`));
		await page.getByRole('button', { name: 'Component settings', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
		await page.getByRole('dialog').getByRole('textbox').fill(deviceName);
		await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		await page.reload();
		assert.equal((await state()).things.find(row => row.id === componentId).crystal.name, deviceName);
		assert.equal(mutations.filter(row => row.offline).length, 0, 'Offline work must not issue account mutation requests.');
		phase('offline rename, reload and zero account mutation requests verified');
		await connectivity(false);
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		const reconciled = await awaitState(value => value.intent?.state === 'synced' && value.sync.some(row => row.id === canonicalComponentId && row.state === 'conflict'));
		assert.equal(reconciled.holds.length, 0);
		phase('canonical receipt adopted; overlapping edit awaits explicit review');
		for (const group of ['schemaIds', 'componentIds', 'actionIds', 'pageIds']) assert.deepEqual(reconciled.intent.local[group], canonical[group]);
		assert.deepEqual(reconciled.intent.local.dataIds, canonical.dataIds);
		assert.equal(mutations.filter(row => row.path === '/api/v1/webpages/suites/install' && row.requestId === installed.intent.request.requestId).length, 1, 'Concurrent tabs claim the canonical installation once.');
		assert.equal(reconciled.things.some(row => row.id === componentId), false, 'Provisional duplicate identity must retire.');
		assert.equal((await api('get', `/api/v1/things?id=${encodeURIComponent(canonicalComponentId)}`)).thing.crystal.name, remoteName, 'The unreviewed device edit must not overwrite the account.');
		await page.locator('summary').filter({ hasText: 'Review sync' }).click();
		const row = page.locator('[data-testid="account-sync-status"] > details > div').filter({ hasText: canonicalComponentId });
		await row.getByRole('button', { name: 'Compare versions', exact: true }).click();
		await page.getByRole('button', { name: 'Keep this device’s version', exact: true }).waitFor();
		await capture('reconnected-suite-conflict');
		await page.getByRole('button', { name: 'Keep this device’s version', exact: true }).click();
		await awaitState(value => value.sync.filter(row => Object.values(canonical.componentIds).includes(row.id)).every(row => row.state === 'synced'));
		const final = (await api('get', `/api/v1/things?id=${encodeURIComponent(canonicalComponentId)}`)).thing;
		assert.equal(final.crystal.name, deviceName);
		assert.equal(final.crystal.description, 'Existing account customization must survive reconciliation.');
		// Reload the original provisional component URL after canonical adoption.
		await page.reload();
		await page.getByRole('button', { name: 'Component settings', exact: true }).waitFor();
		assert.equal(new URL(page.url()).pathname, `/components/${componentId}`);
		assert.equal((await state()).things.find(row => row.id === canonicalComponentId).crystal.name, deviceName);
		phase('old local component URL remained editable after canonical adoption and cold reload');
		// A second real conflict verifies that the original provisional version
		// remains selectable after an earlier reviewed choice. A plain, task-owned
		// independently authenticated context represents another connected client.
		// Context-wide offline blocks remain authoritative for both original
		// install tabs; the OS browser/backend network-none boundary is unchanged.
		await secondTab.goto(url('/.well-known/thingtime-capabilities.json'));
		controlContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		assert.notEqual(controlContext, context, 'Connected control must not share the primary offline context.');
		observeRequests(controlContext);
		const controlPage = await controlContext.newPage();
		controlPages.add(controlPage);
		controlPage.on('pageerror', (error: Error) => errors.push(error.message));
		await controlPage.goto(url('/.well-known/thingtime-capabilities.json'));
		await controlContext.setOffline(false);
		const controlNetwork = await networkSession(controlPage);
		await controlNetwork.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'ethernet' });
		const login = await controlPage.evaluate(async ({ username, password }) => {
			const response = await fetch('/api/v1/login', { method: 'POST', credentials: 'same-origin', redirect: 'error',
				headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
			const body = await response.json();
			return { status: response.status, ok: body.ok === true, requiresOtp: body.requiresOtp === true };
		}, { username, password: fixturePassword });
		fixturePassword = '';
		assert.deepEqual(login, { status: 200, ok: true, requiresOtp: false }, 'Independent isolated control context must authenticate through normal login.');
		const controlRoot = await controlPage.evaluate(async () => {
			const response = await fetch('/api/root-data', { credentials: 'same-origin', cache: 'no-store' });
			return { status: response.status, body: await response.json() };
		});
		assert.equal(controlRoot.status, 200);
		assert.deepEqual(accountSuiteBrowserWorkspace(controlRoot.body, ownerId), { ownerId, dataPlane });
		phase('independent control context authenticated as the exact account and selected plane');
		await page.goto(url(`/components/${encodeURIComponent(canonicalComponentId)}`));
		await page.getByRole('button', { name: 'Component settings', exact: true }).waitFor();
		await connectivity(true);
		await page.getByRole('button', { name: 'Component settings', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
		await page.getByRole('dialog').getByRole('textbox').fill(`Newer device edit ${username}`);
		await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
		assert.equal(await page.evaluate(() => navigator.onLine), false, 'The primary editor must stay offline while the other client changes its account version.');
		assert.equal(await controlPage.evaluate(() => navigator.onLine), true, 'Independent control context must stay connected.');
		const controlBefore = (await api('get', `/api/v1/things?id=${encodeURIComponent(canonicalComponentId)}`, undefined, controlPage)).thing;
		assert.equal(controlBefore.updatedAt, final.updatedAt);
		await api('patch', '/api/v1/things', { id: canonicalComponentId, expectedUpdatedAt: controlBefore.updatedAt, crystal: { name: `Other device edit ${username}` } }, controlPage);
		const controlAfter = (await api('get', `/api/v1/things?id=${encodeURIComponent(canonicalComponentId)}`, undefined, controlPage)).thing;
		assert.equal(controlAfter.crystal.name, `Other device edit ${username}`);
		const primaryTransportFailed = await page.evaluate(async () => {
			try { await fetch('/api/root-data', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(5000) }); return false; }
			catch { return true; }
		});
		assert.equal(primaryTransportFailed, true, 'Actual primary transport must remain offline after the independent client mutation.');
		await writeFile(resolve(artifacts!, 'independent-control.json'), JSON.stringify({ separateContext: controlPage.context() !== page.context(),
			exactActorAndPlaneVerified: true, normalLogin: true, primaryTransportFailed, accountMutationReadBack: true }, null, 2));
		phase('connected control client changed account version while primary stayed offline');
		await connectivity(false); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await awaitState(value => value.sync.some(row => row.id === canonicalComponentId && row.state === 'conflict'));
		await page.locator('summary').filter({ hasText: 'Review sync' }).click();
		await page.locator('[data-testid="account-sync-status"] > details > div').filter({ hasText: canonicalComponentId }).getByRole('button', { name: 'Compare versions', exact: true }).click();
		await page.getByRole('region', { name: 'Preserved suite versions', exact: true }).waitFor();
		await capture('preserved-suite-version-recovery');
		await page.getByRole('button', { name: 'Use original device version · Private', exact: true }).click();
		await awaitState(value => value.sync.some(row => row.id === canonicalComponentId && row.state === 'synced'));
		const recovered = (await api('get', `/api/v1/things?id=${encodeURIComponent(canonicalComponentId)}`)).thing;
		assert.equal(recovered.crystal.name, deviceName);
		assert.equal(recovered.crystal.description, installed.intent.baseline.find((row: any) => row.id === componentId).crystal.description);
		assert.deepEqual(recovered.acl, ['tt:user']);
		assert.equal(recovered.visibility, 'private');
		phase('preserved original device version recovered with its exact private audience');
		await page.goto(savedUrl); await page.reload();
		assert.equal(await page.getByRole('textbox', { name: 'Content', exact: true }).inputValue(), 'Account example saved offline');
		await page.getByRole('button', { name: 'Run example', exact: true }).click();
		await page.frameLocator('iframe[title="button interactive preview"]').getByRole('button', { name: 'Account example saved offline', exact: true }).waitFor();
		await page.goto(url(`/p/${encodeURIComponent(local.entryPageId)}`));
		await page.locator('a[href*="feature=html-element-button-"]').waitFor();
		await page.reload(); await page.locator('a[href*="feature=html-element-button-"]').waitFor();
		await capture('canonical-suite-after-reload');
		assert.deepEqual(errors, []);
		phase('saved example and old local page URL rendered after canonical reload');
		await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ scope: 'Installed manager network-none full-app synthetic account acceptance',
			ownerId, dataPlane, existingUncachedCanonicalGraph: true, offlineNormalInstall: true, offlineRunEditSaveColdReload: true,
			concurrentTabsSingleGraphAndRequest: true,
			canonicalMapping: reconciled.intent.local, conflictReviewed: true, unrelatedAccountCustomizationPreservedBeforeExplicitRecovery: true,
			explicitOriginalDeviceRecoveryAfterSecondConflict: true,
			oldLocalPageUrlAfterColdReload: true, bounds, connectivityEvents, mutations, pageErrors: errors }, null, 2));
	} finally {
		fixturePassword = '';
		await writeFile(resolve(artifacts!, 'request-statuses.json'), JSON.stringify(mutations, null, 2));
		await Promise.allSettled([controlContext?.close(), context.close()]);
	}
});
