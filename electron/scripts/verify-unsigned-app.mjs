import { access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyUnsignedArtifacts } = require('../lib/thingtime-node-bridge.cjs');

const appPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!appPath || process.argv.length !== 3) {
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
console.log(`Verified unsigned Thingtime app ${appPath}`);
