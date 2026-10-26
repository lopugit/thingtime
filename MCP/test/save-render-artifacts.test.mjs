import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, decodeRenderEvents, decodeRenderResult, saveRenderArtifacts, saveRenderResult, MAX_INPUT_BYTES } from '../scripts/save-render-artifacts.mjs';

function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function fixture() {
  const json = JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['page'], things: [] });
  const hash = createHash('sha256').update(json).digest('hex');
  const header = Buffer.alloc(13); header.writeUInt32BE(320); header.writeUInt32BE(320, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(320 * (1 + 320 * 4)))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
  const resource = (name, mimeType, content) => ({ type: 'resource', resource: { uri: `thingtime-draft://${hash}/${name}`, mimeType, ...content } });
  const result = { structured_content: { ok: true, hash, viewports: [{ width: 320, height: 320, deviceScaleFactor: 1 }], artifacts: ['thingtime-draft.json', 'viewport-320x320.png'] }, content: [resource('thingtime-draft.json', 'application/json', { text: json }), { type: 'image', mimeType: 'image/png', data: png }, resource('viewport-320x320.png', 'image/png', { blob: png })] };
  return [{ type: 'item.completed', item: { id: 'render', type: 'mcp_tool_call', server: 'thingtime-drafts', tool: 'thingtime_render_and_export', status: 'completed', error: null, result } }, { type: 'turn.completed', usage: {} }];
}
const encode = events => events.map(e => JSON.stringify(e)).join('\n') + '\n';

test('saves native host resources with actual provenance and validates before writing', async () => {
  const source = fixture()[0].item.result;
  const result = { content: source.content, structuredContent: source.structured_content };
  const provenance = { host: 'Current desktop chat', server: 'thingtime' };
  const root = await mkdtemp(join(tmpdir(), 'tt-native-extract-'));
  try {
    const output = join(root, 'out');
    const report = await saveRenderResult(result, output, provenance);
    assert.equal(report.host, provenance.host);
    assert.equal(report.server, 'thingtime');
    assert.equal(report.itemId, undefined);
    assert.equal(report.artifacts.length, 2);
    await assert.rejects(saveRenderResult(result, output, provenance), { code: 'EEXIST' });
    await assert.rejects(saveRenderResult({ ...result, isError: true }, join(root, 'bad'), provenance), /Failed/);
    assert.ok(!(await readdir(root)).includes('bad'));
    assert.throws(() => decodeRenderResult({ ...result, structured_content: source.structured_content }, provenance), /Ambiguous/);
    const changed = structuredClone(result); changed.content[0].resource.text += ' ';
    assert.throws(() => decodeRenderResult(changed, provenance), /hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI extraction selects the configured unified server explicitly', () => {
  const events = fixture(); events[0].item.server = 'thingtime';
  assert.equal(decodeRenderEvents(encode(events), 'thingtime').verification.server, 'thingtime');
  assert.throws(() => decodeRenderEvents(encode(events)), /exactly one/);
});

test('extracts actual CLI event shape and accepts clean expected invalid-call result', () => {
  const events = fixture();
  events.splice(1, 0, { type: 'item.completed', item: { ...events[0].item, id: 'invalid', status: 'failed', result: { content: [{ type: 'text', text: 'Invalid input' }] } } });
  const decoded = decodeRenderEvents(encode(events));
  assert.equal(decoded.files.size, 2);
  assert.deepEqual(decoded.verification.artifacts[1].width, 320);
});

test('rejects incomplete, ambiguous, unsafe, changed and partial artifacts', () => {
  const cases = [
    e => e.pop(),
    e => e.splice(1, 0, structuredClone(e[0])),
    e => { e[0].item.result.content[0].resource.text += ' '; },
    e => { e[0].item.result.content[2].resource.uri = e[0].item.result.content[2].resource.uri.replace('viewport-320x320.png', '../escape.png'); },
    e => e[0].item.result.content.pop(),
    e => { e[0].item.status = 'failed'; },
    e => { e[0].item.result.structured_content.viewports[0].width = 321; },
    e => { e[0].item.result.content[2].resource.blob = 'abcd'; },
    e => { const b = Buffer.from(e[0].item.result.content[2].resource.blob, 'base64'); b[45] ^= 1; e[0].item.result.content[2].resource.blob = b.toString('base64'); },
    e => { e[0].item.result.content[1].data = 'changed'; },
    e => { e[0].item.result.structured_content.artifacts.pop(); },
  ];
  for (const mutate of cases) { const events = fixture(); mutate(events); assert.throws(() => decodeRenderEvents(encode(events))); }
  assert.throws(() => decodeRenderEvents(encode(fixture()).trimEnd()), /truncated/);
  assert.throws(() => decodeRenderEvents('x'.repeat(MAX_INPUT_BYTES + 1)), /Oversized/);
});

test('saves exclusively after complete validation; existing output and bad input preserve data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tt-cli-extract-'));
  try {
    const input = join(root, 'events.jsonl'), output = join(root, 'out');
    await writeFile(input, encode(fixture()));
    await saveRenderArtifacts(input, output);
    const original = await readFile(join(output, 'thingtime-draft.json'), 'utf8');
    await assert.rejects(saveRenderArtifacts(input, output), { code: 'EEXIST' });
    assert.equal(await readFile(join(output, 'thingtime-draft.json'), 'utf8'), original);
    assert.equal((await readdir(output)).length, 3);
    await writeFile(input, '{bad\n');
    await assert.rejects(saveRenderArtifacts(input, join(root, 'bad')));
    assert.ok(!(await readdir(root)).includes('bad'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
