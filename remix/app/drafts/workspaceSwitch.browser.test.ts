import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringifyThingtimeForStorage } from '../Providers/thingtimeSerialization';

const base = process.env.TT_LOCAL_DRAFT_SWITCH_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_DRAFT_SWITCH_ARTIFACTS;

// Delay delivery of one real IndexedDB result, without fabricating its value or
// changing the app's identity/lease machinery. Only this disposable page is affected.
async function holdRead(page: any, key: string) {
 await page.evaluate((key: string) => {
  const original = IDBObjectStore.prototype.get;
  const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
  (window as any).__heldDraftRead = { started: false, release: null };
  IDBObjectStore.prototype.get = function(query: any) {
   const request = original.call(this, query);
   if (this.name === 'keyvaluepairs' && query === key) {
    IDBObjectStore.prototype.get = original;
    Object.defineProperty(request, 'onsuccess', { configurable: true, set(handler) {
     descriptor.set!.call(request, (event: Event) => {
      (window as any).__heldDraftRead.started = true;
      (window as any).__heldDraftRead.release = () => handler.call(request, event);
     });
    } });
   }
   return request;
  };
 }, key);
}
async function putLegacy(page: any, entries: [string, string][]) {
 await page.evaluate(async (entries: [string, string][]) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
   const request = indexedDB.open('localforage');
   request.onupgradeneeded = () => request.result.createObjectStore('keyvaluepairs');
   request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try { await new Promise<void>((resolve, reject) => {
   const tx = db.transaction('keyvaluepairs', 'readwrite');
   for (const [key, value] of entries) tx.objectStore('keyvaluepairs').put(value, key);
   tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
 }, entries);
}

test('native cross-tab account switches retire held legacy draft review and copy results', {
 skip: !base || !playwrightPath, timeout: 150_000
}, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const control = await context.newPage(), tree = await context.newPage(), comment = await context.newPage();
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin };
 const users: { id: string; username: string }[] = [], errors: string[] = [], evidence: string[] = [];
 let releaseResponse = () => {}, responseFinished: Promise<unknown> | undefined;
 let parent = '';
 for (const page of [control, tree, comment]) { page.setDefaultTimeout(20_000); page.on('pageerror', (error: Error) => errors.push(error.message)); }
 const editor = tree.locator('.string-atomic-wrapper [contenteditable="true"]');
 const input = comment.getByPlaceholder('Write a comment… 💬', { exact: true });
 const treeDialog = tree.getByRole('dialog').filter({ hasText: 'Earlier device workspace' });
 const commentDialog = comment.getByRole('dialog').filter({ hasText: 'Earlier comment draft' });
 const switchTo = async (user: { id: string; username: string }) => {
  await control.getByRole('button', { name: new RegExp('^Switch to .*' + user.username) }).click();
  for (const page of [control, tree, comment]) {
   if (page.url() === 'about:blank') continue;
   await page.waitForFunction((id: string) => {
    const value = localStorage.getItem('thingtime:local-workspace-root:v1');
    try { return value && JSON.parse(value)[3] === id; } catch { return false; }
   }, user.id);
  }
 };
 const typeTree = async (text: string) => {
  if (!await editor.count()) {
   await tree.locator('[contenteditable="true"]').last().click({ button: 'right' });
   await tree.getByText('Change type…', { exact: true }).click(); await tree.getByText('string', { exact: true }).click();
  }
  await editor.fill(text); await tree.getByText('Draft saved on this device ✓', { exact: true }).waitFor();
 };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  for (let index = 0; index < 2; index++) {
   const username = 'switchqa-' + randomUUID().slice(0, 8);
   const response = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
   assert.equal(response.status(), 200, await response.text()); users.push({ id: (await response.json()).user.id, username });
   if (!index) {
    const created = await context.request.post(url('/api/v1/things'), { headers, data: { thingtime: ['data'], crystal: { name: 'Private switch fixture' }, acl: ['tt:user'] } });
    assert.equal(created.status(), 200, await created.text()); parent = (await created.json()).thing.id;
   }
  }
  const [a, b] = users, treeKey = `thingtime:account:${a.id}`, commentKey = `tt-draft:${a.id}:${parent}`;
  await control.goto(url('/settings/account'));
  await tree.goto(url('/editor/SwitchNotes'));
  await tree.getByRole('button', { name: 'Load drafts & templates', exact: true }).waitFor();
  await typeTree('Account B current notes');
  await putLegacy(tree, [[treeKey, stringifyThingtimeForStorage({ EarlierNotes: 'Account A earlier private tree' })], [commentKey, 'Account A earlier private comment']]);
  await switchTo(a);
  await tree.getByRole('button', { name: 'Recover earlier device tree', exact: true }).waitFor();
  await typeTree('Account A current notes');
  await comment.goto(url('/thing/' + parent)); await input.waitFor();
  await input.fill('Account A current comment'); await comment.getByText('Draft saved on this device ✓', { exact: true }).waitFor();
  for (const phase of ['review', 'copy']) {
   if (phase === 'copy') {
    await tree.getByRole('button', { name: 'Recover earlier device tree', exact: true }).click(); await treeDialog.locator('pre').waitFor();
    await comment.getByRole('button', { name: 'Recover earlier comment draft', exact: true }).click();
    await commentDialog.getByRole('button', { name: 'Earlier text draft', exact: true }).click(); await commentDialog.locator('pre').waitFor();
   }
   await holdRead(tree, treeKey); await holdRead(comment, commentKey);
   if (phase === 'review') {
    await tree.getByRole('button', { name: 'Recover earlier device tree', exact: true }).click();
    await comment.getByRole('button', { name: 'Recover earlier comment draft', exact: true }).click();
    await commentDialog.getByRole('button', { name: 'Earlier text draft', exact: true }).click();
   } else {
    await treeDialog.getByRole('button', { name: 'Copy into this workspace', exact: true }).click();
    await commentDialog.getByRole('button', { name: 'Append to comment', exact: true }).click();
   }
   for (const page of [tree, comment]) await page.waitForFunction(() => (window as any).__heldDraftRead?.started);
   await switchTo(b);
   await tree.waitForFunction(() => window.getThingtime(['SwitchNotes']) === 'Account B current notes');
   await input.waitFor({ state: 'hidden' });
   for (const page of [tree, comment]) await page.evaluate(() => (window as any).__heldDraftRead.release());
   await tree.evaluate(() => new Promise(requestAnimationFrame));
   assert.equal(await treeDialog.count(), 0); assert.equal(await commentDialog.count(), 0);
   assert.equal(await tree.evaluate(() => window.getThingtime(['Recovered device workspace'])), undefined);
   assert.equal(await editor.innerText(), 'Account B current notes');
   assert.equal(await comment.getByText('Account A earlier private comment', { exact: true }).count(), 0);
   evidence.push(`${phase}: old read delivered after native cross-tab switch; no adoption in account B`);
   await switchTo(a);
   await tree.waitForFunction(() => window.getThingtime(['SwitchNotes']) === 'Account A current notes');
   await input.waitFor(); await comment.waitForFunction(() => (document.querySelector('textarea[placeholder="Write a comment… 💬"]') as HTMLTextAreaElement)?.value === 'Account A current comment');
   assert.equal(await tree.evaluate(() => window.getThingtime(['Recovered device workspace'])), undefined);
  }
  // Both sources remain recoverable under their original account after the races.
  await tree.getByRole('button', { name: 'Recover earlier device tree', exact: true }).click(); await treeDialog.locator('pre').filter({ hasText: 'Account A earlier private tree' }).waitFor();
  await comment.getByRole('button', { name: 'Recover earlier comment draft', exact: true }).click(); await commentDialog.getByRole('button', { name: 'Earlier text draft', exact: true }).click();
  await commentDialog.locator('pre').getByText('Account A earlier private comment', { exact: true }).waitFor();
  await treeDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await commentDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await treeDialog.waitFor({ state: 'hidden' }); await commentDialog.waitFor({ state: 'hidden' });
  const submitted = 'Private comment with a delayed account response';
  let remoteStatus = 0, remoteStarted = false;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  await context.route('**/api/v1/things/comment', async (route: any) => {
   if (route.request().method() !== 'POST' || route.request().postDataJSON()?.text !== submitted) return route.continue();
   responseFinished = (async () => {
    const response = await route.fetch(); remoteStatus = response.status(); remoteStarted = true;
    await responseGate;
    // The real client may abort this request when its identity retires. A route
    // fulfillment after abort is allowed to fail; the real server result is kept.
    await route.fulfill({ response }).catch(() => {});
   })();
   await responseFinished;
  });
  await input.fill(submitted); await comment.getByRole('button', { name: 'Send comment', exact: true }).click();
  await comment.waitForFunction(() => (document.querySelector('textarea[placeholder="Write a comment… 💬"]') as HTMLTextAreaElement)?.value === '');
  for (let attempt = 0; attempt < 80 && !remoteStarted; attempt++) await comment.waitForTimeout(100);
  assert.equal(remoteStarted, true, 'Real server write completes before identity changes'); assert.equal(remoteStatus, 200);
  await switchTo(b); await input.waitFor({ state: 'hidden' });
  releaseResponse(); await responseFinished; await context.unroute('**/api/v1/things/comment');
  assert.equal((await context.request.get(url('/api/v1/things?id=' + parent))).status(), 404, 'Account B cannot read the private parent');
  assert.equal(await comment.getByText(submitted, { exact: true }).count(), 0);
  assert.equal(await editor.innerText(), 'Account B current notes');
  await switchTo(a); await input.waitFor();
  await comment.getByLabel('Comments results', { exact: true }).getByText(submitted, { exact: true }).waitFor();
  assert.equal(await input.inputValue(), '', 'A retired draft cannot resurrect the completed comment');
  const list = await context.request.get(url('/api/v1/things?target=' + parent + '&thingtime=comment&commentProjection=true&limit=20'));
  assert.equal(list.status(), 200); const received = (await list.json()).comments;
  assert.equal(received.filter((row: any) => row.text === submitted).length, 1);
  const saved = received.find((row: any) => row.text === submitted); assert.equal(saved.author.id, a.id);
  // Rendering an optimistic local row is not proof that the uncertain write has
  // reconciled. Read only this fixture's exact queue record until acknowledged.
  await comment.waitForFunction(async ({ id, owner }: { id: string; owner: string }) => {
   const pointer = JSON.parse(localStorage.getItem('thingtime:local-workspace-root:v1')!);
   if (pointer[3] !== owner) return false;
   const scope = JSON.stringify(['account', location.origin, owner, pointer[4]]);
   const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('thingtime.local-workspaces.v1');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
   });
   try { return await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('records', 'readonly'), request = tx.objectStore('records').get([scope, 'thing-sync', id]);
    tx.oncomplete = () => resolve(request.result?.value?.state === 'synced' && !request.result.value.pending);
    tx.onabort = () => reject(tx.error);
   }); } finally { db.close(); }
  }, { id: saved.id, owner: a.id }, { timeout: 90_000, polling: 250 });
  const settled = await context.request.get(url('/api/v1/things?target=' + parent + '&thingtime=comment&commentProjection=true&limit=20'));
  assert.equal(settled.status(), 200); assert.equal((await settled.json()).comments.filter((row: any) => row.text === submitted).length, 1);
  evidence.push('sync response: real private comment committed before switch; no cross-account display, original queue acknowledged and exactly one remote comment after reconciliation');
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ nativeAccountSwitcher: true, crossTab: true, evidence, sourceRecoveryRetained: true, currentEditsRetained: true, errors }, null, 2));
 } catch (error) {
  if (artifacts) for (const [name, page] of [['control', control], ['tree', tree], ['comment', comment]] as const) {
   await page.screenshot({ path: resolve(artifacts, `${name}-failure.png`) }).catch(() => {});
   await writeFile(resolve(artifacts, `${name}-failure.json`), JSON.stringify({ body: await page.locator('body').innerText().catch(() => ''), errors }, null, 2));
  }
  throw error;
 } finally {
  releaseResponse(); await responseFinished?.catch(() => {});
  try {
   if (users[0]) await context.request.post(url('/api/v1/auth/accounts/switch'), { headers, data: { userId: users[0].id } });
   if (parent) await context.request.delete(url('/api/v1/things'), { headers, data: { id: parent } });
   if (users.length) await context.request.post(url('/api/v1/auth/logout'), { headers, data: { all: true } });
  } finally { await browser.close(); }
 }
});
