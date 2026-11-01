import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { SnapshotStore } from '../src/store.js';

test('negotiates MCP and exposes the consent-first tool surface', async () => {
  const state = await mkdtemp(join(tmpdir(), 'thingtime-mcp-server-'));
  const server = createServer(new SnapshotStore(state));
  const client = new Client({ name: 'thingtime-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes('thingtime_capabilities'));
    assert.ok(names.includes('thingtime_ingest_current_chat'));
    assert.ok(names.includes('thingtime_import_archive'));
    assert.ok(names.includes('thingtime_prepare_ingestion'));
    const result = await client.callTool({ name: 'thingtime_list_imports', arguments: {} });
    assert.equal(result.isError, undefined);
  } finally {
    await client.close();
    await server.close();
  }
});
