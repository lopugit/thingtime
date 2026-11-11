import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { passwordHelperOptions } from './password-helper-identity.mjs';
import { verifyPasswordProvider, verifyIsolatedPasswordFixture } from './verify-password-provider.mjs';

// Protocol separated for controlled uncertain-write/competing-authority tests.
// Cleanup requires an independent exact-session witness, never origin alone.
export function provePasswordRetirementProtocol({ assertEmpty, seed, exactState, status, retire }) {
  assertEmpty();
  let mayOwn = false, completed = false;
  try {
    mayOwn = true; seed();
    if (!exactState().matches || status() !== 'connected') throw Error('The synthetic authority did not persist.');
    retire('wrong');
    if (!exactState().matches || status() !== 'connected') throw Error('Wrong-origin retirement changed the authority.');
    retire('matching'); assertEmpty();
    if (status() !== 'disconnected') throw Error('The synthetic authority was not retired.');
    retire('empty-loopback'); assertEmpty(); completed = true;
    return { canonicalStoreSeeded: true, freshProcessReadback: true, wrongOriginPreserved: true,
      actualHelperRetirement: true, privateGroupEmpty: true, emptyGroupLoopbackRetirement: true, realAccountOrServerUsed: false };
  } finally {
    if (mayOwn && !completed) {
      let observed;
      try { observed = exactState(); } catch { throw Error('Cleanup ownership unavailable; authority preserved.'); }
      if (observed.empty === true) assertEmpty();
      else if (observed.matches === true) { retire('matching'); assertEmpty(); }
      else throw Error('Cleanup ownership unverified; authority preserved.');
    }
  }
}

export async function proveIsolatedPasswordRetirement(helper, fixtureApp) {
  if (!helper || !path.isAbsolute(fixtureApp || '')) throw Error('Select an isolated helper and separate fixture app.');
  await verifyPasswordProvider(helper.app, { isolatedIdentity: helper.identity, teamIdentifier: helper.identity.teamIdentifier, signingIdentity: helper.signingIdentity });
  await verifyIsolatedPasswordFixture(fixtureApp, helper.identity, helper.signingIdentity);
  const execute = (app, args, input) => {
    const executable = path.join(app, 'Contents/MacOS', app === helper.app ? 'Thingtime Passwords' : 'Thingtime Password Fixture');
    const result = spawnSync(executable, args, { input: input ? JSON.stringify(input) : undefined,
      encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) throw Error('The isolated credential-store operation failed.');
    return result.stdout.trim();
  };
  // These bytes are synthetic and stay in memory/stdin, never argv or receipts.
  const session = { origin: 'https://native-auto-qa.invalid', ownerId: `native-bundle-qa-${randomBytes(16).toString('hex')}`,
    cookie: `tt_auth=thingtime-native-qa-${randomBytes(32).toString('hex')}` };
  const status = () => {
    try {
      const value = JSON.parse(execute(helper.app, ['--status'], session));
      if (['connected','disconnected','differentSession','unavailable'].includes(value)) return value;
    } catch { /* Never include native output in an error. */ }
    throw Error('The isolated helper returned unavailable status.');
  };
  const lockPath = path.join(os.tmpdir(), `thingtime-password-proof-${createHash('sha256').update(helper.identity.keychainGroup).digest('hex')}.lock`);
  const lock = await open(lockPath, 'wx', 0o600);
  try { return provePasswordRetirementProtocol({ status,
    assertEmpty: () => execute(fixtureApp, ['--assert-empty']),
    seed: () => execute(fixtureApp, ['--seed'], session),
    exactState: () => {
      let value;
      try { value = JSON.parse(execute(fixtureApp, ['--exact-state'], session)); } catch { throw Error('Exact ownership is unavailable.'); }
      if (typeof value.empty !== 'boolean' || typeof value.matches !== 'boolean' || value.empty && value.matches) throw Error('Exact ownership is unavailable.');
      return { empty: value.empty, matches: value.matches };
    },
    retire: kind => execute(helper.app, ['--disconnect', '--automatic'], {
      origin: kind === 'wrong' ? 'https://wrong-native-auto-qa.invalid' : kind === 'matching' ? session.origin : 'http://127.0.0.1:27654'
    })
  }); } finally { await lock.close(); await unlink(lockPath); }
}

// Node resolves module URLs through symlinks (including macOS /var).
let cliPath;
try { if (process.argv[1]) cliPath = realpathSync(process.argv[1]); } catch { /* Imported from stdin/another host. */ }
if (cliPath === fileURLToPath(import.meta.url)) {
  const helper = passwordHelperOptions(process.argv);
  const fixture = process.argv.find(value => value.startsWith('--fixture-app='))?.slice('--fixture-app='.length);
  console.log(JSON.stringify(await proveIsolatedPasswordRetirement(helper, fixture)));
}
