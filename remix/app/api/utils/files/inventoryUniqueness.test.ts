import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInventoryUniqueness } from './inventoryUniqueness';

test('private disk uniqueness resolves bucket collisions, detects duplicates and removes scratch files', async () => {
	const parent = await mkdtemp(join(tmpdir(), 'thingtime-key-test-'));
	try {
		const index = await openInventoryUniqueness(128, parent), keys: string[] = [];
		for (let n = 0; keys.length < 20; n++) {
			const value = 'private-name-' + n;
			if ((createHash('sha256').update(value).digest().readUInt32BE() & 127) === 7) keys.push(value);
		}
		for (const key of keys) assert.equal(await index.add(key), true);
		for (const key of [...keys].reverse()) assert.equal(await index.add(key), false);
		// No named file remains even while this index is live.
		assert.deepEqual(await readdir(parent), []);
		await index.close(); await index.close();
		assert.deepEqual(await readdir(parent), []);
		await assert.rejects(index.add('later'), /closed/);
	} finally { await rm(parent, { recursive: true, force: true }); }
});

test('disk capacity and cancellation fail closed without losing duplicate evidence', async () => {
	const parent = await mkdtemp(join(tmpdir(), 'thingtime-key-test-'));
	try {
		const index = await openInventoryUniqueness(8, parent);
		try {
			for (let n = 0; n < 4; n++) assert.equal(await index.add(String(n)), true);
			await assert.rejects(index.add('full'), /disk bound/);
			assert.equal(await index.add('0'), false);
			await assert.rejects(index.add('cancelled', () => { throw Error('cancelled'); }), /cancelled/);
		} finally { await index.close(); }
		assert.deepEqual(await readdir(parent), []);
	} finally { await rm(parent, { recursive: true, force: true }); }
});

test('long normalized Unicode paths fit the bounded key input', async () => {
	const index = await openInventoryUniqueness(8);
	try {
		const key = 'path:' + Array.from({ length: 16 }, () => '界'.repeat(250)).join('/');
		assert.ok(Buffer.byteLength(key) > 8192);
		assert.equal(await index.add(key), true); assert.equal(await index.add(key), false);
		await assert.rejects(index.add('x'.repeat(32_785)), /Invalid/);
	} finally { await index.close(); }
});


test('abrupt process exit cannot strand a populated scratch index', async () => {
 const parent = await mkdtemp(join(tmpdir(), 'thingtime-key-crash-'));
 try {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
   import { openInventoryUniqueness } from ${JSON.stringify(new URL('./inventoryUniqueness.ts', import.meta.url).href)};
   const index = await openInventoryUniqueness(128, process.argv[1]);
   for (let i = 0; i < 30; i++) await index.add('private-' + i);
   process.kill(process.pid, 'SIGKILL');
  `, parent], { stdio: 'ignore' });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, null); assert.equal(signal, 'SIGKILL');
  assert.deepEqual(await readdir(parent), []);
 } finally { await rm(parent, { recursive: true, force: true }); }
});
