import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateOfflineManifest } from '../public/offline-shell.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const shell = await readFile(`${dist}/index.html`, 'utf8');
if (!shell.includes('id="root"') || shell.includes('/app/entry.client.tsx')) throw new Error('Build the production client before preparing offline startup');
await copyFile(`${dist}/index.html`, `${dist}/offline-shell.html`);
const paths = ['offline-shell.html', 'tt-boot.js', ...(await readdir(`${dist}/assets`)).filter(name => /^[\w.-]+\.(?:js|css|woff2?)$/.test(name)).map(name => `assets/${name}`)].sort();
const assets = await Promise.all(paths.map(async path => {
	const bytes = await readFile(`${dist}/${path}`);
	return { path: `/${path}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const manifest = { version: 1, hash: createHash('sha256').update(JSON.stringify(assets)).digest('hex'), assets };
if (!validateOfflineManifest(manifest)) throw new Error('Offline shell exceeds the asset count or size budget');
await writeFile(`${dist}/offline-shell-manifest.mjs`, `export const offlineShellManifest = ${JSON.stringify(manifest)};\n`);
console.log(`[offline] ${assets.length} verified app assets, ${assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes`);
