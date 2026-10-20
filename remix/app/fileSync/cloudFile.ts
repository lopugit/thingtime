import { EMPTY_CONTENT_SHA256, validContentFingerprint, type ContentFingerprint } from './contentFingerprint';
import { validSyncPath, type SyncEntry } from './reconcile';

export const CLOUD_FILE_KIND = 'file';
export const CLOUD_FILE_ADAPTER = 'file-content';
export const CLOUD_FILE_REQUIREMENTS = { 'api.files': '1.0.0', 'api.attachment-content': '1.13.0' } as const;
export type CloudFileContent = { attachmentId: string; version: string; size: number; fingerprint: ContentFingerprint };
export type CloudFile = { id: string; revision: string; name: string; folderId: string | null; trashed: boolean; content: CloudFileContent };
export type CloudFileCommit = {
	id: string; operationId: string; expectedRevision: string | null; name: string; folderId: string | null;
	attachmentId: string; contentVersion: string; trashed: boolean;
};
export type CloudFileRetention = CloudFileCommit & { kind: 'retained-version'; expectedRevision: string; trashed: false };
export const CLOUD_FILE_RETENTION_REQUIREMENTS = { 'api.files': '1.3.0' } as const;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const validFileName = (v: unknown): v is string => typeof v === 'string' && v.length <= 255 && !v.includes('/') && validSyncPath(v);
export function parseCloudFileCommit(value: unknown): CloudFileCommit {
	if (!object(value) || Object.keys(value).some(k => !['id', 'operationId', 'expectedRevision', 'name', 'folderId', 'attachmentId', 'contentVersion', 'trashed'].includes(k)) ||
		!uuid(value.id) || !uuid(value.operationId) || (value.expectedRevision !== null && !identifier(value.expectedRevision)) ||
		!validFileName(value.name) || (value.folderId !== null && !identifier(value.folderId)) || !identifier(value.attachmentId) ||
		!hex(value.contentVersion) || typeof value.trashed !== 'boolean' || (value.expectedRevision === null && value.trashed)) throw Error('Invalid file commit');
	return { id: value.id, operationId: value.operationId, expectedRevision: value.expectedRevision, name: value.name,
		folderId: value.folderId, attachmentId: value.attachmentId, contentVersion: value.contentVersion, trashed: value.trashed };
}
/** Retain alternate bytes without publishing them as the live file. */
export function parseCloudFileRetention(value: unknown): CloudFileRetention {
	if (!object(value) || value.kind !== 'retained-version') throw Error('Invalid file retention');
	const { kind, ...fields } = value;
	const command = parseCloudFileCommit(fields);
	if (command.expectedRevision === null || command.trashed) throw Error('Retention needs a current live file');
	return { ...command, kind, expectedRevision: command.expectedRevision, trashed: false };
}
export function parseCloudFile(value: unknown): CloudFile {
	if (!object(value) || !identifier(value.id) || !identifier(value.revision) || !validFileName(value.name) ||
		(value.folderId !== null && !identifier(value.folderId)) || typeof value.trashed !== 'boolean' || !object(value.content) ||
		!identifier(value.content.attachmentId) || !hex(value.content.version) || !validContentFingerprint(value.content.fingerprint, value.content.size)) throw Error('Invalid cloud file');
	return { id: value.id, revision: value.revision, name: value.name, folderId: value.folderId, trashed: value.trashed,
		content: { attachmentId: value.content.attachmentId, version: value.content.version, size: value.content.size, fingerprint: { ...value.content.fingerprint } } };
}
export function cloudFileSyncEntry(value: unknown, path: string): SyncEntry {
	const file = parseCloudFile(value);
	if (!validSyncPath(path) || file.trashed) throw Error('A trashed or invalid file cannot become a live sync entry');
	return { path, id: file.id, version: file.revision, kind: 'file', size: file.content.size,
		...(file.content.size === 0 ? { sha256: EMPTY_CONTENT_SHA256 } : { sha256: null, fingerprint: file.content.fingerprint }) };
}
