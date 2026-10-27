import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from './snapshotParts.ts';
import type { TimelineEntry, TimelineSnapshot } from './contract.ts';
import { versionContent } from './versions.ts';

export type TimelineGraphNode = { id: string; thingId: string; parentIds: string[]; afterAdapter: string | null };
/** Shared bounded ancestry and materialization; the caller supplies its authority-specific error. */
export function createVersionGraphTools(
	reject: (status: number, message: string) => never,
	content?: {
		adapters: readonly string[];
		read(snapshot: TimelineSnapshot | null, basis?: TimelineSnapshot['value']): ReturnType<typeof versionContent>;
	}
) {
	const fullAdapters = content?.adapters ?? ['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER];
	const restorableContent = (snapshot: TimelineSnapshot | null, basis?: TimelineSnapshot['value']) => {
		try {
			return content ? content.read(snapshot, basis) : versionContent(snapshot, basis);
		} catch {
			return reject(422, 'This version has unsupported or incomplete content. Recover the draft in its editor before applying it.');
		}
	};
	/** Bounded batch traversal, independent of how much history a client cached. */
	async function loadVersionGraph(roots: string[], thingId: string, read: (ids: string[]) => Promise<TimelineGraphNode[]>) {
		const entries = new Map<string, TimelineGraphNode>();
		let frontier = [...new Set(roots)];
		while (frontier.length) {
			const next: string[] = [];
			for (let offset = 0; offset < frontier.length; offset += 128) {
				const ids = frontier.slice(offset, offset + 128);
				const found = await read(ids);
				if (
					found.length !== ids.length ||
					new Set(found.map((entry) => entry.id)).size !== ids.length ||
					found.some((entry) => !ids.includes(entry.id) || entry.thingId !== thingId)
				)
					reject(409, 'Earlier versions are unavailable. History cannot be merged safely.');
				for (const entry of found) {
					entries.set(entry.id, entry);
					next.push(...entry.parentIds);
				}
				if (entries.size > 2048) reject(409, 'This version is too far back for one merge. Choose a more recent version.');
			}
			frontier = [...new Set(next)].filter((id) => !entries.has(id));
		}
		return entries;
	}
	function versionMergeBase(graph: Map<string, TimelineGraphNode>, left: string, right: string): TimelineGraphNode {
		const ancestors = (id: string) => {
			const seen = new Set<string>();
			const queue = [id];
			for (let cursor = 0; cursor < queue.length; cursor++) {
				const next = queue[cursor];
				if (seen.has(next)) continue;
				seen.add(next);
				const entry = graph.get(next);
				if (!entry) reject(409, 'An ancestor is missing.');
				queue.push(...entry!.parentIds);
			}
			return seen;
		};
		const a = ancestors(left);
		const b = ancestors(right);
		const common = new Set([...a].filter((id) => b.has(id)));
		const older = new Set<string>();
		for (const id of common) for (const parent of graph.get(id)!.parentIds) if (common.has(parent)) older.add(parent);
		const bases = [...common].filter((id) => !older.has(id));
		if (bases.length !== 1)
			reject(
				409,
				bases.length
					? 'These branches have multiple merge bases. Choose an earlier version to compare.'
					: 'These versions have no shared ancestor. Review a restore instead.'
			);
		return graph.get(bases[0])!;
	}

	/** Select the nearest full version and latest replacement of each compact
	 * field. Folder moves inherit the preceding crystal and its dependency links;
	 * no payload is borrowed from the live Thing. */
	function versionContentSources(graph: Map<string, TimelineGraphNode>, entry: Pick<TimelineEntry, 'event'>) {
		const selected: string[] = [];
		const fields = new Set<string>();
		const seen = new Set<string>();
		let id = entry.event.id;
		while (true) {
			if (seen.has(id) || seen.size >= 2048) reject(409, 'This version has incomplete or cyclic ancestry.');
			seen.add(id);
			const node =
				graph.get(id) ?? (id === entry.event.id ? { id, parentIds: entry.event.parentIds, afterAdapter: entry.event.after?.adapter } : null);
			if (!node) reject(409, 'An earlier version is unavailable.');
			if (fullAdapters.includes(node.afterAdapter ?? '')) {
				selected.push(id);
				break;
			}
			const field =
				node.afterAdapter === 'folder-placement'
					? 'folderId'
					: ['webpage-draft', 'definition-source'].includes(node.afterAdapter ?? '')
					? 'crystal'
					: null;
			if (!field || node.parentIds.length !== 1) reject(422, 'This draft has no unambiguous saved basis. Recover it in its editor first.');
			if (!fields.has(field)) {
				fields.add(field);
				selected.push(id);
			}
			id = node.parentIds[0];
		}
		const crystalId = selected.find(
			(key) => (graph.get(key)?.afterAdapter ?? (key === entry.event.id ? entry.event.after?.adapter : null)) !== 'folder-placement'
		)!;
		return { selected, crystalId };
	}

	function createVersionContentReader<Entry extends Pick<TimelineEntry, 'event'>>(
		graph: Map<string, TimelineGraphNode>,
		read: (ids: string[]) => Promise<Entry[]>,
		snapshot: (entry: Entry) => Promise<TimelineSnapshot | null>
	) {
		const cached = new Map<string, Entry>();
		return async (entry: Entry) => {
			cached.set(entry.event.id, entry);
			const { selected } = versionContentSources(graph, entry);
			const missing = selected.filter((key) => !cached.has(key));
			if (missing.length) {
				const found = await read(missing);
				if (
					found.length !== missing.length ||
					new Set(found.map((item) => item.event.id)).size !== missing.length ||
					found.some(
						(item) => !missing.includes(item.event.id) || item.event.ownerId !== entry.event.ownerId || item.event.thingId !== entry.event.thingId
					)
				)
					reject(409, 'An earlier version is unavailable.');
				for (const item of found) cached.set(item.event.id, item);
			}
			let content: ReturnType<typeof versionContent> | undefined;
			for (const key of selected.reverse()) content = restorableContent(await snapshot(cached.get(key)!), content);
			return content!;
		};
	}

	return { restorableContent, loadVersionGraph, versionMergeBase, versionContentSources, createVersionContentReader };
}
