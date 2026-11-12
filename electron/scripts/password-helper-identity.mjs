import path from 'node:path';
import { createHash } from 'node:crypto';

export const PRODUCTION_PASSWORD_HOST = 'com.thingtime.passwords';
export function isolatedPasswordIdentity(hostIdentifier, teamIdentifier) {
  if (typeof hostIdentifier !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(hostIdentifier) ||
      hostIdentifier === PRODUCTION_PASSWORD_HOST || !/^[A-Z0-9]{10}$/.test(teamIdentifier || ''))
    throw Error('Choose an explicit isolated password host and signing team.');
  return Object.freeze({ hostIdentifier, providerIdentifier: `${hostIdentifier}.provider`,
    fixtureIdentifier: `${hostIdentifier}.fixture`, teamIdentifier,
    keychainGroup: `${teamIdentifier}.${hostIdentifier}`,
    notificationName: `${hostIdentifier}.destination-changed`,
    urlScheme: `thingtime-password-dev-${createHash('sha256').update(hostIdentifier).digest('hex')}` });
}

export function validateIsolatedPasswordIdentity(value) {
  const canonical = isolatedPasswordIdentity(value?.hostIdentifier, value?.teamIdentifier);
  if (Object.keys(value).some(key => !Object.hasOwn(canonical, key)) ||
      Object.entries(canonical).some(([key, expected]) => value[key] !== expected))
    throw Error('Isolated password identity must match its canonical derivation.');
  return canonical;
}

export function assertIsolatedPasswordMetadata(info, identity, fixture = false) {
  identity = validateIsolatedPasswordIdentity(identity);
  if (info.CFBundleIdentifier !== (fixture ? identity.fixtureIdentifier : identity.hostIdentifier) ||
      info.ThingtimePasswordKeychainGroup !== identity.keychainGroup ||
      info.ThingtimePasswordNotificationName !== identity.notificationName ||
      info.ThingtimePasswordDevelopmentHost !== identity.hostIdentifier)
    throw Error('Isolated password metadata does not match the selected identity.');
  const schemes = (info.CFBundleURLTypes || []).flatMap(type => type.CFBundleURLSchemes || []);
  if (fixture ? schemes.length !== 0 || info.ThingtimePasswordDevelopmentFixture !== true :
      schemes.length !== 1 || schemes[0] !== identity.urlScheme || info.ThingtimePasswordDevelopmentFixture === true)
    throw Error('Isolated password URL scheme or fixture scope is invalid.');
}

export function assertIsolatedPasswordEntitlements(entitlements, identity, identifier) {
  identity = validateIsolatedPasswordIdentity(identity);
  if (entitlements['com.apple.developer.team-identifier'] !== identity.teamIdentifier ||
      entitlements['com.apple.application-identifier'] !== `${identity.teamIdentifier}.${identifier}` ||
      entitlements['com.apple.security.app-sandbox'] !== true ||
      JSON.stringify(entitlements['keychain-access-groups']) !== JSON.stringify([identity.keychainGroup]) ||
      (entitlements['com.apple.security.application-groups'] || []).length !== 0)
    throw Error('Isolated password signature grants unexpected authority.');
}


export function assertIsolatedFixtureProfile(profile, identity) {
  identity = validateIsolatedPasswordIdentity(identity);
  const expires = new Date(profile?.ExpirationDate).getTime(), permitted = profile?.Entitlements;
  const wildcard = `${identity.teamIdentifier}.*`;
  if (!Number.isFinite(expires) || expires <= Date.now() ||
      !Array.isArray(profile.TeamIdentifier) || profile.TeamIdentifier.length !== 1 || profile.TeamIdentifier[0] !== identity.teamIdentifier ||
      !Array.isArray(profile.Platform) || !profile.Platform.includes('OSX') ||
      ![`${identity.teamIdentifier}.${identity.fixtureIdentifier}`, wildcard].includes(permitted?.['com.apple.application-identifier']) ||
      !Array.isArray(permitted?.['keychain-access-groups']) || !permitted['keychain-access-groups'].length ||
      permitted['keychain-access-groups'].some(group => ![identity.keychainGroup, wildcard].includes(group)))
    throw Error('Fixture provisioning authorization mismatch.');
}

export function passwordHelperOptions(args) {
  const read = name => {
    const values = args.filter(value => value.startsWith(`--password-helper-${name}=`));
    if (values.length > 1) throw Error('Duplicate password helper option.');
    return values[0]?.slice(`--password-helper-${name}=`.length);
  };
  const app = read('app'), hostIdentifier = read('host'), teamIdentifier = read('team'), signingIdentity = read('signing-identity');
  if (![app, hostIdentifier, teamIdentifier, signingIdentity].some(value => value !== undefined)) return undefined;
  if (!app || !path.isAbsolute(app) || !hostIdentifier || !teamIdentifier || !signingIdentity || !/^(Apple Development:|Developer ID Application:)/.test(signingIdentity)) throw Error('Provide the absolute helper app, isolated host, signing team and exact signing identity together.');
  return Object.freeze({ app, identity: isolatedPasswordIdentity(hostIdentifier, teamIdentifier), signingIdentity });
}
