import { COMPETITORS, getCompetitor } from './competitors';
import { CONCEPTS, CONCEPT_BY_KEY, TEMPLATES, TEMPLATE_BY_KEY } from './concepts';
import {
	compareHeadline,
	compareIntro,
	faqFor,
	hashString,
	highlightWord,
	hookFor,
	landingHeadline,
	lower,
	personaBenefit,
	personaHeadline,
	pick,
	pickMany,
	quoteFor,
	statsFor,
	trendHeadline,
	truncate,
	headlineForUseCase
} from './copy';
import { FEATURES, FEATURE_CATEGORY_LABELS, getFeature } from './features';
import { byKey } from './lookup';
import { PERSONAS, getPersona } from './personas';
import { SOCIAL_ASSET_COUNT } from './social';
import { TRENDS, getTrend } from './trends';
import type { BuiltPage, CatalogCategory, Feature, MarketingPage, PageKind, PersonaKey, SectionBlock, TrendKey } from './types';
import { getUseCase, USE_CASES } from './useCases';
import { SCREEN_TARGETS, WALKTHROUGHS, getWalkthrough } from './walkthroughs';

// The page catalog: enumerates every marketing page as light metadata
// (slug, title, description, refs) and builds a page's full section list on
// demand. Enumeration is cheap enough to run at module load (a few thousand
// small objects); building is per page.

export const MARKETING_BASE = '/marketing';

export const CATEGORIES: CatalogCategory[] = [
	{ key: 'landing', name: 'Feature pages', emoji: '🌈', blurb: 'One landing page per feature: the pitch, the proof, the CTA.', kinds: ['landing'] },
	{ key: 'guides', name: 'How-to guides', emoji: '📘', blurb: 'Step-by-step guides with an animated walkthrough on every page.', kinds: ['guide'] },
	{ key: 'walkthroughs', name: 'Animated walkthroughs', emoji: '🖱️', blurb: 'Click-and-cursor tours over a mock of the real UI.', kinds: ['walkthrough'] },
	{ key: 'compare', name: 'Comparisons', emoji: '⚖️', blurb: 'Thingtime versus the tools you already use, fairly.', kinds: ['compare', 'feature-compare', 'alternative'] },
	{ key: 'for', name: 'For every audience', emoji: '🎯', blurb: 'Creators, developers, families, teams and more.', kinds: ['persona', 'persona-feature'] },
	{ key: 'use-cases', name: 'Use cases', emoji: '🧰', blurb: 'Real things people keep, with the shape and the steps.', kinds: ['use-case', 'use-case-compare'] },
	{ key: 'concepts', name: 'Concepts', emoji: '🧠', blurb: 'The vocabulary: things, kinds, branches, audiences.', kinds: ['concept'] },
	{ key: 'templates', name: 'Templates', emoji: '🧬', blurb: 'Starter shapes you can copy on day one.', kinds: ['template'] },
	{ key: 'styles', name: 'Style editions', emoji: '🎨', blurb: 'Feature pages re-cut in twelve viral visual trends.', kinds: ['trend-landing'] },
	{ key: 'faq', name: 'FAQ pages', emoji: '❓', blurb: 'The questions people ask about each feature.', kinds: ['faq'] },
	{ key: 'checklists', name: 'Checklists', emoji: '✅', blurb: 'Getting-started checklists per audience.', kinds: ['checklist'] }
];

export const CATEGORY_BY_KEY: Record<string, CatalogCategory> = byKey(CATEGORIES, (category) => category.key);

const TREND_FOR_KIND: Record<PageKind, TrendKey> = {
	landing: 'bold-brutal',
	guide: 'bold-brutal',
	walkthrough: 'bold-brutal',
	compare: 'mono-minimal',
	'feature-compare': 'mono-minimal',
	alternative: 'mono-minimal',
	persona: 'bento',
	'persona-feature': 'bento',
	'use-case': 'pastel-soft',
	'use-case-compare': 'pastel-soft',
	concept: 'dark-neon',
	template: 'sticker-collage',
	'trend-landing': 'bold-brutal',
	faq: 'bold-brutal',
	checklist: 'bento'
};

// The features that get a page in every one of the twelve styles: the
// union of every persona's lead features (the ones people ask about).
export const STYLE_FEATURE_KEYS: string[] = Array.from(new Set(PERSONAS.flatMap((persona) => persona.leadFeatures)));

const describe = (text: string) => truncate(text.replace(/\s+/g, ' ').trim(), 200);

const page = (input: Omit<MarketingPage, 'related'> & { related?: string[] }): MarketingPage => ({ ...input, related: input.related ?? [] });

// A feature's persona pages cover its declared audiences plus every persona
// that leads with it, so persona hubs never link to a missing page.
export const personaAudiencesFor = (feature: Feature): PersonaKey[] =>
	Array.from(new Set<PersonaKey>([...feature.audiences, ...PERSONAS.filter((persona) => persona.leadFeatures.includes(feature.key)).map((persona) => persona.key)]));

// A competitor's feature-comparison pages cover its declared relevant
// features plus every feature that names it in `answers`, so feature pages
// never link to a missing comparison.
export const compareFeatureKeysFor = (competitorKey: string): string[] =>
	Array.from(new Set([...getCompetitor(competitorKey).relevantFeatures, ...FEATURES.filter((feature) => (feature.answers ?? []).includes(competitorKey)).map((feature) => feature.key)]));

const featureBase = (feature: Feature) => ({
	landing: `landing/${feature.key}`,
	guide: `guides/${feature.key}`,
	walkthrough: `walkthroughs/feature-${feature.key}`,
	faq: `faq/${feature.key}`
});

export const enumeratePages = (): MarketingPage[] => {
	const pages: MarketingPage[] = [];

	for (const feature of FEATURES) {
		const base = featureBase(feature);
		const audiences = personaAudiencesFor(feature);
		const personaSlugs = audiences.map((audience) => `for/${audience}/${feature.key}`);
		pages.push(
			page({
				slug: base.landing,
				category: 'landing',
				kind: 'landing',
				title: `${feature.name} — ${feature.tagline.replace(/\.$/, '')}`,
				description: describe(feature.description),
				eyebrow: `${FEATURE_CATEGORY_LABELS[feature.category].emoji} ${FEATURE_CATEGORY_LABELS[feature.category].name} · Thingtime`,
				refs: { feature: feature.key },
				related: [base.guide, base.walkthrough, base.faq, ...personaSlugs.slice(0, 3)]
			}),
			page({
				slug: base.guide,
				category: 'guides',
				kind: 'guide',
				title: `How to use ${feature.name} in Thingtime`,
				description: describe(`A step-by-step guide to ${lower(feature.name)}: ${lower(feature.highlights[0])}, ${lower(feature.highlights[1])} and ${lower(feature.highlights[2])}.`),
				eyebrow: '📘 How-to guide',
				refs: { feature: feature.key, walkthrough: `feature-${feature.key}` },
				related: [base.landing, base.walkthrough, base.faq]
			}),
			page({
				slug: base.faq,
				category: 'faq',
				kind: 'faq',
				title: `${feature.name}: frequently asked questions`,
				description: describe(`Answers about ${lower(feature.name)} in Thingtime: what it is, where to find it, whether your data is yours and how to use it from the API.`),
				eyebrow: '❓ FAQ',
				refs: { feature: feature.key },
				related: [base.landing, base.guide]
			})
		);
		for (const audience of audiences) {
			const persona = getPersona(audience);
			pages.push(
				page({
					slug: `for/${audience}/${feature.key}`,
					category: 'for',
					kind: 'persona-feature',
					title: `${feature.name} ${persona.label}`,
					description: describe(`${feature.tagline} How ${lower(persona.name)} use ${lower(feature.name)} in Thingtime, and why it beats ${lower(persona.pains[0])}.`),
					eyebrow: `${persona.emoji} ${persona.name}`,
					refs: { feature: feature.key, persona: audience },
					related: [`for/${audience}`, base.landing, base.guide]
				})
			);
		}
	}

	for (const walkthrough of WALKTHROUGHS) {
		const feature = getFeature(walkthrough.feature);
		pages.push(
			page({
				slug: `walkthroughs/${walkthrough.key}`,
				category: 'walkthroughs',
				kind: 'walkthrough',
				title: walkthrough.title,
				description: describe(`${walkthrough.intro} An animated cursor plays ${walkthrough.steps.length} steps over a mock of the ${walkthrough.screen} screen.`),
				eyebrow: '🖱️ Animated walkthrough',
				refs: { feature: feature.key, walkthrough: walkthrough.key },
				related: [featureBase(feature).landing, featureBase(feature).guide]
			})
		);
	}

	for (const competitor of COMPETITORS) {
		const vs = `compare/thingtime-vs-${competitor.key}`;
		pages.push(
			page({
				slug: vs,
				category: 'compare',
				kind: 'compare',
				title: `Thingtime vs ${competitor.name}`,
				description: describe(`${competitor.name} is known for ${competitor.knownFor}. See how Thingtime differs on data model, API, sharing, theming and ownership, side by side.`),
				eyebrow: `⚖️ ${competitor.emoji} Comparison`,
				refs: { competitor: competitor.key },
				related: [`compare/${competitor.key}-alternative`, ...competitor.relevantFeatures.slice(0, 3).map((key) => `compare/${key}-vs-${competitor.key}`)]
			}),
			page({
				slug: `compare/${competitor.key}-alternative`,
				category: 'compare',
				kind: 'alternative',
				title: `The open source ${competitor.name} alternative`,
				description: describe(`Looking for a ${competitor.name} alternative? Thingtime keeps everything as things you own, with an open API, a social layer and per-branch sharing. Free while in beta.`),
				eyebrow: `🔁 ${competitor.emoji} Alternative`,
				refs: { competitor: competitor.key },
				related: [vs, ...competitor.relevantFeatures.slice(0, 2).map((key) => `landing/${key}`)]
			})
		);
		for (const featureKey of compareFeatureKeysFor(competitor.key)) {
			const feature = getFeature(featureKey);
			pages.push(
				page({
					slug: `compare/${featureKey}-vs-${competitor.key}`,
					category: 'compare',
					kind: 'feature-compare',
					title: `${feature.name}: Thingtime vs ${competitor.name}`,
					description: describe(`${feature.tagline} How ${lower(feature.name)} in Thingtime compares with ${competitor.name}, feature by feature and fairly.`),
					eyebrow: `⚖️ ${feature.emoji} vs ${competitor.emoji}`,
					refs: { feature: featureKey, competitor: competitor.key },
					related: [vs, `landing/${featureKey}`, `guides/${featureKey}`]
				})
			);
		}
	}

	for (const persona of PERSONAS) {
		pages.push(
			page({
				slug: `for/${persona.key}`,
				category: 'for',
				kind: 'persona',
				title: `Thingtime ${persona.label}`,
				description: describe(`${persona.gains[0]}. ${persona.gains[1]}. Why ${lower(persona.name)} keep their things in Thingtime.`),
				eyebrow: `${persona.emoji} ${persona.name}`,
				refs: { persona: persona.key },
				related: [...persona.leadFeatures.slice(0, 4).map((key) => `for/${persona.key}/${key}`), `checklists/${persona.key}-getting-started`]
			}),
			page({
				slug: `checklists/${persona.key}-getting-started`,
				category: 'checklists',
				kind: 'checklist',
				title: `Getting started checklist ${persona.label}`,
				description: describe(`A short checklist to set up Thingtime ${persona.label}: the first things to create, share and switch on.`),
				eyebrow: `✅ ${persona.emoji} Checklist`,
				refs: { persona: persona.key },
				related: [`for/${persona.key}`, ...persona.leadFeatures.slice(0, 2).map((key) => `guides/${key}`)]
			})
		);
	}

	for (const useCase of USE_CASES) {
		const base = `use-cases/${useCase.key}`;
		const competitors = COMPETITORS.filter((competitor) => competitor.relevantFeatures.some((key) => useCase.features.includes(key))).slice(0, 3);
		pages.push(
			page({
				slug: base,
				category: 'use-cases',
				kind: 'use-case',
				title: `${useCase.name} in Thingtime`,
				description: describe(`${useCase.tagline} ${useCase.description}`),
				eyebrow: `${useCase.emoji} Use case`,
				refs: { useCase: useCase.key, walkthrough: `use-case-${useCase.key}` },
				related: [`walkthroughs/use-case-${useCase.key}`, ...useCase.features.slice(0, 2).map((key) => `landing/${key}`), ...competitors.slice(0, 2).map((competitor) => `${base}/vs-${competitor.key}`)]
			})
		);
		for (const competitor of competitors) {
			pages.push(
				page({
					slug: `${base}/vs-${competitor.key}`,
					category: 'use-cases',
					kind: 'use-case-compare',
					title: `${useCase.name}: Thingtime vs ${competitor.name}`,
					description: describe(`Keeping a ${lower(useCase.name)}: how Thingtime’s things, sharing and API compare with ${competitor.name} for this exact job.`),
					eyebrow: `${useCase.emoji} vs ${competitor.emoji}`,
					refs: { useCase: useCase.key, competitor: competitor.key },
					related: [base, `compare/thingtime-vs-${competitor.key}`]
				})
			);
		}
	}

	for (const concept of CONCEPTS) {
		pages.push(
			page({
				slug: `concepts/${concept.key}`,
				category: 'concepts',
				kind: 'concept',
				title: `What is a ${lower(concept.name)} in Thingtime?`,
				description: describe(`${concept.definition} ${concept.why}`),
				eyebrow: `${concept.emoji} Concept`,
				refs: { concept: concept.key },
				related: concept.related.filter((key) => CONCEPT_BY_KEY[key]).map((key) => `concepts/${key}`)
			})
		);
	}

	for (const template of TEMPLATES) {
		pages.push(
			page({
				slug: `templates/${template.key}`,
				category: 'templates',
				kind: 'template',
				title: `${template.name} template`,
				description: describe(`A starter ${lower(template.name)} thing for Thingtime: ${template.summary} Copy the shape, fill it in, share the branch.`),
				eyebrow: `${template.emoji} Template`,
				refs: { template: template.key, useCase: template.useCase },
				related: [`use-cases/${template.useCase}`, `walkthroughs/use-case-${template.useCase}`]
			})
		);
	}

	for (const trend of TRENDS) {
		for (const featureKey of STYLE_FEATURE_KEYS) {
			const feature = getFeature(featureKey);
			pages.push(
				page({
					slug: `styles/${trend.key}/${featureKey}`,
					category: 'styles',
					kind: 'trend-landing',
					title: `${feature.name} — ${trend.name} edition`,
					description: describe(`${feature.tagline} The ${lower(feature.name)} pitch re-cut in the ${lower(trend.name)} look: ${trend.blurb}`),
					eyebrow: `${trend.emoji} ${trend.name} · ${trend.platforms.join(' · ')}`,
					refs: { feature: featureKey, trend: trend.key },
					related: [`landing/${featureKey}`, ...pickMany(`${trend.key}:${featureKey}`, TRENDS, 3).map((other) => `styles/${other.key}/${featureKey}`)]
				})
			);
		}
	}

	return pages;
};

export const PAGES: MarketingPage[] = enumeratePages();
export const PAGE_BY_SLUG: Record<string, MarketingPage> = byKey(PAGES, (entry) => entry.slug);
export const PAGE_COUNT = PAGES.length;
export const TOTAL_ASSET_COUNT = PAGE_COUNT + SOCIAL_ASSET_COUNT;

export const pagesInCategory = (category: string) => PAGES.filter((entry) => entry.category === category);

export const categoryCounts = (): Record<string, number> => {
	const counts: Record<string, number> = {};
	for (const entry of PAGES) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
	return counts;
};

export const pageHref = (slug: string) => `${MARKETING_BASE}/${slug}`;

// --------------------------------------------------------- builders
const ctaFor = (feature: Feature) => ({ label: `Open ${feature.name}`, to: feature.route });
const registerCta = { label: 'Try Thingtime free', to: '/register' };
const docsCta = { label: 'Read the docs', to: '/docs' };

const featureLinks = (feature: Feature): SectionBlock => ({
	type: 'links',
	eyebrow: 'Keep exploring',
	title: `More on ${feature.name}`,
	links: [
		{ to: pageHref(`guides/${feature.key}`), label: 'How-to guide', emoji: '📘' },
		{ to: pageHref(`walkthroughs/feature-${feature.key}`), label: 'Animated walkthrough', emoji: '🖱️' },
		{ to: pageHref(`faq/${feature.key}`), label: 'FAQ', emoji: '❓' },
		...personaAudiencesFor(feature).slice(0, 3).map((audience) => ({ to: pageHref(`for/${audience}/${feature.key}`), label: `${feature.name} ${getPersona(audience).label}`, emoji: getPersona(audience).emoji })),
		...(feature.answers ?? []).slice(0, 2).map((key) => ({ to: pageHref(`compare/${feature.key}-vs-${key}`), label: `vs ${getCompetitor(key).name}`, emoji: '⚖️' }))
	]
});

const bulletsFor = (feature: Feature, seed: string): SectionBlock => ({
	type: 'bullets',
	eyebrow: 'What you get',
	title: pick(seed, ['Three things it does', 'Why people switch', 'The short version', 'Built for this']),
	items: feature.highlights.map((highlight, index) => ({
		emoji: [feature.emoji, '✨', '🌈'][index],
		title: highlight,
		body: pick(`${seed}:${index}`, [
			'It works the same on web, iOS and the API, because the UI is just another client.',
			'Every change is a thing you own: exportable, linkable and shareable per branch.',
			'No spinner when there is something to show: the last known state paints instantly.',
			'Same permissions as everything else: private by default, shared on your terms.',
			'Documented from the same registry the routes are built from, so it cannot drift.'
		])
	}))
});

const socialBlock = (feature: Feature, seed: string): SectionBlock => ({
	type: 'social',
	eyebrow: 'Share it',
	title: 'Ready-made social posts for this feature',
	feature: feature.key,
	trend: pick(seed, TRENDS).key
});

const buildLanding = (entry: MarketingPage, feature: Feature, trend: TrendKey): SectionBlock[] => {
	const seed = entry.slug;
	const headline = trend === 'bold-brutal' ? landingHeadline(feature, seed) : trendHeadline(getTrend(trend), feature, seed);
	return [
		{
			type: 'hero',
			eyebrow: entry.eyebrow,
			title: headline,
			highlight: highlightWord(headline, seed),
			body: feature.description,
			cta: ctaFor(feature),
			secondary: registerCta,
			badges: ['🌐 Web', '📱 iOS', '🔌 API', '🦄 No ads']
		},
		bulletsFor(feature, seed),
		{ type: 'stats', items: statsFor(seed) },
		{ type: 'walkthrough', walkthrough: `feature-${feature.key}` },
		{ type: 'quote', ...quoteFor(seed) },
		socialBlock(feature, seed),
		{ type: 'faq', eyebrow: 'Questions', title: `${feature.name}, answered`, items: faqFor(feature, seed) },
		featureLinks(feature),
		{ type: 'cta', title: pick(`${seed}:cta`, ['Start with one thing.', 'Yours, not rented.', 'Free while in beta.', 'Make it a thing.']), body: `${feature.tagline} It takes a minute, and nothing you make is lost when you register.`, cta: ctaFor(feature), secondary: registerCta }
	];
};

const buildGuide = (entry: MarketingPage, feature: Feature): SectionBlock[] => {
	const seed = entry.slug;
	const walkthrough = getWalkthrough(`feature-${feature.key}`);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `How to use ${feature.name}`, highlight: feature.name, body: `${feature.description} This guide walks through it in ${walkthrough.steps.length} steps, with the cursor doing the moves.`, cta: ctaFor(feature), secondary: docsCta },
		{
			type: 'steps',
			eyebrow: 'Step by step',
			title: `${walkthrough.steps.length} moves, start to finish`,
			steps: walkthrough.steps.map((step, index) => ({
				title: `${index + 1}. ${step.label}`,
				body:
					step.action === 'type'
						? `Type “${step.text}”. ${pick(`${seed}:${index}`, ['Edits save as you go.', 'It becomes a thing immediately.', 'Nothing to submit; it is already yours.'])}`
						: step.action === 'click'
							? pick(`${seed}:${index}`, ['One click, applied optimistically.', 'Tap it on mobile, click it on web.', 'Same control on every surface.'])
							: pick(`${seed}:${index}`, ['Hover to reveal the control.', 'Look here first.', 'This is where the magic sits.'])
			}))
		},
		{ type: 'walkthrough', walkthrough: walkthrough.key },
		bulletsFor(feature, seed),
		{ type: 'faq', eyebrow: 'Stuck?', title: 'Common questions', items: faqFor(feature, seed) },
		featureLinks(feature),
		{ type: 'cta', title: 'Now do it for real.', body: `Open ${feature.name} in the app and follow the same moves.`, cta: ctaFor(feature), secondary: registerCta }
	];
};

const buildWalkthrough = (entry: MarketingPage, feature: Feature): SectionBlock[] => {
	const walkthrough = getWalkthrough(entry.refs.walkthrough!);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: walkthrough.title, highlight: feature.name, body: walkthrough.intro, cta: ctaFor(feature), secondary: { label: 'Read the guide', to: pageHref(`guides/${feature.key}`) } },
		{ type: 'walkthrough', walkthrough: walkthrough.key },
		{ type: 'steps', eyebrow: 'The moves', title: 'What the cursor is doing', steps: walkthrough.steps.map((step, index) => ({ title: `${index + 1}. ${step.label}`, body: `${step.action === 'type' ? `Types “${step.text}” into` : step.action === 'click' ? 'Clicks' : step.action === 'hover' ? 'Hovers' : 'Scrolls to'} the ${step.target.replace(/-/g, ' ')} control.` })) },
		featureLinks(feature),
		{ type: 'cta', title: 'Try the real thing.', body: 'The mock is a mock. The app is one click away.', cta: ctaFor(feature), secondary: registerCta }
	];
};

const buildCompare = (entry: MarketingPage): SectionBlock[] => {
	const competitor = getCompetitor(entry.refs.competitor!);
	const seed = entry.slug;
	const features = compareFeatureKeysFor(competitor.key).map(getFeature);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: entry.kind === 'alternative' ? `The open source ${competitor.name} alternative` : compareHeadline(competitor, seed), highlight: competitor.name, body: compareIntro(competitor), cta: registerCta, secondary: docsCta, badges: ['🐙 Open source', '🔌 One API', '🦄 No ads', '🏡 Self-hostable'] },
		{ type: 'table', eyebrow: 'Side by side', title: `Thingtime vs ${competitor.name}`, columns: ['', 'Thingtime', competitor.name], rows: competitor.table },
		{ type: 'bullets', eyebrow: 'Where they differ', title: 'Three real differences', items: competitor.differences.map((difference, index) => ({ emoji: ['🌳', '🔐', '🐙'][index], title: truncate(difference, 60), body: difference })) },
		{ type: 'bullets', eyebrow: 'Credit where due', title: `What ${competitor.name} does well`, items: competitor.strengths.map((strength) => ({ emoji: competitor.emoji, title: strength, body: `If this is the thing you need most, ${competitor.name} may still be the right call. Thingtime is for people who want their things, their API and their audience in one place.` })) },
		{ type: 'links', eyebrow: 'Feature by feature', title: `Thingtime features ${competitor.name} users ask about`, links: features.map((feature) => ({ to: pageHref(`compare/${feature.key}-vs-${competitor.key}`), label: `${feature.name} vs ${competitor.name}`, emoji: feature.emoji })) },
		{ type: 'faq', eyebrow: 'Switching', title: 'Moving over', items: [
			{ q: `Can I import from ${competitor.name}?`, a: 'Anything you can export as JSON or CSV can be turned into things through the API or pasted into the tree. Everything is a thing, so there is no schema to fight.' },
			{ q: 'Will my data be locked in?', a: 'No. Thingtime is open source and your things are exportable through the same API the app uses.' },
			{ q: 'Is Thingtime free?', a: 'Free while in beta, with fair quotas. You can also self-host.' },
			{ q: 'What about my audience?', a: 'Posts, comments and reactions are things you own; a feed, profiles and RSS come built in.' }
		] },
		{ type: 'cta', title: `Try Thingtime next to ${competitor.name}.`, body: 'Keep both for a week. Nothing to migrate until you want to.', cta: registerCta, secondary: { label: `See every comparison`, to: `${MARKETING_BASE}/compare` } }
	];
};

const buildFeatureCompare = (entry: MarketingPage): SectionBlock[] => {
	const feature = getFeature(entry.refs.feature!);
	const competitor = getCompetitor(entry.refs.competitor!);
	const seed = entry.slug;
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `${feature.name}: Thingtime vs ${competitor.name}`, highlight: feature.name, body: `${feature.description} ${competitor.name} is known for ${competitor.knownFor}; here is how the two approach ${lower(feature.name)}.`, cta: ctaFor(feature), secondary: { label: `Full ${competitor.name} comparison`, to: pageHref(`compare/thingtime-vs-${competitor.key}`) } },
		{ type: 'table', eyebrow: 'Side by side', title: `${feature.name}, compared`, columns: ['', 'Thingtime', competitor.name], rows: [
			...feature.highlights.map((highlight): [string, string, string] => [truncate(highlight, 34), '✓ ' + highlight, pick(`${seed}:${highlight}`, ['Different model', 'Partial', 'Plan dependent', 'Not the focus'])]),
			...competitor.table.slice(0, 3)
		] },
		bulletsFor(feature, seed),
		{ type: 'walkthrough', walkthrough: `feature-${feature.key}` },
		{ type: 'faq', eyebrow: 'Questions', title: 'Switching this workflow', items: faqFor(feature, seed) },
		featureLinks(feature),
		{ type: 'cta', title: 'See it, not a table.', body: `Open ${feature.name} and compare for yourself.`, cta: ctaFor(feature), secondary: registerCta }
	];
};

const buildPersona = (entry: MarketingPage): SectionBlock[] => {
	const persona = getPersona(entry.refs.persona!);
	const seed = entry.slug;
	const features = persona.leadFeatures.map(getFeature);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `Thingtime ${persona.label}`, highlight: persona.name, body: `${persona.gains[0]}. ${persona.gains[1]}. ${persona.gains[2]}.`, cta: registerCta, secondary: { label: 'Getting-started checklist', to: pageHref(`checklists/${persona.key}-getting-started`) }, badges: ['🌐 Web', '📱 iOS', '🔌 API', '🦄 No ads'] },
		{ type: 'bullets', eyebrow: 'Sound familiar?', title: `Three things ${lower(persona.name)} are tired of`, items: persona.pains.map((pain, index) => ({ emoji: ['😩', '🙃', '😮‍💨'][index], title: pain, body: persona.gains[index] })) },
		{ type: 'links', eyebrow: 'Made for you', title: `The features ${lower(persona.name)} reach for first`, links: features.map((feature) => ({ to: pageHref(`for/${persona.key}/${feature.key}`), label: `${feature.name} ${persona.label}`, emoji: feature.emoji })) },
		{ type: 'stats', items: statsFor(seed) },
		{ type: 'walkthrough', walkthrough: `feature-${features[0].key}` },
		{ type: 'quote', ...quoteFor(seed) },
		{ type: 'links', eyebrow: 'Use cases', title: `Things ${lower(persona.name)} keep`, links: USE_CASES.filter((useCase) => useCase.audiences.includes(persona.key)).slice(0, 6).map((useCase) => ({ to: pageHref(`use-cases/${useCase.key}`), label: useCase.name, emoji: useCase.emoji })) },
		{ type: 'cta', title: `Make your first thing.`, body: `Thingtime ${persona.label} starts with one thing. Register when it matters.`, cta: registerCta, secondary: docsCta }
	];
};

const buildPersonaFeature = (entry: MarketingPage): SectionBlock[] => {
	const persona = getPersona(entry.refs.persona!);
	const feature = getFeature(entry.refs.feature!);
	const seed = entry.slug;
	const headline = personaHeadline(persona, feature, seed);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: headline, highlight: highlightWord(headline, seed), body: personaBenefit(persona, feature, seed), cta: ctaFor(feature), secondary: { label: `Thingtime ${persona.label}`, to: pageHref(`for/${persona.key}`) } },
		{ type: 'bullets', eyebrow: `${persona.emoji} ${persona.name}`, title: `Why ${lower(persona.name)} pick ${feature.name}`, items: feature.highlights.map((highlight, index) => ({ emoji: [feature.emoji, persona.emoji, '🌈'][index], title: highlight, body: `${persona.gains[index]}.` })) },
		{ type: 'walkthrough', walkthrough: `feature-${feature.key}` },
		{ type: 'links', eyebrow: 'Use cases', title: `${feature.name} in practice`, links: USE_CASES.filter((useCase) => useCase.features.includes(feature.key) || useCase.audiences.includes(persona.key)).slice(0, 6).map((useCase) => ({ to: pageHref(`use-cases/${useCase.key}`), label: useCase.name, emoji: useCase.emoji })) },
		{ type: 'faq', eyebrow: 'Questions', title: `${feature.name} ${persona.label}, answered`, items: faqFor(feature, seed) },
		featureLinks(feature),
		{ type: 'cta', title: pick(`${seed}:cta`, ['Start here.', 'One thing at a time.', 'It is yours.']), body: `${feature.tagline} ${persona.gains[0]}.`, cta: ctaFor(feature), secondary: registerCta }
	];
};

const buildUseCase = (entry: MarketingPage): SectionBlock[] => {
	const useCase = getUseCase(entry.refs.useCase!);
	const seed = entry.slug;
	const features = useCase.features.map(getFeature);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: headlineForUseCase(useCase, seed), highlight: useCase.name, body: useCase.description, cta: registerCta, secondary: { label: 'Watch the tour', to: pageHref(`walkthroughs/use-case-${useCase.key}`) } },
		{ type: 'sample', eyebrow: 'The shape', title: 'What it looks like as a thing', body: 'A thing is just structure. This is the whole model: nested keys you can fold, edit inline and share by branch.', sample: useCase.sample },
		{ type: 'steps', eyebrow: 'How to', title: 'Four steps', steps: useCase.steps.map((step, index) => ({ title: `${index + 1}. ${truncate(step, 48)}`, body: step })) },
		{ type: 'walkthrough', walkthrough: `use-case-${useCase.key}` },
		{ type: 'links', eyebrow: 'Features used', title: 'What makes it work', links: features.map((feature) => ({ to: pageHref(`landing/${feature.key}`), label: feature.name, emoji: feature.emoji })) },
		{ type: 'faq', eyebrow: 'Questions', title: 'Before you start', items: faqFor(features[0], seed) },
		{ type: 'cta', title: `Keep your ${lower(useCase.name)} here.`, body: `${useCase.tagline} Start with the template and fill it in.`, cta: { label: 'Copy the template', to: pageHref(`templates/${TEMPLATES.find((template) => template.useCase === useCase.key)?.key ?? TEMPLATES[0].key}`) }, secondary: registerCta }
	];
};

const buildUseCaseCompare = (entry: MarketingPage): SectionBlock[] => {
	const useCase = getUseCase(entry.refs.useCase!);
	const competitor = getCompetitor(entry.refs.competitor!);
	const seed = entry.slug;
	const features = useCase.features.map(getFeature);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `${useCase.name}: Thingtime vs ${competitor.name}`, highlight: useCase.name, body: `${useCase.description} ${competitor.name} is known for ${competitor.knownFor}; here is how each handles this exact job.`, cta: registerCta, secondary: { label: `Thingtime vs ${competitor.name}`, to: pageHref(`compare/thingtime-vs-${competitor.key}`) } },
		{ type: 'table', eyebrow: 'For this job', title: `${useCase.name}, compared`, columns: ['', 'Thingtime', competitor.name], rows: [
			...features.slice(0, 3).map((feature): [string, string, string] => [feature.name, '✓ ' + feature.highlights[0], pick(`${seed}:${feature.key}`, ['Different model', 'Workaround', 'Plan dependent', 'Not the focus'])]),
			...competitor.table.slice(0, 2)
		] },
		{ type: 'sample', eyebrow: 'The shape', title: 'In Thingtime it is one thing', body: 'No tables to design, no blocks to nest: the structure is the data.', sample: useCase.sample },
		{ type: 'steps', eyebrow: 'How to', title: 'Four steps in Thingtime', steps: useCase.steps.map((step, index) => ({ title: `${index + 1}. ${truncate(step, 48)}`, body: step })) },
		{ type: 'links', eyebrow: 'Read more', title: 'Related pages', links: [{ to: pageHref(`use-cases/${useCase.key}`), label: `${useCase.name} in Thingtime`, emoji: useCase.emoji }, { to: pageHref(`compare/${competitor.key}-alternative`), label: `${competitor.name} alternative`, emoji: '🔁' }, ...features.slice(0, 2).map((feature) => ({ to: pageHref(`landing/${feature.key}`), label: feature.name, emoji: feature.emoji }))] },
		{ type: 'cta', title: 'Try it with real data.', body: `Keep your ${lower(useCase.name)} in both for a week and see which one you open.`, cta: registerCta, secondary: docsCta }
	];
};

const buildConcept = (entry: MarketingPage): SectionBlock[] => {
	const concept = CONCEPT_BY_KEY[entry.refs.concept!];
	const related = concept.related.filter((key) => CONCEPT_BY_KEY[key]).map((key) => CONCEPT_BY_KEY[key]);
	const feature = FEATURES.find((candidate) => candidate.key === concept.key) ?? pick(entry.slug, FEATURES.filter((candidate) => candidate.category === 'core' || candidate.category === 'data'));
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `${concept.emoji} ${concept.name}`, highlight: concept.name, body: concept.definition, cta: { label: 'See it in the app', to: feature.route }, secondary: docsCta },
		{ type: 'bullets', eyebrow: 'Why it matters', title: 'The point of it', items: [
			{ emoji: '🎯', title: 'Why', body: concept.why },
			{ emoji: '📦', title: 'Where it lives', body: `Every ${lower(concept.name)} is part of the everything-is-a-thing model: one collection, one permission model, one API.` },
			{ emoji: '🔌', title: 'From the API', body: 'Whatever the UI shows you is readable and writable through /api/v1 with the same rules.' }
		] },
		{ type: 'links', eyebrow: 'Related concepts', title: 'Read next', links: related.map((other) => ({ to: pageHref(`concepts/${other.key}`), label: other.name, emoji: other.emoji })) },
		{ type: 'quote', ...quoteFor(entry.slug) },
		{ type: 'cta', title: 'Enough theory.', body: 'Make one thing and the concept explains itself.', cta: registerCta, secondary: { label: 'All concepts', to: `${MARKETING_BASE}/concepts` } }
	];
};

const buildTemplate = (entry: MarketingPage): SectionBlock[] => {
	const template = TEMPLATE_BY_KEY[entry.refs.template!];
	const useCase = getUseCase(template.useCase);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `${template.emoji} ${template.name} template`, highlight: template.name, body: `${template.summary} A starter shape for ${lower(useCase.name)}: copy it, fill it in, share the branch with whoever needs it.`, cta: { label: 'Open the tree', to: '/things' }, secondary: { label: 'The use case', to: pageHref(`use-cases/${useCase.key}`) } },
		{ type: 'sample', eyebrow: 'The shape', title: 'Fields', body: 'Arrays end in [], maps end in {}. Everything else is a value you can edit inline.', sample: Object.fromEntries(template.fields.map((field) => [field.replace(/\[\]|\{\}/g, ''), field.endsWith('[]') ? [] : field.endsWith('{}') ? {} : '…'])) },
		{ type: 'sample', eyebrow: 'Filled in', title: 'An example', body: 'This is what the same shape looks like with real values.', sample: useCase.sample },
		{ type: 'steps', eyebrow: 'Use it', title: 'Four steps', steps: useCase.steps.map((step, index) => ({ title: `${index + 1}. ${truncate(step, 48)}`, body: step })) },
		{ type: 'links', eyebrow: 'More templates', title: 'Similar shapes', links: pickMany(entry.slug, TEMPLATES.filter((other) => other.key !== template.key), 6).map((other) => ({ to: pageHref(`templates/${other.key}`), label: other.name, emoji: other.emoji })) },
		{ type: 'cta', title: 'Copy it into your tree.', body: 'Templates are just things. Make one, then make it yours.', cta: registerCta, secondary: docsCta }
	];
};

const buildFaq = (entry: MarketingPage, feature: Feature): SectionBlock[] => {
	const seed = entry.slug;
	const all = faqFor(feature, `${seed}:a`).concat(faqFor(feature, `${seed}:b`)).filter((item, index, list) => list.findIndex((other) => other.q === item.q) === index);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `${feature.name}: your questions`, highlight: feature.name, body: feature.description, cta: ctaFor(feature), secondary: docsCta },
		{ type: 'faq', eyebrow: 'FAQ', title: 'Everything people ask', items: all },
		{ type: 'bullets', eyebrow: 'In short', title: 'The three things to know', items: feature.highlights.map((highlight, index) => ({ emoji: [feature.emoji, '✨', '🌈'][index], title: highlight, body: feature.tagline })) },
		featureLinks(feature),
		{ type: 'cta', title: 'Still curious?', body: 'The fastest answer is the app itself.', cta: ctaFor(feature), secondary: registerCta }
	];
};

const buildChecklist = (entry: MarketingPage): SectionBlock[] => {
	const persona = getPersona(entry.refs.persona!);
	const features = persona.leadFeatures.map(getFeature);
	return [
		{ type: 'hero', eyebrow: entry.eyebrow, title: `Getting started ${persona.label}`, highlight: persona.name, body: `Six things to do in your first session, in order. ${persona.gains[0]}.`, cta: registerCta, secondary: { label: `Thingtime ${persona.label}`, to: pageHref(`for/${persona.key}`) } },
		{ type: 'steps', eyebrow: 'Checklist', title: 'Your first session', steps: features.map((feature, index) => ({ title: `☐ ${index + 1}. ${feature.highlights[0]}`, body: `${feature.name}: ${feature.tagline} Open ${feature.route}.` })) },
		{ type: 'links', eyebrow: 'Guides', title: 'Read the how-to for each step', links: features.map((feature) => ({ to: pageHref(`guides/${feature.key}`), label: `How to use ${feature.name}`, emoji: '📘' })) },
		{ type: 'walkthrough', walkthrough: `feature-${features[0].key}` },
		{ type: 'cta', title: 'Tick the first box.', body: 'Register, make one thing, and the rest follows.', cta: registerCta, secondary: docsCta }
	];
};

export const buildPage = (entry: MarketingPage): BuiltPage => {
	const trend = entry.refs.trend ?? TREND_FOR_KIND[entry.kind];
	let sections: SectionBlock[];
	switch (entry.kind) {
		case 'landing':
		case 'trend-landing':
			sections = buildLanding(entry, getFeature(entry.refs.feature!), trend);
			break;
		case 'guide':
			sections = buildGuide(entry, getFeature(entry.refs.feature!));
			break;
		case 'walkthrough':
			sections = buildWalkthrough(entry, getFeature(entry.refs.feature!));
			break;
		case 'compare':
		case 'alternative':
			sections = buildCompare(entry);
			break;
		case 'feature-compare':
			sections = buildFeatureCompare(entry);
			break;
		case 'persona':
			sections = buildPersona(entry);
			break;
		case 'persona-feature':
			sections = buildPersonaFeature(entry);
			break;
		case 'use-case':
			sections = buildUseCase(entry);
			break;
		case 'use-case-compare':
			sections = buildUseCaseCompare(entry);
			break;
		case 'concept':
			sections = buildConcept(entry);
			break;
		case 'template':
			sections = buildTemplate(entry);
			break;
		case 'faq':
			sections = buildFaq(entry, getFeature(entry.refs.feature!));
			break;
		case 'checklist':
			sections = buildChecklist(entry);
			break;
		default:
			throw new Error(`No builder for page kind ${entry.kind as string}`);
	}
	return { ...entry, trend, sections };
};

export const buildPageBySlug = (slug: string): BuiltPage | null => {
	const entry = PAGE_BY_SLUG[slug];
	return entry ? buildPage(entry) : null;
};

// ---------------------------------------------------------- validation
export type CatalogIssue = { slug: string; problem: string };

const PLACEHOLDER_LOOSE = /lorem|ipsum|\{[a-z]+\}|undefined|\[object Object\]/i;
const PLACEHOLDER_STRICT = /\bTODO\b|\bTBD\b|\bFIXME\b/;
const hasPlaceholder = (text: string) => PLACEHOLDER_LOOSE.test(text) || PLACEHOLDER_STRICT.test(text);

export const validateCatalog = (options: { buildAll?: boolean } = {}): CatalogIssue[] => {
	const issues: CatalogIssue[] = [];
	const seen = new Set<string>();
	for (const entry of PAGES) {
		if (seen.has(entry.slug)) issues.push({ slug: entry.slug, problem: 'duplicate slug' });
		seen.add(entry.slug);
		if (!/^[a-z0-9-]+(\/[a-z0-9-]+){1,2}$/.test(entry.slug)) issues.push({ slug: entry.slug, problem: 'slug is not 2-3 kebab segments' });
		if (!CATEGORY_BY_KEY[entry.category]) issues.push({ slug: entry.slug, problem: `unknown category ${entry.category}` });
		if (!entry.slug.startsWith(`${entry.category}/`)) issues.push({ slug: entry.slug, problem: 'slug does not start with its category' });
		if (!CATEGORY_BY_KEY[entry.category]?.kinds.includes(entry.kind)) issues.push({ slug: entry.slug, problem: `kind ${entry.kind} not allowed in ${entry.category}` });
		if (entry.title.length < 8 || entry.title.length > 90) issues.push({ slug: entry.slug, problem: `title length ${entry.title.length}` });
		if (entry.description.length < 50 || entry.description.length > 200) issues.push({ slug: entry.slug, problem: `description length ${entry.description.length}` });
		if (hasPlaceholder(entry.title) || hasPlaceholder(entry.description)) issues.push({ slug: entry.slug, problem: 'placeholder text' });
		for (const related of entry.related) if (!PAGE_BY_SLUG[related]) issues.push({ slug: entry.slug, problem: `related slug missing: ${related}` });
		if (entry.refs.walkthrough) {
			const walkthrough = getWalkthrough(entry.refs.walkthrough);
			for (const step of walkthrough.steps) if (!SCREEN_TARGETS[walkthrough.screen].includes(step.target)) issues.push({ slug: entry.slug, problem: `walkthrough target ${step.target} missing on ${walkthrough.screen}` });
		}
		if (options.buildAll) {
			const built = buildPage(entry);
			if (built.sections.length < 4) issues.push({ slug: entry.slug, problem: `only ${built.sections.length} sections` });
			if (built.sections[0].type !== 'hero') issues.push({ slug: entry.slug, problem: 'first section is not a hero' });
			if (built.sections[built.sections.length - 1].type !== 'cta') issues.push({ slug: entry.slug, problem: 'last section is not a cta' });
			const text = JSON.stringify(built.sections);
			if (hasPlaceholder(text)) issues.push({ slug: entry.slug, problem: 'placeholder text in sections' });
			for (const section of built.sections) {
				if (section.type === 'walkthrough') {
					const walkthrough = getWalkthrough(section.walkthrough);
					for (const step of walkthrough.steps) if (!SCREEN_TARGETS[walkthrough.screen].includes(step.target)) issues.push({ slug: entry.slug, problem: `embedded walkthrough target ${step.target} missing` });
				}
				if (section.type === 'links') for (const link of section.links) if (link.to.startsWith(`${MARKETING_BASE}/`) && !PAGE_BY_SLUG[link.to.slice(MARKETING_BASE.length + 1)] && !CATEGORY_BY_KEY[link.to.slice(MARKETING_BASE.length + 1)]) issues.push({ slug: entry.slug, problem: `dead link ${link.to}` });
				if (section.type === 'hero' && section.title.length > 110) issues.push({ slug: entry.slug, problem: `hero title too long (${section.title.length})` });
				if (section.type === 'faq' && section.items.length < 3) issues.push({ slug: entry.slug, problem: 'faq has fewer than 3 items' });
			}
		}
	}
	return issues;
};

export const searchPages = (query: string, limit = 50): MarketingPage[] => {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	const terms = needle.split(/\s+/);
	const scored = PAGES.map((entry) => {
		const haystack = `${entry.title} ${entry.description} ${entry.slug} ${entry.eyebrow}`.toLowerCase();
		const score = terms.reduce((sum, term) => sum + (entry.title.toLowerCase().includes(term) ? 3 : 0) + (entry.slug.includes(term) ? 2 : 0) + (haystack.includes(term) ? 1 : 0), 0);
		return { entry, score };
	}).filter((candidate) => candidate.score > 0);
	scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
	return scored.slice(0, limit).map((candidate) => candidate.entry);
};

export const pageSeedNumber = (slug: string) => hashString(slug);

export { hookFor };
export type { PersonaKey };
