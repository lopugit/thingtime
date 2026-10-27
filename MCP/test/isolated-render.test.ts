import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createIsolatedRenderer, isolatedRenderConfiguration, IsolatedRenderTransport, ISOLATED_RENDER_OUTPUT_BYTES, type RenderLaunch } from '../src/isolatedRender.js';
import { parseRenderInput, renderInput, renderViewports } from '../src/renderExport.js';
import { createServer } from '../src/server.js';
import { SnapshotStore } from '../src/store.js';

const configuration = { THINGTIME_MCP_RENDER_IMAGE: `sha256:${'a'.repeat(64)}`, THINGTIME_MCP_RENDER_SOCKET: '/tmp/selected-docker.sock' };
const input = renderInput.parse({ content: { id: 'caller-provided' } });
const artifact: CallToolResult = { structuredContent: { ok: true, hash: 'content-hash', rendererHash: 'renderer-hash' }, content: [
  { type: 'resource', resource: { uri: 'thingtime-draft://content-hash/thingtime-draft.json', mimeType: 'application/json', text: '{"supplied":"only"}' } },
  { type: 'image', mimeType: 'image/png', data: 'cG5n' },
  { type: 'resource', resource: { uri: 'thingtime-draft://content-hash/card.png', mimeType: 'image/png', blob: 'cG5n' } }
] };

function sandbox(execute: () => Promise<CallToolResult> = async () => artifact, options: { name?: string; extraTool?: boolean; deadlineMs?: number; failCleanup?: boolean } = {}) {
  let starts = 0, closes = 0;
  const servers: McpServer[] = [];
  const renderer = createIsolatedRenderer(configuration, { deadlineMs: options.deadlineMs, transport: launch => {
    assert.equal(launch.args.includes('--lifetime-seconds'), true);
    starts++;
    const server = new McpServer({ name: options.name || 'thingtime-draft-renderer', version: '0.1.0' });
    server.registerTool('thingtime_capabilities', { inputSchema: z.object({}) }, async () => ({ content: [] }));
    server.registerTool('thingtime_render_and_export', { inputSchema: renderInput }, execute);
    if (options.extraTool) server.registerTool('thingtime_import_archive', { inputSchema: z.object({}) }, async () => ({ content: [] }));
    servers.push(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const close = clientTransport.close.bind(clientTransport);
    clientTransport.close = async () => { closes++; await close(); if (options.failCleanup) throw new Error('Cleanup could not be verified'); };
    void server.connect(serverTransport);
    return clientTransport;
  } });
  return { renderer, starts: () => starts, closes: () => closes, cleanup: async () => { await renderer.close(); await Promise.all(servers.map(server => server.close())); } };
}

test('unified renderer requires explicit pinned image/socket and sends a minimal environment', () => {
  for (const env of [{}, { ...configuration, THINGTIME_MCP_RENDER_IMAGE: 'image:latest' }, { ...configuration, THINGTIME_MCP_RENDER_SOCKET: 'relative' }, { ...configuration, THINGTIME_MCP_RENDER_DOCKER: 'docker' }, { ...configuration, THINGTIME_MCP_RENDER_ASSETS: 'relative' }]) {
    assert.ok(isolatedRenderConfiguration(env).error);
  }
  const spec = isolatedRenderConfiguration({ ...configuration, API_TOKEN: 'must-not-forward', NODE_OPTIONS: '--inspect', DOCKER_HOST: 'tcp://external', THINGTIME_MCP_STATE_DIR: '/private/state', HOME: '/private/home', THINGTIME_MCP_RENDER_ASSETS: '/tmp/renderer' }).launch!;
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.env, { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir() });
  assert.ok(spec.args.includes('/tmp/renderer'));
  assert.ok(spec.args.includes(configuration.THINGTIME_MCP_RENDER_IMAGE));
  assert.ok(spec.args[0].endsWith('/scripts/render-isolated.mjs'));
});

test('unified MCP discovers legacy tools with rendering disabled and preserves consent/body boundaries', async () => {
  const state = await mkdtemp(join(tmpdir(), 'thingtime-unified-test-'));
  const renderer = createIsolatedRenderer({});
  const server = createServer(new SnapshotStore(state), renderer);
  const client = new Client({ name: 'unified-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [
      'thingtime_capabilities', 'thingtime_delete_import', 'thingtime_get_conversation', 'thingtime_import_archive',
      'thingtime_ingest_current_chat', 'thingtime_list_connectors', 'thingtime_list_imports', 'thingtime_prepare_ingestion', 'thingtime_render_and_export'
    ]);
    const discovered = (await client.listTools()).tools;
    for (const name of ['thingtime_capabilities', 'thingtime_render_and_export']) {
      assert.equal(discovered.find(tool => tool.name === name)?.annotations?.readOnlyHint, true,
        'Read-only hosts must be able to discover and render without a mutation approval');
    }
    const capabilities = await client.callTool({ name: 'thingtime_capabilities', arguments: {} });
    assert.equal((capabilities.structuredContent!.renderIsolation as any).configured, false);
    const denied = await client.callTool({ name: 'thingtime_render_and_export', arguments: input });
    assert.equal(denied.isError, true); assert.match((denied.content as any)[0].text, /THINGTIME_MCP_RENDER_IMAGE/);
    assert.ok((denied.content as any[]).every(item => item.type === 'text'));
    const conversation = { id: 'synthetic-chat', source: { app: 'test', connector: 'host' }, title: 'Synthetic test only', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'synthetic private body' }] }] };
    const unconfirmed = await client.callTool({ name: 'thingtime_ingest_current_chat', arguments: { conversation } });
    assert.equal(unconfirmed.isError, true);
    assert.deepEqual((await client.callTool({ name: 'thingtime_list_imports', arguments: {} })).structuredContent!.imports, []);
    const ingested = await client.callTool({ name: 'thingtime_ingest_current_chat', arguments: { conversation, confirmedByUser: true } });
    assert.equal(ingested.isError, undefined);
    const importId = (ingested.structuredContent!.import as any).id;
    const summary = await client.callTool({ name: 'thingtime_get_conversation', arguments: { importId, conversationId: 'synthetic-chat' } });
    assert.equal((summary.structuredContent!.conversation as any).messages, undefined);
    assert.equal(JSON.stringify(summary).includes('synthetic private body'), false);
    const body = await client.callTool({ name: 'thingtime_get_conversation', arguments: { importId, conversationId: 'synthetic-chat', includeMessages: true } });
    assert.equal((body.structuredContent!.conversation as any).messages[0].parts[0].text, 'synthetic private body');
    const preview = await client.callTool({ name: 'thingtime_prepare_ingestion', arguments: { importId } });
    assert.equal(preview.isError, undefined);
    const deletion = await client.callTool({ name: 'thingtime_delete_import', arguments: { importId } });
    assert.equal(deletion.isError, true);
  } finally { await client.close(); await server.close(); await rm(state, { recursive: true, force: true }); }
});

test('isolated delegate lazily forwards resources exactly, closes each session and rejects invalid input before launch', async () => {
  const fixture = sandbox();
  try {
    assert.equal(fixture.starts(), 0);
    await assert.rejects(fixture.renderer.execute({ ...input, content: 'x'.repeat(280000) }), /Too big|256 KiB/);
    await assert.rejects(fixture.renderer.execute({ ...input, content: 'é'.repeat(131073) }), /256 KiB/);
    await assert.rejects(fixture.renderer.execute({ ...input, content: { text: 'x'.repeat(262144) } }), /256 KiB/);
    await assert.rejects(fixture.renderer.execute({ ...input, viewports: [{ width: 390, height: 844 }, { width: 390, height: 844 }] }), /Duplicate viewport dimensions/);
    assert.equal(fixture.starts(), 0);
    assert.deepEqual(await fixture.renderer.execute(input), artifact);
    assert.equal(fixture.starts(), 1); assert.ok(fixture.closes() >= 1);
    assert.deepEqual(await fixture.renderer.execute(input), artifact);
    assert.equal(fixture.starts(), 2);
  } finally { await fixture.cleanup(); }
});

test('viewport expansion keeps an explicit 320px viewport exactly once', () => {
  const explicit = parseRenderInput({ content: { id: 'caller-provided' }, viewports: [{ width: 320, height: 600 }, { width: 390, height: 844 }] });
  assert.deepEqual(renderViewports(explicit), explicit.viewports);
  assert.equal(renderViewports(explicit).filter(viewport => viewport.width === 320).length, 1);
  const expanded = renderViewports(input);
  assert.deepEqual(expanded.at(-1), { width: 320, height: 844 });
  assert.equal(expanded.filter(viewport => viewport.width === 320).length, 1);
  assert.equal(input.viewports.length, 2, 'Expansion does not mutate the parsed request');
});

test('identity and broad tool surfaces fail closed and clean up', async () => {
  for (const options of [{ name: 'thingtime-mcp' }, { extraTool: true }]) {
    const fixture = sandbox(undefined, options);
    try { await assert.rejects(fixture.renderer.execute(input), /Unexpected isolated renderer/); assert.ok(fixture.closes() >= 1); }
    finally { await fixture.cleanup(); }
  }
});

test('cleanup failure withholds successful artifact output', async () => {
  const fixture = sandbox(undefined, { failCleanup: true });
  try { await assert.rejects(fixture.renderer.execute(input), /Cleanup could not be verified/); }
  finally { await fixture.cleanup(); }
});

test('server close cancels active isolation and prevents new launches', async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const fixture = sandbox(async () => { entered(); return await new Promise(() => {}); });
  const pending = fixture.renderer.execute(input);
  await started;
  const rejected = assert.rejects(pending, /closed/i);
  await fixture.renderer.close();
  await rejected;
  await assert.rejects(fixture.renderer.execute(input), /closing/);
  await fixture.cleanup();
});

test('concurrency, cancellation and deadlines close sessions without returning partial resources', async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const fixture = sandbox(async () => { entered(); return await new Promise(() => {}); });
  const controller = new AbortController();
  const pending = fixture.renderer.execute(input, controller.signal);
  await started;
  await assert.rejects(fixture.renderer.execute(input), /busy/);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.ok(fixture.closes() >= 1);
  await fixture.cleanup();
  const stalled = sandbox(async () => await new Promise(() => {}), { deadlineMs: 30 });
  try { await assert.rejects(stalled.renderer.execute(input), /deadline|timed out/i); assert.ok(stalled.closes() >= 1); }
  finally { await stalled.cleanup(); }
});

test('transport bounds raw bytes before parsing and reports no stderr contents', async () => {
  const launch: RenderLaunch = { command: process.execPath, args: ['-e', `process.stderr.write('secret diagnostic'); process.stdout.write(Buffer.alloc(${ISOLATED_RENDER_OUTPUT_BYTES + 1}, 120)); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' } };
  const transport = new IsolatedRenderTransport(launch);
  const error = new Promise<Error>(resolve => { transport.onerror = resolve; });
  await transport.start();
  assert.match((await error).message, /invalid or excessive/);
  await assert.rejects(transport.close(), /invalid or excessive/);
});

test('valid tool artifacts followed by a truncated frame are withheld after cleanup', { timeout: 5000 }, async () => {
  const script = `
    const artifact = ${JSON.stringify(artifact)};
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (!('id' in request)) return;
      let result;
      if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'thingtime-draft-renderer', version: '0.1.0' } };
      else if (request.method === 'tools/list') result = { tools: ['thingtime_capabilities', 'thingtime_render_and_export'].map(name => ({ name, inputSchema: { type: 'object' } })) };
      else if (request.method === 'tools/call') result = artifact;
      else throw new Error('Unexpected fixture request');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
      if (request.method === 'tools/call') process.stdout.write('{"jsonrpc":');
    });
    process.stdin.on('end', () => process.exit(0));
  `;
  const renderer = createIsolatedRenderer(configuration, { transport: () => new IsolatedRenderTransport({
    command: process.execPath, args: ['-e', script], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }
  }) });
  try { await assert.rejects(renderer.execute(input), /truncated protocol frame; no artifacts returned/); }
  finally { await renderer.close(); }
});

test('cancellation while launcher initialization is pending closes the transport', async () => {
  let starts = 0, closes = 0;
  const renderer = createIsolatedRenderer(configuration, { transport: () => ({
    async start() { starts++; await new Promise(() => {}); },
    async send() {},
    async close() { closes++; }
  }) });
  const controller = new AbortController();
  const pending = renderer.execute(input, controller.signal);
  assert.equal(starts, 1);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.ok(closes >= 1);
  await renderer.close();
});

test('normal stdio entry shuts down cleanly on EOF and SIGTERM without starting Docker', { timeout: 12000 }, async () => {
  const state = await mkdtemp(join(tmpdir(), 'thingtime-stdio-shutdown-'));
  try {
    for (const mode of ['EOF', 'SIGTERM']) {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { PATH: '/usr/bin:/bin', HOME: state, THINGTIME_MCP_STATE_DIR: join(state, 'store'), ...configuration, THINGTIME_MCP_RENDER_DOCKER: '/nonexistent/docker' },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stderr.resume();
      const closed = once(child, 'close');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        const ready = once(child.stdout, 'data');
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'shutdown-test', version: '1' } } })}\n`);
        const [bytes] = await ready;
        assert.equal(JSON.parse(bytes.toString()).result.serverInfo.name, 'thingtime-mcp');
        if (mode === 'EOF') child.stdin.end(); else child.kill('SIGTERM');
        const [code, signal] = await closed;
        assert.equal(code, 0, mode); assert.equal(signal, null, mode);
      } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    }
  } finally { await rm(state, { recursive: true, force: true }); }
});
