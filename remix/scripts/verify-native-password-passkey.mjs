import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const networkSandbox = '(version 1) (allow default) (deny network*)';

// Only public ceremony outputs leave Swift. No session, Keychain or OS provider
// test is selected. The outer sandbox covers the compiler and both verifiers.
export async function verifyNativePasswordPasskey({ platform = process.platform, temporaryRoot = os.tmpdir(), execute = spawnSync, environment = process.env } = {}) {
  if (platform !== 'darwin') return { status: 'skipped', reason: 'Native passkey interoperability requires macOS and Xcode.' };
  const directory = await mkdtemp(path.join(temporaryRoot, 'thingtime-passkey-interop-'));
  try {
    await chmod(directory, 0o700);
    const fixture = path.join(directory, 'public-ceremony.json');
    const env = { ...environment, THINGTIME_PASSKEY_FIXTURE_PATH: fixture };
    delete env.THINGTIME_PASSWORD_TEST_SESSION;
    const run = (label, command, args) => {
      const result = execute('/usr/bin/sandbox-exec', ['-p', networkSandbox, command, ...args], {
        cwd: root, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) throw new Error(`${label} failed (${result.error?.code || result.signal || result.status || 'unavailable'}).`);
    };
    // SwiftPM's own nested sandbox cannot be applied inside sandbox-exec. This
    // flag disables only that nested sandbox; the network-denying outer one stays.
    run('Native passkey fixture', '/usr/bin/xcrun', ['swift', 'test', '--disable-sandbox', '--package-path', path.join(root, 'apple/Passwords'), '--scratch-path', path.join(directory, 'swift-build'), '--filter', 'CoreTests/testWebAuthnInteroperabilityFixture']);
    JSON.parse(await readFile(fixture, 'utf8')); // Missing/skipped output fails closed.
    run('Independent WebAuthn verification', process.execPath, [path.join(root, 'remix/scripts/verify-password-passkey.mjs'), fixture]);
    return { status: 'passed' };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyNativePasswordPasskey();
    console.log(result.status === 'passed' ? 'Native passkey interoperability passed: registration, assertion, UV, synchronized backup and wrong-RP rejection.' : `SKIP: ${result.reason}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
