// Local-only rendered QA. Fictional API responses, a fresh browser context,
// no cookies copied from the user's browser, and all API mutations intercepted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
const origin = new URL(process.env.TT_TRANSFER_UI_ORIGIN || 'http://localhost:12280');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol === 'http:' && origin.pathname === '/');
const user = { id: 'archive-ui-owner', username: 'archive-fixture', displayName: 'Current importer', avatarUrl: null,
  accountKind: 'user', isAdmin: false, emailVerified: true, publicUploadsEnabled: false, privateUploadsEnabled: false };
const at = '2026-09-01T00:00:00.000Z';
const root = { id: 'archive-ui-fixture', thingtime: ['chat-archive'], crystal: { name: 'A preserved conversation', topic: 'Private history, never a live chat', chatType: 'dm', selfParticipantId: 'self', createdAt: at } };
const self = { id: 'self', targetId: root.id, thingtime: ['chat-archive-participant'], crystal: { username: 'previous-owner', displayName: 'Previous owner', nickname: '', joinedAt: at } };
const friend = { id: 'friend', targetId: root.id, thingtime: ['chat-archive-participant'], crystal: { username: 'historical-friend', displayName: 'Archived friend', nickname: '', joinedAt: at } };
const messages = Array.from({ length: 25 }, (_, index) => ({ id: `message-${String(index).padStart(2, '0')}`, targetId: root.id, thingtime: ['chat-archive-message'], crystal: {
  participantId: index % 2 ? 'friend' : 'self', text: index === 3 ? 'Long_word_'.repeat(70) : `Historical message ${index}\nPreserved line break 🥰`,
  createdAt: at, deleted: false, ...(index === 1 ? { replyToId: 'message-00', threadRootId: 'message-00' } : {})
} }));
const archive = { group: { root, self, participants: [self, friend], messages, reactions: [{ id: 'reaction', targetId: 'message-00', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'friend', emoji: '🥰', createdAt: at } }] }, updatedAt: at, attachmentTargets: [], emojiIds: [] };
const baseResponse = await fetch(new URL('/api/root-data', origin));
assert.equal(baseResponse.status, 200);
const rootData = await baseResponse.json();
rootData.user = user;
const output = await mkdtemp(join(tmpdir(), 'thingtime-archive-ui-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let mutations = 0;
try {
  const context = await browser.newContext();
  let failRead = false;
  await context.route('**/api/**', async (route: any) => {
    const request = route.request(); const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      mutations++; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture prevents writes' }) });
    }
    if (url.pathname === '/api/root-data') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rootData) });
    if (url.pathname === '/api/v1/auth/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user }) });
    if (url.pathname === '/api/v1/things' && url.searchParams.get('archive') === 'true') return route.fulfill({
      status: failRead ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failRead ? { ok: false, error: 'Temporary history failure' } : { ok: true, archive })
    });
    return route.continue();
  });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message));
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(new URL(`/thing/${root.id}?archive=true`, origin).href);
    await page.getByTestId('chat-archive-history').waitFor();
    const historyBounds = await page.getByTestId('chat-archive-history').boundingBox();
    assert.ok(historyBounds && historyBounds.x >= 0 && historyBounds.x + historyBounds.width <= width, `${name}: history escapes a clipped parent`);
    await page.locator('summary').filter({ hasText: 'participants' }).click();
    await page.getByText('Current importer · @archive-fixture', { exact: true }).waitFor();
    assert.equal(await page.getByText('Previous owner', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('textbox').filter({ has: page.locator('[placeholder*="message"]') }).count(), 0);
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += height - 120) {
      await page.evaluate((top: number) => window.scrollTo(0, top), y);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name}: horizontal overflow at ${y}`);
    }
    await page.getByText('End of archive · no messages will be sent').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${name}-bottom.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    const back = await page.getByRole('link', { name: '← Back to Things', exact: true }).boundingBox();
    assert.ok(back && back.y >= 54 && back.x >= 0 && back.x + back.width <= width, `${name}: Back link is covered or clipped`);
    await page.screenshot({ path: join(output, `${name}-top.png`) });
    await page.getByTestId('thing-transfer-menu').click();
    await page.getByRole('menuitem', { name: 'Download…', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.waitForFunction((el: HTMLElement) => Number(getComputedStyle(el).opacity) >= 0.99, await page.getByRole('dialog').elementHandle());
    assert.ok(await page.getByRole('dialog').evaluate((el: HTMLElement) => { const b = el.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; }), `${name}: dialog clipped`);
    await page.screenshot({ path: join(output, `${name}-download.png`) });
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  failRead = true;
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Temporary history failure' }).waitFor();
  assert.equal(await page.getByTestId('chat-archive-history').count(), 0);
  failRead = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByTestId('chat-archive-history').waitFor();
  await page.evaluate("import('/app/utils/rootIdentity.ts').then(({rootIdentity}) => rootIdentity.changed())");
  await page.getByTestId('chat-archive-history').waitFor({ state: 'hidden' });
  rootData.user = null;
  await page.reload();
  await page.getByText('Sign in to view your private archive.', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('chat-archive-history').count(), 0);
  assert.equal(mutations, 0, 'Read-only inspection must not write to any API');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, viewports: ['desktop', 'mobile'], fullScroll: true, downloadDialog: true, retry: true, identityClearing: true, mutations, output }));
} finally { await browser.close(); }
