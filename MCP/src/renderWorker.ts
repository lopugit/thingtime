import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { RenderInput, RenderOutput } from './renderExport.js';

process.once('message', async (input: RenderInput) => {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const policy = JSON.parse(await readFile(new URL('../../remix/dist/draft-preview/policy.json', import.meta.url), 'utf8'));
    const assets = new Map([
      ['/draft-preview/index.html', { body: await readFile(new URL('../../remix/dist/draft-preview/index.html', import.meta.url)), contentType: 'text/html' }],
      ['/draft-preview/runner.js', { body: await readFile(new URL('../../remix/dist/draft-preview/runner.js', import.meta.url)), contentType: 'text/javascript' }]
    ]);
    browser = await chromium.launch({ headless: true, timeout: 10000, chromiumSandbox: true, args: ['--js-flags=--max-old-space-size=256'] });
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const origin = 'http://127.0.0.1:19898'; // Intercepted entirely in memory; never contacted.
    const forbidden: string[] = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const asset = url.origin === origin ? assets.get(url.pathname) : undefined;
      if (asset && route.request().method() === 'GET' && !url.search) await route.fulfill({ status: 200, ...asset, headers: { 'Content-Security-Policy': policy.contentSecurityPolicy, 'Cache-Control': 'no-store' } });
      else { forbidden.push('Unexpected network request'); await route.abort(); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message.slice(0, 300)));
    await page.goto(`${origin}/draft-preview/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).thingtimeDraft);
    await page.evaluate(() => {
      document.body.dataset.capture = 'true';
      document.addEventListener('securitypolicyviolation', () => { document.body.dataset.cspFailure = 'true'; });
    });
    const draft = await page.evaluate(async ({ content, root }) => (window as any).thingtimeDraft.render(content, root), input);
    const result: RenderOutput = { ...draft, rendererHash: createHash('sha256').update(assets.get('/draft-preview/runner.js')!.body).digest('hex'), browserVersion: browser.version(), images: [], viewports: [] };
    let outputBytes = Buffer.byteLength(result.json);
    const viewports = [...input.viewports];
    if (!viewports.some(viewport => viewport.width === 320)) viewports.push({ width: 320, height: 844 });
    for (const [index, viewport] of viewports.entries()) {
      await page.setViewportSize(viewport);
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const geometry = await page.evaluate(({ blockId }) => {
        const preview = document.querySelector('#native-preview')!;
        const blocks = Array.from(preview.querySelectorAll('[data-draft-block]'));
        const selected = blockId ? blocks.find(element => element.getAttribute('data-draft-block') === blockId) : preview;
        if (!selected) throw new Error('Crop block is not in the rendered page');
        // Select the authored component root, excluding the page/layout wrappers.
        const card = selected.querySelector('[data-live] > :not(style)') || (selected === preview ? preview.firstElementChild : selected);
        if (!card) throw new Error('Crop target is missing');
        const rect = card.getBoundingClientRect();
        const nodes = Array.from(preview.querySelectorAll('*')).filter(element => element.tagName !== 'STYLE');
        const overflow = nodes.some(element => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1 || element.scrollWidth > element.clientWidth + 2 && element.clientWidth > 0);
        });
        if (overflow) throw new Error('Rendered content overflows the viewport; no incomplete screenshots returned');
        if (rect.width < 1 || rect.height < 1 || !preview.textContent?.trim()) throw new Error('Blank render or crop');
        if (nodes.some(element => element.textContent?.trim() && (Number(getComputedStyle(element).opacity) === 0 || getComputedStyle(element).visibility === 'hidden' || getComputedStyle(element).display === 'none' || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(getComputedStyle(element).color) || !element.getBoundingClientRect().height))) throw new Error('Invisible content cannot be exported');
        return { crop: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, text: preview.textContent, nodeCount: nodes.length, overflow: false };
      }, { blockId: input.crop.blockId });
      if (errors.length || forbidden.length || await page.getAttribute('body', 'data-csp-failure')) throw new Error(`Native render failed: ${errors[0] || forbidden[0] || 'blocked asset or capability'}`);
      result.viewports.push({ ...viewport, deviceScaleFactor: 1, ...geometry });
      const save = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
        const png = await page.screenshot({ type: 'png', fullPage: false, ...(clip ? { clip } : {}) });
        outputBytes += png.length * 2; // PNG appears as both image and embedded resource.
        if (outputBytes > 6 * 1024 * 1024) throw new Error('Output limit exceeded (6 MiB before base64)');
        result.images.push({ name, data: png.toString('base64'), width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
      };
      await save(`viewport-${viewport.width}x${viewport.height}.png`);
      if (index === 0 && input.crop.enabled) await save('card.png', geometry.crop);
    }
    await browser.close(); browser = undefined;
    process.send?.(result, () => process.exit(0));
  } catch (error) {
    await browser?.close().catch(() => {});
    process.send?.({ ok: false, error: error instanceof Error ? error.message : 'Render failed' }, () => process.exit(0));
  }
});
