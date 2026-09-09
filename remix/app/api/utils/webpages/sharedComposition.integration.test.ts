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
			{ tag: 'button', ttAction: sharedAction.id, children: ['Draw'] }, { tag: 'p', children: ['{last.result}'] }
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
			const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
			const browser = await chromium.launch({ headless: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
			try {
				for (const width of [1440, 390]) {
					const context = await browser.newContext({ viewport: { width, height: 900 } });
					const tab = await context.newPage();
					await tab.goto(new URL(`/p/${page.id}?key=${encodeURIComponent(page.linkKey)}`, base).href);
					await tab.getByRole('button', { name: 'Draw', exact: true }).waitFor({ timeout: 60000 });
					assert.equal(await tab.getByTestId('p-edit-in-builder').count(), 0);
					const copyBounds = await tab.getByTestId('fork-shared-thing').boundingBox();
					assert.ok(copyBounds && copyBounds.x >= 0 && copyBounds.x + copyBounds.width <= width, 'The copy control must fit inside the mobile/desktop viewport');
					await tab.getByRole('button', { name: 'Draw', exact: true }).click();
					await tab.getByText('The Star', { exact: true }).waitFor({ timeout: 15000 });
					assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-${width}-top.png` });
					await tab.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
					if (process.env.TT_SHARED_SCREENSHOT_DIR) await tab.screenshot({ path: `${process.env.TT_SHARED_SCREENSHOT_DIR}/shared-${width}-bottom.png` });
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
				await tab.goto(new URL(`/p/${forkPage.id}?key=${encodeURIComponent(forkPage.linkKey)}`, base).href);
				const copiedResponse = tab.waitForResponse((response: any) => response.url().endsWith('/api/v1/things/fork') && response.request().method() === 'POST');
				await tab.getByTestId('fork-shared-thing').click();
				const copyResult = await (await copiedResponse).json();
				assert.equal(copyResult.ok, true, copyResult.error);
				for (const id of copyResult.ids) created.push({ id, cookie: stranger });
				await tab.waitForURL(`**/builder?page=${copyResult.id}`);
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
		assert.equal((await request('/api/v1/things', 'PATCH', { id: page.id, acl: ['tt:custom', `tt:group/${groupId}`] }, owner)).response.status, 200);
		assert.equal((await request(url)).response.status, 404);
		assert.equal((await request(url, 'GET', undefined, stranger)).data.refs[key], component.id);
		assert.equal((await request('/api/v1/things', 'PATCH', { id: page.id, acl: ['tt:custom', `tt:group/${groupId}/write`] }, owner)).response.status, 200);
		const untouched = await create(owner, ['component'], { ...crystal, componentKey: `${key}-unrelated` });
		const unchanged = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { name: 'Edited shared root' } }, stranger);
		assert.equal(unchanged.response.status, 200, unchanged.data.error);
		const injectedAction = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { blocks: [{ id: 'card', type: 'component', component: key, source: { action: unrelatedAction.id } }] } }, stranger);
		assert.equal(injectedAction.response.status, 403, 'A shared writer cannot publish an unrelated private action');
		for (const ref of [untouched.id, `${key}-unrelated`]) {
			const refused = await request('/api/v1/things', 'PATCH', { id: page.id, crystal: { blocks: [{ id: 'stolen', type: 'component', component: ref }] } }, stranger);
			assert.equal(refused.response.status, 403, 'A shared writer must not publish an unrelated private dependency');
		}
		assert.equal((await request('/api/v1/groups', 'PATCH', { id: groupId, memberIds: [] }, owner)).response.status, 200);
		assert.equal((await request(url, 'GET', undefined, stranger)).response.status, 404);
	} finally {
		if (groupId) assert.equal((await request('/api/v1/groups', 'DELETE', { id: groupId }, owner)).response.status, 200);
		for (const { id, cookie } of created.reverse()) {
			const result = await request('/api/v1/things', 'DELETE', { id }, cookie);
			assert.equal(result.response.status, 200, JSON.stringify(result.data));
		}
	}
});
