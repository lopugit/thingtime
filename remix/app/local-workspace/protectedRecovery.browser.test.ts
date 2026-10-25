import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';
import { themeContentValue } from '../timeline/themeContent';
import { algorithmContentValue } from '../timeline/algorithmContent';

const origin = process.env.TT_PROTECTED_RECOVERY_ORIGIN, session = process.env.TT_PROTECTED_RECOVERY_SESSION;
const artifacts = process.env.TT_PROTECTED_RECOVERY_ARTIFACTS, fixture = process.env.TT_PROTECTED_RECOVERY_FIXTURE;
const puppeteerPath = process.env.TT_PROTECTED_RECOVERY_PUPPETEER, executablePath = process.env.TT_PROTECTED_RECOVERY_CHROME;

test('native anonymous History recovers deleted themes and algorithms privately with cold offline persistence', {
 skip: !origin || !session || !artifacts || !fixture || !puppeteerPath || !executablePath, timeout: 240_000
}, async t => {
 assert.equal(new URL(origin!).hostname, '127.0.0.1');
 assert.equal(new URL(origin!).origin, origin);
 const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment.sessionId, session);
 for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
  const code = await new Promise(resolve => { const socket = net.connect({ host, port: 443 });
   socket.setTimeout(1500); socket.once('error', (error: any) => resolve(error.code));
   socket.once('timeout', () => { socket.destroy(); resolve('timeout'); });
   socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
  });
  assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)), `Direct egress must fail closed: ${code}`);
 }
 await mkdir(artifacts!, { recursive: true });
 const { default: puppeteer } = await import(puppeteerPath!);
 const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 30_000,
  args: ['--no-proxy-server', '--disable-background-networking'] });
 t.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
 const context = await browser.createBrowserContext(), page = await context.newPage(); page.setDefaultTimeout(25_000);
 const errors: string[] = [], accountRequests: string[] = [], bounds: unknown[] = [], checks: string[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => {
  const path = new URL(request.url()).pathname;
  if (/^\/api\/v1\/(things|themes|algorithms|timeline|drafts|actions|auth\/temporary)(\/|$)/.test(path)) accountRequests.push(`${request.method()} ${path}`);
 });
 const click = async (label: string, contains = false) => {
  const handle = await page.waitForFunction((text: string, partial: boolean) => [...document.querySelectorAll<HTMLButtonElement>('button')]
   .find(button => !button.disabled && button.getBoundingClientRect().width && (partial ? button.textContent?.includes(text) : button.textContent?.trim() === text)), {}, label, contains);
  await handle.asElement().evaluate((button: HTMLElement) => button.scrollIntoView({ block: 'center' }));
  await handle.asElement().click(); await handle.dispose();
 };
 const inject = async () => { await page.addScriptTag({ path: fixture }); };
 const proof = async (ids: string[]) => { await inject(); return page.evaluate(ids => (window as any).protectedRecoveryFixture.proof(ids), ids); };
 const capture = async (label: string, review: boolean) => {
  for (const width of [1440, 390, 320]) {
   await page.setViewport({ width, height: width === 1440 ? 1000 : 844 }); await page.evaluate(() => document.fonts.ready);
   if (review) {
    // Resizing crosses HistoryDetails' 820px media query asynchronously. Wait
    // for the new shell before reading controls: the departing desktop preview
    // can still exist for a frame while the mobile editor is about to remount.
    const details = width <= 820 ? '[role="dialog"][aria-label="Version details"]' : 'aside[aria-label="Version details"]';
    await page.waitForSelector(details, { visible: true });
    await page.waitForFunction((selector: string) => {
     const root = document.querySelector(selector);
     return root && [...root.querySelectorAll<HTMLButtonElement>('button')].some(button =>
      !button.disabled && button.getBoundingClientRect().width &&
      ['Recover this Thing…', 'Recover Thing privately'].includes(button.textContent?.trim() ?? ''));
    }, {}, details);
    const canReview = await page.evaluate((selector: string) => [...document.querySelector(selector)!.querySelectorAll<HTMLButtonElement>('button')]
     .some(button => button.textContent?.trim() === 'Recover this Thing…' && button.getBoundingClientRect().width), details);
    if (canReview) await click('Recover this Thing…');
    await page.waitForFunction((selector: string) => document.querySelector(selector)?.textContent?.includes('Recover deleted Thing'), {}, details);
   }
   const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(el => el.getBoundingClientRect().width).map(el => {
     const box = el.getBoundingClientRect(); return { x: box.x, width: box.width, right: box.right };
    }) }));
   assert.equal(geometry.scrollWidth, width, label);
   for (const dialog of geometry.dialogs) assert.ok(dialog.x >= -1 && dialog.right <= width + 1, `${label}: dialog stays inside viewport`);
   bounds.push({ label, ...geometry });
   for (const bottom of [false, true]) {
    await page.evaluate(async (bottom: boolean) => {
     const roots = [document.scrollingElement!, ...[...document.querySelectorAll<HTMLElement>('body *')]
      .filter(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)];
     for (const root of roots) {
      if (root.scrollHeight > 40_000) throw Error('Unexpected repeating content in recovery');
      root.scrollTop = 0;
      if (bottom) for (let top = 0; top <= root.scrollHeight; top += Math.max(100, root.clientHeight / 2)) {
       root.scrollTop = top; await new Promise(requestAnimationFrame);
      }
     }
    }, bottom);
    if (review && bottom) {
     const control = await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === 'Recover Thing privately' && button.getBoundingClientRect().width));
     await control.asElement().evaluate((button: HTMLElement) => button.scrollIntoView({ block: 'center' }));
     assert.equal(await control.asElement().evaluate((button: HTMLElement) => {
      const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight && !!hit && (hit === button || button.contains(hit));
     }), true, `${label}: recovery confirmation is visible and unobstructed`);
     await control.dispose();
    }
    await page.screenshot({ path: resolve(artifacts!, `${label}-${width}${bottom ? '-bottom' : ''}.png`) });
   }
  }
 };
 let seeded: any;
 try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(origin + '/themes', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save theme 💾'));
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/root-data')).json()).user), null);
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, { timeout: 90_000 });
  await inject(); seeded = await page.evaluate(() => (window as any).protectedRecoveryFixture.seed());
  const ids = seeded.profiles.map((profile: any) => profile.id);
  const deleted = await proof(ids); assert.ok(deleted.rows.every((row: any) => row.row === null));
  assert.equal(deleted.themes.activeThemeId, null); assert.equal(deleted.algorithms.activeAlgorithmId, null);
  for (const profile of seeded.profiles) {
   await page.setViewport({ width: 1440, height: 1000 });
   await page.goto(origin + '/history?thing=' + encodeURIComponent(profile.id), { waitUntil: 'domcontentloaded' });
   await click('Deleted Thing', true);
   await page.setOfflineMode(true);
   await click('Recover this Thing…'); await capture(profile.kind + '-recovery', true);
   await click('Recover Thing privately');
   await page.waitForFunction(() => document.body.innerText.includes('Version saved.'));
   const restored = await proof(ids), row = restored.rows.find((item: any) => item.id === profile.id).row;
   assert.equal(row.id, profile.id); assert.deepEqual(row.thingtime, [profile.kind]);
   assert.equal(row.crystal.name, profile.name); assert.equal(row.crystal.title, profile.title); assert.equal(row.folderId, seeded.folderId);
   assert.equal(row.crystal.parentId, undefined); assert.equal(row.crystal.shared, undefined); assert.equal(row.crystal.listed, undefined);
   const events = restored.entries.find((item: any) => item.id === profile.id).entries;
   assert.equal(events.filter((entry: any) => entry.event.operation === 'delete' && entry.event.id === profile.deletionId).length, 1);
   const recovery = events.find((entry: any) => entry.event.operation === 'create' && entry.event.parentIds.includes(profile.deletionId));
   assert.ok(recovery, 'The actual UI must retain a new canonical recovery event');
   const source = profile.kind === 'theme' ? themeContentValue(profile.expected) : algorithmContentValue(profile.expected);
   const recovered = profile.kind === 'theme' ? themeContentValue(recovery.event.after) : algorithmContentValue(recovery.event.after);
   assert.deepEqual(recovered.crystal, source.crystal);
   if (profile.kind === 'theme') assert.equal('visibility' in recovered && recovered.visibility, 'private');
   assert.equal(restored.themes.activeThemeId, null); assert.equal(restored.algorithms.activeAlgorithmId, null);
   await page.reload({ waitUntil: 'domcontentloaded' });
   const cold = await proof(ids); assert.deepEqual(cold.rows.find((item: any) => item.id === profile.id).row, row);
   await page.goto(origin + '/things?folder=' + encodeURIComponent(seeded.folderId), { waitUntil: 'domcontentloaded' });
   await page.waitForFunction((title: string) => [...document.querySelectorAll('a')].some(link => link.textContent?.trim() === title), {}, profile.title);
   await capture(profile.kind + '-recovered-list', false);
   await page.reload({ waitUntil: 'domcontentloaded' });
   await page.waitForFunction((title: string) => document.body.innerText.includes(title), {}, profile.title);
   checks.push(`${profile.kind}: actual History recovery, canonical ID/design/privacy/selection proof and cold offline list reload`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(accountRequests, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks, bounds, errors, accountRequests, seeded,
   proof: await proof(seeded.profiles.map((profile: any) => profile.id)), scope: 'anonymous-device-only; no account acceptance claimed' }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), stack: (error as Error).stack,
   body: await page.$eval('body', (element: HTMLElement) => element.innerText).catch(() => ''), errors, accountRequests, seeded,
   proof: seeded ? await proof(seeded.profiles.map((profile: any) => profile.id)).catch(() => null) : null }, null, 2));
  throw error;
 } finally { await context.close(); await browser.close(); }
});
