import { compositionReferences } from '../api/utils/actions/sharedCompositionCore';
import { selectComponent } from '../api/utils/webpages/componentResolutionCore';
import { TIMELINE_RELATED_MAX_THINGS } from '../timeline/relatedHistory';
import { isProtectedThingtime } from '../schemas/registry';
import { WorkspaceError, type WorkspaceTransaction } from './storage';
import type { LocalThing } from './things';

const owner = 'local-workspace';
const fail = (message: string, status: number): never => {
	throw new WorkspaceError('LOCAL_TIMELINE', message, status);
};

/** Read-only composition discovery from one scoped snapshot. Public catalog
 * caches and account partitions are deliberately not inputs. Stored references
 * and component args are inspected, never executed as Actions or requests. */
export async function localRelatedThingIds(tx: WorkspaceTransaction, rootId: string): Promise<string[]> {
	const all = (await tx.list<LocalThing>('things')).map((row) => row.value).filter((row) => !isProtectedThingtime(row.thingtime));
	const byId = new Map(all.map((row) => [row.id, row]));
	const root = byId.get(rootId);
	if (!root?.thingtime.includes('webpage')) return fail('Open a page in this local workspace to see its related history.', 404);
	const candidates = all
		.filter((row) => row.thingtime.includes('component'))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
		.map((row) => ({ row, shareId: row.id, ownerId: owner, crystal: row.crystal }));
	// Match the existing local Action/schema runtime's alias ordering.
	const newest = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
	const actions = newest
		.filter((row) => row.thingtime.includes('action'))
		.sort((a, b) => Number(b.crystal.version || 1) - Number(a.crystal.version || 1));
	const resolve = (kind: string, ref: string) => {
		const exact = byId.get(ref);
		if (exact?.thingtime.includes(kind)) return exact;
		if (kind === 'component') return selectComponent(ref, candidates, owner)?.row;
		if (kind === 'action') return actions.find((row) => row.crystal.actionKey === ref);
		if (kind === 'schema') return newest.find((row) => row.thingtime.includes('schema') && row.crystal.name === ref);
	};
	const ids = new Set([rootId]),
		seen = new Set<string>();
	const queue: { row: LocalThing; args?: Record<string, unknown> }[] = [{ row: root }];
	let edges = 0;
	for (let index = 0; index < queue.length; index++) {
		const { row, args } = queue[index],
			context = JSON.stringify([row.id, args]);
		if (seen.has(context)) continue;
		seen.add(context);
		if (seen.size > 512) fail('This page has too many related render contexts.', 422);
		for (const reference of compositionReferences(row.thingtime, row.crystal, args)) {
			if (++edges > 512) fail('This page has too many related references.', 422);
			const child = resolve(reference.kind, reference.ref);
			// Like account related History, unavailable dependencies contribute no
			// history. In particular, a remote ID never initiates a public read.
			if (!child) continue;
			ids.add(child.id);
			if (ids.size > TIMELINE_RELATED_MAX_THINGS) fail('This page has too many related Things.', 422);
			if (reference.kind === 'component' && reference.args) queue.push({ row: child });
			queue.push({ row: child, ...(reference.kind === 'component' ? { args: reference.args } : {}) });
		}
	}
	return [...ids].sort();
}
