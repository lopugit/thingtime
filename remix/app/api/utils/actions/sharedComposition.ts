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
	const previous = await resolveCompositionFromRoot(viewer, doc, collection, lookupCache);
	if (isFail(previous)) return previous;
	const next = await resolveCompositionFromRoot(viewer, { ...doc, crystal }, collection, lookupCache);
	if (isFail(next)) return next;
	for (const ref of next.requiredReferences) {
		if (!previous.requiredReferences.has(ref) && !next.references.has(ref)) return fail(403, 'A new dependency is unavailable to this composition');
	}
	for (const child of next.docs.values()) {
		if (previous.docs.has(child.shareId)) continue;
		if (await canViewInherited(child, viewer)) continue;
		// An independently readable foreign component already publishes its own
		// authored children. Inclusion must not require their standalone ACLs.
		const boundaries = next.boundaries.get(child.shareId) || [];
		let readableBoundary = false;
		for (const boundary of boundaries) if (boundary.shareId !== doc.shareId && await canViewInherited(boundary, viewer)) readableBoundary = true;
		if (!readableBoundary) return fail(403, 'Only the owner can include a private dependency you cannot already read');
	}
	const media = async (root: ThingDoc) => {
		if (!root.thingtime.includes('webpage')) return compositionAttachmentIds(root.thingtime || [], root.crystal || {});
		return new Set(compositionMediaBoundaries(root === doc ? previous : next, true).keys());
	};
	const previousMedia = await media(doc);
	if (isFail(previousMedia)) return previousMedia;
	const nextMedia = await media({ ...doc, crystal });
	if (isFail(nextMedia)) return nextMedia;
	const mediaBoundaries = compositionMediaBoundaries(next);
	for (const id of nextMedia) {
		if (previousMedia.has(id)) continue;
		const attachment = await collection.findOne({ shareId: id, thingtime: 'attachment' } as any) as unknown as ThingDoc | null;
		if (attachment && await canViewInherited(attachment, viewer)) continue;
		let readableBoundary = false;
		for (const boundary of mediaBoundaries.get(id) || []) {
			if (attachment?.ownerId === boundary.ownerId && boundary.shareId !== doc.shareId && await canViewInherited(boundary, viewer)) readableBoundary = true;
		}
		if (!readableBoundary) return fail(403, 'Only the owner can include private media you cannot already read');
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
	requiredReferences: Set<string>;
	contexts: Map<string, (Record<string, unknown> | undefined)[]>;
	/** Freshly authorized audience roots, never execution identities. */
	boundaries: Map<string, Set<ThingDoc>>;
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
	const result: SharedComposition = { root, actions: new Map(), children: new Map(), data: new Map(), docs: new Map([[root.shareId, root]]), references: new Map(), requiredReferences: new Set(), contexts: new Map(), boundaries: new Map([[root.shareId, new Set([root])]]) };
	if (root.thingtime.includes('action')) {
		result.actions.set(root.shareId, root);
		if (typeof root.crystal?.actionKey === 'string') result.actions.set(root.crystal.actionKey, root);
	}
	const queue: { doc: ThingDoc; boundary?: ThingDoc; args?: Record<string, unknown> }[] = [{ doc: root, boundary: root }];
	const seen = new Set<string>();
	const lookup = batchedThingLookup();
	let edges = 0;
	for (let index = 0; index < queue.length; index += 1) {
		const { doc: parent, boundary, args } = queue[index];
		const contextKey = JSON.stringify([parent.shareId, boundary?.shareId, args]);
		if (seen.has(contextKey)) continue;
		seen.add(contextKey);
		if (seen.size > 512 || result.docs.size > 128) return fail(422, 'Shared app has too many dependencies');
		const contexts = result.contexts.get(parent.shareId) || [];
		contexts.push(args);
		result.contexts.set(parent.shareId, contexts);
		for (const reference of compositionReferences(parent.thingtime || [], parent.crystal || {}, args)) {
			if (++edges > 512) return fail(422, 'Shared app has too many references');
			const { kind, ref } = reference;
			if (!reference.optional) result.requiredReferences.add(`${parent.shareId}:${kind}:${ref}`);
			const queries: Record<string, unknown>[] = [{ shareId: ref, thingtime: kind }];
			if (kind === 'component') queries.push({ shareId: `component-${ref}`, ownerId: 'system', thingtime: kind });
			if (kind !== 'data') queries.push({ ownerId: parent.ownerId, thingtime: kind, [`crystal.${kind === 'schema' ? 'name' : `${kind}Key`}`]: ref });
			if (kind === 'schema') queries.push({ ownerId: 'system', thingtime: 'schema', 'crystal.name': ref });
			let child: ThingDoc | null = null;
			let childBoundary: ThingDoc | undefined;
			for (const query of queries) {
				const cacheKey = JSON.stringify(query);
				if (!cache.has(cacheKey)) cache.set(cacheKey, collection.findOne(query as any, { sort: { 'crystal.version': -1, updatedAt: -1, shareId: 1 } }) as unknown as Promise<ThingDoc | null>);
				const found = await cache.get(cacheKey);
				if (!found) continue;
				// Same-author descendants inherit the current audience. A foreign
				// public/group-readable node starts its own boundary; its authored
				// children work exactly as when that node is opened independently.
				const inherited = boundary && parent.ownerId === boundary.ownerId && found.ownerId === boundary.ownerId && found.shareId !== boundary.shareId;
				const candidate = inherited ? { ...found, acl: ['tt:inherit'], targetId: boundary.shareId } : found;
				if (await canViewInherited(candidate, viewer, (target) => boundary && target === boundary.shareId ? Promise.resolve(boundary) : lookup(target))) {
					child = found;
					childBoundary = inherited ? boundary : found;
					break;
				}
			}
			if (!child) continue;
			result.docs.set(child.shareId, child);
			const boundaries = result.boundaries.get(child.shareId) || new Set<ThingDoc>();
			boundaries.add(childBoundary!);
			result.boundaries.set(child.shareId, boundaries);
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
			// The saved component remains independently usable as well as at each
			// persisted page instance. Defaults are not replaced by the first block.
			if (kind === 'component' && reference.args) queue.push({ doc: child, boundary: childBoundary });
			// Page-authored overrides cannot borrow a foreign component author's
			// private namespace. They may select independently readable nodes only.
			const trustedArgs = kind !== 'component' || !reference.args || parent.ownerId === child.ownerId;
			queue.push({ doc: child, boundary: trustedArgs ? childBoundary : undefined, ...(kind === 'component' ? { args: reference.args } : {}) });
		}
	}
	return result;
};

const compositionMediaBoundaries = (composition: SharedComposition, includeUntrusted = false): Map<string, Set<ThingDoc>> => {
	const ids = new Map<string, Set<ThingDoc>>();
	for (const doc of composition.docs.values()) {
		// Writes inspect all rendered page overrides, but discovery alone never
		// assigns an audience. Foreign override IDs retain an empty grant set.
		if (includeUntrusted && doc.thingtime.includes('webpage')) {
			for (const id of compositionAttachmentIds(doc.thingtime, doc.crystal || {}, {
				component: (ref) => composition.references.get(`${doc.shareId}:component:${ref}`)?.crystal
			})) if (!ids.has(id)) ids.set(id, new Set());
		}
		const boundaries = [...(composition.boundaries.get(doc.shareId) || [])].filter((boundary) => boundary.ownerId === doc.ownerId);
		if (!boundaries.length) continue;
		const media = compositionAttachmentIds(doc.thingtime || [], doc.crystal || {}, {
			component: (ref) => {
				const child = composition.references.get(`${doc.shareId}:component:${ref}`);
				// A foreign template does not acquire authority to select unrelated
				// private uploads belonging to the root's owner.
				return child?.ownerId === doc.ownerId ? child.crystal : undefined;
			}
		});
		for (const id of media) {
			const audience = ids.get(id) || new Set<ThingDoc>();
			for (const boundary of boundaries) audience.add(boundary);
			ids.set(id, audience);
		}
	}
	return ids;
};

export const compositionMediaIds = (composition: SharedComposition): Set<string> => new Set(compositionMediaBoundaries(composition).keys());

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
	const inheritablePurpose = !attachment.attachmentPurpose || attachment.attachmentPurpose === 'post';
	if (inheritablePurpose) {
		const bound = boundTarget?.ownerId === attachment.ownerId ? composition.boundaries.get(boundTarget.shareId) : undefined;
		const audiences = bound || compositionMediaBoundaries(composition).get(attachment.shareId) || [];
		for (const boundary of audiences) {
			if (!boundary.ownerId || attachment.ownerId !== boundary.ownerId) continue;
			if (await canViewInherited({ ...attachment, acl: ['tt:inherit'], targetId: boundary.shareId } as ThingDoc, viewer,
				(id) => Promise.resolve(id === boundary.shareId ? boundary : null))) return true;
		}
	}
	// Public profile media, comment chains and independently accessible foreign
	// content keep their ordinary access. The root grants no extra authority.
	return viewer?.id === attachment.ownerId || independentlyVisible(viewer, attachment);
};

export const canViewSharedCompositionAttachment = createCanViewSharedCompositionAttachment();
