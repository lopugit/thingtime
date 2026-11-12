import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('canonical author projection uses the selected native identity home and preserves Mongo projection', async () => {
 const { stdout } = await promisify(execFile)(process.execPath, [
  '--experimental-test-module-mocks', '--import', 'tsx',
  fileURLToPath(new URL('./nativeProfiles.fixture.mts', import.meta.url))
 ], { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 30000, maxBuffer: 16384 });
 assert.match(stdout, /native-profile-projection: 6 checks passed/);
});
