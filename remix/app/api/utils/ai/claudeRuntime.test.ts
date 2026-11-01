import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { unpackClaudeRuntime } from './claudeRuntime';

test('packaged runtime is bounded and integrity checked before execution', async () => {
	const root = await mkdtemp(join(tmpdir(), 'claude-runtime-test-'));
	try {
		const bytes = Buffer.from('synthetic executable');
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		await writeFile(join(root, 'claude.gz'), gzipSync(bytes));
		await writeFile(join(root, 'runtime.json'), JSON.stringify({ bytes: bytes.length, sha256 }));
		const executable = await unpackClaudeRuntime(root, join(root, 'cache'));
		assert.deepEqual(await readFile(executable), bytes);
		await writeFile(join(root, 'runtime.json'), JSON.stringify({ bytes: bytes.length, sha256: '0'.repeat(64) }));
		await assert.rejects(unpackClaudeRuntime(root, join(root, 'cache')), /integrity/);
		assert.deepEqual(await readdir(join(root, 'cache', '0'.repeat(64))), []);
		await writeFile(join(root, 'runtime.json'), JSON.stringify({ bytes: 1, sha256 }));
		await assert.rejects(unpackClaudeRuntime(root, join(root, 'cache')), /size/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
