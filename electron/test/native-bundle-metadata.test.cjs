'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeBundleBuildMetadata, assertStagedNativeBundle } = require('../scripts/native-bundle-metadata.cjs');
const inspected = { platform: 'darwin', arch: 'arm64', versions: { electron: '43.1.0', node: '24.18.0', modules: '148' } };
test('bundle shell version matches the actual release override without dropping prerelease or build metadata', () => {
  const metadata = createNativeBundleBuildMetadata({ inspected, packageVersion: '0.1.2', releaseVersion: '  1.4.0-beta.2.unsigned+build.007  ' });
  assert.equal(metadata.runtime.shellVersion, '1.4.0-beta.2.unsigned+build.007');
  assert.equal(metadata.runtime.nativeAbi, 'electron-43.1.0-node-24.18.0-modules-148');
  assert.deepEqual(metadata.target, { platform: 'darwin', arch: 'arm64' });
});
test('default and blank override builds retain the package version', () => {
  for (const releaseVersion of [undefined, '', '  ']) {
    assert.equal(createNativeBundleBuildMetadata({ inspected, packageVersion: '0.1.2', releaseVersion }).runtime.shellVersion, '0.1.2');
  }
});
test('invalid release versions and incomplete runtime inspection fail before packaging', () => {
  for (const releaseVersion of ['v1.0.0', '1.02.3', '1.0.0-01', '1.0.0+']) {
    assert.throws(() => createNativeBundleBuildMetadata({ inspected, packageVersion: '0.1.2', releaseVersion }), /semantic version/);
  }
  assert.throws(() => createNativeBundleBuildMetadata({ inspected: { ...inspected, versions: {} }, packageVersion: '0.1.2' }), /ABI/);
});
test('portable packaging uses the same release version and refuses stale or cross-target staged output', () => {
  const original = process.env.THINGTIME_ELECTRON_RELEASE_VERSION;
  const configPath = require.resolve('../portable-builder.cjs');
  try {
    process.env.THINGTIME_ELECTRON_RELEASE_VERSION = ' 1.4.0-beta.2.unsigned ';
    delete require.cache[configPath];
    const packagedVersion = require(configPath).extraMetadata.version;
    const metadata = createNativeBundleBuildMetadata({ inspected, packageVersion: '0.1.2', releaseVersion: process.env.THINGTIME_ELECTRON_RELEASE_VERSION });
    assert.equal(packagedVersion, metadata.runtime.shellVersion);
    assert.doesNotThrow(() => assertStagedNativeBundle(metadata, { platform: 'darwin', arch: 'arm64', shellVersion: packagedVersion }));
    for (const host of [
      { platform: 'darwin', arch: 'arm64', shellVersion: '0.1.2' },
      { platform: 'linux', arch: 'arm64', shellVersion: packagedVersion },
      { platform: 'darwin', arch: 'x64', shellVersion: packagedVersion }
    ]) assert.throws(() => assertStagedNativeBundle(metadata, host), /does not match/);
  } finally {
    if (original === undefined) delete process.env.THINGTIME_ELECTRON_RELEASE_VERSION;
    else process.env.THINGTIME_ELECTRON_RELEASE_VERSION = original;
    delete require.cache[configPath];
  }
});
