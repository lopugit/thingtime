'use strict';
const { parseVersion } = require('../../native-bundles/release.cjs');
function createNativeBundleBuildMetadata({ inspected, packageVersion, releaseVersion }) {
  const shellVersion = String(releaseVersion || '').trim() || packageVersion;
  parseVersion(shellVersion);
  if (!['darwin', 'linux', 'win32'].includes(inspected?.platform) || !['arm64', 'x64'].includes(inspected?.arch) ||
      !/^\d+$/.test(inspected?.versions?.modules || '')) throw new Error('Incomplete packaged Electron ABI.');
  parseVersion(inspected.versions.electron);
  parseVersion(inspected.versions.node);
  return {
    target: { platform: inspected.platform, arch: inspected.arch },
    runtime: {
      id: 'electron-node-middleware-v1',
      nativeAbi: `electron-${inspected.versions.electron}-node-${inspected.versions.node}-modules-${inspected.versions.modules}`,
      shellVersion
    },
    entrypoints: { renderer: '.output/public/index.html', server: '.output/server/index.mjs' }
  };
}
function assertStagedNativeBundle(metadata, { platform, arch, shellVersion }) {
  parseVersion(shellVersion);
  if (metadata?.runtime?.shellVersion !== shellVersion || metadata?.target?.platform !== platform || metadata?.target?.arch !== arch) {
    throw new Error('Staged web bundle does not match this portable shell version or target. Rebuild its web resources.');
  }
}
module.exports = { createNativeBundleBuildMetadata, assertStagedNativeBundle };
