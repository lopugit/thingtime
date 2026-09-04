import { access, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webOutputDir = path.join(electronDir, 'dist', 'web', '.output');
const serverEntry = path.join(webOutputDir, 'server', 'index.mjs');
const indexHtml = path.join(webOutputDir, 'public', 'index.html');
const aiConnectorBundle = path.join(electronDir, 'dist', 'ai', 'ai-connectors.mjs');
const nodeRuntimeBundle = path.join(electronDir, 'dist', 'ai', 'thingtime-node-runtime.mjs');

async function assertExists(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

async function assertSelfContained(root) {
  const pending = [root];

  while (pending.length) {
    const current = pending.pop();
    const stat = await lstat(current);

    if (stat.isSymbolicLink()) {
      throw new Error(`Electron web bundle contains a symbolic link: ${current}`);
    }

    if (!stat.isDirectory()) continue;
    const entries = await readdir(current);
    for (const entry of entries) pending.push(path.join(current, entry));
  }
}

await assertExists(serverEntry, 'Nitro server entry');
await assertExists(indexHtml, 'Vite public index');
await assertExists(aiConnectorBundle, 'AI desktop connector bundle');
await assertExists(nodeRuntimeBundle, 'Thingtime Node connector runtime');
await assertSelfContained(webOutputDir);

const html = await readFile(indexHtml, 'utf8');

if (!html.includes('id="root"')) {
  throw new Error(`Electron web bundle index is missing the React root: ${indexHtml}`);
}

console.log('Electron web bundle verified.');
