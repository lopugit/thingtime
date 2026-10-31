import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('isolated Docker stdio: exact render-only tools, resources and rejected calls', {
  skip: process.env.TT_RENDER_WRAPPER_TEST !== '1', timeout: 90000
}, async () => {
  assert.ok(process.env.TT_RENDER_DOCKER_SOCKET, 'Set the verified Docker Unix socket.');
  assert.ok(process.env.TT_RENDER_DOCKER_IMAGE, 'Set the verified cached image sha256 ID.');
  const args = ['scripts/render-isolated.mjs', '--socket', process.env.TT_RENDER_DOCKER_SOCKET!,
    '--image', process.env.TT_RENDER_DOCKER_IMAGE!, '--lifetime-seconds', '80'];
  if (process.env.TT_RENDER_ASSETS) args.push('--renderer', process.env.TT_RENDER_ASSETS);
  const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
  let diagnostics = '';
  transport.stderr?.on('data', bytes => { diagnostics = (diagnostics + bytes.toString()).slice(-12000); });
  const client = new Client({ name: 'thingtime-isolated-stdio-acceptance', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(tools, ['thingtime_capabilities', 'thingtime_render_and_export']);
    const capabilities = await client.callTool({ name: 'thingtime_capabilities', arguments: {} });
    assert.equal(capabilities.isError, undefined);
    assert.doesNotMatch(JSON.stringify(capabilities), /\/Users\/|\/home\/|\/opt\/|stateDir|allowedRoots/);
    const unavailable = await client.callTool({ name: 'thingtime_list_imports', arguments: {} });
    assert.equal(unavailable.isError, true);
    const invalid = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content: '{invalid' } });
    assert.equal(invalid.isError, true);
    assert.ok((invalid.content as any[]).every(item => item.type === 'text'));
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
    if (process.env.TT_RENDER_ARTIFACTS) {
      const output = resolve(process.env.TT_RENDER_ARTIFACTS);
      await mkdir(output, { recursive: true });
      for (const resource of resources) {
        const name = new URL(resource.uri).pathname.split('/').pop()!;
        assert.match(name, /^[a-z0-9-]+\.(json|png)$/);
        await writeFile(resolve(output, name), resource.text ?? Buffer.from(resource.blob, 'base64'));
      }
      await writeFile(resolve(output, 'verification.json'), JSON.stringify({
        evidence: 'SDK-level Docker stdio; native Codex host transport is not verified',
        rendererAssets: process.env.TT_RENDER_ASSETS ? 'explicit alternate build' : 'current worktree build',
        ...rendered.structuredContent
      }, null, 2));
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}\n${diagnostics}`);
  } finally { await client.close(); }
});
