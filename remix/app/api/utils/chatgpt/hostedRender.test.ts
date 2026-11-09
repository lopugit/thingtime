import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import {
  HOSTED_RENDER_RESPONSE_MAX_BYTES, RENDER_WORKER_PROTOCOL, formatHostedRenderResponse,
  parseRenderInput, type RenderOutput
} from '../../../../../MCP/src/renderContract';
import { decodeRenderResult } from '../../../../../MCP/scripts/save-render-artifacts.mjs';
import { createHostedRenderGateway, createHostedRenderReadiness, executeHostedRender, parseHostedRenderConfig, type HostedRenderConfig } from './hostedRender.server';

const origin = 'https://thingtime.example';
const config: HostedRenderConfig = { origin, snapshotId: 'snap_abcd1234', rendererHash: 'a'.repeat(64), protocol: RENDER_WORKER_PROTOCOL };
const request = new Request(origin + '/api/v1/integrations/chatgpt/mcp');
const input = parseRenderInput({ content: { id: 'caller-content' } });
const active = new AbortController().signal;
const outcome = (reply: string) => JSON.parse(reply).result;
const code = (reply: string) => outcome(reply).structuredContent.code;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const artifacts = async () => {
  const path = (name: string) => new URL('../../../../../artifacts/anonymous-release-2026-11-09/render/' + name, import.meta.url);
  const metadata = JSON.parse(await readFile(path('verification.json'), 'utf8'));
  const json = await readFile(path('thingtime-draft.json'), 'utf8');
  const images = await Promise.all(metadata.artifacts.filter((name: string) => name.endsWith('.png')).map(async (name: string) => {
    const bytes = await readFile(path(name));
    return { name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), data: bytes.toString('base64') };
  }));
  return { ...metadata, json, images } as RenderOutput;
};

function worker(reply: () => Readable | null, options: {
  blocked?: boolean; cleanupFails?: boolean; rendererHash?: string;
  probe?: { exitCode: number; stdout: string }; onRun?: (signal: AbortSignal) => Promise<void>
} = {}) {
  const events: string[] = [];
  const calls: { content?: string; inputMode?: number; probe?: unknown; command?: unknown; cleanupSignal?: AbortSignal } = {};
  const session = {
    sourceSnapshotId: config.snapshotId, networkPolicy: options.blocked ? 'allow-all' : 'deny-all',
    routes: [], timeout: 70_000, status: 'running', vcpus: 1, memory: 2048,
    async writeFiles(files: { content: Buffer; mode: number }[]) {
      events.push('write'); calls.content = files[0].content.toString(); calls.inputMode = files[0].mode;
    },
    async runCommand(command: { signal: AbortSignal }) {
      if (!calls.probe) {
        events.push('probe'); calls.probe = command;
        const probe = options.probe ?? { exitCode: 0, stdout: (options.rendererHash ?? config.rendererHash) + '\n' };
        return { exitCode: probe.exitCode, stdout: async () => probe.stdout };
      }
      events.push('execute'); calls.command = command; await options.onRun?.(command.signal);
      return { exitCode: 0 };
    },
    async readFile() { events.push('read'); return reply(); }
  };
  const vm = {
    name: '', persistent: false, networkPolicy: 'deny-all', routes: [],
    currentSession: () => session,
    async stop() { events.push('stop'); return { status: 'stopped' }; },
    async delete({ signal }: { signal: AbortSignal }) {
      events.push('delete'); calls.cleanupSignal = signal;
      if (options.cleanupFails) throw new Error('provider private response');
    }
  };
  const dependencies = { create: async (name: string) => { vm.name = name; events.push('create'); return vm; }, recover: async () => vm };
  return { events, calls, dependencies: dependencies as unknown as NonNullable<Parameters<typeof executeHostedRender>[4]> };
}

test('origin readiness requires a current immutable snapshot and shares one bounded check', async () => {
  assert.deepEqual(parseHostedRenderConfig(JSON.stringify(config), origin), config);
  assert.equal(parseHostedRenderConfig(JSON.stringify(config), 'https://other.example'), null);
  assert.equal(parseHostedRenderConfig(JSON.stringify({ ...config, token: 'refused' }), origin), null);
  let probes = 0;
  const ready = createHostedRenderReadiness({
    read: async () => JSON.stringify(config),
    snapshot: async snapshotId => { probes++; return { snapshotId, status: 'created', expiresAt: undefined }; }
  });
  assert.deepEqual(await Promise.all([ready(origin), ready('https://other.example'), ready(origin)]), [config, null, config]);
  assert.equal(probes, 1);
  for (const dependencies of [
    { read: async () => null, snapshot: async () => { throw new Error('must not probe'); } },
    { read: async () => JSON.stringify(config), snapshot: async () => { throw new Error('provider access refused'); } },
    { read: async () => JSON.stringify(config), snapshot: async () => ({ snapshotId: config.snapshotId, status: 'deleted' as const, expiresAt: undefined }) }
  ]) assert.equal(await createHostedRenderReadiness(dependencies)(origin), null);
});

test('isolated render returns real JSON and PNG bytes once, after exact VM cleanup', async () => {
  const rendered = await artifacts();
  const scoped = { ...config, rendererHash: rendered.rendererHash };
  const fixture = worker(() => Readable.from([Buffer.from(JSON.stringify({ protocol: RENDER_WORKER_PROTOCOL, result: rendered }))]), { rendererHash: rendered.rendererHash });
  const reply = await executeHostedRender(scoped, 7, input, active, fixture.dependencies);
  const result = outcome(reply);
  assert.equal(result.isError, undefined);
  assert.deepEqual(fixture.events, ['create', 'probe', 'write', 'execute', 'read', 'stop', 'delete']);
  assert.deepEqual(JSON.parse(fixture.calls.content!), input);
  assert.equal(fixture.calls.inputMode, 0o600);
  assert.doesNotMatch(JSON.stringify([fixture.calls.probe, fixture.calls.command]), /caller-content|authorization|token|sudo/i);
  assert.match(JSON.stringify(fixture.calls.probe), /10001:10001:thingtime-renderer/);
  assert.match(JSON.stringify(fixture.calls.probe), /sha256sum/);
  assert.match(JSON.stringify(fixture.calls.command), /no-new-privs/);
  assert.match(JSON.stringify(fixture.calls.command), /10001:10001:600/);
  assert.match(JSON.stringify(fixture.calls.command), /mkdir render-job\.lock/);
  assert.equal(JSON.parse(reply).id, 7);
  assert.ok(Buffer.byteLength(reply) < HOSTED_RENDER_RESPONSE_MAX_BYTES);
  assert.equal(result.content.some(block => block.type === 'image'), false);
  for (const [index, item] of result.content.slice(1).entries()) {
    const artifact = result.structuredContent.artifactFiles[index];
    assert.ok(item.resource.uri.endsWith('/' + artifact.name));
    const bytes = item.resource.text ? Buffer.from(item.resource.text) : Buffer.from(item.resource.blob, 'base64');
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(hash(bytes), artifact.sha256);
  }
  assert.equal(result.structuredContent.hash, hash(rendered.json));
  const mismatch = worker(() => Readable.from([Buffer.from(JSON.stringify({ protocol: RENDER_WORKER_PROTOCOL, result: rendered }))]), { rendererHash: rendered.rendererHash });
  assert.equal(code(await executeHostedRender(scoped, 8, input, active, mismatch.dependencies, 'b'.repeat(64))), 'RENDER_INVALID_OUTPUT');
  assert.deepEqual(mismatch.events.slice(-2), ['stop', 'delete']);
  assert.deepEqual(result.structuredContent.diagnostics, rendered.diagnostics);
  assert.deepEqual(result.structuredContent.validation, { canonical: true, dependencies: 'supplied-only', actions: false, externalAssets: false });
  assert.equal(result.structuredContent.viewports[0].text, rendered.viewports[0].text);
  assert.equal(decodeRenderResult(result, { host: 'Hosted HTTP fixture', server: 'thingtime' }).files.size, 5);
  result.structuredContent.artifactFiles[1].sha256 = 'bad';
  assert.throws(() => decodeRenderResult(result, { host: 'Hosted HTTP fixture', server: 'thingtime' }), /Embedded artifact descriptor mismatch/);
});

test('wrong hash, dimensions, duplicate images and excessive hosted framing never return partial files', async () => {
  const rendered = await artifacts();
  const oversizedJson = JSON.stringify({ content: 'a'.repeat(4_400_000) });
  const corrupted = Buffer.from(rendered.images[0].data, 'base64');
  corrupted[100] ^= 1; // Preserve the signature, IHDR and IEND; corrupt an interior chunk.
  const truncated = Buffer.concat([corrupted.subarray(0, 33), corrupted.subarray(-12)]);
  const cases = [
    { output: { ...rendered, images: [{ ...rendered.images[0], data: corrupted.toString('base64') }, ...rendered.images.slice(1)] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, images: [{ ...rendered.images[0], data: truncated.toString('base64') }, ...rendered.images.slice(1)] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, hash: 'invalid' }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, diagnostics: [] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, viewports: [{ ...rendered.viewports[0], crop: { ...rendered.viewports[0].crop, x: -1 } }, ...rendered.viewports.slice(1)] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, viewports: [{ ...rendered.viewports[0], crop: { ...rendered.viewports[0].crop, y: rendered.viewports[0].height } }, ...rendered.viewports.slice(1)] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, images: [{ ...rendered.images[0], width: 640 }, ...rendered.images.slice(1)] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, images: [rendered.images[1], ...rendered.images.slice(1)] }, expected: 'RENDER_INVALID_OUTPUT' },
    { output: { ...rendered, json: oversizedJson, hash: hash(oversizedJson) }, expected: 'RENDER_OUTPUT_LIMIT' }
  ];
  for (const { output, expected } of cases) {
    const result = outcome(formatHostedRenderResponse(1, output, input, rendered.rendererHash));
    assert.equal(result.structuredContent.code, expected);
    assert.deepEqual(result.structuredContent.artifacts, []);
    assert.equal(result.content.some(block => block.type !== 'text'), false);
  }
});

test('refused VM boundary, overlong output and uncertain cleanup fail closed', async () => {
  const blocked = worker(() => null, { blocked: true });
  assert.equal(code(await executeHostedRender(config, 1, input, active, blocked.dependencies)), 'RENDER_FAILED');
  assert.deepEqual(blocked.events, ['create', 'stop', 'delete']);
  const excessive = worker(() => Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1)]));
  assert.equal(code(await executeHostedRender(config, 1, input, active, excessive.dependencies)), 'RENDER_OUTPUT_LIMIT');
  assert.deepEqual(excessive.events.slice(-2), ['stop', 'delete']);
  const rendered = await artifacts();
  const uncertain = worker(() => Readable.from([Buffer.from(JSON.stringify({ protocol: RENDER_WORKER_PROTOCOL, result: rendered }))]), { cleanupFails: true, rendererHash: rendered.rendererHash });
  const reply = await executeHostedRender({ ...config, rendererHash: rendered.rendererHash }, 1, input, active, uncertain.dependencies);
  assert.equal(code(reply), 'RENDER_CLEANUP_UNVERIFIED');
  assert.doesNotMatch(reply, /provider private response|thingtime-draft:\/\//);
});

test('failed image-user probe or unverified runner bytes cannot receive caller data', async () => {
  for (const probe of [
    { exitCode: 1, stdout: config.rendererHash + '\n' },
    { exitCode: 0, stdout: '' },
    { exitCode: 0, stdout: 'b'.repeat(64) + '\n' },
    { exitCode: 0, stdout: config.rendererHash + '\nextra output\n' }
  ]) {
    const fixture = worker(() => null, { probe });
    assert.equal(code(await executeHostedRender(config, 1, input, active, fixture.dependencies)), 'RENDER_FAILED');
    assert.deepEqual(fixture.events, ['create', 'probe', 'stop', 'delete']);
    assert.equal(fixture.calls.content, undefined);
  }
});

test('caller cancellation and deadline still clean the owned VM with an independent signal', async () => {
  for (const reason of ['RENDER_CANCELLED', 'RENDER_TIMEOUT']) {
    const caller = new AbortController();
    const fixture = worker(() => null, { onRun: async signal => { if (reason === 'RENDER_CANCELLED') caller.abort(); await setTimeout(1000, null, { signal }); } });
    const reply = await executeHostedRender(config, 1, input, caller.signal, { ...fixture.dependencies, workTimeoutMs: 20 });
    assert.equal(code(reply), reason);
    assert.deepEqual(fixture.events.slice(-2), ['stop', 'delete']);
    assert.equal(fixture.calls.cleanupSignal?.aborted, false);
  }
});

test('invalid requests and blocked distributed admission cannot start a worker', async () => {
  const buckets: string[] = [];
  let executions = 0;
  const gateway = createHostedRenderGateway({
    ready: async () => config,
    admit: async (_request, name, identity, rule) => {
      buckets.push(name);
      if (name === 'hosted-render-global') {
        assert.equal(identity, 'all-hosted-origins');
        assert.equal(rule.windowMs, 120_000);
      }
      return { allowed: name === 'hosted-render-ip', limit: rule.limit, remaining: 0, resetAt: new Date(0).toISOString() };
    },
    execute: async () => { executions++; return ''; }
  });
  assert.equal(code(await gateway.call(request, config, 1, { ...input, accountId: 'private' })), 'RENDER_INVALID_INPUT');
  assert.equal(code(await gateway.call(new Request('https://other.example'), config, 1, input)), 'RENDER_UNAVAILABLE');
  assert.deepEqual(buckets, []);
  assert.equal(code(await gateway.call(request, config, 1, input)), 'RENDER_REJECTED');
  assert.deepEqual(buckets, ['hosted-render-ip']);
  const content = (await artifacts()).json;
  assert.equal(code(await gateway.call(request, config, 1, { content })), 'RENDER_BUSY');
  assert.deepEqual(buckets, ['hosted-render-ip', 'hosted-render-ip', 'hosted-render-global']);
  assert.equal(executions, 0);
});
