'use strict';

const { build: base, version } = require('./package.json');
const { mac: _mac, extraFiles: _appleHelpers, ...shared } = base;

// Load this file directly; passing this object as build({ config }) would
// merge package.json again and copy every object-valued resource twice.
module.exports = {
  ...shared,
  extends: null,
  extraFiles: [],
  extraMetadata: { ...shared.extraMetadata, version: String(process.env.THINGTIME_ELECTRON_RELEASE_VERSION || '').trim() || version },
  directories: { ...shared.directories, output: `release-${process.platform}-${process.arch}` },
  linux: { category: 'Office', icon: '../remix/public/android-icon-192x192.png' },
  win: { signAndEditExecutable: false },
};
