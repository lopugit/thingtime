import { createHash } from 'node:crypto';
import { ensureIndexes, getRateLimitsCollection } from '../mongodb/collections';

export const BATCH_BUDGET = { windowMs: 60_000, units: 65_536, bytes: 512 * 1024 * 1024 } as const;
export const BATCH_PHASE_COST = { prepare: 2, verify: 6, commit: 2, folderCommit: 6 } as const;
/** Separate owner-bound bulk policy. Fixed bucket keys make rollover atomic;
 * failed admission never changes a live bucket or extends its TTL. */
export function createBatchBudget(collection: () => Promise<any> = getRateLimitsCollection, indexes = ensureIndexes, now = Date.now) {
	return async (owner: string, phase: keyof typeof BATCH_PHASE_COST | 'probe', members: number, payload: number) => {
		if (
			!owner ||
			!Number.isSafeInteger(members) ||
			members < (phase === 'probe' ? 0 : 1) ||
			members > 256 ||
			!Number.isSafeInteger(payload) ||
			payload < 0 ||
			payload > 32 * 1024 * 1024
		)
			return false;
		const started = Math.floor(now() / BATCH_BUDGET.windowMs) * BATCH_BUDGET.windowMs;
		const key = createHash('sha256').update(`file-sync-bulk:v1:${owner}:${started}`).digest('hex');
		const units = phase === 'probe' ? 1 + Math.ceil(members / 32) : members * BATCH_PHASE_COST[phase],
			bytes = phase === 'prepare' ? payload : 0;
		try {
			await indexes();
			const coll = await collection();
			try {
				await coll.updateOne(
					{ key },
					{ $setOnInsert: { key, units: 0, bytes: 0, createdAt: new Date(started), expiresAt: new Date(started + 2 * BATCH_BUDGET.windowMs) } },
					{ upsert: true }
				);
			} catch (error: any) {
				if (error?.code !== 11000) throw error;
			}
			return !!(await coll.findOneAndUpdate(
				{ key, units: { $lte: BATCH_BUDGET.units - units }, bytes: { $lte: BATCH_BUDGET.bytes - bytes } },
				{ $inc: { units, bytes } },
				{ returnDocument: 'after' }
			));
		} catch {
			return false;
		}
	};
}
export const chargeBatch = createBatchBudget();

/** No wait queue: overload fails immediately instead of retaining callbacks.
 * Eight active provider members per owner PER PROCESS, at most 64 owners.
 * Distributed resource admission is the atomic budget above, not this map. */
export function createBatchProviderAdmission(perOwner = 8, maxOwners = 64) {
	const owners = new Map<string, number>();
	return async <T>(owner: string, signal: AbortSignal, deadline: number, work: () => Promise<T>): Promise<T> => {
		signal.throwIfAborted();
		if (Date.now() >= deadline) throw Error('deadline');
		const active = owners.get(owner) ?? 0;
		if (active >= perOwner || (!active && owners.size >= maxOwners)) throw Error('capacity');
		owners.set(owner, active + 1);
		try {
			return await work();
		} finally {
			const left = (owners.get(owner) ?? 1) - 1;
			if (left) owners.set(owner, left);
			else owners.delete(owner);
		}
	};
}
export const admitBatchProvider = createBatchProviderAdmission();

export const admitBatchControl = createBatchProviderAdmission(2, 32);

/** Metadata waves use a zero-wait root lease, not an S3/provider slot. */
export const admitFolderRoot = createBatchProviderAdmission(1, 64);
