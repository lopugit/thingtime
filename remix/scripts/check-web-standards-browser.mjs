/** Actual browser/API acceptance. Use a disposable local database; no production sessions.
 * TT_STANDARDS_TEST_URL=http://127.0.0.1:18730 TT_STANDARDS_TEST_DATABASE_HOST=127.0.0.1:18733
 * TT_PLAYWRIGHT_MODULE=/tmp/tt-standards-tools/node_modules/playwright/index.mjs node remix/scripts/check-web-standards-browser.mjs
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformRuntimeCsp } from './csp.mjs';
const origin = process.env.TT_STANDARDS_TEST_URL;
assert.ok(origin && ['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Explicit local test URL required');
const ids = new Set();
let cookie = '';
const request = async (path, body, method = body ? 'POST' : 'GET') => {
 const r = await fetch(new URL(path, origin), { method, signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
 const data = await r.json();
 assert.ok(r.ok, `${path}: ${r.status}`);
 return { r, data };
};
const health = (await request('/api/v1/health/mongodb')).data;
assert.equal(health.host, process.env.TT_STANDARDS_TEST_DATABASE_HOST, 'Explicit disposable database host must match');
if (process.env.TT_STANDARDS_TEST_SESSION_FILE) {
 const existing = JSON.parse(await readFile(process.env.TT_STANDARDS_TEST_SESSION_FILE, 'utf8'));
 assert.equal(existing.origin, origin, 'Test session belongs to this local stack');
 cookie = existing.cookie;
} else {
 const session = await request('/api/v1/auth/temporary', {});
 cookie = session.r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
}
assert.ok(cookie);
let browser, page;
const errors = [], failedRequests = [], responseErrors = [];
try {
 const installed = (await request('/api/v1/webpages/suites/install', { key: 'web-standards', onlyMissing: true })).data;
 if (installed.created === 7) for (const group of ['componentIds', 'actionIds', 'pageIds']) for (const id of Object.values(installed[group])) ids.add(id);
 const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
 browser = await chromium.launch({ channel: 'chrome', headless: process.env.CI === 'true' });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 await context.route('**/api/**', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
 await context.addCookies(cookie.split('; ').map(v => ({ name: v.slice(0, v.indexOf('=')), value: v.slice(v.indexOf('=') + 1), url: origin })));
 page = await context.newPage();
 page.setDefaultTimeout(120000);
 // Exercise the production client while keeping real API calls on the managed
 // local stack. Only public build files are intercepted; no extra app server.
 if (process.env.TT_STANDARDS_TEST_BUILT_CLIENT === '1') {
  const staticRoot = fileURLToPath(new URL('../.vercel/output/static/', import.meta.url));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  await page.route(origin + '/**', async route => {
   const path = decodeURIComponent(new URL(route.request().url()).pathname);
   if (route.request().method() !== 'GET' || path.startsWith('/api/')) return route.continue();
   const file = resolve(staticRoot, '.' + (!extname(path) ? '/index.html' : path));
   if (!file.startsWith(staticRoot.replace(/\/$/, '') + sep)) return route.abort();
   let body;
   try { body = await readFile(file); } catch { return route.continue(); }
   const headers = { 'cache-control': 'no-store' };
   if (path === '/platform/runtime.html') headers['content-security-policy'] = platformRuntimeCsp;
   return route.fulfill({ body, contentType: types[extname(file)] || 'application/octet-stream', headers });
  });
 }
 page.on('pageerror', e => errors.push(e.message));
 page.on('requestfailed', request => failedRequests.push(new URL(request.url()).pathname));
 page.on('response', response => { if (response.status() >= 400) responseErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
 const inventory = JSON.parse(await readFile(new URL('../app/webPlatform/generated/inventory.json', import.meta.url), 'utf8')).features;
 await page.goto(origin + '/p/web-standards', { waitUntil: 'domcontentloaded' });
 try { await page.getByText(/^\d+ entries$/, { exact: true }).waitFor(); }
 catch (error) { console.error('Initial catalogue failed:', { errors, failedRequests, text: (await page.locator('body').innerText()).slice(0, 2000) }); throw error; }
 await page.getByLabel('Search features', { exact: true }).fill('dialog');
 await page.locator('select[name=language]').selectOption('html');
 await page.getByRole('button', { name: 'Explore', exact: true }).click();
 await page.waitForURL('**q=dialog&language=html&coverage=');
 await page.getByText(/^\d+ entries$/, { exact: true }).waitFor();
 await page.locator('a[href*="feature=html-element-dialog"]').first().waitFor();
 assert.equal(await page.locator('select[name=language]').inputValue(), 'html');
 await page.reload({ waitUntil: 'domcontentloaded' });
 await page.locator('a[href*="feature=html-element-dialog"]').first().waitFor();
 assert.equal(await page.locator('select[name=language]').inputValue(), 'html', 'the asynchronous catalogue result restores the URL filter');
 assert.equal(await page.getByLabel('Search features', { exact: true }).inputValue(), 'dialog');
 await page.getByRole('button', { name: 'Explore', exact: true }).click();
 assert.equal(new URL(page.url()).searchParams.get('language'), 'html', 'a second search retains the selected language');
 const runButton = page.getByRole('button', { name: 'Run example', exact: true });
 const result = page.getByLabel('Execution result', { exact: true });
 const select = async (language, name) => {
  const f = inventory.find(f => f.language === language && f.name === name);
  assert.ok(f, name);
  await page.goto(origin + '/p/web-standards?feature=' + f.id, { waitUntil: 'domcontentloaded' });
  await runButton.click(); await result.waitFor();
 };
 await select('html', 'dialog');
 const frame = page.frameLocator('iframe[title="dialog interactive preview"]');
 await frame.getByRole('button', { name: 'Open dialog', exact: true }).click();
 assert.equal(await frame.locator('dialog').evaluate(n => n.open), true);
 await frame.getByRole('button', { name: 'Close', exact: true }).click();
 assert.equal(await frame.locator('dialog').evaluate(n => n.open), false);
 await select('css', 'display'); assert.match(await result.innerText(), /"computed": "grid"/);
 await select('javascript', 'Array.prototype.at ( index )'); assert.equal(await result.innerText(), '1');
 await page.getByLabel('Arguments (JSON array)', { exact: true }).fill('[2]');
 await runButton.click(); await result.filter({ hasText: /^4$/ }).waitFor();
 await page.getByText('Edit reusable program', { exact: true }).click();
 const draft = {
  version: 1, title: 'Saved edited draft', parameters: [
   {name:'amount',label:'Amount',type:'number',default:7},
   {name:'enabled',label:'Enabled',type:'boolean',default:true},
   {name:'text',label:'Text',type:'text',default:'before'},
   {name:'data',label:'Data',type:'json',default:[]}
  ], steps:[{op:'return',value:{op:'array',items:['amount','enabled','text','data'].map(name=>({op:'input',name}))}}]
 };
 const editor = page.getByLabel('Web Platform program', {exact:true});
 await editor.fill(JSON.stringify(draft));
 await page.getByLabel('Amount',{exact:true}).fill('0');
 await page.getByLabel('Enabled',{exact:true}).uncheck();
 await page.getByLabel('Text',{exact:true}).fill('');
 await page.getByLabel('Data',{exact:true}).fill('[[null,false],[0,"{name} $input.other"]]');
 await runButton.click();
 const expected = [0,false,'',[[null,false],[0,'{name} $input.other']]];
 await result.filter({hasText:/\$input.other/}).waitFor();
 assert.deepEqual(JSON.parse(await result.innerText()),expected);
 let writes = 0;
 const countWrites = request => { if(new URL(request.url()).pathname === '/api/v1/things' && request.method() === 'POST') writes++; };
 page.on('request',countWrites);
 await editor.fill('{');
 await page.getByRole('button', {name:'Save edited component',exact:true}).click();
 await page.getByText('Check the form',{exact:true}).waitFor();
 assert.equal(writes,0,'invalid drafts make no save request');
 await editor.fill(JSON.stringify(draft));
 await page.getByRole('button', { name: 'Save edited component', exact: true }).click();
 const saved = page.getByRole('link', { name: 'Open saved Thing →', exact: true }); await saved.waitFor();
 const id = (await saved.getAttribute('href')).split('/').at(-1); ids.add(id);
 const read = (await request('/api/v1/things?id=' + id)).data;
 const savedProgram = {...draft,parameters:draft.parameters.map((p,i)=>({...p,default:expected[i]}))};
 assert.deepEqual(read.thing.crystal.render.props.program,savedProgram);
 assert.equal(writes,1,'one save creates one Component');
 page.off('request',countWrites);
 const denied = await fetch(origin+'/api/v1/things?id='+id);
 assert.equal(denied.status,404,'saved Component stays private');
 await page.setViewportSize({ width: 390, height: 844 });
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
 if (process.env.TT_STANDARDS_ARTIFACT_DIR) {
  const dir = process.env.TT_STANDARDS_ARTIFACT_DIR; await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'web-standards-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(dir, 'web-standards-desktop.png'), fullPage: true });
 }
 // Reopen the saved Component and reuse that exact Thing on a Builder page.
 await saved.click(); await runButton.click(); await result.filter({hasText:/\$input.other/}).waitFor();
 assert.deepEqual(JSON.parse(await result.innerText()),expected);
 await page.reload({waitUntil:'domcontentloaded'}); await runButton.click(); await result.filter({hasText:/\$input.other/}).waitFor();
 assert.deepEqual(JSON.parse(await result.innerText()),expected);
 const reused = (await request('/api/v1/things',{thingtime:['webpage'],acl:['tt:user'],crystal:{
  name:'Saved draft reuse fixture',blocks:[{id:'draft-component',type:'component',component:id}]
 }})).data.thing;
 ids.add(reused.id);
 await page.goto(origin+'/builder?page='+reused.id,{waitUntil:'domcontentloaded'});
 await page.getByRole('checkbox',{name:'View',exact:true}).check();
 await runButton.click(); await result.filter({hasText:/\$input.other/}).waitFor();
 assert.deepEqual(JSON.parse(await result.innerText()),expected);
 await page.goto(origin+'/p/'+reused.id,{waitUntil:'domcontentloaded'});
 await runButton.click(); await result.filter({hasText:/\$input.other/}).waitFor();
 assert.deepEqual(JSON.parse(await result.innerText()),expected);
 await page.getByText('Edit reusable program', { exact: true }).click();
 const run = async steps => {
  await page.getByLabel('Web Platform program', { exact: true }).fill(JSON.stringify({ version: 1, title: 'Sandbox check', steps }));
  await runButton.click(); await result.waitFor(); return result.innerText();
 };
 const start = Date.now();
 assert.match(await run([{ op: 'while', test: true, body: [] }]), /2-second execution limit/);
 // Include the iframe and worker startup bounds; workerLifecycle.test.ts pins
 // the execution-only deadline to two seconds independently of cold startup.
 assert.ok(Date.now() - start < 25000);
 assert.match(await run([{ op: 'return', value: { op: 'await', value: { op: 'call', target: { op: 'global', name: 'fetch' }, args: [origin + '/api/v1/health/mongodb'] } } }]), /Failed to fetch|fetch failed|Content Security Policy/);
 const runtime = page.frames().find(f => f.url().endsWith('/platform/runtime.html'));
 assert.equal(await runtime.evaluate(() => { try { void document.cookie; return false; } catch { return true; } }), true);
 assert.equal(await runtime.evaluate(() => { try { void parent.document; return false; } catch { return true; } }), true);
 await page.getByRole('button', { name: 'Stop / clear', exact: true }).click();
 assert.equal(await page.locator('iframe').count(), 0);
 const direct = await context.request.get(origin + '/platform/runtime.html');
 assert.match(direct.headers()['content-security-policy'], /sandbox allow-scripts/);
 assert.deepEqual(errors, []);
 console.log('Browser acceptance passed: navigation, edited private save, invalid draft refusal, exact defaults, reload, Builder reuse, mobile bounds, worker timeout, network/account isolation and Stop.');
} catch (error) {
 if (page) console.error('Browser acceptance failed:', { errors, failedRequests, responseErrors, text: (await page.locator('body').innerText().catch(() => '')).slice(0, 4000) });
 throw error;
} finally {
 await browser?.close();
 for (const id of ids) await request('/api/v1/things?id=' + id, undefined, 'DELETE');
}
