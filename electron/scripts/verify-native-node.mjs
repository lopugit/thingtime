import { access, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { verifySignedArtifacts } = require('../lib/thingtime-node-bridge.cjs');

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRoot = path.join(electronDir, 'dist', 'native');
const helperApp = path.join(nativeRoot, 'Thingtime Node.app');
const helperExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNode');
const bridgeExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNodeBridge');
const runtimePath = path.join(electronDir, 'dist', 'ai', 'thingtime-node-runtime.mjs');
const manifestPath = path.join(nativeRoot, 'manifest.json');
const nestedLaunchAgentPath = path.join(helperApp, 'Contents', 'Library', 'LaunchAgents', 'com.thingtime.desktop.node.plist');

async function assertSelfContained(root) {
	const pending = [root];
	while (pending.length) {
		const current = pending.pop();
		const stat = await lstat(current);
		if (stat.isSymbolicLink()) throw new Error(`Native Electron resource contains a symbolic link: ${current}`);
		if (!stat.isDirectory()) continue;
		for (const entry of await readdir(current)) pending.push(path.join(current, entry));
	}
}

for (const required of [helperExecutable, bridgeExecutable, runtimePath, manifestPath]) {
	await access(required);
}
await assertSelfContained(nativeRoot);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
	manifest.bundleIdentifier !== 'com.thingtime.desktop.node' ||
	manifest.bridgeBundleIdentifier !== 'com.thingtime.desktop.node.bridge' ||
	manifest.loginRegistration !== 'electron-authoritative' ||
	manifest.runtime !== '../ai/thingtime-node-runtime.mjs'
) {
	throw new Error('Thingtime Node staging manifest does not match the packaging contract.');
}
try {
	await access(nestedLaunchAgentPath);
	throw new Error('Embedded Thingtime Node must not carry a second SMAppService login-agent registration.');
} catch (error) {
	if (error?.code !== 'ENOENT') throw error;
}
const signature = await verifySignedArtifacts({
	bridgeExecutable,
	helperApp,
	helperExecutable,
	outerApp: null,
	runtimePath
}, undefined, { requireExactLeafCertificate: true });

console.log(`Thingtime Node resources verified (team ${signature.teamIdentifier}).`);
