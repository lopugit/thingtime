import { verifyPasswordProvider } from './verify-password-provider.mjs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = path.join(root, 'macos/ThingtimePasswords');
const defaultStaging = path.join(root, 'electron/dist/native/Thingtime Passwords.app');
const defaultBuildDir = path.join(project, 'build');
const isolatedSettings = ['HOST_BUNDLE_ID', 'PROVIDER_BUNDLE_ID', 'KEYCHAIN_GROUP', 'STAGING_APP', 'BUILD_DIR'];
const isolated = isolatedSettings.some(key => Boolean(process.env[`THINGTIME_PASSWORD_${key}`]));
let staging = defaultStaging;
let buildDir = defaultBuildDir;
let identitySettings = [];
if (isolated) {
  if (!isolatedSettings.every(key => process.env[`THINGTIME_PASSWORD_${key}`])) throw new Error('Isolated Password AutoFill builds require host/provider bundle IDs, Keychain group, staging app and build directory together.');
  const host = process.env.THINGTIME_PASSWORD_HOST_BUNDLE_ID;
  const provider = process.env.THINGTIME_PASSWORD_PROVIDER_BUNDLE_ID;
  const group = process.env.THINGTIME_PASSWORD_KEYCHAIN_GROUP;
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(host) || host === 'com.thingtime.passwords' || provider !== `${host}.provider` || !/^[A-Za-z0-9.-]+$/.test(group) || !group.endsWith(`.${host}`)) throw new Error('Isolated Password AutoFill identities must be distinct, related bundle IDs and a matching private Keychain group.');
  staging = path.resolve(process.env.THINGTIME_PASSWORD_STAGING_APP);
  buildDir = path.resolve(process.env.THINGTIME_PASSWORD_BUILD_DIR);
  if (!path.isAbsolute(process.env.THINGTIME_PASSWORD_STAGING_APP) || !path.isAbsolute(process.env.THINGTIME_PASSWORD_BUILD_DIR) || !staging.endsWith('.app') || staging === defaultStaging || buildDir === defaultBuildDir || staging.split(path.sep).includes('Applications') || buildDir.split(path.sep).includes('Applications')) throw new Error('Isolated build outputs must use absolute, separate build/staging paths outside Applications.');
  identitySettings = [`THINGTIME_PASSWORD_HOST_BUNDLE_ID=${host}`, `THINGTIME_PASSWORD_PROVIDER_BUNDLE_ID=${provider}`, `THINGTIME_PASSWORD_KEYCHAIN_GROUP=${group}`];
}
const unsigned = process.env.THINGTIME_NODE_SIGNING_MODE === 'unsigned';
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: project, env: process.env, stdio: capture ? ['ignore','pipe','pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Password provider build failed: ${path.basename(command)} (${result.status ?? 'unavailable'}).`);
  return result.stdout || '';
}
if (process.platform !== 'darwin') throw new Error('Apple credential providers require macOS and Xcode.');
let identity = process.env.THINGTIME_PASSWORD_SIGNING_IDENTITY || process.env.THINGTIME_NODE_SIGNING_IDENTITY || '';
let team = process.env.APPLE_TEAM_ID || process.env.DEVELOPMENT_TEAM || '';
if (!unsigned) {
  if (!identity) throw new Error('Set THINGTIME_PASSWORD_SIGNING_IDENTITY to an Apple signing identity.');
  if (!team) {
    const certificate = run('/usr/bin/security', ['find-certificate', '-c', identity, '-p'], true);
    const parsed = spawnSync('/usr/bin/openssl', ['x509', '-noout', '-subject', '-nameopt', 'RFC2253'], { input: certificate, encoding: 'utf8' });
    team = /(?:^|,)OU=([A-Z0-9]{10})(?:,|$)/.exec(parsed.stdout || '')?.[1] || '';
  }
  if (!team) throw new Error('Set APPLE_TEAM_ID for the Password AutoFill keychain group and provisioning profiles.');
}
run('xcodegen', ['generate']);
const hostProfile = process.env.THINGTIME_PASSWORD_HOST_PROFILE;
const providerProfile = process.env.THINGTIME_PASSWORD_PROVIDER_PROFILE;
if (Boolean(hostProfile) !== Boolean(providerProfile)) throw new Error('Set both Password AutoFill host and extension provisioning profiles, or neither.');
const exportDeveloperId = !unsigned && identity.startsWith('Developer ID Application:') && !hostProfile;
const settings = unsigned ? ['CODE_SIGNING_ALLOWED=NO', ...(!isolated ? ['THINGTIME_PASSWORD_KEYCHAIN_GROUP=unsigned.com.thingtime.passwords'] : [])] : [
  `DEVELOPMENT_TEAM=${team}`, `CODE_SIGN_IDENTITY=${exportDeveloperId || identity.startsWith('Apple Development:') && !providerProfile ? 'Apple Development' : identity}`,
  ...(hostProfile ? ['CODE_SIGN_STYLE=Manual'] : ['CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates']),
  ...(process.env.THINGTIME_PASSWORD_REGISTER_DEVICE === '1' ? ['-allowProvisioningDeviceRegistration'] : [])
];
settings.push(...identitySettings);
// Target-specific profile build settings live in the XcodeGen spec. Keeping
// profile names in the environment makes forks independent of this account.
const buildArguments = ['-project', 'ThingtimePasswords.xcodeproj', '-scheme', 'ThingtimePasswords', '-configuration', 'Release', '-derivedDataPath', path.join(buildDir, 'release'), ...settings];
let builtApp = path.join(buildDir, 'release/Build/Products/Release/Thingtime Passwords.app');
if (exportDeveloperId) {
  // Xcode automatic signing builds a development archive, then provisions and
  // signs the exported host and extension for Developer ID distribution. A
  // Developer ID identity on an automatically signed build fails before export.
  const archive = path.join(buildDir, 'ThingtimePasswords.xcarchive');
  const exported = path.join(buildDir, 'developer-id');
  const options = path.join(buildDir, 'developer-id-options.plist');
  await mkdir(path.dirname(options), { recursive: true });
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await writeFile(options, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>method</key><string>developer-id</string><key>signingStyle</key><string>automatic</string><key>teamID</key><string>${escape(team)}</string><key>signingCertificate</key><string>${escape(identity)}</string></dict></plist>`);
  run('xcodebuild', [...buildArguments, '-archivePath', archive, 'archive']);
  run('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportPath', exported, '-exportOptionsPlist', options, '-allowProvisioningUpdates']);
  builtApp = path.join(exported, 'Thingtime Passwords.app');
} else {
  run('xcodebuild', [...buildArguments, 'build']);
}
// Never replace the last verified helper with an invalid export.
if (!unsigned) await verifyPasswordProvider(path.resolve(project, builtApp), { teamIdentifier: team, signingIdentity: identity });
await mkdir(path.dirname(staging), { recursive: true }); await rm(staging, { recursive: true, force: true });
run('/usr/bin/ditto', [builtApp, staging]);
if (unsigned) {
  for (const target of [path.join(staging, 'Contents/PlugIns/ThingtimePasswordProvider.appex'), staging]) run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', target]);
}
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging]);
await verifyPasswordProvider(staging, { unsigned, teamIdentifier: unsigned ? undefined : team, signingIdentity: unsigned ? undefined : identity });
console.log('Thingtime credential provider built and verified.');
