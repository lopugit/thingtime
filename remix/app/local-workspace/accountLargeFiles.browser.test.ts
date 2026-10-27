import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import net from 'node:net';

const base = process.env.TT_ACCOUNT_LARGE_FILES_URL, artifacts = process.env.TT_ACCOUNT_LARGE_FILES_ARTIFACTS,
 adminFile = process.env.TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const digestFile = async (path: string) => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };

test('large account files complete locally, download without paired-device capabilities and retain exact offline bytes',
 { skip: !base || !artifacts || !adminFile || !playwrightPath, timeout: 240_000 }, async t => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION);
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
 for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
  const code = await new Promise(resolve => { const socket = net.connect({ host, port: 443 }); socket.setTimeout(1500); socket.on('error', (error: any) => resolve(error.code)); socket.on('timeout', () => { socket.destroy(); resolve('timeout'); }); socket.on('connect', () => { socket.destroy(); resolve('CONNECTED'); }); });
  assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)), `Direct egress must fail closed: ${code}`);
 }
 await mkdir(artifacts!, { recursive: true });
 const scratch = await mkdtemp(resolve(process.env.TT_LOCAL_BLOBS_SCRATCH || tmpdir(), 'tt-account-large-'));
 t.after(() => rm(scratch, { recursive: true, force: true }));
 const source = resolve(scratch, 'account-large.bin'), output = createWriteStream(source), block = Buffer.alloc(1024 * 1024, 73);
 for (let i = 0; i < 70; i++) if (!output.write(block)) await once(output, 'drain');
 output.end(); await once(output, 'finish');
 const expectedHash = await digestFile(source);
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true, downloadsPath: resolve(scratch, 'downloads') });
 t.after(() => browser.close());
 const admin = await browser.newContext(), guest = await browser.newContext();
 const headers = { Origin: base! }, url = (path: string) => new URL(path, base).href;
 const administrator = JSON.parse(await readFile(adminFile!, 'utf8'));
 // Chromium honors Secure cookies on the loopback test origin. Keep the
 // production cookie policy intact and exercise authenticated browser fetches.
 const adminPage = await admin.newPage(); await adminPage.goto(url('/.well-known/thingtime-capabilities.json'));
 assert.equal(await adminPage.evaluate(async credentials => (await fetch('/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })).status, administrator), 200);
 let context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
 const username = 'large-file-' + randomUUID().slice(0, 8), password = randomUUID() + randomUUID();
 const registered = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password } });
 assert.equal(registered.status(), 200); const owner = (await registered.json()).user.id;
 assert.equal(await adminPage.evaluate(async userId => (await fetch('/api/v1/admin/users/public-uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, enabled: true, scope: 'private' }) })).status, owner), 200);
 let page: any, offline = false, remoteId = '', wholeFileReads = 0;
 const errors: string[] = [], requests: Array<{ path: string; method: string; offline: boolean }> = [], retentionReads: string[] = [];
 const prepare = async () => {
  await context.addInitScript(() => { const original = Blob.prototype.arrayBuffer; (window as any).__wholeFileReads = 0; Blob.prototype.arrayBuffer = function () { if (this.size > 1024 * 1024) { (window as any).__wholeFileReads++; throw Error('Unexpected whole-file read'); } return original.call(this); }; });
  page = await context.newPage(); page.setDefaultTimeout(25_000);
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('request', (request: any) => { const parsed = new URL(request.url()); requests.push({ path: parsed.pathname, method: request.method(), offline }); if (parsed.pathname === '/api/v1/attachments/content' && parsed.searchParams.get('cache') === 'retain-bytes') retentionReads.push(parsed.searchParams.get('id')!); });
  page.on('response', async (response: any) => { if (new URL(response.url()).pathname === '/api/v1/attachments/uploads/complete' && response.status() === 200) { try { remoteId = (await response.json()).attachment.id; } catch {} } });
  const network = await context.newCDPSession(page); await network.send('Network.enable');
  const connectivity = async (value: boolean) => { offline = value; await context.setOffline(value); await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
  await connectivity(false); return connectivity;
 };
 let connectivity = await prepare();
 const shell = () => page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const name of await caches.keys()) if (name.startsWith('thingtime:offline-shell:') && await (await caches.open(name)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
 const navigate = (path: string) => page.evaluate((path: string) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
 const download = async () => { const waiting = page.waitForEvent('download'); await page.getByTestId('filesystem-browser').getByText('account-large.bin', { exact: true }).first().dblclick(); const file = await waiting; assert.equal(await digestFile((await file.path())!), expectedHash); };
 try {
  await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
  await page.goto(url('/things?files=thingtime')); await shell();
  const files = page.getByTestId('filesystem-browser'); await files.getByRole('button', { name: 'Add files', exact: true }).waitFor();
  await connectivity(true); assert.equal(await page.evaluate(() => navigator.onLine), false);
  await files.locator('input[type=file]').setInputFiles(source);
  await files.getByText('account-large.bin', { exact: true }).first().waitFor();
  await page.reload(); await files.getByText('account-large.bin', { exact: true }).first().waitFor(); await download();
  assert.deepEqual(requests.filter(row => row.offline && !['GET', 'HEAD', 'OPTIONS'].includes(row.method)), []);
  assert.equal(remoteId, '', 'Local completion does not require account upload');
  wholeFileReads += await page.evaluate(() => (window as any).__wholeFileReads);
  const uploaded = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/attachments/uploads/complete', { timeout: 90_000 });
  await connectivity(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
  const completed = await uploaded, completion = await completed.json();
  assert.equal(completed.status(), 200, completion.error || 'The private upload must complete');
  remoteId = completion.attachment.id;
  await page.getByRole('region', { name: 'Account file sync', exact: true }).waitFor({ state: 'hidden', timeout: 90_000 });
  assert.ok(remoteId, 'The real account worker completes the private upload');
  const remote = await page.evaluate(async id => { const response = await fetch('/api/v1/things?id=' + id); return { status: response.status, body: await response.json() }; }, remoteId); assert.equal(remote.status, 200);
  const row = remote.body.thing; assert.equal(row.author.id, owner); assert.equal(row.crystal.size, 70 * 1024 * 1024);
  assert.equal((await guest.request.get(url('/api/v1/attachments/content?id=' + remoteId + '&download=1'))).status(), 404);
  assert.equal(await adminPage.evaluate(async id => (await fetch('/api/v1/attachments/content?id=' + id + '&cache=retain&download=1')).status, remoteId), 404);
  // Fresh browser storage proves the account-only download path, without a
  // local upload alias or a paired-device capability being available.
  await context.close(); context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  assert.equal((await context.request.post(url('/api/v1/login'), { headers, data: { username, password } })).status(), 200);
  await context.route('**/.well-known/thingtime-capabilities.json', async (route: any) => {
   const response = await route.fetch(), manifest = await response.json();
   assert.ok(Object.keys(manifest.features).some(key => key.startsWith('api.devices')), 'The fixture removes an advertised device contract');
   for (const key of Object.keys(manifest.features)) if (key.startsWith('api.devices')) delete manifest.features[key];
   await route.fulfill({ response, json: manifest });
  });
  connectivity = await prepare();
  await page.goto(url('/things?files=thingtime')); await page.getByTestId('filesystem-browser').getByText('account-large.bin', { exact: true }).first().waitFor(); await shell();
  await download();
  // The normal Thing inspector invokes the existing owned-original retainer.
  await navigate('/things'); await page.getByRole('link', { name: 'account-large.bin', exact: true }).click();
  await page.getByRole('button', { name: 'Edit file details', exact: true }).waitFor({ timeout: 90_000 });
  assert.ok(retentionReads.includes(remoteId), 'Real versioned original bytes were retained');
  await connectivity(true); await page.reload(); await page.getByRole('button', { name: 'Edit file details', exact: true }).waitFor();
  await navigate('/things?files=thingtime'); await page.getByTestId('filesystem-browser').getByText('account-large.bin', { exact: true }).first().waitFor(); await download();
  const bounds = [];
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await page.evaluate(async () => { for (let y = 0; y <= document.documentElement.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise(requestAnimationFrame); } scrollTo(0, 0); });
   const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth); assert.equal(scrollWidth, width); bounds.push({ width, scrollWidth });
   await page.screenshot({ path: resolve(artifacts!, `account-files-${width}.png`), animations: 'disabled' });
  }
  wholeFileReads += await page.evaluate(() => (window as any).__wholeFileReads); assert.equal(wholeFileReads, 0); assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter(row => row.offline && !['GET', 'HEAD', 'OPTIONS'].includes(row.method)), []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ bytes: 70 * 1024 * 1024, sha256: expectedHash, localCompletionBeforeUpload: true, coldOfflineDownload: true, realPrivateUpload: true, cleanContextDownload: true, noPairedDeviceCapabilities: true, retainedOriginal: true, retainedOfflineDownload: true, guestRefused: true, foreignOwnerRefused: true, wholeFileReads, bounds, errors }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), remoteId, errors, requests, retentionReads }, null, 2));
  throw error;
 }
});
