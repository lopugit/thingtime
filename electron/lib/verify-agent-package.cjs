'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Execute module resolution in the built Electron runtime: a source-only test
// cannot detect electron-builder moving an imported file out of app.asar.
function verifyAgentPackage(appPath, run = spawnSync, { required = false } = {}) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  const script = `
    const { createRequire } = require('node:module');
    const { accessSync, existsSync, readFileSync } = require('node:fs');
    const load = createRequire(${JSON.stringify(path.join(resources, 'app.asar', 'main.cjs'))});
    (async () => {
      const main = readFileSync(${JSON.stringify(path.join(resources, 'app.asar', 'main.cjs'))}, 'utf8');
      const advertised = main.includes('./lib/agent-browsers/desktop.cjs') || existsSync(${JSON.stringify(path.join(resources, 'agent-browser.mjs'))});
      if (!${JSON.stringify(required)} && !advertised) {
        console.log('THINGTIME_LEGACY_PACKAGE_OK'); return;
      }
      load('./lib/agent-browsers/desktop.cjs');
      load('./lib/agent-browsers/runtime/browser-driver.cjs');
      await import(load.resolve('puppeteer-core'));
      await import(load.resolve('@puppeteer/browsers'));
      for (const file of ['Dockerfile', 'runtime.cjs', 'application.cjs', 'browser-driver.cjs', 'prepare-native.cjs', 'package.json', 'package-lock.json', 'seccomp.json', 'install.mjs']) {
        accessSync(${JSON.stringify(path.join(resources, 'agent-browser-runtime'))} + '/' + file);
      }
      accessSync(${JSON.stringify(path.join(resources, 'agent-browser.mjs'))});
      console.log('THINGTIME_AGENT_PACKAGE_OK');
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  const result = run(path.join(appPath, 'Contents', 'MacOS', 'Thingtime'), ['-e', script], {
    env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0 || !/THINGTIME_(?:AGENT|LEGACY)_PACKAGE_OK/.test(result.stdout || '')) {
    throw new Error(`Packaged agent browser module check failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}
module.exports = { verifyAgentPackage };
