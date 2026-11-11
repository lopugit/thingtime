import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inventory from '../../native-bundles/inventory.cjs';
import contract from '../../native-bundles/release.cjs';

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

const metadata = JSON.parse(await readFile(path.join(electronDir, 'dist', 'web', 'metadata.json'), 'utf8'));
if (metadata.nitroPreset !== 'node_middleware') throw new Error('Desktop requires a node_middleware Nitro bundle.');
await assertExists(serverEntry, 'Nitro server entry');
await assertExists(indexHtml, 'Vite public index');
await assertExists(aiConnectorBundle, 'AI desktop connector bundle');
await assertExists(nodeRuntimeBundle, 'Thingtime Node connector runtime');
await assertExists(path.join(electronDir, 'dist', 'mail', 'provider.cjs'), 'native mail provider bundle');
await assertSelfContained(webOutputDir);

if (process.platform === 'win32') {
  const require = createRequire(serverEntry);
  const modules = path.join(path.dirname(serverEntry), 'node_modules');
  const resolved = path.relative(modules, require.resolve('@resvg/resvg-js'));
  if (!resolved || path.isAbsolute(resolved) || resolved.split(path.sep)[0] === '..') throw new Error('Windows SVG renderer is missing from the staged server.');
  const { Resvg } = require('@resvg/resvg-js');
  const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>').render().asPng();
  if (Buffer.from(png).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Windows SVG renderer could not produce a PNG.');
}

const html = await readFile(indexHtml, 'utf8');

if (!html.includes('id="root"')) {
  throw new Error(`Electron web bundle index is missing the React root: ${indexHtml}`);
}

const stagedInventory = JSON.parse(await readFile(path.join(electronDir, 'dist', 'web-integrity.json'), 'utf8'));
if (contract.canonical(await inventory.inventoryDirectory(path.dirname(webOutputDir))) !== contract.canonical(stagedInventory)) {
  throw new Error('Staged desktop web bundle integrity changed after packaging.');
}
if (!metadata.nativeBundle || metadata.nativeBundle.runtime.id !== 'electron-node-middleware-v1') throw new Error('Missing native web bundle compatibility metadata.');
console.log('Electron web bundle verified.');
