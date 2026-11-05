import { protectedRecoveryDocument } from './protectedRecovery';
import { ALGORITHM_CONTENT_ADAPTER, algorithmContentSnapshot, algorithmContentValue } from '../timeline/algorithmContent';
import type { VersionContentAdapter } from '../timeline/versionPlan';
import { isTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import type { LocalProtectedVersionWriter } from './timelineVersions';
import type { LocalThing } from './things';
import type { LocalAlgorithms } from './algorithms';

/** History comparisons replace profile data only. The current library title,
 * placement, lineage, sharing and active selection remain the writer's state. */
export function algorithmVersionContent(doc: LocalThing): VersionContentAdapter {
	const current = algorithmContentSnapshot({ crystal: doc.crystal, folderId: doc.folderId ?? null });
	const saved = algorithmContentValue(current);
	return {
		adapters: [ALGORITHM_CONTENT_ADAPTER], current,
		read(snapshot) {
			if (!snapshot) throw new Error('This algorithm version is unavailable.');
			const { title: _title, ...crystal } = algorithmContentValue(snapshot).crystal;
			return { crystal } as ReturnType<VersionContentAdapter['read']>;
		},
		snapshot(value) {
			return algorithmContentSnapshot({
				crystal: { ...value.crystal, ...(Object.prototype.hasOwnProperty.call(saved.crystal, 'title') ? { title: saved.crystal.title } : {}) },
				folderId: saved.folderId
			});
		}
	};
}

export function algorithmVersionWriter(algorithms: LocalAlgorithms, account = false): LocalProtectedVersionWriter {
	return {
		scope: algorithms.scope,
		recovery: { adapter: ALGORITHM_CONTENT_ADAPTER, read: (tx, id, snapshot) => protectedRecoveryDocument(tx, algorithms.scope, id, snapshot, 'feed-algorithm') },
		matches: isTransferAlgorithm,
		content: algorithmVersionContent,
		transaction: (run, signal) => algorithms.versionTransaction(run, signal),
		...(account ? { read: async (tx, id) => {
			const row = await tx.get<LocalThing>('things', id);
			const state = await tx.get<{ deleted: boolean }>('account-algorithm-sync', id);
			return row && isTransferAlgorithm(row) && state && !state.deleted ? row : undefined;
		} } : {})
	};
}
