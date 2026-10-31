import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
	eligibleUploadBatchWrite,
	parseNativeUploadBatchResult,
	parseUploadBatchDescriptor,
	uploadBatchCanonicalBytes,
	uploadBatchDigest,
	UPLOAD_BATCH_BYTES,
	UPLOAD_BATCH_DESCRIPTOR_BYTES,
	UPLOAD_BATCH_METADATA_BYTES
} from './uploadBatch';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors;
const fixture = () => structuredClone(vectors[0].descriptor);

test('bulk descriptor canonical bytes match portable ASCII and UTF-8 vectors', async () => {
	for (const vector of vectors) {
		assert.equal(Buffer.from(uploadBatchCanonicalBytes(vector.descriptor)).toString('base64'), vector.canonicalBase64);
		assert.equal(uploadBatchCanonicalBytes(vector.descriptor).length, vector.canonicalBytes);
		assert.equal(await uploadBatchDigest(vector.descriptor), vector.digest);
		// Property order is irrelevant; actual field content remains exact.
		const reordered = {
			members: vector.descriptor.members,
			configuration: vector.descriptor.configuration,
			scope: vector.descriptor.scope,
			batchId: vector.descriptor.batchId,
			version: 1
		};
		assert.equal(await uploadBatchDigest(reordered), vector.digest);
	}
});

test('batch digest binds configuration, origin, source and original operation identity', async () => {
	for (const change of [
		(d: any) => (d.configuration.updatedAt = '2026-10-22T00:00:00.000Z'),
		(d: any) => (d.configuration.configuration.network = 'any'),
		(d: any) => {
			d.scope.origin = 'https://other.test';
			d.members[0].write.scope.origin = d.scope.origin;
		},
		(d: any) => (d.members[0].write.operation.id = randomUUID()),
		(d: any) => (d.members[0].write.operation.mutation.source.version = 'v2'),
		(d: any) => (d.members[0].write.folderId = 'different-parent')
	]) {
		const d = fixture();
		change(d);
		assert.notEqual(await uploadBatchDigest(d), vectors[0].digest);
	}
});

test('batch parser refuses unknown authority fields and incompatible/paused configurations', () => {
	for (const change of [
		(d: any) => (d.permit = true),
		(d: any) => (d.scope.authorization = 'invented'),
		(d: any) => (d.configuration.configuration.authorization = 'invented'),
		(d: any) => (d.members[0].write.operation.authorization = 'invented'),
		(d: any) => (d.members[0].write.operation.mutation.source.authorization = 'invented'),
		(d: any) => (d.configuration.configuration.mode = 'two-way'),
		(d: any) => (d.configuration.configuration.paused = true),
		(d: any) => (d.configuration.configuration.propagateDeletes = true),
		(d: any) => (d.configuration.configuration.sourceKind = 'photos'),
		(d: any) => (d.configuration.configuration.deviceId = 'foreign-device'),
		(d: any) => (d.members[0].write.cloudRootId = 'foreign-root'),
		(d: any) => (d.members[0].write.operation.confirmed = true),
		(d: any) => (d.members[0].ordinal = 1)
	]) {
		const d = fixture();
		change(d);
		assert.throws(() => parseUploadBatchDescriptor(d));
	}
});

test('bulk selection preserves normalized source and destination namespace uniqueness', () => {
	for (const paths of [
		['Parent/file.bin', 'parent/FILE.bin'],
		['Café/a.txt', 'Cafe\u0301/A.txt'],
		['One/a.txt', 'Two/A.txt']
	]) {
		const d = fixture();
		d.members[0].write.operation.mutation.path = d.members[0].write.operation.mutation.source.path = paths[0];
		const other = structuredClone(d.members[0]);
		other.ordinal = 1;
		other.write.operation.id = randomUUID();
		other.write.operation.mutation.path = other.write.operation.mutation.source.path = paths[1];
		d.members.push(other);
		assert.throws(() => parseUploadBatchDescriptor(d));
	}
});

test('batch bounds allow exact32MiB and256members without becoming a user file-size limit', () => {
	const d = fixture(),
		seed = structuredClone(d.members[0]);
	d.members = Array.from({ length: 256 }, (_, ordinal) => {
		const member = structuredClone(seed);
		member.ordinal = ordinal;
		member.write.operation.id = randomUUID();
		const e = member.write.operation.mutation.source;
		e.path = member.write.operation.mutation.path = `Parent/f${ordinal}`;
		e.id = `inode-${ordinal}`;
		e.size = 128 * 1024;
		return member;
	});
	assert.equal(
		parseUploadBatchDescriptor(d).members.reduce((n, m) => n + (m.write.operation.mutation as any).source.size, 0),
		UPLOAD_BATCH_BYTES
	);
	d.members[0].write.operation.mutation.source.size++;
	assert.throws(() => parseUploadBatchDescriptor(d));
	const large = fixture().members[0].write;
	large.operation.mutation.source.size = 256 * 1024 + 1;
	assert.equal(eligibleUploadBatchWrite(large), false, 'larger files use the existing executor');
	const empty = fixture().members[0].write;
	empty.operation.mutation.source.size = 0;
	assert.equal(eligibleUploadBatchWrite(empty), false, 'empty files retain existing proven finalization');
});

test('accepted near-limit descriptors leave space for actual256member control requests', () => {
	const d = fixture(),
		seed = d.members[0];
	d.members = Array.from({ length: 256 }, (_, ordinal) => {
		const m = structuredClone(seed);
		m.ordinal = ordinal;
		m.write.operation.id = randomUUID();
		m.write.operation.mutation.path = m.write.operation.mutation.source.path = `f${ordinal}`;
		return m;
	});
	let low = 0,
		high = 500;
	while (low < high) {
		const n = Math.ceil((low + high) / 2);
		for (const m of d.members) {
			m.write.operation.mutation.source.id = 'i'.repeat(n) + m.ordinal;
			m.write.operation.mutation.source.version = 'v'.repeat(n);
		}
		if (Buffer.byteLength(JSON.stringify(d)) <= UPLOAD_BATCH_DESCRIPTOR_BYTES) low = n;
		else high = n - 1;
	}
	for (const m of d.members) {
		m.write.operation.mutation.source.id = 'i'.repeat(low) + m.ordinal;
		m.write.operation.mutation.source.version = 'v'.repeat(low);
	}
	const descriptor = parseUploadBatchDescriptor(d),
		digest = 'a'.repeat(64);
	assert.ok(Buffer.byteLength(JSON.stringify(descriptor)) > UPLOAD_BATCH_DESCRIPTOR_BYTES - 1024);
	for (const body of [
		{ phase: 'prepare', descriptor, digest, checksums: d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: digest })) },
		{ phase: 'verify', descriptor, digest, uploads: d.members.map((m: any) => ({ ordinal: m.ordinal, uploadId: 'att_' + digest })) },
		{
			phase: 'commit',
			descriptor,
			digest,
			contents: d.members.map((m: any) => ({
				ordinal: m.ordinal,
				uploadId: 'att_' + digest,
				version: digest,
				size: 4,
				fingerprint: m.write.operation.mutation.source.fingerprint
			}))
		}
	])
		assert.ok(Buffer.byteLength(JSON.stringify(body)) <= UPLOAD_BATCH_METADATA_BYTES);
	const parsed = parseUploadBatchDescriptor(d);
	d.members[0].write.operation.mutation.source.version = 'changed';
	assert.notEqual(parsed.members[0].write.operation.mutation.kind === 'copy' && parsed.members[0].write.operation.mutation.source.version, 'changed');
});

test('duplicate operation identities and hardlink inode aliases reject only that batch grouping', () => {
	const d = fixture(),
		other = structuredClone(d.members[0]);
	other.ordinal = 1;
	other.write.operation.mutation.path = other.write.operation.mutation.source.path = 'Parent/other.bin';
	d.members.push(other);
	assert.throws(() => parseUploadBatchDescriptor(d), 'duplicate operation ID');
	other.write.operation.id = crypto.randomUUID();
	assert.throws(() => parseUploadBatchDescriptor(d), 'different path with same inode ID');
	other.write.operation.mutation.source.id = 'independent-inode';
	assert.equal(parseUploadBatchDescriptor(d).members.length, 2);
});

test('canonical receipt replays cannot invent accepted payload samples', async () => {
	const descriptor = fixture(),
		digest = await uploadBatchDigest(descriptor),
		write = descriptor.members[0].write;
	const result = {
		ok: true,
		version: 1,
		batchId: descriptor.batchId,
		digest,
		results: [
			{
				ordinal: 0,
				status: 'confirmed',
				replayed: true,
				file: {
					id: write.operation.id,
					revision: 'r1',
					name: 'file.bin',
					folderId: write.folderId,
					trashed: false,
					content: { attachmentId: 'original-upload', version: 'a'.repeat(64), size: 4, fingerprint: write.operation.mutation.source.fingerprint }
				}
			}
		],
		payloads: [{ ordinal: 0, bytes: 0 }]
	};
	assert.equal(parseNativeUploadBatchResult(result, { descriptor, digest }).payloads[0].bytes, 0);
	result.payloads[0].bytes = 4;
	assert.throws(() => parseNativeUploadBatchResult(result, { descriptor, digest }));
});

test('version1 and version2 without ignore rules share the normalized version1 canonical contract', async () => {
	const v1 = fixture();
	v1.configuration.configuration.configurationVersion = 1;
	delete v1.configuration.configuration.ignoreRules;
	const v2 = structuredClone(v1);
	v2.configuration.configuration.configurationVersion = 2;
	v2.configuration.configuration.ignoreRules = '';
	assert.equal(parseUploadBatchDescriptor(v2).configuration.configuration.configurationVersion, 1);
	assert.equal(await uploadBatchDigest(v1), await uploadBatchDigest(v2));
	const invalid = structuredClone(v1);
	invalid.configuration.configuration.ignoreRules = '*.tmp';
	assert.throws(() => parseUploadBatchDescriptor(invalid));
});
