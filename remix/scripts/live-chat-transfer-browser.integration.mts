// Opt-in acceptance against the approved self-only dev chat, never real recipients.
// Uses a fresh headed Chrome session and writes fixture data to the OS clipboard.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTransferClipboard } from '../app/utils/thingTransfer/browser';
import { decodeTransferArchive } from '../app/utils/thingTransfer/archive';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';

assert.equal(process.env.TT_TRANSFER_LIVE_CHAT_BROWSER_TEST, '1');
assert.equal(process.platform, 'darwin');
const origin = new URL(process.env.TT_TRANSFER_TEST_URL || '');
assert.ok(origin.protocol === 'https:' && !origin.port && !origin.username && !origin.password &&
  origin.pathname + origin.search + origin.hash === '/' && /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname));
const username = process.env.TT_TRANSFER_TEST_USERNAME, cookie = process.env.TT_TRANSFER_TEST_COOKIE;
assert.ok(username && cookie);
const request = async (path: string, method = 'GET', body?: unknown) => {
  const url = new URL(path, origin); assert.equal(url.origin, origin.origin);
  const response = await fetch(url, { method, redirect: 'error', headers: { Cookie: cookie!, Origin: origin.origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35_000) });
  return { status: response.status, data: await response.json() };
};
const capabilities = await request('/.well-known/thingtime-capabilities.json');
assert.equal(capabilities.status, 200);
assert.equal(capabilities.data.origin, origin.origin);
for (const [id, version] of Object.entries({ 'api.things-export': '1.11.1', 'api.things-import': '1.9.1', 'api.things': '1.14.0',
  'api.chats': '1.0.0', 'api.chats-get': '1.0.0', 'api.chats-messages': '1.0.1' }))
  assert.ok(capabilitySatisfies(capabilities.data.features?.[id]?.version, version), `Missing ${id}`);
const me = await request('/api/v1/auth/me'); assert.equal(me.status, 200); assert.equal(me.data.user?.username, username);
assert.equal(me.data.user.accountKind, 'user');
const listed = await request('/api/v1/chats'); assert.equal(listed.status, 200);
const candidates = listed.data.chats.filter((chat: any) => chat.name === 'Transfer acceptance — self-only');
assert.equal(candidates.length, 1, 'Run the canonical live history fixture first; never create extra chats here');
const chatId = candidates[0].id;
assert.match(chatId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const detail = await request(`/api/v1/chats/get?id=${encodeURIComponent(chatId)}`);
assert.equal(detail.status, 200);
assert.deepEqual(detail.data.members.map((member: any) => member.userId), [me.data.user.id]);
assert.equal(detail.data.myMember.state, 'active');
const before = await request(`/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}&limit=100`);
assert.equal(before.status, 200); assert.equal(before.data.nextCursor, null);
const output = await mkdtemp(join(tmpdir(), 'thingtime-live-chat-browser-'));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const importedIds = new Set<string>();
const pending = new Set<Promise<void>>();
const observerErrors: unknown[] = [];
let failure: unknown;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  await context.addCookies(cookie.split(';').map(part => { const at = part.indexOf('=');
    return { name: part.slice(0, at).trim(), value: part.slice(at + 1), url: origin.origin, httpOnly: true, secure: true, sameSite: 'Lax' }; }));
  context.on('response', (response: any) => {
    if (new URL(response.url()).origin !== origin.origin || new URL(response.url()).pathname !== '/api/v1/things/import' || response.request().method() !== 'POST') return;
    const task = response.json().then((data: any) => {
      for (const id of data.roots || []) if (typeof id === 'string' && id !== chatId) importedIds.add(id);
    }).catch((error: unknown) => observerErrors.push(error));
    pending.add(task); void task.finally(() => pending.delete(task));
  });
  const page = await context.newPage();
  await page.goto(new URL(`/messages?chat=${chatId}`, origin).href);
  await page.getByTitle('Details & members', { exact: true }).click();
  const section = page.getByTestId('chat-archive-transfer'); await section.waitFor();
  const menu = async (label: string) => {
    await section.getByTestId('thing-transfer-menu').click();
    assert.equal(await page.getByRole('menuitem', { name: /^Cut/ }).count(), 0);
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  execFileSync('/usr/bin/pbcopy', { input: 'Thingtime self-only chat transfer acceptance' });
  await menu('Copy to clipboard');
  let copied: Awaited<ReturnType<typeof readTransferClipboard>> | undefined;
  for (let attempt = 0; attempt < 30 && !copied; attempt++) {
    try {
      const candidate = await readTransferClipboard(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8', maxBuffer: 34 * 1024 * 1024 }));
      if (candidate.manifest.roots.length === 1 && candidate.manifest.roots[0] === chatId) copied = candidate;
    } catch { /* Never print clipboard contents or parser diagnostics. */ }
    if (!copied) await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(copied, 'Real clipboard did not receive this chat archive');
  assert.equal(copied.manifest.things.find(row => row.id === chatId)?.thingtime[0], 'chat-archive');
  await menu('Download…');
  await page.getByLabel('Download format').selectOption('zip');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await event; const path = join(output, 'self-only-chat.zip'); await download.saveAs(path);
  const bundle = await decodeTransferArchive(await readFile(path));
  assert.deepEqual(bundle.manifest.things, copied.manifest.things);
  assert.equal(bundle.manifest.files.length, 0, 'This phase does not prove live-chat media export');
  await menu('Import into my Things…');
  await page.getByLabel('Thingtime transfer file').setInputFiles(path);
  const imported = page.waitForResponse((r: any) => new URL(r.url()).pathname === '/api/v1/things/import' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  const result = await imported; const payload = await result.json();
  for (const id of payload.roots || []) if (typeof id === 'string' && id !== chatId) importedIds.add(id);
  assert.equal(result.status(), 200); assert.equal(payload.ok, true);
  const id = payload.ids?.[chatId]; assert.ok(typeof id === 'string' && id !== chatId);
  importedIds.add(id);
  await page.goto(new URL(`/thing/${id}?archive=true`, origin).href);
  await page.getByTestId('chat-archive-history').waitFor();
  await page.getByText('End of archive · no messages will be sent').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'imported-history.png') });
  const archive = await request(`/api/v1/things?id=${encodeURIComponent(id)}&archive=true`); assert.equal(archive.status, 200);
  for (const source of bundle.manifest.things.filter(row => row.thingtime[0] === 'chat-archive-message')) {
    const target = archive.data.archive.group.messages.find((row: any) => row.id === payload.ids[source.id]);
    assert.ok(target); assert.equal(target.crystal.text, source.crystal.text);
  }
  const after = await request(`/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}&limit=100`);
  assert.equal(after.status, 200); assert.deepEqual(after.data.messages, before.data.messages);
  console.log(JSON.stringify({ liveChatClipboard: true, zipDownloadFilePickerImport: true, historyPreserved: true, sourceMessagesUnchanged: true, output }));
} catch (error) { failure = error; }
finally {
  await Promise.all([...pending]);
  await browser.close();
  const cleanupErrors: unknown[] = [];
  for (const id of importedIds) {
    try {
      const path = `/api/v1/things?id=${encodeURIComponent(id)}&archive=true`;
      const read = await request(path); assert.equal(read.status, 200);
      assert.equal((await request('/api/v1/things', 'DELETE', { id, expectedUpdatedAt: read.data.archive.updatedAt })).status, 200);
      assert.equal((await request(path)).status, 404);
    } catch (error) { cleanupErrors.push(error); }
  }
  if (failure || cleanupErrors.length || observerErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors, ...observerErrors], 'Live browser acceptance or cleanup failed');
  console.log(JSON.stringify({ importedArchiveCleanup: true, retainedSelfOnlyFixture: chatId }));
}
