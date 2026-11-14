// Final-build HTTP/browser acceptance; receives only disposable in-memory identities.
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function runTokenReactionAcceptance({ request, owner, stranger, checks, origin, evidenceDir }) {
  const call = async (path, options = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await request(path, { ...options, status: null });
      if (result.response.status === 429) {
        const seconds = Number(result.response.headers.get('Retry-After'));
        assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 120, 'A bounded real rate window is required');
        console.log(JSON.stringify({ event: 'waiting-for-token-reaction-rate-window', seconds }));
        await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 250)); continue;
      }
      assert.equal(result.response.status, options.status ?? 200, `Token/reaction ${path.split('?')[0]} status`);
      return result;
    }
    throw new Error('Token/reaction rate window did not clear after bounded waits');
  };
  const saved = (await call('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['data'], acl: ['tt:user'], crystal: { name: 'Synthetic sandbox resource' } } })).data.thing;
  assert(saved?.id);
  const pat = (await call('/api/v1/tokens', { cookie: owner.cookie, status: 201, body: {
    name: 'Synthetic sandbox ACL acceptance', scopes: ['things.read', 'things.update'], visibility: 'private', onlyCreatedThings: true, allowGet: true
  } })).data;
  assert(pat.token && pat.tokenInfo?.id);
  // Token ACL gates mutations/engagement; ordinary audience ACL gates reads.
  const mutateSandbox = () => request('/api/v1/things/update', { token: pat.token,
    body: { id: saved.id, crystal: { name: 'Synthetic sandbox mutation' } }, status: null });
  assert((await mutateSandbox()).response.status >= 400, 'Ungrant sandbox mutation refuses');
  const grants = Array.from({ length: 40 }, (_, n) => `tt:token/synthetic_${n}`);
  const ownGrant = `tt:token/${pat.tokenInfo.id}`;
  const modify = (operation, entries, extra = {}) => call('/api/v1/things/acl', { cookie: owner.cookie,
    body: { id: saved.id, family: 'token', operation, entries, ...extra } });
  await modify('add', [...grants, ownGrant]);
  const all = []; let cursor; let revision; const seen = new Set();
  do {
    const page = (await call('/api/v1/things/acl?' + new URLSearchParams({ id: saved.id, family: 'token', limit: '9', ...(cursor ? { cursor } : {}) }), { cookie: owner.cookie })).data;
    if (revision !== undefined) assert.equal(page.revision, revision);
    revision = page.revision; all.push(...page.entries); cursor = page.nextCursor;
    if (cursor) { assert(!seen.has(cursor), 'Token cursor advances'); seen.add(cursor); }
  } while (cursor);
  assert.equal(all.length, 41); assert.equal(new Set(all).size, 41); assert(grants.every(entry => all.includes(entry)));
  const ownerRead = (await call('/api/v1/things?id=' + encodeURIComponent(saved.id), { cookie: owner.cookie })).data.thing;
  assert.equal(ownerRead.tokenAcl.length, 41); assert.equal(ownerRead.tokenAclRevision, revision);
  assert.equal((await mutateSandbox()).response.status, 200);
  await Promise.all(['concurrent_a', 'concurrent_b'].map(id => modify('add', [`tt:token/${id}`])));
  await call('/api/v1/things/acl', { cookie: owner.cookie, status: 409, body: { id: saved.id, family: 'token', operation: 'add', entries: ['tt:token/stale'], expectedAclRevision: revision } });
  await modify('remove', [ownGrant]);
  assert((await mutateSandbox()).response.status >= 400, 'Revoked sandbox mutation refuses');
  await call('/api/v1/things/acl', { cookie: stranger.cookie, status: 404, body: { id: saved.id, family: 'token', operation: 'add', entries: [ownGrant] } });
  checks.push('41 relational token grants roundtrip through paged owner API; concurrent adds, stale revision refusal and actual sandbox access/revocation preserve authority');

  const created = (await call('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['post'], acl: ['tt:user'], crystal: { type: 'text', text: 'Synthetic reaction collection acceptance' } } })).data;
  const postId = created.post?.id; assert(postId);
  const emojis = Array.from({ length: 120 }, (_, n) => '😀'.repeat(n + 1));
  for (const emoji of emojis) await call('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['reaction'], targetId: postId, crystal: { emoji } } });
  const post = (await call('/api/v1/things?id=' + encodeURIComponent(postId), { cookie: owner.cookie })).data.post;
  assert.equal(Object.keys(post.reactionCounts).length, 120); assert.equal(post.viewerReactions.length, 120);
  assert(emojis.every(emoji => post.reactionCounts[emoji] === 1));
  const rows = []; const reactionCursors = new Set(); cursor = undefined;
  do {
    const page = (await call('/api/v1/things?' + new URLSearchParams({ target: postId, thingtime: 'reaction', limit: '37', ...(cursor ? { cursor } : {}) }), { cookie: owner.cookie })).data;
    rows.push(...page.things); cursor = page.nextCursor;
    if (cursor) { assert(!reactionCursors.has(cursor), 'Reaction row cursor advances'); reactionCursors.add(cursor); }
  } while (cursor);
  assert.equal(rows.length, 120); assert.equal(new Set(rows.map(row => row.id)).size, 120);
  checks.push('120 valid distinct reaction types from one user persist through real API and independent reaction-row paging, beyond former20/100 admission caps');

  const modulePath = process.env.AGENT_REPORTING_PLAYWRIGHT_MODULE;
  const executablePath = process.env.AGENT_REPORTING_CHROMIUM_EXECUTABLE;
  assert(modulePath && executablePath && origin && evidenceDir);
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(owner.cookie.split('; ').filter(Boolean).map(pair => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin, httpOnly: true, sameSite: 'Lax' }; }));
    const page = await context.newPage();
    for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.goto(`${origin}/post/${postId}`);
      await page.getByText('Synthetic reaction collection acceptance', { exact: true }).first().waitFor({ state: 'visible' });
      await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(200, innerHeight - 80)) { scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 10)); } });
      await page.screenshot({ path: join(evidenceDir, `reaction-collection-${name}-full.png`), fullPage: true });
      for (const [part, fraction] of [['top', 0], ['middle', .5], ['bottom', 1]]) {
        await page.evaluate(f => scrollTo(0, Math.max(0, document.documentElement.scrollHeight - innerHeight) * f), fraction);
        await page.screenshot({ path: join(evidenceDir, `reaction-collection-${name}-${part}.png`) });
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Reaction collection remains inside the viewport');
    }
    await context.close();
  } finally { await browser.close(); }
  checks.push('120-type reaction presentation rendered and fully scrolled at desktop/mobile with readable viewport screenshot evidence and no horizontal overflow');
}
