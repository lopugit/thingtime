import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build, Platform, Arch } from 'electron-builder';
import { readFile } from 'node:fs/promises';
import { assertStagedNativeBundle } from './native-bundle-metadata.cjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!['linux', 'win32'].includes(process.platform)) throw new Error('Build the portable desktop package on its target Linux or Windows host. macOS uses the existing signed build.');
if (!['arm64', 'x64'].includes(process.arch)) throw new Error('Portable desktop builds require ARM64 or x64.');
if (process.argv.slice(2).some(arg => arg !== '--staged')) throw new Error('The only optional argument is --staged (verify and package existing web resources).');
for (const script of [...(process.argv.includes('--staged') ? [] : ['build-web.mjs']), 'verify-web-build.mjs']) {
  const result = spawnSync(process.execPath, [path.join(projectDir, 'scripts', script)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${script} failed.`);
}
const packageMetadata = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'));
const stagedMetadata = JSON.parse(await readFile(path.join(projectDir, 'dist/web/metadata.json'), 'utf8')).nativeBundle;
const packagedVersion = String(process.env.THINGTIME_ELECTRON_RELEASE_VERSION || '').trim() || packageMetadata.version;
assertStagedNativeBundle(stagedMetadata, { platform: process.platform, arch: process.arch, shellVersion: packagedVersion });
await build({
  projectDir,
  targets: (process.platform === 'linux' ? Platform.LINUX : Platform.WINDOWS).createTarget(['dir'], Arch[process.arch]),
  // An object here is merged with package.json, concatenating its resource
  // arrays and retaining Apple helpers. A file is the complete configuration.
  config: path.join(projectDir, 'portable-builder.cjs'),
  publish: 'never',
});
console.log('Portable desktop package built. This is an unsigned directory build; OS signing and distribution remain separate.');
