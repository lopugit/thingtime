/** Guard the actual Vite output: package sideEffects:false drops unused setup. */
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
const assets = new URL('../dist/assets/', import.meta.url);
export const pdfRuntimeAsset = async () => {
  const matches = (await readdir(assets)).filter(name => /^pdfRuntime\.client-[\w-]+\.js$/.test(name));
  assert.equal(matches.length, 1, 'Expected one built PDF runtime chunk');
  return matches[0];
};
const runtime = await pdfRuntimeAsset();
const source = await readFile(new URL(runtime, assets), 'utf8');
assert.ok(source.includes('/pdfjs/pdf.worker.min.mjs'), 'Built PDF runtime lost its worker initialization');
assert.ok(source.includes('getPdfRuntime'), 'Built PDF runtime must export the called initializer');
assert.ok((await stat(new URL('../dist/pdfjs/pdf.worker.min.mjs', import.meta.url))).size > 0, 'PDF worker must be bundled');
console.log('[verify] Built PDF runtime retains the called initializer and self-hosted worker');
