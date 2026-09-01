import { getThingsCollection } from '../mongodb/collections';
import {
	fail,
	toPublicThings,
	visibilityQueryFor,
	withMatch,
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
	page: ThingDoc | null
): Promise<{ components: PublicThing[]; refs: Record<string, string | null> }> => {
	const wanted = new Set<string>();
	collectComponentRefs(page?.crystal?.blocks, wanted);
	if (!wanted.size) return { components: [], refs: {} };

	const refs = [...wanted];
	const slugRefs = refs.filter((ref) => COMPONENT_KEY_PATTERN.test(ref));
	const collection = await getThingsCollection();
	const visibility = visibilityQueryFor(viewer, []);

	const arms: Record<string, unknown>[] = [];
	// exact shareId hits ride the ordinary visibility fence
	if (visibility) arms.push(withMatch({ shareId: { $in: refs } }, visibility));
	else arms.push({ shareId: { $in: refs }, acl: 'tt:all' });
	// seeded platform docs are system-owned tt:all — match them directly so a
	// logged-out viewer still resolves the catalog
	if (slugRefs.length) {
		arms.push({ shareId: { $in: slugRefs.map((ref) => `component-${ref}`) }, ownerId: 'system' });
		if (viewer?.id) arms.push({ ownerId: viewer.id, 'crystal.componentKey': { $in: slugRefs } });
	}

	const docs = (await collection
		.find({ $and: [{ thingtime: 'component' }, { $or: arms }] } as any)
		.sort({ updatedAt: -1 })
		.limit(refs.length * 8)
		.toArray()) as any as ThingDoc[];

	const byShareId = new Map<string, ThingDoc>();
	const ownLatestByKey = new Map<string, ThingDoc>();
	for (const doc of docs) {
		if (doc.shareId && !byShareId.has(doc.shareId)) byShareId.set(doc.shareId, doc);
		const key = typeof doc.crystal?.componentKey === 'string' ? doc.crystal.componentKey : null;
		if (key && viewer?.id && doc.ownerId === viewer.id) {
			const current = ownLatestByKey.get(key);
			const versionOf = (candidate: ThingDoc): number => Number(candidate.crystal?.version) || 0;
			if (!current || versionOf(doc) > versionOf(current)) ownLatestByKey.set(key, doc);
		}
	}

	const resolved: Record<string, string | null> = {};
	const picked = new Map<string, ThingDoc>();
	for (const ref of refs) {
		const doc = byShareId.get(ref) || byShareId.get(`component-${ref}`) || ownLatestByKey.get(ref) || null;
		resolved[ref] = doc?.shareId || null;
		if (doc?.shareId) picked.set(doc.shareId, doc);
	}

	const components = await toPublicThings([...picked.values()], viewer);
	return { components, refs: resolved };
};

const resultFor = async (
	viewer: Viewer,
	doc: ThingDoc | null,
	source: 'user' | 'system' | null
): Promise<ResolveWebpageResult> => {
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
	const doc = (await collection.findOne(match as any)) as any as ThingDoc | null;
	if (!doc) return fail(404, 'Webpage not found');
	// source 'user' means "the VIEWER owns this and saves update it in place".
	// Someone else's shared page must report as 'system' so a viewer who edits
	// it takes the fork path (their own twin) instead of a doomed update.
	const source: 'user' | 'system' = viewer?.id && doc.ownerId === viewer.id ? 'user' : 'system';
	return resultFor(viewer, doc, source);
};
