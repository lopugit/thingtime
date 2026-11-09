import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
	repo = dirname(root),
	evidence = process.env.THINGTIME_ROUTE_TEST_DIRECTORY!;
assert.ok(evidence);
const databaseDirectory = process.env.THINGTIME_ROUTE_TEST_DATABASE_DIRECTORY!;
assert.ok(databaseDirectory && process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32);
const origin = 'http://127.0.0.1:28167';
const clientRoot = process.env.THINGTIME_ROUTE_TEST_CLIENT!;
assert.ok(clientRoot);
const env = {
	PATH: process.env.PATH!,
	HOME: process.env.HOME!,
	TMPDIR: process.env.TMPDIR || '/tmp',
	NODE_ENV: 'test',
	MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:28166/thingtime?replicaSet=restore-route',
	JWT_SECRET: process.env.JWT_SECRET!,
	THINGTIME_DATA_ENV: 'custom:restore-route',
	THINGTIME_DATA_AUTHORITY_ORIGIN: origin
};
Object.assign(process.env, env);
await mkdir(databaseDirectory, { recursive: true, mode: 0o700 });
const mongo = spawn(
	'mongod',
	[
		'--bind_ip',
		'127.0.0.1',
		'--port',
		'28166',
		'--dbpath',
		databaseDirectory,
		'--replSet',
		'restore-route',
		'--logpath',
		evidence + '/mongo.log',
		'--wiredTigerCacheSizeGB',
		'0.25',
		'--nounixsocket'
	],
	{ env, stdio: 'ignore' }
);
let browser: any, server: any;
const checks: any[] = [];
const errors: string[] = [];
let currentPage: any;
process.once('SIGTERM', () => {
	mongo.kill('SIGTERM');
	void Promise.resolve(browser?.close()).finally(() => process.exit(1));
});
try {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if ((await readFile(evidence + '/mongo.log', 'utf8').catch(() => '')).includes('Waiting for connections')) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const init = spawnSync(
		'mongosh',
		[
			'--quiet',
			'mongodb://127.0.0.1:28166/?directConnection=true',
			'--eval',
			`rs.initiate({_id:'restore-route',members:[{_id:0,host:'127.0.0.1:28166'}]});while(!db.hello().isWritablePrimary){sleep(100)}`
		],
		{ env, stdio: 'ignore', timeout: 30000 }
	);
	assert.equal(init.status, 0);
	const { middleware } = await import(pathToFileURL(process.env.THINGTIME_ROUTE_TEST_BUNDLE!).href);
	assert.equal(typeof middleware, 'function');
	const gates: any[] = [];
	const gate = (id: string, mode = 'hold') => {
		let arrivedResolve: any, release: any;
		const value: any = {
			id,
			mode,
			used: false,
			active: true,
			stop: () => {
				value.active = false;
			},
			arrived: new Promise((r) => (arrivedResolve = r)),
			released: new Promise((r) => (release = r)),
			arrivedResolve: () => arrivedResolve(),
			release: () => release()
		};
		gates.push(value);
		return value;
	};
	server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url!, origin);
			if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/.well-known/')) {
				const candidate = resolve(clientRoot, '.' + decodeURIComponent(url.pathname));
				// Vercel serves its analytics script outside the app artifact. A
				// missing platform/static asset is a 404, never JavaScript SPA HTML.
				if (
					!(await stat(candidate).catch(() => null))?.isFile() &&
					(url.pathname.startsWith('/_vercel/') || /\.(?:js|mjs|css|wasm|woff2?)$/.test(url.pathname))
				) {
					res.writeHead(404);
					res.end();
					return;
				}
				const file =
					candidate.startsWith(clientRoot + '/') && (await stat(candidate).catch(() => null))?.isFile()
						? candidate
						: resolve(clientRoot, 'index.html');
				const type =
					(
						{
							'.js': 'application/javascript',
							'.mjs': 'application/javascript',
							'.css': 'text/css',
							'.html': 'text/html',
							'.json': 'application/json',
							'.wasm': 'application/wasm',
							'.svg': 'image/svg+xml',
							'.png': 'image/png',
							'.woff2': 'font/woff2'
						} as any
					)[extname(file)] || 'application/octet-stream';
				res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
				createReadStream(file).pipe(res);
				return;
			}
			const waiting = gates.find(
				(value) =>
					(!value.used || (value.mode === 'drop' && value.active)) && url.pathname === '/api/v1/things' && url.searchParams.get('id') === value.id
			);
			if (waiting) {
				waiting.used = true;
				if (waiting.mode === 'drop') {
					waiting.arrivedResolve();
					await waiting.released;
					req.socket.destroy();
					return;
				}
				const originalWrite = res.write.bind(res),
					originalEnd = res.end.bind(res),
					chunks: any[] = [];
				res.write = ((chunk: any, ..._args: any[]) => {
					chunks.push(chunk);
					return true;
				}) as any;
				res.end = ((chunk: any, ..._args: any[]) => {
					if (chunk) chunks.push(chunk);
					waiting.status = res.statusCode;
					waiting.arrivedResolve();
					void waiting.released.then(() => {
						if (res.destroyed) return;
						for (const part of chunks) originalWrite(part);
						originalEnd();
					});
					return res;
				}) as any;
				res.on('error', () => {});
			}
			await middleware(req, res);
		} catch {
			if (!res.headersSent) res.statusCode = 500;
			res.end('Fixture transport failed');
		}
	});
	server.listen(28167, '127.0.0.1');
	await once(server, 'listening');
	const { chromium } = createRequire(repo + '/MCP/package.json')('playwright');
	browser = await chromium.launch({ headless: true, chromiumSandbox: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
	context.on('page', (opened: any) => opened.on('pageerror', (error: any) => errors.push(error.stack || error.message)));
	await context.addInitScript(() => {
		(window as any).__routeErrors = [];
		window.addEventListener('error', (event) => {
			if (event instanceof ErrorEvent) (window as any).__routeErrors.push({ message: event.message, filename: event.filename, line: event.lineno });
		});
	});
	const reg = await context.request.post(origin + '/api/v1/auth/register', {
		data: {
			username: 'route-' + randomUUID().slice(0, 8),
			email: 'route-' + randomUUID() + '@example.invalid',
			password: randomUUID() + '-NeverExport!',
			displayName: 'Synthetic Restore Route'
		}
	});
	assert.equal(reg.status(), 200);
	const registered = await reg.json();
	assert.equal(registered.ok, true);
	const cookie = (await context.cookies(origin)).map((c: any) => c.name + '=' + c.value).join('; ');
	assert.ok(cookie);
	const user = registered.user;
	const req = () => new Request(origin + '/api/v1/things', { headers: { Cookie: cookie, Origin: origin } });
	const { createThing, getThing, updateThing } = await import(pathToFileURL(root + '/app/api/utils/things/things.ts').href);
	const { executeResumableOrdinaryRestore, ordinaryRestoreTargetId, ordinaryRestoreGraphHash } = await import(
		pathToFileURL(root + '/app/api/utils/backups/ordinaryRestoreTransaction.ts').href
	);
	const rootResult = await createThing(user.id, { thingtime: ['folder'], crystal: { name: 'Synthetic restored route' }, acl: ['tt:user'] }, user);
	assert.equal(rootResult.ok, true);
	const review: any = {
		format: 'thingtime-selected-ordinary-restore-v1',
		referenceDomain: 'ordinary-composition-v1',
		operationId: randomUUID(),
		sourceSealHash: 'c'.repeat(64),
		reviewHash: 'd'.repeat(64),
		graphHash: '',
		count: 4,
		destination: {
			scope: { ownerId: user.id, apiOrigin: origin, dataPlane: 'home' },
			rootId: rootResult.doc.shareId,
			rootRevision: rootResult.doc.timelineHeadId,
			capabilities: { 'api.things': '1.52.0', 'api.actions-run': '1.43.0', 'api.timeline': '1.19.2' }
		}
	};
	const id = (source: string) => ordinaryRestoreTargetId(review, source);
	const schemaName = 'route-schema-' + randomUUID().slice(0, 8);
	const records = [
		{
			sourceId: 'source-action',
			input: {
				shareId: id('source-action'),
				folderId: rootResult.doc.shareId,
				thingtime: ['action'],
				acl: ['tt:user'],
				crystal: {
					name: 'Route synthetic action',
					actionKey: 'route-' + randomUUID(),
					runtime: 'browser',
					steps: [{ op: 'return', value: 'route-accepted' }]
				}
			}
		},
		{
			sourceId: 'source-component',
			input: {
				shareId: id('source-component'),
				folderId: rootResult.doc.shareId,
				thingtime: ['component'],
				acl: ['tt:user'],
				crystal: {
					name: 'Restored route component',
					componentKey: 'route-' + randomUUID(),
					render: {
						tag: 'div',
						children: [
							{ tag: 'p', children: 'Real isolated restored presentation' },
							{ tag: 'input', props: { 'aria-label': 'Rendered draft', defaultValue: 'Before restore' } },
							{ tag: 'button', ttAction: id('source-action'), children: 'Run restored action' }
						]
					}
				}
			}
		},
		{
			sourceId: 'source-schema',
			input: {
				shareId: id('source-schema'),
				folderId: rootResult.doc.shareId,
				thingtime: ['schema'],
				acl: ['tt:user'],
				crystal: {
					name: schemaName,
					fields: [],
					render: {
						tag: 'div',
						children: [
							{ tag: 'input', props: { 'aria-label': 'Schema draft' } },
							{ tag: 'button', ttAction: id('source-action'), children: 'Run schema action' }
						]
					}
				}
			}
		},
		{
			sourceId: 'source-data',
			input: {
				shareId: id('source-data'),
				folderId: rootResult.doc.shareId,
				thingtime: ['data'],
				acl: ['tt:user'],
				crystal: { name: 'Nested rendered data', schema: schemaName, schemaId: id('source-schema'), text: 'Independent data' }
			}
		}
	];
	const source = async function* () {
		yield* records;
	};
	Object.assign(review, await ordinaryRestoreGraphHash(source()));
	const abort = new AbortController();
	await assert.rejects(
		executeResumableOrdinaryRestore(req(), review, source, {
			signal: abort.signal,
			afterCheckpoint: async (phase: string, ordinal: number) => {
				if (phase === 'effect' && ordinal === records.length - 1) abort.abort();
			}
		}),
		/abort/i
	);
	const action = async () => {
		const r = await context.request.post(origin + '/api/v1/actions/run', {
			data: { action: id('source-action'), execution: 'browser', executionVersion: '1.40.0' }
		});
		return { status: r.status(), body: await r.json() };
	};
	assert.equal((await action()).status, 409);
	checks.push({ serverHeldRefused: true });
	for (const record of records) {
		const r = await getThing(user, record.input.shareId);
		assert.equal(r.ok && r.thing.executionHeld, true);
		for (const [key, value] of Object.entries(record.input.crystal)) assert.deepEqual(r.ok && r.thing.crystal[key], value);
	}
	const unheldPage = await createThing(
		user.id,
		{
			thingtime: ['webpage'],
			crystal: { name: 'Unheld outer page', blocks: [{ id: 'nested', type: 'component', component: id('source-component') }] },
			acl: ['tt:user']
		},
		user
	);
	assert.equal(unheldPage.ok, true);
	const unheldData = await createThing(
		user.id,
		{ thingtime: ['data'], crystal: { name: 'Unheld outer data', schema: schemaName, schemaId: id('source-schema') }, acl: ['tt:user'] },
		user
	);
	assert.equal(unheldData.ok, true);
	assert.notEqual((await getThing(user, unheldData.doc.shareId)).thing.executionHeld, true);
	const page = await context.newPage();
	currentPage = page;
	page.setDefaultTimeout(20000);
	const responses: any[] = [];
	page.on('response', (r: any) => {
		const u = new URL(r.url());
		if (u.pathname.startsWith('/api/')) responses.push({ path: u.pathname, status: r.status(), origin: u.origin });
	});
	await page.goto(origin + '/thing/' + id('source-component'), { waitUntil: 'domcontentloaded' });
	await page.getByText('Real isolated restored presentation', { exact: true }).waitFor();
	await page.getByText('Restoring content. Actions become available when restoration completes.', { exact: true }).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Run restored action', exact: true }).isDisabled(), true);
	assert.equal(await page.getByLabel('Rendered draft').isDisabled(), true);
	await page.screenshot({ path: evidence + '/desktop-held.png', fullPage: true });
	checks.push({ fullRouteColdHeld: true });
	for (const sourceId of ['source-schema', 'source-data']) {
		await page.goto(origin + '/thing/' + id(sourceId), { waitUntil: 'domcontentloaded' });
		await page.getByText('Restoring content. Actions become available when restoration completes.', { exact: true }).waitFor();
		await page.screenshot({ path: evidence + '/' + sourceId + '-held.png', fullPage: true });
	}
	await page.goto(origin + '/thing/' + unheldPage.doc.shareId);
	await page.getByText('Real isolated restored presentation', { exact: true }).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Run restored action', exact: true }).isDisabled(), true);
	await page.screenshot({ path: evidence + '/nested-component-held.png', fullPage: true });
	await page.goto(origin + '/thing/' + unheldData.doc.shareId);
	await page.getByRole('button', { name: 'Run schema action', exact: true }).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Run schema action', exact: true }).isDisabled(), true);
	await page.screenshot({ path: evidence + '/nested-schema-held.png', fullPage: true });
	await page.goto(origin + '/thing/' + id('source-component') + '?source=' + id('source-action'));
	await page.getByText('Restoring content. Actions become available when restoration completes.', { exact: true }).waitFor();
	assert.equal(await page.getByRole('dialog').count(), 0);
	assert.equal(responses.filter((r) => r.path === '/api/v1/actions/run').length, 0);
	checks.push({ nestedHeldComponent: true, nestedHeldSchema: true, heldUrlSourceNotPromptedOrRun: true });
	await page.goto(origin + '/thing/' + id('source-component'));
	await page.getByText('Real isolated restored presentation', { exact: true }).waitFor();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await page.screenshot({ path: evidence + '/mobile-held.png', fullPage: true });
	const schemaPage = await context.newPage();
	await schemaPage.goto(origin + '/thing/' + unheldData.doc.shareId);
	await schemaPage.getByRole('button', { name: 'Run schema action', exact: true }).waitFor();
	assert.equal(await schemaPage.getByRole('button', { name: 'Run schema action', exact: true }).isDisabled(), true);
	await executeResumableOrdinaryRestore(req(), review, source);
	assert.equal((await action()).status, 200);
	const schemaCurrent = await getThing(user, id('source-schema'));
	assert.equal(schemaCurrent.thing.executionHeld, false);
	// Exercise the real detail-page control: its successful rename calls the
	// same refreshThing callback used by History. Completion itself has no UI
	// broadcast/workflow in this primitive, so release is explicitly refreshed.
	const refreshed = schemaPage.waitForResponse((r: any) => r.url().includes('/api/v1/things') && r.url().includes(id('source-schema')));
	await schemaPage.setViewportSize({ width: 390, height: 844 });
	await schemaPage.getByRole('button', { name: 'Thing actions', exact: true }).click();
	await schemaPage.waitForTimeout(200);
	await schemaPage.screenshot({ path: evidence + '/mobile-actions-menu.png', fullPage: true });
	await schemaPage.getByRole('menuitem', { name: /Rename/ }).click();
	await schemaPage.getByRole('dialog').waitFor();
	await schemaPage.waitForTimeout(250);
	const dialogBounds = await schemaPage.getByRole('dialog').boundingBox();
	assert.ok(
		dialogBounds &&
			dialogBounds.x >= 0 &&
			dialogBounds.x + dialogBounds.width <= 390 &&
			dialogBounds.y >= 0 &&
			dialogBounds.y + dialogBounds.height <= 844
	);
	await schemaPage.screenshot({ path: evidence + '/mobile-rename-dialog.png', fullPage: true });
	await schemaPage.getByLabel('Thing title').fill('Refreshed outer data');
	await schemaPage.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
	await refreshed;
	await schemaPage.waitForTimeout(1000);
	const schemaReleased = await schemaPage.getByRole('button', { name: 'Run schema action', exact: true }).isEnabled();
	checks.push({
		nestedSchemaReleasedAfterRootRefresh: schemaReleased,
		normalRenameControlRevalidatedSchema: true,
		serverSchemaExecutionHeldAfterCompletion: schemaCurrent.thing.executionHeld
	});
	await schemaPage.screenshot({ path: evidence + '/nested-schema-after-refresh.png', fullPage: true });
	await schemaPage.evaluate(() => window.scrollTo(0, 0));
	await schemaPage.screenshot({ path: evidence + '/mobile-schema-released-top.png', fullPage: true });
	await schemaPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	assert.equal(await schemaPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	await schemaPage.screenshot({ path: evidence + '/mobile-schema-released-bottom.png', fullPage: true });
	await page.evaluate(
		(thingId: string) => window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId } })),
		id('source-component')
	);
	await page.getByRole('heading', { name: 'Live preview', exact: true }).waitFor();
	await page.getByText('Restoring content. Actions become available when restoration completes.', { exact: true }).waitFor({ state: 'hidden' });
	await page.getByLabel('Rendered draft').fill('Retained through real read refresh');
	await page.evaluate(
		(thingId: string) => window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId } })),
		id('source-component')
	);
	await page.waitForTimeout(500);
	assert.equal(await page.getByLabel('Rendered draft').inputValue(), 'Retained through real read refresh');
	const pending = page.waitForResponse((r: any) => r.url().includes('/api/v1/actions/run') && r.request().method() === 'POST');
	await page.getByRole('button', { name: 'Run restored action', exact: true }).click();
	const ran = await pending;
	assert.equal(ran.status(), 200);
	await page.screenshot({ path: evidence + '/mobile-released.png', fullPage: true });
	await page.reload();
	await page.getByRole('heading', { name: 'Live preview', exact: true }).waitFor();
	assert.equal(await page.getByRole('button', { name: 'Run restored action', exact: true }).isEnabled(), true);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path: evidence + '/desktop-released.png', fullPage: true });
	assert.ok(responses.filter((r) => r.path === '/api/v1/things').length >= 4);
	assert.ok(responses.every((r) => r.origin === origin));
	await page.goto(origin + '/thing/' + id('source-component') + '?source=' + id('source-action'));
	await page.getByTestId('action-run-approve').waitFor();
	const sourceRun = page.waitForResponse((r: any) => r.url().includes('/api/v1/actions/run') && r.request().method() === 'POST');
	await page.getByTestId('action-run-approve').click();
	assert.equal((await sourceRun).status(), 200);
	checks.push({ releasedUrlSourceConfirmedAndRun: true });
	// The product emits this event after an accepted Timeline version apply
	// (TimelineVersionActions.tsx). The primitive has no automatic release UI.
	const refreshSchema = () =>
		schemaPage.evaluate(
			(thingId: string) => window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId } })),
			unheldData.doc.shareId
		);
	const schemaRead = () => schemaPage.waitForResponse((r: any) => r.url().includes('/api/v1/things') && r.url().includes(id('source-schema')));
	const schemaDraft = schemaPage.getByLabel('Schema draft');
	await schemaDraft.fill('Draft and focus survive verification');
	await schemaDraft.focus();
	let schemaRuns = 0;
	schemaPage.on('request', (r: any) => {
		if (new URL(r.url()).pathname === '/api/v1/actions/run') schemaRuns++;
	});
	const transient = gate(id('source-schema'), 'drop');
	await refreshSchema();
	await transient.arrived;
	assert.equal(await schemaDraft.inputValue(), 'Draft and focus survive verification');
	assert.equal(await schemaDraft.evaluate((node: any) => document.activeElement === node), true);
	await schemaPage.getByRole('button', { name: 'Run schema action', exact: true }).click();
	assert.equal(schemaRuns, 0);
	transient.release();
	await schemaPage.waitForTimeout(200);
	assert.equal(await schemaDraft.inputValue(), 'Draft and focus survive verification');
	await schemaPage.getByRole('button', { name: 'Run schema action', exact: true }).click();
	assert.equal(schemaRuns, 0, 'A failed authoritative read leaves the retained template inert');
	await schemaPage.screenshot({ path: evidence + '/transient-inert-draft.png', fullPage: true });
	transient.stop();
	const recovered = schemaRead();
	await refreshSchema();
	await recovered;
	await schemaPage.waitForTimeout(100);
	assert.equal(await schemaDraft.inputValue(), 'Draft and focus survive verification');
	const oldError = gate(id('source-schema'), 'drop');
	await refreshSchema();
	await oldError.arrived;
	oldError.stop();
	const freshAfterError = schemaRead();
	await refreshSchema();
	await freshAfterError;
	oldError.release();
	await schemaPage.waitForTimeout(100);
	assert.equal(await schemaDraft.inputValue(), 'Draft and focus survive verification');
	const allowedSchemaRun = schemaPage.waitForResponse((r: any) => r.url().includes('/api/v1/actions/run') && r.request().method() === 'POST');
	await schemaPage.getByRole('button', { name: 'Run schema action', exact: true }).click();
	assert.equal((await allowedSchemaRun).status(), 200);
	checks.push({
		transientRetainsInertDraft: true,
		focusSurvivesPendingRead: true,
		staleErrorIgnored: true,
		staleSuccessIgnored: true,
		freshSchemaActionAllowed: true
	});
	// A separately authorized Schema may be revoked while its owner's Data
	// stays readable. Capture a real old 200, then refuse a fresh read via ACL.
	const foreignContext = await browser.newContext();
	const foreignSignup = await foreignContext.request.post(origin + '/api/v1/auth/register', {
		data: {
			username: 'foreign-' + randomUUID().slice(0, 8),
			email: randomUUID() + '@example.invalid',
			password: randomUUID() + '-NeverExport!',
			displayName: 'Synthetic Schema Owner'
		}
	});
	assert.equal(foreignSignup.status(), 200);
	const foreignUser = (await foreignSignup.json()).user;
	const foreignSchemaName = 'foreign-schema-' + randomUUID().slice(0, 8);
	const foreignSchema = await createThing(
		foreignUser.id,
		{
			thingtime: ['schema'],
			crystal: { name: foreignSchemaName, fields: [], render: { tag: 'p', children: 'Authorized foreign schema projection' } },
			acl: ['tt:all']
		},
		foreignUser
	);
	assert.equal(foreignSchema.ok, true);
	const foreignData = await createThing(
		user.id,
		{
			thingtime: ['data'],
			crystal: { name: 'Readable outer private data', schema: foreignSchemaName, schemaId: foreignSchema.doc.shareId },
			acl: ['tt:user']
		},
		user
	);
	assert.equal(foreignData.ok, true);
	await schemaPage.goto(origin + '/thing/' + foreignData.doc.shareId);
	await schemaPage.getByText('Authorized foreign schema projection', { exact: true }).waitFor();
	const staleForeign = gate(foreignSchema.doc.shareId);
	await schemaPage.evaluate(
		(thingId: string) => window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId } })),
		foreignData.doc.shareId
	);
	await staleForeign.arrived;
	assert.equal(staleForeign.status, 200);
	assert.equal((await updateThing(foreignUser, foreignSchema.doc.shareId, { acl: ['tt:user'] })).ok, true);
	const refused = schemaPage.waitForResponse((r: any) => r.url().includes('/api/v1/things') && r.url().includes(foreignSchema.doc.shareId));
	await schemaPage.evaluate(
		(thingId: string) => window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId } })),
		foreignData.doc.shareId
	);
	assert.ok([403, 404].includes((await refused).status()));
	await schemaPage.getByText('Authorized foreign schema projection', { exact: true }).waitFor({ state: 'hidden' });
	staleForeign.release();
	await schemaPage.waitForTimeout(100);
	assert.equal(await schemaPage.getByText('Authorized foreign schema projection', { exact: true }).count(), 0);
	assert.equal((await getThing(user, foreignData.doc.shareId)).ok, true);
	assert.equal((await getThing(user, foreignSchema.doc.shareId)).ok, false);
	await schemaPage.screenshot({ path: evidence + '/revoked-schema-cleared.png', fullPage: true });
	checks.push({
		foreignRevocationClearsProtectedTemplate: true,
		readableOuterDataPreserved: true,
		staleAuthorizedSuccessCannotRestoreRevokedTemplate: true
	});
	await foreignContext.close();

	checks.push({
		completedServerAllowed: true,
		realRefreshReleases: true,
		draftPreservedAcrossReadRefresh: true,
		cachedReloadReleased: true,
		browserActionRequestSucceeded: true,
		realApiOrigin: origin,
		apiResponses: responses,
		errors
	});
	checks.push({ browserErrorLocations: await page.evaluate(() => (window as any).__routeErrors) });
	assert.deepEqual(errors, [], 'Every real route page must remain free of uncaught errors');
	await writeFile(
		evidence + '/results.json',
		JSON.stringify(
			{
				source: JSON.parse(process.env.THINGTIME_ROUTE_TEST_SOURCE!),
				checks,
				ids: Object.fromEntries(records.map((r) => [r.sourceId, r.input.shareId]))
			},
			null,
			2
		)
	);
	assert.equal(schemaReleased, true, 'Fresh route refresh must release the completed schema');
	console.log('REAL_ROUTE_ACCEPTANCE_PASS');
} catch (error: any) {
	if (currentPage) {
		await currentPage.screenshot({ path: evidence + '/failure.png', fullPage: true }).catch(() => {});
		await writeFile(
			evidence + '/failure-visible.txt',
			await currentPage
				.locator('body')
				.innerText()
				.catch(() => '')
		);
	}
	await writeFile(evidence + '/failure.json', JSON.stringify({ error: String(error?.stack || error), errors }, null, 2));
	console.error('REAL_ROUTE_ACCEPTANCE_FAILED: ' + String(error?.message || error));
	process.exitCode = 1;
} finally {
	await browser?.close();
	server?.closeAllConnections();
	if (server?.listening) await new Promise((r) => server.close(r));
	mongo.kill('SIGTERM');
	await Promise.race([once(mongo, 'exit'), new Promise((r) => setTimeout(r, 5000))]);
	await rm(databaseDirectory, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
