import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { networkSandbox, verifyNativePasswordPasskey } from './verify-native-password-passkey.mjs';

test('canonical password checks retain the public interoperability gate', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const manifest = JSON.parse(await readFile(path.join(root, 'remix/package.json'), 'utf8'));
  assert.ok(manifest.scripts['test:passwords'].endsWith('&& node scripts/verify-native-password-passkey.mjs'));
  assert.ok(manifest.scripts['test:passwords'].includes('scripts/native-password-passkey.test.mjs'));

});

async function withTemporaryRoot(work) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'passkey-gate-test-'));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('unsupported platforms explicitly skip without running commands', async () => {
  const result = await verifyNativePasswordPasskey({ platform: 'linux', execute() { assert.fail('must not execute'); } });
  assert.equal(result.status, 'skipped');
});

test('macOS gate creates a fixture, verifies it under the same network boundary and cleans up', async () => {
  await withTemporaryRoot(async temporaryRoot => {
    const calls = [];
    const result = await verifyNativePasswordPasskey({ platform: 'darwin', temporaryRoot, environment: { THINGTIME_PASSWORD_TEST_SESSION: 'must-not-forward' }, execute(command, args, options) {
      calls.push(args);
      assert.equal(command, '/usr/bin/sandbox-exec');
      assert.deepEqual(args.slice(0, 2), ['-p', networkSandbox]);
      assert.equal(options.env.THINGTIME_PASSWORD_TEST_SESSION, undefined);
      if (args.includes('swift')) {
        assert.ok(args.includes('--disable-sandbox'));
        assert.equal(args.at(-1), 'CoreTests/testWebAuthnInteroperabilityFixture');
        // The subprocess writes synchronously before returning.
        spawnSync(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "{}")', options.env.THINGTIME_PASSKEY_FIXTURE_PATH]);
      }
      return { status: 0 };
    } });
    assert.equal(result.status, 'passed');
    assert.equal(calls.length, 2);
    assert.ok(calls[1].some(value => value.endsWith('/verify-password-passkey.mjs')));
    assert.deepEqual(await readdir(temporaryRoot), []);
  });
});

for (const failure of ['swift', 'missing fixture', 'verifier', 'timeout']) {
  test(`macOS gate fails closed and cleans up after ${failure}`, async () => {
    await withTemporaryRoot(async temporaryRoot => {
      let calls = 0;
      await assert.rejects(verifyNativePasswordPasskey({ platform: 'darwin', temporaryRoot, execute(command, args, options) {
        calls += 1;
        if (calls === 1) {
          if (failure === 'swift') return { status: 1 };
          if (failure === 'timeout') return { status: null, error: { code: 'ETIMEDOUT' } };
          if (failure !== 'missing fixture') spawnSync(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "{}")', options.env.THINGTIME_PASSKEY_FIXTURE_PATH]);
          return { status: 0 };
        }
        return { status: 1 };
      } }));
      assert.equal(calls, failure === 'verifier' ? 2 : 1);
      assert.deepEqual(await readdir(temporaryRoot), []);
    });
  });
}

test('independent real verifier accepts public native outputs and rejects tampered ceremonies', async () => {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const original = JSON.parse(await readFile(path.join(scriptDirectory, 'fixtures/native-passkey-public.json'), 'utf8'));
  await withTemporaryRoot(async directory => {
    const cases = [
      ['valid', () => {}, true],
      ['wrong challenge', fixture => { fixture.challenge = 'different-challenge'; }, false],
      ['wrong origin', fixture => { fixture.origin = 'https://attacker.test'; }, false],
      ['invalid signature', fixture => { fixture.authentication.response.signature = Buffer.alloc(64).toString('base64url'); }, false],
      ['missing user verification', fixture => {
        const bytes = Buffer.from(fixture.authentication.response.authenticatorData, 'base64url');
        bytes[32] &= ~0x04;
        fixture.authentication.response.authenticatorData = bytes.toString('base64url');
      }, false],
    ];
    for (const [label, change, valid] of cases) {
      const fixture = structuredClone(original); change(fixture);
      const filename = path.join(directory, 'public.json');
      await writeFile(filename, JSON.stringify(fixture));
      const result = spawnSync(process.execPath, [path.join(scriptDirectory, 'verify-password-passkey.mjs'), filename], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.error, undefined, label);
      assert.equal(result.status === 0, valid, label);
    }
  });
});
