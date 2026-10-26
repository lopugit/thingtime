#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await server.close(); process.exitCode = 0; }
  catch { console.error('Thingtime MCP shutdown could not verify isolated renderer cleanup.'); process.exitCode = 1; }
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
process.stdin.once('end', close);

await server.connect(new StdioServerTransport());
