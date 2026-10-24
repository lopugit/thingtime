import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const enabled = process.env.TT_DRAFT_BROWSER_TEST === '1';
test('stdio agent: no-login native PNGs, canonical dependencies and failures', { skip: !enabled, timeout: 120000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['dist/index.js'], stderr: 'pipe',
    env: process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : undefined
  });
  const client = new Client({ name: 'thingtime-draft-acceptance', version: '1.0.0' });
  await client.connect(transport);
  try {
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'thingtime_render_and_export'));
    const capabilities = await client.callTool({ name: 'thingtime_capabilities', arguments: {} });
    assert.equal(capabilities.isError, undefined);
    assert.match(String(capabilities.structuredContent?.renderExport), /thingtime_render_and_export/);
    const fixture = JSON.parse(await readFile(new URL('./fixtures/affirmation.transfer.json', import.meta.url), 'utf8'));
    const result: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: fixture, crop: { enabled: true, blockId: 'card' } } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const metadata = result.structuredContent;
    assert.match(metadata.hash, /^[a-f0-9]{64}$/);
    assert.match(metadata.rendererHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(metadata.viewports.map((v: any) => [v.width, v.height]), [[1440, 1000], [390, 844], [320, 844]]);
    const exact = fixture.things[1].crystal.args[0].default;
    for (const viewport of metadata.viewports) {
      assert.equal(viewport.text, exact);
      assert.equal(viewport.overflow, false);
      assert.ok(viewport.crop.x >= 23 && viewport.crop.x + viewport.crop.width <= viewport.width - 23);
      assert.ok(Math.abs(viewport.crop.width / viewport.crop.height - 5 / 7) < 0.005);
    }
    assert.equal(metadata.viewports[0].crop.width, 400);
    const resources = result.content.filter((item: any) => item.type === 'resource').map((item: any) => item.resource);
    assert.equal(resources.length, 5);
    const exported = JSON.parse(resources[0].text);
    assert.equal(createHash('sha256').update(resources[0].text).digest('hex'), metadata.hash,
      'The reported content hash identifies the actual downloaded canonical JSON');
    assert.equal(exported.format, 'thingtime.transfer');
    assert.equal(exported.things.length, 2);
    assert.equal(exported.things[1].crystal.args[0].default, exact);
    for (const resource of resources.slice(1)) {
      const png = Buffer.from(resource.blob, 'base64');
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.ok(png.length > 5000);
      const dimensions = new URL(resource.uri).pathname.match(/viewport-(\d+)x(\d+)\.png$/);
      if (dimensions) assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)],
        [Number(dimensions[1]), Number(dimensions[2])], 'PNG bytes match the advertised viewport');
    }
    if (process.env.TT_DRAFT_ARTIFACT_DIR) {
      await mkdir(process.env.TT_DRAFT_ARTIFACT_DIR, { recursive: true });
      for (const resource of resources) await writeFile(`${process.env.TT_DRAFT_ARTIFACT_DIR}/${new URL(resource.uri).pathname.split('/').pop()}`, resource.text || Buffer.from(resource.blob, 'base64'));
      await writeFile(`${process.env.TT_DRAFT_ARTIFACT_DIR}/verification.json`, JSON.stringify(metadata, null, 2));
    }
    const repeat: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: exported } });
    assert.equal(repeat.isError, undefined, JSON.stringify(repeat));
    assert.equal(repeat.structuredContent.hash, metadata.hash);
    const concurrent: any[] = await Promise.all([0, 1].map(() => client.callTool({ name: 'thingtime_render_and_export', arguments: { content: exported } })));
    assert.equal(concurrent.filter(result => result.isError).length, 1,
      JSON.stringify(concurrent.map(result => result.isError ? result.content : { ok: true })));
    assert.match(concurrent.find(result => result.isError).content[0].text, /busy/);
    for (const args of [{ content: exported, viewports: [{ width: 319, height: 844 }] }, { content: exported, crop: { enabled: true, blockId: 'missing' } }]) {
      const rejected: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: args });
      assert.equal(rejected.isError, true);
      assert.ok(rejected.content.every((item: any) => item.type === 'text'));
    }
    const badInputs = ['{invalid', { ...fixture, things: [fixture.things[0]] },
      { ...fixture, things: [{ ...fixture.things[1], crystal: { ...fixture.things[1].crystal, render: { tag: 'img', props: { src: 'https://example.com/private' } } } }] }];
    for (const content of badInputs) {
      const rejected: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content } });
      assert.equal(rejected.isError, true);
      assert.ok(rejected.content.every((item: any) => item.type === 'text'));
    }
    for (const invisibleStyle of [{ color: 'rgba(10, 20, 30, 0)' }, { color: 'color(display-p3 1 0 0 / 0)' }, { fontSize: '0px' }]) {
      const hidden = structuredClone(fixture); Object.assign(hidden.things[1].crystal.render.props.style, invisibleStyle);
      const blank: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: hidden } });
      assert.equal(blank.isError, true);
      assert.match(blank.content[0].text, /Invisible/);
      assert.ok(blank.content.every((item: any) => item.type === 'text'));
    }
    const overflow = structuredClone(fixture);
    overflow.things[1].crystal.render.props.style.width = '3000px';
    const failed: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: overflow } });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /overflow/);
  } finally { await client.close(); }
});

test('running web app: clean browser edit, native render, JSON download and zero API traffic', { skip: !process.env.TT_DRAFT_WEB_BASE, timeout: 30000 }, async testContext => {
  const { chromium } = await import('playwright');
  const base = process.env.TT_DRAFT_WEB_BASE!;
  if (process.env.TT_DRAFT_TEST_SESSION) {
    assert.equal(new URL(base).hostname, '127.0.0.1');
    assert.equal(new URL(base).origin, base);
    const health = await (await fetch(`${base}/api/v1/health/nitro`)).json();
    assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
    assert.equal(health.testEnvironment.sessionId, process.env.TT_DRAFT_TEST_SESSION);
  } else assert.equal(base, 'http://127.0.0.1:22460');
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  testContext.signal.addEventListener('abort', () => { void browser.close(); }, { once: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const requests: string[] = [];
    await context.route('**/*', async route => {
      const url = route.request().url(); requests.push(url);
      if ([`${base}/draft-preview/index.html`, `${base}/draft-preview/runner.js`].includes(url)) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const [runner, response] = await Promise.all([
      page.waitForResponse(`${base}/draft-preview/runner.js`),
      page.goto(`${base}/draft-preview/index.html`)
    ]);
    assert.match(response!.headers()['content-security-policy'] || '', /sandbox allow-scripts allow-downloads(?:;|$)/);
    assert.equal(response!.headers()['cache-control'], 'no-store');
    assert.equal(runner.status(), 200);
    assert.match(runner.headers()['content-type'] || '', /javascript/,
      'The packaged renderer must be JavaScript, not a successful SPA fallback');
    await page.waitForFunction(() => (window as any).thingtimeDraft?.version === 1);
    assert.equal(await page.getByRole('button', { name: 'Download JSON' }).isDisabled(), true);
    const fixture = await readFile(new URL('./fixtures/affirmation.transfer.json', import.meta.url), 'utf8');
    await page.getByLabel('Thing / transfer JSON', { exact: true }).fill(fixture);
    await page.getByRole('button', { name: 'Render draft', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#diagnostics')?.textContent?.includes('"ok": true'));
    assert.equal(await context.cookies().then(cookies => cookies.length), 0);
    assert.equal(requests.length, 2);
    assert.equal(await page.evaluate(() => { try { localStorage.getItem('probe'); return false; } catch { return true; } }), true, 'Opaque sandbox denies storage even on the app origin');
    if (process.env.TT_DRAFT_ARTIFACT_DIR) {
      await mkdir(process.env.TT_DRAFT_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.TT_DRAFT_ARTIFACT_DIR}/web-editor-1440.png`, fullPage: true });
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const canonicalJson = await readFile((await (await download).path())!, 'utf8');
    const exported = JSON.parse(canonicalJson);
    assert.equal(exported.things.length, 2);
    const contentHash = createHash('sha256').update(canonicalJson).digest('hex');
    assert.equal(contentHash, JSON.parse((await page.locator('#diagnostics').textContent())!).hash);
    assert.equal(exported.things[1].crystal.args[0].default, JSON.parse(fixture).things[1].crystal.args[0].default);
    if (process.env.TT_DRAFT_ARTIFACT_DIR) await writeFile(`${process.env.TT_DRAFT_ARTIFACT_DIR}/web-thingtime-draft.json`, canonicalJson);
    await page.getByLabel('Thing / transfer JSON', { exact: true }).fill('{bad');
    await page.getByRole('button', { name: 'Render draft', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#diagnostics')?.textContent?.includes('"ok":false'));
    assert.equal(await page.locator('#native-preview article').count(), 1, 'Last valid preview retained on error');
    assert.equal(await page.getByRole('button', { name: 'Download JSON' }).isDisabled(), true, 'Failed drafts cannot download stale content');
    await page.reload();
    assert.equal(await page.getByLabel('Thing / transfer JSON', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('#native-preview').count(), 0);
    if (process.env.TT_DRAFT_ARTIFACT_DIR) await writeFile(`${process.env.TT_DRAFT_ARTIFACT_DIR}/web-verification.json`, JSON.stringify({
      ok: true, cleanBrowser: true, nativeRender: true, canonicalDownload: true, contentHash,
      requestCount: requests.length, apiRequests: requests.filter(url => new URL(url).pathname.startsWith('/api/')),
      opaqueStorageDenied: true, invalidJsonRejected: true, staleExportDisabled: true, emptyAfterReload: true
    }, null, 2));
  } finally { await browser.close(); }
});
