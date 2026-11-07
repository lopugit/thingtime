#!/usr/bin/env node
// Deliberately separate from dist/index.js: no SnapshotStore or import tools.
import { networkInterfaces } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registerRenderExport, renderInput } from '../dist/renderExport.js';

if (process.env.THINGTIME_RENDER_ISOLATED !== '1' || process.getuid?.() === 0 ||
    Object.values(networkInterfaces()).flat().some(address => !address.internal)) {
  throw new Error('Use the isolated renderer launcher with a non-root, network-none container.');
}
const server = new McpServer({ name: 'thingtime-draft-renderer', version: '0.1.0' });
registerRenderExport(server);
server.registerTool('thingtime_capabilities', {
  description: 'Describe this no-login, render-only server and its canonical input contract.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, async () => {
  const capabilities = {
    renderExport: 'thingtime_render_and_export',
    inputSchema: z.toJSONSchema(renderInput),
    artifacts: ['embedded application/json resource', 'image/png image and embedded blob resource'],
    persistence: false,
    accountAccess: false
  };
  return { content: [{ type: 'text', text: JSON.stringify(capabilities) }], structuredContent: capabilities };
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
process.stdin.once('end', close);
await server.connect(new StdioServerTransport());
