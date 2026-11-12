'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

const NATIVE_PACKAGES = ['bcrypt', 'sharp', '@resvg/resvg-js', 'cbor-extract'];

// Nitro traces native dependencies for the Mac that packages the app. Replace
// complete package roots with the same locked versions installed for Linux,
// including their platform-specific optional dependencies. Never reuse a host
// binary or resolve packages over the network when a task launches.
async function prepareNative(applicationRoot = '/opt/thingtime-app', runtimeRoot = __dirname) {
  const server = path.join(applicationRoot, 'server');
  try { await fs.access(path.join(server, 'index.mjs')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const runtime = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'package.json'), 'utf8'));
  const prepared = [];
  for (const name of NATIVE_PACKAGES) {
    const target = path.join(server, 'node_modules', name);
    let traced;
    try { traced = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const source = path.join(runtimeRoot, 'node_modules', name);
    const installed = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    if (traced.version !== runtime.dependencies[name] || installed.version !== traced.version) {
      throw new Error(`Update the isolated runtime lock to match the bundled ${name} version.`);
    }
    await fs.rm(target, { recursive: true, force: true });
    await fs.symlink(source, target, 'dir');
    prepared.push(name);
  }
  // Resolve from the app, not just the runtime. A missing/wrong-architecture
  // addon fails the image build before the install is offered for claiming.
  const load = createRequire(path.join(server, 'index.mjs'));
  for (const name of prepared) load(name);
  return prepared;
}

if (require.main === module) prepareNative().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareNative, NATIVE_PACKAGES };
