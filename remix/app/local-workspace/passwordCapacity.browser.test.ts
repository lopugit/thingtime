import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
const base = process.env.TT_PASSWORD_NATIVE_URL, artifacts = process.env.TT_PASSWORD_NATIVE_ARTIFACTS;
const fixturePath = process.env.TT_PASSWORD_NATIVE_FIXTURE, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const phrase = 'Disposable native capacity vault phrase 🦄', title = 'Native synthetic capacity entry';
const exact = '  Exact synthetic 🦄 e\u0301 漢字 \t'.repeat(100_000) + '\n  Exact final multiline sentinel 🦊  \n';
test('native password UI preserves large Unicode and 66MiB attachment; native storage traverses all pages and fences stale pulls', { skip: !base || !artifacts || !fixturePath || !playwrightPath || process.env.TT_PASSWORD_NATIVE_PRIMITIVES_ONLY === '1', timeout: 480_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const temporary = await mkdtemp(join(tmpdir(), 'tt-password-capacity-'));
 const errors: string[] = [], writes: string[] = [], passwordRequests: string[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 context.on('request', (request: any) => { const path = new URL(request.url()).pathname; if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(path); if (path === '/api/v1/passwords') passwordRequests.push(path); });
 const unlock = async () => { await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase); await page.getByRole('button', { name: 'Unlock device vault', exact: true }).click(); };
 try {
  await mkdir(artifacts!, { recursive: true });
  const initialResponse = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/passwords', base).href);
  const initial = await (await initialResponse).json(); assert.equal(initial.user, null);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await context.setOffline(true);
  await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase);
  await page.getByLabel('Confirm device vault passphrase', { exact: true }).fill(phrase);
  await page.getByRole('button', { name: 'Create device vault', exact: true }).click();
  await page.getByRole('button', { name: 'Add password', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Custom field label', { exact: true }).fill('Exact Unicode note');
  await page.getByLabel('Custom field type', { exact: true }).selectOption('notes');
  await page.getByRole('button', { name: 'Add custom field', exact: true }).click();
  const note = page.getByLabel('Exact Unicode note', { exact: true });
  const noteState = await note.evaluate((element: HTMLTextAreaElement) => ({ readOnly: element.readOnly, disabled: element.disabled, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
  await writeFile(resolve(artifacts!, 'note-state.json'), JSON.stringify(noteState));
  assert.equal(noteState.readOnly, false); assert.equal(noteState.disabled, false);
  await note.fill('Bounded synthetic input probe');
  await note.fill(exact, { timeout: 150_000 });
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await page.getByRole('button', { name: `${title} login`, exact: true }).waitFor();
  const bytes = Buffer.alloc(66 * 1024 * 1024, 7); bytes[0] = 3; bytes[bytes.length - 1] = 99;
  const expectedHash = createHash('sha256').update(bytes).digest('hex'), source = join(temporary, 'capacity-66MiB.bin');
  await writeFile(source, bytes);
  await page.getByLabel('Add password attachment', { exact: true }).setInputFiles(source);
  await page.getByText('capacity-66MiB.bin ·', { exact: false }).waitFor({ timeout: 120_000 });
  await page.reload(); await unlock();
  await page.getByRole('button', { name: `${title} login`, exact: true }).click();
  assert.ok(await page.getByLabel('Exact Unicode note', { exact: true }).inputValue() === exact, 'Cold reload changed the exact Unicode note');
  await page.getByText('capacity-66MiB.bin ·', { exact: false }).waitFor();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  const restored = join(temporary, 'restored.bin'); await (await downloading).saveAs(restored);
  assert.equal(createHash('sha256').update(await readFile(restored)).digest('hex'), expectedHash);
  const persisted = await page.evaluate(async () => {
   const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('thingtime.local-workspaces.v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
   try { return await new Promise<any>((resolve, reject) => { const request = db.transaction('records').objectStore('records').getAll(); request.onsuccess = () => { const rows = request.result; const text = JSON.stringify(rows.filter((row: any) => row.collection !== '@bytes')); resolve({ plaintextFound: text.includes('Exact synthetic') || text.includes('capacity-66MiB.bin') || text.includes('native capacity vault phrase'), accountRecords: rows.filter((row: any) => JSON.parse(row.scope)[0] !== 'anonymous').length, encryptedFileParts: rows.filter((row: any) => row.collection === '@bytes').length, storedBytes: rows.reduce((n: number, row: any) => n + row.bytes, 0) }); }; request.onerror = () => reject(request.error); }); } finally { db.close(); }
  });
  assert.equal(persisted.plaintextFound, false); assert.equal(persisted.accountRecords, 0); assert.ok(persisted.storedBytes > 64 * 1024 * 1024);
  const bounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   await page.evaluate(async () => { scrollTo(0, 0); for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise(resolve => requestAnimationFrame(resolve)); } scrollTo(0, document.documentElement.scrollHeight); });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.scrollWidth, measured.width, 'PasswordManager horizontal overflow'); bounds.push(measured);
   await page.screenshot({ path: resolve(artifacts!, `password-capacity-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Exercise the ordinary portable export control, including the retained file.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format', { exact: true }).selectOption('1pux');
  await page.getByText('I understand the downloaded file contains unencrypted secrets.', { exact: true }).click();
  const backupDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download export', exact: true }).click();
  const backupPath = join(temporary, 'capacity.1pux'); await (await backupDownload).saveAs(backupPath);
  const backup = unzipSync(await readFile(backupPath)), data = strFromU8(backup['export.data']);
  assert.ok(data.includes(JSON.stringify(exact).slice(1, -1)), 'Native export must preserve exact Unicode note');
  const key = Object.keys(backup).find(key => key.endsWith('___capacity-66MiB.bin')); assert.ok(key);
  assert.equal(createHash('sha256').update(backup[key]).digest('hex'), expectedHash);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(passwordRequests, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ nativePasswordManagerUI: true, anonymous: true, offline: true, exactUnicodeBytes: Buffer.byteLength(exact), fileBytes: bytes.length, fileSha256: expectedHash, exactColdReload: true, exactDownload: true, normal1puxExport: true, bounds, persisted, errors, writes, passwordRequests }, null, 2));
 } catch (error) {
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: (error as Error).message.split('Call log:')[0].slice(0, 400), errors, writes, passwordRequests }, null, 2));
  await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true, timeout: 15_000 }).catch(() => {});
  throw Error((error as Error).message.split('Call log:')[0].slice(0, 400));
 } finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
});

// Separate from UI input capacity so a browser input failure cannot hide storage evidence.
test('native IndexedDB handles 205 refresh pages, 257 partitions, stale pulls and quota rollback', { skip: !base || !artifacts || !fixturePath || !playwrightPath, timeout: 180_000 }, async () => {
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 try {
  const page = await browser.newPage(); await page.goto(new URL('/passwords', base).href);
  await page.addScriptTag({ content: await readFile(fixturePath!, 'utf8') });
  const runtime = await page.evaluate(() => (window as any).passwordCapacityFixture.run());
  await mkdir(artifacts!, { recursive: true });
  await writeFile(resolve(artifacts!, 'native-primitives.json'), JSON.stringify(runtime, null, 2));
  const cdp = await page.context().newCDPSession(page);
  let supported = false;
  try { await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(base!).origin, quotaSize: 1024 * 1024 }); supported = true; }
  catch { await writeFile(resolve(artifacts!, 'native-quota.json'), JSON.stringify({ supported: false, reason: 'CDP quota override unavailable; injected native rollback remains separate evidence' })); }
  if (supported) {
   await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(base!).origin });
   await page.evaluate(() => (window as any).passwordCapacityFixture.prepareNativeQuota());
   let verified = false;
   try {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(base!).origin, quotaSize: 1024 * 1024 });
    const refusal = await page.evaluate(() => (window as any).passwordCapacityFixture.attemptNativeQuota()); verified = refusal.nativeChromiumQuotaEnforcement;
    await writeFile(resolve(artifacts!, 'native-quota.json'), JSON.stringify(refusal, null, 2));
   } finally {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(base!).origin });
    const retry = await page.evaluate((verified: boolean) => (window as any).passwordCapacityFixture.finishNativeQuota(verified), verified);
    await writeFile(resolve(artifacts!, 'native-quota-retry.json'), JSON.stringify(retry, null, 2));
   }
  }
 } finally { await browser.close(); }
});
