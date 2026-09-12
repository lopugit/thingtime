// Explicitly opted-in, real dev-account UI acceptance. Uses a fresh headed
// Chrome session and overwrites the OS clipboard with disposable fixture data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readTransferClipboard } from '../app/utils/thingTransfer/browser';
import { decodeTransferArchive, encodeTransferArchive } from '../app/utils/thingTransfer/archive';
import { parseTransfer, type ThingTransfer } from '../app/utils/thingTransfer/format';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';

assert.equal(process.env.TT_TRANSFER_BROWSER_TEST, '1', 'Explicit browser fixture consent required');
assert.equal(process.platform, 'darwin', 'This acceptance test verifies the real macOS clipboard');
const origin = new URL(process.env.TT_TRANSFER_TEST_URL || '');
assert.ok(origin.protocol === 'https:' && !origin.port && !origin.username && !origin.password &&
  origin.pathname + origin.search + origin.hash === '/' && /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname), 'Use the approved PR preview, never production');
const username = process.env.TT_TRANSFER_TEST_USERNAME;
const cookie = process.env.TT_TRANSFER_TEST_COOKIE;
assert.ok(username && cookie, 'A disposable test session and expected username are required');
const request = async (path: string, method = 'GET', body?: unknown) => {
  const url = new URL(path, origin); assert.equal(url.origin, origin.origin);
  return fetch(url, { method, redirect: 'error', headers: { Cookie: cookie!, Origin: origin.origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
};
const json = async (path: string, method = 'GET', body?: unknown) => {
  const r = await request(path, method, body); assert.equal(r.status, 200, `${method} ${path.split('?')[0]} returned ${r.status}`); return r.json();
};
const capabilities = await json('/.well-known/thingtime-capabilities.json');
for (const [id, version] of Object.entries({ 'api.things': '1.16.1', 'api.things-import': '1.9.1', 'api.things-export': '1.10.0', 'api.things-bulk': '1.4.0' })) {
  assert.ok(capabilitySatisfies(capabilities.features?.[id]?.version, version), `Preview lacks ${id} ${version}; no fixture created`);
}
const me = await json('/api/v1/auth/me'); assert.equal(me.user?.username, username);
const binary = process.env.TT_TRANSFER_BROWSER_BINARY_TEST === '1';
if (binary) assert.equal(me.user.publicUploadsEnabled, true, 'Media acceptance needs existing upload approval');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(join(tmpdir(), 'thingtime-transfer-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const archives = new Set<string>(); const folders = new Set<string>();
const uploads = new Set<string>();
const pending = new Set<Promise<void>>(); const observerErrors: unknown[] = [];
const remember = (result: any) => {
  for (const id of result.roots || []) if (typeof id === 'string') archives.add(id);
  if (typeof result.ids?.folder === 'string') { folders.add(result.ids.folder); archives.delete(result.ids.folder); }
  if (typeof result.ids?.archive === 'string') archives.add(result.ids.archive);
};
let failure: unknown;
let page: any;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  await context.addCookies(cookie!.split(';').map(part => {
    const at = part.indexOf('='); return { name: part.slice(0, at).trim(), value: part.slice(at + 1), url: origin.origin, httpOnly: true, secure: true, sameSite: 'Lax' };
  }));
  // Capture cleanup anchors even if a UI assertion fails after the server writes.
  context.on('response', (response: any) => {
    const url = new URL(response.url());
    if (url.origin !== origin.origin || response.request().method() !== 'POST') return;
    if (!['/api/v1/things/import', '/api/v1/attachments/uploads'].includes(url.pathname)) return;
    const task = response.json().then((data: any) => {
      if (url.pathname === '/api/v1/things/import') remember(data);
      else if (typeof data.upload?.id === 'string') uploads.add(data.upload.id);
    }).catch((error: unknown) => { observerErrors.push(error); });
    pending.add(task); void task.finally(() => pending.delete(task));
  });
  const at = '2026-09-01T00:00:00.000Z'; const name = `Browser transfer fixture ${randomUUID()}`;
  const manifest: ThingTransfer = { format: 'thingtime.transfer', version: 1, roots: ['folder'], files: [], things: [
    { id: 'folder', thingtime: ['folder'], crystal: { name } },
    { id: 'archive', folderId: 'folder', thingtime: ['chat-archive'], crystal: { name, topic: 'Disposable browser acceptance', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
    { id: 'self', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-self', displayName: 'Original', nickname: '', joinedAt: at } },
    { id: 'friend', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-friend', displayName: 'Historical friend', nickname: '', joinedAt: at } },
    { id: 'message', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'Clipboard and downloaded history 🥰', createdAt: at, deleted: false } }
  ] };
  const importedResponse = await request('/api/v1/things/import', 'POST', { manifest });
  const first = await importedResponse.json(); remember(first); assert.equal(importedResponse.status, 200); assert.equal(first.ok, true);
  const id = first.ids.archive; assert.equal(typeof id, 'string');
  page = await context.newPage(); const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message));
  const open = async () => { await page.goto(new URL(`/thing/${id}?archive=true`, origin).href); await page.getByTestId('chat-archive-history').waitFor(); };
  const menu = async (name: string) => { await page.getByTestId('thing-transfer-menu').click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
  const readArchive = async () => (await json(`/api/v1/things?id=${id}&archive=true`)).archive;
  const importDialog = async () => {
    const response = page.waitForResponse((r: any) => new URL(r.url()).pathname === '/api/v1/things/import' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
    const r = await response; const data = await r.json(); remember(data); assert.equal(r.status(), 200); assert.equal(data.ok, true);
    assert.ok(data.roots.every((root: string) => root !== id)); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    return data;
  };
  const clipboard = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const bundle = await readTransferClipboard(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8', maxBuffer: 34 * 1024 * 1024 }));
        if (bundle.manifest.roots.length === 1 && bundle.manifest.roots[0] === id) return bundle;
      } catch { /* Never print unrelated clipboard content or parse errors. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('The OS clipboard did not receive this fixture transfer');
  };
  await open(); execFileSync('/usr/bin/pbcopy', { input: 'Thingtime transfer QA waiting for Copy' }); await menu('Copy to clipboard');
  const copied = await clipboard();
  assert.deepEqual(copied.manifest.roots, [id]); assert.equal(copied.manifest.things.length, 4);
  await page.getByRole('link', { name: '← Back to Things', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click(); await importDialog();
  for (const format of ['json', 'zip']) {
    await open(); await menu('Download…'); await page.getByLabel('Download format').selectOption(format);
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await downloadEvent; const path = join(output, `fixture.${format}`); await download.saveAs(path);
    const bytes = await readFile(path); const transfer = format === 'zip' ? (await decodeTransferArchive(bytes)).manifest : parseTransfer(bytes.toString('utf8'));
    assert.deepEqual(transfer.roots, [id]); assert.equal(transfer.things.length, 4);
    await menu('Import into my Things…');
    await page.getByLabel('Thingtime transfer file').setInputFiles(path); await importDialog();
  }
  await open(); execFileSync('/usr/bin/pbcopy', { input: 'Thingtime transfer QA waiting for Cut' }); await menu('Cut to clipboard');
  const cut = await clipboard();
  assert.deepEqual(cut.manifest.roots, [id]); assert.equal((await readArchive()).group.root.folderId, first.ids.folder);
  await page.getByRole('link', { name: '← Back to Things', exact: true }).click();
  const move = page.waitForResponse((r: any) => new URL(r.url()).pathname === '/api/v1/things/bulk' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Paste', exact: true }).click(); assert.equal((await move).status(), 200);
  assert.equal((await readArchive()).group.root.folderId ?? null, null); assert.equal(archives.size, 4, 'Cut must move, not import another archive');
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await open();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByText('End of archive · no messages will be sent').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${name}.png`) });
  }
  if (binary) {
    // Two distinct same-name, same-size files exercise the real browser's
    // upload dedupe boundary; both must survive with separate fresh bindings.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const mediaManifest: ThingTransfer = { ...manifest, roots: ['archive'],
      things: manifest.things.filter(thing => thing.id !== 'folder').map(thing => {
        const { folderId: _folder, ...row } = thing as typeof thing & { folderId?: string };
        return row;
      }), files: [0, 1].map(index => ({ id: `image-${index}`, targetId: 'message', path: `files/${String(index).padStart(6, '0')}`,
        name: 'same-name.png', mime: 'image/png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
        title: `Historical image ${index}`, description: 'Exact\nimage annotation', filenamePreview: `retained-${index}.png` })) };
    const zip = await encodeTransferArchive({ manifest: mediaManifest, files: new Map(mediaManifest.files.map(file => [file.id, png])) });
    const importMediaFile = async (file: string | { name: string; mimeType: string; buffer: Buffer }) => {
      await menu('Import into my Things…'); await page.getByLabel('Thingtime transfer file').setInputFiles(file);
      await page.getByRole('button', { name: 'Upload 2 files', exact: true }).click();
      // No automatic Retry upload clicks or account/origin changes on refusal.
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
        button.textContent === 'Import private copies' && !button.disabled) || !!document.querySelector('[role="dialog"] [role="alert"]'), null, { timeout: 60_000 });
      assert.equal(await page.getByRole('button', { name: 'Import private copies', exact: true }).isEnabled(), true,
        'Browser upload did not become ready; inspect the fixture screenshot, no limits bypassed');
      return importDialog();
    };
    const exportMedia = async (archiveId: string) => {
      await page.goto(new URL(`/thing/${archiveId}?archive=true`, origin).href); await page.getByTestId('chat-archive-history').waitFor();
      await menu('Download…'); await page.getByLabel('Download format').selectOption('zip');
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
      const download = await event; const path = join(output, `media-${archiveId}.zip`); await download.saveAs(path);
      const bundle = await decodeTransferArchive(await readFile(path));
      assert.equal(bundle.manifest.files.length, 2); assert.equal(bundle.files.size, 2);
      for (const file of bundle.manifest.files) {
        assert.deepEqual(Buffer.from(bundle.files.get(file.id)!), png);
        assert.equal(file.description, 'Exact\nimage annotation');
      }
      assert.deepEqual(bundle.manifest.files.map(file => file.title).sort(), ['Historical image 0', 'Historical image 1']);
      assert.deepEqual(bundle.manifest.files.map(file => file.filenamePreview).sort(), ['retained-0.png', 'retained-1.png']);
      return { path, bundle };
    };
    await page.setViewportSize({ width: 1280, height: 900 }); await open();
    const source = await importMediaFile({ name: 'media-fixture.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
    const sourceId = source.ids.archive; const downloaded = await exportMedia(sourceId);
    const copied = await importMediaFile(downloaded.path); const copyId = copied.ids[sourceId];
    assert.equal(typeof copyId, 'string'); assert.notEqual(copyId, sourceId);
    const sourceFiles = downloaded.bundle.manifest.files.map(file => file.id);
    await json('/api/v1/things', 'DELETE', { id: sourceId });
    assert.equal((await request(`/api/v1/things?id=${sourceId}&archive=true`)).status, 404); archives.delete(sourceId);
    const independent = await exportMedia(copyId);
    assert.ok(independent.bundle.manifest.files.every(file => !sourceFiles.includes(file.id)), 'Copied files need fresh IDs');
    for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.getByText('End of archive · no messages will be sent').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: join(output, `media-${name}.png`) });
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(observerErrors, []);
} catch (error) {
  failure = error;
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.log(JSON.stringify({ failureScreenshot: join(output, 'failure.png') }));
}
finally {
  await Promise.all([...pending]); await browser.close();
  const cleanup: { id: string; phase: string; status?: number }[] = [];
  for (const [kind, ids] of [['archive', archives], ['folder', folders]] as const) for (const id of ids) {
    let phase = 'delete';
    try {
      const r = await request('/api/v1/things', 'DELETE', { id });
      if (![200, 404].includes(r.status)) cleanup.push({ id, phase, status: r.status });
      phase = 'verify';
      const check = await request(`/api/v1/things?id=${encodeURIComponent(id)}${kind === 'archive' ? '&archive=true' : ''}`);
      if (check.status !== 404) cleanup.push({ id, phase, status: check.status });
    } catch { cleanup.push({ id, phase: `${phase}-network` }); }
  }
  for (const id of uploads) {
    try {
      await request('/api/v1/attachments/uploads/abort', 'POST', { uploadId: id });
      await request('/api/v1/attachments/delete', 'POST', { id });
      assert.equal((await request(`/api/v1/attachments/content?id=${encodeURIComponent(id)}&cache=bytes`)).status, 404);
    } catch { cleanup.push({ id, phase: 'upload-cleanup' }); }
  }
  if (cleanup.length) {
    console.log(JSON.stringify({ cleanup, output }));
    throw new AggregateError([...(failure ? [failure] : []), new Error('Browser fixture cleanup incomplete')], 'Browser acceptance or cleanup failed');
  }
}
if (failure) throw failure;
console.log(JSON.stringify({ ok: true, osClipboardCopyCut: true, pasteCopyAndMove: true, jsonZipDownloadImport: true,
  browserBinaryRoundTrip: binary, cleanup: true, output }));
