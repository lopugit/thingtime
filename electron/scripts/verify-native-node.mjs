import { access, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { verifySignedArtifacts, verifyUnsignedArtifacts } = require('../lib/thingtime-node-bridge.cjs');

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRoot = path.join(electronDir, 'dist', 'native');
const helperApp = path.join(nativeRoot, 'Thingtime Node.app');
const helperExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNode');
const bridgeExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNodeBridge');
const helperIcon = path.join(helperApp, 'Contents', 'Resources', 'ThingtimeNode.icns');
const helperInfoPlist = path.join(helperApp, 'Contents', 'Info.plist');
const runtimePath = path.join(electronDir, 'dist', 'ai', 'thingtime-node-runtime.mjs');
const manifestPath = path.join(nativeRoot, 'manifest.json');
const nestedLaunchAgentPath = path.join(helperApp, 'Contents', 'Library', 'LaunchAgents', 'com.thingtime.desktop.node.plist');
const signingMode = String(process.env.THINGTIME_NODE_SIGNING_MODE || 'signed').trim();

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

for (const required of [helperExecutable, bridgeExecutable, helperIcon, helperInfoPlist, runtimePath, manifestPath]) {
	await access(required);
}
await assertSelfContained(nativeRoot);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const helperInfo = await readFile(helperInfoPlist, 'utf8');
if (!/<key>CFBundleIconFile<\/key>\s*<string>ThingtimeNode\.icns<\/string>/u.test(helperInfo)) {
	throw new Error('Thingtime Node must declare its packaged application icon.');
}
if (
	manifest.bundleIdentifier !== 'com.thingtime.desktop.node' ||
	manifest.bridgeBundleIdentifier !== 'com.thingtime.desktop.node.bridge' ||
	manifest.loginRegistration !== 'electron-authoritative' ||
	manifest.runtime !== '../ai/thingtime-node-runtime.mjs'
) {
	throw new Error('Thingtime Node staging manifest does not match the packaging contract.');
}
if (!['signed', 'unsigned'].includes(signingMode)) throw new Error('THINGTIME_NODE_SIGNING_MODE must be signed or unsigned.');
try {
	await access(nestedLaunchAgentPath);
	throw new Error('Embedded Thingtime Node must not carry a second SMAppService login-agent registration.');
} catch (error) {
	if (error?.code !== 'ENOENT') throw error;
}
const signaturePaths =
	{
		bridgeExecutable,
		helperApp,
		helperExecutable,
		outerApp: null,
		runtimePath
	};
const signature = signingMode === 'unsigned'
	? await verifyUnsignedArtifacts(signaturePaths)
	: await verifySignedArtifacts(signaturePaths, undefined, { requireExactLeafCertificate: true });

console.log(signingMode === 'unsigned'
	? 'Thingtime Node unsigned resources verified.'
	: `Thingtime Node resources verified (team ${signature.teamIdentifier}).`);
