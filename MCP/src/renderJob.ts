/** Internal entry point for a single, isolated hosted render. No listener or account runtime. */
import { readFile } from 'node:fs/promises';

import { MAX_RENDER_RPC_BYTES, RENDER_WORKER_PROTOCOL, parseRenderInput } from './renderContract.js';
import { renderAndExport } from './renderExport.js';

const safeError = (error: unknown) => {
  const line = error instanceof Error ? error.message.split('\n')[0] : '';
  if (line.startsWith('page.evaluate: Error: ')) return { code: 'RENDER_REJECTED', error: line.slice(22, 400) };
  if (line.startsWith('Render deadline exceeded')) return { code: 'RENDER_TIMEOUT', error: 'The native renderer exceeded its deadline; no artifacts returned.' };
  if (line.startsWith('Output limit exceeded')) return { code: 'RENDER_OUTPUT_LIMIT', error: 'The native renderer exceeded its output budget; no artifacts returned.' };
  return { code: 'RENDER_FAILED', error: 'The native renderer failed; no artifacts returned.' };
};

async function job() {
  // The VM control plane also checks the snapshot/network/persistence and
  // launches this fixed command as a distinct user with no-new-privileges.
  const status = await readFile('/proc/self/status', 'utf8');
  if (!process.getuid || process.getuid() === 0 || !/^NoNewPrivs:\s+1$/m.test(status) || !/^CapEff:\s+0+$/m.test(status)) {
    return { ok: false, code: 'RENDER_ISOLATION', error: 'The renderer could not verify its unprivileged execution boundary.' };
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_RENDER_RPC_BYTES) return { ok: false, code: 'RENDER_INPUT_LIMIT', error: 'The render request exceeds its transport budget.' };
    chunks.push(buffer);
  }
  let input;
  try {
    input = parseRenderInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return { ok: false, code: 'RENDER_INVALID_INPUT', error: 'The isolated renderer refused invalid render arguments.' };
  }
  try {
    return await renderAndExport(input);
  } catch (error) {
    return { ok: false, ...safeError(error) };
  }
}

void job().then(
  result => process.stdout.write(JSON.stringify({ protocol: RENDER_WORKER_PROTOCOL, result })),
  () => { process.exitCode = 1; }
);
