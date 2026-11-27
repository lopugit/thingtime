'use strict';

const { build: base } = require('./package.json');
const { mac: _mac, extraFiles: _appleHelpers, ...shared } = base;

// Load this file directly; passing this object as build({ config }) would
// merge package.json again and copy every object-valued resource twice.
module.exports = {
  ...shared,
  extends: null,
  extraFiles: [],
  directories: { ...shared.directories, output: `release-${process.platform}-${process.arch}` },
  linux: { category: 'Office', icon: '../remix/public/android-icon-192x192.png' },
  win: { signAndEditExecutable: false },
};
