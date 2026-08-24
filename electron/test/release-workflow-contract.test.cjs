'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateControlPlane, validateEntryShim } = require('../scripts/release-workflow-contract.cjs');

test('main entry workflow is a non-executable protected-ref shim', () => {
	const source = readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'electron-release.yml'), 'utf8');
	assert.equal(validateEntryShim(source), true);
});

test('control-plane contract accepts tested signed and clearly labelled unsigned publication', () => {
	const source = `
on:
  workflow_call:
  workflow_dispatch:
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
      - name: Select release distribution
        run: |
          distribution="unsigned"
          echo "Incomplete signing configuration"
      - env:
          MAC_CSC_LINK: secret
          APPLE_API_KEY: secret
        run: |
          identity="Developer ID Application: Example"
          security import certificate.p12
      - run: corepack pnpm --dir electron run dist
      - run: corepack pnpm --dir electron run dist:unsigned
      - run: macos/ThingtimeRecovery/script/build-unsigned-release.sh
      - run: |
          echo ".unsigned"
          echo "Thingtime-Electron-App-UNSIGNED-Release"
          echo "Thingtime-Recovery-App-UNSIGNED-Release"
          echo "Open Anyway"
      - run: gh release create tag artifact
      - if: always()
        run: security delete-keychain temporary.keychain-db
`;
	assert.equal(validateControlPlane(source), true);
});

test('control-plane contract rejects an unsigned publisher without explicit trust labeling', () => {
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
		assert.equal(
			patterns.some((pattern) => pattern.test(relativePath)),
			true,
			relativePath
		);
	}
	assert.deepEqual(
		packageJson.build.extraFiles.map((entry) => entry.to),
		['Helpers/Thingtime Node.app']
	);
	assert.equal(
		packageJson.build.extraFiles.some((entry) => /LaunchAgents/iu.test(entry.to)),
		false
	);
});

test('mac packaging always emits the ZIP rollback artifact as well as the DMG', () => {
	const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
	assert.deepEqual(packageJson.build.mac.target, ['dmg', 'zip']);
});

test('mac packaging uses the adaptive Thingtime Icon Composer artwork', () => {
	const electronDir = path.resolve(__dirname, '..');
	const packageJson = JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
	assert.equal(packageJson.build.mac.icon, 'build/Thingtime.icon');
	const icon = JSON.parse(readFileSync(path.join(electronDir, packageJson.build.mac.icon, 'icon.json'), 'utf8'));
	assert.deepEqual(icon['supported-platforms'].squares, ['macOS']);
	assert.equal(
		icon['fill-specializations'].some((entry) => entry.appearance === 'dark'),
		true
	);
	for (const asset of ['canopy.svg', 'trunk.svg']) {
		assert.equal(existsSync(path.join(electronDir, packageJson.build.mac.icon, 'Assets', asset)), true);
	}
});

test('native node bundle declares and builds its distinct pixel-node app icon', () => {
	const nodeRoot = path.resolve(__dirname, '..', '..', 'macos', 'ThingtimeNode');
	const iconPath = path.join(nodeRoot, 'Resources', 'ThingtimeNodeIcon.png');
	const icon = readFileSync(iconPath);
	assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
	assert.equal(icon.readUInt32BE(16), 1024);
	assert.equal(icon.readUInt32BE(20), 1024);
	assert.equal(icon[25], 6, 'The icon master must retain RGBA transparency.');

	const infoPlist = readFileSync(path.join(nodeRoot, 'Resources', 'Info.plist'), 'utf8');
	assert.match(infoPlist, /<key>CFBundleIconFile<\/key>\s*<string>ThingtimeNode\.icns<\/string>/u);
	const buildScript = readFileSync(path.join(nodeRoot, 'scripts', 'build-bundle.sh'), 'utf8');
	assert.match(buildScript, /ThingtimeNodeIcon\.png/u);
	assert.match(buildScript, /iconutil -c icns/u);
});

test('local, production, and unsigned builders use the exact package-manager pin through Corepack', () => {
	const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
	assert.match(packageJson.packageManager, /^pnpm@\d+\.\d+\.\d+$/u);
	assert.doesNotMatch(packageJson.scripts['build:resources'], /\bpnpm\b/u);
	assert.doesNotMatch(packageJson.scripts.dev, /\bpnpm\b/u);
	for (const script of ['build-local-app.mjs', 'build-production-app.mjs', 'build-unsigned-release.mjs']) {
		const source = readFileSync(path.resolve(__dirname, '..', 'scripts', script), 'utf8');
		assert.match(source, /run\('corepack', \[packageManager, 'run', 'build:resources'\]/u, script);
		assert.match(source, /createPinnedPnpmEnvironment\(packageManager,/u, script);
		assert.match(source, /env: pinnedPnpm\.environment/u, script);
		assert.doesNotMatch(source, /run\('pnpm'/u, script);
	}
});

test('production packaging round-trips every updater ZIP through the signed-app verifier', () => {
	const electronDir = path.resolve(__dirname, '..');
	const builder = readFileSync(path.join(electronDir, 'scripts', 'build-production-app.mjs'), 'utf8');
	const archiveVerifier = readFileSync(path.join(electronDir, 'scripts', 'verify-release-archive.mjs'), 'utf8');
	assert.match(builder, /findReleaseArchives/u);
	assert.match(builder, /verify-release-archive\.mjs/u);
	assert.match(builder, /updater-compatible Thingtime ZIP/u);
	assert.match(archiveVerifier, /ditto/u);
	assert.match(archiveVerifier, /exactly one top-level Thingtime\.app/u);
	assert.match(archiveVerifier, /verify-signed-app\.mjs/u);
	assert.match(archiveVerifier, /finally\s*\{/u);
});

test('independent recovery release round-trips its ZIP before publication', () => {
	const recoveryBuilder = readFileSync(path.resolve(__dirname, '..', '..', 'macos', 'ThingtimeRecovery', 'script', 'build-production-release.sh'), 'utf8');
	assert.match(recoveryBuilder, /archive-verify/u);
	assert.match(recoveryBuilder, /ditto -x -k/u);
	assert.match(recoveryBuilder, /Thingtime Recovery\.app/u);
	assert.match(recoveryBuilder, /verify-production-bundle\.sh/u);
});

test('unsigned packaging is ad-hoc only, release-labelled, and independently round-tripped', () => {
	const electronDir = path.resolve(__dirname, '..');
	const unsignedBuilder = readFileSync(path.join(electronDir, 'scripts', 'build-unsigned-release.mjs'), 'utf8');
	const unsignedArchiveVerifier = readFileSync(path.join(electronDir, 'scripts', 'verify-unsigned-release-archive.mjs'), 'utf8');
	const unsignedAppVerifier = readFileSync(path.join(electronDir, 'scripts', 'verify-unsigned-app.mjs'), 'utf8');
	const nodeBuilder = readFileSync(path.join(electronDir, '..', 'macos', 'ThingtimeNode', 'scripts', 'build-bundle.sh'), 'utf8');
	const recoveryBuilder = readFileSync(path.join(electronDir, '..', 'macos', 'ThingtimeRecovery', 'script', 'build-unsigned-release.sh'), 'utf8');
	const recoveryVerifier = readFileSync(path.join(electronDir, '..', 'macos', 'ThingtimeRecovery', 'script', 'verify-unsigned-bundle.sh'), 'utf8');

	assert.match(unsignedBuilder, /THINGTIME_NODE_SIGNING_MODE: 'unsigned'/u);
	assert.match(unsignedBuilder, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/u);
	assert.match(unsignedBuilder, /--config\.mac\.identity=-/u);
	assert.match(unsignedBuilder, /entitlements\.unsigned\.mac\.plist/u);
	assert.match(unsignedBuilder, /entitlements\.unsigned\.mac\.inherit\.plist/u);
	assert.match(unsignedBuilder, /\.endsWith\('\.unsigned'\)/u);
	assert.match(unsignedBuilder, /verify-unsigned-app\.mjs/u);
	assert.match(unsignedArchiveVerifier, /exactly one top-level Thingtime\.app/u);
	assert.match(unsignedArchiveVerifier, /verify-unsigned-app\.mjs/u);
	assert.match(unsignedAppVerifier, /verifyUnsignedArtifacts/u);
	assert.match(nodeBuilder, /unsigned\)/u);
	assert.match(nodeBuilder, /--sign -/u);
	assert.match(recoveryBuilder, /Thingtime-Recovery-App-UNSIGNED-Release/u);
	assert.match(recoveryBuilder, /THINGTIME_RECOVERY_SIGNING_MODE=unsigned/u);
	assert.match(recoveryVerifier, /TeamIdentifier=not set/u);
});
