'use strict';

const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const projectDir = path.resolve(__dirname, '..');
const fromBuilder = createRequire(require.resolve('electron-builder'));
const { getConfig } = fromBuilder('app-builder-lib/out/util/config/config.js');

test('portable packaging resolves one resource copy and excludes Apple helpers', async () => {
  const config = await getConfig(projectDir, path.join(projectDir, 'portable-builder.cjs'), null);
  assert.deepEqual(config.extraFiles, []);
  assert.equal(config.mac, undefined);
  const resources = config.extraResources.map(item => `${item.from}\0${item.to}`);
  assert.equal(new Set(resources).size, resources.length, 'duplicate destinations race when copying Windows DLLs');
  assert.equal(resources.length, require('../package.json').build.extraResources.length);
  assert.equal(config.directories.output, `release-${process.platform}-${process.arch}`);
});
