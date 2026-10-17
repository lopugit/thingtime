import { sameSyncStamp, validSyncEntry, type SyncDecision, type SyncMode, type SyncPlan, type SyncSide } from './reconcile';

export type SyncConflict = Extract<SyncDecision, { kind: 'conflict' }>;
export type SyncConflictReviewResult = SyncConflictChoice[] | { action: 'retain' };
export const canRetainFileConflicts = (conflicts: readonly SyncConflict[]) =>
	conflicts.length > 0 && conflicts.every((c) => c.local?.kind === 'file' && c.remote?.kind === 'file' && c.reason !== 'excluded-descendants');
export type SyncConflictChoice = { path: string; from: SyncSide };

/** A choice may copy an existing file, never grant deletion or change direction. */
export function conflictCopySides(conflict: SyncConflict, mode: SyncMode): SyncSide[] {
	if (conflict.reason === 'excluded-descendants' || conflict.local?.kind === 'folder' || conflict.remote?.kind === 'folder') return [];
	return (['local', 'remote'] as const).filter((side) => {
		const entry = conflict[side];
		return (
			entry?.kind === 'file' &&
			validSyncEntry(entry) &&
			entry.path === conflict.path &&
			(mode === 'two-way' || (mode === 'download' ? side === 'remote' : side === 'local'))
		);
	});
}

/** Compare a fresh plan to the exact versions displayed before applying choices.
 * The normal executor still conditions each write on these source/target stamps.
 */
export function resolveFileSyncConflicts(
	plan: SyncPlan,
	reviewed: readonly SyncConflict[],
	choices: readonly SyncConflictChoice[],
	mode: SyncMode
): SyncPlan {
	const current = plan.decisions.filter((decision): decision is SyncConflict => decision.kind === 'conflict');
	const before = new Map(reviewed.map((conflict) => [conflict.path, conflict]));
	const selected = new Map(choices.map((choice) => [choice.path, choice.from]));
	if (before.size !== reviewed.length || selected.size !== choices.length || current.length !== before.size || selected.size !== before.size)
		throw Error('The conflict list changed or choices are incomplete. Review the folders again.');
	for (const conflict of current) {
		const old = before.get(conflict.path),
			from = selected.get(conflict.path);
		if (!old || old.reason !== conflict.reason || !sameSyncStamp(old.local, conflict.local) || !sameSyncStamp(old.remote, conflict.remote))
			throw Error('A conflicting file changed during review. Both copies were preserved. Review the folders again.');
		if (!from || !conflictCopySides(conflict, mode).includes(from))
			throw Error('This conflict needs changes in the source folders before syncing. Both copies were preserved.');
	}
	return {
		scope: { ...plan.scope },
		decisions: plan.decisions.map((decision) => {
			if (decision.kind !== 'conflict') return structuredClone(decision);
			const from = selected.get(decision.path)!;
			return {
				kind: 'copy',
				path: decision.path,
				from,
				source: structuredClone(decision[from]!),
				expectedTarget: structuredClone(decision[from === 'local' ? 'remote' : 'local'])
			};
		})
	};
}

/** Explicit capture is separate from choosing a winning sync version. */
export function planConflictRetention(plan: SyncPlan, reviewed: readonly SyncConflict[]): SyncPlan {
	if (!canRetainFileConflicts(reviewed)) throw Error('Only conflicts between two existing files can be saved here.');
	const resolved = resolveFileSyncConflicts(
		plan,
		reviewed,
		reviewed.map((c) => ({ path: c.path, from: 'local' })),
		'two-way'
	);
	const paths = new Set(reviewed.map((c) => c.path));
	return { scope: resolved.scope, decisions: resolved.decisions.filter((d) => paths.has(d.path)) };
}
