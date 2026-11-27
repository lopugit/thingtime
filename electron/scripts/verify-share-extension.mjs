import { access, readFile } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('The bundled Share extension failed verification.');
  return result;
}
function plist(file) { return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]).stdout); }
function signedFacts(file) {
  run('/usr/bin/codesign', ['--verify', '--strict', file]);
  const detail = run('/usr/bin/codesign', ['--display', '--verbose=4', file]).stderr;
  const xml = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', file]).stdout;
  const entitlements = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], xml).stdout);
  return { team: /^TeamIdentifier=(.+)$/mu.exec(detail)?.[1], identifier: /^Identifier=(.+)$/mu.exec(detail)?.[1], entitlements };
}

export function verifyUnprovisionedShareEntitlements(entitlements) {
  // These binaries use macOS team-prefixed App Groups without provisioning.
  // Claiming restricted identity entitlements makes taskgated require a profile
  // even though codesign --verify succeeds.
  for (const key of ['com.apple.application-identifier', 'com.apple.developer.team-identifier']) {
    if (Object.hasOwn(entitlements, key)) {
      throw new Error('The unprovisioned Share extension must not claim restricted identity entitlements.');
    }
  }
}

export async function verifyShareExtension(appPath, { required = false, teamIdentifier, unsigned = false } = {}) {
  const resources = path.join(appPath, 'Contents/Resources');
  const extension = path.join(appPath, 'Contents/PlugIns/ThingtimeShare.appex');
  const bridge = path.join(resources, 'ThingtimeShareBridge');
  const manifestPath = path.join(resources, 'thingtime-share.json');
  const presence = [extension, bridge, manifestPath].map(existsSync);
  // Old signed releases remain restorable; partial new packages never pass.
  if (!presence.some(Boolean) && !required) return;
  if (!presence.every(Boolean)) throw new Error('The Thingtime Share extension package is incomplete.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const info = plist(path.join(extension, 'Contents/Info.plist'));
  const appInfo = plist(path.join(appPath, 'Contents/Info.plist'));
  if (info.CFBundleIdentifier !== 'com.thingtime.desktop.share' ||
      info.NSExtension?.NSExtensionPointIdentifier !== 'com.apple.share-services' ||
      !info.NSExtension?.NSExtensionPrincipalClass ||
      !info.NSExtension?.NSExtensionAttributes?.NSExtensionActivationRule ||
      info.ThingtimeWidgetGroup !== manifest.appGroup || manifest.version !== '1.1.0' ||
      !appInfo.CFBundleURLTypes?.some(value => value.CFBundleURLSchemes?.includes('thingtime-share'))) {
    throw new Error('The Thingtime Share extension identity or handoff contract is invalid.');
  }
  const extensionExecutable = path.join(extension, 'Contents/MacOS', info.CFBundleExecutable);
  await access(extensionExecutable, constants.X_OK);
  await access(bridge, constants.X_OK);
  for (const executable of [extensionExecutable, bridge]) {
    const headers = run('/usr/bin/otool', ['-hv', executable]).stdout;
    if (!/\bEXECUTE\b/u.test(headers) || /\bDYLIB\b/u.test(headers))
      throw new Error('The Share extension and bridge must be Mach-O executables.');
  }
  const extensionSignature = signedFacts(extension), bridgeSignature = signedFacts(bridge);
  for (const signature of [extensionSignature, bridgeSignature]) {
    verifyUnprovisionedShareEntitlements(signature.entitlements);
  }
  if (bridgeSignature.identifier !== 'com.thingtime.desktop.share-bridge' ||
      extensionSignature.entitlements['com.apple.security.app-sandbox'] !== true ||
      ![extensionSignature, bridgeSignature].every(value => value.entitlements['com.apple.security.application-groups']?.includes(manifest.appGroup))) {
    throw new Error('The Thingtime Share extension lacks its scoped container entitlement.');
  }
  if (!unsigned && (!teamIdentifier || manifest.appGroup !== `${teamIdentifier}.com.thingtime.desktop.share` ||
      ![extensionSignature, bridgeSignature].every(value => value.team === teamIdentifier))) {
    throw new Error('The Share extension and Thingtime must have the same signing team.');
  }
}
