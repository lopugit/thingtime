import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import net from 'node:net';

const base = process.env.TT_INHERITED_AUDIENCE_URL, artifacts = process.env.TT_INHERITED_AUDIENCE_ARTIFACTS,
  playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('native comment permalinks describe inheritance without claiming public access to private subspaces',
  { skip: !base || !artifacts || !playwrightPath, timeout: 240_000 }, async t => {
    const repetitions = Number(process.env.TT_INHERITED_AUDIENCE_REPETITIONS || 1);
    assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 3);
    const runId = randomUUID();
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
    // Repeated full-document loads create collectible V8 contexts. Bound the
    // test heap so normal GC runs before the shared 4 GiB runtime reaches OOM;
    // do not force collection or disable the browser's sandbox to pass checks.
    const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true, args: ['--js-flags=--max-old-space-size=256'] });
    t.after(() => browser.close());
    const context = await browser.newContext(), guest = await browser.newContext(), foreign = await browser.newContext();
    const page = await context.newPage(), errors: string[] = [], bounds = [], failedRequests: string[] = [], consoleErrors: string[] = [], crashes: string[] = [];
    const navigation: Array<Record<string, unknown>> = [], events: Array<Record<string, unknown>> = [], recovery = [];
    const record = (event: string, detail?: unknown) => {
      events.push({ at: Date.now(), event, detail });
      if (events.length > 200) events.shift();
    };
    page.on('framenavigated', (frame: any) => { if (frame === page.mainFrame()) record('navigation', frame.url()); });
    page.on('domcontentloaded', () => record('domcontentloaded', page.url()));
    page.on('load', () => record('load', page.url()));
    page.on('close', () => record('close', page.url()));
    page.on('response', (response: any) => {
      const url = new URL(response.url());
      if (url.origin === base && url.pathname.startsWith('/api/') && response.status() >= 400) record('apiError', { path: url.pathname, status: response.status() });
    });
    page.on('crash', () => crashes.push(page.url()));
    page.on('pageerror', (error: Error) => errors.push(error.message));
    page.on('requestfailed', (request: any) => failedRequests.push(new URL(request.url()).pathname + ': ' + request.failure()?.errorText));
    page.on('console', (message: any) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.setDefaultTimeout(20_000);
    const network = await context.newCDPSession(page); await network.send('Network.enable');
    await network.send('Inspector.enable');
    await network.send('Performance.enable');
    network.on('Inspector.targetCrashed', () => record('targetCrashed'));
    network.on('Inspector.detached', (detail: unknown) => record('inspectorDetached', detail));
    await network.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
    const memory = async () => ({
      cgroupBytes: await readFile('/sys/fs/cgroup/memory.current', 'utf8').then(value => Number(value)).catch(() => null),
      events: await readFile('/sys/fs/cgroup/memory.events', 'utf8').catch(() => null),
      available: await readFile('/proc/meminfo', 'utf8').then(value => value.split('\n').filter(line => /^Mem(?:Total|Available):/.test(line))).catch(() => null),
      processes: await promisify(execFile)('ps', ['-eo', 'pid,ppid,rss,comm', '--sort=-rss'], { timeout: 3000 }).then(({ stdout }) => stdout.split('\n').slice(0, 13)).catch(() => null),
      renderer: await network.send('Performance.getMetrics').then(({ metrics }: any) => metrics.filter(({ name }: any) => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Documents', 'Nodes', 'JSEventListeners'].includes(name))).catch(() => null)
    });
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
      // A transient block-resolver failure must leave both the notice and the
      // cached native content usable below the fixed header, including Retry.
      const failBlocks = (route: any) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Isolated fixture resolver outage' }) });
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await page.route('**/api/v1/webpages/resolve**', failBlocks);
        await page.goto(base + '/post/' + parentId);
        const alert = page.getByRole('alert').filter({ hasText: 'Could not refresh your page blocks' });
        await alert.waitFor();
        await page.getByText('Private parent fixture', { exact: true }).waitFor();
        await page.evaluate(async () => {
          document.documentElement.style.scrollBehavior = 'auto';
          for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(requestAnimationFrame); }
          window.scrollTo(0, 0); await new Promise(requestAnimationFrame);
        });
        const notice = await alert.getByText('Could not refresh your page blocks. Your last loaded version is still available.').boundingBox();
        assert.ok(notice && notice.y >= 54, 'The recovery notice must clear the fixed navigation');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await page.screenshot({ path: resolve(artifacts!, `blocks-failure-${width}.png`), animations: 'disabled' });
        await Promise.all([
          page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/v1/webpages/resolve' && response.status() === 503),
          alert.getByRole('button', { name: 'Retry page blocks', exact: true }).click()
        ]);
        await page.unroute('**/api/v1/webpages/resolve**', failBlocks);
        await alert.getByRole('button', { name: 'Retry page blocks', exact: true }).click();
        await alert.waitFor({ state: 'hidden' });
        await page.getByText('Private parent fixture', { exact: true }).waitFor();
        recovery.push({ width, notice, failedRetry: true, realRecovery: true });
      }
      for (let repetition = 1; repetition <= repetitions; repetition++) for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        for (const [label, id, text] of [['parent', parentId, 'private subspace members only'], ['comment', childId, 'follows the parent’s audience'], ['nested', nestedId, 'follows the parent’s audience'], ['public', publicId, 'anyone can see this post']]) {
          const current: Record<string, unknown> = { repetition, label, width, url: base + '/post/' + id, startedAt: Date.now() };
          navigation.push(current);
          current.memoryBefore = await memory();
          const response = await page.goto(String(current.url));
          current.response = response && { status: response.status(), url: response.url(), fromServiceWorker: response.fromServiceWorker() };
          await page.getByText(text, { exact: true }).waitFor();
          if (label !== 'public') assert.equal(await page.getByText('anyone can see this post', { exact: true }).count(), 0);
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(async () => {
            document.documentElement.style.scrollBehavior = 'auto';
            for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(requestAnimationFrame); }
            window.scrollTo(0, 0); await new Promise(requestAnimationFrame);
          });
          assert.equal(await page.evaluate(() => window.scrollY), 0, 'Capture the settled top of the page');
          current.alerts = await page.locator('[role="alert"]').allTextContents();
          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.equal(scrollWidth, width); bounds.push({ label, width, scrollWidth });
          await page.screenshot({ path: resolve(artifacts!, `audience-${label}-${width}.png`), animations: 'disabled' });
          current.finishedAt = Date.now();
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(crashes, []);
      const finalMemory = await memory();
      assert.match(finalMemory.events || '', /(?:^|\n)oom_kill 0(?:\n|$)/);
      await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ runId, heapLimitMiB: 256, guestRefusals: 3, foreignRefusals: 3, publicRead: true, inheritedPublicAcl: true, privateRoot: true, recovery, bounds, navigation, finalMemory, events, errors, crashes }, null, 2));
    } catch (error) {
      // Unique names and a hash prevent a failed capture from being mistaken for
      // an older screenshot when an artifact directory is reused.
      const screenshot = await page.screenshot({ timeout: 5000 }).then(async (bytes: Buffer) => {
        const file = `failure-${runId}.png`;
        await writeFile(resolve(artifacts!, file), bytes);
        return { file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
      }).catch((error: Error) => ({ captureError: error.message }));
      await writeFile(resolve(artifacts!, `failure-${runId}.json`), JSON.stringify({ runId, error: String(error), screenshot, browserConnected: browser.isConnected(), pageClosed: page.isClosed(), url: page.url(), body: await page.locator('body').innerText({ timeout: 3000 }).catch((error: Error) => ({ inspectionError: error.message })), page: await page.evaluate(() => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, 30000), worker: navigator.serviceWorker.controller?.scriptURL })).catch((error: Error) => ({ inspectionError: error.message })), navigation, events, errors, failedRequests, consoleErrors, crashes, bounds }, null, 2));
      throw error;
    }
  });
