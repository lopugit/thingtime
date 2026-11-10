#!/usr/bin/env node
// Disposable end-to-end acceptance for externally authored Agent Tasks Things.
// Services and browser children run under an OS network fence. Product writes
// use only the local HTTP API; Mongo is used only to initialize the replica set.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const browserMode = process.argv[2] === '--browser';
const fixturePath = browserMode ? process.argv[3] : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (fn, { timeout = 15000, interval = 100 } = {}) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(interval); }
	throw new Error('Timed out waiting for acceptance condition');
};

if (browserMode) {
	const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(fixturePath, 'utf8'));
	const evidence = process.env.AGENT_OVERVIEW_EVIDENCE_DIR;
	if (!evidence || !process.env.PLAYWRIGHT_MODULE || !process.env.CHROMIUM_EXECUTABLE) throw new Error('Browser acceptance requires an evidence directory, Playwright module, and isolated Chromium executable');
	await mkdir(evidence, { recursive: true });
	const playwright = await import(process.env.PLAYWRIGHT_MODULE);
	const { chromium } = playwright.default || playwright;
	console.log('browser: launching isolated Chromium');
	const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'] });
	console.log('browser: creating context');
	const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
	for (const cookie of fixture.cookies) await context.addCookies([cookie]);
	console.log('browser: creating page');
	let page = await context.newPage();
	const dashboardPage = await context.newPage();
	try {
		console.log('browser: checking network boundary');
		let directDenied = false;
		try { await page.goto('http://1.1.1.1:80/', { timeout: 2500 }); } catch { directDenied = true; }
		assert.equal(directDenied, true, 'Browser network fence must reject direct public requests');
		let redirectedDenied = false;
		try { await page.goto(fixture.redirect, { timeout: 2500 }); } catch { redirectedDenied = true; }
		assert.equal(redirectedDenied, true, 'Browser network fence must reject redirected public requests');
		console.log('browser: boundary checked, closing probe');
		void page.close({runBeforeUnload:true}).catch(()=>{});
		page = dashboardPage;
		console.log('browser: loading dashboard');
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${fixture.webOrigin}/p/${encodeURIComponent(fixture.entryPageKey)}`, { waitUntil: 'domcontentloaded' });
		await page.getByText(fixture.taskTitle, { exact: true }).first().waitFor({ timeout: 25000 });
		await page.screenshot({ path: join(evidence, 'agent-overview-desktop.png'), fullPage: true });
    const liveTitle = `${fixture.taskTitle} · live`;
    const liveWrite = await context.request.patch(`${fixture.webOrigin}/api/v1/things`, {data:{id:fixture.taskId,crystal:{title:liveTitle,tokenUsage:2000}}});
    assert.equal(liveWrite.ok(),true);
    await page.getByText(liveTitle,{exact:true}).waitFor({timeout:15000});
    await page.getByText('2333',{exact:true}).waitFor({timeout:15000});
    fixture.taskTitle = liveTitle;
    console.log('browser: real Thing update arrived without reload');
		const taskCard = page.locator('details').filter({ hasText: fixture.taskTitle }).first();
		await taskCard.locator(':scope > summary').click();
		await taskCard.getByText('Measured tokens', { exact: true }).first().waitFor({ timeout: 5000 });
        const runtime=taskCard.getByText(/^\d{2}:\d{2}:\d{2}$/).first();
        await runtime.waitFor({timeout:5000});
        const beforeTick=await runtime.innerText();
        await waitFor(async()=>await runtime.innerText()!==beforeTick,{timeout:3000});
        const endTime=new Date().toISOString();
        const endWrite=await context.request.patch(`${fixture.webOrigin}/api/v1/things`,{data:{id:fixture.taskId,crystal:{endedAt:endTime}}});
        assert.equal(endWrite.ok(),true);
        await taskCard.getByText(endTime,{exact:true}).waitFor({timeout:15000});
        const stoppedRuntime=await runtime.innerText();await delay(1200);
        assert.equal(await runtime.innerText(),stoppedRuntime,'Runtime must stop at a reported end time');
        await taskCard.getByLabel('Status', {exact:true}).selectOption('blocked');
        await taskCard.getByRole('button',{name:'Save status',exact:true}).click();
        await waitFor(async()=>{const r=await context.request.get(`${fixture.webOrigin}/api/v1/things?id=${fixture.taskId}`);return (await r.json()).thing?.crystal?.status==='blocked';});
        await taskCard.locator(':scope > summary').getByText('blocked',{exact:true}).waitFor({timeout:15000});
        await page.getByLabel('Your answer',{exact:true}).first().fill('Verified by the isolated browser acceptance run.');
        await page.getByRole('button',{name:'Save answer',exact:true}).first().click();
        await page.getByText('Verified by the isolated browser acceptance run.',{exact:true}).waitFor({timeout:15000});
        const answerRead=await context.request.get(`${fixture.webOrigin}/api/v1/things?id=${fixture.questionId}`);
        assert.equal((await answerRead.json()).thing?.crystal?.answer,'Verified by the isolated browser acceptance run.');
        console.log('browser: status and question Actions persisted and streamed');
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const desktopBounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, height: document.documentElement.scrollHeight }));
		assert(desktopBounds.width <= desktopBounds.viewport + 1, 'Desktop page must not overflow horizontally');
		await page.screenshot({ path: join(evidence, 'agent-overview-desktop-bottom.png'), fullPage: true });

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${fixture.webOrigin}/p/${encodeURIComponent(fixture.entryPageKey)}`, { waitUntil: 'domcontentloaded' });
		await page.getByText(fixture.taskTitle, { exact: true }).first().waitFor({ timeout: 25000 });
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const mobileBounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, height: document.documentElement.scrollHeight }));
		assert(mobileBounds.width <= mobileBounds.viewport + 1, 'Mobile page must not overflow horizontally');
		await page.screenshot({ path: join(evidence, 'agent-overview-mobile.png'), fullPage: true });

    for (const view of ['Kanban','List','Reports','Hierarchy']) {
      await page.getByRole('button',{name:new RegExp(`^${view}\\s*✓?$`)}).click();
      await page.getByRole('button',{name:new RegExp(`^${view}\\s*✓$`)}).waitFor({timeout:15000});
      if(view==='Reports') await page.getByText('Initial acceptance progress report',{exact:true}).first().waitFor({timeout:15000});
      else await page.getByText(fixture.taskTitle,{exact:true}).first().waitFor({timeout:15000});
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${view} mobile overflow`);
      await page.screenshot({path:join(evidence,`agent-overview-${view.toLowerCase()}-mobile.png`),fullPage:true});
    }
        const createPanel=page.locator('details').filter({has:page.locator('summary').getByText('Create a task or subtask',{exact:true})});
        await createPanel.locator(':scope > summary').click();
        await createPanel.getByLabel('Title',{exact:true}).fill('Created through the dashboard');
        await createPanel.getByLabel('Project Thing ID',{exact:true}).fill(fixture.projectId);
        await createPanel.getByLabel('Parent task Thing ID',{exact:true}).fill(fixture.taskId);
        await createPanel.getByRole('button',{name:'Create task',exact:true}).click();
        await page.getByText('Created through the dashboard',{exact:true}).waitFor({timeout:15000});
        await page.getByLabel('Search',{exact:true}).fill('Created through the dashboard');
        await page.getByRole('button',{name:'Apply filters',exact:true}).click();
        await waitFor(async()=>new URL(page.url()).searchParams.get('q')==='Created through the dashboard');
        await waitFor(async()=>await page.getByText(fixture.taskTitle,{exact:true}).count()===0);
        await page.getByText('Created through the dashboard',{exact:true}).waitFor({timeout:15000});
        await page.getByLabel('Search',{exact:true}).fill('');
        await page.getByRole('button',{name:'Apply filters',exact:true}).click();
        await page.getByText(fixture.taskTitle,{exact:true}).waitFor({timeout:15000});
        for(const title of ['Create a project','Add an agent or subagent','Record progress','Ask a question']){
          const panel=page.locator('details').filter({has:page.locator('summary').getByText(title,{exact:true})});
          await panel.locator(':scope > summary').click();
        }
        await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Expanded mobile forms overflow');
        await page.screenshot({path:join(evidence,'agent-overview-expanded-forms-mobile.png'),fullPage:true});
        console.log('browser: create Action, search filters and expanded mobile forms passed');
		// Edit one ordinary text block in the actual Builder, save via Visit, and
		// verify the published page after the navigation reload.
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${fixture.webOrigin}/builder?page=${encodeURIComponent(fixture.entryPageId)}`, { waitUntil: 'domcontentloaded' });
		const editable = page.locator(`[data-block-id="${fixture.editBlockId}"]`).getByText(fixture.editText, { exact: true }).first();
		await editable.waitFor({ timeout: 20000 });
		await editable.click();
		const input = page.getByRole('textbox', { name: 'Block text', exact: true });
		await input.waitFor({ timeout: 5000 });
		const changedText = `${fixture.editText} · acceptance edit`;
		await input.fill(changedText);
		await input.blur();
        for (const sample of fixture.editSamples) {
          await page.getByRole('combobox',{name:'Select block',exact:true}).selectOption(sample.id);
          await input.fill(sample.changedText);
          await input.blur();
        }
		await page.getByRole('button', { name: /^Visit/ }).click();
		await page.getByText(changedText, { exact: true }).first().waitFor({ timeout: 20000 });
		await page.getByRole('button',{name:'Refresh live',exact:true}).waitFor({timeout:10000});
        await page.getByText('Acceptance Project · editable',{exact:true}).waitFor({timeout:10000});
        await page.screenshot({ path: join(evidence, 'agent-overview-builder-saved.png'), fullPage: true });
		await writeFile(join(evidence, 'browser-result.json'), JSON.stringify({ ok: true, desktopBounds, mobileBounds, changedText }, null, 2), { mode: 0o600 });
	} catch (error) {
		await page.screenshot({path:join(evidence,'browser-failure.png'),fullPage:true}).catch(()=>{});
		await writeFile(join(evidence,'browser-failure.txt'),await page.locator('body').innerText().catch(()=>''),{mode:0o600});
		throw error;
	} finally {
		await context.close();
		await browser.close();
	}
	process.exit(0);
}

const authoredThingsPath = process.env.AGENT_OVERVIEW_AUTHORED_THINGS;
if (!authoredThingsPath) throw new Error('Set AGENT_OVERVIEW_AUTHORED_THINGS to the external authored Things JSON; no committed definitions are used');
const authoredThings = JSON.parse(await (await import('node:fs/promises')).readFile(authoredThingsPath, 'utf8'));
assert(Array.isArray(authoredThings.schemas) && authoredThings.schemas.length, 'External authored Things fixture must include saved schema definitions');
assert(Array.isArray(authoredThings.actions) && authoredThings.actions.length, 'External authored Things fixture must include saved Action definitions');
const authoredSchemas = Object.fromEntries(authoredThings.schemas.map(schema => [schema.key, schema]));
for (const role of ['task', 'project', 'agent', 'question', 'progress', 'todo']) assert(authoredSchemas[role]?.crystal?.name, `External fixture is missing the ${role} schema Thing`);

const dir = await mkdtemp(join(tmpdir(), 'tt-agent-overview-'));
const evidence = process.env.AGENT_OVERVIEW_EVIDENCE_DIR || join(tmpdir(), 'thingtime-agent-overview-evidence');
const port = async () => {
	const server = createServer();
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const value = server.address().port;
	await new Promise(resolve => server.close(resolve));
	return value;
};
const ports = { api: await port(), db: await port(), web: await port(), hmr: await port() };
const origin = `http://127.0.0.1:${ports.api}`;
const webOrigin = `http://127.0.0.1:${ports.web}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=agentoverview`;
const children = [];
const password = randomBytes(32).toString('hex');
const username = `overview-${randomBytes(8).toString('hex')}`;
const env = {
	PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
	MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
	TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr)
};
let trapHits = 0;
const trap = createServer((req, res) => { trapHits++; res.writeHead(307, { Location: 'http://1.1.1.1:80/' }); res.end(); });
await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
const policy = join(dir, 'network.sb');
await writeFile(policy, `(version 1)(allow default)(deny network*)\n(allow network-bind (local unix-socket))\n(allow network-inbound ${Object.values(ports).map(p => `(local ip "localhost:${p}")`).join(' ')})\n(allow network-outbound ${[...Object.values(ports), trap.address().port].map(p => `(remote ip "localhost:${p}")`).join(' ')})`);
const serverOutput = [];
function start(executable, args, extra = {}) {
	const child = spawn('/usr/bin/sandbox-exec', ['-f', policy, executable, ...args], { cwd, detached: true, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
	let output = '';
	child.stdout.on('data', data => { output += data; if(args.includes('--browser')) process.stdout.write(data); });
	child.stderr.on('data', data => { output += data; });
	children.push(child);
	const running = { child, log: () => output };
	serverOutput.push(running);
	return running;
}
async function stop(running) {
	const signal = name => { try { process.kill(-running.child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
	const exit = running.child.exitCode !== null || running.child.signalCode !== null ? Promise.resolve() : once(running.child, 'exit');
	signal('SIGTERM');
	const forced = setTimeout(() => signal('SIGKILL'), 3000);
	await exit;
	clearTimeout(forced);
	signal('SIGKILL');
}
async function ready(running, url = origin) {
	for (let n = 0; n < 120; n++) {
		if (running.child.exitCode !== null) throw new Error(`Local server exited: ${running.log().slice(-1000)}`);
		try { if ((await fetch(`${url}/.well-known/thingtime-capabilities.json`, { redirect: 'error', signal: AbortSignal.timeout(700) })).ok) return; } catch {}
		await delay(200);
	}
	throw new Error(`Local server did not become ready: ${running.log().slice(-1000)}`);
}
function cookiePairs(response) {
	const lines = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
	return lines.map(line => line.split(';', 1)[0]).filter(pair => pair.includes('='));
}
let cookies = [];
async function api(path, { method = 'GET', body, jar = cookies, status = 200, operation = '' } = {}) {
	const response = await fetch(`${origin}${path}`, {
		method,
		headers: { Accept: 'application/json', Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar.length ? { Cookie: jar.join('; ') } : {}) },
		...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000)
	});
	const data = await response.json().catch(() => ({}));
	const apiError = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
	assert.equal(response.status, status, `${operation ? `${operation}: ` : ''}${method} ${path.split('?')[0]} returned ${response.status}${apiError ? `: ${apiError}` : ''}`);
	return { response, data };
}
async function createThing(kind, crystal, operation = kind) {
	const { data } = await api('/api/v1/things', { method: 'POST', operation: `create ${operation} Thing`, body: { thingtime: [kind], acl: ['tt:user'], crystal } });
	const id = data.thing?.id || data.id;
	assert.equal(typeof id, 'string', 'Thing create must return its id');
	return id;
}
const schemas = Object.fromEntries(Object.entries(authoredSchemas).map(([role, schema]) => [role, schema.crystal.name]));
const overviewQuery = (extra = {}) => new URLSearchParams({ ...Object.fromEntries(Object.entries(schemas).map(([role, value]) => [`${role}Schema`, value])), view: 'hierarchy', ...extra }).toString();
async function nextSse(reader, wanted, timeout = 16000) {
	const decoder = new TextDecoder();
	let buffer = '', event = 'message', data = [];
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const remaining = deadline - Date.now();
		let timer;
		const result = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for SSE ${wanted}`)), remaining); })]).finally(() => clearTimeout(timer));
		if (result.done) throw new Error('SSE stream closed before expected event');
		buffer += decoder.decode(result.value, { stream: true });
		let newline = buffer.indexOf('\n');
		while (newline >= 0) {
			const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
			if (!line) {
				if (event === wanted) return JSON.parse(data.join('\n'));
				event = 'message'; data = [];
			} else if (!line.startsWith(':')) {
				const colon = line.indexOf(':'); const key = colon < 0 ? line : line.slice(0, colon); const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
				if (key === 'event') event = value;
				if (key === 'data') data.push(value);
			}
			newline = buffer.indexOf('\n');
		}
	}
	throw new Error(`Timed out waiting for SSE ${wanted}`);
}
async function openOverviewStream() {
	const response = await fetch(`${origin}/api/v1/agent-overview?${overviewQuery()}&stream=1`, {
		headers: { Accept: 'text/event-stream', Cookie: cookies.join('; '), 'X-Thingtime-Expected-Data-Plane': 'home' },
		redirect: 'error', signal: AbortSignal.timeout(30000)
	});
	assert.equal(response.status, 200, `SSE open returned ${response.status}`);
	assert(response.headers.get('content-type')?.includes('text/event-stream'), 'SSE route must return event-stream, not a JSON snapshot');
	return response.body.getReader();
}

let mongoClient;
let apiServer;
try {
	assert.equal(process.platform, 'darwin', 'Requires macOS sandbox-exec; refusing an unrestricted fallback');
	await access(join(cwd, '.output/server/index.mjs'), constants.R_OK);
	const mongod = process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod';
	await access(mongod, constants.X_OK);
	await mkdir(evidence, { recursive: true });
	const trapPort = trap.address().port;
	const preflight = start(process.execPath, ['--input-type=module', '-e', `const blocked=async url=>{try{await fetch(url,{redirect:'error',signal:AbortSignal.timeout(2000)});throw Error('NETWORK_BOUNDARY_NOT_PROVEN')}catch(e){if(e.message==='NETWORK_BOUNDARY_NOT_PROVEN'||(e.cause?.code!=='EPERM'&&e.code!=='EPERM'))throw e}};await blocked('http://1.1.1.1:80/');const trap=await fetch('http://127.0.0.1:${trapPort}/redirect',{redirect:'manual',signal:AbortSignal.timeout(2000)});if(trap.status!==307||trap.headers.get('location')!=='http://1.1.1.1:80/')throw Error('REDIRECT_TRAP_NOT_REACHED');await blocked(trap.headers.get('location'))`]);
	const preflightExit = await once(preflight.child, 'exit');
	assert.equal(preflightExit[0], 0, preflight.log());
	assert.equal(trapHits, 1, 'Redirect trap must be reached only inside the fenced sandbox');

	await mkdir(join(dir, 'db'));
	const db = start(mongod, ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'agentoverview', '--nounixsocket']);
	mongoClient = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
	await waitFor(async () => { try { await mongoClient.connect(); return true; } catch { return false; } }, { timeout: 15000, interval: 300 });
	await mongoClient.db('admin').command({ replSetInitiate: { _id: 'agentoverview', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
	await waitFor(async () => (await mongoClient.db('admin').command({ hello: 1 })).isWritablePrimary, { timeout: 20000, interval: 250 });
	await mongoClient.close(); mongoClient = null;

	apiServer = start(process.execPath, ['.output/server/index.mjs']);
	await ready(apiServer);
	const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
	assert.equal(manifest.features?.['api.agent-overview']?.version, '2.0.0', 'Origin must advertise the current agent overview capability');
	const registered = await api('/api/v1/auth/register', { method: 'POST', body: { username, email: `${username}@example.invalid`, password, displayName: 'Disposable Overview Tester' }, status: 200 });
	cookies = cookiePairs(registered.response);
	assert(cookies.length, 'Disposable registration must return an authenticated session cookie');
	const publishedSchemaIds = {};
	for (const [role, schema] of Object.entries(authoredSchemas)) publishedSchemaIds[role] = await createThing('schema', schema.crystal, `schema definition ${role}`);
	for (const action of authoredThings.actions) await createThing('action', action.crystal, `Action definition ${action.key}`);
	for (const component of authoredThings.components || []) await createThing('component', component.crystal, `component definition ${component.key}`);
	const pages = authoredThings.pages?.length ? authoredThings.pages : authoredThings.page ? [authoredThings.page] : [];
	assert(pages.length, 'External authored Things fixture must include at least one saved webpage Thing');
	const publishedPages = [];
	for (const page of pages) {
		const id = await createThing('webpage', page.crystal, `webpage definition ${page.key}`);
		publishedPages.push({ id, key: page.key, pageKey: page.pageKey || page.crystal.pageKey, crystal: page.crystal });
	}
	const entryPage = publishedPages.find(page => page.key === 'tasks') || publishedPages[0];
	assert(entryPage.pageKey, 'Authored entry webpage must provide a pageKey');
	const dataThing = async (role, crystal) => createThing('data', { ...crystal, schema: schemas[role], schemaId: publishedSchemaIds[role] }, `test data schema ${role}`);
	const projectId = await dataThing('project', { recordType: 'agent-project', title: 'Acceptance Project', status: 'active', createdAt: new Date().toISOString() });
	const agentId = await dataThing('agent', { recordType: 'agent', title: 'Acceptance Agent', projectId, status: 'active', progress: 50, tokenUsage: 80, createdAt: new Date().toISOString() });
	const taskId = await dataThing('task', { recordType: 'agent-task', title: 'Acceptance Parent Task', description: 'Disposable API-created task', projectId, agentId, status: 'active', useCustomSecurity: false, network: { mode: 'isolated', rules: [] }, progress: 42, tokenUsage: 1234, startedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
	const childTaskId = await dataThing('task', { recordType: 'agent-task', title: 'Acceptance Child Task', description: 'Hierarchy child', parentId: taskId, projectId, agentId, status: 'todo', useCustomSecurity: false, network: { mode: 'isolated', rules: [] }, createdAt: new Date().toISOString() });
	const questionId = await dataThing('question', { parentId: taskId, body: 'Does the editable dashboard update live?', status: 'open', createdAt: new Date().toISOString() });
	const todoId = await dataThing('todo', { parentId: taskId, title: 'Verify rendered task card', done: false, createdAt: new Date().toISOString() });
	await dataThing('progress', { parentId: taskId, body: 'Initial acceptance progress report', createdAt: new Date().toISOString() });
	const readPath = `/api/v1/agent-overview?${overviewQuery()}`;
	const initial = (await api(readPath)).data.result;
	assert(initial.rows.some(row => row.id === taskId) && initial.rows.some(row => row.id === childTaskId), 'Snapshot includes parent and child tasks');
	assert(initial.projects.some(row => row.id === projectId) && initial.agents.some(row => row.id === agentId), 'Snapshot includes project and agent relationships');
	assert(initial.questions.some(row => row.id === questionId) && initial.todos.some(row => row.id === todoId), 'Snapshot includes questions and todos');
	assert.equal(initial.stats.tokenUsage, 1234, 'Snapshot reports measured token usage from stored Things');

	const liveReader = await openOverviewStream();
	const firstLive = await nextSse(liveReader, 'snapshot');
	assert(firstLive.rows.some(row => row.id === childTaskId), 'SSE begins with the current authorized snapshot');
	await api('/api/v1/things', { method: 'PATCH', body: { id: childTaskId, crystal: { status: 'blocked', progress: 67, tokenUsage: 333 } } });
	await dataThing('question', { parentId: taskId, body: 'Will a second question arrive without reload?', status: 'open', createdAt: new Date().toISOString() });
	const updatedLive = await nextSse(liveReader, 'snapshot');
	assert.equal(updatedLive.rows.find(row => row.id === childTaskId)?.status, 'blocked', 'SSE emits normal API edits without reloading');
	assert.equal(updatedLive.stats.tokenUsage, 1567, 'SSE updates measured aggregate from persisted values');
	await liveReader.cancel();
	const reconnectReader = await openOverviewStream();
	const reconnected = await nextSse(reconnectReader, 'snapshot');
	assert.equal(reconnected.rows.find(row => row.id === childTaskId)?.status, 'blocked', 'Reconnect reconciles current snapshot');
	await reconnectReader.cancel();

	const resolved = (await api(`/api/v1/webpages/resolve?id=${encodeURIComponent(entryPage.pageKey)}`)).data;
	assert.equal(resolved.source, 'user');
	const blocks = resolved.page.crystal.blocks;
	const findStaticText = rows => {
		for (const block of rows || []) {
			if (block.type === 'element' && typeof block.text === 'string' && block.text.trim() && !block.text.includes('{')) return block;
			const child = findStaticText(block.children);
			if (child) return child;
		}
		return null;
	};
	const editBlock = findStaticText(blocks);
    const flatBlocks=[]; const walk=rows=>{for(const b of rows||[]){flatBlocks.push(b);walk(b.children);}};walk(blocks);
    const editSamples = [
      ['Refresh','Refresh live'],
      ['⌄','▾'],
      ['{item.title}','{item.title} · editable']
    ].map(([text,changedText])=>{const b=flatBlocks.find(b=>b.type==='element'&&b.text===text&&(text!=='{item.title}'||b.tag==='strong'));assert(b,`Missing editable sample ${text}`);return {id:b.id,changedText};});
	assert(editBlock?.id && editBlock.text, 'Suite page must include a distinct editable text block');

	let browserChecked = false;
	const playwrightModule = process.env.PLAYWRIGHT_MODULE;
	const chromiumExecutable = process.env.CHROMIUM_EXECUTABLE;
	if (playwrightModule && chromiumExecutable) {
		const fixturePath = join(dir, 'browser-fixture.json');
		const browserCookies = cookies.map(pair => {
			const at = pair.indexOf('='); const name = pair.slice(0, at); const value = pair.slice(at + 1);
			return { name, value, url: webOrigin, httpOnly: true, secure: name.startsWith('__Host-'), sameSite: 'Lax' };
		});
		await writeFile(fixturePath, JSON.stringify({ webOrigin, entryPageKey: entryPage.pageKey, entryPageId: entryPage.id, taskTitle: 'Acceptance Parent Task', editBlockId: editBlock.id, editText: editBlock.text, editSamples, taskId, childTaskId, projectId, questionId, cookies: browserCookies, redirect: `http://127.0.0.1:${trap.address().port}/redirect` }), { mode: 0o600 });
		const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite';const server=await createServer({envDir:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`], { NODE_ENV: 'development' });
		await ready(vite, webOrigin);
		const ui = start(process.execPath, ['scripts/agent-overview-acceptance.mjs', '--browser', fixturePath], { PLAYWRIGHT_MODULE: playwrightModule, CHROMIUM_EXECUTABLE: chromiumExecutable, AGENT_OVERVIEW_EVIDENCE_DIR: evidence });
		const timeout = setTimeout(() => { try { process.kill(-ui.child.pid, 'SIGTERM'); } catch {} }, 180000);
		const [exitCode] = await once(ui.child, 'exit'); clearTimeout(timeout);
		assert.equal(exitCode, 0, `Isolated browser acceptance failed: ${ui.log().slice(-1200)}`);
		assert(trapHits > 1, 'Browser redirect trap must be reached before the redirected public request is denied');
		browserChecked = true;
		const saved = (await api(`/api/v1/things?id=${encodeURIComponent(entryPage.id)}`)).data;
		assert(JSON.stringify(saved.thing?.crystal?.blocks || []).includes(`${editBlock.text} · acceptance edit`), 'Builder edit must persist through the Things API');
        const savedBlocks=[];const collect=rows=>{for(const b of rows||[]){savedBlocks.push(b);collect(b.children);}};collect(saved.thing?.crystal?.blocks);
        for(const sample of editSamples)assert.equal(savedBlocks.find(b=>b.id===sample.id)?.text,sample.changedText,'Nested block edit persists individually');
	}

	const revokeReader = await openOverviewStream();
	await nextSse(revokeReader, 'snapshot');
	await api('/api/v1/auth/logout', { method: 'POST', body: { all: true } });
	const revoked = await nextSse(revokeReader, 'forbidden', 12000);
	assert.equal(revoked.ok, false, 'Revoked session receives no further private snapshot');
	await revokeReader.cancel();
	const anonymous = await fetch(`${origin}/api/v1/agent-overview?${overviewQuery()}&stream=1`, { redirect: 'error' });
	assert.equal(anonymous.status, 401, 'Anonymous callers cannot open private overview stream');
	const checks = ['OS network fence including redirected public requests', 'fresh replica set and secret', 'temporary account', `${authoredSchemas ? Object.keys(authoredSchemas).length : 0} authored schema Things, ${authoredThings.actions.length} authored Action Things, and ${pages.length} authored webpage Things published through the Things API`, 'normal Thing API hierarchy writes and measured fields', 'authorized JSON snapshot versus stored source', 'SSE initial snapshot, persisted update, reconnect and session revocation', ...(browserChecked ? ['isolated Chromium desktop/mobile rendering and Builder text edit readback'] : ['browser visual/editable acceptance skipped because Playwright/isolated Chromium paths were not both configured'])];
	console.log(JSON.stringify({ ok: true, productionAccess: false, browserChecked, evidence, checks }));
} catch (error) {
	console.error(error?.message || String(error));
	for (const running of serverOutput) if (running.child.exitCode === null) await writeFile(join(evidence, 'server-failure.log'), running.log().slice(-12000), { mode: 0o600 }).catch(() => {});
	process.exitCode = 1;
} finally {
	if (mongoClient) await mongoClient.close().catch(() => {});
	for (const child of children.reverse()) await stop({ child });
	await new Promise(resolve => trap.close(resolve));
	await rm(dir, { recursive: true, force: true });
}
