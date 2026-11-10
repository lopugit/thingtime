import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';

import { nextDesktopSyncBatch, prepareDesktopSync } from '../src/desktop.js';
import { importArchiveBytes } from '../src/importer.js';

test('imports ChatGPT zip exports and preserves project names without source paths', () => {
  const conversations = [{
    id: 'chat-1',
    title: 'Bridge',
    project_id: 'project-1',
    mapping: {
      user: { message: { id: 'm1', author: { role: 'user' }, create_time: 1, content: { parts: ['Hello'] } } },
      assistant: { message: { id: 'm2', author: { role: 'assistant' }, create_time: 2, content: { parts: ['Hi'] } } }
    }
  }];
  const bytes = zipSync({
    'export/conversations.json': strToU8(JSON.stringify(conversations)),
    'export/projects.json': strToU8(JSON.stringify([{ id: 'project-1', name: 'Thingtime' }]))
  });
  const snapshot = importArchiveBytes(bytes, null);
  assert.equal(snapshot.conversations[0].metadata.groupName, 'Thingtime');
  assert.equal(snapshot.conversations[0].provenance.sourcePath, null);
});

test('prepares consented exports as ordered bounded batches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'thingtime-ai-desktop-'));
  const path = join(root, 'conversations.json');
  try {
    await writeFile(path, JSON.stringify([{
      id: 'chat-1',
      title: 'Bridge',
      mapping: {
        user: { message: { id: 'm1', author: { role: 'user' }, create_time: 1, content: { parts: ['Hello'] } } },
        assistant: { message: { id: 'm2', author: { role: 'assistant' }, create_time: 2, content: { parts: ['Hi'] } } }
      }
    }]));
    const prepared = await prepareDesktopSync({ sourceId: 'chatgpt', mode: 'export', archivePath: path });
    assert.deepEqual(prepared.totals, { groups: 0, conversations: 1, messages: 2 });
    assert.deepEqual(prepared.records.map((record) => record.kind), ['conversation', 'message', 'message']);
    assert.equal(JSON.stringify(prepared).includes(root), false);
    const batch = nextDesktopSyncBatch(prepared, 0);
    assert.equal(batch.final, true);
    assert.equal(batch.conversations[0].title, 'Bridge');
    assert.deepEqual(batch.messages.map((message) => message.role), ['user', 'assistant']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
