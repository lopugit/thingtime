import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contentPartPlan, fingerprintSource, validContentFingerprint } from './contentFingerprint';
import { sameSyncContent, validSyncEntry } from './reconcile';
import { attachmentFingerprintEntry } from './attachmentFingerprint.client';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
const hash = async (bytes: Uint8Array) => new Uint8Array(sha(bytes));

test('real bytes produce the canonical multipart composite with bounded reads', async () => {
	const bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 21); bytes[bytes.length - 1] = 99;
	const reads: number[] = [];
	const result = await fingerprintSource({ size: bytes.length, check() {}, async read(offset, length) { reads.push(length); return new Uint8Array(bytes.subarray(offset, offset + length)); } }, { hash });
	assert.deepEqual(reads, [8 * 1024 * 1024, 17]);
	assert.equal(result.sha256, sha(Buffer.concat([sha(bytes.subarray(0, reads[0])), sha(bytes.subarray(reads[0]))])).toString('hex'));
	assert.notEqual(result.sha256, sha(bytes).toString('hex')); assert.equal(validContentFingerprint(result, bytes.length), true);
	const entry = attachmentFingerprintEntry({ ok: true, id: 'file', version: 'b'.repeat(64), size: bytes.length, fingerprint: result }, 'file', 'photo.raw');
	assert.equal(validSyncEntry(entry), true); assert.equal(sameSyncContent(entry, structuredClone(entry)), true);
	assert.equal(sameSyncContent(entry, { ...entry, fingerprint: undefined, sha256: result.sha256 }), false);
	assert.equal(validSyncEntry({ ...entry, sha256: result.sha256 }), false);
});

test('changed, incomplete, cancelled and oversized reads cannot produce a fingerprint', async () => {
	await assert.rejects(fingerprintSource({ size: 2, check() {}, async read() { return new Uint8Array(1); } }, { hash }), /incomplete/);
	let changed = false;
	await assert.rejects(fingerprintSource({ size: 2, check() { if (changed) throw Error('changed'); }, async read() { changed = true; return new Uint8Array(2); } }, { hash }), /changed/);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(fingerprintSource({ size: 2, check() {}, async read() { throw Error('must not read'); } }, { hash, signal: controller.signal }), { name: 'AbortError' });
	await assert.rejects(fingerprintSource({ size: 400 * 1024 ** 3, check() {}, async read() { throw Error('must not read'); } }, { hash }), /native streaming/);
	assert.throws(() => contentPartPlan(-1)); assert.throws(() => contentPartPlan(Number.MAX_SAFE_INTEGER));
});

test('invalid partition, version, identity or path is not a successful cloud inventory entry', () => {
	const fingerprint = { algorithm: 'sha256-parts-v1', ...contentPartPlan(2), sha256: 'a'.repeat(64) };
	const response = { ok: true, id: 'file', version: 'b'.repeat(64), size: 2, fingerprint };
	for (const changed of [{ ...response, id: 'other' }, { ...response, version: 'internal-object-version' }, { ...response, fingerprint: { ...fingerprint, partCount: 2 } }, { ...response, ok: false }]) assert.throws(() => attachmentFingerprintEntry(changed, 'file', 'photo.raw'));
	assert.throws(() => attachmentFingerprintEntry(response, 'file', '../photo.raw'));
});
