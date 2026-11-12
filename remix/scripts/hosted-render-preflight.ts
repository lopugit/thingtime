import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { decodeRenderResult, saveRenderResult } from '../../MCP/scripts/save-render-artifacts.mjs';
import { RENDER_WORKER_PROTOCOL, parseRenderInput } from '../../MCP/src/renderContract';
import { prepareDraft } from '../app/draftPreview/prepare';
import { createHostedRenderWorkerDependencies, executeHostedRender, parseHostedRenderConfig } from '../app/api/utils/chatgpt/hostedRender.server';

// Operator-only: launches two paid, isolated test VMs using the selected
// provider account. This script does not save configuration or deploy anything.
async function main() {
  const [origin, snapshotId, rendererHash, ...extra] = process.argv.slice(2);
  const config = parseHostedRenderConfig(JSON.stringify({ origin, snapshotId, rendererHash, protocol: RENDER_WORKER_PROTOCOL }), origin);
  if (extra.length || !config) throw new Error('Usage: hosted-render-preflight.ts <exact-https-origin> <snap_id> <renderer-sha256>');
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID, projectId = process.env.VERCEL_PROJECT_ID;
  if (token && (!teamId || !projectId)) throw new Error('Explicit operator authentication requires VERCEL_TEAM_ID and VERCEL_PROJECT_ID.');
  // These go only to the SDK control plane, never VM env, caller data or output.
  const dependencies = createHostedRenderWorkerDependencies(token ? { token, teamId: teamId!, projectId: projectId! } : undefined);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const content = JSON.parse(await readFile(new URL('../../MCP/test/fixtures/affirmation.transfer.json', import.meta.url), 'utf8'));
    const expectedHash = (await prepareDraft(content)).hash;
    const expectedText = content.things[1].crystal.args[0].default;
    const render = (input: unknown) => executeHostedRender(config, 1, parseRenderInput(input), controller.signal, dependencies, expectedHash);
    const success = JSON.parse(await render({ content, crop: { blockId: 'card' } })).result;
    if (success.isError) throw new Error('Render preflight failed: ' + success.structuredContent.code);
    const metadata = success.structuredContent;
    assert.equal(metadata.rendererHash, rendererHash);
    assert.equal(metadata.hash, expectedHash);
    assert.ok(metadata.viewports.every((viewport: { text: string }) => viewport.text === expectedText));
    assert.equal(metadata.artifacts.length, 5);
    assert.equal(metadata.viewports.length, 3);
    assert.equal(decodeRenderResult(success, { host: 'Hosted snapshot preflight', server: 'thingtime' }).files.size, 5);
    const bad = JSON.parse(await render({ content, crop: { blockId: 'nonexistent' } })).result;
    assert.equal(bad.structuredContent.code, 'RENDER_REJECTED');
    assert.deepEqual(bad.structuredContent.artifacts, []);
    assert.equal(bad.content.some((block: { type: string }) => block.type === 'resource'), false);
    if (process.env.TT_HOSTED_RENDER_PREFLIGHT_OUTPUT) {
      await saveRenderResult(success, process.env.TT_HOSTED_RENDER_PREFLIGHT_OUTPUT,
        { host: 'Hosted snapshot preflight', server: 'thingtime', snapshotId, rendererHash });
    }
    // Only after successful native rendering, strict refusals and confirmed
    // cleanup may the operator save this exact origin/snapshot descriptor.
    process.stdout.write(JSON.stringify(config) + '\n');
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Hosted render preflight failed.');
  process.exitCode = 1;
});
