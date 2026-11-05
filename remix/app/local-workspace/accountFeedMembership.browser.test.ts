import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = process.env.TT_FEED_ORIGIN, session = process.env.TT_FEED_SESSION, artifacts = process.env.TT_FEED_ARTIFACTS;
test('normal account feed retains only visited remote pages as an explicit partial offline view', { skip: !origin || !session || !artifacts, timeout: 240_000 }, async () => {
 assert.equal(new URL(origin!).origin, origin); assert.equal(new URL(origin!).hostname, '127.0.0.1');
 const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
 const { default: puppeteer } = await import(process.env.TT_FEED_PUPPETEER!);
 const { request } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser = await puppeteer.launch({ executablePath: process.env.TT_FEED_CHROME, headless: true, pipe: true, args: ['--no-proxy-server', '--disable-background-networking'] });
 assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));
 const context = await browser.createBrowserContext(), page = await context.newPage(), api = await request.newContext({ baseURL: origin }), authorApi = await request.newContext({ baseURL: origin });
 page.setDefaultTimeout(25_000); const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
 let offline = false; const writes: any[] = [], feeds: any[] = [], errors: string[] = [], bounds: any[] = [], ids: string[] = [];
 const connectivity = async (value: boolean) => { offline = value; await page.setOfflineMode(value); await cdp.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
 page.on('pageerror', (e: Error) => errors.push(e.message));
 page.on('request', (r: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && offline) writes.push({ method: r.method(), path: new URL(r.url()).pathname }); });
 page.on('response', async (r: any) => { if (new URL(r.url()).pathname === '/api/v1/things/feed' && r.status() === 200) { const value = await r.json(); feeds.push({ cursor: new URL(r.url()).searchParams.get('cursor'), ids: value.posts?.map((p: any) => p.id), nextCursor: value.nextCursor }); } });
 await mkdir(artifacts!, { recursive: true });
 const visibleIds = () => page.evaluate(() => [...document.querySelectorAll('[data-thing-id]')].map(el => el.getAttribute('data-thing-id')));
 try {
  await connectivity(false);
  const username = 'feed-' + randomUUID(), headers = { Origin: origin! };
  const registered = await api.post('/api/v1/auth/register', { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registered.status(), 200); const ownerId = (await registered.json()).user.id;
  const state = await api.storageState(); await context.setCookie(...state.cookies);
  await page.goto(origin + '/things', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(async id => (await (await fetch('/api/root-data')).json()).user?.id === id, {}, ownerId);
  assert.equal(await page.evaluate(() => navigator.onLine), true);
  const identity = await page.evaluate(async () => { const r = await (await fetch('/api/root-data')).json(); return { ownerId: r.user.id, dataPlane: r.dataPlane, temporary: r.user.temporary }; });
  assert.equal(identity.ownerId, ownerId); assert.equal(identity.dataPlane, 'home'); assert.notEqual(identity.temporary, true);
  const authorName = 'feed-author-' + randomUUID();
  const authorRegistration = await authorApi.post('/api/v1/auth/register', { headers, data: { username: authorName, email: authorName + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(authorRegistration.status(), 200); const authorId = (await authorRegistration.json()).user.id; assert.notEqual(authorId, ownerId);
  const authorContext = await browser.createBrowserContext(), authorPage = await authorContext.newPage();
  await authorContext.setCookie(...(await authorApi.storageState()).cookies);
  await authorPage.goto(origin + '/things', { waitUntil: 'domcontentloaded' });
  await authorPage.waitForFunction(async id => (await (await fetch('/api/root-data')).json()).user?.id === id, {}, authorId);
  for (let n = 0; n < 25; n++) { const result = await authorPage.evaluate(async ({ n, username }) => { const r = await fetch('/api/v1/things', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thingtime: ['post'], crystal: { type: 'text', text: `Feed membership fixture ${n}: retained remote data with enough height to keep the next page unvisited.` }, acl: ['tt:custom', 'tt:user', `tt:user/${username}/comment`] }) }); return { status: r.status, body: await r.json() }; }, { n, username }); assert.equal(result.status, 200, JSON.stringify(result.body)); const body = result.body; ids.push(body.thing?.id || body.post?.id || body.id); assert.ok(ids.at(-1)); }
  await authorContext.close();

  await page.goto(origin + '/feed?sort=latest', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-thing-id]').length === 20);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; }, { timeout: 90_000 });
  const initial = await visibleIds(); assert.equal(new Set(initial).size, 20); assert.ok(initial.every(id => ids.includes(id!))); assert.ok(feeds.at(-1)?.nextCursor); assert.equal(feeds.some(f => f.cursor), false);
  const unvisited = ids.filter(id => !initial.includes(id)); assert.equal(unvisited.length, 5);
  await connectivity(true); assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="feed-device-coverage"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-thing-id]').length === 20);
  assert.deepEqual(new Set(await visibleIds()), new Set(initial)); assert.ok((await page.$eval('[data-testid="feed-device-coverage"]', el => el.textContent))?.includes('partial view'));
  for (const width of [1440, 390, 320]) {
   await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
   const geometry = await page.evaluate(async () => { const roots = [document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)]; for (const root of roots) { if (root.scrollHeight > 40000) throw Error('Unexpected repeated feed'); root.scrollTop = 0; for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal overflow'); } } return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, visibleControls: [...document.querySelectorAll('button')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight; }).length }; });
   assert.equal(geometry.width, geometry.scrollWidth); assert.ok(geometry.visibleControls > 0); bounds.push(geometry);
   assert.ok(unvisited.every(id => !(initial.includes(id)))); assert.deepEqual(new Set(await visibleIds()), new Set(initial));
   await page.screenshot({ path: resolve(artifacts!, `partial-feed-bottom-${width}.png`) });
   await page.evaluate(() => { document.scrollingElement!.scrollTop = 0; for (const el of document.querySelectorAll<HTMLElement>('body *')) if (/auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = 0; });
   await page.screenshot({ path: resolve(artifacts!, `partial-feed-${width}.png`) });
  }
  assert.deepEqual(writes, []);
  await page.evaluate(() => scrollTo(0, 0)); await connectivity(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('[data-testid="feed-device-coverage"]') && document.querySelectorAll('[data-thing-id]').length === 20);
  const loadMore = await page.waitForFunction(() => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Load more')));
  await loadMore.asElement()!.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => document.querySelectorAll('[data-thing-id]').length === 25);
  assert.deepEqual(new Set(await visibleIds()), new Set(ids)); assert.ok(feeds.some(f => f.cursor));
  // Clear the account through its real auth path; cached protected projections must disappear.
  assert.equal(await page.evaluate(async () => (await fetch('/api/v1/auth/logout', { method: 'POST' })).status), 200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('[data-thing-id]'));
  await connectivity(true); await page.reload({ waitUntil: 'domcontentloaded' });
  assert.deepEqual(await visibleIds(), []); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ identity, seeded: ids.length, firstPage: initial, unvisited, partialOfflineColdReload: true, offlineWrites: writes, reconnectAll25: true, logoutIsolation: true, bounds, feeds, errors }, null, 2));
 } catch (error) { await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: String(error), body: await page.$eval('body', el => el.innerText), ids, feeds, writes, errors }, null, 2)); throw error; }
 finally { await api.dispose(); await authorApi.dispose(); await browser.close(); }
});
