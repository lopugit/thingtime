import { CATEGORIES, CATEGORY_BY_KEY, MARKETING_BASE, PAGES, PAGE_BY_SLUG, buildPageBySlug, pagesInCategory } from './catalog';
import { FEATURES, FEATURE_BY_KEY } from './features';
import {
	EMPTY_PUBLICATIONS,
	HUB_KEY,
	MAX_PUBLICATION_CHANGES,
	SECTION_LABELS,
	SOCIAL_KEY,
	allowedStateFor,
	categoryKey,
	pageKey,
	parsePublicationKey,
	sectionKey,
	socialFeatureKey,
	type MarketingPublications,
	type PublicationChange,
	type PublicationState,
	type PublicationTarget
} from './publishingCore';
import type { BuiltPage, Feature, MarketingPage, SectionBlock } from './types';

// The catalog-free half (key grammar, wire shape, pure change application)
// lives in publishingCore.ts so the drawer and the shared store never pull the
// catalog into the eager bundle; everything is re-exported from here.
export * from './publishingCore';

// Publishing for the generated marketing suite.
//
// Everything under /marketing is admin-only until an admin publishes it, one
// item at a time. An item is the hub, a category index, one generated page, a
// section inside a page, the social-image suite ("resources"), or one
// feature's image set inside it. The state lives server-side in one settings
// singleton (api/utils/marketing/) and reaches the client as two key lists:
//
//   published — keys an admin switched on (absence = not published)
//   hidden    — section keys an admin switched OFF inside a published page
//               (absence = the section shows whenever its page does)
//
// Publishing a category index does NOT publish its pages and vice versa: the
// index lists whatever pages are published, so an admin can open a category
// with three pages and keep the other eighty in the drawer. Bulk actions are a
// convenience on top, never an implied cascade.
//
// Keys are stable, catalog-validated strings so the server can refuse anything
// the catalog does not know about and a stale key from a removed page drops
// out of the projection on its own.
//
//   hub                          /marketing
//   social                       /marketing/social-media (the resources suite)
//   social:<feature>             one feature's image set inside the suite
//   category:<key>               /marketing/<key>
//   page:<slug>                  /marketing/<slug>
//   section:<slug>#<type>[/<n>]  one section of a page (n ≥ 2 for repeats)
//
// Nothing here touches React or the DOM; the server validates changes and the
// client resolves visibility through the same functions.

export type PageSection = { id: string; key: string; type: SectionBlock['type']; label: string; index: number; section: SectionBlock };

/**
 * Stable ids for a built page's sections: the block type, suffixed "/2", "/3"…
 * when a type repeats. Ids survive other types being added or reordered, which
 * an index-based id would not.
 */
export const pageSections = (page: BuiltPage): PageSection[] => {
	const seen = new Map<string, number>();
	return page.sections.map((section, index) => {
		const count = (seen.get(section.type) ?? 0) + 1;
		seen.set(section.type, count);
		const id = count === 1 ? section.type : `${section.type}/${count}`;
		return { id, key: sectionKey(page.slug, id), type: section.type, label: SECTION_LABELS[section.type] ?? section.type, index, section };
	});
};

export type ResolvedPublicationKey = { ok: true; target: PublicationTarget; label: string } | { ok: false; error: string };

/** Semantic check: the key names something the catalog actually generates. */
export const resolvePublicationKey = (key: unknown): ResolvedPublicationKey => {
	const target = parsePublicationKey(key);
	if (!target) return { ok: false, error: `Unknown publication key: ${typeof key === 'string' ? key : typeof key}` };
	switch (target.type) {
		case 'hub':
			return { ok: true, target, label: 'Marketing hub' };
		case 'social':
			return { ok: true, target, label: 'Social image suite' };
		case 'social-feature': {
			const feature = FEATURE_BY_KEY[target.feature];
			return feature ? { ok: true, target, label: `${feature.name} image set` } : { ok: false, error: `Unknown feature: ${target.feature}` };
		}
		case 'category': {
			const category = CATEGORY_BY_KEY[target.category];
			return category ? { ok: true, target, label: category.name } : { ok: false, error: `Unknown category: ${target.category}` };
		}
		case 'page': {
			const page = PAGE_BY_SLUG[target.slug];
			return page ? { ok: true, target, label: page.title } : { ok: false, error: `Unknown page: ${target.slug}` };
		}
		case 'section': {
			const page = buildPageBySlug(target.slug);
			if (!page) return { ok: false, error: `Unknown page: ${target.slug}` };
			const section = pageSections(page).find((entry) => entry.id === target.section);
			return section ? { ok: true, target, label: `${section.label} · ${page.title}` } : { ok: false, error: `Unknown section: ${target.slug}#${target.section}` };
		}
		default:
			return { ok: false, error: 'Unknown publication key' };
	}
};

export type ValidatedPublicationChanges = { ok: true; changes: PublicationChange[] } | { ok: false; error: string };

/**
 * Validates a request body's `changes`: every key must resolve against the
 * catalog, carry the one state its target allows (or null to clear), and the
 * list is capped + de-duplicated (last write per key wins).
 */
export const validatePublicationChanges = (raw: unknown): ValidatedPublicationChanges => {
	if (!Array.isArray(raw)) return { ok: false, error: 'changes must be an array' };
	if (raw.length === 0) return { ok: false, error: 'changes is empty' };
	if (raw.length > MAX_PUBLICATION_CHANGES) return { ok: false, error: `changes is capped at ${MAX_PUBLICATION_CHANGES} per request` };
	const byKey = new Map<string, PublicationChange>();
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') return { ok: false, error: 'each change must be an object' };
		const { key, state } = entry as { key?: unknown; state?: unknown };
		const resolved = resolvePublicationKey(key);
		if (resolved.ok === false) return { ok: false, error: resolved.error };
		if (state !== null && state !== 'published' && state !== 'hidden') return { ok: false, error: `state must be 'published', 'hidden' or null (${String(key)})` };
		const nextState = state as PublicationState | null;
		const allowed = allowedStateFor(resolved.target);
		if (nextState !== null && nextState !== allowed) return { ok: false, error: `${String(key)} only accepts state '${allowed}' or null` };
		byKey.set(key as string, { key: key as string, state: nextState });
	}
	return { ok: true, changes: [...byKey.values()] };
};

// ------------------------------------------------------------ visibility

export type MarketingVisibility = {
	/** Admins (not previewing) see every surface regardless of state. */
	everything: boolean;
	isAdmin: boolean;
	previewAsVisitor: boolean;
	/** False only on a true cold start with no cached or fetched publication state. */
	ready: boolean;
	publications: MarketingPublications;
	isPublished: (key: string) => boolean;
	isHidden: (key: string) => boolean;
	hub: boolean;
	social: boolean;
	socialFeature: (feature: string) => boolean;
	category: (category: string) => boolean;
	page: (slug: string) => boolean;
	section: (slug: string, sectionId: string) => boolean;
	pages: <T extends MarketingPage>(list: readonly T[]) => T[];
	features: (list: readonly Feature[]) => Feature[];
	/** For hrefs inside the suite: false when the target marketing surface is not visible. */
	href: (to: string) => boolean;
};

export const createVisibility = (input: { publications: MarketingPublications | null; isAdmin: boolean; previewAsVisitor: boolean }): MarketingVisibility => {
	const publications = input.publications ?? EMPTY_PUBLICATIONS;
	const everything = input.isAdmin && !input.previewAsVisitor;
	const published = new Set(publications.published);
	const hidden = new Set(publications.hidden);
	const isPublished = (key: string) => published.has(key);
	const isHidden = (key: string) => hidden.has(key);
	const see = (key: string) => everything || published.has(key);
	const page = (slug: string) => see(pageKey(slug));
	const category = (key: string) => see(categoryKey(key));
	const hub = see(HUB_KEY);
	const social = see(SOCIAL_KEY);
	const socialFeature = (feature: string) => see(socialFeatureKey(feature));
	const href = (to: string) => {
		if (to !== MARKETING_BASE && !to.startsWith(`${MARKETING_BASE}/`)) return true;
		const path = to.slice(MARKETING_BASE.length).replace(/^\//, '').split(/[?#]/)[0].replace(/\/+$/, '');
		if (!path) return hub;
		if (path === 'social-media') return social;
		if (path === 'search') return hub;
		if (CATEGORY_BY_KEY[path]) return category(path);
		if (PAGE_BY_SLUG[path]) return page(path);
		return true;
	};
	return {
		everything,
		isAdmin: input.isAdmin,
		previewAsVisitor: input.previewAsVisitor,
		ready: input.publications !== null || everything,
		publications,
		isPublished,
		isHidden,
		hub,
		social,
		socialFeature,
		category,
		page,
		section: (slug, sectionId) => page(slug) && (everything || !hidden.has(sectionKey(slug, sectionId))),
		pages: (list) => (everything ? [...list] : list.filter((entry) => published.has(pageKey(entry.slug)))),
		features: (list) => (everything ? [...list] : list.filter((feature) => published.has(socialFeatureKey(feature.key)))),
		href
	};
};

// --------------------------------------------------------------- summary

export type CategoryPublicationSummary = {
	key: string;
	name: string;
	emoji: string;
	indexPublished: boolean;
	total: number;
	published: number;
};

export type PublicationSummary = {
	hub: boolean;
	social: boolean;
	socialFeatures: { total: number; published: number };
	categories: CategoryPublicationSummary[];
	pages: { total: number; published: number };
	hiddenSections: number;
};

export const summarizePublications = (publications: MarketingPublications): PublicationSummary => {
	const published = new Set(publications.published);
	const categories = CATEGORIES.map((category) => {
		const pages = pagesInCategory(category.key);
		return {
			key: category.key,
			name: category.name,
			emoji: category.emoji,
			indexPublished: published.has(categoryKey(category.key)),
			total: pages.length,
			published: pages.filter((entry) => published.has(pageKey(entry.slug))).length
		};
	});
	return {
		hub: published.has(HUB_KEY),
		social: published.has(SOCIAL_KEY),
		socialFeatures: { total: FEATURES.length, published: FEATURES.filter((feature) => published.has(socialFeatureKey(feature.key))).length },
		categories,
		pages: { total: PAGES.length, published: categories.reduce((sum, category) => sum + category.published, 0) },
		hiddenSections: publications.hidden.length
	};
};

/** Bulk helpers: the page keys of one category, and every publishable (non-section) key. */
export const categoryPageKeys = (category: string): string[] => pagesInCategory(category).map((entry) => pageKey(entry.slug));

export const allPublishableKeys = (): string[] => [
	HUB_KEY,
	SOCIAL_KEY,
	...FEATURES.map((feature) => socialFeatureKey(feature.key)),
	...CATEGORIES.map((category) => categoryKey(category.key)),
	...PAGES.map((entry) => pageKey(entry.slug))
];

