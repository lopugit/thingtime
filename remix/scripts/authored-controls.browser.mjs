#!/usr/bin/env node
// Built HTTP handler + real disposable replica set. Application fixtures use
// supported APIs only; Mongo is used solely to initiate/observe the replica.
// No inherited account, vault, application configuration or test profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-authored-controls-'));
const children = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const availablePort = async () => {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
};
const ports = { db: await availablePort(), api: await availablePort(), web: await availablePort() };
const origin = `http://127.0.0.1:${ports.api}`;
const env = {
	PATH: process.env.PATH || '/usr/bin:/bin',
	HOME: dir,
	TMPDIR: dir,
	NODE_ENV: 'development',
	HOST: '127.0.0.1',
	PORT: String(ports.api),
	MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=authoredcontrols`,
	JWT_SECRET: randomBytes(48).toString('hex'),
	THINGTIME_DATA_ENV: 'development'
};
function start(command, args) {
	const child = spawn(command, args, { cwd, env, detached: true, stdio: 'ignore' });
	children.push(child);
	return child;
}
async function waitFor(read, label) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if (await read()) return;
		await delay(200);
	}
	throw Error(`Timed out: ${label}`);
}
async function api(path, { cookie, token, body, method = body === undefined ? 'GET' : 'POST', status = 200 } = {}) {
	const start = performance.now();
	const response = await fetch(origin + path, {
		method,
		headers: {
			Origin: origin,
			'Content-Type': 'application/json',
			...(cookie ? { Cookie: cookie } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(45000)
	});
	const text = await response.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = null;
	}
	assert.equal(
		response.status,
		status,
		`${method} ${path.split('?')[0]} unexpected status${typeof data?.error === 'string' ? `: ${data.error}` : ''}`
	);
	return {
		data,
		ms: Math.round((performance.now() - start) * 100) / 100,
		bytes: Buffer.byteLength(text),
		cache: response.headers.get('cache-control'),
		cookie: (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ')
	};
}
const register = () =>
	api('/api/v1/auth/register', {
		body: {
			username: 'largepage' + randomBytes(6).toString('hex'),
			email: `largepage${randomUUID()}@example.invalid`,
			password: randomBytes(32).toString('hex')
		}
	});
const { createServer: createViteServer } = await import('vite');
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const reportDir = process.env.AUTHORED_CONTROLS_REPORT_DIR || join(dir, 'evidence');
let client, vite, browser;
try {
	await mkdir(reportDir, { recursive: true });
	await mkdir(join(dir, 'db'));
	start(process.env.MONGOD_PATH || 'mongod', [
		'--dbpath',
		join(dir, 'db'),
		'--port',
		String(ports.db),
		'--bind_ip',
		'127.0.0.1',
		'--replSet',
		'authoredcontrols',
		'--nounixsocket'
	]);
	client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
	await waitFor(async () => {
		try {
			await client.connect();
			return true;
		} catch {
			return false;
		}
	}, 'Mongo startup');
	await client.db('admin').command({ replSetInitiate: { _id: 'authoredcontrols', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
	await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
	await client.close();
	client = null;
	const server = start(process.execPath, [process.env.AUTHORED_CONTROLS_SERVER_ENTRY || '.output/server/index.mjs']);
	await waitFor(async () => {
		assert.equal(server.exitCode, null, 'Nitro exited');
		try {
			return (await fetch(origin + '/.well-known/thingtime-capabilities.json')).ok;
		} catch {
			return false;
		}
	}, 'Nitro');
	const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
	assert.equal(manifest.origin, origin);
	for (const [f, v] of Object.entries({
		'api.things': '1.50.0',
		'api.things-update': '1.19.0',
		'api.actions-run': '1.41.0',
		'api.webpages-resolve': '1.12.0',
		'api.maps': '1.2.0'
	}))
		assert.equal(manifest.features[f].version, v);
	const owner = await register();
	assert(owner.cookie);
	const schema = (
		await api('/api/v1/things', {
			cookie: owner.cookie,
			body: {
				thingtime: ['schema'],
				crystal: {
					name: 'Synthetic authored fields',
					fields: [
						{ name: 'title', type: 'string' },
						{ name: 'document', type: 'json' },
						{ name: 'text', type: 'string' }
					]
				},
				visibility: 'private'
			}
		})
	).data.thing;
	const action = (
		await api('/api/v1/things', {
			cookie: owner.cookie,
			body: {
				thingtime: ['action'],
				visibility: 'private',
				crystal: {
					name: 'Synthetic form save',
					runtime: 'browser',
					inputs: [
						{ name: 'id', type: 'string', required: true },
						{ name: 'title', type: 'string' },
						{ name: 'document', type: 'json' },
						{ name: 'text', type: 'string' },
						...Array.from({ length: 14 }, (_, index) => ({ name: `extra${index}`, type: 'string' }))
					],
					capabilities: [{ capability: 'http.request', endpoints: ['POST /api/v1/things'] }],
					steps: [
						{
							op: 'http.request',
							method: 'POST',
							path: '/api/v1/things',
							feature: 'api.things',
							minimumVersion: '1.50.0',
							body: {
								id: '$input.id',
								thingtime: ['data'],
								schemaId: schema.id,
								visibility: 'private',
								crystal: { title: '$input.title', document: '$input.document', text: '$input.text' }
							}
						},
						{ op: 'return', value: { silent: true, id: '$input.id' } }
					]
				}
			}
		})
	).data.thing;
	const page = (
		await api('/api/v1/things', {
			cookie: owner.cookie,
			body: {
				thingtime: ['webpage'],
				crystal: { name: 'Synthetic controls', blocks: [{ id: 'heading', type: 'text', text: 'Synthetic fixture' }] },
				visibility: 'private'
			}
		})
	).data.thing;
	let html = '';
	vite = await createViteServer({
		plugins: [
			{
				name: 'authored-controls-fixture',
				configureServer(v) {
					v.middlewares.use((req, res, next) => {
						if (req.url?.startsWith('/p/')) {
							res.setHeader('content-type', 'text/html');
							res.end(html);
						} else next();
					});
				}
			}
		],
		root: cwd,
		cacheDir: join(dir, 'vite-cache'),
		configFile: false,
		envDir: false,
		publicDir: false,
		resolve: { alias: { '~': join(cwd, 'app') } },
		server: {
			host: '127.0.0.1',
			port: ports.web,
			strictPort: true,
			hmr: false,
			proxy: { '/api': { target: origin, changeOrigin: false }, '/.well-known': { target: origin, changeOrigin: false } }
		}
	});
	await vite.listen();
	html = await vite.transformIndexHtml(
		'/p/' + page.id,
		`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px system-ui;color:#20282d;background:#f6f8f9}#root{max-width:840px;margin:24px auto;padding:16px}button,input{min-height:44px;padding:8px} [popover]{max-height:75vh;overflow:auto}</style><div id="root"></div><script type="module" src="/scripts/authored-controls.browser.fixture.tsx"></script></html>`
	);
	browser = await chromium.launch({
		chromiumSandbox: true,
		...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {})
	});
	const webOrigin = `http://127.0.0.1:${ports.web}`;
	const reports = [];
	for (const [profile, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } })) {
		if (process.env.AUTHORED_CONTROLS_PROFILE && process.env.AUTHORED_CONTROLS_PROFILE !== profile) continue;
		const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile' });
		try {
			await context.addCookies(
				owner.cookie.split('; ').map((pair) => {
					const split = pair.indexOf('=');
					return { name: pair.slice(0, split), value: pair.slice(split + 1), url: webOrigin };
				})
			);
			await context.addInitScript(
				(data) => {
					window.authoredFixture = data;
				},
				{ user: owner.data.user, action: action.id, page: page.id }
			);
			const tab = await context.newPage();
			tab.setDefaultTimeout(20000);
			const errors = [],
				writes = [];
			tab.on('pageerror', (e) => {
				errors.push(e.message);
				console.error('Synthetic page error:', e.message);
			});
			tab.on('console', (m) => {
				if (m.type() === 'error') console.error('Synthetic console error:', m.text().slice(0, 400));
			});
			tab.on('requestfailed', (r) => console.error('Synthetic request failure:', new URL(r.url()).pathname, r.failure()?.errorText));
			tab.on('response', async (response) => {
				if (response.url().includes('/actions/')) {
					const r = await response.json().catch(() => ({}));
					console.error('Synthetic Action status:', new URL(response.url()).pathname, response.status(), r.status, r.error);
				}
				if (response.url().includes('/api/') && response.status() >= 400) {
					let r;
					try {
						r = await response.json();
					} catch {}
					console.error('Synthetic API refusal:', new URL(response.url()).pathname, response.status(), r?.error);
				}
				if (response.url() === webOrigin + '/api/v1/things' && response.request().method() === 'POST') {
					const result = await response.json();
					if (response.request().postDataJSON()?.schemaId === schema.id) {
						assert(result.thing?.id);
						writes.push(result.thing);
					}
				}
			});
			await tab.goto(webOrigin + '/p/' + page.id, { waitUntil: 'networkidle', timeout: 90000 });
			for (const framed of [false, true]) {
				if (framed) await tab.getByRole('button', { name: 'Toggle Builder iframe' }).click();
				const root = framed ? tab.frameLocator('iframe') : tab;
				assert.equal(await root.locator('.codex-editor').count(), 0, 'closed menus and details do not construct SDK roots');
				await tab.getByRole('button', { name: 'Empty hidden default' }).click();
				await root.getByRole('button', { name: 'Save deferred defaults' }).click();
				await tab.locator('p[role="status"]').filter({ hasText: 'Enter text before saving this field.' }).waitFor();
				const expectedToast = tab.locator('.chakra-toast').filter({ hasText: 'Enter text before saving this field.' });
				await expectedToast.getByRole('button', { name: 'Close', exact: true }).click();
				await expectedToast.waitFor({ state: 'hidden' });
				assert.equal(await root.locator('.codex-editor').count(), 0, 'required validation does not require an SDK');
				await tab.getByRole('button', { name: 'Refresh hidden default' }).click();
				let deferredCount = writes.length;
				await root.getByRole('button', { name: 'Save deferred defaults' }).click();
				await waitFor(async () => writes.length === deferredCount + 1, 'hidden current default save');
				await root.locator('[aria-busy="true"][data-tt-action]').waitFor({ state: 'detached' });
				const defaultSaved = (await api('/api/v1/things?id=' + writes.at(-1).id, { cookie: owner.cookie })).data.thing;
				assert.equal(defaultSaved.crystal.text, 'Newest hidden default');
				assert.equal(defaultSaved.crystal.document.kind, 'rich-text');
				assert.equal(await root.locator('.codex-editor').count(), 0, 'untouched hidden save keeps engine deferred');
				const details = root.getByRole('group', { name: 'Deferred fields' });
				const summary = details.locator('summary');
				await summary.click();
				const deferredEditor = details.locator('[contenteditable=true]').first();
				await deferredEditor.waitFor({ timeout: 60000 });
				const originalEditor = await deferredEditor.elementHandle();
				await deferredEditor.fill('Retained dirty draft');
				await summary.click();
				await tab.getByRole('button', { name: 'Replace server default' }).click();
				assert.equal(await root.locator('.codex-editor').count(), 1, 'once-opened SDK remains mounted while collapsed');
				await summary.click();
				assert.equal(await deferredEditor.innerText(), 'Retained dirty draft');
				assert.equal(await deferredEditor.evaluate((node, original) => node === original, originalEditor), true);
				await summary.click();
				deferredCount = writes.length;
				await root.getByRole('button', { name: 'Save deferred defaults' }).click();
				await waitFor(async () => writes.length === deferredCount + 1, 'collapsed dirty draft save');
				await root.locator('[aria-busy="true"][data-tt-action]').waitFor({ state: 'detached' });
				const retainedSaved = (await api('/api/v1/things?id=' + writes.at(-1).id, { cookie: owner.cookie })).data.thing;
				assert.equal(retainedSaved.crystal.text, 'Retained dirty draft');
				const target = root.getByRole('button', { name: 'Context target' });
				await target.waitFor({ timeout: 60000 }).catch(async (error) => {
					await tab.screenshot({ path: join(reportDir, 'boot-failure.png') });
					await writeFile(
						join(reportDir, 'boot-errors.json'),
						JSON.stringify({ errors, body: (await tab.locator('body').innerText()).slice(0, 1500) })
					);
					throw error;
				});
				await target.focus();
				await target.press('Shift+F10');
				const menu = root.getByRole('menu');
				await menu.waitFor({ state: 'visible' });
				const editable = menu.locator('[contenteditable=true]').first();
				await editable.waitFor();
				const observations = [];
				const observe = async (phase) =>
					observations.push({
						phase,
						parentScroll: await tab.evaluate(() => scrollY),
						local: await editable.evaluate((el) => ({
							text: el.textContent,
							html: el.innerHTML,
							active: el.ownerDocument.activeElement === el,
							selection: el.ownerDocument.getSelection()?.toString()
						}))
					});
				await editable.fill('Latest ' + profile + ' ' + (framed ? 'iframe' : 'page'));
				await observe('fill');
				await editable.press('ControlOrMeta+A');
				await observe('select');
				await editable.press('ControlOrMeta+B');
				await observe('bold');
				await editable.press('ArrowRight');
				await observe('collapse selection');
				await editable.pressSequentially(' bold');
				await observe('type');
				await writeFile(join(reportDir, profile + '-' + (framed ? 'iframe' : 'page') + '-keyboard.json'), JSON.stringify(observations, null, 2));
				await menu.getByRole('textbox', { name: 'Native title' }).fill('Native click snapshot');
				const before = writes.length;
				await menu
					.getByRole('menuitem', { name: 'Save latest' })
					.click()
					.catch(async (error) => {
						await tab.screenshot({ path: join(reportDir, 'click-failure.png'), fullPage: true });
						await writeFile(
							join(reportDir, 'click-bounds.json'),
							JSON.stringify({
								profile,
								framed,
								menu: await menu.evaluate((el) => ({
									rect: el.getBoundingClientRect().toJSON(),
									width: el.ownerDocument.defaultView.innerWidth,
									height: el.ownerDocument.defaultView.innerHeight,
									scroll: el.scrollTop,
									scrollHeight: el.scrollHeight,
									overflow: getComputedStyle(el).overflow,
									html: el.innerText.slice(-300)
								})),
								button: await menu.getByRole('menuitem', { name: 'Save latest' }).boundingBox(),
								frame: framed ? await tab.locator('iframe').boundingBox() : null
							})
						);
						throw error;
					});
				await waitFor(async () => writes.length === before + 1, 'one rich save').catch(async (error) => {
					await tab.screenshot({ path: join(reportDir, 'submit-failure.png'), fullPage: true });
					await writeFile(
						join(reportDir, 'submit-failure.json'),
						JSON.stringify({ errors, body: (await tab.locator('body').innerText()).slice(0, 3000) })
					);
					throw error;
				});
				await root.locator('[aria-busy="true"][data-tt-action]').waitFor({ state: 'detached' });
				assert.equal(writes.length, before + 1, 'single write');
				const saved = (await api('/api/v1/things?id=' + writes.at(-1).id, { cookie: owner.cookie })).data.thing;
				assert.match(saved.crystal.text, /Latest/);
				assert.match(saved.crystal.text, /bold/);
				assert.equal(saved.crystal.document.kind, 'rich-text');
				assert.match(JSON.stringify(saved.crystal.document), /<b>|<strong>/);
				assert.equal(saved.crystal.title, 'Native click snapshot');
				await root.getByRole('button', { name: 'More actions' }).click();
				await menu.waitFor({ state: 'visible' });
				await menu.getByRole('textbox', { name: 'Plain title' }).fill('No rich fields');
				const count = writes.length;
				const plainControl = menu.getByRole('menuitem', { name: 'Save plain' });
				if (framed && profile === 'mobile') {
					const mapped = await plainControl.evaluate((el) => {
						const rect = el.getBoundingClientRect(),
							view = el.ownerDocument.defaultView,
							frame = view.frameElement,
							outer = frame.getBoundingClientRect();
						const sx = outer.width / frame.clientWidth,
							sy = outer.height / frame.clientHeight;
						const local = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
						const point = { x: outer.left + local.x * sx, y: outer.top + local.y * sy };
						return {
							point,
							local,
							scale: { x: sx, y: sy },
							rect: rect.toJSON(),
							frame: outer.toJSON(),
							innerHit: el.contains(el.ownerDocument.elementFromPoint(local.x, local.y)),
							outerHit: view.parent.document.elementFromPoint(point.x, point.y) === frame,
							outerElement: (() => {
								const hit = view.parent.document.elementFromPoint(point.x, point.y);
								return hit
									? {
											tag: hit.tagName,
											cls: String(hit.className),
											role: hit.getAttribute('role'),
											text: hit.textContent.slice(0, 240),
											toast: !!hit.closest('.chakra-toast'),
											html: hit.outerHTML.slice(0, 600)
									  }
									: null;
							})()
						};
					});
					await writeFile(
						join(reportDir, 'mobile-iframe-hit-mapping.json'),
						JSON.stringify({ locatorBox: await plainControl.boundingBox(), ...mapped }, null, 2)
					);
					await tab.screenshot({ path: join(reportDir, 'mobile-iframe-before-plain.png'), fullPage: true });
					assert.equal(mapped.innerHit, true);
					assert.equal(mapped.outerHit, true);
					await tab.touchscreen.tap(mapped.point.x, mapped.point.y);
				} else await plainControl.click();
				await waitFor(async () => writes.length === count + 1, 'one plain save').catch(async (error) => {
					await tab.screenshot({ path: join(reportDir, 'plain-submit-failure.png'), fullPage: true });
					await writeFile(
						join(reportDir, 'plain-submit-failure.json'),
						JSON.stringify(
							{
								profile,
								framed,
								writes: writes.length,
								status: await tab.locator('p[role="status"]').innerText(),
								body: await plainControl.evaluate((el) => el.ownerDocument.body.innerText.slice(-1800))
							},
							null,
							2
						)
					);
					throw error;
				});
				await root.locator('[aria-busy="true"][data-tt-action]').waitFor({ state: 'detached' });
				assert.equal(writes.length, count + 1);
				assert.equal(writes.at(-1).crystal.title, 'No rich fields');
				await target.focus();
				await target.press('Shift+F10');
				await menu.waitFor({ state: 'visible' });
				await menu.press('Escape');
				await menu.waitFor({ state: 'hidden' });
				await target.focus();
				assert(await target.evaluate((el) => el.ownerDocument.activeElement === el));
				await root.getByRole('button', { name: 'More actions' }).click();
				await menu.waitFor({ state: 'visible' });
				const bounds = await menu.boundingBox();
				assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.width <= viewport.width);
				await tab.screenshot({ path: join(reportDir, profile + (framed ? '-iframe' : '-page') + '.png'), fullPage: true });
				await menu.press('Escape');
			}
			await tab.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			assert.deepEqual(errors, []);
			reports.push({
				profile,
				writes: writes.length,
				iframe: true,
				immediateFormattedSave: true,
				plainMenuSubmit: true,
				hiddenDefaultWithoutSdk: true,
				requiredHiddenRefusal: true,
				collapsedDirtyRetention: true,
				errors: errors.length
			});
		} finally {
			await context.close();
		}
	}
	const report = { ok: true, realApi: true, disposableReplica: true, profiles: reports, productionDataUsed: false };
	await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));
} finally {
	await browser?.close();
	await vite?.close();
	await client?.close().catch(() => {});
	await Promise.all(
		children.map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {
				return;
			}
			await Promise.race([once(child, 'exit'), delay(3000)]);
			if (child.exitCode === null && child.signalCode === null)
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch {}
		})
	);
	await rm(dir, { recursive: true, force: true });
}
