import { createHash } from 'node:crypto';
import { checkRendererPng } from './pngArtifact.mjs';

import { MAX_RENDER_CONTENT_BYTES, RENDER_CROP_BLOCK_PATTERN, RENDER_INPUT_SCHEMA, defaultRenderViewports } from './renderSchema.js';
export * from './renderSchema.js';

export type RenderInput = {
  content: string | Record<string, unknown>;
  root?: string;
  viewports: { width: number; height: number }[];
  crop: { enabled: boolean; blockId?: string };
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export function parseRenderInput(raw: unknown): RenderInput {
  if (!object(raw) || !only(raw, Object.keys(RENDER_INPUT_SCHEMA.properties))) throw new Error('Render arguments must contain only content, root, viewports and crop');
  const { content, root } = raw;
  if (typeof content !== 'string' && !object(content)) throw new Error('Supply a canonical Thing or thingtime.transfer v1');
  if (Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content)) > MAX_RENDER_CONTENT_BYTES) throw new Error('Draft input exceeds 256 KiB');
  if (root !== undefined && (typeof root !== 'string' || root.length > 200)) throw new Error('Invalid draft root');
  const requested = raw.viewports === undefined ? defaultRenderViewports : raw.viewports;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 3) throw new Error('Request one to three viewports');
  const viewports = requested.map(viewport => {
    if (!object(viewport) || !only(viewport, ['width', 'height']) || !integer(viewport.width, 320, 1920) || !integer(viewport.height, 320, 1440)) throw new Error('Viewport must be 320–1920px wide and 320–1440px tall');
    return { width: viewport.width, height: viewport.height };
  });
  if (new Set(viewports.map(({ width, height }) => `${width}x${height}`)).size !== viewports.length) throw new Error('Duplicate viewport dimensions; request each width and height pair only once');
  const crop = raw.crop === undefined ? {} : raw.crop;
  if (!object(crop) || !only(crop, ['enabled', 'blockId'])) throw new Error('Invalid crop settings');
  const { enabled = true, blockId } = crop;
  if (typeof enabled !== 'boolean' || (blockId !== undefined && (typeof blockId !== 'string' || !RENDER_CROP_BLOCK_PATTERN.test(blockId)))) throw new Error('Invalid crop settings');
  return { content, ...(typeof root === 'string' ? { root } : {}), viewports, crop: { enabled, ...(typeof blockId === 'string' ? { blockId } : {}) } };
}

export type RenderedViewport = { width: number; height: number; deviceScaleFactor: number; crop: { x: number; y: number; width: number; height: number }; text: string; nodeCount: number; overflow: boolean };
export type RenderDiagnostic = { level: 'info'; code: 'SCHEMA_NORMALIZED' | 'VALIDATED'; message: string };
export type RenderOutput = { ok: true; rendererHash: string; browserVersion: string; cropEnabled: boolean; json: string; hash: string; diagnostics: RenderDiagnostic[]; viewports: RenderedViewport[]; images: { name: string; data: string; width: number; height: number }[] };

export function renderViewports(input: RenderInput): RenderInput['viewports'] {
  const viewports = [...input.viewports];
  if (!viewports.some(viewport => viewport.width === 320)) viewports.push({ width: 320, height: 844 });
  return viewports;
}

export const artifactResource = (hash: string, name: string, artifact: { mimeType: 'application/json'; text: string } | { mimeType: 'image/png'; blob: string }) =>
  ({ type: 'resource' as const, resource: { uri: `thingtime-draft://${hash}/${name}`, ...artifact } });


// HTTP hosts have a smaller response budget than stdio. The byte bound below
// includes JSON-RPC framing and leaves headroom under Vercel's 4.5 MB limit.
// Embedded resources carry the file bytes once; no temporary URL, storage or
// account context is needed. This formatter does not launch or attest a worker.
export const HOSTED_RENDER_RESPONSE_MAX_BYTES = 4_400_000;
export const RENDER_OUTPUT_MAX_BYTES = 6 * 1024 * 1024;
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export type HostedRenderFailure = { ok: false; code: string; error: string; artifacts: [] };
export const hostedRenderFailure = (id: string | number, code: string, error: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id, result: { isError: true, structuredContent: { ok: false, code, error, artifacts: [] }, content: [{ type: 'text', text: error }] } });

export function formatHostedRenderResponse(id: string | number, result: RenderOutput, input: RenderInput, expectedRendererHash: string): string {
  const reply = (toolResult: object) => JSON.stringify({ jsonrpc: '2.0', id, result: toolResult });
  const refuse = (code: string, error: string) => hostedRenderFailure(id, code, error);
  const invalid = () => refuse('RENDER_INVALID_OUTPUT', 'The isolated renderer returned an incomplete or inconsistent result; no artifacts returned.');
  const tooLarge = () => refuse('RENDER_OUTPUT_LIMIT', 'The render exceeds the hosted response budget; no artifacts returned. Request fewer or smaller viewports.');

  if (result?.ok !== true || !/^[a-f0-9]{64}$/.test(expectedRendererHash) || result.rendererHash !== expectedRendererHash ||
      typeof result.json !== 'string' || typeof result.browserVersion !== 'string' || !result.browserVersion ||
      result.cropEnabled !== input.crop.enabled || !Array.isArray(result.diagnostics) || !Array.isArray(result.viewports) || !Array.isArray(result.images)) return invalid();
  if (Buffer.byteLength(result.json) > RENDER_OUTPUT_MAX_BYTES) return tooLarge();
  const diagnostics = result.diagnostics;
  if (diagnostics.length < 1 || diagnostics.length > 2 || diagnostics.at(-1)?.code !== 'VALIDATED' ||
      (diagnostics.length === 2 && diagnostics[0]?.code !== 'SCHEMA_NORMALIZED') ||
      diagnostics.some(item => item?.level !== 'info' || typeof item.message !== 'string' || Buffer.byteLength(item.message) > 8192)) return invalid();
  const jsonBytes = Buffer.from(result.json);
  if (sha256(jsonBytes) !== result.hash) return invalid();

  const expectedViewports = renderViewports(input);
  if (result.viewports.length !== expectedViewports.length || result.images.length !== expectedViewports.length + Number(result.cropEnabled)) return invalid();
  const viewports = result.viewports.map((viewport, index) => {
    const { width, height } = expectedViewports[index];
    const crop = viewport?.crop;
    if (viewport?.width !== width || viewport.height !== height || viewport.deviceScaleFactor !== 1 || viewport.overflow !== false ||
        !crop || ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.width < 1 || crop.width > width || crop.height < 1 || crop.height > height || crop.x < 0 || crop.y < 0 || crop.x + crop.width > width || crop.y + crop.height > height ||
        typeof viewport.text !== 'string' || !Number.isSafeInteger(viewport.nodeCount) || viewport.nodeCount < 1) return null;
    return { width, height, deviceScaleFactor: 1, crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }, nodeCount: viewport.nodeCount, text: viewport.text, overflow: false };
  });
  if (viewports.some(viewport => !viewport)) return invalid();

  const expectedImages = new Map(expectedViewports.map(viewport => [`viewport-${viewport.width}x${viewport.height}.png`, viewport]));
  if (result.cropEnabled) expectedImages.set('card.png', { width: Math.round(viewports[0]!.crop.width), height: Math.round(viewports[0]!.crop.height) });
  const resources = [artifactResource(result.hash, 'thingtime-draft.json', { mimeType: 'application/json', text: result.json })];
  const artifactFiles: { name: string; bytes: number; sha256: string; width?: number; height?: number }[] = [{ name: 'thingtime-draft.json', bytes: jsonBytes.length, sha256: result.hash }];
  let renderBytes = jsonBytes.length;
  for (const image of result.images) {
    const expected = expectedImages.get(image?.name);
    if (!expected || typeof image.data !== 'string' || image.width !== expected.width || image.height !== expected.height) return invalid();
    // Avoid oversized allocations even if a worker reply is malformed.
    if (image.data.length > HOSTED_RENDER_RESPONSE_MAX_BYTES) return tooLarge();
    const bytes = Buffer.from(image.data, 'base64');
    renderBytes += bytes.length * 2; // Match the native worker's artifact budget.
    if (renderBytes > RENDER_OUTPUT_MAX_BYTES) return tooLarge();
    if (bytes.toString('base64') !== image.data) return invalid();
    try {
      const { width, height } = checkRendererPng(bytes);
      if (width !== expected.width || height !== expected.height) return invalid();
    } catch {
      return invalid();
    }
    expectedImages.delete(image.name);
    artifactFiles.push({ name: image.name, bytes: bytes.length, sha256: sha256(bytes), width: expected.width, height: expected.height });
    resources.push(artifactResource(result.hash, image.name, { mimeType: 'image/png', blob: image.data }));
  }
  if (expectedImages.size) return invalid();

  const response = reply({
    structuredContent: { ok: true, delivery: 'embedded-resources', hash: result.hash, rendererHash: result.rendererHash, browserVersion: result.browserVersion, cropEnabled: result.cropEnabled, validation: { canonical: true, dependencies: 'supplied-only', actions: false, externalAssets: false },
      diagnostics: diagnostics.map(({ level, code, message }) => ({ level, code, message })), viewports, artifacts: artifactFiles.map(file => file.name), artifactFiles },
    content: [{ type: 'text', text: 'Rendered the supplied draft. Save the embedded JSON and PNG resources as files.' }, ...resources]
  });
  return Buffer.byteLength(response) <= HOSTED_RENDER_RESPONSE_MAX_BYTES ? response : tooLarge();
}
