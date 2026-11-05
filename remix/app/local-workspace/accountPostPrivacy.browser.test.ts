import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = process.env.TT_FEED_ORIGIN, session = process.env.TT_FEED_SESSION, artifacts = process.env.TT_FEED_ARTIFACTS;
test('owner changes a public account post to private and edits it offline before reconnect', { skip: !origin || !session || !artifacts, timeout: 240_000 }, async () => {
 assert.equal(new URL(origin!).hostname, '127.0.0.1');
 const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
 const { chromium, request } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser = await chromium.launch({ executablePath: process.env.TT_FEED_CHROME, headless: true, chromiumSandbox: true, args: ['--no-proxy-server', '--disable-background-networking'] });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const reader = await browser.newContext(), readerPage = await reader.newPage(), guest = await browser.newContext();
 const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
 const connectivity = async (value: boolean) => { offline = value; await context.setOffline(value); await cdp.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
 const network: any[] = []; page.on('response', (r: any) => { const url = new URL(r.url()); if (url.pathname === '/api/root-data' || url.pathname.startsWith('/api/v1/things')) network.push({ path: url.pathname, status: r.status() }); });
 const errors: string[] = [], writes: string[] = [], bounds: any[] = []; let offline = false, id = '';
 page.setDefaultTimeout(25_000); page.on('pageerror', (e: Error) => errors.push(e.message));
 page.on('request', (r: any) => { if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(new URL(r.url()).pathname); });
 const headers = { Origin: origin! }, initial = 'Synthetic public privacy transition fixture.', edited = 'Private body edited offline and retained after a cold reload.';
 const api = async (target: any, pathname: string, body?: any) => target.evaluate(async ({ pathname, body }: any) => { const r = await fetch(pathname, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); return { status: r.status, value: await r.json() }; }, { pathname, body });
 await mkdir(artifacts!, { recursive: true });
 try {
  await connectivity(false); assert.equal(await page.evaluate(() => navigator.onLine), true);
  for (const [ctx, p] of [[context, page], [reader, readerPage]]) { const username = 'privacy-' + randomUUID(); const fixtureApi = await request.newContext({ baseURL: origin }); const r = await fixtureApi.post('/api/v1/auth/register', { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } }); assert.equal(r.status(), 200); const userId = (await r.json()).user.id; await ctx.addCookies((await fixtureApi.storageState()).cookies); await fixtureApi.dispose(); const link = await ctx.newCDPSession(p); await link.send('Network.enable'); await link.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); await p.goto(origin + '/things'); await p.waitForFunction(async (id: string) => (await (await fetch('/api/root-data')).json()).user?.id === id, userId); }
  assert.equal(await page.evaluate(() => navigator.onLine), true);
  const seeded = await api(page, '/api/v1/things', { thingtime: ['post'], crystal: { type: 'text', text: initial }, visibility: 'public' });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.value)); id = seeded.value.thing?.id || seeded.value.post?.id || seeded.value.id; assert.ok(id);
  assert.equal((await api(readerPage, '/api/v1/things?id=' + id)).status, 200);
  assert.equal((await guest.request.get(origin + '/api/v1/things?id=' + id)).status(), 200);
  await page.goto(origin + '/post/' + id); await page.getByText(initial, { exact: true }).waitFor();
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await connectivity(true); await page.reload(); await page.getByText(initial, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Post options', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /Share/ }).click();
  await page.getByRole('menuitemradio', { name: /Private/ }).click();
  await page.getByRole('button', { name: 'Post options', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^(?:✏️\s*)?Edit$/ }).click();
  const paragraph = page.locator('.ce-paragraph[contenteditable="true"]').first(); await paragraph.fill(edited);
  await page.getByRole('button', { name: 'Save ✨', exact: true }).click();
  // The editor itself contains the new text before its async save completes.
  // Wait for finishPost's normal composer close, not that draft text.
  await page.getByRole('button', { name: 'Save ✨', exact: true }).waitFor({ state: 'hidden' });
  await paragraph.waitFor({ state: 'hidden' });
  await page.getByText(edited, { exact: true }).waitFor();
  await page.reload(); await page.getByText(edited, { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); const geometry = await page.evaluate(async () => { const roots = [document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)]; for (const root of roots) { if (root.scrollHeight > 40000) throw Error('Recursive content'); for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal overflow'); } } return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth }; }); bounds.push(geometry); await page.screenshot({ path: resolve(artifacts!, `private-bottom-${width}.png`) }); await page.evaluate(() => { document.scrollingElement!.scrollTop = 0; for (const el of document.querySelectorAll<HTMLElement>('body *')) if (/auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = 0; }); await page.screenshot({ path: resolve(artifacts!, `private-top-${width}.png`) }); }
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.getByRole('button', { name: 'Post options', exact: true }).first().click(); await page.getByRole('menuitem', { name: /Share/ }).click(); const privateChoice = page.getByRole('menuitemradio', { name: /Private/ }); await privateChoice.waitFor(); assert.equal(await privateChoice.getAttribute('aria-checked'), 'true'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width); await page.screenshot({ path: resolve(artifacts!, `private-menu-${width}.png`) }); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }
  assert.deepEqual(writes, []); await connectivity(false); await page.reload();
  let canonical: any; await assert.doesNotReject(async () => { for (let n = 0; n < 40; n++) { canonical = await api(page, '/api/v1/things?id=' + id); if (canonical.value.thing?.crystal?.text === edited && JSON.stringify(canonical.value.thing?.acl) === JSON.stringify(['tt:user'])) return; await page.waitForTimeout(500); } throw Error('Canonical text/privacy failed to converge: ' + JSON.stringify(canonical)); });
  const readerDenied = await api(readerPage, '/api/v1/things?id=' + id), guestDenied = await guest.request.get(origin + '/api/v1/things?id=' + id);
  assert.ok([403, 404].includes(readerDenied.status)); assert.ok([403, 404].includes(guestDenied.status())); await page.reload(); await page.getByText(edited, { exact: true }).waitFor(); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ id, offlinePrivacyMenu: true, offlineBodyEdit: true, coldReload: true, canonicalText: canonical.value.thing.crystal.text, canonicalAcl: canonical.value.thing.acl, readerDenied: readerDenied.status, guestDenied: guestDenied.status(), offlineWrites: writes, bounds, errors }, null, 2));
 } catch (error) { await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: String(error), body: await page.locator('body').innerText(), id, errors, writes, network, online: await page.evaluate(() => navigator.onLine) }, null, 2)); throw error; }
 finally { await browser.close(); }
});
