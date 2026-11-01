#!/usr/bin/env node
// Built application, real API, disposable replica set and fresh browser context.
// Never accepts an external origin or inherits application/database credentials.
// Build first: pnpm run build:client && pnpm run sync:nitro-template &&
// NITRO_PRESET=node-server pnpm run build:server
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-emoji-picker-'));
const out = process.env.EMOJI_EVIDENCE_DIR
  ? resolve(process.env.EMOJI_EVIDENCE_DIR)
  : await mkdtemp(join(tmpdir(), 'tt-emoji-picker-evidence-'));
const ports = { api: 19651, db: 19652 };
const origin = `http://127.0.0.1:${ports.api}`;
const replicaSet = 'emoji_picker_acceptance';
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const geometryIssues = [];
const longToken = '🧑🏽‍💻'.repeat(200);
const visualToken = '🥹😍🤣🤩😱💖💕💓💗🙌🏽💁🏽‍♀️🤷🏽‍♀️✨🎉';
const recentTokens = ['🦊', '🦋', '🐬', '🪷', '🌈', '🪐', '🧩', '🎨', '🚀'];
const defaultTokens = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const env = {
  PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production',
  HOST: '127.0.0.1', PORT: String(ports.api), THINGTIME_DATA_ENV: 'development',
  MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=${replicaSet}`,
  JWT_SECRET: randomBytes(48).toString('hex')
};
let browser;
let page;
let server;
const sourceRoot = resolve(cwd, '..');
const sourceFiles = [...new Set([
  ...execFileSync('git', ['diff', 'HEAD', '--name-only', '--', 'remix'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'remix'], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n')
])].filter(path => /\.(?:ts|tsx|mjs)$/.test(path)).sort();
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path,
  createHash('sha256').update(await readFile(join(sourceRoot, path))).digest('hex')])));

function start(executable, args) {
  const child = spawn(executable, args, { cwd, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output = (output + data).slice(-30000); });
  child.stderr.on('data', data => { output = (output + data).slice(-30000); });
  children.push(child);
  return { child, output: () => output };
}

async function stop(child) {
  if (!child.pid) return;
  const signal = value => { try { process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  const exited = child.exitCode !== null || child.signalCode !== null;
  const done = exited ? Promise.resolve() : once(child, 'exit');
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 3000);
  await done;
  clearTimeout(timer);
  signal('SIGKILL');
}

async function ready() {
  for (let n = 0; n < 150; n++) {
    assert.equal(server.child.exitCode, null, 'Built test server exited before readiness');
    try {
      if ((await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await delay(200);
  }
  throw Error('Built test server did not become ready within 30 seconds');
}

async function note(message) {
  checks.push(message);
  console.log(message);
  await writeFile(join(out, 'progress.json'), JSON.stringify({ origin, checks }, null, 2));
}

try {
  await mkdir(out, { recursive: true });
  await Promise.all(['result.json', 'failure.json'].map(name => rm(join(out, name), { force: true })));
  for (const port of Object.values(ports)) {
    const listener = createServer();
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => listener.close(resolve));
  }
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_EXECUTABLE || '/opt/homebrew/bin/mongod', [
    '--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1',
    '--replSet', replicaSet, '--nounixsocket'
  ]);
  // Administrative replica setup only. Application fixtures use HTTP below.
  const client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
  try {
    for (let n = 0; ; n++) {
      try { await client.connect(); break; } catch (error) { if (n > 20) throw error; await delay(300); }
    }
    await client.db('admin').command({ replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
    for (let n = 0; ; n++) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      assert(n < 100, 'Disposable replica set did not become primary');
      await delay(200);
    }
  } finally { await client.close(); }
  server = start(process.execPath, ['.output/server/index.mjs']);
  await ready();
  const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
  assert.equal(manifest.origin, origin);
  const version = manifest.features['api.things-react']?.version?.split('.').map(Number);
  assert(version?.[0] === 1 && (version[1] > 2 || version[1] === 2 && version[2] >= 1), 'Built server must expose api.things-react >=1.2.1 <2');
  for (const [feature, minimum] of Object.entries({ 'api.chats': '1.1.0', 'api.chats-messages': '1.2.1', 'api.chats-react': '1.0.3' })) {
    const actual = manifest.features[feature]?.version?.split('.').map(Number);
    const expected = minimum.split('.').map(Number);
    assert(actual?.[0] === expected[0] && (actual[1] > expected[1] || actual[1] === expected[1] && actual[2] >= expected[2]),
      `Built server must expose compatible ${feature} >=${minimum}`);
  }
  const health = await (await fetch(origin + '/api/v1/health/mongodb')).json();
  assert.equal(health.connected, true);
  assert.equal(health.custom, false);
  assert.equal(health.dbName, 'thingtime');
  assert.equal(health.replicaSet, replicaSet);
  await note('Verified selected loopback origin, capability and disposable database identity before writes');

  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.EMOJI_BROWSER_EXECUTABLE ? { executablePath: process.env.EMOJI_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const mutationOrigins = new Set();
  const pageErrors = [];
  const scriptResponses = [];
  const runtimeExceptions = [];
  const touchSession = await context.newCDPSession(page);
  await touchSession.send('Runtime.enable');
  touchSession.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const url = exceptionDetails.url || exceptionDetails.stackTrace?.callFrames?.[0]?.url;
    runtimeExceptions.push({ path: url ? new URL(url).pathname : null, line: exceptionDetails.lineNumber,
      description: exceptionDetails.exception?.description || exceptionDetails.text });
  });
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.request().resourceType() === 'script' || /\.m?js$/.test(path)) {
      scriptResponses.push({ path, status: response.status(), contentType: response.headers()['content-type'] || null });
    }
  });
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutationOrigins.add(new URL(request.url()).origin);
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const api = async (path, body, expected = 200) => {
    const response = await page.evaluate(async ({ path, body }) => {
      const result = await fetch(path, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(60000) });
      return { status: result.status, data: await result.json() };
    }, { path, body });
    assert.equal(response.status, expected, `${path}: expected HTTP ${expected}, received ${response.status}`);
    return response.data;
  };
  // The disposable fixture password exists only in memory. Session cookies are
  // created by this origin directly in its own fresh browser context.
  const user = await api('/api/v1/auth/register', {
    username: 'emoji-acceptance', email: 'emoji-acceptance@example.invalid',
    password: randomBytes(24).toString('hex'), displayName: 'Emoji acceptance'
  });
  assert(user.user?.id);
  const post = (await api('/api/v1/things', {
    thingtime: ['post'], crystal: { type: 'text', text: 'Emoji picker acceptance post',
      renderComponent: { render: { tag: 'p', children: ['{text}'] } } }, acl: ['tt:all']
  })).post;
  assert(post?.id);
  const comment = (await api('/api/v1/things/comment', { id: post.id, text: 'Emoji picker acceptance comment' })).comment;
  assert(comment?.id);
  for (const target of [post, comment]) {
    const added = await api('/api/v1/things/react', { id: target.id, emoji: longToken });
    assert.equal(added.reactionCounts[longToken], 1);
    assert(added.viewerReactions.includes(longToken));
    const saved = (await api('/api/v1/things?id=' + target.id)).post;
    assert.equal(saved.reactionCounts[longToken], 1);
    assert(saved.viewerReactions.includes(longToken));
    await api('/api/v1/things/react', { id: target.id, emoji: longToken });
  }
  await api('/api/v1/things/react', { id: post.id, emoji: 'not an emoji' }, 400);
  for (const token of recentTokens) await api('/api/v1/things/react', { id: post.id, emoji: token });
  await note('Real post and comment reactions preserve a 200-emoji token through mutation and exact-ID readback; invalid text is refused');

  const input = () => page.getByRole('textbox', { name: 'Search or type emoji', exact: true });
  const more = () => page.getByRole('button', { name: 'Choose a custom emoji', exact: true });
  const react = () => page.getByRole('button', { name: 'React', exact: true });
  const openQuick = async index => {
    const trigger = react().nth(index);
    await trigger.scrollIntoViewIfNeeded();
    if (page.viewportSize().width <= 390) {
      const bounds = await trigger.boundingBox();
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
      try {
        // Comment taps intentionally quick-react; touch-and-hold opens its picker.
        if (index === 1) await more().waitFor();
      } finally { await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    } else if (index === 1) {
      // Re-enter after keyboard dismissal even if the pointer never moved.
      await page.mouse.move(4, page.viewportSize().height / 2);
      await trigger.hover();
    }
    else await trigger.click();
    await more().waitFor();
  };
  const openPicker = async index => { await openQuick(index); await more().click(); await input().waitFor(); };
  const dismiss = async () => { await input().focus(); await page.keyboard.press('Escape'); await input().waitFor({ state: 'hidden' }); };
  const clickAway = async () => { await page.mouse.click(4, page.viewportSize().height / 2); };
  const assertGeometry = async label => {
    // Chakra/Framer exit shells remain measurable while their contents unmount.
    // Settle the short popup transition before testing its final geometry.
    await page.waitForTimeout(250);
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(node => {
        const style = getComputedStyle(node);
        return node.getBoundingClientRect().height && !node.closest('[aria-hidden="true"]') && style.visibility !== 'hidden'
          && Number(style.opacity) > 0 && style.pointerEvents !== 'none';
      }).map(node => {
        const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
      }) }));
    await writeFile(join(out, label + '-geometry.json'), JSON.stringify(geometry, null, 2));
    assert(geometry.scroll <= geometry.viewport + 1, `${label}: page horizontal overflow`);
    for (const box of geometry.dialogs) {
      assert(box.x >= -1 && box.x + box.width <= geometry.viewport + 1, `${label}: popup escapes viewport`);
      assert(box.scrollWidth <= box.clientWidth + 1, `${label}: popup horizontal overflow`);
    }
    const summaries = await react().evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      const card = node.closest('article')?.getBoundingClientRect();
      return { x: r.x, width: r.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        card: card ? { x: card.x, width: card.width } : null,
        spans: [...node.querySelectorAll('span')].map(span => { const box = span.getBoundingClientRect(); return { x: box.x, width: box.width }; }) };
    }));
    await writeFile(join(out, label + '-summaries.json'), JSON.stringify(summaries, null, 2));
    for (const summary of summaries) {
      assert(summary.x >= -1 && summary.x + summary.width <= geometry.viewport + 1, `${label}: reaction summary escapes viewport`);
      assert(summary.scrollWidth <= summary.clientWidth + 1, `${label}: reaction summary clips its token`);
      if (summary.card) assert(summary.x >= summary.card.x - 1 && summary.x + summary.width <= summary.card.x + summary.card.width + 1,
        `${label}: reaction summary escapes its card`);
      for (const span of summary.spans) assert(span.x >= summary.x - 1 && span.x + span.width <= summary.x + summary.width + 1,
        `${label}: reaction text escapes its button`);
    }
    const add = page.getByRole('button', { name: 'Add emoji reaction', exact: true });
    if (await add.isVisible()) {
      const bounds = await add.boundingBox();
      assert(bounds.y >= -1 && bounds.y + bounds.height <= geometry.height + 1, `${label}: Add is obscured by viewport edge`);
    }
    const actionable = await add.isVisible() ? add : more();
    if (await actionable.isVisible()) {
      assert(await actionable.evaluate(node => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === node || node.contains(hit);
      }), `${label}: primary picker control is covered`);
    }
    await page.screenshot({ path: join(out, label + '.png'), fullPage: true, animations: 'disabled' });
  };
  const checkRecents = async (index, label) => {
    await openQuick(index);
    const group = page.getByRole('group', { name: 'Recent reactions', exact: true });
    await group.waitFor();
    const expected = [...new Set((await api('/api/v1/things/reactions-recent')).recentReactions)]
      .filter(token => !defaultTokens.includes(token)).slice(0, 9);
    assert.deepEqual(await group.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label').slice(6))), expected);
    assert.equal(await group.getByRole('button').count(), 9);
    await assertGeometry(label);
    await react().nth(index).focus();
    await page.keyboard.press('Escape');
    await group.waitFor({ state: 'hidden' });
    await openQuick(index);
    await clickAway();
    await group.waitFor({ state: 'hidden' });
  };

  await page.goto(origin + '/post/' + post.id, { waitUntil: 'domcontentloaded' });
  await page.getByText('Emoji picker acceptance comment', { exact: true }).waitFor({ timeout: 60000 });
  await react().first().waitFor();
  await checkRecents(0, 'desktop-quick-recents');
  await openPicker(0);
  const longRecent = page.getByRole('button', { name: `React ${longToken}`, exact: true });
  await longRecent.waitFor();
  const longRecentGeometry = await longRecent.evaluate(node => ({ text: node.textContent,
    scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  await writeFile(join(out, 'long-recent-geometry.json'), JSON.stringify(longRecentGeometry, null, 2));
  assert.equal(longRecentGeometry.text, longToken);
  assert(longRecentGeometry.scrollWidth <= longRecentGeometry.clientWidth + 1, 'Full picker long recent must wrap without horizontal clipping');
  if (longRecentGeometry.scrollHeight > longRecentGeometry.clientHeight + 1) geometryIssues.push('Full picker long recent must retain its full height');
  await assertGeometry('desktop-full-recents-long-token');
  await input().fill(visualToken);
  await page.getByRole('button', { name: 'Add emoji reaction', exact: true }).waitFor();
  await assertGeometry('desktop-long-combination');
  await clickAway();
  await input().waitFor({ state: 'hidden' });
  await openPicker(0);
  assert.equal(await input().inputValue(), visualToken, 'Post draft survives click-away/reopen');
  await dismiss();
  await openPicker(1);
  assert.equal(await input().inputValue(), '', 'Comment does not inherit post draft');
  await input().fill('🪷🦋✨');
  await dismiss();
  await openPicker(0);
  assert.equal(await input().inputValue(), visualToken, 'Other target draft does not overwrite post draft');
  const [reaction] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things/react' && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Add emoji reaction', exact: true }).click()
  ]);
  assert.equal(reaction.status(), 200);
  assert((await reaction.json()).viewerReactions.includes(visualToken));
  assert((await api('/api/v1/things?id=' + post.id)).post.viewerReactions.includes(visualToken));
  assert.equal(await input().inputValue(), '', 'Successful Add clears only the committed draft');
  await dismiss();
  await openPicker(1);
  assert.equal(await input().inputValue(), '🪷🦋✨', 'Comment draft remains independent after post commit');
  const [commentReaction] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things/react' && response.request().method() === 'POST'),
    input().press('Enter')
  ]);
  assert.equal(commentReaction.status(), 200);
  assert((await api('/api/v1/things?id=' + comment.id)).post.viewerReactions.includes('🪷🦋✨'));
  await dismiss();
  await note('Desktop post/comment drafts survive dismissal independently; Add and Enter commit via real browser transport and exact-ID API readback');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Emoji picker acceptance comment', { exact: true }).waitFor({ timeout: 60000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await checkRecents(0, `${width}-post-quick-recents-reload`);
    await checkRecents(1, `${width}-comment-quick-recents-reload`);
    await openPicker(0);
    await input().fill(visualToken);
    await assertGeometry(`${width}-full-picker`);
    await dismiss();
    await openPicker(0);
    assert.equal(await input().inputValue(), visualToken);
    await dismiss();
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
        window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 30));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await assertGeometry(`${width}-bottom`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.setViewportSize({ width: 390, height: 450 });
  await openPicker(0);
  await assertGeometry('390-short-mobile-keyboard-viewport');
  await dismiss();
  await note('Desktop/mobile full and quick pickers, nine server-backed recents, reload and full-page scroll geometry passed');

  // Messenger consumes the same Unicode picker and account recents. Exercise
  // both actual presentations so shared width/token changes cannot regress it.
  const chat = (await api('/api/v1/chats', { chatType: 'group', name: 'Emoji acceptance chat', memberIds: [] })).chat;
  assert(chat?.id);
  const chatMessageText = 'Emoji chat acceptance message';
  const message = (await api('/api/v1/chats/messages', { chatId: chat.id, text: chatMessageText, requestId: randomUUID() })).message;
  assert(message?.id);
  await api('/api/v1/chats/messages', { chatId: chat.id, text: 'Message after long reaction', requestId: randomUUID() });
  await api('/api/v1/chats/react', { messageId: message.id, emoji: longToken });
  const messageTruth = async () => (await api('/api/v1/chats/messages?chatId=' + chat.id)).messages.find(row => row.id === message.id);
  assert.equal((await messageTruth()).reactionCounts[longToken], 1);
  await api('/api/v1/chats/react', { messageId: message.id, emoji: longToken });
  const openChat = async () => {
    await page.goto(origin + '/messages?chat=' + chat.id, { waitUntil: 'domcontentloaded' });
    await page.getByText(chatMessageText, { exact: true }).waitFor({ timeout: 60000 });
  };
  const chatChip = () => page.getByRole('button').filter({ hasText: visualToken });
  const openChatPicker = async index => {
    await page.getByText(index === 0 ? chatMessageText : 'Message after long reaction', { exact: true }).last().hover();
    await page.getByRole('button', { name: 'React to message', exact: true }).nth(index).click();
    await input().waitFor();
  };
  for (const mode of ['Chats', 'Spaces']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openChat();
    await page.getByRole('button', { name: new RegExp(mode + '$') }).click();
    // Spaces may clear a free-floating group's selection on mode switch; its
    // supported deep link reopens it using the now-persisted presentation.
    await openChat();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await openChatPicker(0);
      await input().fill(visualToken);
      if (mode === 'Chats' && width === 1440) {
        await clickAway();
        await input().waitFor({ state: 'hidden' });
        await openChatPicker(0);
        assert.equal(await input().inputValue(), visualToken, 'Messenger draft survives click-away/reopen');
        await dismiss();
        await openChatPicker(1);
        assert.equal(await input().inputValue(), '', 'Second message does not inherit the first message draft');
        await dismiss();
        await openChatPicker(0);
        assert.equal(await input().inputValue(), visualToken, 'Messenger draft stays scoped to its own message');
      }
      await assertGeometry(`${mode.toLowerCase()}-${width}-picker`);
      const hasReaction = (await messageTruth()).viewerReactions.includes(visualToken);
      if (!hasReaction) {
        const [sent] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/chats/react' && response.request().method() === 'POST'),
          page.getByRole('button', { name: 'Add emoji reaction', exact: true }).click()
        ]);
        assert.equal(sent.status(), 200);
        assert((await messageTruth()).viewerReactions.includes(visualToken));
        await input().waitFor({ state: 'hidden' });
      } else await dismiss();
      await chatChip().waitFor();
      const chip = await chatChip().evaluate(node => {
        const r = node.getBoundingClientRect();
        return { text: node.textContent, x: r.x, y: r.y, width: r.width, height: r.height,
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
      });
      assert(chip.text.includes(visualToken), 'Chat chip preserves complete token text');
      assert(chip.x >= -1 && chip.x + chip.width <= width + 1, 'Chat chip stays in the viewport');
      assert(chip.scrollWidth <= chip.clientWidth + 1 && chip.scrollHeight <= chip.clientHeight + 1, 'Chat chip wraps without clipping');
      const nextMessage = await page.getByText('Message after long reaction', { exact: true }).last().boundingBox();
      assert(chip.y + chip.height <= nextMessage.y + 1, 'Long reaction does not overlap the following message');
      await assertGeometry(`${mode.toLowerCase()}-${width}-reaction`);
    }
  }
  const composer = page.getByPlaceholder('Message Emoji acceptance chat', { exact: true });
  const insertEmoji = page.getByRole('button', { name: 'Insert emoji', exact: true });
  await insertEmoji.click();
  await input().waitFor();
  assert.equal(await input().inputValue(), '', 'Composer does not inherit a message reaction draft');
  await input().fill(visualToken);
  await clickAway();
  await input().waitFor({ state: 'hidden' });
  await insertEmoji.click();
  await input().waitFor();
  assert.equal(await input().inputValue(), visualToken, 'Composer emoji draft survives click-away/reopen');
  await assertGeometry('spaces-390-composer-picker');
  await page.getByRole('button', { name: 'Add emoji reaction', exact: true }).click();
  assert.equal(await composer.inputValue(), visualToken, 'Add inserts the complete combination into the real composer');
  await clickAway();
  await input().waitFor({ state: 'hidden' });
  await assertGeometry('spaces-390-composer-inserted');
  await composer.fill('');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await chatChip().waitFor({ timeout: 60000 });
  assert((await messageTruth()).viewerReactions.includes(visualToken));
  await note('Real Messenger long-token API/readback, scoped picker drafts, composer insertion and wrapped chips pass in Chats and Spaces at desktop/mobile widths and reload');
  await writeFile(join(out, 'browser-diagnostics.json'), JSON.stringify({ pageErrors, runtimeExceptions, scriptResponses }, null, 2));
  // Vercel injects this hosted analytics script. The unchanged local node-server
  // SPA fallback serves HTML for that absent hosting-only path. Record that
  // precise limitation; never exempt application code or unattributed errors.
  const analyticsErrors = runtimeExceptions.filter(error => error.path === '/_vercel/insights/script.js'
    && error.description.includes("Unexpected token '<'"));
  assert.deepEqual(runtimeExceptions.filter(error => !analyticsErrors.includes(error)), [], 'No application runtime exceptions');
  assert.deepEqual(pageErrors.map(error => error.message), analyticsErrors.map(() => "Unexpected token '<'"), 'Every browser error must have its exact known source');
  const warnings = analyticsErrors.length ? ['Vercel Analytics hosting script is absent on this local node-server origin; its HTML fallback produced recorded parse errors.'] : [];
  if (warnings.length) console.log(`Known local-build limitation: ${warnings[0]}`);
  assert.deepEqual([...mutationOrigins], [origin], 'Every observed browser mutation remains on the isolated origin');
  assert.deepEqual(geometryIssues, [], 'All recorded geometry checks must pass');
  for (const [path, hash] of Object.entries(sourceHashes)) {
    assert.equal(createHash('sha256').update(await readFile(join(sourceRoot, path))).digest('hex'), hash,
      `Changed source during acceptance: ${path}`);
  }
  await writeFile(join(out, 'result.json'), JSON.stringify({ ok: true, origin, replicaSet, checks,
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
    browser: 'Fresh isolated Chromium context with normal networking and Chromium sandbox enabled',
    sourceHashes, warnings, mutationOrigins: [...mutationOrigins], productionWrites: false, screenshots: out }, null, 2));
  console.log(`PASS: evidence ${out}`);
} catch (error) {
  console.error(error.message);
  if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(out, 'failure.json'), JSON.stringify({ error: error.message, checks }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children.reverse()) await stop(child);
  // Evidence contains only synthetic fixture content and measured geometry;
  // keep it outside the disposable server/database/profile workspace.
  await rm(dir, { recursive: true, force: true });
}
