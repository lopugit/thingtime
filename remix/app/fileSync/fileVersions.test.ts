import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { eventFixture } from '../timeline/testFixtures';
import type { CloudFile } from './cloudFile';
import {
	checkFileRestoreReceipt,
	fileContentId,
	fileRestoreCommand,
	fileRestoreKey,
	parseFileRestoreCommand,
	timelineFileVersion
} from './fileVersions';

const version: CloudFile = {
	id: '11111111-1111-4111-8111-111111111111',
	revision: 'version-1',
	name: 'old.txt',
	folderId: 'old-folder',
	trashed: false,
	content: {
		attachmentId: 'attachment-1',
		version: 'a'.repeat(64),
		size: 123,
		fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: 'b'.repeat(64) }
	}
};
const current = { ...version, revision: 'version-2', name: 'renamed.txt', folderId: 'new-folder', trashed: true };
const operationId = '22222222-2222-4222-8222-222222222222';
const event = eventFixture(version.revision, {
	source: 'api',
	mode: 'revision',
	thingId: version.id,
	after: { adapter: 'file-content', version: 1, value: { ...version, requestHash: 'c'.repeat(64) } }
});

test('file history rejects draft, foreign, unsupported and mismatched snapshots', () => {
	assert.deepEqual(timelineFileVersion(event, 'after'), version);
	for (const changed of [{ source: 'client' }, { mode: 'draft' }, { thingId: 'foreign' }, { id: 'wrong-revision' }, { branchId: 'variation' }])
		assert.equal(timelineFileVersion({ ...event, ...changed } as typeof event, 'after'), null);
	assert.equal(timelineFileVersion({ ...event, after: { ...event.after!, version: 2 } }, 'after'), null);
	assert.equal(timelineFileVersion({ ...event, after: { ...event.after!, value: { ...version, content: null } } }, 'after'), null);
	assert.deepEqual(timelineFileVersion({ ...event, before: event.after }, 'before'), version);
});

test('content identity includes multipart framing and byte length, independent of file name or attachment ID', () => {
	assert.equal(fileContentId(version), `sha256-parts-v1:123:8388608:1:${'b'.repeat(64)}`);
	assert.equal(fileContentId(version), fileContentId({ ...current, content: { ...version.content, attachmentId: 'independent-copy' } }));
	assert.notEqual(fileContentId(version), fileContentId({ ...version, content: { ...version.content, size: 124 } }));
});

test('restore keeps current name and folder, restores from Trash and refuses a foreign target', () => {
	const command = fileRestoreCommand(current, version, operationId);
	assert.deepEqual(command, {
		id: version.id,
		operationId,
		expectedRevision: current.revision,
		name: current.name,
		folderId: current.folderId,
		attachmentId: version.content.attachmentId,
		contentVersion: version.content.version,
		trashed: false
	});
	assert.throws(() => fileRestoreCommand({ ...current, id: 'foreign' }, version, operationId));
	assert.deepEqual(parseFileRestoreCommand(JSON.parse(JSON.stringify(command)), version), command);
	for (const change of [{ expectedRevision: null }, { attachmentId: 'foreign' }, { contentVersion: 'd'.repeat(64) }, { trashed: true }])
		assert.throws(() => parseFileRestoreCommand({ ...command, ...change }, version));
});

test('pending restores are scoped to account, origin, storage and exact file version', () => {
	const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.test', dataPlane: 'home' };
	const key = fileRestoreKey(scope, version);
	assert.notEqual(key, fileRestoreKey({ ...scope, ownerId: 'user-2' }, version));
	assert.notEqual(key, fileRestoreKey({ ...scope, apiOrigin: 'https://other.test' }, version));
	assert.notEqual(key, fileRestoreKey(scope, current));
	assert.throws(() => fileRestoreKey({ ...scope, dataPlane: 'custom' }, version));
});

test('restore completion must match reviewed placement and exact retained bytes', async () => {
	const command = fileRestoreCommand(current, version, operationId);
	const receipt = {
		...current,
		revision:
			'file-commit-' +
			createHash('sha256')
				.update(JSON.stringify(['user-1', command.id, command.operationId]))
				.digest('hex'),
		trashed: false
	};
	assert.deepEqual(await checkFileRestoreReceipt(receipt, command, version, 'user-1'), receipt);
	for (const change of [
		{ revision: current.revision },
		{ name: version.name },
		{ folderId: 'wrong' },
		{ trashed: true },
		{ content: { ...version.content, attachmentId: 'other' } },
		{ content: { ...version.content, size: 124 } },
		{ content: { ...version.content, fingerprint: { ...version.content.fingerprint, sha256: 'd'.repeat(64) } } }
	])
		await assert.rejects(() => checkFileRestoreReceipt({ ...receipt, ...change }, command, version, 'user-1'));
	await assert.rejects(() => checkFileRestoreReceipt(receipt, command, version, 'other-owner'));
	await assert.rejects(() => checkFileRestoreReceipt(receipt, { ...command, operationId: crypto.randomUUID() }, version, 'user-1'));
});
