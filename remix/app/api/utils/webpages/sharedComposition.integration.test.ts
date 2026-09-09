import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Opt-in real API regression: creates only disposable test Things and removes
// those exact Things in finally. Never point a fixture writer at production.
const base = process.env.TT_SHARED_TEST_URL;
test('shared page audience includes its author components, never a foreign private component', { skip: !base }, async () => {
	assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
	const request = async (path: string, method = 'GET', body?: unknown, cookie = '') => {
		const response = await fetch(new URL(path, base), {
			method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		return { response, data: await response.json() };
	};
	const sessionCachePath = process.env.TT_SHARED_SESSION_CACHE;
	const savedSessions: Record<string, string> = sessionCachePath ? JSON.parse(await readFile(sessionCachePath, 'utf8').catch(() => '{}')) : {};
	const saveSession = async (role: string, cookie: string) => {
		savedSessions[role] = cookie;
		if (sessionCachePath) await writeFile(sessionCachePath, JSON.stringify(savedSessions), { mode: 0o600 });
		return cookie;
	};
	const session = async (role: string, existingCookie?: string) => {
		if (existingCookie) return existingCookie;
		if (savedSessions[role]) {
			const current = await request('/api/root-data', 'GET', undefined, savedSessions[role]);
			if (current.data.user?.id) return savedSessions[role];
		}
		if (process.env.TT_SHARED_TEMPORARY === '1') {
			const { response, data } = await request('/api/v1/auth/temporary', 'POST');
			assert.ok(response.status === 200 || response.status === 201, `Temporary test session failed (${response.status}): ${data.error || ''}`);
			return saveSession(role, response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; '));
		}
		const username = `sharingtest${randomUUID().replace(/-/g, '').slice(0, 14)}`;
		const { response, data } = await request('/api/v1/auth/register', 'POST', {
			username, email: `${username}@example.invalid`, password: `${randomUUID()}Aa1!`
		});
		assert.ok(response.status === 200 || response.status === 201, `Test session creation failed (${response.status}, retry-after=${response.headers.get('retry-after')}): ${typeof data.error === 'string' ? data.error : data.statusMessage || 'Request failed'}`);
		return saveSession(role, response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; '));
	};
	const owner = await session('owner', process.env.TT_SHARED_OWNER_COOKIE);
	const stranger = await session('visitor', process.env.TT_SHARED_VISITOR_COOKIE);
	const created: { id: string; cookie: string }[] = [];
	const mediaSource = (name: string) => `/api/v1/attachments/content?id=sharing-browser-${name}`;
	let groupId: string | null = null;
	const create = async (cookie: string, thingtime: string[], crystal: unknown, acl = ['tt:user']) => {
		const { response, data } = await request('/api/v1/things', 'POST', { thingtime, crystal, acl }, cookie);
		assert.equal(response.status, 200, JSON.stringify(data));
		created.push({ id: data.thing.id, cookie });
		return data.thing;
	};
	try {
		const key = `shared-test-${randomUUID()}`;
		const crystal = { name: 'Shared test card', componentKey: key, version: 1, render: { tag: 'div', children: ['Shared card'] } };
		const component = await create(owner, ['component'], crystal, ['tt:hidden', 'tt:user']);
		const foreign = await create(stranger, ['component'], crystal);
		const page = await create(owner, ['webpage'], { name: 'Shared test root', blocks: [
			{ id: 'nested', type: 'container', children: [{ id: 'card', type: 'component', component: key }] },
			{ id: 'foreign', type: 'component', component: foreign.id }
		] }, ['tt:hidden', 'tt:user']);
		assert.ok(page.linkKey);
		const url = `/api/v1/webpages/resolve?id=${page.id}`;
		assert.equal((await request(url)).response.status, 404);
		assert.equal((await request(`${url}&key=wrong`)).response.status, 404);
		for (const cookie of ['', stranger, owner]) {
			const { response, data } = await request(`${url}&key=${encodeURIComponent(page.linkKey)}`, 'GET', undefined, cookie);
			assert.equal(response.status, 200);
			assert.equal(data.refs[key], component.id);
			assert.equal(data.refs[foreign.id], cookie === stranger ? foreign.id : null);
			assert.equal(!!data.components.find((c: any) => c.id === component.id)?.linkKey, cookie === owner);
		}
		assert.equal((await request(`/api/v1/things?id=${component.id}`)).response.status, 404);
		const childAction = await create(owner, ['action'], { name: 'Shared read-only child', actionKey: `${key}-child`, version: 1, capabilities: [], steps: [{ op: 'return', value: 'The Star' }] });
		const sharedAction = await create(owner, ['action'], { name: 'Shared draw', actionKey: `${key}-draw`, version: 1,
			capabilities: [{ capability: 'actions.invoke', actions: [childAction.id] }],
			steps: [{ op: 'actions.invoke', action: childAction.id }, { op: 'return', value: '$step.1' }] });
		const unrelatedAction = await create(owner, ['action'], { name: 'Not included', actionKey: `${key}-secret`, version: 1, capabilities: [], steps: [{ op: 'return', value: 'Private' }] });
		const sourceData = await create(owner, ['data'], { schema: 'sharing-regression', value: 'unchanged' });
		const schemaTemplate = { tag: 'div', children: [
			{ tag: 'p', children: ['Shared value: {value}'] },
			{ tag: 'button', ttAction: childAction.id, children: ['Schema draw'] },
			{ tag: 'p', children: ['{last.result}'] }
		] };
		const dataSchema = await create(owner, ['schema'], { name: `${key}-schema`, title: 'Shared schema', fields: [{ name: 'value', type: 'string', required: true, description: 'Fixture value' }], render: schemaTemplate });
		const standalone = await create(owner, ['data'], { schemaId: dataSchema.id, value: 'Copy my content' }, ['tt:hidden', 'tt:user']);
		const sharedSchemaUrl = `/api/v1/things?id=${dataSchema.id}&sharedRoot=${standalone.id}`;
		assert.equal((await request(`/api/v1/things?id=${dataSchema.id}`)).response.status, 404);
		assert.equal((await request(`${sharedSchemaUrl}&key=wrong`)).response.status, 404);
		const sharedSchema = await request(`${sharedSchemaUrl}&key=${encodeURIComponent(standalone.linkKey)}`);
		assert.equal(sharedSchema.response.status, 200, sharedSchema.data.error);
		assert.equal(sharedSchema.data.thing.id, dataSchema.id);
		assert.deepEqual(sharedSchema.data.thing.crystal.render, schemaTemplate);
		assert.equal(sharedSchema.response.headers.get('Cache-Control'), 'private, no-store');
		assert.equal(sharedSchema.data.thing.linkKey, undefined);
		assert.equal((await request(`/api/v1/things?id=${sourceData.id}&sharedRoot=${standalone.id}&key=${encodeURIComponent(standalone.linkKey)}`)).response.status, 404);
		const schemaRun = (action = childAction.id, key = standalone.linkKey, cookie = '') => request('/api/v1/actions/run', 'POST', { action, sharedRoot: standalone.id, key }, cookie);
		assert.equal((await schemaRun()).data.result, 'The Star');
		assert.equal((await schemaRun(childAction.id, 'wrong')).response.status, 404);
		assert.equal((await schemaRun(unrelatedAction.id)).response.status, 404);
		const publicSchemaData = await create(owner, ['data'], { schemaId: dataSchema.id, value: 'Public search result' }, ['tt:all']);
		for (const [index, { scope, schema }] of [
			{ scope: 'public', schema: dataSchema.id }, { scope: 'public', schema: dataSchema.crystal.name }, { scope: 'own', schema: dataSchema.id }
		].entries()) {
			const searchAction = await create(owner, ['action'], { name: `Shared schema search ${scope}`, actionKey: `${key}-search-${index}`, version: 1,
				capabilities: [{ capability: 'things.read', schemas: [schema] }],
				steps: [{ op: 'things.search', schema, scope }, { op: 'return', value: '$step.1' }] }, ['tt:hidden', 'tt:user']);
			for (const cookie of ['', stranger, owner]) {
				const search = await request('/api/v1/actions/run', 'POST', { action: searchAction.id, sharedRoot: searchAction.id, key: searchAction.linkKey }, cookie);
				assert.equal(search.data.status, 'ok', search.data.error);
				assert.deepEqual(search.data.result.map((row: any) => row.id), scope === 'public' ? [publicSchemaData.id] : [], 'Shared schema resolution must not borrow either account inventory');
			}
			assert.equal((await request('/api/v1/actions/run', 'POST', { action: searchAction.id, sharedRoot: searchAction.id, key: 'wrong' })).response.status, 404);
		}
		const extended = { notes: ['Keep this content'], nested: { value: 7 } };
		assert.equal((await request('/api/v1/things', 'PATCH', { id: standalone.id, extended }, owner)).response.status, 200);
		assert.equal((await request('/api/v1/things/fork', 'POST', { id: standalone.id, key: 'wrong' }, stranger)).response.status, 404);
		const dataCopy = await request('/api/v1/things/fork', 'POST', { id: standalone.id, key: standalone.linkKey }, stranger);
		assert.equal(dataCopy.response.status, 200, dataCopy.data.error);
		for (const id of dataCopy.data.ids) created.push({ id, cookie: stranger });
		assert.equal(dataCopy.data.copied, 3, 'The included private schema and its action inherit the shared data root audience');
		const copiedData = (await request(`/api/v1/things?id=${dataCopy.data.id}`, 'GET', undefined, stranger)).data.thing;
		assert.deepEqual(copiedData.extended, extended);
		assert.deepEqual(copiedData.acl, ['tt:user']);
		assert.notEqual(copiedData.crystal.schemaId, dataSchema.id);
		assert.equal(copiedData.linkKey, undefined);
		const copiedSchema = (await request(`/api/v1/things?id=${copiedData.crystal.schemaId}`, 'GET', undefined, stranger)).data.thing;
		assert.equal(copiedData.crystal.schema, copiedSchema.crystal.name);
		const copiedSchemaAction = copiedSchema.crystal.render.children[1].ttAction;
		assert.notEqual(copiedSchemaAction, childAction.id);
		assert.ok(dataCopy.data.ids.includes(copiedSchemaAction));
		const copiedSchemaRun = await request('/api/v1/actions/run', 'POST', { action: copiedSchemaAction, source: 'component' }, stranger);
		assert.equal(copiedSchemaRun.data.result, 'The Star', copiedSchemaRun.data.error);
		assert.equal((await request(`/api/v1/things?id=${dataCopy.data.id}`)).response.status, 404);
		assert.equal((await request('/api/v1/things', 'PATCH', { id: dataCopy.data.id, crystal: { value: 'My changed copy' } }, stranger)).response.status, 200);
		assert.equal((await request(`/api/v1/things?id=${standalone.id}`, 'GET', undefined, owner)).data.thing.crystal.value, 'Copy my content');
		const readData = await create(owner, ['action'], { name: 'Read included data', actionKey: `${key}-read`, version: 1, capabilities: [{ capability: 'things.read' }], steps: [{ op: 'things.get', id: sourceData.id }, { op: 'return', value: '$step.1.crystal.value' }] }, ['tt:hidden', 'tt:user']);
		const deleteData = await create(owner, ['action'], { name: 'Must not mutate shared data', actionKey: `${key}-delete`, version: 1, capabilities: [{ capability: 'things.delete' }], steps: [{ op: 'things.delete', id: sourceData.id }] }, ['tt:hidden', 'tt:user']);
		const sharedRead = await request('/api/v1/actions/run', 'POST', { action: readData.id, sharedRoot: readData.id, key: readData.linkKey });
		assert.equal(sharedRead.data.result, 'unchanged', sharedRead.data.error);
		for (const cookie of ['', stranger, owner]) {
			const denied = await request('/api/v1/actions/run', 'POST', { action: deleteData.id, sharedRoot: deleteData.id, key: deleteData.linkKey }, cookie);
			assert.equal(denied.data.status, 'error');
			assert.match(denied.data.error, /Fork the app/);
		}
		assert.equal((await request(`/api/v1/things?id=${sourceData.id}`, 'GET', undefined, owner)).data.thing.crystal.value, 'unchanged');
		assert.equal((await request('/api/v1/things', 'PATCH', { id: component.id, crystal: { render: { tag: 'div', children: [
			{ tag: 'button', ttAction: sharedAction.id, children: ['Draw'] }, { tag: 'p', children: ['{last.result}'] },
			...(process.env.TT_SHARED_PLAYWRIGHT_PATH ? [
				{ tag: 'img', props: { src: '/api/v1/attachments/content?id=sharing-browser-transport', alt: 'Shared media transport' } },
				{ tag: 'div', props: { style: { backgroundImage: `url(${mediaSource('html-css')})`, height: 20 } }, children: ['HTML background'] },
				{ tag: 'img', props: { src: 'https://example.invalid/sharing-browser-transport.png', alt: 'External media transport' } }
			] : [])
		] } } }, owner)).response.status, 200);
		const run = (action: string, linkKey = page.linkKey, cookie = '') => request('/api/v1/actions/run', 'POST', { action, sharedRoot: page.id, key: linkKey }, cookie);
		assert.ok([403, 404].includes((await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { name: 'Not allowed' } }, stranger)).response.status));
		assert.equal((await run(sharedAction.id, 'wrong')).response.status, 404);
		assert.equal((await run(unrelatedAction.id)).response.status, 404);
		for (const cookie of ['', stranger, owner]) {
			const response = await run(sharedAction.id, page.linkKey, cookie);
			assert.equal(response.response.status, 200, response.data.error);
			assert.equal(response.data.status, 'ok', response.data.error);
			assert.equal(response.data.result, 'The Star');
			assert.match(response.data.runId, /^shared-run-/);
		}
		if (process.env.TT_SHARED_PLAYWRIGHT_PATH) {
			const chakraMedia = await create(owner, ['component'], { name: 'Shared CSS card', componentKey: `${key}-css`, version: 1, render: {
				type: 'chakra', chakra: 'Box', props: { 'data-testid': 'shared-chakra-css', backgroundImage: { base: `url(${mediaSource('chakra-css')})` }, _hover: { backgroundImage: `url(${mediaSource('hover-css')})` }, minHeight: 20 }, children: ['Chakra background']
			} });
			const cssPage = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: {
				previewBg: `url(${mediaSource('page-css')})`,
				blocks: [...page.crystal.blocks,
					{ id: 'css-block', type: 'text', text: 'Block background', css: { 'background-image': `url(${mediaSource('block-css')})` } },
					{ id: 'css-chakra', type: 'component', component: chakraMedia.id },
					{ id: 'media-link', type: 'text', text: 'Shared media download', href: mediaSource('download') }
				]
			} }, owner);
			assert.equal(cssPage.response.status, 200, cssPage.data.error);
			const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
			const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
			const watchFailures = (tab: any) => {
				const events: unknown[] = [];
				const record = (event: unknown) => { if (events.length < 40) events.push(event); };
				tab.on('pageerror', (error: Error) => record({ error: error.message.replace(/\?[^\s]*/g, '?[redacted]').slice(0, 400) }));
				tab.on('requestfailed', (request: any) => record({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
				tab.on('response', (response: any) => {
					const path = new URL(response.url()).pathname;
					if (response.status() >= 400 || ['/api/root-data', '/api/v1/webpages/resolve'].includes(path)) record({ path, status: response.status() });
				});
				return events;
			};
			try {
				for (const width of [1440, 390]) {
					const context = await browser.newContext({ viewport: { width, height: 900 } });
					const tab = await context.newPage();
					const browserEvents = watchFailures(tab);
					// Only the bytes transport is stubbed here; root/component resolution
					// uses the real API. Attachment ACLs have separate service/route tests.
					const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1kAAAAASUVORK5CYII=', 'base64');
					let mediaReads = 0;
					const cssReads = new Set<string>();
					await tab.route('**/api/v1/attachments/content?*', async (route: any) => {
						const url = new URL(route.request().url());
						const id = url.searchParams.get('id') || '';
						if (!id.startsWith('sharing-browser-')) return route.continue();
						assert.equal(url.searchParams.get('key'), page.linkKey);
						assert.equal(url.searchParams.get('sharedRoot'), page.id);
						mediaReads++;
						cssReads.add(id);
						await route.fulfill({ contentType: 'image/png', body: pixel });
					});
					await tab.route('https://example.invalid/sharing-browser-transport.png*', async (route: any) => {
						assert.equal(new URL(route.request().url()).searchParams.has('key'), false);
						await route.fulfill({ contentType: 'image/png', body: pixel });
					});
					await tab.goto(new URL(`/p/${page.id}?key=${encodeURIComponent(page.linkKey)}`, base).href);
					try {
						await tab.getByRole('button', { name: 'Draw', exact: true }).waitFor({ timeout: 60000 });
					} catch (error) {
						if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-page-render-failure.png` });
						console.error('Shared fixture render diagnostic:', { path: new URL(tab.url()).pathname, browserEvents, text: (await tab.locator('body').innerText()).slice(0, 1600) });
						throw error;
					}
					assert.equal(await tab.getByTestId('p-edit-in-builder').count(), 0);
					const copyBounds = await tab.getByTestId('fork-shared-thing').boundingBox();
					assert.ok(copyBounds && copyBounds.x >= 0 && copyBounds.x + copyBounds.width <= width, 'The copy control must fit inside the mobile/desktop viewport');
					await tab.getByRole('button', { name: 'Draw', exact: true }).click();
					await tab.getByText('The Star', { exact: true }).waitFor({ timeout: 15000 });
					await tab.waitForFunction(() => {
						const img = document.querySelector('img[alt="Shared media transport"]') as HTMLImageElement | null;
						return !!img?.naturalWidth;
					});
					assert.ok(mediaReads > 0);
					await tab.getByTestId('shared-chakra-css').hover();
					for (const name of ['html-css', 'chakra-css', 'page-css', 'block-css', 'hover-css']) {
						if (!cssReads.has(`sharing-browser-${name}`)) await tab.waitForResponse((response: any) => new URL(response.url()).searchParams.get('id') === `sharing-browser-${name}`, { timeout: 15000 });
						assert.ok(cssReads.has(`sharing-browser-${name}`), name);
					}
					const download = new URL(await tab.getByRole('link', { name: 'Shared media download' }).getAttribute('href'), base);
					assert.equal(download.searchParams.get('key'), page.linkKey);
					assert.equal(download.searchParams.get('sharedRoot'), page.id);
					assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-${width}-top.png` });
					await tab.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-${width}-bottom.png` });
					await tab.getByTestId('fork-shared-thing').click();
					await tab.waitForURL('**/login');
					await tab.goto(new URL(`/thing/${standalone.id}?key=${encodeURIComponent(standalone.linkKey)}`, base).href);
					try {
						await tab.getByTestId('fork-shared-thing').waitFor();
						await tab.getByText('Shared value: Copy my content', { exact: true }).waitFor({ timeout: 30000 });
					} catch (error) {
						if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-data-render-failure.png` });
						console.error('Shared Data fixture render diagnostic:', { width, path: new URL(tab.url()).pathname, browserEvents, text: (await tab.locator('body').innerText()).slice(0, 1600) });
						throw error;
					}
					const dataCopyBounds = await tab.getByTestId('fork-shared-thing').boundingBox();
					await tab.getByRole('button', { name: 'Schema draw', exact: true }).click();
					await tab.getByText('The Star', { exact: true }).waitFor();
					await tab.getByRole('button', { name: 'Close', exact: true }).click();
					await tab.getByTestId('thing-data-template').scrollIntoViewIfNeeded();
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-data-${width}-control.png` });
					assert.ok(dataCopyBounds && dataCopyBounds.x >= 0 && dataCopyBounds.x + dataCopyBounds.width <= width);
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-data-${width}-top.png` });
					await tab.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
					assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-data-${width}.png` });
					await tab.getByTestId('fork-shared-thing').click();
					await tab.waitForURL('**/login');
					await context.close();
				}
				const forkPage = await create(owner, ['webpage'], { name: 'Copy this app', blocks: [{ id: 'card', type: 'component', component: component.id }] }, ['tt:hidden', 'tt:user']);
				const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
				await context.addCookies(stranger.split('; ').map((entry) => {
					const index = entry.indexOf('=');
					return { name: entry.slice(0, index), value: entry.slice(index + 1), url: base! };
				}));
				const tab = await context.newPage();
				const browserEvents = watchFailures(tab);
				// These are transport fixtures, not real stored attachments. Keep the
				// authenticated copy check independent of DNS/failed image downloads.
				await tab.route('**/api/v1/attachments/content?*', (route: any) => new URL(route.request().url()).searchParams.get('id')?.startsWith('sharing-browser-') ? route.fulfill({ status: 204 }) : route.continue());
				await tab.route('https://example.invalid/sharing-browser-transport.png*', (route: any) => route.fulfill({ status: 204 }));
				let observedCopy: any;
				let copyRequestSeen = false;
				tab.on('request', (request: any) => { if (new URL(request.url()).pathname === '/api/v1/things/fork') copyRequestSeen = true; });
				const copyResponses: Promise<void>[] = [];
				tab.on('response', (response: any) => {
					if (new URL(response.url()).pathname !== '/api/v1/things/fork' || response.request().method() !== 'POST') return;
					copyResponses.push(response.json().then((result: any) => {
						observedCopy = result;
						if (result.ok) for (const id of result.ids) created.push({ id, cookie: stranger });
					}));
				});
				let copyResult: any;
				try {
					await tab.goto(new URL(`/p/${forkPage.id}?key=${encodeURIComponent(forkPage.linkKey)}`, base).href);
					await tab.getByTestId('fork-shared-thing').waitFor({ timeout: 60000 });
					const [copiedResponse] = await Promise.all([
						tab.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/things/fork' && response.request().method() === 'POST', { timeout: 60000 }),
						tab.getByTestId('fork-shared-thing').click()
					]);
					copyResult = await copiedResponse.json();
				} catch (error) {
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-copy-failure.png` });
					await Promise.all(copyResponses);
					console.error('Copy UI diagnostic:', { path: new URL(tab.url()).pathname, browserEvents, requestObserved: copyRequestSeen, responseObserved: !!observedCopy, text: (await tab.locator('body').innerText()).slice(0, 1600), alerts: await tab.getByRole('alert').allTextContents() });
					throw error;
				}
				assert.equal(copyResult.ok, true, copyResult.error);
				await Promise.all(copyResponses);
				await tab.waitForURL(`**/builder?page=${copyResult.id}`);
				await tab.goto(new URL(`/thing/${dataCopy.data.id}`, base).href);
				const [ownedControl] = await Promise.all([
					tab.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/actions/run'),
					tab.getByRole('button', { name: 'Schema draw', exact: true }).click()
				]);
				assert.equal(ownedControl.request().postDataJSON().sharedRoot, undefined, 'Owned data with an owned schema retains ordinary owner execution');
				assert.equal((await ownedControl.json()).result, 'The Star');
				const foreignSchema = await create(owner, ['schema'], { name: `foreign-schema-${randomUUID()}`, title: 'Foreign schema', fields: [{ name: 'value', type: 'string' }], render: schemaTemplate }, ['tt:all']);
				const ownedForeignData = await create(stranger, ['data'], { schemaId: foreignSchema.id, value: 'Foreign template' });
				await tab.goto(new URL(`/thing/${ownedForeignData.id}`, base).href);
				const [foreignControl] = await Promise.all([
					tab.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/actions/run'),
					tab.getByRole('button', { name: 'Schema draw', exact: true }).click()
				]);
				assert.equal(foreignControl.request().postDataJSON().sharedRoot, ownedForeignData.id, 'A foreign schema never borrows the data owner account authority');
				assert.equal(foreignControl.status(), 404, 'A public foreign schema cannot publish its author private action');
				await context.close();
			} finally { await browser.close(); }
		}
		const changed = await request('/api/v1/things', 'PATCH', { id: page.id, acl: ['tt:user'] }, owner);
		assert.equal(changed.response.status, 200, JSON.stringify(changed.data));
		assert.equal((await request(`${url}&key=${encodeURIComponent(page.linkKey)}`)).response.status, 404);
		assert.equal((await run(sharedAction.id)).response.status, 404, 'Revoked roots must also stop action runs');
		assert.equal((await request('/api/v1/things', 'PATCH', { id: page.id, acl: ['tt:all'] }, owner)).response.status, 200);
		const publicRead = await request(url);
		assert.equal(publicRead.data.refs[key], component.id);
		assert.equal(publicRead.data.components[0].linkKey, undefined);
		// Copy the component root (the page deliberately also has a foreign
		// private component, which must not be silently copied or exposed).
		assert.equal((await request('/api/v1/things/fork', 'POST', { id: component.id, key: component.linkKey })).response.status, 401);
		const copied = await request('/api/v1/things/fork', 'POST', { id: component.id, key: component.linkKey }, stranger);
		assert.equal(copied.response.status, 200, copied.data.error);
		for (const id of copied.data.ids) created.push({ id, cookie: stranger });
		assert.equal(copied.data.copied, 3);
		assert.notEqual(copied.data.id, component.id);
		const copy = await request(`/api/v1/things?id=${copied.data.id}`, 'GET', undefined, stranger);
		assert.deepEqual(copy.data.thing.acl, ['tt:user']);
		assert.equal(!!copy.data.thing.linkKey, false);
		const copiedActionId = copy.data.thing.crystal.render.children[0].ttAction;
		assert.notEqual(copiedActionId, sharedAction.id);
		const ownRun = await request('/api/v1/actions/run', 'POST', { action: copiedActionId, source: 'component' }, stranger);
		assert.equal(ownRun.data.status, 'ok', ownRun.data.error);
		assert.equal(ownRun.data.result, 'The Star');
		assert.equal((await request('/api/v1/things', 'PATCH', { id: copied.data.id, crystal: { name: 'My independent card' } }, stranger)).response.status, 200);
		assert.equal((await request(`/api/v1/things?id=${component.id}`, 'GET', undefined, owner)).data.thing.crystal.name, crystal.name);
		const member = await request('/api/root-data', 'GET', undefined, stranger);
		const group = await request('/api/v1/groups', 'POST', { name: 'Shared composition regression', memberIds: [member.data.user.id] }, owner);
		assert.equal(group.response.status, 201, group.data.error);
		groupId = group.data.group.id;
		assert.equal((await request('/api/v1/things', 'PATCH', { id: standalone.id, acl: ['tt:custom', `tt:group/${groupId}`] }, owner)).response.status, 200);
		assert.equal((await request(`${sharedSchemaUrl}&key=${encodeURIComponent(standalone.linkKey)}`)).response.status, 404, 'Retired root keys cannot read an included schema');
		assert.equal((await request(sharedSchemaUrl, 'GET', undefined, stranger)).response.status, 200);
		assert.equal((await request('/api/v1/things', 'PATCH', { id: page.id, acl: ['tt:custom', `tt:group/${groupId}`] }, owner)).response.status, 200);
		assert.equal((await request(url)).response.status, 404);
		assert.equal((await request(url, 'GET', undefined, stranger)).data.refs[key], component.id);
		assert.equal((await request('/api/v1/things', 'PATCH', { id: page.id, acl: ['tt:custom', `tt:group/${groupId}/write`] }, owner)).response.status, 200);
		const untouched = await create(owner, ['component'], { ...crystal, componentKey: `${key}-unrelated` });
		const unchanged = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { name: 'Edited shared root' } }, stranger);
		assert.equal(unchanged.response.status, 200, unchanged.data.error);
		const injectedAction = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { blocks: [{ id: 'card', type: 'component', component: key, source: { action: unrelatedAction.id } }] } }, stranger);
		assert.equal(injectedAction.response.status, 403, 'A shared writer cannot publish an unrelated private action');
		assert.equal((await request('/api/v1/things', 'PATCH', { id: dataSchema.id, acl: ['tt:custom', `tt:group/${groupId}/write`] }, owner)).response.status, 200);
		const injectedSchemaAction = await request('/api/v1/things', 'PATCH', { id: dataSchema.id, crystal: { render: { tag: 'button', ttAction: unrelatedAction.id, children: ['Not allowed'] } } }, stranger);
		assert.equal(injectedSchemaAction.response.status, 403, 'A schema writer cannot publish an unrelated private action through a shared Data Thing');
		const injectedMedia = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { blocks: [{ id: 'private-media', type: 'media', media: 'image', src: '/api/v1/attachments/content?id=guessed-private-attachment' }] } }, stranger);
		assert.equal(injectedMedia.response.status, 403, 'A shared writer cannot add a media reference they cannot independently read');
		for (const crystal of [
			{ previewBg: 'url(/api/v1/attachments/content?id=guessed-private-css)' },
			{ blocks: [{ id: 'private-css', type: 'text', text: 'No access', css: { background: 'url(/api/v1/attachments/content?id=guessed-private-css)' } }] }
		]) {
			const injectedCss = await request('/api/v1/things', 'PATCH', { id: page.id, crystal }, stranger);
			assert.equal(injectedCss.response.status, 403, 'Shared writers cannot publish private media through CSS');
		}
		for (const ref of [untouched.id, `${key}-unrelated`]) {
			const refused = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { blocks: [{ id: 'stolen', type: 'component', component: ref }] } }, stranger);
			assert.equal(refused.response.status, 403, 'A shared writer must not publish an unrelated private dependency');
		}
		assert.equal((await request('/api/v1/groups', 'PATCH', { id: groupId, memberIds: [] }, owner)).response.status, 200);
		assert.equal((await request(url, 'GET', undefined, stranger)).response.status, 404);
		assert.equal((await request(sharedSchemaUrl, 'GET', undefined, stranger)).response.status, 404);
		assert.equal((await schemaRun(childAction.id, '', stranger)).response.status, 404, 'Group removal also revokes template controls');
	} finally {
		if (groupId) assert.equal((await request('/api/v1/groups', 'DELETE', { id: groupId }, owner)).response.status, 200);
		for (const { id, cookie } of created.reverse()) {
			const result = await request('/api/v1/things', 'DELETE', { id }, cookie);
			assert.equal(result.response.status, 200, JSON.stringify(result.data));
		}
	}
});
