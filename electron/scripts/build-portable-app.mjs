import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { build, Platform, Arch } from 'electron-builder';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!['linux', 'win32'].includes(process.platform)) throw new Error('Build the portable desktop package on its target Linux or Windows host. macOS uses the existing signed build.');
if (!['arm64', 'x64'].includes(process.arch)) throw new Error('Portable desktop builds require ARM64 or x64.');
if (process.argv.slice(2).some(arg => arg !== '--staged')) throw new Error('The only optional argument is --staged (verify and package existing web resources).');
for (const script of [...(process.argv.includes('--staged') ? [] : ['build-web.mjs']), 'verify-web-build.mjs']) {
  const result = spawnSync(process.execPath, [path.join(projectDir, 'scripts', script)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${script} failed.`);
}
const { build: base } = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
const { mac: _mac, extraFiles: _appleHelpers, ...shared } = base;
const packageApp = () => build({
  projectDir,
  targets: (process.platform === 'linux' ? Platform.LINUX : Platform.WINDOWS).createTarget(['dir'], Arch[process.arch]),
  config: {
    ...shared, extends: null, extraFiles: [],
    directories: { ...shared.directories, output: `release-${process.platform}-${process.arch}` },
    linux: { category: 'Office', icon: '../remix/public/android-icon-192x192.png' },
    win: { signAndEditExecutable: false },
  },
  publish: 'never',
});
try {
  await packageApp();
} catch (error) {
  if (process.platform !== 'win32' || error.code !== 'EBUSY') throw error;
  // A Windows resource scan can briefly hold a copied DLL. The packager
  // clears only its own output directory before rebuilding from staged inputs.
  console.warn('A Windows package resource was busy. Retrying packaging once.');
  await setTimeout(2000);
  await packageApp();
}
console.log('Portable desktop package built. This is an unsigned directory build; OS signing and distribution remain separate.');
