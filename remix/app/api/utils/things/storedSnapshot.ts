import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';

export type StoredSnapshotDocument = Record<string, unknown> & { shareId: string; ownerId: string; updatedAt: Date | string };
/** A bounded comparison of the complete stored BSON preimage, including
 * unknown fields and physical identity. This token is never authorization. */
export function storedSnapshotVersion(doc: StoredSnapshotDocument, prefix: string): string {
	if (
		!doc ||
		typeof doc.shareId !== 'string' ||
		!doc.shareId ||
		typeof doc.ownerId !== 'string' ||
		!doc.ownerId ||
		!doc._id ||
		!Number.isFinite(doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : Date.parse(doc.updatedAt))
	)
		throw new Error('Saved state cannot be versioned.');
	if (BSON.calculateObjectSize(doc) > 1024 * 1024) throw new Error('Saved state exceeds the synchronization limit.');
	return prefix + createHash('sha256').update(BSON.serialize(doc)).digest('hex');
}
export function storedSnapshotMatch(doc: StoredSnapshotDocument, prefix: string) {
	storedSnapshotVersion(doc, prefix);
	return { _id: doc._id, ownerId: doc.ownerId, $expr: { $eq: ['$$ROOT', { $literal: doc }] } };
}
