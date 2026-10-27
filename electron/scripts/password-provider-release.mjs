// Trusted release orchestration. Prepared applications are data and are never launched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPasswordProvider } from './verify-password-provider.mjs';

export const networkProfile = '(version 1) (allow default) (deny network*)';
export const hostID = 'com.thingtime.passwords';
export const providerID = `${hostID}.provider`;
const appName = 'Thingtime Passwords.app';
const extension = 'Contents/PlugIns/ThingtimePasswordProvider.appex';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tools = ['build-native-passwords.mjs', 'password-provider-release.mjs', 'sign-native-passwords.mjs', 'verify-password-provider.mjs'];
const systemEnvironment = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' };
const fail = label => { throw new Error(`Password release refused: ${label}.`); };
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).sort().join('|') === [...keys].sort().join('|');
function publicPath(filename) {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename || fs.realpathSync(filename) !== filename) fail('noncanonical path');
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid()) fail('path ownership or symlink');
  return filename;
}
function newDirectory(filename) {
  const parent = path.dirname(filename), parentStat = fs.lstatSync(parent);
  if (fs.realpathSync(parent) !== parent || !parentStat.isDirectory() || parentStat.isSymbolicLink() || !(parentStat.uid === process.getuid() || parentStat.uid === 0 && (parentStat.mode & 0o1000))) fail('output parent ownership or symlink');
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename || fs.existsSync(filename)) fail('output must be a fresh absolute directory');
  fs.mkdirSync(filename, { mode: 0o700 });
  return filename;
}
function system(command, args, input, environment = systemEnvironment) {
  const result = spawnSync(command, args, { input, env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`${path.basename(command)} exit ${result.status ?? result.error?.code ?? 'unknown'}`);
  return result.stdout;
}
function plist(bytes) { return JSON.parse(system('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], bytes)); }
function plistBytes(value) { return Buffer.from(system('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'], JSON.stringify(value))); }
function decodeProfile(filename) {
  const xml = system('/usr/bin/security', ['cms', '-D', '-i', filename]);
  const extract = (key, format) => system('/usr/bin/plutil', ['-extract', key, format, '-o', '-', '-'], xml).trim();
  const certificates = extract('DeveloperCertificates', 'xml1');
  return {
    name: extract('Name', 'raw'), uuid: extract('UUID', 'raw'), expires: extract('ExpirationDate', 'raw'),
    teams: JSON.parse(extract('TeamIdentifier', 'json')), entitlements: JSON.parse(extract('Entitlements', 'json')),
    certificateSHA1s: [...certificates.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+)<\/data>/g)].map(match => createHash('sha1').update(Buffer.from(match[1].replace(/\s/g, ''), 'base64')).digest('hex').toUpperCase()),
  };
}
export function validateIdentity(team, certificateSHA1, identityName) {
  if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-F0-9]{40}$/.test(certificateSHA1) || typeof identityName !== 'string' || !identityName.startsWith('Developer ID Application: ') || !identityName.endsWith(` (${team})`) || /[\r\n]/.test(identityName)) fail('identity');
}
export function validateProfile(profile, team, id, certificateSHA1, now = Date.now()) {
  const ent = profile.entitlements;
  if (!profile.name || !profile.uuid || !Number.isFinite(Date.parse(profile.expires)) || Date.parse(profile.expires) <= now || !Array.isArray(profile.teams) || profile.teams.length !== 1 || profile.teams[0] !== team || !profile.certificateSHA1s?.includes(certificateSHA1)) fail('profile team, expiry or certificate');
  if (ent?.['com.apple.application-identifier'] !== `${team}.${id}` || ent['com.apple.developer.authentication-services.autofill-credential-provider'] !== true || ent['get-task-allow'] === true || ent['com.apple.developer.team-identifier'] !== team) fail('profile identity or permission');
  const group = `${team}.${hostID}`;
  if (!Array.isArray(ent['keychain-access-groups']) || !ent['keychain-access-groups'].some(value => value === group || value === `${team}.*`)) fail('profile Keychain scope');
}
export function signingEntitlements(source, team, id) {
  const keys = ['com.apple.developer.authentication-services.autofill-credential-provider', 'com.apple.security.app-sandbox', 'com.apple.security.network.client', 'keychain-access-groups'];
  if (!exact(source, keys) || keys.slice(0, 3).some(key => source[key] !== true) || JSON.stringify(source['keychain-access-groups']) !== JSON.stringify(['$(THINGTIME_PASSWORD_KEYCHAIN_GROUP)'])) fail('canonical entitlement source');
  const result = { ...source, 'keychain-access-groups': [`${team}.${hostID}`], 'com.apple.developer.team-identifier': team, 'com.apple.application-identifier': `${team}.${id}` };
  if (/\$\(|\$\{/.test(JSON.stringify(result))) fail('unresolved entitlement');
  return result;
}
export function tree(directory) {
  publicPath(directory);
  const rows = {};
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const filename = path.join(dir, name), stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink() || stat.uid !== process.getuid()) fail('tree ownership or symlink');
      if (stat.isDirectory()) visit(filename);
      else if (stat.isFile() && stat.nlink === 1) rows[path.relative(directory, filename).split(path.sep).join('/')] = digest(fs.readFileSync(filename));
      else fail('special file or hard link');
    }
  }
  visit(directory);
  return rows;
}
function toolHashes() { return Object.fromEntries(tools.map(name => [name, digest(fs.readFileSync(path.join(root, 'electron/scripts', name)))])); }
function appLayout(rows) {
  const allowed = ['Host.plist', 'Provider.plist', ...['Contents/Info.plist', 'Contents/PkgInfo', 'Contents/MacOS/Thingtime Passwords', 'Contents/embedded.provisionprofile', `${extension}/Contents/Info.plist`, `${extension}/Contents/PkgInfo`, `${extension}/Contents/MacOS/ThingtimePasswordProvider`, `${extension}/Contents/embedded.provisionprofile`].map(value => `${appName}/${value}`)];
  if (Object.keys(rows).some(value => !allowed.includes(value)) || allowed.filter(value => !value.endsWith('PkgInfo')).some(value => !(value in rows))) fail('unexpected fixed bundle layout');
}
export function validateManifest(manifest, directory, { readPlist = filename => plist(fs.readFileSync(filename)), readProfile = decodeProfile } = {}) {
  if (!exact(manifest, ['schemaVersion', 'sourceSHA', 'team', 'certificateSHA1', 'identityName', 'files', 'tools', 'sourceHashes', 'buildCommands', 'networkControls', 'generatedProjectSHA256']) || manifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.sourceSHA) || !/^[a-f0-9]{64}$/.test(manifest.generatedProjectSHA256)) fail('manifest schema');
  validateIdentity(manifest.team, manifest.certificateSHA1, manifest.identityName);
  const actual = tree(directory);
  if (!exact(manifest.files, Object.keys(actual)) || Object.keys(actual).some(key => !/^[a-f0-9]{64}$/.test(manifest.files[key]) || actual[key] !== manifest.files[key])) fail('prepared artifact mutation');
  appLayout(actual);
  if (JSON.stringify(manifest.tools) !== JSON.stringify(toolHashes())) fail('trusted release tooling changed');
  const group = `${manifest.team}.${hostID}`;
  for (const [relative, id, executable, entitlement] of [[appName, hostID, 'Thingtime Passwords', 'Host.plist'], [`${appName}/${extension}`, providerID, 'ThingtimePasswordProvider', 'Provider.plist']]) {
    const bundle = path.join(directory, relative), info = readPlist(path.join(bundle, 'Contents/Info.plist'));
    if (info.CFBundleIdentifier !== id || info.CFBundleExecutable !== executable || info.ThingtimePasswordKeychainGroup !== group || /\$\(|\$\{/.test(JSON.stringify(info))) fail('compiled bundle identity or unresolved substitution');
    const bytes = fs.readFileSync(path.join(bundle, 'Contents/MacOS', executable));
    if (!['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(bytes.subarray(0, 4).toString('hex'))) fail('bundle executable format');
    const profile = readProfile(path.join(bundle, 'Contents/embedded.provisionprofile'));
    validateProfile(profile, manifest.team, id, manifest.certificateSHA1);
    const signed = readPlist(path.join(directory, entitlement));
    const expected = signingEntitlements({ 'com.apple.developer.authentication-services.autofill-credential-provider': true, 'com.apple.security.app-sandbox': true, 'com.apple.security.network.client': true, 'keychain-access-groups': ['$(THINGTIME_PASSWORD_KEYCHAIN_GROUP)'] }, manifest.team, id);
    if (JSON.stringify(Object.entries(signed).sort()) !== JSON.stringify(Object.entries(expected).sort())) fail('signing entitlements');
  }
  return manifest;
}
export function privateEnvironment(directory) {
  const user = os.userInfo().username;
  return { ...systemEnvironment, USER: user, LOGNAME: user, HOME: path.join(directory, 'home'), TMPDIR: path.join(directory, 'tmp'), XDG_CACHE_HOME: path.join(directory, 'cache'), XDG_CONFIG_HOME: path.join(directory, 'config'), CLANG_MODULE_CACHE_PATH: path.join(directory, 'clang'), DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' };
}
export function buildCommands(directory, team, profiles) {
  return [ ['/opt/homebrew/bin/xcodegen', ['generate']], ['/usr/bin/xcrun', ['xcodebuild', '-project', 'ThingtimePasswords.xcodeproj', '-scheme', 'ThingtimePasswords', '-configuration', 'Release', '-destination', 'generic/platform=macOS', '-derivedDataPath', path.join(directory, 'derived'), '-clonedSourcePackagesDirPath', path.join(directory, 'packages'), '-packageCachePath', path.join(directory, 'package-cache'), '-disablePackageRepositoryCache', '-packageAuthorizationProvider', 'netrc', '-skipPackageUpdates', '-IDEPackageSupportDisableManifestSandbox=YES', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGN_STYLE=Manual', `DEVELOPMENT_TEAM=${team}`, `THINGTIME_PASSWORD_KEYCHAIN_GROUP=${team}.${hostID}`, `THINGTIME_PASSWORD_HOST_PROFILE=${profiles.host.uuid}`, `THINGTIME_PASSWORD_PROVIDER_PROFILE=${profiles.provider.uuid}`, 'build']] ];
}
function groupMembers(group) {
  return system('/bin/ps', ['-axo', 'pid=,pgid=']).split('\n').filter(line => Number(line.trim().split(/\s+/)[1]) === group).length;
}
export async function withReleaseCancellation(work) {
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT');
  const terminate = () => controller.abort('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try { return await work(controller.signal); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
export async function runBounded(command, args, { cwd, env, log, deadline, signal }) {
  if (signal?.aborted) fail('preparation cancelled before command');
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', log, log] });
  const cleanup = { pid: child.pid, pgid: child.pid, termSent: false, killSent: false, reaped: false, cancelled: false, timedOut: false };
  let hardTimer;
  const send = kind => {
    if (!child.pid) return;
    try { process.kill(-child.pid, kind); cleanup[kind === 'SIGTERM' ? 'termSent' : 'killSent'] = true; }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = reason => {
    if (cleanup.cancelled || cleanup.timedOut) return;
    cleanup.cancelled = reason === 'cancelled'; cleanup.timedOut = reason === 'deadline';
    send('SIGTERM'); hardTimer = setTimeout(() => send('SIGKILL'), 5000);
  };
  const cancel = () => stop('cancelled');
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => stop('deadline'), Math.max(1, deadline - Date.now()));
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    cleanup.reaped = true; cleanup.exit = code;
    const remained = groupMembers(child.pid);
    if (remained) { send('SIGKILL'); await new Promise(resolve => setTimeout(resolve, 100)); }
    cleanup.remainingGroup = groupMembers(child.pid);
    if (cleanup.cancelled || cleanup.timedOut || code !== 0 || remained || cleanup.remainingGroup) fail(`${path.basename(command)} build, cancellation or cleanup failure`);
    return cleanup;
  } catch (error) { error.cleanup = cleanup; throw error; }
  finally { clearTimeout(timer); clearTimeout(hardTimer); signal?.removeEventListener('abort', cancel); }
}

const probe = "const n=require('node:net'),s=n.createConnection({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(1500);s.on('connect',()=>{console.log('connected');s.end()});s.on('timeout',()=>{s.destroy();process.exitCode=2});s.on('error',e=>{console.log(e.code);process.exitCode=['EPERM','EACCES'].includes(e.code)?0:3});";
async function networkControl(server, host, sandbox, env) {
  const args = [process.execPath, '-e', probe, host, String(server.address().port)];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(sandbox ? '/usr/bin/sandbox-exec' : args.shift(), sandbox ? ['-p', networkProfile, ...args] : args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ host, sandbox, code, result: stdout.trim(), stderrEmpty: !stderr }); });
  });
  if (result.code !== 0 || !result.stderrEmpty || (sandbox ? !['EPERM', 'EACCES'].includes(result.result) : result.result !== 'connected')) fail('network control');
  return result;
}
export async function prepareRelease(options) {
  return withReleaseCancellation(signal => prepareReleaseInner(options, signal));
}
async function prepareReleaseInner(options, signal) {
  if (process.platform !== 'darwin') fail('preparation requires macOS');
  validateIdentity(options.team, options.certificateSHA1, options.identityName);
  if (!/^[a-f0-9]{40}$/.test(options.sourceSHA)) fail('exact source commit required');
  const output = newDirectory(options.output), prepared = path.join(output, 'prepared'), working = path.join(output, 'source');
  fs.mkdirSync(prepared, { mode: 0o700 }); fs.mkdirSync(working, { mode: 0o700 });
  for (const dir of ['home', 'tmp', 'cache', 'config', 'security', 'clang', 'packages', 'package-cache']) fs.mkdirSync(path.join(output, dir), { mode: 0o700 });
  const env = privateEnvironment(output), receipt = { status: 'preparing', sourceSHA: options.sourceSHA, networkProfile, controls: [] };
  const receiptPath = path.join(output, 'preparation-receipt.json');
  let postChecked = false;
  const profiles = {}, servers = [], log = fs.openSync(path.join(output, 'build.log'), 'wx', 0o600);
  try {
    for (const [label, filename, id] of [['host', options.hostProfile, hostID], ['provider', options.providerProfile, providerID]]) {
      publicPath(filename); if (!fs.lstatSync(filename).isFile()) fail('profile is not a file');
      const copied = path.join(output, `${label}.provisionprofile`); fs.copyFileSync(filename, copied, fs.constants.COPYFILE_EXCL);
      profiles[label] = decodeProfile(copied); validateProfile(profiles[label], options.team, id, options.certificateSHA1);
    }
    const prefixes = ['apple/Passwords', 'apple/PasswordProvider', 'macos/ThingtimePasswords'];
    const entries = system('/usr/bin/git', ['-C', root, 'ls-tree', '-r', options.sourceSHA, '--', ...prefixes]).trim().split('\n').map(line => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line); if (!match) fail('nonregular Git source'); return { blob: match[2], filename: match[3] };
    });
    const paths = entries.map(entry => entry.filename);
    const archive = spawnSync('/usr/bin/git', ['-C', root, 'archive', options.sourceSHA, '--', ...prefixes], { env: systemEnvironment, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    if (archive.error || archive.status !== 0) fail('source archive');
    const unpack = spawnSync('/usr/bin/tar', ['-xf', '-', '-C', working], { input: archive.stdout, env: systemEnvironment, timeout: 30_000 });
    if (unpack.error || unpack.status !== 0) fail('source unpack');
    tree(working); // Refuse Git symlinks before any package/project execution.
    const hashes = Object.fromEntries(entries.map(({ filename, blob }) => {
      const bytes = fs.readFileSync(path.join(working, filename));
      if (createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex') !== blob) fail('Git archive source mismatch');
      return [filename, digest(bytes)];
    }));
    for (const host of ['127.0.0.1', '::1']) {
      const server = net.createServer(socket => socket.end());
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); }); servers.push([server, host]);
      receipt.controls.push(await networkControl(server, host, false, env), await networkControl(server, host, true, env));
    }
    const commands = buildCommands(output, options.team, profiles), deadline = Date.now() + 600_000;
    for (const [command, args] of commands) receipt.lastCommandCleanup = await runBounded('/usr/bin/sandbox-exec', ['-p', networkProfile, command, ...args], { cwd: path.join(working, 'macos/ThingtimePasswords'), env, log, deadline, signal });
    for (const filename of paths) if (digest(fs.readFileSync(path.join(working, filename))) !== hashes[filename]) fail('source changed during build');
    const generated = fs.readFileSync(path.join(working, 'macos/ThingtimePasswords/ThingtimePasswords.xcodeproj/project.pbxproj'));
    if (!generated.includes('XCLocalSwiftPackageReference') || !generated.includes('../../apple/Passwords') || !generated.includes('XCSwiftPackageProductDependency')) fail('canonical package graph');
    const app = path.join(prepared, appName);
    fs.cpSync(path.join(output, 'derived/Build/Products/Release', appName), app, { recursive: true, errorOnExist: true, force: false });
    for (const [label, id, bundle, ent] of [['host', hostID, app, 'Host'], ['provider', providerID, path.join(app, extension), 'Provider']]) {
      fs.copyFileSync(path.join(output, `${label}.provisionprofile`), path.join(bundle, 'Contents/embedded.provisionprofile'), fs.constants.COPYFILE_EXCL);
      const original = plist(fs.readFileSync(path.join(working, `macos/ThingtimePasswords/Resources/${ent}.entitlements`)));
      fs.writeFileSync(path.join(prepared, `${ent}.plist`), plistBytes(signingEntitlements(original, options.team, id)), { mode: 0o600, flag: 'wx' });
    }
    postChecked = true;
    for (const [server, host] of servers) receipt.controls.push(await networkControl(server, host, true, env));
    if (signal.aborted) fail('preparation cancelled before manifest');
    const manifest = { schemaVersion: 1, sourceSHA: options.sourceSHA, team: options.team, certificateSHA1: options.certificateSHA1, identityName: options.identityName, files: tree(prepared), tools: toolHashes(), sourceHashes: hashes, buildCommands: commands, networkControls: receipt.controls, generatedProjectSHA256: digest(generated) };
    validateManifest(manifest, prepared);
    fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    receipt.status = 'prepared'; receipt.manifestSHA256 = digest(fs.readFileSync(path.join(output, 'manifest.json')));
    return { manifest: path.join(output, 'manifest.json'), sha256: receipt.manifestSHA256 };
  } catch (error) { receipt.status = 'failed'; receipt.error = error.message; if (error.cleanup) receipt.lastCommandCleanup = error.cleanup; throw error; }
  finally {
    receipt.cancelled = signal.aborted;
    if (signal.aborted) receipt.cancelSignal = signal.reason;
    if (!postChecked && !signal.aborted) {
      postChecked = true;
      for (const [server, host] of servers) {
        try { receipt.controls.push(await networkControl(server, host, true, env)); }
        catch { receipt.status = 'failed'; receipt.postControlFailed = true; }
      }
    }
    for (const [server] of servers) await new Promise(resolve => server.close(resolve));
    receipt.listenersClosed = servers.every(([server]) => !server.listening); fs.closeSync(log);
    receipt.logClosed = true;
    if (signal.aborted) {
      receipt.status = 'failed'; receipt.cancelled = true; receipt.cancelSignal = signal.reason;
      const manifestPath = path.join(output, 'manifest.json');
      if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    }
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    if (signal.aborted) fail('preparation cancelled; owned resources cleaned');
  }
}
export async function signRelease({ manifest: filename, sha256, output }, { execute = system, verify = verifyPasswordProvider, validation = {} } = {}) {
  publicPath(filename);
  const bytes = fs.readFileSync(filename);
  if (!/^[a-f0-9]{64}$/.test(sha256) || digest(bytes) !== sha256) fail('reviewed manifest digest');
  const manifest = JSON.parse(bytes), prepared = path.join(path.dirname(filename), 'prepared');
  validateManifest(manifest, prepared, validation);
  const identities = execute('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
  if (typeof identities !== 'string' || !identities.split('\n').some(line => {
    const match = /^\s*\d+\) ([A-Fa-f0-9]{40}) "([^"\r\n]+)"$/.exec(line);
    return match && match[1].toUpperCase() === manifest.certificateSHA1 && match[2] === manifest.identityName;
  })) fail('valid local signing identity unavailable');
  newDirectory(output);
  const stage = path.join(output, 'stage'); fs.cpSync(prepared, stage, { recursive: true, errorOnExist: true, force: false });
  validateManifest(manifest, stage, validation);
  const app = path.join(stage, appName), provider = path.join(app, extension), order = [];
  try {
    for (const [label, bundle, entitlement] of [['provider', provider, 'Provider.plist'], ['host', app, 'Host.plist']]) {
      // Pin each executable immediately before trusted codesign; catch changes
      // made while signing the other bundle. Private staging does not isolate
      // arbitrary concurrent same-UID writers during the system signing call.
      const executable = path.join(bundle, 'Contents/MacOS', label === 'provider' ? 'ThingtimePasswordProvider' : 'Thingtime Passwords');
      publicPath(executable);
      const relative = path.relative(stage, executable).split(path.sep).join('/');
      if (!fs.lstatSync(executable).isFile() || fs.lstatSync(executable).nlink !== 1 || digest(fs.readFileSync(executable)) !== manifest.files[relative]) fail('pre-sign executable mutation');
      // An extension failure throws before the enclosing host can be signed.
      execute('/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--sign', manifest.certificateSHA1, '--entitlements', path.join(stage, entitlement), bundle]);
      execute('/usr/bin/codesign', ['--verify', '--strict', bundle]);
      order.push(label);
    }
    await verify(app, { teamIdentifier: manifest.team, signingIdentity: manifest.identityName, environment: systemEnvironment, bundleIdentifiers: [hostID, providerID] });
    // Non-executable payload stays byte-identical. Executable mutation by trusted
    // system codesign is expected; normalized post-sign Mach-O equality is not
    // checked, and arbitrary concurrent same-UID writers are outside this contract.
    const after = tree(stage);
    const signatureFiles = [`${appName}/Contents/_CodeSignature/CodeResources`, `${appName}/${extension}/Contents/_CodeSignature/CodeResources`];
    if (Object.keys(after).some(relative => !(relative in manifest.files) && !signatureFiles.includes(relative))) fail('unexpected signed bundle file');
    for (const [relative, hash] of Object.entries(manifest.files)) {
      if (relative.endsWith('/Contents/MacOS/Thingtime Passwords') || relative.endsWith('/Contents/MacOS/ThingtimePasswordProvider')) continue; // Mach-O LC_CODE_SIGNATURE changes.
      if (after[relative] !== hash) fail('signed payload mutation');
    }
    const receipt = { status: 'signed-and-verified', manifestSHA256: sha256, signingOrder: order, app, files: after, installed: false };
    fs.writeFileSync(path.join(output, 'signing-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return receipt;
  } catch (error) {
    fs.writeFileSync(path.join(output, 'signing-receipt.json'), `${JSON.stringify({ status: 'failed', signingOrder: order, installed: false, error: error.message }, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); throw error;
  }
}
export function parseOptions(args, names) {
  if (args.length !== names.length * 2) fail('arguments');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]; if (!names.includes(name) || name in options || !args[index + 1] || args[index + 1].startsWith('--')) fail('arguments'); options[name] = args[index + 1];
  }
  return options;
}
