import type { Competitor, Feature, Persona, Trend, UseCase } from './types';

// Deterministic copy generators. Every choice is seeded from the page slug
// so a page renders identically on every visit and in tests, while sibling
// pages still vary their hooks, headlines and FAQs instead of repeating one
// template 1000 times.

export const hashString = (input: string): number => {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index++) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

export const pick = <T>(seed: string, list: readonly T[], offset = 0): T => {
	if (!list.length) throw new Error('pick() needs a non-empty list');
	return list[(hashString(seed) + offset) % list.length];
};

export const pickMany = <T>(seed: string, list: readonly T[], count: number): T[] => {
	const start = hashString(seed) % Math.max(1, list.length);
	const out: T[] = [];
	for (let index = 0; index < Math.min(count, list.length); index++) out.push(list[(start + index) % list.length]);
	return out;
};

export const capitalise = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
export const lower = (text: string) => text.toLowerCase();

// -------------------------------------------------------------- hooks
// Platform-native hook formulas. {name} = feature name, {tag} = tagline,
// {benefit} = first highlight, {pain} = a persona pain or generic pain.
export type HookPlatform = 'tiktok' | 'youtube' | 'instagram' | 'x' | 'facebook' | 'linkedin' | 'pinterest';

const HOOKS: Record<HookPlatform, string[]> = {
	tiktok: [
		'POV: {tag}',
		'nobody talks about this: {benefit}',
		'stop {pain}. do this instead',
		'3 things you didn’t know about {name}',
		'wait for it… {benefit}',
		'this is your sign to try {name}',
		'the app I wish I had in school: {name}',
		'if you {pain}, watch this'
	],
	youtube: ['{NAME} IS FREE?!', 'I replaced {competitor} with THIS', '{name} in 60 seconds', 'You’re doing {topic} WRONG', 'The {topic} app nobody told you about', '{benefit}. Seriously.'],
	instagram: ['{tag}', 'Save this: {name}', '{benefit} ✨', 'Swipe → {name}', 'Your {topic}, but make it a thing', '{name}: {benefit}'],
	x: ['{tag}', 'Shipped: {name}', '{benefit}. One API. Zero ads.', '{name} is live. {benefit}', 'Hot take: {pain} is optional now', 'You can now {benefitLower} in Thingtime'],
	facebook: ['{tag}', 'Meet {name}', '{benefit}, without the ads', 'For anyone who {pain}: {name}', 'New in Thingtime: {name}'],
	linkedin: ['{benefit}. Here is how.', 'Why we built {name}', '{name}: {tag}', 'One data model for {topic}', 'We open-sourced {name}'],
	pinterest: ['{name} ideas', 'How to {benefitLower}', '{topic} organised, finally', 'Aesthetic {topic} setup with {name}', '{tag}']
};

const GENERIC_PAINS = ['juggling five apps', 'losing your own data', 'paying for lock-in', 'fighting the algorithm', 'scrolling ads', 'sharing everything or nothing'];

const TOPIC_BY_CATEGORY: Record<Feature['category'], string> = {
	core: 'your data',
	social: 'your feed',
	builder: 'your pages',
	developer: 'your API',
	ai: 'your AI',
	data: 'your things',
	account: 'your account',
	apps: 'your apps',
	design: 'your design',
	mobile: 'your devices',
	admin: 'your instance'
};

export const fill = (template: string, values: Record<string, string>) =>
	template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));

export const hookFor = (platform: HookPlatform, feature: Feature, seed: string, extra: Partial<Record<'competitor' | 'pain', string>> = {}) => {
	const template = pick(`${seed}:${platform}`, HOOKS[platform]);
	const benefit = feature.highlights[hashString(seed) % 3];
	return fill(template, {
		name: feature.name,
		NAME: feature.name.toUpperCase(),
		tag: feature.tagline.replace(/\.$/, ''),
		benefit,
		benefitLower: lower(benefit),
		topic: TOPIC_BY_CATEGORY[feature.category],
		pain: extra.pain ?? pick(`${seed}:pain`, GENERIC_PAINS),
		competitor: extra.competitor ?? pick(`${seed}:comp`, ['Notion', 'Airtable', 'a spreadsheet', 'Linktree', 'X'])
	});
};

// --------------------------------------------------------- headlines
const LANDING_HEADLINES = [
	'{name}: {tag}',
	'{tag}',
	'Meet {name}.',
	'{name}, the Thingtime way.',
	'{tag} Meet {name}.',
	'{benefit}.'
];

export const landingHeadline = (feature: Feature, seed: string) =>
	fill(pick(seed, LANDING_HEADLINES), {
		name: feature.name,
		tag: feature.tagline.replace(/\.$/, ''),
		benefit: feature.highlights[hashString(seed) % 3]
	}).replace(/\.\./g, '.');

export const highlightWord = (headline: string, seed: string) => {
	const words = headline.replace(/[.,:!?]/g, '').split(' ').filter((word) => word.length > 3);
	if (!words.length) return '';
	return pick(seed, words);
};

// --------------------------------------------------------------- faq
export const faqFor = (feature: Feature, seed: string): { q: string; a: string }[] => {
	const [one, two, three] = feature.highlights;
	const base = [
		{ q: `What is ${feature.name}?`, a: `${feature.description}` },
		{ q: `Do I need an account to try ${lower(feature.name)}?`, a: 'You can start with a temporary account and claim it later by registering. Nothing you make is lost when you do.' },
		{ q: `Is my data mine?`, a: 'Yes. Everything in Thingtime is a thing you own: open, exportable through the same API the app uses, and never sold or shown ads against.' },
		{ q: `Does it work on mobile?`, a: 'Yes. The web app is responsive, there is a native iOS app, and the same account works everywhere.' },
		{ q: `Can I use ${lower(feature.name)} from the API?`, a: `Yes. ${one} and the rest of ${lower(feature.name)} sit behind the same /api/v1 endpoints the UI calls, documented at /docs/api.` },
		{ q: `Where do I find it?`, a: `Open ${feature.route} in the app. ${two}; ${lower(three)}.` },
		{ q: `Is it free?`, a: 'Thingtime is free while in beta. Plans and quotas exist so the instance stays fair for everyone, and you can self-host if you prefer.' }
	];
	return pickMany(seed, base, 4);
};

// ------------------------------------------------------------- stats
// Only numbers that are true of the product today.
const STATS = [
	{ value: '1', label: 'data model for everything' },
	{ value: '0', label: 'ads, ever' },
	{ value: '1000+', label: 'components in the library' },
	{ value: '300+', label: 'demo pages to fork' },
	{ value: '30+', label: 'MCP tools for AI assistants' },
	{ value: '5', label: 'rainbow stops in every surface' },
	{ value: '∞', label: 'nesting depth in the tree' },
	{ value: '4', label: 'surfaces: web, iOS, Raycast, API' },
	{ value: '2', label: 'built-in themes, unlimited yours' },
	{ value: '10k', label: 'pixel logos on /branding' }
];

export const statsFor = (seed: string) => pickMany(seed, STATS, 4);

// ------------------------------------------------------------ quotes
// Product-voice quotes (no invented customers): each is attributed to the
// product itself or the founding copy.
const QUOTES = [
	{ text: 'A GUI for the internet.', by: 'Thingtime, front page' },
	{ text: 'Everything is a thing.', by: 'Thingtime, the model' },
	{ text: 'Your stuff, structured.', by: 'Thingtime, live demo' },
	{ text: 'One API. Every shape.', by: 'Thingtime, developers' },
	{ text: 'One brain. Every surface.', by: 'Thingtime, ecosystem' },
	{ text: 'Data should be open, accessible, and empowering.', by: 'Thingtime, founding belief' },
	{ text: 'Is my data mine? Yes.', by: 'Thingtime, FAQ' },
	{ text: 'Built in the open, shipped every week.', by: 'Thingtime, back the launch' }
];

export const quoteFor = (seed: string) => pick(seed, QUOTES);

// ----------------------------------------------------------- captions
export const HASHTAGS: Record<HookPlatform, string[]> = {
	tiktok: ['#thingtime', '#productivity', '#apptok', '#techtok', '#organise', '#dataownership', '#notion', '#studytok'],
	youtube: ['#thingtime', '#productivity', '#opensource', '#webapp'],
	instagram: ['#thingtime', '#productivityapp', '#aesthetic', '#organisation', '#digitalplanner', '#opensource', '#indiehacker', '#nocode'],
	x: ['#buildinpublic', '#opensource', '#indiehackers', '#thingtime'],
	facebook: ['#thingtime', '#productivity', '#family', '#opensource'],
	linkedin: ['#opensource', '#productmanagement', '#developers', '#saas', '#thingtime'],
	pinterest: ['#organization', '#productivity', '#digitalplanner', '#aesthetic', '#thingtime']
};

export const captionFor = (platform: HookPlatform, feature: Feature, seed: string) => {
	const hook = hookFor(platform, feature, seed);
	const tags = pickMany(`${seed}:tags`, HASHTAGS[platform], platform === 'x' || platform === 'linkedin' ? 3 : 6).join(' ');
	const cta = pick(`${seed}:cta`, ['Try it free at thingtime.com', 'Link in bio 🌈', 'Open thingtime.com/marketing', 'Free while in beta ✨', 'Fork it, it’s open source 🐙']);
	return `${hook}\n\n${feature.description}\n\n${cta}\n${tags}`;
};

// ------------------------------------------------------- persona copy
export const personaHeadline = (persona: Persona, feature: Feature, seed: string) =>
	fill(pick(seed, ['{feature} {label}', '{label}: {tag}', '{feature}, {label}', 'If you {pain}: {feature}']), {
		feature: feature.name,
		label: persona.label,
		tag: feature.tagline.replace(/\.$/, ''),
		pain: lower(pick(`${seed}:pain`, persona.pains)).replace(/^your /, 'have a ')
	});

export const personaBenefit = (persona: Persona, feature: Feature, seed: string) => {
	const gain = pick(`${seed}:gain`, persona.gains);
	const highlight = feature.highlights[hashString(seed) % 3];
	return `${gain}. ${feature.name} helps: ${lower(highlight)}.`;
};

// ------------------------------------------------------ compare copy
export const compareHeadline = (competitor: Competitor, seed: string) =>
	fill(pick(seed, ['Thingtime vs {name}', 'Thingtime or {name}?', '{name} alternative: Thingtime', 'Thingtime compared with {name}']), { name: competitor.name });

export const compareIntro = (competitor: Competitor) =>
	`${competitor.name} is known for ${competitor.knownFor}. Thingtime takes a different route: everything you keep is a thing in one tree with one open API, a social layer and permissions per branch. Here is how they differ, fairly.`;

export const headlineForUseCase = (useCase: UseCase, seed: string) =>
	fill(pick(seed, ['{name} in Thingtime', 'How to keep a {lower} in Thingtime', '{name}: {tag}', 'Build a {lower} as a thing']), {
		name: useCase.name,
		lower: lower(useCase.name),
		tag: useCase.tagline.replace(/\.$/, '')
	});

export const trendHeadline = (trend: Trend, feature: Feature, seed: string) =>
	fill(pick(seed, ['{feature}, {trend} edition', '{tag}', '{feature} in {trend}', '{benefit}']), {
		feature: feature.name,
		trend: lower(trend.name),
		tag: feature.tagline.replace(/\.$/, ''),
		benefit: feature.highlights[hashString(seed) % 3]
	});

export const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
