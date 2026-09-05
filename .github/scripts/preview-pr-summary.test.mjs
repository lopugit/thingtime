import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSummaryBody, publishPreviewSummary } from './preview-pr-summary.mjs';

test('summary is prominent, idempotent, and preserves author content byte for byte', () => {
  const author = '## Feature\n\nExact `code` and ❤️\n';
  const first = previewSummaryBody(author, 'Building');
  const next = previewSummaryBody(first, 'Ready [Preview](https://example.com)');
  assert.ok(next.startsWith('<!-- thingtime-preview-summary:start -->\nReady'));
  assert.ok(next.endsWith(author));
  assert.equal(previewSummaryBody(next, 'Ready [Preview](https://example.com)'), next);
  assert.ok(!next.includes('Building'));
});
test('malformed or duplicated markers fail without overwriting prose', () => {
  for (const body of ['<!-- thingtime-preview-summary:start -->', '<!-- thingtime-preview-summary:end -->', previewSummaryBody('', 'A').repeat(2)]) {
    assert.throws(() => previewSummaryBody(body, 'B'), /Ambiguous/);
  }
});
test('closed and moved heads are read-only; fresh body edits survive publication', async () => {
  const sha = 'a'.repeat(40);
  for (const current of [{state:'closed',head:{sha}}, {state:'open',head:{sha:'b'.repeat(40)}}]) {
    let reads = 0;
    const result = await publishPreviewSummary({ repository:'owner/repo', number:592, sha, summary:'Ready',
      request: async (_, options) => { assert.equal(options, undefined); reads++; return current; } });
    assert.equal(result.stale, true); assert.equal(reads, 1);
  }
  const calls = [];
  await publishPreviewSummary({ repository:'owner/repo', number:592, sha, summary:'Ready',
    request: async (path, options) => { calls.push({path, options}); return {state:'open',head:{sha},body:'Fresh human edit'}; } });
  assert.ok(calls[1].options.body.body.endsWith('Fresh human edit'));
  assert.equal(calls[1].options.retries, 0);
});
