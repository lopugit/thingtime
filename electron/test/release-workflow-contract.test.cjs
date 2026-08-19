'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateControlPlane, validateEntryShim } = require('../scripts/release-workflow-contract.cjs');

test('main entry workflow is a non-executable protected-ref shim', () => {
	const source = readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'electron-release.yml'), 'utf8');
	assert.equal(validateEntryShim(source), true);
});

test('control-plane contract accepts only tested Developer ID publication after dist', () => {
	const source = `
on:
  workflow_call:
jobs:
  release:
    steps:
      - run: corepack pnpm --dir MCP install --frozen-lockfile
      - run: |
          corepack pnpm --dir MCP run typecheck
          corepack pnpm --dir MCP test
          corepack pnpm --dir MCP run build:desktop
          swift test --package-path macos/ThingtimeNode
          swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNode
          swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNodeBridge
          corepack pnpm --dir electron test
      - env:
          MAC_CSC_LINK: secret
          APPLE_API_KEY: secret
        run: |
          identity="Developer ID Application: Example"
          security import certificate.p12
      - run: corepack pnpm --dir electron run dist
      - run: gh release create tag artifact
      - if: always()
        run: security delete-keychain temporary.keychain-db
`;
	assert.equal(validateControlPlane(source), true);
});

test('control-plane contract rejects the former unsigned publisher', () => {
	const source = `
on:
  workflow_call:
  workflow_dispatch:
jobs:
  release:
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    steps:
      - run: corepack pnpm --dir electron run dist:unsigned
      - run: gh release create tag artifact
`;
	assert.throws(() => validateControlPlane(source), /missing|required|forbidden/u);
});

test('packaging contract ignores the complete pre-signed native app', () => {
	const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
	const patterns = packageJson.build.mac.signIgnore.map((value) => new RegExp(value));
	for (const relativePath of [
		'Contents/Helpers/Thingtime Node.app',
		'Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNode',
		'Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNodeBridge'
	]) {
		assert.equal(patterns.some((pattern) => pattern.test(relativePath)), true, relativePath);
	}
	assert.deepEqual(
		packageJson.build.extraFiles.map((entry) => entry.to),
		['Helpers/Thingtime Node.app']
	);
	assert.equal(packageJson.build.extraFiles.some((entry) => /LaunchAgents/iu.test(entry.to)), false);
});

test('local and production builders use the exact package-manager pin through Corepack', () => {
	const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
	assert.match(packageJson.packageManager, /^pnpm@\d+\.\d+\.\d+$/u);
	assert.doesNotMatch(packageJson.scripts['build:resources'], /\bpnpm\b/u);
	assert.doesNotMatch(packageJson.scripts.dev, /\bpnpm\b/u);
	for (const script of ['build-local-app.mjs', 'build-production-app.mjs']) {
		const source = readFileSync(path.resolve(__dirname, '..', 'scripts', script), 'utf8');
		assert.match(source, /run\('corepack', \[packageManager, 'run', 'build:resources'\]/u, script);
		assert.match(source, /createPinnedPnpmEnvironment\(packageManager,/u, script);
		assert.match(source, /env: pinnedPnpm\.environment/u, script);
		assert.doesNotMatch(source, /run\('pnpm'/u, script);
	}
});
