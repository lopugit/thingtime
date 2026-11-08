import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv, createDecipheriv, createSecretKey, randomBytes, randomUUID } from 'node:crypto';
import { BACKUP_CHUNK_BYTES, backupJson } from '../../../backups/manifest';
import { createResumableHashWorker, RESUMABLE_HASH_IMPLEMENTATION, type HashCheckpointRef, type HashStreamBinding } from './resumableHash';
import { assertBackupObjectKey } from './backupObjectKey';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function fixture(bytes: Uint8Array) {
	const objects = new Map<string, Uint8Array>(), key = createSecretKey(randomBytes(32));
	const binding: HashStreamBinding = { operationId: randomUUID(), snapshotId: randomUUID(), streamId: 'immutable-fixture', objectVersion: sha(bytes), bytes: String(bytes.length), expectedSha256: sha(bytes) };
	const heads = new Map<string, HashCheckpointRef>(); let version = binding.objectVersion, permitted = true, reads = 0, acceptFailure = false, writeFailure = false, afterRead: (() => void) | null = null, afterCheckpointRead: (() => void) | null = null;
	const store = {
		async read(key: string, maximum: number) { assertBackupObjectKey(key); const b = objects.get(key); if (!b) return null; assert.ok(b.length <= maximum); const result = Uint8Array.from(b); afterCheckpointRead?.(); return result; },
		async put(key: string, bytes: Uint8Array) { assertBackupObjectKey(key); const old = objects.get(key); if (old) assert.deepEqual(old, bytes); else objects.set(key, Uint8Array.from(bytes)); if (writeFailure) { writeFailure = false; throw Error('Synthetic lost object write response'); } }
	};
	const source = {
		async assertIdentity(value: HashStreamBinding) { assert.equal(value.objectVersion, version, 'Immutable version changed'); assert.equal(value.bytes, String(bytes.length)); },
		async read(offset: bigint, length: number) { reads++; const result = Uint8Array.from(bytes.subarray(Number(offset), Number(offset) + length)); afterRead?.(); return result; }
	};
	const coordinator = {
		async current(binding: string) { return heads.get(binding) ?? null; },
		async accept(binding: string, previous: HashCheckpointRef | null, next: HashCheckpointRef) {
			const current = heads.get(binding) ?? null;
			if (JSON.stringify(current) === JSON.stringify(next)) return 'already-accepted' as const;
			if (JSON.stringify(current) !== JSON.stringify(previous)) return 'conflict' as const;
			heads.set(binding, structuredClone(next));
			if (acceptFailure) { acceptFailure = false; throw Error('Synthetic lost acceptance response'); }
			return 'accepted' as const;
		}
	};
	const input = { store, coordinator, keys: { current: async () => ({ id: 'fixture-key', key }), get: async (id: string) => id === 'fixture-key' ? key : null },
		access: { scope: { apiOrigin: 'https://hash.test', ownerId: 'owner', dataPlane: 'home' }, authorize: async () => { if (!permitted) throw Error('Authorization revoked'); } } };
	return { binding, objects, input, source, worker: () => createResumableHashWorker(input), get reads() { return reads; },
		changeVersion() { version = 'f'.repeat(64); }, revoke() { permitted = false; }, failAcceptance() { acceptFailure = true; },
		failWrite() { writeFailure = true; },
		afterRead(fn: () => void) { afterRead = fn; }, afterCheckpointRead(fn: () => void) { afterCheckpointRead = fn; } };
}

test('encrypted saved SHA state resumes in new workers at compression, tail and chunk boundaries', async () => {
	for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, BACKUP_CHUNK_BYTES + 17]) {
		const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = i % 251;
		const f = fixture(bytes); let checkpoint = await f.worker().start(f.binding, f.source);
		do { checkpoint = await f.worker().advance(f.binding, checkpoint, randomUUID(), f.source, size > 1024 ? BACKUP_CHUNK_BYTES : 31); } while (!checkpoint.complete);
		assert.equal(checkpoint.finalDigest, sha(bytes)); assert.equal(checkpoint.offset, String(size));
		assert.equal(checkpoint.implementation, RESUMABLE_HASH_IMPLEMENTATION);
		assert.ok(f.objects.size >= 2);
	}
});
test('plaintext tails and saved internal SHA state never enter provider objects or coordinator references', async () => {
	const marker = 'PRIVATE_SYNTHETIC_TAIL_' + randomUUID(), f = fixture(Buffer.from(marker));
	const initial = await f.worker().start(f.binding, f.source), next = await f.worker().advance(f.binding, initial, randomUUID(), f.source, 31);
	for (const bytes of f.objects.values()) {
		const text = Buffer.from(bytes).toString(); assert.ok(!text.includes(marker.slice(0, 20))); assert.ok(!text.includes('"state"'));
		assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['cipherText', 'format', 'iv', 'keyId', 'tag']);
	}
	assert.ok(!JSON.stringify(next).includes('cipherText')); assert.ok(!JSON.stringify(next).includes('state"'));
});
test('reusing a completed head rechecks the source after asynchronous checkpoint reads', async () => {
	const f = fixture(Buffer.from('abcdef')), initial = await f.worker().start(f.binding, f.source);
	const complete = await f.worker().advance(f.binding, initial, randomUUID(), f.source); assert.equal(complete.complete, true);
	f.afterCheckpointRead(() => f.changeVersion());
	await assert.rejects(f.worker().start(f.binding, f.source), /version changed/);
});
test('one operation identity cannot be reused for a different hash stream', async () => {
	const f = fixture(Buffer.from('abcdef')); await f.worker().start(f.binding, f.source); const count = f.objects.size;
	await assert.rejects(f.worker().start({ ...f.binding, streamId: 'different-stream' }, f.source), /checkpoint/);
	assert.equal(f.objects.size, count);
});
test('tampered ciphertext, digest, implementation and stale sibling references refuse before source reads', async () => {
	for (const mode of ['ciphertext', 'digest', 'implementation', 'stale']) {
		const f = fixture(Buffer.from('private retained test bytes')), initial = await f.worker().start(f.binding, f.source);
		let checkpoint = structuredClone(initial);
		if (mode === 'ciphertext') { const [key, bytes] = [...f.objects][0]; const bad = Uint8Array.from(bytes); bad[bad.length - 4] ^= 1; f.objects.set(key, bad); }
		if (mode === 'digest') checkpoint.stateDigest = '0'.repeat(64);
		if (mode === 'implementation') (checkpoint as any).implementation = 'hash-wasm:other:sha256';
		if (mode === 'stale') await f.worker().advance(f.binding, initial, randomUUID(), f.source, 1);
		const before = f.reads;
		await assert.rejects(f.worker().advance(f.binding, checkpoint, randomUUID(), f.source, 1)); assert.equal(f.reads, before);
	}
});
test('uncertain coordinator acceptance reuses its exact protected checkpoint without repeating a range', async () => {
	const f = fixture(Buffer.from('abcdef')), initial = await f.worker().start(f.binding, f.source), stepId = randomUUID();
	f.failAcceptance(); await assert.rejects(f.worker().advance(f.binding, initial, stepId, f.source, 3), /lost acceptance/);
	const before = f.reads, accepted = await f.worker().advance(f.binding, initial, stepId, f.source, 3);
	assert.equal(f.reads, before); assert.equal(accepted.offset, '3');
	await assert.rejects(f.worker().advance(f.binding, initial, stepId, f.source, 1), /checkpoint/);
	await assert.rejects(f.worker().advance(f.binding, { ...initial, offset: '1' }, stepId, f.source, 3), /checkpoint/);
	await assert.rejects(f.worker().advance(f.binding, initial, randomUUID(), f.source, 3));
	const final = await f.worker().advance(f.binding, accepted, randomUUID(), f.source, 3); assert.equal(final.finalDigest, sha('abcdef'));
});
test('an authenticated checkpoint with an incompatible embedded WASM implementation is refused', async () => {
	const f = fixture(Buffer.from('abcdef')), initial = await f.worker().start(f.binding, f.source);
	const [objectKey, bytes] = [...f.objects][0], envelope = JSON.parse(Buffer.from(bytes).toString()), key = (await f.input.keys.current()).key;
	const { stateDigest: _, ...meta } = initial;
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
	decipher.setAAD(Buffer.from(backupJson(meta))); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
	const body = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.cipherText, 'base64url')), decipher.final()]).toString());
	const state = Buffer.from(body.state, 'base64url'); state[0] ^= 1; body.state = state.toString('base64url');
	const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(backupJson(meta)));
	const cipherText = Buffer.concat([cipher.update(Buffer.from(backupJson(body))), cipher.final()]);
	const changed = Buffer.from(backupJson({ ...envelope, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), cipherText: cipherText.toString('base64url') }));
	f.objects.set(objectKey, changed); initial.stateDigest = sha(changed);
	(await f.input.coordinator.current(initial.bindingHash))!.stateDigest = initial.stateDigest;
	await assert.rejects(f.worker().advance(f.binding, initial, randomUUID(), f.source, 1), /checkpoint/); assert.equal(f.reads, 0);
});
test('uncertain encrypted object write reuses the original ciphertext before protected CAS', async () => {
	const f = fixture(Buffer.from('abcdef')), initial = await f.worker().start(f.binding, f.source), stepId = randomUUID();
	f.failWrite(); await assert.rejects(f.worker().advance(f.binding, initial, stepId, f.source, 3), /lost object write/);
	const before = [...f.objects.values()].map(bytes => Uint8Array.from(bytes));
	const accepted = await f.worker().advance(f.binding, initial, stepId, f.source, 3);
	assert.equal(accepted.offset, '3'); assert.deepEqual([...f.objects.values()], before);
});
test('revocation, current object/version changes and wrong expected bytes cannot accept completion', async () => {
	for (const mode of ['revoked', 'version', 'changed-after-read', 'wrong-digest', 'wrong-bytes', 'scope']) {
		const f = fixture(Buffer.from('abcdef')), initial = await f.worker().start(f.binding, f.source), beforeObjects = f.objects.size;
		if (mode === 'revoked') f.revoke();
		if (mode === 'version') f.changeVersion();
		if (mode === 'changed-after-read') f.afterRead(() => f.changeVersion());
		if (mode === 'scope') f.input.access.scope.ownerId = 'other';
		if (mode === 'wrong-digest') f.binding.expectedSha256 = '0'.repeat(64);
		if (mode === 'wrong-bytes') f.source.read = async () => Buffer.from('ghijkl');
		await assert.rejects(f.worker().advance(f.binding, initial, randomUUID(), f.source));
		assert.equal(f.objects.size, beforeObjects);
	}
});
