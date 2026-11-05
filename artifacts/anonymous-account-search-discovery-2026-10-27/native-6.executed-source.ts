import { observeSearchShell } from './accountSearchDiscovery.browser.fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = process.env.TT_SEARCH_ORIGIN, session = process.env.TT_SEARCH_SESSION, artifacts = process.env.TT_SEARCH_ARTIFACTS;
test('normal account Search retains scoped cached people, subspaces and Things with truthful offline coverage', { skip: !origin || !session || !artifacts, timeout: 240_000 }, async () => {
 assert.equal(new URL(origin!).origin, origin); assert.equal(new URL(origin!).hostname, '127.0.0.1');
 const health = await (await fetch(origin + '/api/v1/health/nitro', { redirect: 'error' })).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test'); assert.equal(health.testEnvironment.sessionId, session);
 const { default: puppeteer } = await import(process.env.TT_SEARCH_PUPPETEER!);
 const { request } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH!);
 const browser = await puppeteer.launch({ executablePath: process.env.TT_SEARCH_CHROME, headless: true, pipe: true, args: ['--no-proxy-server', '--disable-background-networking'] });
 assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));
 const shellTelemetry = observeSearchShell(browser);
 const context = await browser.createBrowserContext(), page = await context.newPage(), api = await request.newContext({ baseURL: origin });
 shellTelemetry.attachPage(page); page.setDefaultTimeout(25_000); const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
 let offline = false; const writes: any[] = [], errors: string[] = [], bounds: any[] = [], ids: string[] = [];
 const connectivity = async (value: boolean) => { offline = value; await page.setOfflineMode(value); await cdp.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
 page.on('pageerror', (e: Error) => errors.push(e.message));
 page.on('request', (r: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && offline) writes.push({ method: r.method(), path: new URL(r.url()).pathname }); });
 await mkdir(artifacts!, { recursive: true });
 try {
  await connectivity(false);
  const username = 'search_' + randomUUID().slice(0, 12).replaceAll('-', ''), headers = { Origin: origin! };
  const registered = await api.post('/api/v1/auth/register', { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registered.status(), 200); const ownerId = (await registered.json()).user.id;
  const state = await api.storageState(); await context.setCookie(...state.cookies);
  await page.goto(origin + '/things', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(async id => (await (await fetch('/api/root-data')).json()).user?.id === id, {}, ownerId);
  assert.equal(await page.evaluate(() => navigator.onLine), true);
  const identity = await page.evaluate(async () => { const r = await (await fetch('/api/root-data')).json(); return { ownerId: r.user.id, dataPlane: r.dataPlane, temporary: r.user.temporary }; });
  assert.equal(identity.ownerId, ownerId); assert.equal(identity.dataPlane, 'home'); assert.notEqual(identity.temporary, true);
  const needle = username;
  const fixtures = await page.evaluate(async ({ needle }) => {
   const create = async (path: string, body: any) => { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
   return { thing: await create('/api/v1/things', { thingtime: ['data'], crystal: { name: needle + ' private Thing' }, acl: ['tt:user'] }),
    subspace: await create('/api/v1/subspaces', { slug: needle, name: needle + ' discovery subspace', description: 'Synthetic isolated discovery fixture', access: 'public' }) };
  }, { needle });
  assert.equal(fixtures.thing.status, 200); assert.equal(fixtures.subspace.status, 201, JSON.stringify(fixtures.subspace.body));
  ids.push(fixtures.thing.body.thing?.id || fixtures.thing.body.id);
  const profile = `a[href="/profile/${username}"]`, subspace = `[data-testid="search-subspaces"] a[href="/s/${username}"]`;
  await page.goto(origin + '/search?source=online&q=' + encodeURIComponent(needle), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(profile); await page.waitForSelector(subspace);
  await page.waitForFunction(text => document.body.innerText.includes(text), {}, needle + ' private Thing');
  const online = await page.evaluate(async needle => {
   const paths = ['/api/v1/users/search?q=' + encodeURIComponent(needle), '/api/v1/subspaces?q=' + encodeURIComponent(needle)];
   return await Promise.all(paths.map(async path => { const r = await fetch(path); return { path, status: r.status, body: await r.json() }; }));
  }, needle);
  assert.ok(online.every(row => row.status === 200), JSON.stringify(online));
  await writeFile(resolve(artifacts!, 'online-checkpoint.json'), JSON.stringify({ identity, online, body: await page.$eval('body', el => el.innerText) }, null, 2));
  await writeFile(resolve(artifacts!, 'shell-before-wait.json'), JSON.stringify(await shellTelemetry.snapshot(page, 'before-normal-readiness-wait'), null, 2));
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; }, { timeout: 90_000 });
  await writeFile(resolve(artifacts!, 'shell-ready.json'), JSON.stringify(await shellTelemetry.snapshot(page, 'normal-readiness-passed'), null, 2));
  await connectivity(true); assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(profile); await page.waitForSelector(subspace);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].every(el => el.textContent?.trim() !== 'Searching…'));
  await writeFile(resolve(artifacts!, 'offline-checkpoint.json'), JSON.stringify({ body: await page.$eval('body', el => el.innerText), url: page.url() }, null, 2));
  const offlineState = await page.evaluate(({ needle, profile, subspace }) => ({ body: document.body.innerText, person: !!document.querySelector(profile), subspace: !!document.querySelector(subspace), thing: document.body.innerText.includes(needle + ' private Thing'), alerts: [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent), snapshotNotice: document.querySelector('[data-testid="search-snapshot-coverage"]')?.textContent ?? null }), { needle, profile, subspace });
  assert.ok(offlineState.person && offlineState.subspace && offlineState.thing);
  for (const width of [1440, 390, 320]) {
   await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
   const geometry = await page.evaluate(async () => { const roots = [document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')].filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)]; for (const root of roots) { if (root.scrollHeight > 40000) throw Error('Unexpected repeated search'); root.scrollTop = 0; for (let top = 0; top <= root.scrollHeight; top += Math.max(200, root.clientHeight / 2)) { root.scrollTop = top; await new Promise(requestAnimationFrame); if (document.documentElement.scrollWidth > innerWidth) throw Error('Horizontal overflow'); } } return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, visibleControls: [...document.querySelectorAll('button')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight; }).length }; });
   assert.equal(geometry.width, geometry.scrollWidth); assert.ok(geometry.visibleControls > 0);
   await page.$eval('[data-testid="search-snapshot-coverage"]', el => el.scrollIntoView({ block: 'center' }));
   const noticeGeometry = await page.$eval('[data-testid="search-snapshot-coverage"]', el => {
    const rgba = (value: string) => { const numbers = value.match(/[\d.]+/g)!.map(Number); return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1]; };
    const layers = []; let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) { const style = getComputedStyle(node); layers.push(rgba(style.backgroundColor)); opacity *= Number(style.opacity); }
    let background = [255, 255, 255]; for (const layer of layers.reverse()) background = background.map((channel, n) => layer[n] * layer[3] + channel * (1 - layer[3]));
    const style = getComputedStyle(el), foreground = rgba(style.color), alpha = foreground[3] * opacity;
    const text = background.map((channel, n) => foreground[n] * alpha + channel * (1 - alpha));
    const luminance = (color: number[]) => color.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, n) => sum + v * [0.2126, 0.7152, 0.0722][n], 0);
    const values = [luminance(text), luminance(background)].sort((a, b) => b - a);
    const range = document.createRange(); range.selectNodeContents(el);
    return { color: style.color, background, contrast: (values[0] + 0.05) / (values[1] + 0.05), lines: [...range.getClientRects()].map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })), width: innerWidth };
   });
   assert.ok(noticeGeometry.contrast >= 4.5, 'Snapshot notice meets normal-text contrast');
   assert.ok(noticeGeometry.lines.length > 0); assert.ok(noticeGeometry.lines.every(line => line.left >= -1 && line.right <= width + 1), 'Snapshot notice wraps within the viewport');
   bounds.push({ ...geometry, notice: noticeGeometry });
   await page.screenshot({ path: resolve(artifacts!, `search-notice-${width}.png`) });
   await page.screenshot({ path: resolve(artifacts!, `search-bottom-${width}.png`) });
   await page.evaluate(() => { document.scrollingElement!.scrollTop = 0; for (const el of document.querySelectorAll<HTMLElement>('body *')) if (/auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = 0; });
   await page.screenshot({ path: resolve(artifacts!, `search-${width}.png`) });
  }
  assert.deepEqual(writes, []);
  const input = await page.$('input[placeholder="Search every thing…"]'); assert.ok(input);
  await input.click({ clickCount: 3 }); await input.type('different failed search');
  const submit = await page.$('button[type="submit"]'); assert.ok(submit); await submit.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="search-snapshot-coverage"]')?.textContent?.includes('previous search'));
  const changedQueryNotice = await page.$eval('[data-testid="search-snapshot-coverage"]', el => el.textContent);
  assert.match(changedQueryNotice!, /may not match the current search/);
  assert.ok(await page.$(profile)); assert.ok(await page.$(subspace));
  assert.deepEqual(writes, []);
  await connectivity(false); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(profile); assert.equal(await page.evaluate(async () => (await fetch('/api/v1/auth/logout', { method: 'POST' })).status), 200);
  // A plain Search visit must not re-query public discovery while checking identity isolation.
  await page.goto(origin + '/search?source=online', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(text => !document.body.innerText.includes(text), {}, needle + ' private Thing');
  assert.equal(await page.$(profile), null); assert.equal(await page.$(subspace), null);
  await connectivity(true); await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.$(profile), null); assert.equal(await page.$(subspace), null);
  assert.deepEqual(errors, []);
  const searchNotice = offlineState.snapshotNotice ?? '';
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ identity, fixtures: { thingId: ids[0], subspaceId: fixtures.subspace.body.subspace.id }, online, cachedOfflineSections: true, offlineState, offlineWrites: writes, logoutIsolation: true, bounds, errors, searchNotice, changedQueryNotice }, null, 2));
  assert.match(searchNotice, /cached|partial|saved.*device|connection.*results|results.*connection/i, 'Search must truthfully identify its offline cached/partial results');
 } catch (error) { await writeFile(resolve(artifacts!, 'shell-failure.json'), JSON.stringify(await shellTelemetry.snapshot(page, 'failure').catch((failure: unknown) => ({ diagnosticError: String(failure) })), null, 2)); await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: String(error), body: await page.$eval('body', el => el.innerText), ids, writes, errors }, null, 2)); await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {}); throw error; }
 finally { await api.dispose(); await browser.close(); }
});
