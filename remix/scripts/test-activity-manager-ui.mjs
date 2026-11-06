import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
const root = resolve(import.meta.dirname, '..'),
	port = 28217,
	evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-activity-ui')),
	require = createRequire(join(root, '../MCP/package.json'));
if (!process.env.TT_ACTIVITY_UI_WORKER) {
	const dir = await mkdtemp(join(tmpdir(), 'thingtime-activity-ui-'));
	try {
		let source = await readFile(join(root, 'scripts/mobile-sync-editor.browser.tsx'), 'utf8');

		source = `import {ActivityManagerPage} from '../app/components/Activity/ActivityManagerPage';
import {activityInterval,clearActivityInterval,activityEvents} from '../app/activity/activityManager';\n${source}`;
		source = source
			.replace('element: <Fixture />', 'element: <ActivityFixture />')
			.replace(
				"if (desktop && (taskQA || homeQA) && url.pathname === '/api/v1/webpages/resolve') {",
				"if (url.pathname === '/api/v1/webpages/resolve') {"
			);
		source = source.replace(
			"headers.get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin ||",
			"(headers.has('X-Thingtime-Expected-Api-Origin') && ![canonicalOrigin,location.origin].includes(headers.get('X-Thingtime-Expected-Api-Origin') || '')) ||"
		);
		// Saved Builder layouts use the same-origin account adapter, without a desktop proxy header.
		// The fixture remains loopback-only and rejects any explicit mismatched destination.
		source = source.replace(
			"new Headers(init?.headers).get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin",
			"(new Headers(init?.headers).has('X-Thingtime-Expected-Api-Origin') && new Headers(init?.headers).get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin)"
		);
		source += `\nlet qaNativeEnabled=true;Object.assign(window.thingtimeDesktop,{activityVersion:'1.0.0',activityRequest:async input=>{if(input.version!=='1.0.0')throw Error('version');if(input.action==='list')window.__qaNativeReads=(window.__qaNativeReads||0)+1;if(input.action==='set-enabled')qaNativeEnabled=input.enabled;return {version:'1.0.0',collectedAt:new Date().toISOString(),activities:[{id:'qa.native',label:'QA native service',kind:'service',scope:'native-node',enabled:qaNativeEnabled,running:qaNativeEnabled,controllable:true,description:'Disposable native adapter fixture.'}],metrics:{scope:'electron-processes',processCount:3,cpuPercent:1.2,rssBytes:1048576},limitations:['Synthetic native adapter for UI acceptance only.']};}});\nconst qaFetch=window.fetch;window.fetch=async function(...args){const response=await qaFetch.apply(this,args);if(response.status>=400) console.error('QA request',new URL(String(args[0]),location.href).pathname,response.status);return response;};\nfunction ActivityFixture(){const [count,setCount]=React.useState(0),[events,setEvents]=React.useState(0);React.useEffect(()=>{const timer=activityInterval('qa.timer','QA recurring work',()=>setCount(value=>value+1),50);const listener=()=>setEvents(value=>value+1);activityEvents(window,'qa.events','QA listener').addEventListener('qa-event',listener);return()=>{clearActivityInterval(timer);activityEvents(window,'qa.events','QA listener').removeEventListener('qa-event',listener);};},[]);return <ChakraProvider><Button onClick={()=>window.dispatchEvent(new Event('qa-event'))}>Generate QA event</Button><Text data-testid="qa-counter">{count}</Text><Text data-testid="qa-events">{events}</Text><ActivityManagerPage/></ChakraProvider>;}\n`;
		await require('esbuild').build({
			stdin: { contents: source, loader: 'tsx', resolveDir: join(root, 'scripts') },
			bundle: true,
			format: 'esm',
			platform: 'browser',
			target: 'esnext',
			outfile: join(dir, 'fixture.js'),
			tsconfig: join(root, 'tsconfig.json'),
			define: { 'process.env.NODE_ENV': '"development"' },
			logLevel: 'error'
		});
		const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir, TT_ACTIVITY_UI_WORKER: dir };
		await verifyAccountBackupIsolation(port, env);
		const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename, evidence], { env, stdio: 'inherit' }, port, true),
			timer = setTimeout(() => child.kill('SIGTERM'), 180000);
		try {
			const [code] = await once(child, 'exit');
			assert.equal(code, 0);
		} finally {
			clearTimeout(timer);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
} else {
	const dir = process.env.TT_ACTIVITY_UI_WORKER,
		bundle = await readFile(join(dir, 'fixture.js'));
	const server = createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': req.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
		res.end(
			req.url === '/fixture.js'
				? bundle
				: '<!doctype html><title>[QA] Activity manager</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'
		);
	});
	server.listen(port, '127.0.0.1');
	await once(server, 'listening');
	let context;
	try {
		await mkdir(evidence, { recursive: true });
		context = await require('playwright').chromium.launchPersistentContext(join(dir, 'profile'), {
			headless: true,
			downloadsPath: join(dir, 'downloads'),
			acceptDownloads: false
		});
		const page = context.pages()[0],
			errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (message) => {
			if (message.type() === 'error') console.log(message.text());
		});
		const probe = await context.newPage();
		await assert.rejects(probe.goto('http://192.0.2.1:443/blocked', { timeout: 3000 }));
		await probe.close();
		for (const [label, width, height] of [
			['desktop', 1440, 1000],
			['mobile', 375, 812]
		]) {
			await page.setViewportSize({ width, height });
			await page.goto(`http://127.0.0.1:${port}/?platform=desktop&tasks=1`);
			await page.getByRole('heading', { name: 'Activity manager', exact: true }).waitFor();
			await page.getByText(/Electron: 3 processes/).waitFor();
			const readsBefore=await page.evaluate(()=>window.__qaNativeReads);
			await page.getByRole('button',{name:'Refresh native services',exact:true}).click();
			await page.waitForFunction(before=>window.__qaNativeReads>before,readsBefore);
			assert.equal(await page.getByText(/Could not load your layout/).count(), 0);
			const native = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'QA native service', exact: true }) });
			await native.getByRole('button', { name: 'Disable permanently', exact: true }).click();
			await native.getByText('Stopped', { exact: false }).waitFor();
			await native.getByRole('button', { name: 'Enable activity', exact: true }).click();
			await native.getByText('Running', { exact: false }).waitFor();
			await page.getByText('What these controls cover', { exact: true }).click();
			await page.getByText('What these controls cover', { exact: true }).click();
			const timer = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'QA recurring work', exact: true }) });
			if (await timer.getByRole('button', { name: 'Enable activity', exact: true }).count())
				await timer.getByRole('button', { name: 'Enable activity', exact: true }).click();
			await page.waitForFunction(() => Number(document.querySelector('[data-testid="qa-counter"]').textContent) > 0);
			await timer.getByRole('button', { name: 'Disable permanently', exact: true }).click();
			await timer.getByRole('button', { name: 'Enable activity', exact: true }).waitFor();
			const stopped = await page.getByTestId('qa-counter').textContent();
			await page.waitForTimeout(250);
			assert.equal(await page.getByTestId('qa-counter').textContent(), stopped);
			const listener = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'QA listener · qa-event', exact: true }) });
			if (await listener.getByRole('button', { name: 'Enable activity', exact: true }).count())
				await listener.getByRole('button', { name: 'Enable activity', exact: true }).click();
			await page.getByRole('button', { name: 'Generate QA event', exact: true }).click();
			assert.equal(await page.getByTestId('qa-events').textContent(), '1');
			await listener.getByRole('button', { name: 'Disable permanently', exact: true }).click();
			await page.getByRole('button', { name: 'Generate QA event', exact: true }).click();
			assert.equal(await page.getByTestId('qa-events').textContent(), '1');
			await page.reload();
			await timer.getByRole('button', { name: 'Enable activity', exact: true }).waitFor();
			assert.equal(await page.getByTestId('qa-counter').textContent(), '0');
			await page.getByRole('button', { name: 'Generate QA event', exact: true }).click();
			assert.equal(await page.getByTestId('qa-events').textContent(), '0');
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
			await page.screenshot({ path: join(evidence, `${label}-top.png`) });
			await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
			await page.screenshot({ path: join(evidence, `${label}-bottom.png`) });
		}
		await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await page.getByRole('heading', { name: 'Activity manager', exact: true }).click();
		await page.getByLabel('Block text', { exact: true }).fill('Activity manager · saved');
		await page.getByRole('button', { name: 'Close builder', exact: true }).click();
		await page.getByRole('heading', { name: '{item.title}', exact: true }).click();
		await page.getByLabel('Block text', { exact: true }).fill('{item.title} · activity');
		await page.getByRole('button', { name: 'Save layout', exact: true }).press('Enter');
		await page.screenshot({ path: join(evidence, 'builder-save-state.png') });
		await writeFile(join(evidence, 'builder-save-state.txt'), await page.locator('body').innerText());
		await page.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
		await page.screenshot({ path: join(evidence, 'builder-before-reload.png') });
		await page.reload();
		await page.getByRole('heading', { name: 'Activity manager · saved', exact: true }).waitFor();
		await page.getByRole('heading', { name: 'QA native service · activity', exact: true }).waitFor();
		assert.deepEqual(errors, []);
		await writeFile(
			join(evidence, 'results.json'),
			JSON.stringify({ isolation: true, timerStop: true, eventUnsubscribe: true, durableReload: true, desktop: true, mobile: true, builderHeadingAndRepeatedField: true, errors }, null, 2)
		);
		console.log('Activity manager isolated browser acceptance passed.');
	} finally {
		await context?.close();
		await new Promise((done) => server.close(done));
	}
}
