import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.platform !== 'darwin') throw new Error('The macOS Share extension requires macOS and Xcode.');
const unsigned = process.env.THINGTIME_NODE_SIGNING_MODE === 'unsigned';
const identity = process.env.THINGTIME_SHARE_SIGN_IDENTITY || process.env.THINGTIME_NODE_SIGNING_IDENTITY;
let team = process.env.THINGTIME_SHARE_TEAM_ID || process.env.APPLE_TEAM_ID || process.env.DEVELOPMENT_TEAM;
if (!unsigned) {
  if (!identity) throw new Error('The Share extension needs the same signing identity as Thingtime.');
  if (!team) {
    const certificate = spawnSync('/usr/bin/security', ['find-certificate', '-c', identity, '-p'], { encoding: 'utf8' });
    if (certificate.status !== 0) throw new Error('The Share extension signing certificate is unavailable.');
    const subject = spawnSync('/usr/bin/openssl', ['x509', '-noout', '-subject', '-nameopt', 'RFC2253'], { input: certificate.stdout, encoding: 'utf8' });
    team = /(?:^|,)OU=([A-Z0-9]{10})(?:,|$)/u.exec(subject.stdout || '')?.[1];
  }
  if (!/^[A-Z0-9]{10}$/u.test(team || '')) throw new Error('The Share extension requires a valid signing team.');
}
const result = spawnSync('/bin/bash', [path.join(root, 'macos/ThingtimeShare/build.sh'), path.join(root, 'electron/dist/native')], {
  cwd: root, stdio: 'inherit', env: {
    ...process.env,
    THINGTIME_SHARE_SIGN_IDENTITY: unsigned ? '' : identity,
    THINGTIME_SHARE_TEAM_ID: unsigned ? '' : team,
    THINGTIME_SHARE_APP_GROUP: unsigned ? 'group.com.thingtime.desktop.share.unsigned' : `${team}.com.thingtime.desktop.share`,
  },
});
if (result.error || result.status !== 0) throw new Error(`Share extension build failed (${result.status ?? 'unavailable'}).`);
