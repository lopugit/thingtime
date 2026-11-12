#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const output = resolve(process.argv[2] || 'draft-artifacts');
const client = new Client({ name: 'thingtime-draft-example', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))] }));
try {
  const content = JSON.parse(await readFile(new URL('../test/fixtures/affirmation.transfer.json', import.meta.url), 'utf8'));
  const result = await client.callTool({ name: 'thingtime_render_and_export', arguments: { content, root: 'affirmation-page', crop: { enabled: true, blockId: 'card' } } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  await mkdir(output, { recursive: true });
  for (const item of result.content) if (item.type === 'resource') {
    const name = new URL(item.resource.uri).pathname.split('/').pop();
    if (!/^[a-z0-9-]+\.(json|png)$/.test(name)) throw new Error('Unexpected artifact name');
    await writeFile(resolve(output, name), item.resource.text ?? Buffer.from(item.resource.blob, 'base64'));
  }
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(result.structuredContent, null, 2));
  console.log(`Saved native Thingtime artifacts in ${output}`);
} finally { await client.close(); }
