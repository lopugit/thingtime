import { timelineScopeKey, type TimelineEvent, type TimelineScope } from '../timeline/contract';
import { CLOUD_FILE_ADAPTER, parseCloudFile, parseCloudFileCommit, type CloudFile, type CloudFileCommit } from './cloudFile';
import { equalContentFingerprints } from './contentFingerprint';

/** Display only. The file and attachment APIs reauthorize every operation. */
export function timelineFileVersion(event: TimelineEvent, side: 'before' | 'after'): CloudFile | null {
	const snapshot = event[side];
	if (
		event.source !== 'api' ||
		event.mode !== 'revision' ||
		event.branchId !== 'main' ||
		snapshot?.adapter !== CLOUD_FILE_ADAPTER ||
		snapshot.version !== 1
	)
		return null;
	try {
		const file = parseCloudFile(snapshot.value);
		return file.id === event.thingId && (side === 'before' || file.revision === event.id) ? file : null;
	} catch {
		return null;
	}
}

/** Include framing and size: this is a hash of part hashes, not a whole-file SHA256. */
export function fileContentId(file: CloudFile): string {
	const { size, fingerprint: f } = parseCloudFile(file).content;
	return `${f.algorithm}:${size}:${f.partSizeBytes}:${f.partCount}:${f.sha256}`;
}

export function fileRestoreCommand(current: CloudFile, version: CloudFile, operationId: string): CloudFileCommit {
	if (current.id !== version.id) throw Error('This version belongs to another file.');
	return parseCloudFileCommit({
		id: current.id,
		operationId,
		expectedRevision: current.revision,
		name: current.name,
		folderId: current.folderId,
		trashed: false,
		attachmentId: version.content.attachmentId,
		contentVersion: version.content.version
	});
}

export function parseFileRestoreCommand(value: unknown, version: CloudFile): CloudFileCommit {
	const command = parseCloudFileCommit(value);
	if (
		command.id !== version.id ||
		command.expectedRevision === null ||
		command.trashed ||
		command.attachmentId !== version.content.attachmentId ||
		command.contentVersion !== version.content.version
	)
		throw Error('Saved restore does not match this version.');
	return command;
}

export function fileRestoreKey(scope: TimelineScope, version: CloudFile): string {
	if (scope.dataPlane !== 'home') throw Error('File versions require home storage.');
	return `tt-file-restore:${timelineScopeKey(scope)}:${version.id}:${version.revision}`;
}

export async function fileCommitEventId(ownerId: string, id: string, operationId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([ownerId, id, operationId])));
	return `file-commit-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function checkFileRestoreReceipt(value: unknown, command: CloudFileCommit, version: CloudFile, ownerId: string): Promise<CloudFile> {
	const file = parseCloudFile(value);
	const revision = await fileCommitEventId(ownerId, command.id, command.operationId);
	if (
		file.id !== command.id ||
		file.name !== command.name ||
		file.folderId !== command.folderId ||
		file.trashed ||
		file.revision !== revision ||
		file.revision === command.expectedRevision ||
		file.content.attachmentId !== command.attachmentId ||
		file.content.version !== command.contentVersion ||
		file.content.size !== version.content.size ||
		!equalContentFingerprints(file.content.fingerprint, version.content.fingerprint)
	)
		throw Error('Restore receipt does not match the requested version.');
	return file;
}
