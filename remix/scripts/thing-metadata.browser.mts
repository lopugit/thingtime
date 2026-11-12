/** Real Thing permalink + canonical API dispatcher + disposable replica.
 * Called only by the isolated metadata integration runner; never loads app env.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

type ThingBrowserScenario = {
  evidenceDir: string;
  marker: string;
  run(input: { page: any; context: any; profile: string; base: string; evidence: string }): Promise<void>;
};

export async function runThingMetadataBrowser(input: {
  owner: Record<string, unknown>; cookie: string; sourceId: string; jsonId: string; unavailableId?: string;
}, scenario?: ThingBrowserScenario) {
  assert.match(process.env.MONGODB_CONNECTION_STRING || '', /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=thing-metadata$/);
  assert.ok(process.env.THINGTIME_METADATA_TEST_DIRECTORY);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const evidence = resolve(scenario?.evidenceDir ?? process.env.THINGTIME_METADATA_BROWSER_EVIDENCE ?? '/tmp/thingtime-metadata-evidence/browser');
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const base = 'http://127.0.0.1:11500';
  assert.equal(process.env.APP_URL, base);
  const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
  const api = (await import('../server/routes/api/[...].ts')).default;
  const { thingtimeCapabilityManifest } = await import('../app/api/utils/capabilities/thingtimeCapabilities');
  const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>[LC] Thing metadata acceptance</title><style>body{background:#fafafb}#root{margin:0 auto;max-width:1100px}button,a{touch-action:manipulation}</style>
  <div id="root"></div><script>window.metadataFixtureOwner=${JSON.stringify(input.owner).replace(/</g, '\\u003c')}</script>
  <script type="module" src="/scripts/thing-metadata.browser.fixture.tsx"></script></html>`;
  const requests: { path: string; method: string; status: number }[] = [];
  async function dispatch(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = new URL(req.url || '/', base).pathname;
    if (path.startsWith('/thing/')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url!, html));
      return;
    }
    if (!path.startsWith('/api/') && path !== '/.well-known/thingtime-capabilities.json') return next();
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const body = Buffer.concat(chunks);
    const request = new Request(new URL(req.url!, base), { method: req.method, headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body }) });
    const response = path === '/.well-known/thingtime-capabilities.json'
      ? Response.json(thingtimeCapabilityManifest(base))
      : path.startsWith('/api/v1/attachments/local/')
        ? await handleLocalAttachmentStorageRequest(request)
        : await api({ req: request, context: { params: { path: path.slice(5) } } } as never) as Response;
    assert.ok(response instanceof Response, 'Canonical dispatcher must return a Response');
    requests.push({ path, method: req.method || 'GET', status: response.status });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  }
  const server = await createServer({ root, configFile: false, envDir: false, publicDir: false,
    cacheDir: join(evidence, 'vite'), resolve: { alias: { '~': join(root, 'app') } },
    server: { host: '127.0.0.1', port: 11500, strictPort: true, hmr: false },
    plugins: [{ name: 'thing-metadata-real-api', configureServer(vite) {
      vite.middlewares.use((req, res, next) => { void dispatch(req, res, next).catch(() => {
        res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Isolated metadata handler failed' }));
      }); });
    } }],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({ chromiumSandbox: true });
    for (const [profile, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile', reducedMotion: 'reduce' });
      await context.addCookies(input.cookie.split('; ').map((part: string) => {
        const split = part.indexOf('='); return { name: part.slice(0, split), value: part.slice(split + 1), url: base, httpOnly: true, sameSite: 'Lax' as const };
      }));
      const page = await context.newPage();
      page.setDefaultTimeout(25_000);
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      try {
        if (scenario) {
          await scenario.run({ page, context, profile, base, evidence });
          assert.deepEqual(errors, []);
          continue;
        }
        await page.goto(`${base}/thing/${input.sourceId}`);
        const panel = page.locator('[aria-label="Thing metadata"]');
        await panel.getByRole('heading', { name: 'Thing metadata' }).waitFor();
        await panel.getByText('5.63 KB', { exact: true }).waitFor();
        await panel.getByRole('link', { name: 'Open metadata Thing' }).waitFor();
        await panel.locator('summary').click();
        await panel.getByText('5,632', { exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, `${profile}-details.png`), fullPage: true });
        await page.getByText('End of Thing', { exact: true }).scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
        await panel.scrollIntoViewIfNeeded();
        const metadataHref = await panel.getByRole('link', { name: 'Open metadata Thing' }).getAttribute('href');
        assert.ok(metadataHref?.includes('thing-metadata-'));
        await page.goto(new URL(metadataHref!, base).href);
        await page.getByText('5.63 KB', { exact: true }).first().waitFor();
        await page.screenshot({ path: join(evidence, `${profile}-reference.png`), fullPage: true });
        assert.equal(requests.filter(row => row.path.endsWith('/things/metadata') && row.method === 'POST' && row.status >= 400).length, 0);
        if (input.unavailableId) {
          await page.goto(`${base}/thing/${input.unavailableId}`);
          await panel.getByText('Unavailable', { exact: true }).waitFor();
          await panel.locator('summary').click();
          await panel.getByText('1 of 1', { exact: true }).waitFor();
          await page.screenshot({ path: join(evidence, `${profile}-unavailable.png`), fullPage: true });
        }
        await page.goto(`${base}/thing/${input.jsonId}`);
        await panel.getByText('No attached files', { exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, `${profile}-json.png`), fullPage: true });
        if (profile === 'desktop') {
          const host = page.locator('[data-settings-document="thing-metadata"]');
          await host.getByRole('button', { name: 'Edit metadata layout' }).click();
          await host.getByRole('button', { name: 'Open Builder inspector' }).click();
          const selector = page.getByRole('combobox', { name: 'Select block' });
          const text = page.getByRole('textbox', { name: 'Block text' });
          for (const [id, label] of [['thing-metadata-json-label', 'JSON record'], ['thing-metadata-refresh', 'Check sizes']]) {
            await selector.selectOption(id); await text.fill(label); await text.blur();
          }
          await page.getByRole('button', { name: 'Close builder' }).click();
          await Promise.all([page.waitForResponse((response: any) => response.url().endsWith('/api/v1/things') && ['POST', 'PATCH'].includes(response.request().method())),
            host.getByRole('button', { name: 'Save layout', exact: true }).click()]);
          await page.reload();
          await panel.getByText('JSON record', { exact: true }).waitFor();
          await panel.getByRole('button', { name: 'Check sizes', exact: true }).click();
          await page.screenshot({ path: join(evidence, 'desktop-edited-reloaded.png'), fullPage: true });
          await page.route('**/api/v1/things/metadata?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Disposable transient failure' }) }));
          await panel.getByRole('button', { name: 'Check sizes', exact: true }).click();
          await panel.getByRole('alert').waitFor();
          await panel.getByText('No attached files', { exact: true }).waitFor();
          await page.screenshot({ path: join(evidence, 'desktop-refresh-error.png'), fullPage: true });
          await page.unroute('**/api/v1/things/metadata?*');
          await panel.getByRole('button', { name: 'Check sizes', exact: true }).click();
          await panel.getByRole('alert').waitFor({ state: 'hidden' });
        }
        assert.deepEqual(errors, []);
      } catch (error) {
        await page.screenshot({ path: join(evidence, `${profile}-failure.png`), fullPage: true });
        await writeFile(join(evidence, `${profile}-failure.txt`), JSON.stringify({ errors, requests, text: await page.locator("body").innerText() }, null, 2), { mode: 0o600 });
        throw error;
      } finally { await context.close(); }
    }
    if (scenario) {
      await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, scenario: scenario.marker, requests }, null, 2), { mode: 0o600 });
      console.log(scenario.marker);
      return;
    }
    await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: true, sourceId: input.sourceId, fileBytes: 5632,
      views: ['desktop', 'mobile', 'expanded details', 'saved metadata reference', 'JSON-only', 'edited layout reload', 'unavailable attachment size', 'transient refresh and retry'], requests }, null, 2), { mode: 0o600 });
    console.log('THING_METADATA_BROWSER_PASS');
  } finally { await browser?.close(); await server.close(); }
}
