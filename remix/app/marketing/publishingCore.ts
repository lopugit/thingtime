import type { MarketingPage, SectionBlock } from './types';

// Catalog-FREE half of marketing publishing (see publishing.ts for the model
// and the catalog-aware validators/visibility). Everything the drawer, the
// shared client store and the server projection need without pulling the
// 1,600-page catalog into the eager root chunk: the key grammar, the wire
// shape, and the pure change application.

export type PublicationState = 'published' | 'hidden';

export type PublicationTarget =
	| { type: 'hub' }
	| { type: 'social' }
	| { type: 'social-feature'; feature: string }
	| { type: 'category'; category: string }
	| { type: 'page'; slug: string }
	| { type: 'section'; slug: string; section: string };

export type PublicationChange = { key: string; state: PublicationState | null };

export type PublicationAuditEntry = { at: string; by: string | null };

export type MarketingPublications = {
	published: string[];
	hidden: string[];
	updatedAt: string | null;
	/** Admin sessions only: who switched each key, and when. */
	audit?: Record<string, PublicationAuditEntry>;
};

export const EMPTY_PUBLICATIONS: MarketingPublications = { published: [], hidden: [], updatedAt: null };

/** One request may carry a whole "publish everything" sweep (≈1,700 keys today). */
export const MAX_PUBLICATION_CHANGES = 2000;
export const MAX_PUBLICATION_KEY_LENGTH = 240;

export const HUB_KEY = 'hub';
export const SOCIAL_KEY = 'social';
export const categoryKey = (category: string) => `category:${category}`;
export const pageKey = (slug: string) => `page:${slug}`;
export const socialFeatureKey = (feature: string) => `social:${feature}`;
export const sectionKey = (slug: string, sectionId: string) => `section:${slug}#${sectionId}`;

export const SECTION_LABELS: Record<SectionBlock['type'], string> = {
	hero: 'Hero',
	bullets: 'Highlights',
	steps: 'Steps',
	table: 'Table',
	quote: 'Quote',
	stats: 'Stats',
	faq: 'FAQ',
	sample: 'Sample tree',
	walkthrough: 'Walkthrough',
	social: 'Social images',
	cta: 'Call to action',
	links: 'Links'
};

const SECTION_ID_PATTERN = /^[a-z]+(?:\/[2-9]\d*)?$/;

/** Syntactic parse only — `resolvePublicationKey` (publishing.ts) checks the catalog. */
export const parsePublicationKey = (key: unknown): PublicationTarget | null => {
	if (typeof key !== 'string' || !key || key.length > MAX_PUBLICATION_KEY_LENGTH) return null;
	if (key === HUB_KEY) return { type: 'hub' };
	if (key === SOCIAL_KEY) return { type: 'social' };
	const colon = key.indexOf(':');
	if (colon <= 0) return null;
	const namespace = key.slice(0, colon);
	const rest = key.slice(colon + 1);
	if (!rest) return null;
	switch (namespace) {
		case 'social':
			return /^[a-z0-9-]+$/.test(rest) ? { type: 'social-feature', feature: rest } : null;
		case 'category':
			return /^[a-z0-9-]+$/.test(rest) ? { type: 'category', category: rest } : null;
		case 'page':
			return /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(rest) ? { type: 'page', slug: rest } : null;
		case 'section': {
			const hash = rest.indexOf('#');
			if (hash <= 0) return null;
			const slug = rest.slice(0, hash);
			const section = rest.slice(hash + 1);
			if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(slug) || !SECTION_ID_PATTERN.test(section)) return null;
			return { type: 'section', slug, section };
		}
		default:
			return null;
	}
};

/** Sections toggle between hidden and default; everything else between published and default. */
export const allowedStateFor = (target: PublicationTarget): PublicationState => (target.type === 'section' ? 'hidden' : 'published');

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_PUBLICATION_KEY_LENGTH) : [];

/** Tolerant wire → typed conversion (localStorage seeds and API payloads alike). */
export const normalizePublications = (raw: unknown): MarketingPublications => {
	if (!raw || typeof raw !== 'object') return { ...EMPTY_PUBLICATIONS };
	const value = raw as Record<string, unknown>;
	const result: MarketingPublications = {
		published: Array.from(new Set(stringList(value.published))),
		hidden: Array.from(new Set(stringList(value.hidden))),
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null
	};
	if (value.audit && typeof value.audit === 'object') {
		const audit: Record<string, PublicationAuditEntry> = {};
		for (const [key, entry] of Object.entries(value.audit as Record<string, unknown>)) {
			if (!entry || typeof entry !== 'object') continue;
			const { at, by } = entry as { at?: unknown; by?: unknown };
			if (typeof at !== 'string') continue;
			audit[key] = { at, by: typeof by === 'string' ? by : null };
		}
		result.audit = audit;
	}
	return result;
};

/** Pure client-side projection of a change list — the optimistic twin of the server write. */
export const applyPublicationChanges = (publications: MarketingPublications, changes: PublicationChange[]): MarketingPublications => {
	const published = new Set(publications.published);
	const hidden = new Set(publications.hidden);
	for (const change of changes) {
		published.delete(change.key);
		hidden.delete(change.key);
		if (change.state === 'published') published.add(change.key);
		if (change.state === 'hidden') hidden.add(change.key);
	}
	return { ...publications, published: [...published], hidden: [...hidden] };
};

export const changesFor = (keys: readonly string[], state: PublicationState | null): PublicationChange[] => keys.map((key) => ({ key, state }));

/** Membership helper for catalog-free consumers (the drawer): is this key switched on? */
export const isKeyPublished = (publications: MarketingPublications | null, key: string): boolean => !!publications && publications.published.includes(key);

export type { MarketingPage };
