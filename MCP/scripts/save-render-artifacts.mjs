#!/usr/bin/env node
// Decode the public `codex exec --json` event format, never a chat/session database.
import { open, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function parseJson(value) {
  try { return JSON.parse(value); } catch { throw new Error('Invalid JSON (raw input withheld)'); }
}
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function checkPng(bytes) {
  requireThat(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Malformed PNG signature');
  let offset = 8, width, height, channels, ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    requireThat(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    requireThat(end <= bytes.length, 'Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    requireThat(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG checksum mismatch');
    if (offset === 8) {
      requireThat(type === 'IHDR' && length === 13, 'Missing PNG header');
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      requireThat(width > 0 && width <= 1920 && height > 0 && height <= 1440 && depth === 8 && [2, 6].includes(color) && bytes.subarray(offset + 18, offset + 21).every(x => x === 0), 'Unsupported renderer PNG header');
      channels = color === 6 ? 4 : 3;
    } else requireThat(type !== 'IHDR', 'Duplicate PNG header');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') { requireThat(length === 0 && end === bytes.length, 'Invalid PNG end'); ended = true; }
    offset = end;
  }
  requireThat(ended && compressed.length > 0, 'Incomplete PNG');
  const expected = height * (1 + width * channels);
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  requireThat(pixels.length === expected, 'Incomplete PNG pixels');
  for (let row = 0; row < height; row++) requireThat(pixels[row * (1 + width * channels)] <= 4, 'Invalid PNG filter');
  return { width, height };
}
function decode64(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'Invalid base64');
  const bytes = Buffer.from(value, 'base64');
  requireThat(bytes.toString('base64') === value, 'Noncanonical base64');
  return bytes;
}

export function decodeRenderEvents(input, server = 'thingtime-drafts') {
  requireThat(Buffer.byteLength(input) <= MAX_INPUT_BYTES && input.endsWith('\n'), 'Oversized or truncated JSONL');
  const events = input.trimEnd().split('\n').map(parseJson);
  requireThat(events.at(-1)?.type === 'turn.completed', 'CLI turn did not complete');
  const renders = events.filter(e => e.type === 'item.completed' && e.item?.type === 'mcp_tool_call' && e.item.server === server && e.item.tool === 'thingtime_render_and_export').map(e => e.item);
  for (const item of renders) if (item.status !== 'completed' || item.error) {
    requireThat(!item.result?.content?.some(c => c.type === 'resource' || c.type === 'image'), 'Failed call contains partial artifacts');
  }
  const successes = renders.filter(i => i.status === 'completed' && !i.error);
  requireThat(successes.length === 1, 'Expected exactly one successful render call');
  const item = successes[0];
  return decodeRenderResult(item.result, { host: 'Codex CLI agent (not current desktop chat)', server, itemId: item.id });
}

// Native MCP hosts can save their actual tool result without inventing CLI events.
export function decodeRenderResult(result, provenance) {
  requireThat(result && result.isError !== true && Array.isArray(result.content), 'Failed or invalid render result');
  requireThat(!(result.structuredContent && result.structured_content), 'Ambiguous render metadata');
  requireThat(Buffer.byteLength(JSON.stringify(result)) <= MAX_INPUT_BYTES, 'Input limit exceeded');
  requireThat(typeof provenance?.host === 'string' && typeof provenance?.server === 'string', 'Host provenance required');
  const metadata = result.structuredContent ?? result.structured_content;
  requireThat(metadata?.ok === true && /^[a-f0-9]{64}$/.test(metadata.hash) && Array.isArray(metadata.viewports) && metadata.viewports.length >= 1 && metadata.viewports.length <= 4, 'Invalid render metadata');
  requireThat(metadata.viewports.every(v => Number.isInteger(v.width) && v.width >= 320 && v.width <= 1920 && Number.isInteger(v.height) && v.height >= 320 && v.height <= 1440 && v.deviceScaleFactor === 1), 'Invalid viewport metadata');
  requireThat(Array.isArray(metadata.artifacts) && metadata.artifacts.length >= 2 && metadata.artifacts.length <= 6 && new Set(metadata.artifacts).size === metadata.artifacts.length, 'Invalid artifact manifest');
  requireThat(metadata.cropEnabled === undefined || typeof metadata.cropEnabled === 'boolean', 'Invalid crop metadata');
  // Older workers only advertised crop geometry. New workers explicitly say
  // whether a card was requested; geometry remains useful even without a card.
  const cropEnabled = metadata.cropEnabled ?? !!metadata.viewports[0].crop;
  requireThat(!cropEnabled || !!metadata.viewports[0].crop, 'Missing crop geometry');
  const expectedNames = ['thingtime-draft.json', ...metadata.viewports.map(v => `viewport-${v.width}x${v.height}.png`), ...(cropEnabled ? ['card.png'] : [])];
  requireThat(new Set(expectedNames).size === expectedNames.length && expectedNames.length === metadata.artifacts.length && expectedNames.every(name => metadata.artifacts.includes(name)), 'Incomplete artifact manifest');
  const resources = result.content.filter(c => c.type === 'resource').map(c => c.resource);
  requireThat(resources.length === metadata.artifacts.length, 'Missing or extra resources');
  const files = new Map(), checks = [];
  let total = 0;
  for (const resource of resources) {
    const prefix = `thingtime-draft://${metadata.hash}/`;
    requireThat(typeof resource?.uri === 'string' && resource.uri.startsWith(prefix), 'Unexpected resource URI');
    const name = resource.uri.slice(prefix.length);
    requireThat(name === 'thingtime-draft.json' || name === 'card.png' || /^viewport-(\d{3,4})x(\d{3,4})\.png$/.test(name), 'Unsafe artifact filename');
    requireThat(metadata.artifacts.includes(name) && !files.has(name), 'Unexpected or duplicate artifact');
    let bytes, dimensions;
    if (name === 'thingtime-draft.json') {
      requireThat(resource.mimeType === 'application/json' && typeof resource.text === 'string' && resource.blob === undefined, 'Invalid JSON resource');
      bytes = Buffer.from(resource.text);
      requireThat(hash(bytes) === metadata.hash, 'Canonical JSON hash mismatch');
      const draft = parseJson(resource.text);
      requireThat(draft.format === 'thingtime.transfer' && draft.version === 1 && Array.isArray(draft.roots) && Array.isArray(draft.things), 'Invalid portable draft');
    } else {
      requireThat(resource.mimeType === 'image/png' && resource.text === undefined, 'Invalid PNG resource');
      bytes = decode64(resource.blob);
      dimensions = checkPng(bytes);
      const viewport = name === 'card.png' ? metadata.viewports[0]?.crop : metadata.viewports.find(v => name === `viewport-${v.width}x${v.height}.png`);
      requireThat(viewport && dimensions.width === Math.round(viewport.width) && dimensions.height === Math.round(viewport.height) && dimensions.width > 0 && dimensions.width <= 1920 && dimensions.height > 0 && dimensions.height <= 1440, 'PNG dimensions mismatch');
      requireThat(result.content.some(c => c.type === 'image' && c.mimeType === 'image/png' && c.data === resource.blob), 'PNG image/resource mismatch');
    }
    total += bytes.length;
    requireThat(total <= MAX_OUTPUT_BYTES, 'Artifact output limit exceeded');
    files.set(name, bytes);
    checks.push({ name, bytes: bytes.length, sha256: hash(bytes), ...dimensions });
  }
  requireThat(files.has('thingtime-draft.json') && metadata.artifacts.every(name => files.has(name)), 'Incomplete artifact set');
  return { files, verification: { ...provenance, tool: 'thingtime_render_and_export', metadata, artifacts: checks } };
}

export async function saveRenderArtifacts(inputPath, outputPath, server = 'thingtime-drafts') {
  const handle = await open(inputPath, 'r');
  let input;
  try {
    requireThat((await handle.stat()).size <= MAX_INPUT_BYTES, 'Input limit exceeded');
    // Fixed allocation + one-byte overflow detection also bounds a growing input file.
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let used = 0, count;
    do { count = (await handle.read(buffer, used, buffer.length - used, null)).bytesRead; used += count; } while (count && used < buffer.length);
    requireThat(used <= MAX_INPUT_BYTES, 'Input limit exceeded');
    input = buffer.subarray(0, used).toString('utf8');
  } finally { await handle.close(); }
  return saveDecodedArtifacts(decodeRenderEvents(input, server), outputPath);
}

export async function saveRenderResult(result, outputPath, provenance) {
  return saveDecodedArtifacts(decodeRenderResult(result, provenance), outputPath);
}

async function saveDecodedArtifacts(decoded, outputPath) {
  const output = resolve(outputPath);
  // Exclusive mkdir refuses pre-existing directories (including symlinks). Nothing
  // is written until the entire event stream and artifact set have validated.
  await mkdir(output, { mode: 0o700 });
  try {
    for (const [name, bytes] of decoded.files) await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(output, 'verification.json'), JSON.stringify(decoded.verification, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
  return decoded.verification;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireThat([4, 5].includes(process.argv.length), 'Usage: node MCP/scripts/save-render-artifacts.mjs PRIVATE_EVENTS.jsonl NEW_OUTPUT_DIRECTORY [SERVER_NAME]');
    const result = await saveRenderArtifacts(process.argv[2], process.argv[3], process.argv[4]);
    console.log(`Verified and saved ${result.artifacts.length} artifacts in ${resolve(process.argv[3])}`);
  } catch (error) { console.error(`Artifact extraction failed: ${error.message}`); process.exitCode = 1; }
}
