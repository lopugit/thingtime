import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { buildCommands, digest, hostID, networkProfile, parseOptions, privateEnvironment, providerID, signRelease, signingEntitlements, tree, validateIdentity, validateManifest, validateProfile, withReleaseCancellation } from './password-provider-release.mjs';
const team = 'TESTTEAM01', cert = 'A'.repeat(40), identity = `Developer ID Application: Fixture (${team})`;
const group = `${team}.${hostID}`;
const original = { 'com.apple.developer.authentication-services.autofill-credential-provider': true, 'com.apple.security.app-sandbox': true, 'com.apple.security.network.client': true, 'keychain-access-groups': ['$(THINGTIME_PASSWORD_KEYCHAIN_GROUP)'] };
function profile(id) { return { name: 'Public fixture', uuid: 'fixture-profile', expires: '2044-10-13T08:05:57Z', teams: [team], certificateSHA1s: [cert], entitlements: { 'com.apple.application-identifier': `${team}.${id}`, 'com.apple.developer.team-identifier': team, 'com.apple.developer.authentication-services.autofill-credential-provider': true, 'keychain-access-groups': [`${team}.*`] } }; }
const readJSON = filename => JSON.parse(fs.readFileSync(filename));
const validation = { readPlist: readJSON, readProfile: readJSON };
const identityOutput = () => `  1) ${cert} "${identity}"\n     1 valid identities found`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'password-release-safe-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prepared = path.join(directory, 'prepared'); fs.mkdirSync(prepared);
  const app = path.join(prepared, 'Thingtime Passwords.app');
  for (const [bundle, id, executable] of [[app, hostID, 'Thingtime Passwords'], [path.join(app, 'Contents/PlugIns/ThingtimePasswordProvider.appex'), providerID, 'ThingtimePasswordProvider']]) {
    fs.mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), JSON.stringify({ CFBundleIdentifier: id, CFBundleExecutable: executable, ThingtimePasswordKeychainGroup: group }));
    fs.writeFileSync(path.join(bundle, 'Contents/MacOS', executable), Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('fixed synthetic Mach-O stand-in; never executed')]));
    fs.writeFileSync(path.join(bundle, 'Contents/embedded.provisionprofile'), JSON.stringify(profile(id)));
  }
  fs.writeFileSync(path.join(prepared, 'Host.plist'), JSON.stringify(signingEntitlements(original, team, hostID)));
  fs.writeFileSync(path.join(prepared, 'Provider.plist'), JSON.stringify(signingEntitlements(original, team, providerID)));
  const tools = Object.fromEntries(['build-native-passwords.mjs', 'password-provider-release.mjs', 'sign-native-passwords.mjs', 'verify-password-provider.mjs'].map(name => [name, digest(fs.readFileSync(path.join(scriptDir, name)))]));
  const manifest = { schemaVersion: 1, sourceSHA: 'b'.repeat(40), team, certificateSHA1: cert, identityName: identity, files: tree(prepared), tools, sourceHashes: { 'apple/Passwords/Package.swift': 'c'.repeat(64) }, buildCommands: [], networkControls: [], generatedProjectSHA256: 'd'.repeat(64) };
  const filename = path.join(directory, 'manifest.json');
  const seal = () => { fs.writeFileSync(filename, JSON.stringify(manifest)); return digest(fs.readFileSync(filename)); };
  return { directory, prepared, app, manifest, filename, seal, output: path.join(directory, 'signed') };
}
test('fixed public profiles and canonical entitlement expansion bind team and distinct application IDs', () => {
  validateIdentity(team, cert, identity);
  for (const id of [hostID, providerID]) {
    validateProfile(profile(id), team, id, cert);
    const entitlements = signingEntitlements(original, team, id);
    assert.equal(entitlements['com.apple.application-identifier'], `${team}.${id}`);
    assert.deepEqual(entitlements['keychain-access-groups'], [group]);
    assert.ok(!JSON.stringify(entitlements).includes('$('));
  }
});
for (const [label, change] of [
  ['certificate mismatch', p => { p.certificateSHA1s = ['F'.repeat(40)]; }],
  ['wrong team', p => { p.teams = ['OTHERTEAM1']; }],
  ['wrong bundle', p => { p.entitlements['com.apple.application-identifier'] = `${team}.other`; }],
  ['expired profile', p => { p.expires = '2000-01-01T00:00:00Z'; }],
  ['unrestricted group', p => { p.entitlements['keychain-access-groups'] = ['*']; }],
  ['debug permission', p => { p.entitlements['get-task-allow'] = true; }],
  ['missing AutoFill', p => { p.entitlements['com.apple.developer.authentication-services.autofill-credential-provider'] = false; }],
]) test(`profile rejects ${label}`, () => { const p = profile(hostID); change(p); assert.throws(() => validateProfile(p, team, hostID, cert)); });
test('entitlements reject extra authority, incorrect template and unresolved substitutions', () => {
  for (const value of [{ ...original, 'get-task-allow': true }, { ...original, 'keychain-access-groups': ['$(UNREVIEWED)'] }, { ...original, 'com.apple.security.app-sandbox': false }]) assert.throws(() => signingEntitlements(value, team, hostID));
});
test('private build environment omits inherited services, signing and sessions; canonical package flags retain denial', () => {
  const env = privateEnvironment('/private/tmp/fixture');
  assert.equal(env.USER, os.userInfo().username); assert.equal(env.LOGNAME, env.USER);
  assert.equal(env.HOME, '/private/tmp/fixture/home'); assert.equal(env.DEVELOPER_DIR, '/Applications/Xcode.app/Contents/Developer');
  assert.deepEqual(Object.keys(env).sort(), ['PATH', 'LANG', 'USER', 'LOGNAME', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'CLANG_MODULE_CACHE_PATH', 'DEVELOPER_DIR'].sort());
  const commands = buildCommands('/private/tmp/fixture', team, { host: profile(hostID), provider: profile(providerID) });
  assert.equal(commands[0][0], '/opt/homebrew/bin/xcodegen');
  const args = commands[1][1];
  for (const arg of ['-IDEPackageSupportDisableManifestSandbox=YES', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGN_STYLE=Manual', `THINGTIME_PASSWORD_KEYCHAIN_GROUP=${group}`]) assert.ok(args.includes(arg));
  assert.ok(!args.some(value => /allowProvisioning|skipPackagePlugin|skipPackageSignature|OTHER_SWIFT_FLAGS/.test(value)));
  assert.equal(networkProfile, '(version 1) (allow default) (deny network*)');
});
test('prepared exact fixed artifacts validate without launching any executable', t => {
  const f = fixture(t); assert.equal(validateManifest(f.manifest, f.prepared, validation), f.manifest);
});
for (const [label, mutate] of [
  ['binary mutation', f => fs.appendFileSync(path.join(f.app, 'Contents/MacOS/Thingtime Passwords'), 'changed')],
  ['profile mutation', f => fs.appendFileSync(path.join(f.app, 'Contents/embedded.provisionprofile'), 'changed')],
  ['entitlement mutation', f => fs.appendFileSync(path.join(f.prepared, 'Host.plist'), 'changed')],
  ['new nested code', f => fs.writeFileSync(path.join(f.app, 'Contents/extra'), 'new')],
  ['symlink escape', f => fs.symlinkSync('/bin/sh', path.join(f.app, 'Contents/escape'))],
  ['hard-link alias', f => fs.linkSync(path.join(f.app, 'Contents/MacOS/Thingtime Passwords'), path.join(f.directory, 'alias'))],
]) test(`prepared tree rejects ${label} before signing`, t => { const f = fixture(t); mutate(f); assert.throws(() => validateManifest(f.manifest, f.prepared, validation)); });
for (const [label, change] of [
  ['bundle ID', info => { info.CFBundleIdentifier = 'com.foreign.app'; }],
  ['unresolved compiled group', info => { info.ThingtimePasswordKeychainGroup = '$(THINGTIME_PASSWORD_KEYCHAIN_GROUP)'; }],
  ['wrong executable', info => { info.CFBundleExecutable = '../../bin/sh'; }],
]) test(`compiled metadata rejects ${label} even with refreshed hashes`, t => {
  const f = fixture(t), file = path.join(f.app, 'Contents/Info.plist'), info = readJSON(file); change(info); fs.writeFileSync(file, JSON.stringify(info)); f.manifest.files = tree(f.prepared);
  assert.throws(() => validateManifest(f.manifest, f.prepared, validation));
});
test('manifest rejects extra fields, traversal and changed trusted signer', t => {
  const f = fixture(t);
  assert.throws(() => validateManifest({ ...f.manifest, arbitrary: true }, f.prepared, validation));
  assert.throws(() => validateManifest({ ...f.manifest, files: { ...f.manifest.files, '../outside': 'c'.repeat(64) } }, f.prepared, validation));
  assert.throws(() => validateManifest({ ...f.manifest, tools: {} }, f.prepared, validation));
});
test('reviewed manifest digest is mandatory before creating a signing output', async t => {
  const f = fixture(t); f.seal();
  await assert.rejects(signRelease({ manifest: f.filename, sha256: '0'.repeat(64), output: f.output }, { validation, execute() { assert.fail(); } }));
  assert.ok(!fs.existsSync(f.output));
});
test('release signs and verifies extension before host, preserves payload, never installs', async t => {
  const f = fixture(t), calls = [];
  const result = await signRelease({ manifest: f.filename, sha256: f.seal(), output: f.output }, { validation, execute(command, args) { if (command === '/usr/bin/security') return identityOutput(); calls.push([command, args]); }, async verify(app, options) { assert.equal(options.signingIdentity, identity); assert.deepEqual(options.bundleIdentifiers, [hostID, providerID]); } });
  assert.deepEqual(result.signingOrder, ['provider', 'host']); assert.equal(result.installed, false);
  assert.equal(calls.length, 4); assert.ok(calls.every(([command]) => command === '/usr/bin/codesign'));
  assert.ok(calls[0][1].at(-1).endsWith('.appex')); assert.ok(calls[1][1].includes('--verify'));
  assert.ok(calls[2][1].at(-1).endsWith('.app')); assert.ok(calls[3][1].includes('--verify'));
  for (const index of [0, 2]) { assert.ok(calls[index][1].includes('--timestamp')); assert.ok(calls[index][1].includes('runtime')); assert.ok(calls[index][1].includes(cert)); }
});
for (const failedCall of [1, 2]) test(`provider signing/verification failure ${failedCall} prevents host signing`, async t => {
  const f = fixture(t); let calls = 0;
  await assert.rejects(signRelease({ manifest: f.filename, sha256: f.seal(), output: f.output }, { validation, execute(command, args) { if (command === '/usr/bin/security') return identityOutput(); calls += 1; assert.ok(args.at(-1).endsWith('.appex')); if (calls === failedCall) throw Error('fixed signing failure'); }, async verify() { assert.fail(); } }));
  assert.equal(calls, failedCall); assert.equal(readJSON(path.join(f.output, 'signing-receipt.json')).status, 'failed');
});
test('post-sign profile/payload mutation cannot produce success receipt', async t => {
  const f = fixture(t);
  await assert.rejects(signRelease({ manifest: f.filename, sha256: f.seal(), output: f.output }, { validation, execute(command) { if (command === '/usr/bin/security') return identityOutput(); }, async verify(app) { fs.appendFileSync(path.join(app, 'Contents/Info.plist'), 'changed'); } }));
  assert.equal(readJSON(path.join(f.output, 'signing-receipt.json')).status, 'failed');
});
test('CLI accepts only complete unique allowlisted argument pairs', () => {
  assert.deepEqual(parseOptions(['--one', 'x', '--two', 'y'], ['--one', '--two']), { '--one': 'x', '--two': 'y' });
  for (const args of [['--one', 'x'], ['--one', 'x', '--one', 'y'], ['--one', 'x', '--bad', 'y']]) assert.throws(() => parseOptions(args, ['--one', '--two']));
});
test('default builder retains canonical interoperability gate and default signing/archive path', () => {
  const build = fs.readFileSync(path.join(scriptDir, 'build-native-passwords.mjs'), 'utf8');
  assert.ok(build.indexOf('await verifyNativePasswordPasskey();') < build.indexOf('let identity = process.env.THINGTIME_PASSWORD_SIGNING_IDENTITY'));
  assert.ok(build.includes("run('xcodebuild', [...buildArguments, '-archivePath', archive, 'archive'])"));
  assert.ok(build.includes("await verifyPasswordProvider(staging, { unsigned"));
});

test('missing or different valid local identity prevents any signing or output', async t => {
  const f = fixture(t); let calls = 0;
  await assert.rejects(signRelease({ manifest: f.filename, sha256: f.seal(), output: f.output }, { validation, execute(command) { calls++; assert.equal(command, '/usr/bin/security'); return '0 valid identities found'; } }));
  assert.equal(calls, 1); assert.ok(!fs.existsSync(f.output));
});
test('unexpected file introduced during signing is rejected', async t => {
  const f = fixture(t);
  await assert.rejects(signRelease({ manifest: f.filename, sha256: f.seal(), output: f.output }, { validation, execute(command) { if (command === '/usr/bin/security') return identityOutput(); }, async verify(app) { fs.writeFileSync(path.join(app, 'Contents/extra'), 'unreviewed'); } }));
});

test('host mutation during provider signing is rejected before host codesign', async t => {
  const f = fixture(t); const signingCalls = [];
  await assert.rejects(signRelease({ manifest: f.filename, sha256: f.seal(), output: f.output }, { validation, execute(command, args) {
    if (command === '/usr/bin/security') return identityOutput();
    if (args.includes('--force')) {
      signingCalls.push(args.at(-1));
      assert.ok(args.at(-1).endsWith('.appex'));
      fs.appendFileSync(path.join(f.output, 'stage/Thingtime Passwords.app/Contents/MacOS/Thingtime Passwords'), 'inter-sign mutation');
    }
  }, async verify() { assert.fail('Final verification must not run'); } }), /pre-sign executable mutation/);
  assert.equal(signingCalls.length, 1);
  const receipt = readJSON(path.join(f.output, 'signing-receipt.json'));
  assert.equal(receipt.status, 'failed'); assert.deepEqual(receipt.signingOrder, ['provider']);
});

test('normal preparation cancellation scope removes global signal handlers', async () => {
  const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  assert.equal(await withReleaseCancellation(async signal => { assert.equal(signal.aborted, false); return 42; }), 42);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), before);
});
for (const requestedSignal of ['SIGINT', 'SIGTERM']) test(`owned synthetic group is TERM/KILL/reaped after parent ${requestedSignal}`, { timeout: 20_000 }, async t => {
  const f = fixture(t), ready = path.join(f.directory, 'child-ready.json'), resultFile = path.join(f.directory, 'cancel-result.json');
  const childFile = path.join(f.directory, 'harmless-child.mjs'), supervisorFile = path.join(f.directory, 'harmless-supervisor.mjs');
  fs.writeFileSync(childFile, `import fs from 'node:fs'; process.on('SIGTERM', () => {}); fs.writeFileSync(process.argv[2], JSON.stringify({pid:process.pid})); setInterval(()=>{},1000);`);
  const helperURL = pathToFileURL(path.join(scriptDir, 'password-provider-release.mjs')).href;
  fs.writeFileSync(supervisorFile, `import fs from 'node:fs'; import net from 'node:net';
import {withReleaseCancellation,runBounded} from ${JSON.stringify(helperURL)};
const folder=process.argv[2],before=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)); const result={};
await withReleaseCancellation(async signal=>{
 const server=net.createServer(s=>s.end()); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const log=fs.openSync(folder+'/harmless-child.log','wx',0o600);
 try { await runBounded(process.execPath,[folder+'/harmless-child.mjs',folder+'/child-ready.json'],{cwd:folder,env:{PATH:'/usr/bin:/bin',LANG:'C'},log,deadline:Date.now()+15000,signal}); }
 catch(error){ result.error=error.message; result.cleanup=error.cleanup; }
 finally { await new Promise(r=>server.close(r)); fs.closeSync(log); result.listenerClosed=!server.listening; result.logClosed=true; result.cancelled=signal.aborted; result.cancelSignal=signal.reason; }
});
result.handlersRestored=JSON.stringify(before)===JSON.stringify(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)));
fs.writeFileSync(folder+'/cancel-result.json',JSON.stringify(result));
`);
  let supervisor, ownedChild;
  const readyPromise = new Promise((resolve, reject) => {
    const watcher = fs.watch(f.directory, () => { if (fs.existsSync(ready)) { clearTimeout(timer); watcher.close(); resolve(readJSON(ready)); } });
    const timer = setTimeout(() => { watcher.close(); reject(Error('Synthetic child readiness deadline')); }, 8000);
  });
  try {
    supervisor = spawn(process.execPath, [supervisorFile, f.directory], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, stdio: 'ignore', detached: true });
    const exited = new Promise((resolve, reject) => { supervisor.once('error', reject); supervisor.once('exit', resolve); });
    ownedChild = (await readyPromise).pid; supervisor.kill(requestedSignal);
    assert.equal(await exited, 0);
    const result = readJSON(resultFile);
    assert.equal(result.cancelled, true); assert.equal(result.cancelSignal, requestedSignal);
    assert.equal(result.cleanup.termSent, true); assert.equal(result.cleanup.killSent, true);
    assert.equal(result.cleanup.reaped, true); assert.equal(result.cleanup.remainingGroup, 0);
    assert.equal(result.listenerClosed, true); assert.equal(result.logClosed, true); assert.equal(result.handlersRestored, true);
    assert.throws(() => process.kill(ownedChild, 0), { code: 'ESRCH' });
  } finally {
    for (const group of [supervisor?.pid, ownedChild]) { if (group) { try { process.kill(-group, 'SIGKILL'); } catch(error) { if(error.code!=='ESRCH') throw error; } } }
  }
});
