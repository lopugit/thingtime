import { createHash } from 'node:crypto';
import { parseCloudFolder } from '../../../fileSync/cloudFolder';

/** Observation stamp shared by inventories, reads and immutable create receipts. */
export function cloudFolderMetadata(doc: any) {
	const updated = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt;
	if (typeof updated !== 'string' || !Number.isFinite(Date.parse(updated))) throw Error('A cloud folder has an invalid revision.');
	return parseCloudFolder({
		id: doc.shareId,
		name: doc.crystal?.name,
		folderId: doc.folderId ?? null,
		revision:
			'folder-' +
			createHash('sha256')
				.update(JSON.stringify([doc.shareId, doc.folderId ?? null, doc.crystal?.name, updated, doc.timelineHeadId ?? null]))
				.digest('hex')
	});
}
