import assert from 'node:assert/strict';
import test from 'node:test';
import { chatGptConnector } from '../src/connectors/chatgpt.js';
import { claudeConnector } from '../src/connectors/claude.js';
import { manifestConnector } from '../src/connectors/manifest.js';
import { prepareIngestion } from '../src/ingestion.js';
import { ingestCurrentConversation } from '../src/importer.js';

const context = { sourcePath: '/allowed/export.json', sourceSha256: 'abc', includeRawMetadata: false, now: '2026-07-13T00:00:00.000Z' };

test('normalizes ChatGPT exports in chronological order', () => {
  const snapshot = chatGptConnector.normalize([{
    id: 'chat-1', title: 'Hello', create_time: 1,
    mapping: {
      assistant: { message: { id: 'm2', author: { role: 'assistant' }, create_time: 2, content: { parts: ['Hi!'] } } },
      user: { message: { id: 'm1', author: { role: 'user' }, create_time: 1, content: { parts: ['Hello'] } } }
    }
  }], context);
  assert.equal(snapshot.conversations[0].messages[0].id, 'm1');
  assert.equal(snapshot.conversations[0].messages[1].parts[0].text, 'Hi!');
});

test('normalizes Claude exports and attachments', () => {
  const snapshot = claudeConnector.normalize([{
    uuid: 'chat-1', name: 'Files', chat_messages: [{ uuid: 'm1', sender: 'human', text: 'See file', attachments: [{ file_name: 'a.txt' }] }]
  }], context);
  assert.equal(snapshot.conversations[0].messages[0].role, 'user');
  assert.equal(snapshot.conversations[0].messages[0].attachments[0].name, 'a.txt');
});

test('redacts secrets from portable manifest settings', () => {
  const snapshot = manifestConnector.normalize({
    format: 'thingtime.ai-desktop-export', version: 1, app: { name: 'Example AI' },
    settings: { theme: 'dark', apiKey: 'nope' },
    conversations: [{ id: 'c1', title: 'Chat', messages: [] }]
  }, context);
  assert.equal(snapshot.settings.apiKey, '[redacted]');
  assert.equal(snapshot.settings.theme, 'dark');
});

test('prepares relational parent and child ingestion records', () => {
  const snapshot = claudeConnector.normalize([{ uuid: 'c1', name: 'Chat', chat_messages: [{ uuid: 'm1', sender: 'assistant', text: 'Hello' }] }], context);
  const records = prepareIngestion(snapshot);
  assert.deepEqual(records.map((record) => record.thingtime[0]), ['ai-chat', 'ai-chat-message']);
  assert.equal(records[1].parentExternalId, records[0].externalId);
});

test('redacts credential fields supplied by an MCP host', () => {
  const snapshot = ingestCurrentConversation({
    schemaVersion: 1,
    id: 'c1',
    source: { app: 'Example AI', connector: 'host', accountId: null, workspaceId: null },
    title: 'Chat', createdAt: null, updatedAt: null, participants: [], messages: [], attachments: [],
    settings: { theme: 'dark', accessToken: 'do-not-stage' }, metadata: {}
  });
  assert.equal(snapshot.conversations[0].settings.accessToken, '[redacted]');
});
