#!/usr/bin/env node
// Real API / real Builder acceptance. Disposable database, identity and browser;
// normal networking. Mongo access is limited to replica-set initialization.
// Prerequisites: build the real Nitro backend, install Playwright separately,
// and supply an isolated Chrome for Testing/Chromium executable. Example:
// BUILDER_SERVER_DIR=/absolute/immutable/server BUILDER_EVIDENCE_DIR=/tmp/builder-evidence \
// PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs CHROMIUM_EXECUTABLE=/absolute/chrome \
// node remix/scripts/builder-nesting-acceptance.mjs
// BUILDER_SERVER_DIR defaults to remix/.output/server; accepts both node-server
// and node-middleware builds. Snapshot that directory before concurrent builds.
// MONGOD_PATH defaults to /opt/homebrew/bin/mongod. No local .env is inherited.
// --api-only hosts an empty disposable replica set/API for native acceptance,
// reports only public origin/ports/PID, and cleans up on SIGINT/SIGTERM or 15min.
// The full run always closes its browser and removes only its own temp state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-builder-nesting-'));
const evidence = process.env.BUILDER_EVIDENCE_DIR || join(tmpdir(), 'thingtime-builder-nesting-evidence');
await mkdir(evidence, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, timeout = 30000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await delay(150);
	}
	throw Error('Acceptance condition timed out');
};
const free = async (requested = 0) => {
	const s = createServer();
	await new Promise((r, j) => {
		s.once('error', j);
		s.listen(requested, '127.0.0.1', r);
	});
	const p = s.address().port;
	await new Promise((r) => s.close(r));
	return p;
};
const ports = {
	db: await free(),
	api: await free(Number(process.env.BUILDER_API_PORT || 0)),
	web: await free(),
	hmr: await free(),
	cdp: await free()
};
const origin = `http://127.0.0.1:${ports.api}`,
	web = `http://127.0.0.1:${ports.web}`;
const env = {
	PATH: process.env.PATH,
	TMPDIR: dir,
	NODE_ENV: 'production',
	HOST: '127.0.0.1',
	PORT: String(ports.api),
	MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=buildernesting`,
	JWT_SECRET: randomBytes(48).toString('hex'),
	THINGTIME_DATA_ENV: 'development',
	TT_WEB_PORT: String(ports.web),
	TT_API_PORT: String(ports.api),
	TT_HMR_PORT: String(ports.hmr)
};
const children = [];
function start(command, args, extra = {}) {
	const child = spawn(command, args, { cwd, env: { ...env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	let log = '';
	child.stdout.on('data', (d) => {
		log = (log + d).slice(-100000);
	});
	child.stderr.on('data', (d) => {
		log = (log + d).slice(-100000);
	});
	children.push({ child, log: () => log });
	return child;
}
async function stop(child) {
	if (child.exitCode !== null) return;
	const exit = once(child, 'exit');
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {}
	const timer = setTimeout(() => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {}
	}, 3000);
	await exit;
	clearTimeout(timer);
}
let cookie = '',
	browser,
	page,
	client;
const checks = [];
const record = (value) => {
	checks.push(value);
	console.log('passed: ' + value);
};
async function api(path, { body, method = body ? 'POST' : 'GET' } = {}) {
	const r = await fetch(origin + path, {
		method,
		headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(30000)
	});
	const data = await r.json();
	assert(r.ok, `${method} ${path.split('?')[0]}: ${r.status} ${data.error || ''}`);
	return { r, data };
}
const leaf = (id, text) => ({ id, type: 'text', text });
const blocks = [
	{
		id: 'outer',
		type: 'container',
		direction: 'column',
		gap: 4,
		padding: 0,
		children: [
			{
				id: 'grid',
				type: 'container',
				direction: 'grid',
				columns: 2,
				gap: 4,
				padding: 0,
				children: [leaf('grid-one', 'Grid original one'), leaf('grid-two', 'Grid original two')]
			},
			{
				id: 'row',
				type: 'container',
				direction: 'row',
				gap: 4,
				padding: 0,
				children: [leaf('row-one', 'Row original one'), leaf('row-two', 'Row original two')]
			},
			{
				id: 'column',
				type: 'container',
				direction: 'column',
				gap: 4,
				padding: 0,
				children: [leaf('column-one', 'Column original one'), leaf('column-two', 'Column original two')]
			},
			{
				id: 'element',
				type: 'element',
				tag: 'section',
				css: { padding: '0' },
				children: [leaf('element-one', 'Element original one'), leaf('element-two', 'Element original two')]
			}
		]
	},
	leaf('end', 'End of nested acceptance page')
];
let deep = { id: 'deep-leaf', type: 'element', tag: 'p', text: 'Deep nested leaf with a deliberately long title for narrow viewport verification' };
for (let n = 8; n > 0; n--)
	deep = {
		id: `deep-${n}`,
		type: 'element',
		tag: 'section',
		props: { name: `Ancestor level ${n} descriptive title` },
		css: { padding: '0' },
		children: [deep]
	};
blocks.push(deep, {
	id: 'bottom-grid',
	type: 'container',
	direction: 'grid',
	columns: 2,
	gap: 4,
	padding: 0,
	css: { 'margin-top': '300px' },
	children: [leaf('bottom-left', 'Bottom left cell'), leaf('bottom-right', 'Bottom right cell')]
});
const flatten = (rows) => rows.flatMap((b) => [b, ...flatten(b.children || [])]);
try {
	await mkdir(join(dir, 'db'));
	start(process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod', [
		'--dbpath',
		join(dir, 'db'),
		'--port',
		String(ports.db),
		'--bind_ip',
		'127.0.0.1',
		'--replSet',
		'buildernesting',
		'--nounixsocket'
	]);
	client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
	await until(async () => {
		try {
			await client.connect();
			return true;
		} catch {
			return false;
		}
	});
	await client.db('admin').command({ replSetInitiate: { _id: 'buildernesting', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
	await until(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary);
	await client.close();
	client = null;
	start(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`const mod=await import(process.env.BUILDER_SERVER_ENTRY);if(typeof mod.middleware==='function'){const{createServer}=await import('node:http');createServer(mod.middleware).listen(Number(process.env.PORT),'127.0.0.1');}`
		],
		{ BUILDER_SERVER_ENTRY: pathToFileURL(join(process.env.BUILDER_SERVER_DIR || join(cwd, '.output/server'), 'index.mjs')).href }
	);
	await until(async () => {
		try {
			return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(1000) })).ok;
		} catch {
			return false;
		}
	});
	const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
	assert(manifest.features?.['api.things']);
	assert(manifest.features?.['api.webpages-resolve']);
	if (process.argv.includes('--api-only')) {
		console.log(JSON.stringify({ origin, ports, pid: process.pid, expiresInMinutes: 15, productionAccess: false }));
		await new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(finish, 15 * 60 * 1000);
			process.once('SIGTERM', finish);
			process.once('SIGINT', finish);
		});
	} else {
		const username = `builder-${randomBytes(8).toString('hex')}`;
		const registered = await api('/api/v1/auth/register', {
			body: { username, email: `${username}@example.invalid`, password: randomBytes(32).toString('hex'), displayName: 'Disposable Builder Tester' }
		});
		cookie = registered.r.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ');
		assert(cookie);
		assert(registered.data.user?.id);
		const created = (
			await api('/api/v1/things', {
				body: {
					thingtime: ['webpage'],
					acl: ['tt:user'],
					crystal: { name: 'Nested Builder acceptance', pageKey: `nesting-${randomBytes(8).toString('hex')}`, blocks }
				}
			})
		).data;
		const id = created.thing?.id || created.id;
		assert(id);
		record('disposable replica set, API-created account and private saved page');
		start(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import {createServer} from 'vite';const server=await createServer({envDir:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`
			],
			{ NODE_ENV: 'development' }
		);
		await until(async () => {
			try {
				return (await fetch(web)).ok;
			} catch {
				return false;
			}
		});
		const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
		browser = await chromium.launch({
			headless: true,
			chromiumSandbox: true,
			executablePath: process.env.CHROMIUM_EXECUTABLE,
			...(process.env.BUILDER_DEBUG === '1' ? { args: [`--remote-debugging-port=${ports.cdp}`] } : {})
		});
		const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
		for (const c of cookie.split('; ')) {
			const at = c.indexOf('=');
			await context.addCookies([{ name: c.slice(0, at), value: c.slice(at + 1), url: web, httpOnly: true, sameSite: 'Lax' }]);
		}
		page = await context.newPage();
		page.setDefaultTimeout(12000);
		await page.goto(`${web}/builder?page=${id}`, { waitUntil: 'domcontentloaded' });
		await page.locator('[data-block-id="grid-one"]').waitFor({ timeout: 60000 });
		const select = async (bid) => {
			await page
				.locator(`[data-block-id="${bid}"]`)
				.first()
				.click({ position: { x: 8, y: 8 } });
		};
		const insertText = async () => {
			await page.getByTestId('block-insert-menu').getByRole('button', { name: /Text/ }).first().click();
		};
		for (const parent of ['grid', 'row', 'column', 'element']) {
			await select(`${parent}-one`);
			await page.getByTestId(`breadcrumb-${parent}`).click();
			for (let n = 0; n < 2; n++) {
				await page.getByTestId(`add-child-${parent}`).click();
				await insertText();
				if (n === 0) {
					await select(`${parent}-one`);
					await page.getByTestId(`breadcrumb-${parent}`).click();
				}
			}
		}
		record('two children inserted into each populated grid, row, column and element');
		await select('grid-one');
		for (const bid of ['outer', 'grid', 'grid-one']) await page.getByTestId(`breadcrumb-${bid}`).waitFor();
		await page.screenshot({ path: join(evidence, 'desktop-breadcrumbs.png'), fullPage: true });
		record('all zero-padding ancestor titles exposed');
		await page.getByTestId('inline-add-grid-one').click();
		await insertText();
		record('inline plus sibling insertion');
		for (const direction of ['above', 'below', 'left', 'right']) {
			await select('row-one');
			await page.getByTestId('menu-block-row-one').click();
			await page.getByTestId(`ctx-insert-${direction}`).click();
			await insertText();
		}
		record('four directional context insertions');
		for (const scope of ['page', 'parent', 'block']) {
			await select('element-one');
			await page.getByTestId('menu-block-element-one').click();
			await page.getByTestId(`ctx-structure-${scope}`).click();
			await page.getByTestId('block-structure-modal').waitFor();
			await page.getByTestId('block-structure-modal').locator('[id="structure-node-element-one"]').click();
			await page.getByTestId('block-structure-modal').waitFor({ state: 'hidden' });
			await page.getByTestId('builder-drawer').locator('textarea').first().waitFor();
		}
		record('page, parent and block structure modal selection opens nested inspector');
		await select('element-one');
		await page.getByTestId('builder-drawer').locator('textarea').first().fill('Element edited individually');
		await page.getByTestId('builder-drawer').locator('textarea').first().blur();
		await page.getByRole('button', { name: /^Visit/ }).click();
		await page.waitForURL(/\/(p|t)\//);
		const saved = (await api(`/api/v1/things?id=${id}`)).data.thing;
		const persisted = flatten(saved.crystal.blocks);
		assert(persisted.some((b) => b.text === 'Element edited individually'));
		assert.equal(persisted.filter((b) => b.text === 'Write something lovely ✨').length, 13, 'All thirteen inserted text blocks must persist');
		for (const parent of ['grid', 'column', 'element'])
			assert(persisted.find((b) => b.id === parent).children.length >= 4, `${parent} lost inserted children`);
		await page.reload();
		await page.getByText('Element edited individually', { exact: true }).waitFor();
		record('individual nested edit and insertions persisted through exact-ID readback and reload');

		await page.goto(`${web}/builder?page=${id}`, { waitUntil: 'domcontentloaded' });
		await page.locator('[data-block-id="element-one"]').waitFor();
		await select('element-one');
		await page.getByTestId('menu-block-element-one').click();
		await page.getByTestId('ctx-structure-page').click();
		const modal = page.getByTestId('block-structure-modal');
		await modal.waitFor();
		await modal.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await modal.locator('[data-block-id="structure-node-label"]').first().click();
		const settingsDrawer = page.getByTestId('builder-drawer').filter({ hasText: 'Settings layout' });
		for (const [bid, text] of [
			['structure-node-label', '{item.label} · reviewed'],
			['structure-node-selection', '{item.selection} · selection'],
			['structure-node-detail', '{item.detail} · detail']
		]) {
			await settingsDrawer.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(bid);
			await settingsDrawer.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
			await settingsDrawer.getByRole('textbox', { name: 'Block text', exact: true }).blur();
		}
		const layoutResponse = page.waitForResponse((response) => {
			try {
				return (
					response.url().endsWith('/api/v1/things') &&
					['POST', 'PATCH'].includes(response.request().method()) &&
					response.request().postDataJSON()?.crystal?.pageKey === 'settings-builder-block-structure'
				);
			} catch {
				return false;
			}
		});
		await modal.getByRole('button', { name: 'Save layout', exact: true }).click();
		const layoutResult = await (await layoutResponse).json();
		assert(layoutResult.ok);
		const layoutId = layoutResult.thing.id;
		const layoutRead = (await api(`/api/v1/things?id=${layoutId}`)).data.thing;
		assert.equal(flatten(layoutRead.crystal.blocks).find((b) => b.id === 'structure-node-label').text, '{item.label} · reviewed');
		assert.equal(flatten(layoutRead.crystal.blocks).find((b) => b.id === 'structure-node-selection').text, '{item.selection} · selection');
		assert.equal(flatten(layoutRead.crystal.blocks).find((b) => b.id === 'structure-node-detail').text, '{item.detail} · detail');
		await modal.getByRole('button', { name: 'Done editing layout', exact: true }).click();
		await page.screenshot({ path: join(evidence, 'structure-customized.png'), fullPage: true });
		await page.keyboard.press('Escape');
		await page.reload();
		await page.locator('[data-block-id="element-one"]').waitFor();
		await select('element-one');
		await page.getByTestId('menu-block-element-one').click();
		await page.getByTestId('ctx-structure-page').click();
		await page.getByTestId('block-structure-modal').getByText('text · reviewed', { exact: true }).first().waitFor();
		await page.keyboard.press('Escape');
		record('individually edited row label, selection and detail layout saved to a private Thing with exact-ID readback and reload');
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`${web}/builder?page=${id}`, { waitUntil: 'domcontentloaded' });
			await page.locator('[data-block-id="element-one"]').waitFor();
			await select('element-one');
			await page.getByTestId('menu-block-element-one').click();
			await page.screenshot({ path: join(evidence, `menu-${width}.png`), fullPage: true });
			await page.keyboard.press('Escape');
			await page.getByTestId('menu-block-element-one').click();
			await page.keyboard.press('Escape');

			if (await page.getByTestId('builder-close').isVisible()) await page.getByTestId('builder-close').click();
			for (let repeat = 0; repeat < 2; repeat++) {
				await page.getByTestId('menu-block-element-one').click();
				await page.getByTestId('ctx-structure-block').click();
				await page.getByTestId('block-structure-modal').waitFor();
				await page.screenshot({ path: join(evidence, `structure-${width}-${repeat}.png`), fullPage: true });
				await page.getByTestId('block-structure-modal').locator('[id="structure-node-element-one"]').click();
				await page.getByTestId('builder-drawer').waitFor();
				assert.equal(await page.getByTestId('builder-drawer').locator('textarea').first().inputValue(), 'Element edited individually');
				await page.getByTestId('builder-close').click();
			}
			for (const y of [0, 900, 1800, 999999]) {
				await page.evaluate((y) => {
					window.scrollTo(0, y);
					document.querySelector('#lopuPageScroll')?.scrollTo(0, y);
				}, y);
				assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} horizontal overflow`);
			}
			await page.screenshot({ path: join(evidence, `bottom-${width}.png`), fullPage: true });
			for (const bid of ['bottom-right', 'deep-leaf']) {
				const target = page.locator(`[data-block-id="${bid}"]`);
				await target.evaluate((e) => e.scrollIntoView({ block: 'center' }));
				await select(bid);
				const toolbar = page.getByRole('toolbar', { name: 'Block path and insertion' });
				await toolbar.waitFor();
				const box = await toolbar.boundingBox(),
					footer = await page.getByRole('toolbar', { name: 'Page controls' }).boundingBox();
				assert(
					box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 900 + 1,
					`${width} ${bid} toolbar outside viewport`
				);
				assert(box.y + box.height <= footer.y - 1, `${width} ${bid} toolbar overlaps Page controls`);
				await page.getByTestId(`menu-block-${bid}`).scrollIntoViewIfNeeded();
				await page.screenshot({ path: join(evidence, `toolbar-${bid}-${width}.png`), fullPage: true });
				await page.getByTestId(`menu-block-${bid}`).click();
				await page.getByTestId('ctx-structure-block').waitFor();
				await page.keyboard.press('Escape');
			}
		}
		record('desktop 1440, mobile 390 and narrow 320 menu Escape and top-to-bottom overflow checks');
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${web}/builder?page=${id}`, { waitUntil: 'domcontentloaded' });
		await page.locator('[data-block-id="deep-leaf"]').waitFor();
		await page.getByRole('button', { name: 'Viewport controls', exact: true }).click();
		await page.getByRole('combobox', { name: 'Preview size', exact: true }).selectOption('mobile');
		await page.getByRole('button', { name: 'Close viewport controls', exact: true }).click();
		await page.locator('iframe[title="Responsive page preview"]').evaluate((e) => e.scrollIntoView({ block: 'start' }));
		const responsive = page.frameLocator('iframe[title="Responsive page preview"]');
		await responsive.locator('[data-block-id="deep-leaf"]').hover();
		await responsive.getByRole('toolbar', { name: 'Block path and insertion' }).waitFor();
		await responsive.locator('[data-block-id="deep-leaf"]').click({ position: { x: 8, y: 8 } });
		const iframeToolbar = responsive.getByRole('toolbar', { name: 'Block path and insertion' });
		await iframeToolbar.waitFor();
		const bounds = await iframeToolbar.evaluate((e) => {
			const r = e.getBoundingClientRect(),
				w = e.ownerDocument.defaultView;
			return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: w.innerWidth, height: w.innerHeight };
		});
		assert(
			bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1,
			'Responsive iframe breadcrumb toolbar outside owning viewport'
		);
		await page.screenshot({ path: join(evidence, 'responsive-iframe-breadcrumbs.png'), fullPage: true });
		await responsive.getByTestId('inline-add-deep-leaf').click();
		await page.getByTestId('block-insert-menu').waitFor();
		await page.getByRole('button', { name: 'View', exact: true }).click();
		await page.getByTestId('block-insert-menu').waitFor({ state: 'hidden' });
		await iframeToolbar.waitFor({ state: 'hidden' });
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.locator('iframe[title="Responsive page preview"]').evaluate((e) => e.scrollIntoView({ block: 'start' }));
		await responsive.locator('[data-block-id="deep-leaf"]').click({ position: { x: 8, y: 8 } });
		await iframeToolbar.waitFor();
		const afterView = (await api(`/api/v1/things?id=${id}`)).data.thing;
		assert.deepEqual(afterView.crystal.blocks, saved.crystal.blocks, 'Opening an insert menu then switching View must not mutate saved blocks');
		record('responsive iframe deep breadcrumbs remain reachable; View transition dismisses insert menu without writes');

		await writeFile(
			join(evidence, 'result.json'),
			JSON.stringify(
				{ ok: true, checks, ports, pageId: id, productionAccess: false, network: 'normal', source: 'local Vite and built Nitro' },
				null,
				2
			)
		);
		console.log(JSON.stringify({ ok: true, checks, evidence, ports }));
	}
} catch (error) {
	if (page) {
		const diagnostics = await page
			.evaluate(() =>
				Array.from(document.querySelectorAll('[data-testid=builder-drawer]')).map((e) => {
					const r = e.getBoundingClientRect();
					const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(200, r.height / 2));
					const ancestors = [];
					for (let n = e; n && ancestors.length < 8; n = n.parentElement) {
						const s = getComputedStyle(n);
						ancestors.push({
							tag: n.tagName,
							role: n.getAttribute('role'),
							position: s.position,
							z: s.zIndex,
							overflow: s.overflow,
							transform: s.transform
						});
					}
					return {
						box: r.toJSON(),
						hit: hit?.tagName,
						hitTestid: hit?.getAttribute('data-testid'),
						insideDialog: !!e.closest('[role=dialog]'),
						ancestors
					};
				})
			)
			.catch(() => []);
		await writeFile(join(evidence, 'ui-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
	}
	if (page) await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
	await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: false, error: error.message, checks, ports }, null, 2));
	console.error(error.stack);
	process.exitCode = 1;
	if (process.env.BUILDER_DEBUG === '1' && browser) {
		console.log(JSON.stringify({ debugOrigin: `http://127.0.0.1:${ports.cdp}`, pid: process.pid, expiresInMinutes: 10 }));
		await new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(finish, 10 * 60 * 1000);
			process.once('SIGTERM', finish);
			process.once('SIGINT', finish);
		});
	}
} finally {
	await client?.close().catch(() => {});
	await browser?.close().catch(() => {});
	for (const running of children.reverse()) {
		await stop(running.child);
		await writeFile(
			join(evidence, `service-${running.child.pid}.log`),
			running
				.log()
				.split('\n')
				.filter((line) => !/(cookie|password|token|secret|authorization|verify-email)/i.test(line))
				.join('\n'),
			{ mode: 0o600 }
		);
	}
	await rm(dir, { recursive: true, force: true });
}
