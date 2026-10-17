import { verifyPasswordProvider } from './verify-password-provider.mjs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = path.join(root, 'macos/ThingtimePasswords');
const staging = path.join(root, 'electron/dist/native/Thingtime Passwords.app');
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
const settings = unsigned ? ['CODE_SIGNING_ALLOWED=NO', 'THINGTIME_PASSWORD_KEYCHAIN_GROUP=unsigned.com.thingtime.passwords'] : [
  `DEVELOPMENT_TEAM=${team}`, `CODE_SIGN_IDENTITY=${identity.startsWith("Apple Development:") && !process.env.THINGTIME_PASSWORD_PROVIDER_PROFILE ? "Apple Development" : identity}`,
  ...(process.env.THINGTIME_PASSWORD_HOST_PROFILE || process.env.THINGTIME_PASSWORD_PROVIDER_PROFILE ? ['CODE_SIGN_STYLE=Manual'] : ['-allowProvisioningUpdates'])
];
// Target-specific profile build settings live in the XcodeGen spec. Keeping
// profile names in the environment makes forks independent of this account.
run('xcodebuild', ['-project', 'ThingtimePasswords.xcodeproj', '-scheme', 'ThingtimePasswords', '-configuration', 'Release', '-derivedDataPath', 'build/release', ...settings, 'build']);
await mkdir(path.dirname(staging), { recursive: true }); await rm(staging, { recursive: true, force: true });
run('/usr/bin/ditto', ['build/release/Build/Products/Release/Thingtime Passwords.app', staging]);
if (unsigned) {
  for (const target of [path.join(staging, 'Contents/PlugIns/ThingtimePasswordProvider.appex'), staging]) run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', target]);
}
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging]);
await verifyPasswordProvider(staging, { unsigned, teamIdentifier: unsigned ? undefined : team });
console.log('Thingtime Passwords credential provider built and verified.');
