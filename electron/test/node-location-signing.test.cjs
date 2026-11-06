'use strict';
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { verifyUnsignedArtifacts } = require('../lib/thingtime-node-bridge.cjs');

// Exercise the signed bytes after nesting and outer sealing, not a plist/source assertion.
test('final nested signature requires the enabled canonical Node location entitlement', { skip: process.platform !== 'darwin' }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'thingtime-node-location-signing-'));
    const outerApp = path.join(root, 'Fixture.app');
    const helperApp = path.join(outerApp, 'Contents/Helpers/Thingtime Node.app');
    const helperExecutable = path.join(helperApp, 'Contents/MacOS/ThingtimeNode');
    const bridgeExecutable = path.join(helperApp, 'Contents/MacOS/ThingtimeNodeBridge');
    const runtimePath = path.join(outerApp, 'Contents/Resources/ai/runtime.mjs');
    const outerExecutable = path.join(outerApp, 'Contents/MacOS/Fixture');
    const location = path.resolve(__dirname, '../../macos/ThingtimeNode/Resources/ThingtimeNode.entitlements');
    const electronEntitlements = path.resolve(__dirname, '../build/entitlements.unsigned.mac.plist');
    const run = (tool, args) => execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const sign = (target, identifier, entitlements) => run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--identifier', identifier,
        ...(entitlements ? ['--entitlements', entitlements] : []), target]);
    try {
        await mkdir(path.dirname(helperExecutable), { recursive: true });
        await mkdir(path.dirname(outerExecutable), { recursive: true });
        await mkdir(path.dirname(runtimePath), { recursive: true });
        await writeFile(runtimePath, 'export {};');
        const source = path.join(root, 'fixture.c');
        await writeFile(source, 'int main(void) { return 0; }\n');
        for (const exe of [helperExecutable, bridgeExecutable, outerExecutable]) run('/usr/bin/xcrun', ['clang', source, '-o', exe]);
        for (const [bundle, identifier, executable] of [[outerApp, 'com.thingtime.desktop', 'Fixture'], [helperApp, 'com.thingtime.desktop.node', 'ThingtimeNode']]) {
            await writeFile(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
        }
        sign(bridgeExecutable, 'com.thingtime.desktop.node.bridge');
        sign(helperApp, 'com.thingtime.desktop.node', location);
        sign(outerApp, 'com.thingtime.desktop', electronEntitlements);
        const paths = { outerApp, helperApp, helperExecutable, bridgeExecutable, runtimePath };
        await verifyUnsignedArtifacts(paths, undefined, { requireNodeLocationEntitlement: true });
        const xml = run('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', helperApp]);
        const parsed = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' }));
        assert.equal(parsed['com.apple.security.personal-information.location'], true);
        // Simulate the final packager stripping the helper entitlement, then correctly resealing the outer app.
        const empty = path.join(root, 'empty.plist');
        await writeFile(empty, '<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
        sign(helperApp, 'com.thingtime.desktop.node', empty);
        sign(outerApp, 'com.thingtime.desktop', electronEntitlements);
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', outerApp]);
        await assert.rejects(verifyUnsignedArtifacts(paths, undefined, { requireNodeLocationEntitlement: true }), error => error.code === 'invalid_entitlements');
        const packageDefinition = JSON.parse(await readFile(path.resolve(__dirname, '../package.json'), 'utf8'));
        assert.ok(packageDefinition.build.mac.signIgnore.some(pattern => new RegExp(pattern).test(helperApp)), 'outer packager must preserve the separately signed Node bundle');
    } finally { await rm(root, { recursive: true, force: true }); }
});
