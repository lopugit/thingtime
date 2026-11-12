import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';

const base = process.env.TT_LOCAL_MAIL_SETTINGS_URL, artifacts = process.env.TT_LOCAL_MAIL_SETTINGS_ARTIFACTS;
test('native account mail settings persist offline and reconcile real private API receipts independently',
 { skip: !base || !artifacts || !process.env.TT_SHARED_PLAYWRIGHT_PATH, timeout: 420_000 }, async t => {
  assert.equal(new URL(base!).hostname, '127.0.0.1');
  const health = await (await fetch(base + '/api/v1/health/nitro')).json();
  assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
  assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
  for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
   const code = await new Promise(resolve => {
    const socket = net.connect({ host, port: 443 });
    socket.once('error', (error: any) => resolve(error.code));
    socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
    socket.setTimeout(1500, () => { socket.destroy(); resolve('TIMEOUT'); });
   });
   assert.ok(['EPERM', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)));
  }
  await mkdir(artifacts!, { recursive: true });
  const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
  const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
  let release = () => {};
  t.after(async () => { release(); await browser.close(); });
  t.signal.addEventListener('abort', () => { release(); void browser.close(); }, { once: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const other = await browser.newContext(), remote = await other.newPage();
  const errors: string[] = [], offlineWrites: string[] = [], providerActions: string[] = [];
  const attempts: Array<{ body: any; status: number }> = [], checks: string[] = [];
  let offline = false, ownerId = '', firstAccepted = false, held = true;
  const heldReply = new Promise<void>(resolve => { release = resolve; });
  page.on('pageerror', (error: Error) => errors.push(error.message));
  context.on('request', (request: any) => {
   const url = new URL(request.url());
   if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(url.pathname);
   if (url.port === '17879' || url.pathname === '/api/v1/mail/sync') providerActions.push(url.pathname);
  });
  await context.route('**/api/v1/mail?**', async (route: any) => {
   const request = route.request();
   if (request.method() !== 'POST') return route.continue();
   const body = request.postDataJSON();
   if (body.operation !== 'save-account') { providerActions.push(String(body.operation)); return route.continue(); }
   const response = await route.fetch();
   attempts.push({ body, status: response.status() });
   if (held && response.status() === 200) {
    held = false; firstAccepted = true;
    await heldReply;
    return route.abort('failed');
   }
   return route.fulfill({ response });
  });
  const network = await context.newCDPSession(page); await network.send('Network.enable');
  const connectivity = async (value: boolean) => {
   offline = value; await context.setOffline(value);
   await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  };
  const eventually = async (check: () => Promise<boolean>, message: string, timeout = 150_000) => {
   const deadline = Date.now() + timeout;
   while (!(await check())) { assert.ok(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 2000)); }
  };
  const api = (tab: any, body?: any) => tab.evaluate(async ({ ownerId, body }: any) => {
   const response = await fetch('/api/v1/mail?' + new URLSearchParams({ expectedOwnerId: ownerId, kind: 'mail-account' }),
    body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedOwnerId: ownerId }) } : {});
   return { status: response.status, body: await response.json() };
  }, { ownerId, body });
  const expand = async () => {
   const summary = page.locator('summary').filter({ has: page.getByText('Email accounts', { exact: true }) }).first();
   await summary.waitFor();
   if (!(await summary.evaluate((node: HTMLElement) => (node.parentElement as HTMLDetailsElement).open))) await summary.click();
   await page.getByRole('button', { name: 'Add email account', exact: true }).waitFor();
  };
  const edit = async (name: string) => {
   await page.getByRole('button', { name: 'Edit', exact: true }).click();
   await page.getByLabel('Account name', { exact: false }).fill(name);
   await page.getByRole('button', { name: 'Save account', exact: true }).click();
   await page.locator('form').waitFor({ state: 'hidden' });
   await page.getByText(name, { exact: true }).waitFor();
  };
  const snapshot = async (label: string) => {
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Edit', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(artifacts!, `${label}-${width}.png`), animations: 'disabled' });
   }
  };
  try {
   const username = 'mail-settings-' + randomUUID().slice(0, 8), password = randomUUID() + randomUUID();
   const registration = await context.request.post(base + '/api/v1/auth/register', { headers: { Origin: base! }, data: { username, password, email: username + '@example.test' } });
   assert.equal(registration.status(), 200); ownerId = (await registration.json()).user.id;
   await remote.goto(base + '/login');
   assert.equal(await remote.evaluate(async ({ username, password }: any) => (await fetch('/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).status, { username, password }), 200);
   const empty = await api(remote); assert.equal(empty.status, 200); assert.equal(empty.body.configured, true, 'Start with a fresh generated fixture vault key.');
   await page.goto(base + '/settings/email'); await expand();
   await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) return false;
    for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
    return false;
   });
   await connectivity(true);
   await page.getByRole('button', { name: 'Add email account', exact: true }).click();
   await page.getByLabel('Account name', { exact: false }).fill('Offline mail settings');
   await page.getByLabel('Email address', { exact: false }).fill('fixture@example.invalid');
   await page.getByLabel('Server hostname', { exact: false }).fill('imap.example.invalid');
   await page.getByLabel('Username', { exact: false }).fill('fixture@example.invalid');
   await page.getByLabel('App password', { exact: true }).fill('Synthetic-provider-password-never-used');
   // Chakra's visible label owns the interaction; its visually hidden native
   // input is covered by the custom checkbox control.
   await page.getByText('Through Thingtime’s cloud', { exact: true }).click();
   assert.equal(await page.getByRole('checkbox', { name: 'Through Thingtime’s cloud', exact: true }).isChecked(), true);
   await page.getByText('Keep a copy on this device', { exact: true }).click();
   assert.equal(await page.getByRole('checkbox', { name: 'Keep a copy on this device', exact: true }).isChecked(), false);
   await page.getByRole('button', { name: 'Save account', exact: true }).click();
   await page.locator('form').waitFor({ state: 'hidden' });
   await page.getByText('Offline mail settings', { exact: true }).waitFor();
   await page.reload(); await expand(); await page.getByText('Offline mail settings', { exact: true }).waitFor();
   assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-mail-proof', { cache: 'no-store' }); return false; } catch { return true; } }), true);
   assert.deepEqual(offlineWrites, []); assert.equal(attempts.length, 0);
   checks.push('normal signed-in UI save and cold reload while offline, with zero account writes');
   await connectivity(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
   await eventually(async () => firstAccepted, 'The real API must accept the first settings save.');
   await edit('Newer device mail settings');
   await page.getByText('Your mail settings are saved on this device. Account sync runs separately.', { exact: true }).waitFor();
   release();
   const firstRemote = await api(remote); assert.equal(firstRemote.body.records[0].name, 'Offline mail settings');
   await connectivity(true); await page.reload(); await expand();
   await page.getByText('Newer device mail settings', { exact: true }).waitFor();
   await snapshot('offline-newer-settings');
   await connectivity(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
   await eventually(async () => (await api(remote)).body.records?.[0]?.name === 'Newer device mail settings', 'Durable uncertain attempt and newer intent must both reconcile.');
   assert.ok(attempts.length >= 3);
   assert.deepEqual(attempts[0].body, attempts[1].body, 'Lost-reply retry must preserve exact write ID and body.');
   const saved = (await api(remote)).body.records[0]; assert.equal(saved.revision, 2);
   assert.ok(!JSON.stringify(saved).includes('Synthetic-provider-password-never-used'));
   checks.push('newer local save while real reply is held; offline reload; exact retry receipt and independent newer intent produce two server revisions');
   await connectivity(true); await edit('Device conflict kept');
   const changed = await api(remote, { operation: 'save-account', account: { ...saved, name: 'Account conflict winner' }, writeId: randomUUID() });
   assert.equal(changed.status, 200); assert.equal(changed.body.account.revision, 3);
   await connectivity(false); await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
   await page.getByRole('button', { name: 'Review account settings', exact: true }).waitFor({ timeout: 100_000 });
   await page.getByRole('button', { name: 'Review account settings', exact: true }).click();
   await page.getByRole('button', { name: 'Keep device changes', exact: true }).click();
   await page.getByText('Device conflict kept', { exact: true }).waitFor();
   assert.equal((await api(remote)).body.records[0].name, 'Account conflict winner');
   await page.getByRole('button', { name: 'Review account settings', exact: true }).click();
   await page.getByRole('button', { name: 'Use account settings', exact: true }).click();
   await page.getByText('Account conflict winner', { exact: true }).waitFor();
   await page.getByRole('button', { name: 'Review account settings', exact: true }).waitFor({ state: 'hidden' });
   await page.reload(); await expand(); await page.getByText('Account conflict winner', { exact: true }).waitFor();
   await snapshot('resolved-settings');
   const guest = await browser.newContext(), guestPage = await guest.newPage(); await guestPage.goto(base + '/login');
   assert.equal((await api(guestPage)).status, 401);
   assert.equal((await api(guestPage, { operation: 'save-account', account: saved, writeId: randomUUID() })).status, 401);
   await guest.close();
   checks.push('real stale-revision refusal, explicit keep and use-account choices, cold reload and guest read/write refusal');
   assert.deepEqual(errors, []); assert.deepEqual(providerActions, []); assert.deepEqual(offlineWrites, []);
   await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks, errors, providerActions, offlineWrites,
    attempts: attempts.map(({ body, status }) => ({ status, operation: body.operation, writeId: body.writeId, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') })),
    savedRevisions: [1, 2, 3], finalRecord: (await api(remote)).body.records[0], providerDeliveryTested: false }, null, 2));
  } catch (error) {
   release();
   await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }).catch(() => {});
   await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: String(error), errors, offlineWrites, providerActions, statuses: attempts.map(row => row.status), text: (await page.locator('body').innerText().catch(() => '')).slice(-14000) }, null, 2));
   throw error;
  }
 });
