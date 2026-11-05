import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ISOLATED_RENDER_CLEANUP_MAX_MS, ISOLATED_RENDER_DEADLINE_MS } from './isolatedRender.js';

export const LOCAL_RENDER_TOOL = 'thingtime_render_and_export';

/** Forward only the canonical local adapter settings, never the host's credentials. */
export function localAdapterEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    'THINGTIME_MCP_ALLOWED_ROOTS', 'THINGTIME_MCP_STATE_DIR', 'PLAYWRIGHT_BROWSERS_PATH',
    'THINGTIME_MCP_RENDER_IMAGE', 'THINGTIME_MCP_RENDER_SOCKET', 'THINGTIME_MCP_RENDER_DOCKER',
    'THINGTIME_MCP_RENDER_ASSETS'
  ]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function localToolTimeout(name: string): number {
  return name === LOCAL_RENDER_TOOL
    ? Math.max(240_000, ISOLATED_RENDER_DEADLINE_MS + ISOLATED_RENDER_CLEANUP_MAX_MS + 14_000)
    : 60_000;
}

/** Select fixed diagnostics; do not echo tool payloads, local paths or parser input. */
export function localToolFailure(name: string, result: CallToolResult): string {
  if (name !== LOCAL_RENDER_TOOL) return 'Local Thingtime tool rejected the request. Check the input schema, confirmation, and local setup.';
  let diagnostic = 'Check the content, dependencies and renderer setup.';
  for (const block of result.content) {
    if (block.type !== 'text' || block.text.length > 8192) continue;
    let failure: unknown;
    try { failure = JSON.parse(block.text); } catch { continue; }
    if (!failure || typeof failure !== 'object' || !('code' in failure) || failure.code !== 'RENDER_EXPORT_FAILED' ||
      !('error' in failure) || typeof failure.error !== 'string') continue;
    const message = failure.error;
    if (/Isolated rendering is disabled/.test(message)) diagnostic = 'Configure the isolated renderer with a pinned image, its Docker socket and verified renderer assets.';
    else if (/cleanup/i.test(message)) diagnostic = 'Renderer cleanup could not be verified; inspect the owned renderer before retrying.';
    else if (/deadline|timed out/i.test(message)) diagnostic = 'The renderer exceeded its deadline; simplify the content or inspect isolated renderer startup.';
    else if (/cancelled/i.test(message)) diagnostic = 'The render was cancelled.';
    else if (/Renderer busy/.test(message)) diagnostic = 'The renderer is busy; retry after the current request finishes.';
    else if (/Duplicate viewport|Draft input exceeds/.test(message)) diagnostic = 'Use unique viewport dimensions and content within the documented render limits.';
    break;
  }
  return `RENDER_EXPORT_FAILED: ${diagnostic} No artifacts were saved.`;
}
