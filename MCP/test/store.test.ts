import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { manifestConnector } from '../src/connectors/manifest.js';
import { SnapshotStore } from '../src/store.js';

test('copies allowlisted attachment bytes into private staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'thingtime-mcp-store-'));
  const attachmentPath = join(root, 'note.txt');
  await writeFile(attachmentPath, 'hello attachment');
  const previousRoots = process.env.THINGTIME_MCP_ALLOWED_ROOTS;
  process.env.THINGTIME_MCP_ALLOWED_ROOTS = root;
  try {
    const snapshot = manifestConnector.normalize({
      format: 'thingtime.ai-desktop-export', version: 1, app: 'Example AI',
      files: [{ id: 'f1', name: 'note.txt', path: attachmentPath }],
      conversations: [{ id: 'c1', title: 'Chat', messages: [] }]
    }, { sourcePath: join(root, 'export.json'), sourceSha256: 'abc', includeRawMetadata: false, now: '2026-07-13T00:00:00.000Z' });
    const store = new SnapshotStore(join(root, 'state'));
    const summary = await store.save(snapshot);
    const staged = await store.get(summary.id);
    assert.equal(staged.files[0].metadata.thingtimeCapture && (staged.files[0].metadata.thingtimeCapture as any).status, 'copied');
    assert.equal(await readFile(staged.files[0].sourcePath!, 'utf8'), 'hello attachment');
    assert.match(staged.files[0].sha256!, /^[a-f0-9]{64}$/);
  } finally {
    if (previousRoots === undefined) delete process.env.THINGTIME_MCP_ALLOWED_ROOTS;
    else process.env.THINGTIME_MCP_ALLOWED_ROOTS = previousRoots;
  }
});
