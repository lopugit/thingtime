import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const enabled = process.env.TT_DRAFT_BROWSER_TEST === '1';
test('stdio agent: no-login native PNGs, canonical dependencies and failures', { skip: !enabled, timeout: 120000 }, async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], stderr: 'pipe' });
  const client = new Client({ name: 'thingtime-draft-acceptance', version: '1.0.0' });
  await client.connect(transport);
  try {
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'thingtime_render_and_export'));
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
    assert.equal(exported.format, 'thingtime.transfer');
    assert.equal(exported.things.length, 2);
    assert.equal(exported.things[1].crystal.args[0].default, exact);
    for (const resource of resources.slice(1)) {
      const png = Buffer.from(resource.blob, 'base64');
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.ok(png.length > 5000);
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
    assert.equal(concurrent.filter(result => result.isError).length, 1);
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
    const hidden = structuredClone(fixture); hidden.things[1].crystal.render.props.style.color = 'rgba(10, 20, 30, 0)';
    const blank: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: hidden } });
    assert.equal(blank.isError, true);
    assert.match(blank.content[0].text, /Invisible/);
    const overflow = structuredClone(fixture);
    overflow.things[1].crystal.render.props.style.width = '3000px';
    const failed: any = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: overflow } });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /overflow/);
  } finally { await client.close(); }
});

test('running web app: clean browser edit, native render, JSON download and zero API traffic', { skip: !process.env.TT_DRAFT_WEB_BASE, timeout: 30000 }, async () => {
  const { chromium } = await import('playwright');
  const base = process.env.TT_DRAFT_WEB_BASE!;
  assert.equal(base, 'http://127.0.0.1:22460');
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const requests: string[] = [];
    await context.route('**/*', async route => {
      const url = route.request().url(); requests.push(url);
      if ([`${base}/draft-preview/index.html`, `${base}/draft-preview/runner.js`].includes(url)) await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${base}/draft-preview/index.html`);
    const fixture = await readFile(new URL('./fixtures/affirmation.transfer.json', import.meta.url), 'utf8');
    await page.getByLabel('Thing / transfer JSON', { exact: true }).fill(fixture);
    await page.getByRole('button', { name: 'Render draft', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#diagnostics')?.textContent?.includes('"ok": true'));
    assert.equal(await context.cookies().then(cookies => cookies.length), 0);
    assert.equal(requests.length, 2);
    assert.equal(await page.evaluate(() => { try { localStorage.getItem('probe'); return false; } catch { return true; } }), true, 'Opaque sandbox denies storage even on the app origin');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    assert.equal(exported.things.length, 2);
    await page.getByLabel('Thing / transfer JSON', { exact: true }).fill('{bad');
    await page.getByRole('button', { name: 'Render draft', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#diagnostics')?.textContent?.includes('"ok":false'));
    assert.equal(await page.locator('#native-preview article').count(), 1, 'Last valid preview retained on error');
    await page.reload();
    assert.equal(await page.getByLabel('Thing / transfer JSON', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('#native-preview').count(), 0);
  } finally { await browser.close(); }
});
