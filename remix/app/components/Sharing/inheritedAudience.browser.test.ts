import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';

const base = process.env.TT_INHERITED_AUDIENCE_URL, artifacts = process.env.TT_INHERITED_AUDIENCE_ARTIFACTS,
  playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('native comment permalinks describe inheritance without claiming public access to private subspaces',
  { skip: !base || !artifacts || !playwrightPath, timeout: 120_000 }, async t => {
    assert.equal(new URL(base!).hostname, '127.0.0.1');
    assert.ok(process.env.TT_RENDER_SESSION);
    const health = await (await fetch(base + '/api/v1/health/nitro')).json();
    assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
    assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
    for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
      const code = await new Promise(resolve => {
        const socket = net.connect({ host, port: 443 }); socket.setTimeout(1500);
        socket.on('error', (error: any) => resolve(error.code));
        socket.on('timeout', () => { socket.destroy(); resolve('timeout'); });
        socket.on('connect', () => { socket.destroy(); resolve('CONNECTED'); });
      });
      assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)));
    }
    await mkdir(artifacts!, { recursive: true });
    const { chromium } = await import(playwrightPath!);
    const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const context = await browser.newContext(), guest = await browser.newContext(), foreign = await browser.newContext();
    const page = await context.newPage(), errors: string[] = [], bounds = [], failedRequests: string[] = [], consoleErrors: string[] = [], crashes: string[] = [];
    page.on('crash', () => crashes.push(page.url()));
    page.on('pageerror', (error: Error) => errors.push(error.message));
    page.on('requestfailed', (request: any) => failedRequests.push(new URL(request.url()).pathname + ': ' + request.failure()?.errorText));
    page.on('console', (message: any) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.setDefaultTimeout(20_000);
    const network = await context.newCDPSession(page); await network.send('Network.enable');
    await network.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
    const register = async (context: any) => {
      const username = 'audience-' + randomUUID().slice(0, 8);
      const response = await context.request.post(base + '/api/v1/auth/register', { headers: { Origin: base! }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
      assert.equal(response.status(), 200); return (await response.json()).user.id;
    };
    const ownerId = await register(context); await register(foreign);
    const request = (path: string, data?: unknown) => page.evaluate(async ({ path, data, ownerId }) => {
      const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Actor': ownerId }, body: JSON.stringify(data) });
      return { status: response.status, body: await response.json() };
    }, { path, data, ownerId });
    try {
      await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
      await page.goto(base + '/.well-known/thingtime-capabilities.json');
      const subspace = await request('/api/v1/subspaces', { name: 'Private audience fixture', slug: 'private-' + randomUUID().slice(0, 8), access: 'private' });
      assert.equal(subspace.status, 201, subspace.body.error);
      const parent = await request('/api/v1/things', { type: 'text', text: 'Private parent fixture', subspaceId: subspace.body.subspace.id, acl: ['tt:all'] });
      assert.equal(parent.status, 200, parent.body.error); const parentId = parent.body.post.id;
      const child = await request('/api/v1/things/comment', { id: parentId, text: 'Private inherited comment fixture' });
      assert.equal(child.status, 200, child.body.error); const childId = child.body.comment.id;
      const nested = await request('/api/v1/things/comment', { id: childId, text: 'Nested inherited comment fixture' });
      assert.equal(nested.status, 200, nested.body.error); const nestedId = nested.body.comment.id;
      const ordinary = await request('/api/v1/things', { type: 'text', text: 'Public fixture for comparison', acl: ['tt:all'] });
      assert.equal(ordinary.status, 200, ordinary.body.error); const publicId = ordinary.body.post.id;
      const foreignPage = await foreign.newPage(); await foreignPage.goto(base + '/.well-known/thingtime-capabilities.json');
      for (const id of [parentId, childId, nestedId]) {
        assert.equal((await guest.request.get(base + '/api/v1/things?id=' + id)).status(), 404);
        assert.equal(await foreignPage.evaluate(async id => (await fetch('/api/v1/things?id=' + id)).status, id), 404);
      }
      assert.equal((await guest.request.get(base + '/api/v1/things?id=' + publicId)).status(), 200);
      const projected = await request('/api/v1/things?id=' + childId);
      assert.deepEqual(projected.body.post.acl, ['tt:inherit']);
      assert.ok(projected.body.post.audience.acl.includes('tt:all'));
      assert.equal(projected.body.post.subspace, null, 'The inherited projection omits the root subspace fence');
      assert.equal(projected.body.root.subspace.access, 'private');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        for (const [label, id, text] of [['parent', parentId, 'private subspace members only'], ['comment', childId, 'follows the parent’s audience'], ['nested', nestedId, 'follows the parent’s audience'], ['public', publicId, 'anyone can see this post']]) {
          await page.goto(base + '/post/' + id);
          await page.getByText(text, { exact: true }).waitFor();
          if (label !== 'public') assert.equal(await page.getByText('anyone can see this post', { exact: true }).count(), 0);
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(requestAnimationFrame); } window.scrollTo(0, 0); });
          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.equal(scrollWidth, width); bounds.push({ label, width, scrollWidth });
          await page.screenshot({ path: resolve(artifacts!, `audience-${label}-${width}.png`), animations: 'disabled' });
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(crashes, []);
      await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ guestRefusals: 3, foreignRefusals: 3, publicRead: true, inheritedPublicAcl: true, privateRoot: true, bounds, errors, crashes }, null, 2));
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
      await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), page: await page.evaluate(() => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, 30000), worker: navigator.serviceWorker.controller?.scriptURL })).catch((error: Error) => ({ inspectionError: error.message })), errors, failedRequests, consoleErrors, crashes, bounds }, null, 2));
      throw error;
    }
  });
