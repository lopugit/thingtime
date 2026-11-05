import { fork } from 'node:child_process';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const renderInput = z.object({
  content: z.union([z.string().max(262144), z.record(z.string(), z.unknown())]).describe('Caller-supplied canonical Thing or thingtime.transfer v1; text/CSS only, all dependencies included'),
  root: z.string().max(200).optional(),
  viewports: z.array(z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(320).max(1440) }).strict()).min(1).max(3).default([{ width: 1440, height: 1000 }, { width: 390, height: 844 }]),
  crop: z.object({ enabled: z.boolean().default(true), blockId: z.string().regex(/^[\w-]{1,128}$/).optional() }).strict().default({ enabled: true })
}).strict();
export type RenderInput = z.infer<typeof renderInput>;
export type RenderOutput = { ok: true; rendererHash: string; browserVersion: string; cropEnabled: boolean; json: string; hash: string; diagnostics: unknown[]; viewports: unknown[]; images: { name: string; data: string; width: number; height: number }[] };
let active = false;

export function parseRenderInput(raw: unknown): RenderInput {
  const input = renderInput.parse(raw);
  if (Buffer.byteLength(typeof input.content === 'string' ? input.content : JSON.stringify(input.content)) > 262144) throw new Error('Draft input exceeds 256 KiB');
  const dimensions = input.viewports.map(viewport => `${viewport.width}x${viewport.height}`);
  if (new Set(dimensions).size !== dimensions.length) throw new Error('Duplicate viewport dimensions; request each width and height pair only once');
  return input;
}

export function renderViewports(input: RenderInput): RenderInput['viewports'] {
  const viewports = [...input.viewports];
  if (!viewports.some(viewport => viewport.width === 320)) viewports.push({ width: 320, height: 844 });
  return viewports;
}

/** A separate process bounds validation, browser startup, rendering and encoding.
 * No host credentials, user browser profile, URL or destination path is accepted.
 */
export async function renderAndExport(raw: unknown): Promise<RenderOutput> {
  const input = parseRenderInput(raw);
  if (active) throw new Error('Renderer busy; retry after the current request finishes');
  active = true;
  try {
    return await new Promise<RenderOutput>((resolve, reject) => {
      const worker = fork(new URL('./renderWorker.js', import.meta.url), [], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: ['--max-old-space-size=512'],
        // Browser executable lookup needs HOME; never forward application credentials.
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) }
      });
      worker.stderr?.resume();
      const timer = setTimeout(() => { worker.kill('SIGKILL'); reject(new Error('Render deadline exceeded (30 seconds); no artifacts returned')); }, 30000);
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Renderer exited (${code}) without completing; no artifacts returned`)); });
      worker.once('message', (message: any) => {
        clearTimeout(timer);
        if (message.ok) resolve(message); else reject(new Error(message.error || 'Render failed'));
      });
      worker.send(input);
    });
  } finally { active = false; }
}
export type RenderExecutor = (input: RenderInput, signal?: AbortSignal) => Promise<CallToolResult>;

export async function renderAndExportResult(input: RenderInput): Promise<CallToolResult> {
  const result = await renderAndExport(input);
  const { images, json, ...metadata } = result;
  return {
    structuredContent: { ...metadata, artifacts: ['thingtime-draft.json', ...images.map(image => image.name)] },
    content: [
      { type: 'text', text: JSON.stringify(metadata) },
      { type: 'resource', resource: { uri: `thingtime-draft://${result.hash}/thingtime-draft.json`, mimeType: 'application/json', text: json } },
      ...images.flatMap(image => [
        { type: 'image' as const, mimeType: 'image/png', data: image.data },
        { type: 'resource' as const, resource: { uri: `thingtime-draft://${result.hash}/${image.name}`, mimeType: 'image/png', blob: image.data } }
      ])
    ]
  };
}

export function registerRenderExport(server: McpServer, execute: RenderExecutor = renderAndExportResult) {
  server.registerTool('thingtime_render_and_export', {
    title: 'Render and export a no-login Thingtime draft',
    description: 'Validate supplied portable content, render through native Thingtime components in an isolated offline browser, and return canonical JSON plus desktop/mobile/card PNG artifacts. No account, Actions, network assets, persistence or publishing. The normal Thingtime MCP delegates this tool to its configured network-none container; see thingtime_capabilities for configuration status.',
    inputSchema: renderInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, async (input, extra) => {
    try {
      return await execute(input, extra.signal);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'RENDER_EXPORT_FAILED', error: error instanceof Error ? error.message : 'Render failed', artifacts: [] }) }] };
    }
  });
}
