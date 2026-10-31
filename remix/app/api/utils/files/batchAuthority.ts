import type { UploadBatchDescriptor } from '../../../fileSync/uploadBatch';
import { readOwnedFileSyncConfiguration } from '../../../fileSync/configuredPlan';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoSnapshot } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { readCloudInventoryRoot } from './inventory';
export class BatchAuthorityChanged extends Error {
	constructor() {
		super('Batch authority changed');
	}
}
/** Full authority is read afresh for each phase and each bounded dispatch
 * wave. Neither a digest nor a prior prepared result is a bearer permit. */
export async function authorizeBatch(owner: string, origin: string, d: Pick<UploadBatchDescriptor, 'scope' | 'configuration'>, signal: AbortSignal) {
	signal.throwIfAborted();
	if (isCustomMongoEndpointActive() || d.scope.ownerId !== owner || d.scope.origin !== origin) throw new BatchAuthorityChanged();
	const things = await getHomeThingsCollection();
	const doc = await things.findOne({ shareId: d.configuration.id, ownerId: owner }, { maxTimeMS: 5000, signal });
	if (!doc || doc.sandbox != null || doc.sandboxSpace != null) throw new BatchAuthorityChanged();
	let saved: ReturnType<typeof readOwnedFileSyncConfiguration>;
	try {
		saved = readOwnedFileSyncConfiguration({ ...doc, id: doc.shareId, author: { id: doc.ownerId }, updatedAt: doc.updatedAt?.toISOString() }, owner);
	} catch {
		throw new BatchAuthorityChanged();
	}
	if (saved.updatedAt !== d.configuration.updatedAt || JSON.stringify(saved.configuration) !== JSON.stringify(d.configuration.configuration))
		throw new BatchAuthorityChanged();
	const device = await things.findOne(
		{ shareId: d.scope.deviceId, ownerId: owner, thingtime: 'device' },
		{ projection: { _id: 1 }, maxTimeMS: 5000, signal }
	);
	const sessions = await getSessionsCollection();
	const paired = await sessions.findOne(
		{
			purpose: 'device',
			userId: owner,
			'meta.deviceId': d.scope.deviceId,
			revokedAt: null,
			$or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
		},
		{ projection: { _id: 1 }, maxTimeMS: 5000, signal }
	);
	if (!device || !paired) throw new BatchAuthorityChanged();
	try {
		await withHomeMongoSnapshot((session) =>
			readCloudInventoryRoot(
				things,
				session,
				owner,
				saved.configuration.remoteFolderId,
				() => {
					signal.throwIfAborted();
					return 5000;
				},
				signal
			)
		);
	} catch (error: any) {
		if (error?.status === 404 || error?.status === 409) throw new BatchAuthorityChanged();
		throw error;
	}
}
