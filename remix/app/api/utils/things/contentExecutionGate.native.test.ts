import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('execution receipts use the selected native history without hosted fallback', async () => {
 const { stdout } = await promisify(execFile)(process.execPath, [
  '--experimental-test-module-mocks', '--import', 'tsx',
  fileURLToPath(new URL('./contentExecutionGate.native.fixture.mts', import.meta.url))
 ], { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 30000, maxBuffer: 16384 });
 assert.match(stdout, /native-execution-gates: passed/);
});
