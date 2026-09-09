import { getThingsCollection } from '../mongodb/collections';
import {
	fail,
	canViewInherited,
	batchedThingLookup,
	findViewableThing,
	toPublicThings,
	visibilityQueryFor,
	withMatch,
	withFriendIds,
	type Fail,
	type PublicThing,
	type ThingDoc,
	type Viewer
} from '../things/things';
import {
	COMPONENT_KEY_PATTERN,
	MAX_WEBPAGE_BLOCK_REF_CHARS,
	MAX_WEBPAGE_ROUTE_CHARS,
	WEBPAGE_ROUTE_PATTERN
} from '~/schemas/registry';
import { selectComponent } from './componentResolutionCore';

// Read model for the block-based site builder: resolve ONE webpage thing
// (a standalone /p/ page by shareId, the site page bound to an app route, or
// the site-global block doc) together with every component thing its blocks
// reference — one batched component query, so the client renders a whole
// page from a single request with no N+1.
//
// Site pages personalise per viewer: a viewer-owned webpage with the same
// siteRoute/pageKey outranks the seeded system default (webpage-route-<key>),
// so "editing the site" forks the system doc into the viewer's own Things and
// never mutates shared state.

export const SITE_GLOBAL_PAGE_KEY = 'site-global';

const MAX_SHARE_ID_LOOKUP_CHARS = 128;

export type ResolveWebpageResult = {
	ok: true;
	page: PublicThing | null;
	// user = the viewer's personal doc; system = the seeded site default
	source: 'user' | 'system' | null;
	components: PublicThing[];
	// componentRef (as written in blocks) → resolved component thing id
	refs: Record<string, string | null>;
};

const collectComponentRefs = (blocks: unknown, refs: Set<string>): void => {
	if (!Array.isArray(blocks)) return;
	for (const block of blocks) {
		if (!block || typeof block !== 'object') continue;
		const raw = block as Record<string, unknown>;
		if (raw.type === 'component' && typeof raw.component === 'string') {
			const ref = raw.component.trim();
			if (ref && ref.length <= MAX_WEBPAGE_BLOCK_REF_CHARS && !/[$\s]/.test(ref)) refs.add(ref);
		}
		if (raw.type === 'container') collectComponentRefs(raw.children, refs);
	}
};

// Resolve every distinct component ref in one batched query. Priority per
// ref: exact visible shareId → seeded platform doc (component-<ref>) →
// the viewer's own latest componentKey match.
const resolveComponents = async (
	viewer: Viewer,
	page: ThingDoc | null,
	inheritAudience = true
): Promise<{ components: PublicThing[]; refs: Record<string, string | null> }> => {
	const wanted = new Set<string>();
	collectComponentRefs(page?.crystal?.blocks, wanted);
	if (!wanted.size) return { components: [], refs: {} };

	const refs = [...wanted];
	const slugRefs = refs.filter((ref) => COMPONENT_KEY_PATTERN.test(ref));
	const collection = await getThingsCollection();
	const visibility = visibilityQueryFor(viewer, []);
	// Only a stored, authorised composition delegates its audience. The demo
	// block-list helper has no root authority and retains viewer-local lookup.
	const root = page?.shareId && page.ownerId && await canViewInherited(page, viewer) ? page : null;
	const compositionOwnerId = root?.ownerId || viewer?.id || null;

	const arms: Record<string, unknown>[] = [];
	// exact shareId hits ride the ordinary visibility fence
	if (visibility) arms.push(withMatch({ shareId: { $in: refs } }, visibility));
	else arms.push({ shareId: { $in: refs }, acl: 'tt:all' });
	if (root) arms.push({ shareId: { $in: refs }, ownerId: root.ownerId });
	// seeded platform docs are system-owned tt:all — match them directly so a
	// logged-out viewer still resolves the catalog
	if (slugRefs.length) {
		arms.push({ shareId: { $in: slugRefs.map((ref) => `component-${ref}`) }, ownerId: 'system' });
		if (compositionOwnerId) arms.push({ ownerId: compositionOwnerId, 'crystal.componentKey': { $in: slugRefs } });
	}

	// Bound per identity, not by arbitrary total revisions: many versions of
	// one component must never crowd a different required component out.
	const exactIds = [...refs, ...slugRefs.map((ref) => `component-${ref}`)];
	const docs = (await collection.aggregate([
		{ $match: { $and: [{ thingtime: 'component' }, { $or: arms }] } },
		{ $sort: { 'crystal.version': -1, updatedAt: -1, shareId: 1 } },
		{ $group: { _id: { $cond: [
			{ $in: ['$shareId', exactIds] }, { exact: '$shareId' },
			{ owner: '$ownerId', key: { $ifNull: ['$crystal.componentKey', '$shareId'] } }
		] }, doc: { $first: '$$ROOT' } } },
		{ $replaceRoot: { newRoot: '$doc' } },
		{ $limit: refs.length * 3 }
	]).toArray()) as unknown as ThingDoc[];

	const lookup = batchedThingLookup();
	const permitted = (await Promise.all(docs.map(async (doc) => {
		// A root can include its own components regardless of their standalone
		// audience. Never borrow the author's identity: that would expose keys,
		// token grants, or foreign private components. Preserve the child's
		// moderation checks and judge its audience through the authorised root.
		const inherited = inheritAudience && root && doc.ownerId === root.ownerId;
		const candidate = inherited ? { ...doc, acl: ['tt:inherit'], targetId: root.shareId } : doc;
		const allowed = await canViewInherited(candidate, viewer, (id) => id === root?.shareId ? Promise.resolve(root) : lookup(id));
		return allowed ? doc : null;
	}))).filter((doc): doc is ThingDoc => !!doc);

	const resolved: Record<string, string | null> = {};
	const picked = new Map<string, ThingDoc>();
	for (const ref of refs) {
		const doc = selectComponent(ref, permitted, compositionOwnerId);
		resolved[ref] = doc?.shareId || null;
		if (doc?.shareId) picked.set(doc.shareId, doc);
	}

	const components = await toPublicThings([...picked.values()], viewer);
	return { components, refs: resolved };
};

// Shared writers can edit the included content, but cannot use a new guessed
// author-local ref to publish an unrelated private component. Only the owner
// can delegate their private component audience by adding it to a page.
export const validateSharedComponentAdditions = async (
	viewer: Viewer,
	page: ThingDoc,
	crystal: Record<string, unknown>
): Promise<Fail | null> => {
	const previous = new Set<string>();
	const next = new Set<string>();
	collectComponentRefs(page.crystal?.blocks, previous);
	collectComponentRefs(crystal.blocks, next);
	const additions = [...next].filter((ref) => !previous.has(ref));
	if (!additions.length) return null;
	const blocks = additions.map((component) => ({ type: 'component', component }));
	const resolved = await resolveComponents(await withFriendIds(viewer), { ...page, crystal: { blocks } }, false);
	return additions.every((ref) => !!resolved.refs[ref]) ? null : fail(403, 'Only the owner can include a private component you cannot already read');
};

// Same batched resolution for a block list that is not a stored page — the
// demo library resolves the library components its catalog demos reference so
// a gallery thumbnail draws the same component things /p/ would.
export const resolveBlockComponents = async (
	viewer: Viewer,
	blocks: unknown
): Promise<{ components: PublicThing[]; refs: Record<string, string | null> }> =>
	resolveComponents(viewer, { crystal: { blocks } } as unknown as ThingDoc);

const resultFor = async (
	viewer: Viewer,
	doc: ThingDoc | null,
	source: 'user' | 'system' | null
): Promise<ResolveWebpageResult | Fail> => {
	if (doc && !(await canViewInherited(doc, viewer))) return fail(404, 'Webpage not found');
	const { components, refs } = await resolveComponents(viewer, doc);
	const page = doc ? (await toPublicThings([doc], viewer))[0] || null : null;
	return { ok: true, page, source: page ? source : null, components, refs };
};

// Viewer-owned doc outranks the seeded system default. Both arms are cheap
// exact matches; private user docs are fine because they are the viewer's own.
const findSitePage = async (
	viewer: Viewer,
	match: Record<string, unknown>
): Promise<{ doc: ThingDoc | null; source: 'user' | 'system' | null }> => {
	const collection = await getThingsCollection();
	const owners: string[] = viewer?.id ? [viewer.id, 'system'] : ['system'];
	const docs = (await collection
		.find({ ...match, thingtime: 'webpage', ownerId: { $in: owners } } as any)
		.sort({ updatedAt: -1 })
		.limit(8)
		.toArray()) as any as ThingDoc[];
	const own = viewer?.id ? docs.find((doc) => doc.ownerId === viewer.id) : null;
	if (own) return { doc: own, source: 'user' };
	const system = docs.find((doc) => doc.ownerId === 'system');
	return system ? { doc: system, source: 'system' } : { doc: null, source: null };
};

export const resolveWebpage = async (
	viewer: Viewer,
	query: { id?: unknown; path?: unknown; global?: unknown }
): Promise<ResolveWebpageResult | Fail> => {
	viewer = await withFriendIds(viewer);
	if (query.global === '1' || query.global === 'true' || query.global === true) {
		const { doc, source } = await findSitePage(viewer, { 'crystal.pageKey': SITE_GLOBAL_PAGE_KEY });
		return resultFor(viewer, doc, source);
	}

	if (query.path !== undefined && query.path !== null && query.path !== '') {
		const path = typeof query.path === 'string' ? query.path.trim() : '';
		if (!path || path.length > MAX_WEBPAGE_ROUTE_CHARS || !WEBPAGE_ROUTE_PATTERN.test(path)) {
			return fail(400, 'path must be an app route like /status');
		}
		const { doc, source } = await findSitePage(viewer, { 'crystal.siteRoute': path });
		return resultFor(viewer, doc, source);
	}

	const id = typeof query.id === 'string' ? query.id.trim() : '';
	if (!id) return fail(400, 'Pass id=<shareId>, path=</route>, or global=1');
	if (id.length > MAX_SHARE_ID_LOOKUP_CHARS || /[$\s]/.test(id)) return fail(400, 'id must be a webpage shareId');

	const collection = await getThingsCollection();
	const visibility = visibilityQueryFor(viewer, []);
	const match = visibility
		? withMatch({ shareId: id, thingtime: 'webpage' }, visibility)
		: { shareId: id, thingtime: 'webpage', acl: 'tt:all' };
	let doc = (await collection.findOne(match as any)) as any as ThingDoc | null;

	// Hidden 🕵️ pages are unlisted, so they can NEVER come back from the match
	// above: visibilityQueryFor only knows circles, own-things and grants, and
	// tt:hidden deliberately matches no viewer — the audience of a hidden page
	// is whoever presents its secret linkKey. The reader threads that key here
	// (/p/<id>?key= → _resolve.tsx → withLinkKeys), so consult it with the same
	// authority /api/v1/things uses: findViewableThing → canView, which admits a
	// key holder (logged out included) only while the acl still says hidden, so
	// un-hiding a page instantly retires every link that circulated. Narrow by
	// design — a miss stays a plain 404, and nothing here widens feeds, search,
	// or any listing path.
	if (!doc && viewer?.linkKeys?.size) {
		const byKey = await findViewableThing(id, viewer);
		if (byKey && (byKey.thingtime || []).includes('webpage')) doc = byKey;
	}

	// PAGE KEYS personalise like site routes: `/p/<pageKey>` (or the seeded
	// `/p/webpage-<pageKey>`) resolves the VIEWER'S OWN page carrying that
	// pageKey ahead of the system-seeded one. This is what makes an installed
	// app suite work — its pages link to each other by key, the seeded copy
	// answers for visitors, and the moment a viewer installs the suite the same
	// URLs serve their own (interactive) twins. Only viewer-owned and
	// system-owned docs take part: a stranger's page never resolves by key.
	if (!doc || doc.ownerId === 'system') {
		const pageKey = doc ? (typeof doc.crystal?.pageKey === 'string' ? doc.crystal.pageKey : null) : id;
		if (pageKey && pageKey.length <= MAX_WEBPAGE_ROUTE_CHARS && COMPONENT_KEY_PATTERN.test(pageKey)) {
			const { doc: keyed } = await findSitePage(viewer, { 'crystal.pageKey': pageKey });
			if (keyed) doc = keyed;
		}
	}
	if (!doc) return fail(404, 'Webpage not found');
	// source 'user' means "the VIEWER owns this and saves update it in place".
	// Someone else's shared page must report as 'system' so a viewer who edits
	// it takes the fork path (their own twin) instead of a doomed update.
	const source: 'user' | 'system' = viewer?.id && doc.ownerId === viewer.id ? 'user' : 'system';
	return resultFor(viewer, doc, source);
};
