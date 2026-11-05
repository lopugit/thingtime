#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { redactSecrets } from './security.js';
import { LOCAL_RENDER_TOOL, localAdapterEnvironment, localToolFailure, localToolTimeout } from './localCliPolicy.js';

const renderTool = LOCAL_RENDER_TOOL;
const usage = 'Usage: thingtime-local list | thingtime-local call TOOL [--output NEW_DIRECTORY] < arguments.json';

class UsageError extends Error {}

async function main() {
  const [command, name, outputFlag, output, ...extra] = process.argv.slice(2);
  if (command === '--help' && !name) {
    console.log(usage);
    return;
  }
  const listing = command === 'list' && !name;
  const rendering = name === renderTool;
  if (!listing && (command !== 'call' || !name || extra.length ||
    (rendering ? outputFlag !== '--output' || !output : outputFlag !== undefined))) {
    throw new UsageError(usage);
  }

  let args: Record<string, unknown> | undefined;
  if (!listing) {
    if (process.stdin.isTTY) throw new UsageError('Pass one JSON argument object on stdin.');
    try {
      const parsed: unknown = JSON.parse(await text(process.stdin));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      args = parsed as Record<string, unknown>;
    } catch {
      throw new UsageError('Pass one valid JSON argument object on stdin.');
    }
  }

  const env = localAdapterEnvironment(process.env);
  const client = new Client({ name: 'thingtime-local', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./index.js', import.meta.url))],
    env,
    stderr: 'ignore'
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    if (listing) {
      console.log(JSON.stringify(tools, null, 2));
      return;
    }
    if (!tools.some(tool => tool.name === name)) throw new UsageError('Unknown local Thingtime tool. Run thingtime-local list.');
    const result = CallToolResultSchema.parse(
      await client.callTool({ name, arguments: args }, undefined, { timeout: localToolTimeout(name!) })
    );
    if (result.isError) throw new UsageError(localToolFailure(name!, result));
    if (rendering && output) {
      const directory = resolve(output);
      const artifacts = [];
      for (const block of result.content) {
        if (block.type !== 'resource') continue;
        const resource = block.resource;
        const name = new URL(resource.uri).pathname.slice(1);
        if (!/^[a-z0-9-]+\.(json|png)$/.test(name)) throw new UsageError('Unexpected draft artifact name.');
        const bytes = 'text' in resource ? resource.text : Buffer.from(resource.blob, 'base64');
        artifacts.push({ name, bytes });
      }
      if (!artifacts.length) throw new UsageError('No draft artifacts returned.');
      await mkdir(directory, { mode: 0o700 });
      for (const artifact of artifacts) {
        await writeFile(resolve(directory, artifact.name), artifact.bytes, { mode: 0o600, flag: 'wx' });
      }
    }
    console.log(JSON.stringify(redactSecrets(result.structuredContent), null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  // Never print tool payloads, filesystem errors, or parser diagnostics.
  console.error(error instanceof UsageError
    ? error.message
    : 'Thingtime local operation failed. Check setup and use a new output directory for rendering.');
  process.exitCode = 1;
});
