import { validSyncPath, type SyncEntry } from './reconcile';

export const CLOUD_FOLDER_REQUIREMENTS = { 'api.files': '1.2.0' } as const;
export type CloudFolder = { id: string; revision: string; name: string; folderId: string | null };
export type CloudFolderCreate = { kind: 'folder'; id: string; operationId: string; name: string; folderId: string };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const uuid = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function parseCloudFolder(value: unknown): CloudFolder {
	const row = value as CloudFolder;
	if (
		!row ||
		!identifier(row.id) ||
		!identifier(row.revision) ||
		(row.folderId !== null && !identifier(row.folderId)) ||
		!validSyncPath(row.name) ||
		row.name.includes('/')
	)
		throw Error('Invalid cloud folder metadata.');
	return { id: row.id, revision: row.revision, name: row.name, folderId: row.folderId };
}
export function parseCloudFolderCreate(value: unknown): CloudFolderCreate {
	const row = value as CloudFolderCreate;
	if (
		!row ||
		Object.keys(row).some((key) => !['kind', 'id', 'operationId', 'name', 'folderId'].includes(key)) ||
		row.kind !== 'folder' ||
		!uuid(row.id) ||
		!uuid(row.operationId) ||
		!identifier(row.folderId) ||
		row.folderId === row.id ||
		row.folderId.startsWith('timeline-')
	)
		throw Error('Invalid cloud folder creation.');
	const folder = parseCloudFolder({ ...row, revision: 'pending' });
	return { kind: 'folder', id: folder.id, operationId: row.operationId, name: folder.name, folderId: row.folderId };
}
export function cloudFolderSyncEntry(value: CloudFolder, path: string): SyncEntry {
	const folder = parseCloudFolder(value);
	if (!validSyncPath(path) || folder.name !== path.split('/').at(-1)) throw Error('Cloud folder path changed.');
	return { path, id: folder.id, version: folder.revision, kind: 'folder', size: 0, sha256: null };
}
