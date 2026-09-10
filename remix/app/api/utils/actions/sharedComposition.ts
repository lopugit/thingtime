import { getThingsCollection } from '../mongodb/collections';
import { batchedThingLookup, canViewInherited, fail, isFail, toPublicThings, type Fail, type ThingDoc, type Viewer } from '../things/things';
import { compositionReferences } from './sharedCompositionCore';
import { canForkThing } from '~/components/Sharing/forkThingCore';
import { compositionAttachmentIds } from './compositionMediaCore';
import { canViewHomeAttachmentTarget, type AttachmentAccessDocument } from '../attachments/attachmentAccess';

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
	// A page's args are interpreted by its stored components. Compare the same
	// contained render contexts on both sides, not raw argument URL strings.
	const lookupCache = new Map<string, Promise<ThingDoc | null>>();
	const media = async (root: ThingDoc) => {
		if (!root.thingtime.includes('webpage')) return compositionAttachmentIds(root.thingtime || [], root.crystal || {});
		const composition = await resolveCompositionFromRoot(viewer, root, collection, lookupCache);
		return isFail(composition) ? composition : compositionMediaIds(composition);
	};
	const previousMedia = await media(doc);
	if (isFail(previousMedia)) return previousMedia;
	const nextMedia = await media({ ...doc, crystal });
	if (isFail(nextMedia)) return nextMedia;
	for (const id of nextMedia) {
		if (previousMedia.has(id)) continue;
		const attachment = await collection.findOne({ shareId: id, thingtime: 'attachment' } as any) as unknown as ThingDoc | null;
		if (!attachment || !(await canViewInherited(attachment, viewer))) return fail(403, 'Only the owner can include private media you cannot already read');
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
export const resolveSharedComposition = async (viewer: Viewer, id: string, options: { contentRoot?: boolean } = {}): Promise<SharedComposition | Fail> => {
	const collection = await getThingsCollection();
	const root = await collection.findOne({ shareId: id } as any) as unknown as ThingDoc | null;
	if (!root || !(await canViewInherited(root, viewer)) || !(options.contentRoot ? canForkThing(root) : root.thingtime?.some((kind) => ['webpage', 'component', 'action'].includes(kind)))) {
		return fail(404, 'Shared app not found');
	}
	return resolveCompositionFromRoot(viewer, root, collection);
};

// Internal only: reads pass the freshly authorized stored root above. The
// write validator passes its already-authorized before/after draft solely to
// compare dependencies; no request can supply a replacement root to reads.
const resolveCompositionFromRoot = async (
	viewer: Viewer, root: ThingDoc, collection: Awaited<ReturnType<typeof getThingsCollection>>,
	cache = new Map<string, Promise<ThingDoc | null>>()
): Promise<SharedComposition | Fail> => {
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
				const cacheKey = JSON.stringify(query);
				if (!cache.has(cacheKey)) cache.set(cacheKey, collection.findOne(query as any, { sort: { 'crystal.version': -1, updatedAt: -1, shareId: 1 } }) as unknown as Promise<ThingDoc | null>);
				const found = await cache.get(cacheKey);
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

export const compositionMediaIds = (composition: SharedComposition): Set<string> => {
	const ids = new Set<string>();
	for (const doc of composition.docs.values()) {
		if (doc.ownerId !== composition.root.ownerId) continue;
		const media = compositionAttachmentIds(doc.thingtime || [], doc.crystal || {}, {
			component: (ref) => {
				const child = composition.references.get(`${doc.shareId}:component:${ref}`);
				// A foreign template does not acquire authority to select unrelated
				// private uploads belonging to the root's owner.
				return child?.ownerId === composition.root.ownerId ? child.crystal : undefined;
			}
		});
		for (const id of media) ids.add(id);
	}
	return ids;
};

// Contextual reads do not alter standalone ACLs. Only a stored dependency of
// the freshly authorized root can be projected; arbitrary ids fail closed.
export const getSharedCompositionThing = async (viewer: Viewer, id: string, rootId: string) => {
	const composition = await resolveSharedComposition(viewer, rootId, { contentRoot: true });
	if (isFail(composition)) return composition;
	const doc = composition.docs.get(id);
	if (!doc) return fail(404, 'Shared dependency not found');
	return { ok: true as const, thing: (await toPublicThings([doc], viewer))[0] };
};

// The attachment service still owns ready-state, moderation, object-version,
// expiry and home-storage checks. This only substitutes the composition's read
// audience for a same-author post-purpose object attached to a contained Thing
// or explicitly embedded by one. Neither path changes the stored upload ACL.
export const createCanViewSharedCompositionAttachment = (resolve = resolveSharedComposition, independentlyVisible = canViewHomeAttachmentTarget) => async (viewer: Viewer, attachment: AttachmentAccessDocument, rootId: string): Promise<boolean> => {
	if (!attachment.targetId) return false;
	const composition = await resolve(viewer, rootId, { contentRoot: true });
	if (isFail(composition)) return false;
	const boundTarget = composition.docs.get(attachment.targetId);
	const compositionBound = attachment.targetId === composition.root.shareId || (!!boundTarget && boundTarget.ownerId === composition.root.ownerId);
	const inheritablePurpose = !attachment.attachmentPurpose || attachment.attachmentPurpose === 'post';
	const sameAuthor = !!composition.root.ownerId && attachment.ownerId === composition.root.ownerId;
	// Bound children need no markup scan; foreign/managed uploads never gain
	// authority from the root and need no discovery work at all.
	const embedded = inheritablePurpose && sameAuthor && !compositionBound && compositionMediaIds(composition).has(attachment.shareId);
	if (inheritablePurpose && sameAuthor && (compositionBound || embedded)) {
		return canViewInherited({ ...attachment, acl: ['tt:inherit'], targetId: composition.root.shareId } as ThingDoc, viewer, (id) => Promise.resolve(id === composition.root.shareId ? composition.root : null));
	}
	// Public profile media, comment chains and independently accessible foreign
	// content keep their ordinary access. The root grants no extra authority.
	return viewer?.id === attachment.ownerId || independentlyVisible(viewer, attachment);
};

export const canViewSharedCompositionAttachment = createCanViewSharedCompositionAttachment();
