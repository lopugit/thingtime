import { existsSync } from 'node:fs';
import { verifyPasswordProvider } from './verify-password-provider.mjs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyUnsignedArtifacts } = require('../lib/thingtime-node-bridge.cjs');
const { verifyBundledMongo } = require('../lib/bundled-mongodb.cjs');
const { verifyAgentPackage } = require('../lib/verify-agent-package.cjs');

const requireBundledMongo = process.argv.includes('--require-bundled-mongo');
const args = process.argv.slice(2).filter((value) => value !== '--require-bundled-mongo');
const appPath = args[0] ? path.resolve(args[0]) : null;
if (!appPath || args.length !== 1) {
    throw new Error('Usage: verify-unsigned-app.mjs <Thingtime.app>');
}

const contentsPath = path.join(appPath, 'Contents');
const helperApp = path.join(contentsPath, 'Helpers', 'Thingtime Node.app');
const helperExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNode');
const bridgeExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNodeBridge');
const runtimePath = path.join(contentsPath, 'Resources', 'ai', 'thingtime-node-runtime.mjs');
for (const required of [appPath, helperApp, helperExecutable, bridgeExecutable, runtimePath]) await access(required);

await verifyUnsignedArtifacts({
    bridgeExecutable,
    helperApp,
    helperExecutable,
    outerApp: appPath,
    runtimePath
});
await verifyPasswordProvider(path.join(contentsPath, 'Helpers/Thingtime Passwords.app'), { unsigned: true });
verifyAgentPackage(appPath, undefined, { required: true });
const mongoRoot = path.join(contentsPath, 'Resources', 'database', 'mongodb');
if (requireBundledMongo || existsSync(mongoRoot))
    await verifyBundledMongo(mongoRoot, { pinned: requireBundledMongo, execute: requireBundledMongo });
console.log(`Verified unsigned Thingtime app ${appPath}`);
