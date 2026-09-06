// Shared types for the Thingtime marketing engine.
//
// The engine is data-driven: a small, curated set of source lists (features,
// personas, competitors, use cases, concepts, design trends, social formats)
// is combined by deterministic generators into 1000+ marketing pages and a
// social-image suite. Nothing here touches React or the DOM, so the whole
// catalog is unit-testable under node --test.

export type FeatureCategory =
	| 'core'
	| 'social'
	| 'builder'
	| 'developer'
	| 'ai'
	| 'data'
	| 'account'
	| 'apps'
	| 'design'
	| 'mobile'
	| 'admin';

export type PersonaKey =
	| 'creators'
	| 'developers'
	| 'teams'
	| 'families'
	| 'students'
	| 'founders'
	| 'designers'
	| 'power-users'
	| 'hobbyists'
	| 'small-business'
	| 'researchers'
	| 'educators';

export type Feature = {
	key: string;
	name: string;
	emoji: string;
	/** In-app route the page's primary CTA points at. */
	route: string;
	/** <= 12 words, benefit-first. */
	tagline: string;
	/** 1-2 factual sentences. */
	description: string;
	category: FeatureCategory;
	audiences: PersonaKey[];
	/** Three concrete capabilities used by landing bullets + guides. */
	highlights: [string, string, string];
	/** Mock screen a walkthrough of this feature plays on. */
	screen: MockScreenKey;
	/** Optional competitors this feature most directly answers. */
	answers?: string[];
};

export type Persona = {
	key: PersonaKey;
	name: string;
	emoji: string;
	/** "for developers" — used in slugs + titles. */
	label: string;
	pains: [string, string, string];
	gains: [string, string, string];
	/** Feature keys leading the persona hub. */
	leadFeatures: string[];
};

export type Competitor = {
	key: string;
	name: string;
	emoji: string;
	/** What it's best known for, phrased fairly. */
	knownFor: string;
	/** Where Thingtime differs — factual, no invented claims about them. */
	differences: [string, string, string];
	/** Their genuine strengths, acknowledged. */
	strengths: [string, string];
	/** Feature keys most relevant in a head-to-head. */
	relevantFeatures: string[];
	/** Rows for the comparison table: [axis, thingtime, competitor]. */
	table: [string, string, string][];
};

export type UseCase = {
	key: string;
	name: string;
	emoji: string;
	tagline: string;
	description: string;
	/** Ordered steps a how-to renders. */
	steps: [string, string, string, string];
	features: string[];
	audiences: PersonaKey[];
	/** A sample thing tree, shown as the "shape" of the use case. */
	sample: Record<string, unknown>;
};

export type Concept = {
	key: string;
	name: string;
	emoji: string;
	definition: string;
	why: string;
	related: string[];
};

export type Template = {
	key: string;
	name: string;
	emoji: string;
	summary: string;
	useCase: string;
	fields: string[];
};

export type TrendKey =
	| 'bold-brutal'
	| 'gradient-glow'
	| 'bento'
	| 'kinetic-type'
	| 'y2k-chrome'
	| 'dark-neon'
	| 'pastel-soft'
	| 'meme-caption'
	| 'mono-minimal'
	| 'sticker-collage'
	| 'listicle'
	| 'before-after';

export type Trend = {
	key: TrendKey;
	name: string;
	emoji: string;
	/** Where the look is currently viral. */
	platforms: string[];
	blurb: string;
	palette: {
		bg: string;
		bg2: string;
		ink: string;
		muted: string;
		accent: string;
		accent2: string;
		card: string;
	};
	font: string;
	/** Type weight for the hook headline. */
	weight: number;
	radius: number;
	border: number;
	shadow: 'hard' | 'soft' | 'glow' | 'none';
	/** Decorative motif rendered behind the copy. */
	motif: 'grid' | 'aurora' | 'stars' | 'stickers' | 'noise' | 'rings' | 'dots' | 'stripes' | 'none';
};

export type SocialFormat = {
	key: string;
	name: string;
	platform: string;
	emoji: string;
	width: number;
	height: number;
	/** Human size label e.g. "1080 × 1080". */
	label: string;
};

export type MockScreenKey =
	| 'feed'
	| 'things'
	| 'builder'
	| 'messages'
	| 'themes'
	| 'components'
	| 'settings'
	| 'developer'
	| 'search'
	| 'profile';

export type WalkthroughStep = {
	/** data-wt target inside the mock screen. */
	target: string;
	action: 'move' | 'click' | 'type' | 'scroll' | 'hover';
	/** Caption shown while the step runs. */
	label: string;
	/** Text typed for 'type' steps. */
	text?: string;
	/** Milliseconds the step holds after its motion finishes. */
	hold?: number;
};

export type Walkthrough = {
	key: string;
	title: string;
	screen: MockScreenKey;
	feature: string;
	intro: string;
	steps: WalkthroughStep[];
};

export type PageKind =
	| 'landing'
	| 'guide'
	| 'walkthrough'
	| 'compare'
	| 'feature-compare'
	| 'alternative'
	| 'persona'
	| 'persona-feature'
	| 'use-case'
	| 'use-case-compare'
	| 'concept'
	| 'template'
	| 'trend-landing'
	| 'faq'
	| 'checklist';

export type CatalogCategory = {
	key: string;
	name: string;
	emoji: string;
	blurb: string;
	kinds: PageKind[];
};

export type MarketingPage = {
	/** Full path under /marketing, e.g. "landing/feed". */
	slug: string;
	category: string;
	kind: PageKind;
	title: string;
	/** SEO description, 60-200 chars. */
	description: string;
	eyebrow: string;
	/** Resolved references for the renderer. */
	refs: {
		feature?: string;
		persona?: PersonaKey;
		competitor?: string;
		useCase?: string;
		concept?: string;
		template?: string;
		trend?: TrendKey;
		walkthrough?: string;
	};
	/** Related page slugs (up to 6). */
	related: string[];
};

export type SectionBlock =
	| { type: 'hero'; eyebrow: string; title: string; highlight?: string; body: string; cta: { label: string; to: string }; secondary?: { label: string; to: string }; badges?: string[] }
	| { type: 'bullets'; eyebrow: string; title: string; items: { emoji: string; title: string; body: string }[] }
	| { type: 'steps'; eyebrow: string; title: string; steps: { title: string; body: string }[] }
	| { type: 'table'; eyebrow: string; title: string; columns: [string, string, string]; rows: [string, string, string][] }
	| { type: 'quote'; text: string; by: string }
	| { type: 'stats'; items: { value: string; label: string }[] }
	| { type: 'faq'; eyebrow: string; title: string; items: { q: string; a: string }[] }
	| { type: 'sample'; eyebrow: string; title: string; body: string; sample: Record<string, unknown> }
	| { type: 'walkthrough'; walkthrough: string }
	| { type: 'social'; eyebrow: string; title: string; feature: string; trend: TrendKey }
	| { type: 'cta'; title: string; body: string; cta: { label: string; to: string }; secondary?: { label: string; to: string } }
	| { type: 'links'; eyebrow: string; title: string; links: { to: string; label: string; emoji: string }[] };

export type BuiltPage = MarketingPage & {
	/** Visual style the page renders in. */
	trend: TrendKey;
	sections: SectionBlock[];
};
