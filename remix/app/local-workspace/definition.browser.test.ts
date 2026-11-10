import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_DEFINITION_URL, artifacts = process.env.TT_LOCAL_DEFINITION_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const enabled = !!base && !!playwrightPath;
const ready = async (page: any) => page.waitForFunction(async () => {
 await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
 for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
 return false;
});
async function open(page: any) {
 await page.getByRole('button', { name: 'Component settings', exact: true }).click();
 await page.getByRole('menuitem', { name: 'Edit definition…', exact: true }).click();
 await page.getByRole('button', { name: 'Save definition', exact: true }).waitFor();
}
const content = { name: 'Definition recovery fixture', componentKey: 'definition-recovery', version: 1, render: { tag: 'p', children: 'Native definition before edit' } };
async function create(page: any) {
 await page.goto(new URL('/things', base).href);
 await page.getByRole('button', { name: 'Import…', exact: true }).click();
 await page.getByRole('textbox', { name: 'Copied Thingtime content' }).fill(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['component'], things: [{ id: 'component', thingtime: ['component'], crystal: content }], files: [] }));
 await page.getByRole('button', { name: 'Read pasted content', exact: true }).click(); await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
 const link = page.getByRole('link', { name: content.name, exact: true }); await link.waitFor();
 const id = new URL(await link.getAttribute('href'), base).pathname.split('/').pop()!;
 await page.goto(new URL(`/components/${id}?catalog=device`, base).href); await page.getByText(content.render.children, { exact: true }).first().waitFor(); return id;
}
for (const account of [false, true]) test(`${account ? 'account' : 'anonymous'} definition/source controls recover offline and save independently of draft queues`, { skip: !enabled, timeout: 180_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin: new URL(base!).origin }, ids = new Set<string>(), errors: string[] = [], writes: string[] = [], bounds: any[] = []; let stalled = 0;
 const label = account ? 'account' : 'anonymous';
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (!['GET','HEAD','OPTIONS'].includes(request.method())) { const path = new URL(request.url()).pathname; writes.push(path); if (path === '/api/v1/things') { const body = request.postDataJSON(); if (body?.shareId) ids.add(body.shareId); } } });
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  let owner: string | undefined;
  if (account) {
   const username = `definitionqa-${randomUUID().slice(0,8)}`;
   const r = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID()+randomUUID() } }); assert.equal(r.status(), 200); owner = (await r.json()).user.id;
   await context.route('**/api/v1/drafts*', route => { if (route.request().method() === 'POST') { stalled++; return new Promise(() => {}); } return route.continue(); });
  }
  const root = page.waitForResponse((r: any) => new URL(r.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); const rootData = await (await root).json(); assert.equal(rootData.user?.id, owner); await ready(page);
  await context.setOffline(true); assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-definition-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  const id = await create(page); ids.add(id); const originalUrl = page.url(), offlineWrites = writes.length;
  await open(page);
  await page.getByRole('textbox', { name: 'version value', exact: true }).fill('1e-');
  await page.getByRole('textbox', { name: 'New Definition property', exact: true }).fill('unfinished property');
  await page.reload(); await open(page);
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="version value"]')?.value === '1e-');
  assert.equal(await page.getByRole('textbox', { name: 'New Definition property' }).inputValue(), 'unfinished property'); assert.equal(await page.getByRole('button', { name: 'Save definition', exact: true }).isDisabled(), true);
  await page.getByRole('textbox', { name: 'version value', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const existing = JSON.parse(await page.getByRole('textbox', { name: 'Definition source' }).inputValue());
  const authored = { ...existing, name: 'Recovered definition saved', render: { tag: 'p', children: 'Native recovered definition' } };
  await page.getByRole('textbox', { name: 'Definition source' }).fill('{ unfinished source');
  await page.reload(); await open(page);
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Definition source"]')?.value === '{ unfinished source');
  assert.equal(await page.getByRole('button', { name: 'Save definition', exact: true }).isDisabled(), true);
  await page.getByRole('textbox', { name: 'Definition source' }).fill(JSON.stringify(authored, null, 2));
  for (const width of [1440,390,320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const size = await page.getByRole('dialog').evaluate((node: HTMLElement) => ({ width: innerWidth, dialog: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth }));
   assert.ok(size.dialog <= width); assert.equal(size.scroll,size.client); bounds.push(size);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `${label}-definition-${width}.png`) });
  }
  // Save before any debounce/blur draft round-trip can complete.
  await page.getByRole('button', { name: 'Save definition', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('Native recovered definition', { exact: true }).first().waitFor();
  await page.reload(); await open(page); await page.getByRole('button', { name: 'Source', exact: true }).click();
  assert.equal(JSON.parse(await page.getByRole('textbox', { name: 'Definition source' }).inputValue()).version, 2);
  assert.equal(await page.getByText(/This saved definition changed since your draft/).count(), 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('component-source-action').fill('unfinished action');
  await page.getByTestId('component-source-refresh').selectOption('interval');
  await page.getByTestId('component-source-interval').fill('7000');
  await page.getByTestId('component-source-inputs').fill('{ unfinished inputs');
  await page.reload();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-testid="component-source-action"]')?.value === 'unfinished action');
  assert.equal(await page.getByTestId('component-source-inputs').inputValue(), '{ unfinished inputs'); assert.equal(await page.getByTestId('component-source-interval').inputValue(), '7000');
  assert.equal(new URL(page.url()).searchParams.has('source'), false); assert.equal(writes.some(path => path.includes('/actions/run')), false);
  await page.getByRole('button', { name: 'Component settings', exact: true }).click(); await page.getByRole('menuitem', { name: 'Duplicate privately', exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith('/thing/') && !url.pathname.includes(id));
  const copyId = new URL(page.url()).pathname.split('/').pop()!; ids.add(copyId);
  await page.goto(new URL(`/components/${copyId}?catalog=device`, base).href); await page.getByText('Native recovered definition', { exact: true }).first().waitFor();
  assert.equal(await page.getByTestId('component-source-action').inputValue(), '', 'copy does not adopt the original control draft');
  assert.deepEqual(writes.slice(offlineWrites), []); assert.deepEqual(errors, []);
  // A recovered snapshot must not overwrite a newer saved version from another tab.
  const other = await context.newPage(); await other.goto(originalUrl); await open(other);
  await page.goto(originalUrl); await open(page); await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Definition source' }).fill('{ older unfinished edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await other.getByRole('button', { name: 'Source', exact: true }).click();
  const recovery = await page.evaluate((id: string) => {
   const key = Object.keys(localStorage).find(key => key.startsWith('tt-account-draft:') && key.includes(`:definition:${id}:workspace:`) && !key.includes(':retired:'))!;
   return { key, raw: localStorage.getItem(key) };
  }, id);
  assert.ok(recovery.raw);
  const newer = JSON.parse(await other.getByRole('textbox', { name: 'Definition source' }).inputValue()); newer.version = 3;
  await other.getByRole('textbox', { name: 'Definition source' }).fill(JSON.stringify(newer));
  await other.getByRole('button', { name: 'Save definition', exact: true }).click(); await other.getByRole('dialog').waitFor({ state: 'hidden' }); await other.close();
  // Restore the older device recovery bytes after the other tab retires its own session,
  // as when an older device/editor returns after a newer authoritative save.
  await page.evaluate(({key,raw}) => localStorage.setItem(key,raw!),recovery);
  await page.reload(); await open(page);
  await page.getByText(/This saved definition changed since your draft/).waitFor();
  assert.equal(await page.getByRole('button', { name:'Save definition', exact:true }).isDisabled(),true);
  await page.getByRole('button', { name: 'Discard recovered draft and use saved version', exact:true }).click();
  assert.equal(JSON.parse(await page.getByRole('textbox', { name:'Definition source' }).inputValue()).version,3);
  // Damaged recovery is retained verbatim and does not block an authoritative save.
  await page.getByRole('button', { name:'Cancel', exact:true }).click();
  const damaged = await page.evaluate(({key,raw}) => { const value=JSON.parse(raw!); value.content.snapshot=JSON.stringify({source:42,baseUpdatedAt:null}); if(value.pending) value.pending.content.snapshot=value.content.snapshot; const damagedRaw=JSON.stringify(value); localStorage.setItem(key,damagedRaw); return {key,raw:damagedRaw}; },recovery);
  await page.reload(); await open(page);
  await page.getByRole('alert').filter({hasText:'The saved draft could not be restored and has been kept.'}).waitFor();
  await page.getByRole('button', { name:'Save definition', exact:true }).click(); await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),damaged.key),damaged.raw);
  assert.deepEqual(writes.slice(offlineWrites), []); assert.deepEqual(errors, []);
  if (account) {
   await context.setOffline(false); await page.goto(originalUrl);
   await open(page); await page.getByRole('button', { name: 'Source', exact: true }).click();
   const current = JSON.parse(await page.getByRole('textbox', { name: 'Definition source' }).inputValue()); current.render.children = 'Account independent save';
   await page.getByRole('textbox', { name: 'Definition source' }).fill(JSON.stringify(current));
   await page.getByRole('button', { name: 'Save definition', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
   await page.getByText('Account independent save', { exact: true }).first().waitFor(); assert.ok(stalled > 0);
   let saved: any;
   for (let n=0;n<100;n++) { const r = await context.request.get(new URL(`/api/v1/things?id=${id}`,base).href); if(r.ok()) saved=(await r.json()).thing; if(saved?.crystal.render.children==='Account independent save') break; await new Promise(resolve=>setTimeout(resolve,100)); }
   assert.equal(saved?.author.id,owner); assert.equal(saved?.crystal.render.children,'Account independent save');
  }
  if (artifacts) await writeFile(resolve(artifacts, `${label}-verification.json`), JSON.stringify({ staleDraftRefused:true, malformedDraftRetained:true, numericDraftRecovery:true, incompleteSourceRecovery:true, nativeDefinitionSave:true, sourceControlRecovery:true, noRecoveryActionExecution:true, independentDuplicate:true, stalledDraftRequests:stalled, accountSync:account, bounds, writes, errors },null,2));
 } catch(error) { if(artifacts) { await page.screenshot({path:resolve(artifacts,`${label}-failure.png`),fullPage:true}); await writeFile(resolve(artifacts,`${label}-failure.json`),JSON.stringify({body:await page.locator('body').innerText(),writes,errors},null,2)); } throw error; }
 finally { await context.setOffline(false); await context.unrouteAll({behavior:'ignoreErrors'}); if(account) { for(const id of [...ids].reverse()) await context.request.delete(new URL(`/api/v1/things?id=${id}`,base).href,{headers}); await context.request.post(new URL('/api/v1/auth/logout',base).href,{headers}); } await browser.close(); }
});
