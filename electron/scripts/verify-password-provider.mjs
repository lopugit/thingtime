import { assertIsolatedFixtureProfile, validateIsolatedPasswordIdentity, assertIsolatedPasswordMetadata, assertIsolatedPasswordEntitlements } from './password-helper-identity.mjs';
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
  if (!['Thingtime', 'Thingtime.icns'].includes(info.CFBundleIconFile) || info.CFBundleIconName !== 'Thingtime') throw new Error('Password provider tree app icon and compiled asset name must be declared.');
  const version = `${info.CFBundleShortVersionString}/${info.CFBundleVersion}`;
  if (!info.CFBundleShortVersionString || !info.CFBundleVersion || expectedVersion && version !== expectedVersion) throw new Error('Password provider host and extension versions must match.');
  return version;
}

export function assertPasswordProviderIconCatalog(renditions) {
  // Checking the .icns alone misses the catalog used by system provider pickers.
  // Verify actual compiled image renditions, not only an empty Assets.car file.
  const icons = Array.isArray(renditions) ? renditions.filter(item => item.AssetType === 'Icon Image' && item.Name === 'Thingtime') : [];
  for (const points of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      if (!icons.some(icon => icon.Scale === scale && icon.PixelWidth === points * scale && icon.PixelHeight === points * scale)) throw new Error('Password provider compiled tree app icon is missing a required macOS rendition.');
    }
  }
}

export async function verifyPasswordProvider(app, { unsigned = false, teamIdentifier, signingIdentity, isolatedIdentity } = {}) {
  if (isolatedIdentity) {
    isolatedIdentity = validateIsolatedPasswordIdentity(isolatedIdentity);
    if (!signingIdentity) throw Error('Select the exact isolated helper signing identity.');
  }
  const bundles = [
    [app, isolatedIdentity?.hostIdentifier || 'com.thingtime.passwords'],
    [path.join(app, 'Contents/PlugIns/ThingtimePasswordProvider.appex'), isolatedIdentity?.providerIdentifier || 'com.thingtime.passwords.provider']
  ];
  let sharedGroup, sharedVersion;
  for (const [bundle, identifier] of bundles) {
    const info = plist(await readFile(path.join(bundle, 'Contents/Info.plist')));
    const host = bundle === app;
    if (isolatedIdentity && host) assertIsolatedPasswordMetadata(info, isolatedIdentity);
    const branding = host ? { hostName: path.basename(bundle, '.app'), localizedInfo: plist(await readFile(path.join(bundle, 'Contents/Resources/en.lproj/InfoPlist.strings'))) } : {};
    sharedVersion = assertPasswordProviderMetadata(info, identifier, sharedVersion, branding);
    const icon = await readFile(path.join(bundle, 'Contents/Resources/Thingtime.icns'));
    const tree = await readFile(path.join(bundle, 'Contents/Resources/ThingtimeTree.png'));
    if (icon.toString('ascii', 0, 4) !== 'icns' || icon.length < 8 || icon.readUInt32BE(4) !== icon.length || tree.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Password provider tree branding resources are missing or invalid.');
    assertPasswordProviderIconCatalog(JSON.parse(run('/usr/bin/assetutil', ['--info', path.join(bundle, 'Contents/Resources/Assets.car')])));
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    if (isolatedIdentity && unsigned) throw Error('Isolated runtime helpers require real signing.');
    if (unsigned) continue; // Ad-hoc builds exercise structure, not system permission.
    if (isolatedIdentity) {
      const signed = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8' });
      if (signed.status !== 0 || !/^Authority=(Apple Development:|Developer ID Application:)/m.test(signed.stderr)) throw Error('Isolated helper requires a real signing authority.');
    }
    if (signingIdentity) {
      const details = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8' });
      if (details.status !== 0 || !details.stderr.split('\n').includes(`Authority=${signingIdentity}`)) throw new Error('Password provider signing identity mismatch.');
      if (signingIdentity.startsWith('Developer ID Application:') && !/^Timestamp=/m.test(details.stderr)) throw new Error('Password provider secure signing timestamp missing.');
    }
    const entitlements = plist(run('/usr/bin/codesign', ['--display', '--entitlements', ':-', bundle]));
    if (isolatedIdentity) assertIsolatedPasswordEntitlements(entitlements, isolatedIdentity, identifier);
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


export async function verifyIsolatedPasswordFixture(app, identity, signingIdentity) {
  identity = validateIsolatedPasswordIdentity(identity);
  if (!signingIdentity?.startsWith('Apple Development:')) throw Error('Select the exact fixture Apple Development identity.');
  const info = plist(await readFile(path.join(app, 'Contents/Info.plist')));
  assertIsolatedPasswordMetadata(info, identity, true);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const details = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', app], { encoding: 'utf8' });
  if (details.status !== 0 || !/^Authority=Apple Development:/m.test(details.stderr) ||
      signingIdentity && !details.stderr.split('\n').includes(`Authority=${signingIdentity}`)) throw Error('Fixture must have the selected real signing authority.');
  assertIsolatedPasswordEntitlements(plist(run('/usr/bin/codesign', ['--display', '--entitlements', ':-', app])), identity, identity.fixtureIdentifier);
  const xml = run('/usr/bin/security', ['cms', '-D', '-i', path.join(app, 'Contents/embedded.provisionprofile')]);
  const expires = run('/usr/bin/plutil', ['-extract', 'ExpirationDate', 'raw', '-o', '-', '-'], xml).trim();
  const teams = JSON.parse(run('/usr/bin/plutil', ['-extract', 'TeamIdentifier', 'json', '-o', '-', '-'], xml));
  const permitted = JSON.parse(run('/usr/bin/plutil', ['-extract', 'Entitlements', 'json', '-o', '-', '-'], xml));
  const platform = JSON.parse(run('/usr/bin/plutil', ['-extract', 'Platform', 'json', '-o', '-', '-'], xml));
  assertIsolatedFixtureProfile({ ExpirationDate: expires, TeamIdentifier: teams, Platform: platform, Entitlements: permitted }, identity);
}
