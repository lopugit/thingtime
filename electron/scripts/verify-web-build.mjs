import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webOutputDir = path.join(electronDir, 'dist', 'web', '.output');
const serverEntry = path.join(webOutputDir, 'server', 'index.mjs');
const indexHtml = path.join(webOutputDir, 'public', 'index.html');

async function assertExists(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

await assertExists(serverEntry, 'Nitro server entry');
await assertExists(indexHtml, 'Vite public index');

const html = await readFile(indexHtml, 'utf8');

if (!html.includes('id="root"')) {
  throw new Error(`Electron web bundle index is missing the React root: ${indexHtml}`);
}

console.log('Electron web bundle verified.');
