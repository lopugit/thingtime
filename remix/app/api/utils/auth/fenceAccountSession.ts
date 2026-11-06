import { randomUUID } from 'node:crypto';
import { getSessionsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { StorageMutationError } from '../storage/storageCore';
import { getAuthToken } from './authCookie';
import { getCurrentUser, isFullAccountSessionPurpose } from './getCurrentUser';
import { verifyJwt } from './jwt';

/** Trusted home-plane composition only. The actual session write conflicts
 * with revocation, deletion and Character-selection changes. A no-op read or
 * $set to the existing value would not supply this transaction fence.
 * Credentials remain in request memory; callers retain only the actor. */
export async function fenceAccountSession(request: Request, ownerId: string, session: any) {
	if (!session?.inTransaction() || isCustomMongoEndpointActive()) throw Error('Account session fencing requires the home content transaction');
	const fail = (): never => { throw new StorageMutationError(401, 'storage_conflict', 'The authenticated account or session changed'); };
	const token = await getAuthToken(request);
	const claims = token && await verifyJwt(token);
	const user = claims && await getCurrentUser(request);
	// The initial contract supports the authenticated principal itself. A
	// Character or scoped credential must use a separately verified contract.
	if (!claims || claims.sub !== ownerId || user?.id !== ownerId) return fail();
	const sessions = await getSessionsCollection();
	const current = await sessions.findOne({ jti: claims.jti, userId: ownerId }, { session });
	const now = new Date();
	if (!current || current.revokedAt || !isFullAccountSessionPurpose(current.purpose) ||
		(current.expiresAt && new Date(current.expiresAt).getTime() <= now.getTime())) return fail();
	const result = await sessions.updateOne({ jti: claims.jti, userId: ownerId, revokedAt: null,
		$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
		{ $set: { accountMutationFence: randomUUID() } }, { session });
	if (result.matchedCount !== 1 || result.modifiedCount !== 1) return fail();
	return user;
}
