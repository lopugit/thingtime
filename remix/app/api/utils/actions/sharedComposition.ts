import { getThingsCollection } from '../mongodb/collections';
import { batchedThingLookup, canViewInherited, fail, type Fail, type ThingDoc, type Viewer } from '../things/things';
import { compositionReferences } from './sharedCompositionCore';
import { canForkThing } from '~/components/Sharing/forkThingCore';

export const validateSharedReferenceAdditions = async (viewer: Viewer, doc: ThingDoc, crystal: Record<string, unknown>): Promise<Fail | null> => {
	const before = new Set(compositionReferences(doc.thingtime || [], doc.crystal || {}).map(({ kind, ref }) => `${kind}:${ref}`));
	const collection = await getThingsCollection();
	for (const { kind, ref, optional } of compositionReferences(doc.thingtime || [], crystal)) {
		if (kind === 'component' || before.has(`${kind}:${ref}`)) continue;
		const child = await collection.findOne({ thingtime: kind, $or: [{ shareId: ref }, ...(kind === 'action' ? [{ ownerId: doc.ownerId, 'crystal.actionKey': ref }] : kind === 'schema' ? [{ ownerId: { $in: [doc.ownerId, 'system'] }, 'crystal.name': ref }] : [])] } as any,
			{ sort: { 'crystal.version': -1, updatedAt: -1 } }) as unknown as ThingDoc | null;
		if (!child && optional) continue;
		if (!child || !(await canViewInherited(child, viewer))) return fail(403, 'Only the owner can include a private dependency you cannot already read');
	}
	return null;
};

export type SharedComposition = {
	root: ThingDoc;
	actions: Map<string, ThingDoc>;
	children: Map<string, ThingDoc>;
	data: Map<string, ThingDoc>;
	docs: Map<string, ThingDoc>;
	references: Map<string, ThingDoc>;
};

// Rebuilt per invocation: a revoked link/group grant cannot keep using an
// earlier resolver response as a capability. The root's owner is a lookup
// namespace, NEVER an execution identity.
export const resolveSharedComposition = async (viewer: Viewer, id: string, options: { forCopy?: boolean } = {}): Promise<SharedComposition | Fail> => {
	const collection = await getThingsCollection();
	const root = await collection.findOne({ shareId: id } as any) as unknown as ThingDoc | null;
	if (!root || !(await canViewInherited(root, viewer)) || !(options.forCopy ? canForkThing(root) : root.thingtime?.some((kind) => ['webpage', 'component', 'action'].includes(kind)))) {
		return fail(404, 'Shared app not found');
	}
	const result: SharedComposition = { root, actions: new Map(), children: new Map(), data: new Map(), docs: new Map([[root.shareId, root]]), references: new Map() };
	if (root.thingtime.includes('action')) {
		result.actions.set(root.shareId, root);
		if (typeof root.crystal?.actionKey === 'string') result.actions.set(root.crystal.actionKey, root);
	}
	const queue = [root];
	const seen = new Set<string>();
	const lookup = batchedThingLookup();
	let edges = 0;
	for (let index = 0; index < queue.length; index += 1) {
		const parent = queue[index];
		if (seen.has(parent.shareId)) continue;
		seen.add(parent.shareId);
		if (seen.size > 128) return fail(422, 'Shared app has too many dependencies');
		for (const reference of compositionReferences(parent.thingtime || [], parent.crystal || {})) {
			if (++edges > 512) return fail(422, 'Shared app has too many references');
			const { kind, ref } = reference;
			const queries: Record<string, unknown>[] = [{ shareId: ref, thingtime: kind }];
			if (kind === 'component') queries.push({ shareId: `component-${ref}`, ownerId: 'system', thingtime: kind });
			if (kind !== 'data') queries.push({ ownerId: parent.ownerId, thingtime: kind, [`crystal.${kind === 'schema' ? 'name' : `${kind}Key`}`]: ref });
			if (kind === 'schema') queries.push({ ownerId: 'system', thingtime: 'schema', 'crystal.name': ref });
			let child: ThingDoc | null = null;
			for (const query of queries) {
				const found = await collection.findOne(query as any, { sort: { 'crystal.version': -1, updatedAt: -1, shareId: 1 } }) as unknown as ThingDoc | null;
				if (!found) continue;
				// Only same-author containment inherits. A foreign node cannot
				// publish unrelated private root-author data through its refs.
				const inherited = parent.ownerId === root.ownerId && found.ownerId === root.ownerId && found.shareId !== root.shareId;
				const candidate = inherited ? { ...found, acl: ['tt:inherit'], targetId: root.shareId } : found;
				if (await canViewInherited(candidate, viewer, (target) => target === root.shareId ? Promise.resolve(root) : lookup(target))) { child = found; break; }
			}
			if (!child) continue;
			result.docs.set(child.shareId, child);
			result.references.set(`${parent.shareId}:${kind}:${ref}`, child);
			if (kind === 'action') {
				result.children.set(`${parent.shareId}:${ref}`, child);
				if (!parent.thingtime.includes('action')) {
					const existing = result.actions.get(ref);
					if (existing && existing.shareId !== child.shareId) return fail(422, 'Ambiguous shared action reference; use explicit action ids');
					result.actions.set(ref, child);
					result.actions.set(child.shareId, child);
				}
			}
			if (kind === 'data') result.data.set(child.shareId, child);
			queue.push(child);
		}
	}
	return result;
};
