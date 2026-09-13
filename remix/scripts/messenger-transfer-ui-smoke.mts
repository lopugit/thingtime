// Render the real Messenger drawer against fictional, isolated API responses.
// No credentials, clipboard access, or live chat mutations are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const origin = new URL(process.env.TT_TRANSFER_UI_ORIGIN || 'http://localhost:12280');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol === 'http:' && origin.pathname === '/');
const user = { id: 'transfer-ui-owner', username: 'transfer-fixture', displayName: 'Archive fixture', avatarUrl: null,
  accountKind: 'user', isAdmin: false, emailVerified: true, publicUploadsEnabled: false, privateUploadsEnabled: false,
  storage: { usedBytes: 0, allowanceBytes: 0, remainingBytes: 0, overageBytes: 0, status: 'ready', accountingVersion: 1, reconciledAt: null } };
const at = '2026-09-01T00:00:00.000Z';
const member = { userId: user.id, profile: user, role: 'owner', state: 'active', nickname: null,
  requestOrigin: null, muted: false, lastReadMessageId: null, lastReadAt: null, joinedAt: at };
const chat = { id: 'transfer-ui-chat', chatType: 'group', name: 'Archive transfer fixture', topic: 'No live recipients',
  communityId: null, sectionId: null, channelVisibility: null, createdBy: user.id, createdAt: at, updatedAt: at,
  myMember: member, members: [member], memberCount: 1, unreadCount: 0, lastMessage: null };
const response = await fetch(new URL('/api/root-data', origin));
assert.equal(response.status, 200);
const rootData = { ...await response.json(), user };
const output = await mkdtemp(join(tmpdir(), 'thingtime-messenger-transfer-ui-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mutations: string[] = [];
try {
  const context = await browser.newContext();
  await context.route('**/api/**', async (route: any) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const reply = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    if (!['GET', 'HEAD'].includes(req.method())) {
      mutations.push(path);
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Read-only UI fixture' }) });
    }
    if (path === '/api/root-data') return reply(rootData);
    if (path === '/api/v1/auth/me') return reply({ ok: true, user });
    if (path === '/api/v1/chats') return reply({ ok: true, chats: [chat], totalUnread: 0, requestsCount: 0 });
    if (path === '/api/v1/chats/get') return reply({ ok: true, chat, members: [member] });
    if (path === '/api/v1/chats/messages') return reply({ ok: true, messages: [], nextCursor: null });
    if (path === '/api/v1/chats/settings') return reply({ ok: true, readReceipts: false });
    if (path === '/api/v1/communities') return reply({ ok: true, communities: [] });
    if (path === '/api/v1/chats/updates') return reply({ ok: true, totalUnread: 0, requestsCount: 0, chats: [] });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('console', (message: any) => { if (message.type() === 'error') console.error(message.text()); });
  const errors: string[] = []; page.on('pageerror', (error: Error) => { errors.push(error.message); console.error(error.message); });
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(new URL(`/messages?chat=${chat.id}`, origin).href);
    await page.screenshot({ path: join(output, `${name}-initial.png`) });
    await page.getByTitle('Details & members', { exact: true }).click().catch(async error => {
      console.error(JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(0, 2500), errors }));
      await page.screenshot({ path: join(output, `${name}-failure.png`) });
      throw error;
    });
    const section = page.getByTestId('chat-archive-transfer');
    await section.waitFor();
    await page.waitForFunction((el: HTMLElement) => { const b = el.getBoundingClientRect(); return b.x >= 0 && b.right <= innerWidth; }, await section.elementHandle());
    const bounds = await section.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${name}: transfer section overflow`);
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: /Leave group/ }).scrollIntoViewIfNeeded();
    await section.scrollIntoViewIfNeeded();
    await section.getByTestId('thing-transfer-menu').click();
    await page.getByRole('menuitem', { name: 'Copy to clipboard', exact: true }).waitFor();
    const menu = page.getByRole('menu');
    await page.waitForFunction((el: HTMLElement) => getComputedStyle(el).opacity === '1', await menu.elementHandle());
    assert.equal(await page.getByRole('menuitem', { name: /^Cut/ }).count(), 0, 'Live chat must never offer Cut');
    await page.screenshot({ path: join(output, `${name}-menu.png`) });
    await page.getByRole('menuitem', { name: 'Download…', exact: true }).click();
    const format = page.getByRole('combobox', { name: 'Download format' });
    await format.waitFor();
    await format.selectOption('json');
    await format.selectOption('zip');
    const download = page.getByRole('button', { name: 'Download', exact: true });
    await download.scrollIntoViewIfNeeded();
    const buttonBounds = await download.boundingBox();
    assert.ok(buttonBounds && buttonBounds.x >= 0 && buttonBounds.y >= 0 && buttonBounds.x + buttonBounds.width <= width && buttonBounds.y + buttonBounds.height <= height);
    await page.screenshot({ path: join(output, `${name}-download.png`) });
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await section.waitFor();
    await section.getByTestId('thing-transfer-menu').click();
    await page.getByRole('menuitem', { name: 'Import into my Things…', exact: true }).click();
    await page.locator('input[type="file"]').waitFor();
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    const importDialog = page.getByRole('dialog', { name: 'Import Things', exact: true });
    await page.waitForFunction((el: HTMLElement) => getComputedStyle(el).opacity === '1', await importDialog.elementHandle());
    await page.screenshot({ path: join(output, `${name}-import.png`) });
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, [], 'Opening transfer controls must not mutate a live conversation');
  console.log(JSON.stringify({ ok: true, output, viewports: ['desktop', 'mobile'], noCut: true, downloadDialog: true, importDialog: true, mutations: 0 }));
} finally { await browser.close(); }
