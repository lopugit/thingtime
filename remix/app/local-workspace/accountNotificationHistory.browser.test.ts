import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_ACCOUNT_NOTIFICATION_HISTORY_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_ACCOUNT_NOTIFICATION_HISTORY_ARTIFACTS;

test('native account history retains an offline message through reconnect refusal, explicit retry, two tabs and cold reload', {
 skip: !base || !playwrightPath, timeout: 180_000
}, async () => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION, 'A network-isolated synthetic runtime is required');
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 await context.addInitScript(() => window.addEventListener('thingtime:notification-recorded', event => { (window as any).__lastNotificationScope = (event as CustomEvent).detail?.scope; }));
 const page = await context.newPage(), otherTab = await context.newPage();
 const sessions = await Promise.all([page, otherTab].map(tab => context.newCDPSession(tab)));
 const connectivity = async (offline: boolean) => {
  await context.setOffline(offline);
  for (const session of sessions) await session.send('Network.overrideNetworkState', { offline, latency: 1, downloadThroughput: 1e8, uploadThroughput: 1e8, connectionType: offline ? 'none' : 'ethernet' });
  for (const tab of [page, otherTab]) assert.equal(await tab.evaluate(() => navigator.onLine), !offline);
 };
 await connectivity(false);
 const created: string[] = [], errors: string[] = [], sent: string[] = [], historyRequests: unknown[] = [], viewports: unknown[] = [];
 let heldQueryFailure: unknown;
 context.on('response', (response: any) => { const url = new URL(response.url()); if (url.pathname === '/api/v1/notifications') historyRequests.push({ query: url.search, status: response.status() }); });
 const request = async (method: string, url: string, data?: unknown) => {
  const result = await page.evaluate(async ({ method, url, data }: { method: string; url: string; data?: unknown }) => {
   const response = await fetch(url, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
   return { status: response.status, body: await response.json() };
  }, { method, url, data });
  return { status: () => result.status, json: async () => result.body };
 };
 let owner = '', refuse = true;
 context.on('page', (tab: any) => tab.on('pageerror', (error: Error) => errors.push(error.message)));
 page.on('pageerror', (error: Error) => errors.push(error.message));
 otherTab.on('pageerror', (error: Error) => errors.push(error.message));
 const recordRoute = async (route: any) => {
  sent.push(route.request().postDataJSON().eventId);
  if (refuse) await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Synthetic reconnect refusal' }) });
  else await route.continue();
 };
 try {
  if (artifacts) await mkdir(artifacts, { recursive: true });
  await page.goto(base + '/notifications?source=device');
  const username = 'historyqa-' + randomUUID().slice(0, 8), password = randomUUID() + randomUUID();
  const registered = await request('POST', base + '/api/v1/auth/register', { username, email: `${username}@example.test`, password });
  assert.equal(registered.status(), 200); owner = (await registered.json()).user.id;
  const login = await request('POST', base + '/api/v1/login', { username, password });
  assert.equal(login.status(), 200); assert.equal((await login.json()).user.id, owner);
  for (const [kind, name] of [['folder', 'History destination'], ['data', 'History offline move']]) {
   const response = await request('POST', base + '/api/v1/things', { thingtime: [kind], crystal: { name }, visibility: 'private' });
   assert.equal(response.status(), 200); created.push((await response.json()).thing.id);
  }
  for (let index = 0; index < 31; index++) {
   const recorded = await request('POST', base + '/api/v1/notifications/record', { userId: owner, eventId: randomUUID(), title: `History retained item ${index}`, description: 'Disposable account history fixture', status: 'info' });
   assert.equal(recorded.status(), 200);
  }
  await page.goto(base + '/things');
  await page.getByRole('link', { name: 'History offline move', exact: true }).waitFor();
  await otherTab.goto(base + '/notifications?source=device');
  await otherTab.getByText('All quiet — nothing here yet', { exact: true }).waitFor();
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready;
   if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  await context.route('**/api/v1/notifications/record', recordRoute);
  await connectivity(true);
  const select = page.getByRole('checkbox', { name: 'Select History offline move', exact: true });
  await page.locator('label').filter({ has: select }).click();
  await page.getByRole('button', { name: '📁 Move', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('History destination', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Move here', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await otherTab.getByRole('button', { name: 'Retry account sync', exact: true }).waitFor();
  await page.goto(base + '/notifications?source=device');
  await page.reload();
  await page.getByRole('button', { name: 'Retry account sync', exact: true }).waitFor();
  assert.equal(sent.length, 0, 'Offline history writes never attempt account transport');
  await connectivity(false);
  // The normal online event revalidates this unchanged synthetic account.
  // Observe its completed retry rather than racing the transient Reconnect control.
  await page.getByText(/could not sync|failed/i).filter({ hasNot: page.getByRole('button') }).first().waitFor();
  assert.ok(sent.length >= 1);
  refuse = false;
  await page.getByRole('button', { name: 'Retry account sync', exact: true }).focus();
  assert.equal(await page.getByRole('button', { name: 'Retry account sync', exact: true }).evaluate((element: Element) => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Retry account sync', exact: true }).waitFor({ state: 'hidden' });
  await otherTab.getByRole('button', { name: 'Retry account sync', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(new Set(sent).size, 1, 'Explicit retry preserves the original event identity');
  const response = await request('GET', base + '/api/v1/notifications?history=1&types=system-message');
  assert.equal(response.status(), 200);
  const remote = (await response.json()).notifications;
  assert.equal(remote.filter((row: any) => !row.title.startsWith('History retained item')).length, 1, 'Real account read has one synced local event');
  await page.getByRole('button', { name: 'Account history', exact: true }).click();
  await page.getByText(remote[0].title, { exact: true }).first().waitFor();
  let releasePagination!: () => void;
  const heldPagination = new Promise<void>(resolve => { releasePagination = resolve; });
  let holdFirstPage = true;
  const paginationStarted = page.waitForRequest((request: any) => new URL(request.url()).pathname === '/api/v1/notifications' && new URL(request.url()).searchParams.has('cursor'), { timeout: 15000 });
  const holdPagination = async (route: any) => {
   if (holdFirstPage && new URL(route.request().url()).searchParams.has('cursor')) { holdFirstPage = false; await heldPagination; }
   await route.continue();
  };
  await context.route('**/api/v1/notifications?*', holdPagination);
  try {
   await page.getByRole('button', { name: 'Load older', exact: true }).click();
   await paginationStarted;
   const refreshed = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/notifications' && !new URL(response.url()).searchParams.has('cursor'));
   await page.evaluate(() => {
    const scope = (window as any).__lastNotificationScope;
    if (typeof scope !== 'string') throw new Error('No real workspace invalidation scope observed');
    window.dispatchEvent(new CustomEvent('thingtime:notification-recorded', { detail: { scope } }));
   });
   await refreshed;
   // A replaced pagination must release its busy state so the current cursor works.
   await page.getByRole('button', { name: 'Load older', exact: true }).click();
   await page.getByRole('button', { name: /^History retained item 0(?: \(unread\))?$/ }).waitFor();
   const retiredPage = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/notifications' && new URL(response.url()).searchParams.has('cursor'));
   releasePagination(); await retiredPage;
  } finally { releasePagination(); await context.unroute('**/api/v1/notifications?*', holdPagination); }

  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 31);
  let releaseOld!: () => void;
  const heldOld = new Promise<void>(resolve => { releaseOld = resolve; });
  const oldStarted = page.waitForRequest((request: any) => new URL(request.url()).searchParams.get('q') === 'History retained item 30', { timeout: 15000 });
  const holdPreviousQuery = async (route: any) => {
   if (new URL(route.request().url()).searchParams.get('q') === 'History retained item 30') { await heldOld; }
   await route.continue();
  };
  await context.route('**/api/v1/notifications?*', holdPreviousQuery);
  try {
   await page.getByRole('textbox', { name: 'Search notifications' }).fill('History retained item 30');
   await oldStarted;
   await page.getByText(/Showing results from your previous filters/).waitFor();
   assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 31, 'Previous rows remain visible while the next query is held');
   await page.getByRole('textbox', { name: 'Search notifications' }).fill('History retained item 29');
   await page.getByText(/1 notification match/).waitFor();
   await page.getByRole('button', { name: /^History retained item 29(?: \(unread\))?$/ }).waitFor();
   const oldResponse = page.waitForResponse((response: any) => new URL(response.url()).searchParams.get('q') === 'History retained item 30');
   releaseOld(); await oldResponse;
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   assert.equal(await page.getByRole('button', { name: /^History retained item 30(?: \(unread\))?$/ }).count(), 0, 'Late earlier-query response cannot overwrite the active query');
  } finally { releaseOld(); await context.unroute('**/api/v1/notifications?*', holdPreviousQuery); }
  let refuseOld!: () => void;
  const refusedOld = new Promise<void>(resolve => { refuseOld = resolve; });
  const refusalStarted = page.waitForRequest((request: any) => new URL(request.url()).searchParams.get('q') === 'History retained item 28', { timeout: 15000 });
  const lateRefusal = async (route: any) => {
   if (new URL(route.request().url()).searchParams.get('q') === 'History retained item 28') {
    await refusedOld;
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Synthetic late history refusal' }) });
   } else await route.continue();
  };
  await context.route('**/api/v1/notifications?*', lateRefusal);
  try {
   await page.getByRole('textbox', { name: 'Search notifications' }).fill('History retained item 28');
   await refusalStarted;
   const nextQueryStarted = page.waitForRequest((request: any) => new URL(request.url()).searchParams.get('q') === 'History retained item 27', { timeout: 15000 });
   await page.getByRole('textbox', { name: 'Search notifications' }).fill('History retained item 27');
   await nextQueryStarted;
   await page.getByRole('button', { name: /^History retained item 27(?: \(unread\))?$/ }).waitFor();
   assert.equal(await page.getByRole('textbox', { name: 'Search notifications' }).inputValue(), 'History retained item 27', 'A previous URL update cannot replace newer search input');
   refuseOld();
   await page.getByText('Account history access changed. Retry a fresh account read.', { exact: true }).waitFor();
   assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 0, 'A late refused query retires the current same-tab projection');
  } catch (error) {
   heldQueryFailure = { url: page.url(), input: await page.getByRole('textbox', { name: 'Search notifications' }).inputValue(), body: await page.locator('body').innerText(), historyRequests: [...historyRequests] };
   throw error;
  } finally { refuseOld(); await context.unroute('**/api/v1/notifications?*', lateRefusal); }
  await page.getByRole('textbox', { name: 'Search notifications' }).fill('History retained item');
  await page.getByText(/31 notifications match/).waitFor();
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await page.getByRole('button', { name: /^History retained item 0(?: \(unread\))?$/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 31);
  await connectivity(true);
  await page.reload();
  assert.equal(await page.getByRole('button', { name: 'Account history', exact: true }).getAttribute('aria-pressed'), 'true', 'Cold offline reload keeps the selected account history view without a live login');
  await page.getByText(/Showing previously downloaded account history/).waitFor();
  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 30);
  await page.getByRole('button', { name: 'Load saved older notifications', exact: true }).click();
  await page.getByRole('button', { name: /^History retained item 0(?: \(unread\))?$/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 31);
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const traversal = await page.evaluate(async () => {
    let steps = 0;
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(1, innerHeight - 120)) {
     if (++steps > 100) throw new Error('Unexpected unbounded history page');
     scrollTo(0, y);
     await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
     if (document.documentElement.scrollWidth > innerWidth) throw new Error('History layout overflows the viewport');
     const floatingTool = document.getElementsByClassName('tt.devKit')[0];
     if (floatingTool?.getAttribute('aria-hidden') === 'true' && getComputedStyle(floatingTool).opacity !== '0') throw new Error('Hidden floating tool must also hide its transitioning icon');
     for (const control of document.querySelectorAll<HTMLElement>('.ttPageShell input, .ttPageShell select, .ttPageShell button')) {
      const rect = control.getBoundingClientRect();
      if ((control as HTMLInputElement).disabled || rect.width < 6 || rect.height < 6 || rect.top < 72 || rect.bottom > innerHeight) continue;
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!hit || (hit !== control && !control.contains(hit))) throw new Error(`History control is covered: ${control.getAttribute('aria-label') || control.textContent?.slice(0, 60)} by ${hit?.className}`);
     }
    }
    scrollTo(0, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return steps;
   });
   viewports.push({ width, height: width === 1440 ? 1000 : 844, traversal });
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `account-history-${width}.png`), fullPage: true });
  }
  // Optional floating tools reappear away from the protected filter controls.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const devKit = page.getByRole('button', { name: 'Move or open DevKit', exact: true });
  await devKit.click();
  assert.equal(await devKit.getAttribute('aria-pressed'), 'true');
  await devKit.click();
  assert.equal(await devKit.getAttribute('aria-pressed'), 'false');
  const beforeDrag = await devKit.boundingBox(); assert.ok(beforeDrag);
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 - 12, beforeDrag.y + beforeDrag.height / 2, { steps: 3 });
  await page.mouse.up();
  const afterDrag = await devKit.boundingBox(); assert.ok(afterDrag);
  assert.ok(afterDrag.x < beforeDrag.x, 'Clearance preserves normal floating-tool dragging');
  assert.equal(await devKit.getAttribute('aria-pressed'), 'false');
  await connectivity(false);
  await page.goto(base + '/notifications?source=account');
  await page.getByRole('button', { name: 'Load older', exact: true }).waitFor();
  await otherTab.goto(base + '/notifications?source=account');
  await otherTab.getByRole('button', { name: 'Load older', exact: true }).waitFor();
  await page.evaluate(() => {
   const original = IDBObjectStore.prototype.delete;
   (window as any).__historyDeleteFailures = 0;
   IDBObjectStore.prototype.delete = function(key: IDBValidKey) {
    if (Array.isArray(key) && key[1] === 'notification-account-pages') { (window as any).__historyDeleteFailures++; throw new DOMException('Synthetic history cleanup failure', 'UnknownError'); }
    return original.call(this, key);
   };
  });
  const refusal = async (route: any) => {
   if (new URL(route.request().url()).searchParams.has('cursor')) await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Synthetic history access refusal' }) });
   else await route.continue();
  };
  await context.route('**/api/v1/notifications?*', refusal);
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await page.getByText('Account history access changed. Retry a fresh account read.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 0, 'Pagination permission refusal retires the visible projection');
  await page.waitForFunction(() => (window as any).__historyDeleteFailures > 0);
  await otherTab.getByText('Account history access changed. Retry a fresh account read.', { exact: true }).waitFor();
  assert.equal(await otherTab.getByRole('button', { name: /^History retained item/ }).count(), 0, 'Refusal marker retires another tab without retry loops');
  await connectivity(true);
  await page.reload();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 0, 'Refused private history cannot reappear from first-paint or retained caches');
  await connectivity(false);
  await context.unroute('**/api/v1/notifications?*', refusal);
  for (const id of created.splice(0).reverse()) {
   const removed = await request('DELETE', base + '/api/v1/things', { id });
   assert.equal(removed.status(), 200);
  }
  const nextUsername = 'history-switch-' + randomUUID().slice(0, 8), nextPassword = randomUUID() + randomUUID();
  const nextAccount = await request('POST', base + '/api/v1/auth/register', { username: nextUsername, email: `${nextUsername}@example.test`, password: nextPassword });
  assert.equal(nextAccount.status(), 200);
  const nextOwner = (await nextAccount.json()).user.id; assert.notEqual(nextOwner, owner);
  const nextLogin = await request('POST', base + '/api/v1/login', { username: nextUsername, password: nextPassword });
  assert.equal(nextLogin.status(), 200); assert.equal((await nextLogin.json()).user.id, nextOwner);
  const nextHistory = page.waitForResponse((response: any) => {
   const url = new URL(response.url());
   return url.pathname === '/api/v1/notifications' && url.searchParams.get('history') === '1' && !url.searchParams.has('q');
  });
  await page.goto(base + '/notifications?source=account');
  const nextHistoryResponse = await nextHistory;
  assert.equal(nextHistoryResponse.status(), 200);
  assert.equal((await nextHistoryResponse.json()).notifications.some((row: any) => row.title?.startsWith('History retained item')), false);
  assert.equal(await page.getByRole('button', { name: 'Account history', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: /^History retained item/ }).count(), 0);
  const otherHistory = otherTab.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/notifications' && new URL(response.url()).searchParams.get('history') === '1');
  await otherTab.reload();
  assert.equal((await otherHistory).status(), 200);
  assert.equal(await otherTab.getByRole('button', { name: /^History retained item/ }).count(), 0);
  assert.equal(await otherTab.getByRole('button', { name: 'Retry account sync', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ isolatedAccount: true, ownerId: owner, offlineSave: true, reconnectRefusal: true, explicitRetry: true, keyboardRetry: true, stableEventIdentity: true, crossTabHistory: true, coldOfflineAccountHistory: true, remoteSystemHistory: true, exactFilterRetention: true, lateQueryResponseIgnored: true, newerSearchInputPreserved: true, lateSameTabRefusalRetirement: true, cachedPagination: true, heldPaginationInvalidationRecovery: true, accountSwitchRetirement: true, paginationPermissionRefusal: true, purgeFailureRefusalGuard: true, crossTabRefusalRetirement: true, realSocialActivityAcceptance: false, mobileFilterHitTargets: true, floatingToolControls: true, viewports, errors }, null, 2));
 } catch (error) {
  if (artifacts) {
   await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true });
   await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ message: error instanceof Error ? error.message : String(error), url: page.url(), input: await page.getByRole('textbox', { name: 'Search notifications' }).inputValue().catch(() => null), heldQueryFailure, body: await page.locator('body').innerText(), errors, historyRequests, sentEventIds: sent }, null, 2));
  }
  throw error;
 } finally {
  await connectivity(false);
  for (const id of created.reverse()) await request('DELETE', base + '/api/v1/things', { id });
  await request('POST', base + '/api/v1/auth/logout', {});
  await browser.close();
 }
});
