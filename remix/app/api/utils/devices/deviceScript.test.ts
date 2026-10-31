import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceCommand, deviceSupportsCommand, deviceCommandRequiresApproval } from './deviceCore';
import { normalizeDeviceScriptResult } from './deviceScript';
test('script commands require explicit approval and an advertised capability', () => {
	assert.equal(deviceCommandRequiresApproval('script.run', false), true);
	assert.equal(deviceSupportsCommand('script.run', []), false);
	assert.equal(deviceSupportsCommand('script.run', ['script.bash.v1']), true);
	assert.equal(normalizeDeviceCommand('script.run', { script: 'printf ok', timeoutSeconds: 2 }).ok, true);
	for (const input of [
		{ script: '', timeoutSeconds: 2 },
		{ script: 'a\0b', timeoutSeconds: 2 },
		{ script: 'a'.repeat(16385), timeoutSeconds: 2 },
		{ script: 'echo ok', timeoutSeconds: 31 },
		{ script: 'echo ok', timeoutSeconds: 2, env: { SECRET: 'x' } }
	])
		assert.equal(normalizeDeviceCommand('script.run', input).ok, false);
});
test('script results keep nonzero exits, explicit truncation, and reject unknown or oversized data', () => {
	const result = { stdout: '', stderr: 'failed', exitCode: 7, signal: null, timedOut: false, truncated: false };
	assert.deepEqual(normalizeDeviceScriptResult(result), result);
	assert.equal(normalizeDeviceScriptResult({ ...result, token: 'secret' }), null);
	assert.equal(normalizeDeviceScriptResult({ ...result, stdout: 'a'.repeat(49153) }), null);
	assert.equal(normalizeDeviceScriptResult({ ...result, signal: 9 }), null);
	assert.ok(normalizeDeviceScriptResult({ ...result, exitCode: null, signal: 9, timedOut: true }));
});

test('script output is absent from lists and expires from exact reads', async () => {
  const { publicDeviceCommand } = await import('./deviceCommands');
  const now = new Date();
  const doc = { shareId: 'run', targetId: 'mac', createdAt: now, updatedAt: now, crystal: {
    kind: 'script.run', status: 'succeeded', input: { script: 'printf ok', timeoutSeconds: 1 },
    result: { stdout: 'ok', stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false },
    resultExpiresAt: new Date(now.getTime() + 600_000)
  }};
  assert.equal(publicDeviceCommand(doc).result, undefined);
  assert.deepEqual(publicDeviceCommand(doc, true).result, doc.crystal.result);
  assert.equal(publicDeviceCommand({ ...doc, crystal: { ...doc.crystal, resultExpiresAt: now } }, true).result, undefined);
});
