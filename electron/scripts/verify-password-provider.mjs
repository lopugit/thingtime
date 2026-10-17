import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Password provider verification failed: ${path.basename(command)}.`);
  return result.stdout;
}
const plist = text => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], text));
export async function verifyPasswordProvider(app, { unsigned = false, teamIdentifier } = {}) {
  const bundles = [
    [app, process.env.THINGTIME_PASSWORD_HOST_BUNDLE_ID || 'com.thingtime.passwords'],
    [path.join(app, 'Contents/PlugIns/ThingtimePasswordProvider.appex'), process.env.THINGTIME_PASSWORD_PROVIDER_BUNDLE_ID || 'com.thingtime.passwords.provider']
  ];
  let sharedGroup;
  for (const [bundle, identifier] of bundles) {
    const info = plist(await readFile(path.join(bundle, 'Contents/Info.plist')));
    if (info.CFBundleIdentifier !== identifier) throw new Error('Password provider bundle identifier mismatch.');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    if (unsigned) continue; // Ad-hoc builds exercise structure, not system permission.
    const entitlements = plist(run('/usr/bin/codesign', ['--display', '--entitlements', ':-', bundle]));
    if (!entitlements['com.apple.developer.authentication-services.autofill-credential-provider']) throw new Error('Password provider AutoFill entitlement missing.');
    const team = entitlements['com.apple.developer.team-identifier'];
    if (!team || teamIdentifier && team !== teamIdentifier) throw new Error('Password provider signing team mismatch.');
    const groups = entitlements['keychain-access-groups'];
    if (!Array.isArray(groups) || !groups.includes(info.ThingtimePasswordKeychainGroup) || sharedGroup && sharedGroup !== info.ThingtimePasswordKeychainGroup) throw new Error('Password provider shared Keychain entitlement mismatch.');
    sharedGroup = info.ThingtimePasswordKeychainGroup;
    const profileXML = run('/usr/bin/security', ['cms', '-D', '-i', path.join(bundle, 'Contents/embedded.provisionprofile')]);
    const profile = { ExpirationDate: run('/usr/bin/plutil', ['-extract', 'ExpirationDate', 'raw', '-o', '-', '-'], profileXML).trim(), TeamIdentifier: JSON.parse(run('/usr/bin/plutil', ['-extract', 'TeamIdentifier', 'json', '-o', '-', '-'], profileXML)), Entitlements: JSON.parse(run('/usr/bin/plutil', ['-extract', 'Entitlements', 'json', '-o', '-', '-'], profileXML)) };
    const permitted = profile.Entitlements;
    if (new Date(profile.ExpirationDate).getTime() <= Date.now() || !profile.TeamIdentifier?.includes(team) || permitted?.['com.apple.developer.authentication-services.autofill-credential-provider'] !== true) throw new Error('Password provider provisioning profile is invalid or lacks AutoFill.');
  }
}
