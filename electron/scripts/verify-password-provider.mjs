import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Password provider verification failed: ${path.basename(command)}.`);
  return result.stdout;
}
const plist = text => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], text));
export function assertPasswordProviderMetadata(info, expectedIdentifier, expectedVersion, { hostName, localizedInfo } = {}) {
  if (info.CFBundleIdentifier !== expectedIdentifier) throw new Error('Password provider bundle identifier mismatch.');
  // Finder ignores localization when the raw display name differs from the
  // physical basename. Preserve that filename and require its visible
  // branding in the actual bundled localization instead.
  if (info.CFBundleDisplayName !== (hostName || 'Thingtime') || info.CFBundleName !== 'Thingtime') throw new Error('Password provider display name must be Thingtime.');
  if (hostName && (localizedInfo?.CFBundleDisplayName !== 'Thingtime' || localizedInfo?.CFBundleName !== 'Thingtime')) throw new Error('Password provider host localization must display Thingtime.');
  const version = `${info.CFBundleShortVersionString}/${info.CFBundleVersion}`;
  if (!info.CFBundleShortVersionString || !info.CFBundleVersion || expectedVersion && version !== expectedVersion) throw new Error('Password provider host and extension versions must match.');
  return version;
}

export async function verifyPasswordProvider(app, { unsigned = false, teamIdentifier, signingIdentity } = {}) {
  const bundles = [
    [app, process.env.THINGTIME_PASSWORD_HOST_BUNDLE_ID || 'com.thingtime.passwords'],
    [path.join(app, 'Contents/PlugIns/ThingtimePasswordProvider.appex'), process.env.THINGTIME_PASSWORD_PROVIDER_BUNDLE_ID || 'com.thingtime.passwords.provider']
  ];
  let sharedGroup, sharedVersion;
  for (const [bundle, identifier] of bundles) {
    const info = plist(await readFile(path.join(bundle, 'Contents/Info.plist')));
    const host = bundle === app;
    const branding = host ? { hostName: path.basename(bundle, '.app'), localizedInfo: plist(await readFile(path.join(bundle, 'Contents/Resources/en.lproj/InfoPlist.strings'))) } : {};
    sharedVersion = assertPasswordProviderMetadata(info, identifier, sharedVersion, branding);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    if (unsigned) continue; // Ad-hoc builds exercise structure, not system permission.
    if (signingIdentity) {
      const details = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8' });
      if (details.status !== 0 || !details.stderr.split('\n').includes(`Authority=${signingIdentity}`)) throw new Error('Password provider signing identity mismatch.');
      if (signingIdentity.startsWith('Developer ID Application:') && !/^Timestamp=/m.test(details.stderr)) throw new Error('Password provider secure signing timestamp missing.');
    }
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
    if (permitted['com.apple.application-identifier'] !== `${team}.${identifier}`) throw new Error('Password provider profile bundle identifier mismatch.');
  }
}
