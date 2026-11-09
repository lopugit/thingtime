import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('isolated Docker stdio under umask 077: exact tools, resources and rejected calls', {
  // Allow asset transfer and both verified-cleanup attempts within the test.
  skip: process.env.TT_RENDER_WRAPPER_TEST !== '1', timeout: 225000
}, async () => {
  assert.ok(process.env.TT_RENDER_DOCKER_SOCKET, 'Set the verified Docker Unix socket.');
  assert.ok(process.env.TT_RENDER_DOCKER_IMAGE, 'Set the verified cached image sha256 ID.');
  const args = ['--import', 'data:text/javascript,process.umask(0o077)',
    'scripts/render-isolated.mjs', '--socket', process.env.TT_RENDER_DOCKER_SOCKET!,
    '--image', process.env.TT_RENDER_DOCKER_IMAGE!, '--lifetime-seconds', '150'];
  if (process.env.TT_RENDER_ASSETS) args.push('--renderer', process.env.TT_RENDER_ASSETS);
  const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
  let diagnostics = '';
  transport.stderr?.on('data', bytes => { diagnostics = (diagnostics + bytes.toString()).slice(-12000); });
  const client = new Client({ name: 'thingtime-isolated-stdio-acceptance', version: '1.0.0' });
  try {
    await client.connect(transport, { timeout: 100000 });
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(tools, ['thingtime_capabilities', 'thingtime_render_and_export']);
    const capabilities = await client.callTool({ name: 'thingtime_capabilities', arguments: {} });
    assert.equal(capabilities.isError, undefined);
    assert.doesNotMatch(JSON.stringify(capabilities), /\/Users\/|\/home\/|\/opt\/|stateDir|allowedRoots/);
    const unavailable = await client.callTool({ name: 'thingtime_list_imports', arguments: {} });
    assert.equal(unavailable.isError, true);
    const content = JSON.parse(await readFile(new URL('./fixtures/affirmation.transfer.json', import.meta.url), 'utf8'));
    const rendered = await client.callTool({ name: 'thingtime_render_and_export', arguments: {
      content, root: 'affirmation-page', crop: { enabled: true, blockId: 'card' }
    } });
    assert.equal(rendered.isError, undefined, JSON.stringify(rendered));
    const resources = (rendered.content as any[]).filter(item => item.type === 'resource').map(item => item.resource);
    assert.equal(resources.length, 5);
    assert.equal(createHash('sha256').update(resources[0].text).digest('hex'), rendered.structuredContent?.hash);
    for (const resource of resources.slice(1)) {
      assert.equal(resource.mimeType, 'image/png');
      assert.equal(Buffer.from(resource.blob, 'base64').subarray(1, 4).toString(), 'PNG');
    }
    const rejected = await client.callTool({ name: 'thingtime_render_and_export', arguments: {
      content, root: 'affirmation-page', viewports: [{ width: 390, height: 844 }, { width: 390, height: 844 }]
    } });
    assert.equal(rejected.isError, true);
    const rejectedBlocks = rejected.content as any[];
    assert.equal(rejectedBlocks.length, 1);
    assert.equal(rejectedBlocks[0].type, 'text');
    const failure = JSON.parse(rejectedBlocks[0].text);
    assert.equal(failure.code, 'RENDER_EXPORT_FAILED');
    assert.match(failure.error, /Duplicate viewport dimensions/);
    assert.deepEqual(failure.artifacts, []);
    if (process.env.TT_RENDER_ARTIFACTS) {
      const output = resolve(process.env.TT_RENDER_ARTIFACTS);
      await mkdir(output, { recursive: true, mode: 0o700 });
      for (const resource of resources) {
        const name = new URL(resource.uri).pathname.split('/').pop()!;
        assert.match(name, /^[a-z0-9-]+\.(json|png)$/);
        await writeFile(resolve(output, name), resource.text ?? Buffer.from(resource.blob, 'base64'), { mode: 0o600 });
      }
      await writeFile(resolve(output, 'verification.json'), JSON.stringify({
        evidence: 'SDK-level Docker stdio; native Codex host transport is not verified',
        launcherUmask: '077',
        rendererAssets: process.env.TT_RENDER_ASSETS ? 'explicit alternate build' : 'current worktree build',
        refusals: [{ case: 'duplicate viewports', code: failure.code, artifacts: 0 }],
        ...rendered.structuredContent
      }, null, 2), { mode: 0o600 });
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}\n${diagnostics}`);
  } finally { await client.close(); }
});
