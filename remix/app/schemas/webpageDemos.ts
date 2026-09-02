// The builder DEMO LIBRARY — a deterministic catalog of example webpages
// (sections, full pages, and component-block compositions) generated from
// small family × layout × tone tables, so a few hundred demos live as ONE
// source of truth instead of hundreds of hand-kept JSON blobs. Pure and
// isomorphic: the admin seed (api/utils/webpages/seed.ts) upserts every demo
// as a system-owned webpage thing (shareId webpage-demo-<slug>), the public
// GET /api/v1/webpages/demos lists the same catalog, and the /builder/demos
// gallery paints it instantly client-side (optimistic-render rule) before the
// seeded flags reconcile. Every demo must clear validateThingtimeCrystal
// (['webpage']) — the exact write gate user pages clear — which the unit test
// asserts for the whole catalog, so a bound tightened in the registry can
// never ship a demo the builder would refuse to save.

export type DemoBlockType = 'component' | 'container' | 'text' | 'native' | 'media' | 'html';

export type DemoBlock = {
	id: string;
	type: DemoBlockType;
	align?: 'start' | 'center' | 'end' | 'stretch';
	maxWidth?: number;
	css?: Record<string, string>;
	component?: string;
	args?: Record<string, string | number | boolean>;
	direction?: 'column' | 'row' | 'grid';
	gap?: number;
	columns?: number;
	children?: DemoBlock[];
	text?: string;
	style?: 'body' | 'heading' | 'eyebrow';
	tag?: string;
	html?: string;
	src?: string;
	alt?: string;
	media?: 'image' | 'video' | 'audio';
	native?: string;
};

export type WebpageDemoKind = 'section' | 'page' | 'component';

export type WebpageDemoFamily = {
	key: string;
	title: string;
	emoji: string;
	kind: WebpageDemoKind;
	description: string;
};

export type WebpageDemo = {
	slug: string;
	name: string;
	family: string;
	kind: WebpageDemoKind;
	tone: string;
	layout: string;
	tags: string[];
	description: string;
	previewBg: string;
	blocks: DemoBlock[];
};

// shareId = webpage-<WEBPAGE_DEMO_SLUG_PREFIX><slug>; pageKey = the same slug
// with the prefix (stable identity a viewer's fork keeps via forkOf)
export const WEBPAGE_DEMO_SLUG_PREFIX = 'demo-';
export const webpageDemoShareId = (slug: string): string => `webpage-${WEBPAGE_DEMO_SLUG_PREFIX}${slug}`;
export const webpageDemoPageKey = (slug: string): string => `${WEBPAGE_DEMO_SLUG_PREFIX}${slug}`;

// ---------------------------------------------------------------------------
// Tones — restrained palettes in the house greyscale-first style plus a few
// tinted accents. Only flat colors and gradients: every value must clear the
// registry's css screen (no markup, no url() outside https/site/data-image).
type Tone = {
	key: string;
	title: string;
	bg: string;
	surface: string;
	ink: string;
	text: string;
	muted: string;
	accent: string;
	accentInk: string;
	border: string;
	soft: string;
	gradient: string;
};

const TONES: Tone[] = [
	{ key: 'paper', title: 'Paper', bg: '#fafafb', surface: '#ffffff', ink: '#16161a', text: '#5a5a66', muted: '#9a9aa6', accent: '#16161a', accentInk: '#ffffff', border: '#ececef', soft: '#f1f1f4', gradient: 'linear-gradient(135deg, #ececef 0%, #d9d9e0 100%)' },
	{ key: 'ink', title: 'Ink', bg: '#0f0f12', surface: '#18181d', ink: '#f5f5f7', text: '#b6b6c2', muted: '#7a7a88', accent: '#f5f5f7', accentInk: '#0f0f12', border: '#2a2a33', soft: '#1f1f26', gradient: 'linear-gradient(135deg, #2a2a33 0%, #45455a 100%)' },
	{ key: 'mint', title: 'Mint', bg: '#f2fbf6', surface: '#ffffff', ink: '#0d2b1f', text: '#3f6b58', muted: '#7ea595', accent: '#0f9d63', accentInk: '#ffffff', border: '#d7efe2', soft: '#e3f6ec', gradient: 'linear-gradient(135deg, #c9f0dc 0%, #7fd8ae 100%)' },
	{ key: 'sunset', title: 'Sunset', bg: '#fff6f1', surface: '#ffffff', ink: '#3a1d12', text: '#7a4a37', muted: '#b48b7c', accent: '#f2662d', accentInk: '#ffffff', border: '#f8dccf', soft: '#ffe9de', gradient: 'linear-gradient(135deg, #ffd3bf 0%, #ff9a6a 100%)' },
	{ key: 'ocean', title: 'Ocean', bg: '#f1f7ff', surface: '#ffffff', ink: '#0d2340', text: '#3f5878', muted: '#8598b5', accent: '#1d6fe8', accentInk: '#ffffff', border: '#d6e4f8', soft: '#e2eefc', gradient: 'linear-gradient(135deg, #cfe0fb 0%, #7fb0f5 100%)' },
	{ key: 'mono', title: 'Mono', bg: '#ffffff', surface: '#f5f5f7', ink: '#111114', text: '#4a4a55', muted: '#8a8a96', accent: '#111114', accentInk: '#ffffff', border: '#e4e4ea', soft: '#ededf1', gradient: 'linear-gradient(135deg, #f0f0f3 0%, #cfcfd6 100%)' }
];

const toneByKey = new Map(TONES.map((tone) => [tone.key, tone]));

// ---------------------------------------------------------------------------
// Copy — a handful of fictional brands so demos read like real pages. Copy
// rotates deterministically over (layout, tone) so neighbouring demos differ.
type Copy = {
	brand: string;
	eyebrow: string;
	tagline: string;
	blurb: string;
	ctaPrimary: string;
	ctaSecondary: string;
	features: Array<{ emoji: string; title: string; body: string }>;
	stats: Array<{ value: string; label: string }>;
	testimonials: Array<{ quote: string; name: string; role: string }>;
	plans: Array<{ name: string; price: string; period: string; blurb: string; perks: string[] }>;
	faqs: Array<{ q: string; a: string }>;
	team: Array<{ name: string; role: string; emoji: string }>;
	steps: Array<{ title: string; body: string }>;
	logos: string[];
	posts: Array<{ title: string; date: string; blurb: string }>;
	links: string[];
};

const COPY: Copy[] = [
	{
		brand: 'Thingtime',
		eyebrow: 'A GUI for the internet',
		tagline: 'Everything is a thing.',
		blurb: 'Posts, pages, schemas, and actions share one grammar — build once, remix anywhere, keep it yours.',
		ctaPrimary: 'Get started',
		ctaSecondary: 'Read the docs',
		features: [
			{ emoji: '🧱', title: 'Blocks, not templates', body: 'Compose pages from components and native screens; every block stays editable.' },
			{ emoji: '🔐', title: 'Yours by default', body: 'Private until you share. Audiences, hidden links, and app grants live on one acl.' },
			{ emoji: '⚡', title: 'Optimistic everywhere', body: 'Taps land instantly and reconcile in the background — never a spinner.' },
			{ emoji: '🧬', title: 'Schemas as things', body: 'Describe a kind once; the registry renders, validates, and documents it.' },
			{ emoji: '🤝', title: 'Federated login', body: 'One identity across every deployment, previews included.' },
			{ emoji: '🛰', title: 'API-first', body: 'The UI is just another client of the versioned capability manifest.' }
		],
		stats: [
			{ value: '1', label: 'database' },
			{ value: '∞', label: 'kinds' },
			{ value: '0', label: 'spinners' },
			{ value: '100%', label: 'yours' }
		],
		testimonials: [
			{ quote: 'I built my whole site in an afternoon and it still feels like mine.', name: 'Ada', role: 'Designer' },
			{ quote: 'The block model is the first one that didn’t fight me.', name: 'Kai', role: 'Indie developer' },
			{ quote: 'Optimistic everything. My users noticed on day one.', name: 'Noor', role: 'Founder' }
		],
		plans: [
			{ name: 'Free', price: '$0', period: 'forever', blurb: 'For personal pages.', perks: ['Unlimited pages', 'Public + private', 'Community support'] },
			{ name: 'Plus', price: '$8', period: 'per month', blurb: 'For creators and teams.', perks: ['Custom audiences', 'Priority uploads', 'Email support'] },
			{ name: 'Studio', price: '$29', period: 'per month', blurb: 'For agencies.', perks: ['Unlimited members', 'Actions + automations', 'Dedicated help'] }
		],
		faqs: [
			{ q: 'Is everything really a thing?', a: 'Yes — users, posts, pages, schemas, and actions all live in one collection by kind.' },
			{ q: 'Can I export my data?', a: 'Every thing is available through the versioned API and the MCP server.' },
			{ q: 'Do pages work logged out?', a: 'Public pages render for everyone; private pages only for their audience.' },
			{ q: 'What about custom domains?', a: 'Coming with the site layer — every route is already a block site.' },
			{ q: 'How do I get help?', a: 'Open the Lopu chat or read the docs; both are one tap away.' }
		],
		team: [
			{ name: 'Lopu', role: 'Founder', emoji: '🌈' },
			{ name: 'Ada', role: 'Design', emoji: '🎨' },
			{ name: 'Kai', role: 'Engineering', emoji: '🛠' },
			{ name: 'Noor', role: 'Community', emoji: '💬' }
		],
		steps: [
			{ title: 'Create a thing', body: 'A post, a page, a schema — whatever you need first.' },
			{ title: 'Compose blocks', body: 'Drop components and native screens onto the canvas.' },
			{ title: 'Share it', body: 'Public, hidden link, or a custom audience.' },
			{ title: 'Remix', body: 'Fork any page you can see into your own things.' }
		],
		logos: ['Acme', 'Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli'],
		posts: [
			{ title: 'Why every page is a block site', date: 'Sep 2026', blurb: 'The site layer explained in three diagrams.' },
			{ title: 'Optimistic rendering, the house rule', date: 'Aug 2026', blurb: 'Never a spinner when we have prior state.' },
			{ title: 'Schemas that document themselves', date: 'Jul 2026', blurb: 'One registry, many surfaces.' }
		],
		links: ['Docs', 'Components', 'Schemas', 'Actions', 'Status', 'Changelog']
	},
	{
		brand: 'Northlight Studio',
		eyebrow: 'Design & build',
		tagline: 'Calm interfaces for busy products.',
		blurb: 'A two-person studio shipping brand, product, and front-end work for teams who care about detail.',
		ctaPrimary: 'Start a project',
		ctaSecondary: 'See our work',
		features: [
			{ emoji: '✏️', title: 'Brand systems', body: 'Identity, type, and motion that scale from favicon to keynote.' },
			{ emoji: '📐', title: 'Product design', body: 'Flows, prototypes, and design systems your engineers will love.' },
			{ emoji: '🧩', title: 'Front-end', body: 'Accessible, fast, and boring in the best way.' },
			{ emoji: '🔍', title: 'Audits', body: 'A week-long deep dive with a prioritised fix list.' },
			{ emoji: '🗓', title: 'Retainers', body: 'A senior designer on your team, part-time.' },
			{ emoji: '🎓', title: 'Workshops', body: 'Teach your team the craft, not the tool.' }
		],
		stats: [
			{ value: '48', label: 'launches' },
			{ value: '12', label: 'years' },
			{ value: '4.9', label: 'client rating' },
			{ value: '2', label: 'humans' }
		],
		testimonials: [
			{ quote: 'They made our product feel inevitable.', name: 'Priya', role: 'CEO, Lumen' },
			{ quote: 'Fast, opinionated, and right most of the time.', name: 'Tom', role: 'CTO, Harbor' },
			{ quote: 'The audit paid for itself in a week.', name: 'Mei', role: 'PM, Sable' }
		],
		plans: [
			{ name: 'Sprint', price: '$4k', period: 'one week', blurb: 'One focused problem.', perks: ['Research + design', 'Clickable prototype', 'Handoff notes'] },
			{ name: 'Launch', price: '$18k', period: 'six weeks', blurb: 'Brand to shipped site.', perks: ['Identity system', 'Marketing site', 'Launch support'] },
			{ name: 'Partner', price: '$6k', period: 'per month', blurb: 'Ongoing design.', perks: ['Weekly reviews', 'Design system care', 'Priority queue'] }
		],
		faqs: [
			{ q: 'How do projects start?', a: 'A 30-minute call, then a one-page proposal within two days.' },
			{ q: 'Do you work with startups?', a: 'Mostly — we like small teams with real problems.' },
			{ q: 'Which tools do you use?', a: 'Whatever your team already uses; we adapt.' },
			{ q: 'Can you build it too?', a: 'Yes, front-end is half of what we do.' },
			{ q: 'Where are you based?', a: 'Sydney and Lisbon, remote-first.' }
		],
		team: [
			{ name: 'June', role: 'Design lead', emoji: '🖋' },
			{ name: 'Rafa', role: 'Engineering lead', emoji: '⚙️' },
			{ name: 'Ines', role: 'Strategy', emoji: '🧭' },
			{ name: 'Olu', role: 'Motion', emoji: '🎞' }
		],
		steps: [
			{ title: 'Discover', body: 'We learn the product, the users, and the constraints.' },
			{ title: 'Shape', body: 'Low-fi options, one direction, quick decisions.' },
			{ title: 'Build', body: 'Real components in your codebase, not a redline PDF.' },
			{ title: 'Launch', body: 'We stay through the first week of feedback.' }
		],
		logos: ['Lumen', 'Harbor', 'Sable', 'Quill', 'Orbit', 'Fable'],
		posts: [
			{ title: 'The case for boring front-ends', date: 'Aug 2026', blurb: 'Why we reach for the platform first.' },
			{ title: 'Type scales that survive contact', date: 'Jun 2026', blurb: 'A pragmatic system for product teams.' },
			{ title: 'What an audit actually looks like', date: 'May 2026', blurb: 'One week, one document, no fluff.' }
		],
		links: ['Work', 'Services', 'Journal', 'About', 'Contact', 'Careers']
	},
	{
		brand: 'Riverbend Collective',
		eyebrow: 'Community',
		tagline: 'Neighbours, projects, and a shared workshop.',
		blurb: 'A member-run space with tools, classes, and a calendar that fills up faster than we can print it.',
		ctaPrimary: 'Become a member',
		ctaSecondary: 'Visit on Saturday',
		features: [
			{ emoji: '🪚', title: 'The workshop', body: 'Wood, metal, and textile benches open six days a week.' },
			{ emoji: '📚', title: 'Classes', body: 'Beginner to advanced, taught by members.' },
			{ emoji: '🌱', title: 'Garden', body: 'Twelve raised beds and a very opinionated compost committee.' },
			{ emoji: '🎤', title: 'Events', body: 'Talks, swaps, and the monthly repair café.' },
			{ emoji: '🧰', title: 'Tool library', body: 'Borrow what you need for the weekend.' },
			{ emoji: '☕', title: 'The kitchen', body: 'Good coffee, better conversations.' }
		],
		stats: [
			{ value: '640', label: 'members' },
			{ value: '31', label: 'classes a month' },
			{ value: '9', label: 'years running' },
			{ value: '1', label: 'compost committee' }
		],
		testimonials: [
			{ quote: 'I learned to weld here. Now I fix everyone’s gates.', name: 'Sam', role: 'Member since 2019' },
			{ quote: 'The repair café saved my grandmother’s radio.', name: 'Leila', role: 'Member' },
			{ quote: 'Best Saturday morning in the city.', name: 'Dev', role: 'Volunteer' }
		],
		plans: [
			{ name: 'Visitor', price: '$0', period: 'per visit', blurb: 'Drop in on open days.', perks: ['Open Saturdays', 'Repair café', 'Newsletter'] },
			{ name: 'Member', price: '$25', period: 'per month', blurb: 'Full workshop access.', perks: ['All benches', 'Tool library', 'Class discounts'] },
			{ name: 'Household', price: '$40', period: 'per month', blurb: 'Bring the family.', perks: ['Two adults', 'Kids’ classes', 'Garden bed'] }
		],
		faqs: [
			{ q: 'Do I need experience?', a: 'No — every bench has an induction and a friendly human.' },
			{ q: 'Can I bring kids?', a: 'Yes, in the garden and the Sunday kids’ classes.' },
			{ q: 'Where do you get funding?', a: 'Memberships first, a council grant second.' },
			{ q: 'Is there parking?', a: 'Bikes yes, cars barely — take the tram.' },
			{ q: 'How do I volunteer?', a: 'Ask at the kitchen; there is always a list.' }
		],
		team: [
			{ name: 'Marta', role: 'Coordinator', emoji: '🗂' },
			{ name: 'Yusuf', role: 'Workshop lead', emoji: '🪚' },
			{ name: 'Bea', role: 'Garden', emoji: '🌻' },
			{ name: 'Theo', role: 'Events', emoji: '🎪' }
		],
		steps: [
			{ title: 'Visit', body: 'Come on a Saturday and meet a coordinator.' },
			{ title: 'Induct', body: 'A 40-minute safety walk-through per bench.' },
			{ title: 'Join', body: 'Pick a plan; change it any time.' },
			{ title: 'Make', body: 'Book a bench and bring your project.' }
		],
		logos: ['City Council', 'Makers Guild', 'Tramline', 'Green Bank', 'Local Radio', 'The Bakery'],
		posts: [
			{ title: 'Repair café: 212 things fixed', date: 'Aug 2026', blurb: 'A record month, and a broken toaster we could not save.' },
			{ title: 'New textile bench', date: 'Jul 2026', blurb: 'Two industrial machines donated by a member.' },
			{ title: 'Garden season plan', date: 'Jun 2026', blurb: 'What we are planting and why.' }
		],
		links: ['Calendar', 'Classes', 'Membership', 'Workshop', 'Garden', 'Contact']
	},
	{
		brand: 'Signal',
		eyebrow: 'Developer tools',
		tagline: 'Observability that fits in a terminal.',
		blurb: 'Traces, logs, and metrics stitched into one timeline — queryable from your shell in under a second.',
		ctaPrimary: 'Install the CLI',
		ctaSecondary: 'View pricing',
		features: [
			{ emoji: '⏱', title: 'Sub-second queries', body: 'Columnar storage tuned for the last 30 days.' },
			{ emoji: '🧵', title: 'One timeline', body: 'Every signal joins on trace id, no dashboards required.' },
			{ emoji: '🔌', title: 'OpenTelemetry native', body: 'Point your collector at us; nothing else to change.' },
			{ emoji: '💸', title: 'Flat pricing', body: 'Per seat, not per gigabyte. Log everything.' },
			{ emoji: '🧪', title: 'Local first', body: 'The same engine runs on your laptop for tests.' },
			{ emoji: '🔒', title: 'Zero-retention mode', body: 'Redact at ingest, keep only aggregates.' }
		],
		stats: [
			{ value: '<1s', label: 'p95 query' },
			{ value: '30d', label: 'hot retention' },
			{ value: '99.99%', label: 'uptime' },
			{ value: '0', label: 'per-GB fees' }
		],
		testimonials: [
			{ quote: 'We deleted four dashboards the first week.', name: 'Ren', role: 'SRE, Harbor' },
			{ quote: 'Finally a tool my whole team actually opens.', name: 'Ava', role: 'Eng manager' },
			{ quote: 'The CLI is the product. Everything else is a bonus.', name: 'Jonah', role: 'Backend lead' }
		],
		plans: [
			{ name: 'Solo', price: '$0', period: 'per month', blurb: 'One seat, one project.', perks: ['7-day retention', 'CLI + web', 'Community'] },
			{ name: 'Team', price: '$19', period: 'per seat', blurb: 'Unlimited projects.', perks: ['30-day retention', 'Alerts', 'SSO'] },
			{ name: 'Scale', price: 'Custom', period: 'annual', blurb: 'For platforms.', perks: ['Custom retention', 'Private cloud', 'Support SLA'] }
		],
		faqs: [
			{ q: 'Does it replace my APM?', a: 'For most teams, yes — traces and metrics live in the same store.' },
			{ q: 'What about sampling?', a: 'Tail-based, configurable per service.' },
			{ q: 'Can I self-host?', a: 'The Scale plan ships a single binary you run anywhere.' },
			{ q: 'Which languages?', a: 'Anything OpenTelemetry speaks — which is everything.' },
			{ q: 'Is there a free tier?', a: 'Solo is free forever for one project.' }
		],
		team: [
			{ name: 'Ines', role: 'CEO', emoji: '🧭' },
			{ name: 'Marco', role: 'Storage', emoji: '🗄' },
			{ name: 'Lin', role: 'Query engine', emoji: '🔎' },
			{ name: 'Dana', role: 'Developer experience', emoji: '🧑‍💻' }
		],
		steps: [
			{ title: 'Install', body: 'One curl, one binary, no daemon.' },
			{ title: 'Point your collector', body: 'Set the endpoint; keep your instrumentation.' },
			{ title: 'Query', body: 'sig query "service=api status>=500" — that is the whole API.' },
			{ title: 'Alert', body: 'Any query becomes an alert with --watch.' }
		],
		logos: ['Harbor', 'Orbit', 'Lumen', 'Quill', 'Sable', 'Vector'],
		posts: [
			{ title: 'Why we bill per seat', date: 'Aug 2026', blurb: 'Per-gigabyte pricing punishes good logging.' },
			{ title: 'Tail sampling done right', date: 'Jul 2026', blurb: 'Keep the interesting 1% without guessing.' },
			{ title: 'The query language, explained', date: 'Jun 2026', blurb: 'Five operators, no joins to write.' }
		],
		links: ['Docs', 'CLI', 'Pricing', 'Status', 'Changelog', 'Security']
	},
	{
		brand: 'Cedar & Salt',
		eyebrow: 'Neighbourhood kitchen',
		tagline: 'Seasonal plates, long tables.',
		blurb: 'A small dining room and a smaller menu, changing with whatever the growers bring on Tuesday.',
		ctaPrimary: 'Book a table',
		ctaSecondary: 'See the menu',
		features: [
			{ emoji: '🥬', title: 'Tuesday deliveries', body: 'The menu is written the morning the boxes arrive.' },
			{ emoji: '🍷', title: 'Natural wines', body: 'Twenty bottles we actually drink.' },
			{ emoji: '🕯', title: 'Long tables', body: 'Come alone, leave with neighbours.' },
			{ emoji: '🍞', title: 'Bread at 7', body: 'Sourdough out of the oven every morning.' },
			{ emoji: '🎶', title: 'Sunday records', body: 'Someone brings a crate; we play it.' },
			{ emoji: '🧺', title: 'Take-home', body: 'The pantry shelf is stocked from the kitchen.' }
		],
		stats: [
			{ value: '28', label: 'seats' },
			{ value: '6', label: 'dishes a night' },
			{ value: '14', label: 'growers' },
			{ value: '1', label: 'oven' }
		],
		testimonials: [
			{ quote: 'The kind of place you plan your week around.', name: 'Hana', role: 'Regular' },
			{ quote: 'I came for the bread and stayed for the beans.', name: 'Otis', role: 'Neighbour' },
			{ quote: 'Sunday records is my church.', name: 'Elif', role: 'Regular' }
		],
		plans: [
			{ name: 'Lunch', price: '$24', period: 'two courses', blurb: 'Tuesday to Friday.', perks: ['Soup or salad', 'Plate of the day', 'Bread'] },
			{ name: 'Dinner', price: '$58', period: 'set menu', blurb: 'Five small plates.', perks: ['Seasonal plates', 'Dessert', 'Long table'] },
			{ name: 'Sunday', price: '$42', period: 'family style', blurb: 'One big spread.', perks: ['Shared platters', 'Records', 'Kids welcome'] }
		],
		faqs: [
			{ q: 'Do you take walk-ins?', a: 'Yes at lunch; dinner books out most weeks.' },
			{ q: 'Vegetarian options?', a: 'Half the menu, always. Vegan on request.' },
			{ q: 'Where do you source?', a: 'Fourteen growers within 80km, listed on the board.' },
			{ q: 'Can I hire the room?', a: 'Mondays, for up to 28 people.' },
			{ q: 'Is there a kids menu?', a: 'No, but there is always bread and something gentle.' }
		],
		team: [
			{ name: 'Rosa', role: 'Chef', emoji: '👩‍🍳' },
			{ name: 'Milo', role: 'Front of house', emoji: '🕯' },
			{ name: 'Ayo', role: 'Baker', emoji: '🍞' },
			{ name: 'Greta', role: 'Wine', emoji: '🍷' }
		],
		steps: [
			{ title: 'Tuesday', body: 'Boxes arrive, the board gets written.' },
			{ title: 'Prep', body: 'Everything from scratch by mid-afternoon.' },
			{ title: 'Service', body: 'Two seatings, one long table.' },
			{ title: 'Sunday', body: 'Family style, records on.' }
		],
		logos: ['Hill Farm', 'Two Rivers', 'Salt Co.', 'Brightwood', 'The Mill', 'Bee Lane'],
		posts: [
			{ title: 'This week’s board', date: 'Sep 2026', blurb: 'Tomatoes are finally in.' },
			{ title: 'Meet the growers: Two Rivers', date: 'Aug 2026', blurb: 'Third-generation, no sprays.' },
			{ title: 'Sunday records, volume 12', date: 'Aug 2026', blurb: 'What we played and who brought it.' }
		],
		links: ['Menu', 'Bookings', 'Growers', 'Events', 'Pantry', 'Contact']
	},
	{
		brand: 'Orbit Conf',
		eyebrow: 'October 14–15 · Lisbon',
		tagline: 'Two days on building for the long run.',
		blurb: 'Forty talks, one track, and a hallway that is the actual conference.',
		ctaPrimary: 'Get a ticket',
		ctaSecondary: 'See the schedule',
		features: [
			{ emoji: '🎤', title: 'One track', body: 'Nobody misses the good talk.' },
			{ emoji: '🧑‍🏫', title: 'Workshops', body: 'Hands-on mornings before the talks start.' },
			{ emoji: '🍽', title: 'Long lunches', body: 'Ninety minutes, on purpose.' },
			{ emoji: '🌊', title: 'The river walk', body: 'A guided evening stroll with the speakers.' },
			{ emoji: '🎟', title: 'Fair tickets', body: 'Student and indie pricing, no questions.' },
			{ emoji: '📼', title: 'Recorded', body: 'Every talk online within a week.' }
		],
		stats: [
			{ value: '40', label: 'talks' },
			{ value: '2', label: 'days' },
			{ value: '600', label: 'seats' },
			{ value: '1', label: 'track' }
		],
		testimonials: [
			{ quote: 'The only conference I go to for the talks.', name: 'Nia', role: 'Attendee 2025' },
			{ quote: 'Long lunches changed how I think about events.', name: 'Ben', role: 'Speaker' },
			{ quote: 'I hired two people in the hallway.', name: 'Sofia', role: 'Sponsor' }
		],
		plans: [
			{ name: 'Indie', price: '€120', period: 'two days', blurb: 'Students and indies.', perks: ['All talks', 'Lunches', 'Recordings'] },
			{ name: 'Standard', price: '€420', period: 'two days', blurb: 'Most attendees.', perks: ['All talks', 'Workshops', 'River walk'] },
			{ name: 'Team', price: '€1,500', period: 'five seats', blurb: 'Bring the team.', perks: ['Five tickets', 'Reserved table', 'Logo on site'] }
		],
		faqs: [
			{ q: 'Where is the venue?', a: 'Convento do Beato, ten minutes from the airport.' },
			{ q: 'Is there a code of conduct?', a: 'Yes, and we enforce it.' },
			{ q: 'Refunds?', a: 'Full refund until September 30, transfer any time.' },
			{ q: 'Will talks be recorded?', a: 'All of them, published within a week.' },
			{ q: 'Can I speak?', a: 'The CFP opens in March each year.' }
		],
		team: [
			{ name: 'Tiago', role: 'Curator', emoji: '🎯' },
			{ name: 'Amara', role: 'Operations', emoji: '📋' },
			{ name: 'Felix', role: 'Sponsors', emoji: '🤝' },
			{ name: 'Zoë', role: 'Community', emoji: '🌍' }
		],
		steps: [
			{ title: 'Day 0', body: 'Workshops and the welcome dinner.' },
			{ title: 'Day 1', body: 'Twenty talks, one long lunch.' },
			{ title: 'Day 2', body: 'Twenty more, then the river walk.' },
			{ title: 'After', body: 'Recordings, photos, and the next CFP.' }
		],
		logos: ['Signal', 'Harbor', 'Lumen', 'Quill', 'Vector', 'Fable'],
		posts: [
			{ title: 'Announcing the first ten speakers', date: 'Aug 2026', blurb: 'Distributed systems, design, and one poet.' },
			{ title: 'Why one track', date: 'Jul 2026', blurb: 'On attention and hallway conversations.' },
			{ title: 'Venue tour', date: 'Jun 2026', blurb: 'A 16th-century convent with very good wifi.' }
		],
		links: ['Schedule', 'Speakers', 'Tickets', 'Venue', 'Sponsors', 'Code of conduct']
	}
];

// ---------------------------------------------------------------------------
// Block helpers. Ids are minted per demo through `ids` so every block id in a
// page is unique and stays inside the registry's lowercase-dashed 40-char
// bound even after a section prefix is applied.
type Ids = (name: string) => string;

const makeIds = (prefix: string): Ids => {
	const used = new Map<string, number>();
	return (name: string) => {
		const base = `${prefix}-${name}`.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 34);
		const seen = used.get(base) || 0;
		used.set(base, seen + 1);
		return seen ? `${base}-${seen + 1}` : base;
	};
};

type Ctx = { id: Ids; tone: Tone; copy: Copy };

const typo = (tone: Tone, size: number, weight: number, extra: Record<string, string> = {}): Record<string, string> => ({
	'font-size': `${size}px`,
	'font-weight': String(weight),
	'line-height': size >= 32 ? '1.08' : '1.5',
	color: tone.ink,
	...(size >= 32 ? { 'letter-spacing': '-0.02em' } : {}),
	...extra
});

const heading = (ctx: Ctx, name: string, text: string, size = 40, extra: Record<string, string> = {}): DemoBlock => ({
	id: ctx.id(name),
	type: 'text',
	text,
	style: 'heading',
	tag: size >= 40 ? 'h1' : 'h2',
	css: typo(ctx.tone, size, 800, extra)
});

const eyebrow = (ctx: Ctx, name: string, text: string, extra: Record<string, string> = {}): DemoBlock => ({
	id: ctx.id(name),
	type: 'text',
	text,
	style: 'eyebrow',
	css: { 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.14em', 'text-transform': 'uppercase', color: ctx.tone.muted, ...extra }
});

const body = (ctx: Ctx, name: string, text: string, size = 17, extra: Record<string, string> = {}): DemoBlock => ({
	id: ctx.id(name),
	type: 'text',
	text,
	style: 'body',
	css: { 'font-size': `${size}px`, 'line-height': '1.55', color: ctx.tone.text, ...extra }
});

// pill-shaped call to action: a text block dressed by css (blocks never carry
// markup; the builder keeps it editable like any other text)
const button = (ctx: Ctx, name: string, label: string, variant: 'solid' | 'ghost' = 'solid'): DemoBlock => ({
	id: ctx.id(name),
	type: 'text',
	text: label,
	style: 'body',
	tag: 'span',
	// nowrap: row containers flex their children, and a wrapped pill label
	// reads as a broken button rather than a narrow one
	css:
		variant === 'solid'
			? { display: 'inline-block', padding: '12px 22px', 'border-radius': '999px', background: ctx.tone.accent, color: ctx.tone.accentInk, 'font-weight': '700', 'font-size': '15px', 'white-space': 'nowrap' }
			: { display: 'inline-block', padding: '12px 22px', 'border-radius': '999px', border: `1px solid ${ctx.tone.border}`, color: ctx.tone.ink, 'font-weight': '600', 'font-size': '15px', 'white-space': 'nowrap' }
});

const container = (
	ctx: Ctx,
	name: string,
	direction: 'column' | 'row' | 'grid',
	children: DemoBlock[],
	options: { gap?: number; columns?: number; align?: DemoBlock['align']; maxWidth?: number; css?: Record<string, string> } = {}
): DemoBlock => ({
	id: ctx.id(name),
	type: 'container',
	direction,
	gap: options.gap ?? 4,
	...(direction === 'grid' ? { columns: options.columns ?? 3 } : {}),
	...(options.align ? { align: options.align } : {}),
	...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
	...(options.css ? { css: options.css } : {}),
	children
});

const card = (ctx: Ctx, name: string, children: DemoBlock[], css: Record<string, string> = {}): DemoBlock =>
	container(ctx, name, 'column', children, {
		gap: 2,
		css: { background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '16px', padding: '22px', ...css }
	});

// a gradient placeholder standing in for artwork — no network, no url()
const artwork = (ctx: Ctx, name: string, height = 240, css: Record<string, string> = {}): DemoBlock =>
	container(ctx, name, 'column', [], { gap: 0, css: { background: ctx.tone.gradient, 'min-height': `${height}px`, 'border-radius': '18px', ...css } });

const logo = (ctx: Ctx, name: string): DemoBlock => ({
	id: ctx.id(name),
	type: 'media',
	media: 'image',
	src: '/thingtime-horizontal.svg',
	alt: `${ctx.copy.brand} logo`,
	maxWidth: 160
});

const html = (ctx: Ctx, name: string, markup: string): DemoBlock => ({ id: ctx.id(name), type: 'html', html: markup });

// ---------------------------------------------------------------------------
// Sections — each layout is a small pure function of (ctx) → blocks.
type SectionBuilder = (ctx: Ctx) => DemoBlock[];

const SECTIONS: Record<string, Record<string, SectionBuilder>> = {
	hero: {
		centered: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', ctx.copy.eyebrow, { 'text-align': 'center' }),
				heading(ctx, 'title', ctx.copy.tagline, 52, { 'text-align': 'center' }),
				body(ctx, 'blurb', ctx.copy.blurb, 19, { 'text-align': 'center' }),
				container(ctx, 'ctas', 'row', [button(ctx, 'primary', ctx.copy.ctaPrimary), button(ctx, 'secondary', ctx.copy.ctaSecondary, 'ghost')], { gap: 3, align: 'center' })
			], { gap: 4, align: 'center', maxWidth: 760, css: { padding: '64px 0 40px' } })
		],
		split: (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'copy', 'column', [
					eyebrow(ctx, 'eyebrow', ctx.copy.eyebrow),
					heading(ctx, 'title', ctx.copy.tagline, 46),
					body(ctx, 'blurb', ctx.copy.blurb, 18),
					container(ctx, 'ctas', 'row', [button(ctx, 'primary', ctx.copy.ctaPrimary), button(ctx, 'secondary', ctx.copy.ctaSecondary, 'ghost')], { gap: 3 })
				], { gap: 4 }),
				artwork(ctx, 'art', 320)
			], { columns: 2, gap: 8, css: { padding: '48px 0', 'align-items': 'center' } })
		],
		'with-stats': (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', ctx.copy.eyebrow, { 'text-align': 'center' }),
				heading(ctx, 'title', ctx.copy.tagline, 48, { 'text-align': 'center' }),
				body(ctx, 'blurb', ctx.copy.blurb, 18, { 'text-align': 'center' }),
				button(ctx, 'primary', ctx.copy.ctaPrimary),
				container(ctx, 'stats', 'grid', ctx.copy.stats.map((stat, index) =>
					container(ctx, `stat-${index}`, 'column', [
						{ id: ctx.id(`value-${index}`), type: 'text', text: stat.value, style: 'heading', tag: 'h3', css: typo(ctx.tone, 30, 800, { 'text-align': 'center' }) },
						body(ctx, `label-${index}`, stat.label, 13, { 'text-align': 'center', color: ctx.tone.muted })
					], { gap: 1 })
				), { columns: 4, gap: 4, css: { 'margin-top': '24px', 'border-top': `1px solid ${ctx.tone.border}`, 'padding-top': '24px' } })
			], { gap: 4, align: 'center', maxWidth: 820, css: { padding: '56px 0 32px' } })
		],
		minimal: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', ctx.copy.tagline, 64, { 'max-width': '900px' }),
				body(ctx, 'blurb', ctx.copy.blurb, 20, { 'max-width': '620px' }),
				button(ctx, 'primary', `${ctx.copy.ctaPrimary} →`, 'ghost')
			], { gap: 5, css: { padding: '80px 0 48px' } })
		]
	},
	features: {
		'grid-3': (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Features', { 'text-align': 'center' }),
				heading(ctx, 'title', `Everything ${ctx.copy.brand} does well`, 36, { 'text-align': 'center' }),
				container(ctx, 'grid', 'grid', ctx.copy.features.slice(0, 6).map((feature, index) =>
					card(ctx, `card-${index}`, [
						body(ctx, `emoji-${index}`, feature.emoji, 28),
						{ id: ctx.id(`ftitle-${index}`), type: 'text', text: feature.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 18, 700) },
						body(ctx, `fbody-${index}`, feature.body, 15)
					])
				), { columns: 3, gap: 4 })
			], { gap: 5, css: { padding: '40px 0' } })
		],
		'grid-2': (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', `Why ${ctx.copy.brand}`, 34),
				container(ctx, 'grid', 'grid', ctx.copy.features.slice(0, 4).map((feature, index) =>
					container(ctx, `row-${index}`, 'row', [
						container(ctx, `badge-${index}`, 'column', [body(ctx, `emoji-${index}`, feature.emoji, 22, { 'text-align': 'center' })], { gap: 0, css: { background: ctx.tone.soft, 'border-radius': '12px', width: '48px', 'min-width': '48px', height: '48px', 'justify-content': 'center' } }),
						container(ctx, `text-${index}`, 'column', [
							{ id: ctx.id(`ftitle-${index}`), type: 'text', text: feature.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) },
							body(ctx, `fbody-${index}`, feature.body, 15)
						], { gap: 1 })
					], { gap: 4 })
				), { columns: 2, gap: 6 })
			], { gap: 6, css: { padding: '40px 0' } })
		],
		list: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'What you get'),
				heading(ctx, 'title', ctx.copy.tagline, 34),
				container(ctx, 'list', 'column', ctx.copy.features.slice(0, 5).map((feature, index) =>
					container(ctx, `row-${index}`, 'row', [
						body(ctx, `emoji-${index}`, feature.emoji, 20),
						{ id: ctx.id(`ftitle-${index}`), type: 'text', text: feature.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 16, 700, { 'min-width': '180px' }) },
						body(ctx, `fbody-${index}`, feature.body, 15)
					], { gap: 4, css: { 'border-top': `1px solid ${ctx.tone.border}`, padding: '14px 0', 'align-items': 'baseline' } })
				), { gap: 0 })
			], { gap: 4, maxWidth: 860, css: { padding: '40px 0' } })
		]
	},
	pricing: {
		'three-tier': (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Pricing', { 'text-align': 'center' }),
				heading(ctx, 'title', 'Simple, honest plans', 36, { 'text-align': 'center' }),
				container(ctx, 'plans', 'grid', ctx.copy.plans.map((plan, index) =>
					card(ctx, `plan-${index}`, [
						eyebrow(ctx, `pname-${index}`, plan.name),
						container(ctx, `price-${index}`, 'row', [
							{ id: ctx.id(`amount-${index}`), type: 'text', text: plan.price, style: 'heading', tag: 'h3', css: typo(ctx.tone, 34, 800, { 'white-space': 'nowrap' }) },
							body(ctx, `period-${index}`, plan.period, 13, { color: ctx.tone.muted })
						], { gap: 2, css: { 'align-items': 'baseline' } }),
						body(ctx, `pblurb-${index}`, plan.blurb, 14),
						html(ctx, `perks-${index}`, `<ul style="margin:8px 0 0;padding-left:18px;color:${ctx.tone.text};font-size:14px;line-height:1.7">${plan.perks.map((perk) => `<li>${perk}</li>`).join('')}</ul>`),
						button(ctx, `pcta-${index}`, index === 1 ? ctx.copy.ctaPrimary : 'Choose plan', index === 1 ? 'solid' : 'ghost')
					], index === 1 ? { border: `2px solid ${ctx.tone.accent}` } : {})
				), { columns: 3, gap: 4 })
			], { gap: 5, css: { padding: '40px 0' } })
		],
		'two-tier': (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'intro', 'column', [
					eyebrow(ctx, 'eyebrow', 'Pricing'),
					heading(ctx, 'title', 'Start free, grow when ready', 36),
					body(ctx, 'blurb', 'No credit card, no surprise invoices. Upgrade when your pages need more room.', 16)
				], { gap: 3 }),
				container(ctx, 'plans', 'column', ctx.copy.plans.slice(0, 2).map((plan, index) =>
					card(ctx, `plan-${index}`, [
						container(ctx, `head-${index}`, 'row', [
							{ id: ctx.id(`pname-${index}`), type: 'text', text: plan.name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 18, 700) },
							{ id: ctx.id(`amount-${index}`), type: 'text', text: `${plan.price} ${plan.period}`, style: 'body', css: { 'font-size': '14px', color: ctx.tone.muted, 'margin-left': 'auto', 'white-space': 'nowrap' } }
						], { gap: 3, css: { 'align-items': 'baseline' } }),
						body(ctx, `pblurb-${index}`, `${plan.blurb} ${plan.perks.join(' · ')}`, 14)
					])
				), { gap: 3 })
			], { columns: 2, gap: 8, css: { padding: '40px 0', 'align-items': 'start' } })
		]
	},
	testimonials: {
		'three-cards': (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Loved by people', { 'text-align': 'center' }),
				container(ctx, 'grid', 'grid', ctx.copy.testimonials.map((quote, index) =>
					card(ctx, `quote-${index}`, [
						body(ctx, `text-${index}`, `“${quote.quote}”`, 17, { color: ctx.tone.ink, 'font-weight': '500' }),
						body(ctx, `who-${index}`, `${quote.name} · ${quote.role}`, 13, { color: ctx.tone.muted })
					])
				), { columns: 3, gap: 4 })
			], { gap: 4, css: { padding: '40px 0' } })
		],
		'single-quote': (ctx) => [
			container(ctx, 'wrap', 'column', [
				body(ctx, 'mark', '“', 72, { color: ctx.tone.muted, 'line-height': '0.6', 'text-align': 'center' }),
				{ id: ctx.id('text'), type: 'text', text: ctx.copy.testimonials[0].quote, style: 'heading', tag: 'blockquote', css: typo(ctx.tone, 30, 600, { 'text-align': 'center' }) },
				body(ctx, 'who', `${ctx.copy.testimonials[0].name}, ${ctx.copy.testimonials[0].role}`, 14, { 'text-align': 'center', color: ctx.tone.muted })
			], { gap: 4, align: 'center', maxWidth: 760, css: { padding: '48px 0' } })
		],
		wall: (ctx) => [
			container(ctx, 'wrap', 'grid', [...ctx.copy.testimonials, ctx.copy.testimonials[0]].map((quote, index) =>
				container(ctx, `quote-${index}`, 'column', [
					body(ctx, `text-${index}`, quote.quote, 16, { color: ctx.tone.ink }),
					body(ctx, `who-${index}`, `— ${quote.name}, ${quote.role}`, 13, { color: ctx.tone.muted })
				], { gap: 2, css: { background: ctx.tone.soft, 'border-radius': '14px', padding: '18px' } })
			), { columns: 2, gap: 3, css: { padding: '32px 0' } })
		]
	},
	cta: {
		band: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', `Ready to try ${ctx.copy.brand}?`, 34, { color: ctx.tone.accentInk, 'text-align': 'center' }),
				body(ctx, 'blurb', ctx.copy.blurb, 16, { color: ctx.tone.accentInk, opacity: '0.85', 'text-align': 'center' }),
				{ id: ctx.id('button'), type: 'text', text: ctx.copy.ctaPrimary, style: 'body', tag: 'span', css: { display: 'inline-block', padding: '12px 24px', 'border-radius': '999px', background: ctx.tone.accentInk, color: ctx.tone.accent, 'font-weight': '700' } }
			], { gap: 4, align: 'center', css: { background: ctx.tone.accent, 'border-radius': '24px', padding: '48px 32px' } })
		],
		split: (ctx) => [
			container(ctx, 'wrap', 'row', [
				container(ctx, 'copy', 'column', [
					heading(ctx, 'title', ctx.copy.tagline, 28),
					body(ctx, 'blurb', ctx.copy.blurb, 15)
				], { gap: 2 }),
				container(ctx, 'ctas', 'row', [button(ctx, 'primary', ctx.copy.ctaPrimary), button(ctx, 'secondary', ctx.copy.ctaSecondary, 'ghost')], { gap: 3, css: { 'margin-left': 'auto', 'flex-wrap': 'wrap' } })
			], { gap: 6, css: { background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '20px', padding: '28px 32px', 'align-items': 'center', 'flex-wrap': 'wrap' } })
		],
		card: (ctx) => [
			card(ctx, 'wrap', [
				eyebrow(ctx, 'eyebrow', 'Get started'),
				heading(ctx, 'title', `Join ${ctx.copy.brand} today`, 30),
				body(ctx, 'blurb', ctx.copy.blurb, 15),
				button(ctx, 'primary', ctx.copy.ctaPrimary)
			], { padding: '32px', 'max-width': '520px', 'box-shadow': '0 12px 40px rgba(0,0,0,0.06)' })
		]
	},
	faq: {
		list: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Questions, answered', 32),
				container(ctx, 'items', 'column', ctx.copy.faqs.slice(0, 5).map((faq, index) =>
					container(ctx, `item-${index}`, 'column', [
						{ id: ctx.id(`q-${index}`), type: 'text', text: faq.q, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) },
						body(ctx, `a-${index}`, faq.a, 15)
					], { gap: 1, css: { 'border-top': `1px solid ${ctx.tone.border}`, padding: '16px 0' } })
				), { gap: 0 })
			], { gap: 4, maxWidth: 760, css: { padding: '40px 0' } })
		],
		'two-column': (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'intro', 'column', [eyebrow(ctx, 'eyebrow', 'FAQ'), heading(ctx, 'title', 'Everything you wanted to ask', 32), body(ctx, 'blurb', 'Still curious? The Lopu chat answers the rest.', 15)], { gap: 3 }),
				container(ctx, 'items', 'column', ctx.copy.faqs.slice(0, 4).map((faq, index) =>
					container(ctx, `item-${index}`, 'column', [
						{ id: ctx.id(`q-${index}`), type: 'text', text: faq.q, style: 'heading', tag: 'h3', css: typo(ctx.tone, 16, 700) },
						body(ctx, `a-${index}`, faq.a, 14)
					], { gap: 1 })
				), { gap: 4 })
			], { columns: 2, gap: 8, css: { padding: '40px 0', 'align-items': 'start' } })
		]
	},
	stats: {
		'four-up': (ctx) => [
			container(ctx, 'wrap', 'grid', ctx.copy.stats.map((stat, index) =>
				container(ctx, `stat-${index}`, 'column', [
					{ id: ctx.id(`value-${index}`), type: 'text', text: stat.value, style: 'heading', tag: 'h3', css: typo(ctx.tone, 40, 800) },
					body(ctx, `label-${index}`, stat.label, 14, { color: ctx.tone.muted })
				], { gap: 1, css: { 'border-left': `2px solid ${ctx.tone.border}`, 'padding-left': '16px' } })
			), { columns: 4, gap: 6, css: { padding: '32px 0' } })
		],
		band: (ctx) => [
			container(ctx, 'wrap', 'grid', ctx.copy.stats.map((stat, index) =>
				container(ctx, `stat-${index}`, 'column', [
					{ id: ctx.id(`value-${index}`), type: 'text', text: stat.value, style: 'heading', tag: 'h3', css: typo(ctx.tone, 36, 800, { color: ctx.tone.accentInk, 'text-align': 'center' }) },
					body(ctx, `label-${index}`, stat.label, 13, { color: ctx.tone.accentInk, opacity: '0.8', 'text-align': 'center' })
				], { gap: 1 })
			), { columns: 4, gap: 4, css: { background: ctx.tone.accent, 'border-radius': '20px', padding: '32px 24px' } })
		]
	},
	team: {
		'grid-4': (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'The team', { 'text-align': 'center' }),
				heading(ctx, 'title', `The people behind ${ctx.copy.brand}`, 32, { 'text-align': 'center' }),
				container(ctx, 'grid', 'grid', ctx.copy.team.map((member, index) =>
					container(ctx, `member-${index}`, 'column', [
						container(ctx, `avatar-${index}`, 'column', [body(ctx, `emoji-${index}`, member.emoji, 34, { 'text-align': 'center' })], { gap: 0, css: { background: ctx.tone.gradient, 'border-radius': '999px', width: '84px', height: '84px', 'justify-content': 'center', margin: '0 auto' } }),
						{ id: ctx.id(`name-${index}`), type: 'text', text: member.name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700, { 'text-align': 'center' }) },
						body(ctx, `role-${index}`, member.role, 13, { color: ctx.tone.muted, 'text-align': 'center' })
					], { gap: 2 })
				), { columns: 4, gap: 4 })
			], { gap: 5, css: { padding: '40px 0' } })
		],
		rows: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Who you will work with', 30),
				container(ctx, 'list', 'column', ctx.copy.team.map((member, index) =>
					container(ctx, `member-${index}`, 'row', [
						body(ctx, `emoji-${index}`, member.emoji, 24),
						{ id: ctx.id(`name-${index}`), type: 'text', text: member.name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 16, 700, { 'min-width': '120px' }) },
						body(ctx, `role-${index}`, member.role, 14, { color: ctx.tone.muted })
					], { gap: 4, css: { background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '14px', padding: '14px 18px', 'align-items': 'center' } })
				), { gap: 2 })
			], { gap: 4, maxWidth: 680, css: { padding: '32px 0' } })
		]
	},
	'logo-cloud': {
		row: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Trusted by teams at', { 'text-align': 'center' }),
				container(ctx, 'logos', 'grid', ctx.copy.logos.map((name, index) =>
					body(ctx, `logo-${index}`, name, 18, { 'font-weight': '800', 'letter-spacing': '-0.01em', color: ctx.tone.muted, 'text-align': 'center' })
				), { columns: 6, gap: 4, css: { 'align-items': 'center' } })
			], { gap: 4, css: { padding: '24px 0' } })
		],
		grid: (ctx) => [
			container(ctx, 'wrap', 'grid', ctx.copy.logos.map((name, index) =>
				container(ctx, `cell-${index}`, 'column', [body(ctx, `logo-${index}`, name, 16, { 'font-weight': '700', color: ctx.tone.text, 'text-align': 'center' })], { gap: 0, css: { background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '12px', padding: '22px 12px' } })
			), { columns: 3, gap: 3, css: { padding: '24px 0' } })
		]
	},
	steps: {
		numbered: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'How it works'),
				heading(ctx, 'title', 'Four steps, no surprises', 32),
				container(ctx, 'list', 'column', ctx.copy.steps.map((step, index) =>
					container(ctx, `step-${index}`, 'row', [
						container(ctx, `num-${index}`, 'column', [body(ctx, `n-${index}`, String(index + 1), 15, { 'font-weight': '800', color: ctx.tone.accentInk, 'text-align': 'center' })], { gap: 0, css: { background: ctx.tone.accent, 'border-radius': '999px', width: '32px', 'min-width': '32px', height: '32px', 'justify-content': 'center' } }),
						container(ctx, `text-${index}`, 'column', [
							{ id: ctx.id(`title-${index}`), type: 'text', text: step.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) },
							body(ctx, `body-${index}`, step.body, 15)
						], { gap: 1 })
					], { gap: 4 })
				), { gap: 5 })
			], { gap: 4, maxWidth: 720, css: { padding: '40px 0' } })
		],
		columns: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'How it works', 32, { 'text-align': 'center' }),
				container(ctx, 'grid', 'grid', ctx.copy.steps.slice(0, 3).map((step, index) =>
					card(ctx, `step-${index}`, [
						eyebrow(ctx, `label-${index}`, `Step ${index + 1}`),
						{ id: ctx.id(`title-${index}`), type: 'text', text: step.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 19, 700) },
						body(ctx, `body-${index}`, step.body, 15)
					])
				), { columns: 3, gap: 4 })
			], { gap: 5, css: { padding: '40px 0' } })
		]
	},
	gallery: {
		'grid-3': (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Recent work', 32),
				container(ctx, 'grid', 'grid', [0, 1, 2, 3, 4, 5].map((index) =>
					container(ctx, `item-${index}`, 'column', [
						artwork(ctx, `art-${index}`, 180, index % 2 ? { opacity: '0.85' } : {}),
						body(ctx, `caption-${index}`, `${ctx.copy.logos[index]} — ${ctx.copy.features[index].title}`, 13, { color: ctx.tone.muted })
					], { gap: 2 })
				), { columns: 3, gap: 4 })
			], { gap: 5, css: { padding: '40px 0' } })
		],
		'two-up': (ctx) => [
			container(ctx, 'wrap', 'grid', [
				artwork(ctx, 'big', 420),
				container(ctx, 'stack', 'column', [artwork(ctx, 'small-a', 200), artwork(ctx, 'small-b', 200, { opacity: '0.8' })], { gap: 4 })
			], { columns: 2, gap: 4, css: { padding: '32px 0' } })
		]
	},
	footer: {
		columns: (ctx) => [
			container(ctx, 'wrap', 'column', [
				container(ctx, 'grid', 'grid', [
					container(ctx, 'brand', 'column', [logo(ctx, 'logo'), body(ctx, 'blurb', ctx.copy.tagline, 14, { color: ctx.tone.muted })], { gap: 3 }),
					...[0, 1, 2].map((column) =>
						container(ctx, `col-${column}`, 'column', [
							eyebrow(ctx, `head-${column}`, ['Product', 'Company', 'Resources'][column]),
							...ctx.copy.links.slice(column * 2, column * 2 + 2).map((link, index) => body(ctx, `link-${column}-${index}`, link, 14, { color: ctx.tone.text }))
						], { gap: 2 })
					)
				], { columns: 4, gap: 6 }),
				body(ctx, 'legal', `© 2026 ${ctx.copy.brand}. Built with Thingtime.`, 12, { color: ctx.tone.muted })
			], { gap: 6, css: { 'border-top': `1px solid ${ctx.tone.border}`, padding: '40px 0 24px' } })
		],
		minimal: (ctx) => [
			container(ctx, 'wrap', 'row', [
				body(ctx, 'legal', `© 2026 ${ctx.copy.brand}`, 13, { color: ctx.tone.muted }),
				container(ctx, 'links', 'row', ctx.copy.links.slice(0, 4).map((link, index) => body(ctx, `link-${index}`, link, 13, { color: ctx.tone.text, 'white-space': 'nowrap' })), { gap: 4, css: { 'margin-left': 'auto', 'flex-wrap': 'wrap' } })
			], { gap: 4, css: { 'border-top': `1px solid ${ctx.tone.border}`, padding: '20px 0', 'align-items': 'center', 'flex-wrap': 'wrap' } })
		],
		'cta-links': (ctx) => [
			container(ctx, 'wrap', 'column', [
				container(ctx, 'top', 'row', [
					heading(ctx, 'title', ctx.copy.ctaPrimary, 26),
					button(ctx, 'button', ctx.copy.ctaPrimary)
				], { gap: 4, css: { 'align-items': 'center', 'justify-content': 'space-between', 'flex-wrap': 'wrap' } }),
				container(ctx, 'links', 'row', ctx.copy.links.map((link, index) => body(ctx, `link-${index}`, link, 13, { color: ctx.tone.muted })), { gap: 4, css: { 'flex-wrap': 'wrap' } })
			], { gap: 5, css: { background: ctx.tone.soft, 'border-radius': '20px', padding: '28px 32px' } })
		]
	},
	header: {
		simple: (ctx) => [
			container(ctx, 'wrap', 'row', [
				logo(ctx, 'logo'),
				container(ctx, 'links', 'row', ctx.copy.links.slice(0, 4).map((link, index) => body(ctx, `link-${index}`, link, 14, { color: ctx.tone.text, 'font-weight': '500', 'white-space': 'nowrap' })), { gap: 5, css: { 'margin-left': 'auto', 'flex-wrap': 'wrap' } })
			], { gap: 4, css: { padding: '14px 0', 'align-items': 'center', 'border-bottom': `1px solid ${ctx.tone.border}` } })
		],
		centered: (ctx) => [
			container(ctx, 'wrap', 'column', [
				logo(ctx, 'logo'),
				container(ctx, 'links', 'row', ctx.copy.links.slice(0, 5).map((link, index) => body(ctx, `link-${index}`, link, 13, { color: ctx.tone.muted, 'text-transform': 'uppercase', 'letter-spacing': '0.08em', 'white-space': 'nowrap' })), { gap: 5, align: 'center', css: { 'flex-wrap': 'wrap', 'justify-content': 'center' } })
			], { gap: 3, align: 'center', css: { padding: '20px 0', 'border-bottom': `1px solid ${ctx.tone.border}` } })
		],
		'with-cta': (ctx) => [
			container(ctx, 'wrap', 'row', [
				{ id: ctx.id('brand'), type: 'text', text: ctx.copy.brand, style: 'heading', tag: 'span', css: typo(ctx.tone, 18, 800) },
				container(ctx, 'links', 'row', ctx.copy.links.slice(0, 3).map((link, index) => body(ctx, `link-${index}`, link, 14, { color: ctx.tone.text, 'white-space': 'nowrap' })), { gap: 4, css: { 'margin-left': 'auto', 'flex-wrap': 'wrap' } }),
				button(ctx, 'cta', ctx.copy.ctaPrimary)
			], { gap: 5, css: { padding: '12px 0', 'align-items': 'center', 'flex-wrap': 'wrap' } })
		]
	},
	newsletter: {
		inline: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Get the monthly letter', 28),
				body(ctx, 'blurb', 'One email a month: what shipped, what we learned, what is next. No tracking.', 15),
				html(ctx, 'form', `<div style="display:flex;gap:8px;flex-wrap:wrap"><span style="flex:1;min-width:200px;padding:12px 14px;border:1px solid ${ctx.tone.border};border-radius:12px;color:${ctx.tone.muted};background:${ctx.tone.surface}">you@example.com</span><span style="padding:12px 20px;border-radius:12px;background:${ctx.tone.accent};color:${ctx.tone.accentInk};font-weight:700">Subscribe</span></div>`)
			], { gap: 3, maxWidth: 560, css: { padding: '32px 0' } })
		],
		card: (ctx) => [
			card(ctx, 'wrap', [
				eyebrow(ctx, 'eyebrow', 'Newsletter'),
				heading(ctx, 'title', `${ctx.copy.brand}, monthly`, 26),
				body(ctx, 'blurb', 'Short, useful, and easy to leave.', 15),
				html(ctx, 'form', `<div style="display:flex;gap:8px;flex-wrap:wrap"><span style="flex:1;min-width:180px;padding:11px 14px;border:1px solid ${ctx.tone.border};border-radius:999px;color:${ctx.tone.muted}">Email address</span><span style="padding:11px 18px;border-radius:999px;background:${ctx.tone.accent};color:${ctx.tone.accentInk};font-weight:700">Join</span></div>`)
			], { padding: '28px', 'max-width': '480px' })
		]
	},
	'blog-list': {
		cards: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'From the journal', 32),
				container(ctx, 'grid', 'grid', ctx.copy.posts.map((post, index) =>
					container(ctx, `post-${index}`, 'column', [
						artwork(ctx, `art-${index}`, 150),
						eyebrow(ctx, `date-${index}`, post.date),
						{ id: ctx.id(`ptitle-${index}`), type: 'text', text: post.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 19, 700) },
						body(ctx, `pblurb-${index}`, post.blurb, 14)
					], { gap: 2 })
				), { columns: 3, gap: 5 })
			], { gap: 5, css: { padding: '40px 0' } })
		],
		list: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Writing'),
				container(ctx, 'list', 'column', ctx.copy.posts.map((post, index) =>
					container(ctx, `post-${index}`, 'row', [
						body(ctx, `date-${index}`, post.date, 13, { color: ctx.tone.muted, 'min-width': '90px' }),
						container(ctx, `text-${index}`, 'column', [
							{ id: ctx.id(`ptitle-${index}`), type: 'text', text: post.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 18, 700) },
							body(ctx, `pblurb-${index}`, post.blurb, 14)
						], { gap: 1 })
					], { gap: 4, css: { 'border-top': `1px solid ${ctx.tone.border}`, padding: '16px 0' } })
				), { gap: 0 })
			], { gap: 3, maxWidth: 720, css: { padding: '32px 0' } })
		]
	},
	contact: {
		card: (ctx) => [
			card(ctx, 'wrap', [
				heading(ctx, 'title', 'Say hello', 28),
				body(ctx, 'blurb', `We read everything. Expect a reply from a human at ${ctx.copy.brand} within a day.`, 15),
				html(ctx, 'form', `<div style="display:grid;gap:10px"><span style="padding:12px 14px;border:1px solid ${ctx.tone.border};border-radius:12px;color:${ctx.tone.muted}">Your name</span><span style="padding:12px 14px;border:1px solid ${ctx.tone.border};border-radius:12px;color:${ctx.tone.muted}">Email</span><span style="padding:12px 14px;border:1px solid ${ctx.tone.border};border-radius:12px;color:${ctx.tone.muted};min-height:90px">How can we help?</span></div>`),
				button(ctx, 'send', 'Send message')
			], { padding: '28px', 'max-width': '520px' })
		],
		split: (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'info', 'column', [
					eyebrow(ctx, 'eyebrow', 'Contact'),
					heading(ctx, 'title', 'Come and find us', 32),
					body(ctx, 'address', '12 Harbour Lane, Sydney · Mon–Fri 9–5', 15),
					body(ctx, 'email', `hello@${ctx.copy.brand.toLowerCase().replace(/[^a-z]/g, '')}.example`, 15, { color: ctx.tone.ink, 'font-weight': '600' })
				], { gap: 3 }),
				artwork(ctx, 'map', 260)
			], { columns: 2, gap: 8, css: { padding: '40px 0', 'align-items': 'center' } })
		]
	},
	timeline: {
		vertical: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Changelog', 30),
				container(ctx, 'list', 'column', ctx.copy.posts.map((post, index) =>
					container(ctx, `entry-${index}`, 'row', [
						container(ctx, `dot-${index}`, 'column', [], { gap: 0, css: { width: '10px', 'min-width': '10px', height: '10px', 'border-radius': '999px', background: ctx.tone.accent, 'margin-top': '6px' } }),
						container(ctx, `text-${index}`, 'column', [
							eyebrow(ctx, `date-${index}`, post.date),
							{ id: ctx.id(`etitle-${index}`), type: 'text', text: post.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) },
							body(ctx, `eblurb-${index}`, post.blurb, 14)
						], { gap: 1 })
					], { gap: 4, css: { 'border-left': `2px solid ${ctx.tone.border}`, 'padding-left': '18px', 'padding-bottom': '20px', 'margin-left': '4px' } })
				), { gap: 0 })
			], { gap: 4, maxWidth: 640, css: { padding: '32px 0' } })
		],
		horizontal: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Roadmap', { 'text-align': 'center' }),
				container(ctx, 'grid', 'grid', ctx.copy.steps.map((step, index) =>
					container(ctx, `phase-${index}`, 'column', [
						container(ctx, `bar-${index}`, 'column', [], { gap: 0, css: { height: '4px', 'border-radius': '999px', background: index < 2 ? ctx.tone.accent : ctx.tone.border } }),
						{ id: ctx.id(`ptitle-${index}`), type: 'text', text: step.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 16, 700) },
						body(ctx, `pbody-${index}`, step.body, 13, { color: ctx.tone.muted })
					], { gap: 2 })
				), { columns: 4, gap: 4 })
			], { gap: 4, css: { padding: '32px 0' } })
		]
	},
	comparison: {
		table: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Compare plans', 30),
				html(ctx, 'table', `<table style="width:100%;border-collapse:collapse;font-size:14px;color:${ctx.tone.text}"><thead><tr><th style="text-align:left;padding:10px 8px;border-bottom:1px solid ${ctx.tone.border};color:${ctx.tone.muted};font-size:12px;letter-spacing:.08em;text-transform:uppercase">Feature</th>${ctx.copy.plans.map((plan) => `<th style="text-align:left;padding:10px 8px;border-bottom:1px solid ${ctx.tone.border};color:${ctx.tone.ink}">${plan.name}</th>`).join('')}</tr></thead><tbody>${ctx.copy.features.slice(0, 5).map((feature, index) => `<tr><td style="padding:10px 8px;border-bottom:1px solid ${ctx.tone.border};color:${ctx.tone.ink};font-weight:600">${feature.title}</td>${ctx.copy.plans.map((_, plan) => `<td style="padding:10px 8px;border-bottom:1px solid ${ctx.tone.border}">${plan >= index % 3 ? '✓' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
			], { gap: 4, css: { padding: '32px 0' } })
		]
	},
	banner: {
		'top-bar': (ctx) => [
			container(ctx, 'wrap', 'row', [
				body(ctx, 'text', `✨ ${ctx.copy.posts[0].title} — read the announcement`, 14, { color: ctx.tone.accentInk, 'font-weight': '600', 'text-align': 'center' })
			], { gap: 0, css: { background: ctx.tone.accent, 'border-radius': '12px', padding: '10px 16px', 'justify-content': 'center' } })
		],
		pill: (ctx) => [
			container(ctx, 'wrap', 'row', [
				body(ctx, 'tag', 'New', 12, { 'font-weight': '800', color: ctx.tone.accentInk, background: ctx.tone.accent, padding: '2px 10px', 'border-radius': '999px' }),
				body(ctx, 'text', ctx.copy.posts[0].title, 14, { color: ctx.tone.ink, 'font-weight': '500' }),
				body(ctx, 'arrow', '→', 14, { color: ctx.tone.muted })
			], { gap: 3, align: 'center', css: { border: `1px solid ${ctx.tone.border}`, background: ctx.tone.surface, 'border-radius': '999px', padding: '8px 16px', 'align-items': 'center', 'align-self': 'center' } })
		],
		gradient: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', ctx.copy.posts[0].title, 26),
				body(ctx, 'blurb', ctx.copy.posts[0].blurb, 15),
				button(ctx, 'cta', 'Read more', 'ghost')
			], { gap: 3, css: { background: ctx.tone.gradient, 'border-radius': '20px', padding: '28px 32px' } })
		]
	},
	quote: {
		manifesto: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Our manifesto'),
				{ id: ctx.id('text'), type: 'text', text: `${ctx.copy.tagline} ${ctx.copy.blurb}`, style: 'heading', tag: 'p', css: typo(ctx.tone, 34, 600, { 'line-height': '1.25' }) }
			], { gap: 4, maxWidth: 820, css: { padding: '56px 0' } })
		],
		pull: (ctx) => [
			container(ctx, 'wrap', 'row', [
				container(ctx, 'bar', 'column', [], { gap: 0, css: { width: '4px', 'min-width': '4px', 'border-radius': '999px', background: ctx.tone.accent } }),
				container(ctx, 'text', 'column', [
					{ id: ctx.id('quote'), type: 'text', text: ctx.copy.testimonials[1].quote, style: 'heading', tag: 'blockquote', css: typo(ctx.tone, 24, 600, { 'line-height': '1.3' }) },
					body(ctx, 'who', `${ctx.copy.testimonials[1].name}, ${ctx.copy.testimonials[1].role}`, 13, { color: ctx.tone.muted })
				], { gap: 2 })
			], { gap: 5, maxWidth: 720, css: { padding: '24px 0' } })
		]
	},
	'media-text': {
		'media-left': (ctx) => [
			container(ctx, 'wrap', 'grid', [
				artwork(ctx, 'art', 300),
				container(ctx, 'copy', 'column', [
					eyebrow(ctx, 'eyebrow', ctx.copy.features[0].title),
					heading(ctx, 'title', ctx.copy.features[0].body, 30),
					body(ctx, 'blurb', ctx.copy.blurb, 15),
					button(ctx, 'cta', 'Learn more', 'ghost')
				], { gap: 3 })
			], { columns: 2, gap: 8, css: { padding: '32px 0', 'align-items': 'center' } })
		],
		'media-right': (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'copy', 'column', [
					eyebrow(ctx, 'eyebrow', ctx.copy.features[1].title),
					heading(ctx, 'title', ctx.copy.features[1].body, 30),
					body(ctx, 'blurb', ctx.copy.blurb, 15)
				], { gap: 3 }),
				artwork(ctx, 'art', 300)
			], { columns: 2, gap: 8, css: { padding: '32px 0', 'align-items': 'center' } })
		],
		'media-top': (ctx) => [
			container(ctx, 'wrap', 'column', [
				artwork(ctx, 'art', 360),
				heading(ctx, 'title', ctx.copy.features[2].title, 30, { 'text-align': 'center' }),
				body(ctx, 'blurb', ctx.copy.features[2].body, 16, { 'text-align': 'center' })
			], { gap: 4, align: 'center', maxWidth: 820, css: { padding: '32px 0' } })
		]
	},
	cards: {
		products: (ctx) => [
			container(ctx, 'wrap', 'grid', ctx.copy.plans.map((plan, index) =>
				container(ctx, `product-${index}`, 'column', [
					artwork(ctx, `art-${index}`, 160),
					container(ctx, `row-${index}`, 'row', [
						{ id: ctx.id(`pname-${index}`), type: 'text', text: plan.name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) },
						body(ctx, `price-${index}`, plan.price, 15, { color: ctx.tone.ink, 'font-weight': '600', 'margin-left': 'auto' })
					], { gap: 2 }),
					body(ctx, `pblurb-${index}`, plan.blurb, 14, { color: ctx.tone.muted })
				], { gap: 2 })
			), { columns: 3, gap: 5, css: { padding: '32px 0' } })
		],
		info: (ctx) => [
			container(ctx, 'wrap', 'grid', ctx.copy.features.slice(0, 4).map((feature, index) =>
				card(ctx, `info-${index}`, [
					container(ctx, `head-${index}`, 'row', [body(ctx, `emoji-${index}`, feature.emoji, 22), { id: ctx.id(`ftitle-${index}`), type: 'text', text: feature.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) }], { gap: 3, css: { 'align-items': 'center' } }),
					body(ctx, `fbody-${index}`, feature.body, 14)
				], { background: ctx.tone.soft, border: 'none' })
			), { columns: 2, gap: 4, css: { padding: '24px 0' } })
		]
	},
	checklist: {
		'two-column': (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'intro', 'column', [heading(ctx, 'title', 'Included in every plan', 30), body(ctx, 'blurb', ctx.copy.blurb, 15)], { gap: 3 }),
				container(ctx, 'list', 'column', ctx.copy.features.slice(0, 6).map((feature, index) =>
					container(ctx, `item-${index}`, 'row', [
						body(ctx, `check-${index}`, '✓', 14, { 'font-weight': '800', color: ctx.tone.accentInk, background: ctx.tone.accent, 'border-radius': '999px', width: '22px', height: '22px', 'text-align': 'center', 'line-height': '22px' }),
						body(ctx, `text-${index}`, feature.title, 15, { color: ctx.tone.ink })
					], { gap: 3, css: { 'align-items': 'center' } })
				), { gap: 3 })
			], { columns: 2, gap: 8, css: { padding: '32px 0', 'align-items': 'start' } })
		],
		compact: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Highlights'),
				container(ctx, 'grid', 'grid', ctx.copy.features.map((feature, index) => body(ctx, `item-${index}`, `${feature.emoji} ${feature.title}`, 15, { color: ctx.tone.ink, background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '10px', padding: '10px 14px' })), { columns: 3, gap: 3 })
			], { gap: 3, css: { padding: '24px 0' } })
		]
	},
	video: {
		frame: (ctx) => [
			container(ctx, 'wrap', 'column', [
				container(ctx, 'frame', 'column', [
					container(ctx, 'play', 'column', [body(ctx, 'icon', '▶', 22, { color: ctx.tone.ink, 'text-align': 'center', 'line-height': '64px' })], { gap: 0, css: { width: '64px', height: '64px', 'border-radius': '999px', background: ctx.tone.surface, margin: 'auto', 'box-shadow': '0 8px 24px rgba(0,0,0,0.15)' } })
				], { gap: 0, css: { background: ctx.tone.gradient, 'border-radius': '20px', 'min-height': '360px', 'justify-content': 'center' } }),
				body(ctx, 'caption', `Watch: ${ctx.copy.posts[0].title} (3:12)`, 13, { color: ctx.tone.muted, 'text-align': 'center' })
			], { gap: 3, align: 'center', maxWidth: 860, css: { padding: '32px 0' } })
		]
	},
	profile: {
		'bio-links': (ctx) => [
			container(ctx, 'wrap', 'column', [
				container(ctx, 'avatar', 'column', [body(ctx, 'emoji', ctx.copy.team[0].emoji, 40, { 'text-align': 'center' })], { gap: 0, css: { width: '96px', height: '96px', 'border-radius': '999px', background: ctx.tone.gradient, 'justify-content': 'center', margin: '0 auto' } }),
				heading(ctx, 'name', ctx.copy.team[0].name, 26, { 'text-align': 'center' }),
				body(ctx, 'bio', `${ctx.copy.team[0].role} at ${ctx.copy.brand}. ${ctx.copy.tagline}`, 15, { 'text-align': 'center' }),
				container(ctx, 'links', 'column', ctx.copy.links.slice(0, 5).map((link, index) =>
					body(ctx, `link-${index}`, link, 15, { color: ctx.tone.ink, 'font-weight': '600', 'text-align': 'center', background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '14px', padding: '14px' })
				), { gap: 3 })
			], { gap: 4, align: 'center', maxWidth: 420, css: { padding: '40px 0' } })
		],
		card: (ctx) => [
			card(ctx, 'wrap', [
				container(ctx, 'head', 'row', [
					container(ctx, 'avatar', 'column', [body(ctx, 'emoji', ctx.copy.team[1].emoji, 26, { 'text-align': 'center' })], { gap: 0, css: { width: '56px', 'min-width': '56px', height: '56px', 'border-radius': '999px', background: ctx.tone.gradient, 'justify-content': 'center' } }),
					container(ctx, 'names', 'column', [
						{ id: ctx.id('name'), type: 'text', text: ctx.copy.team[1].name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 18, 700) },
						body(ctx, 'role', `${ctx.copy.team[1].role} · ${ctx.copy.brand}`, 13, { color: ctx.tone.muted })
					], { gap: 0 })
				], { gap: 4, css: { 'align-items': 'center' } }),
				body(ctx, 'bio', ctx.copy.blurb, 14),
				container(ctx, 'actions', 'row', [button(ctx, 'follow', 'Follow'), button(ctx, 'message', 'Message', 'ghost')], { gap: 2 })
			], { 'max-width': '440px' })
		]
	},
	schedule: {
		day: (ctx) => [
			container(ctx, 'wrap', 'column', [
				heading(ctx, 'title', 'Schedule', 30),
				container(ctx, 'list', 'column', ctx.copy.steps.map((step, index) =>
					container(ctx, `slot-${index}`, 'row', [
						body(ctx, `time-${index}`, `${9 + index * 2}:00`, 14, { color: ctx.tone.muted, 'min-width': '64px', 'font-weight': '600' }),
						container(ctx, `text-${index}`, 'column', [
							{ id: ctx.id(`stitle-${index}`), type: 'text', text: step.title, style: 'heading', tag: 'h3', css: typo(ctx.tone, 17, 700) },
							body(ctx, `sbody-${index}`, step.body, 14)
						], { gap: 1 })
					], { gap: 4, css: { background: ctx.tone.surface, border: `1px solid ${ctx.tone.border}`, 'border-radius': '14px', padding: '14px 18px' } })
				), { gap: 2 })
			], { gap: 4, maxWidth: 680, css: { padding: '32px 0' } })
		]
	},
	menu: {
		courses: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'eyebrow', 'Tonight', { 'text-align': 'center' }),
				heading(ctx, 'title', ctx.copy.brand, 34, { 'text-align': 'center' }),
				container(ctx, 'items', 'column', ctx.copy.plans.map((plan, index) =>
					container(ctx, `dish-${index}`, 'column', [
						container(ctx, `row-${index}`, 'row', [
							{ id: ctx.id(`dname-${index}`), type: 'text', text: plan.name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 18, 700) },
							body(ctx, `dprice-${index}`, plan.price, 15, { color: ctx.tone.ink, 'margin-left': 'auto' })
						], { gap: 3 }),
						body(ctx, `ddesc-${index}`, plan.perks.join(', '), 14, { color: ctx.tone.muted })
					], { gap: 1, css: { 'border-bottom': `1px dashed ${ctx.tone.border}`, padding: '12px 0' } })
				), { gap: 0 })
			], { gap: 4, maxWidth: 560, css: { padding: '40px 0' } })
		]
	},
	article: {
		single: (ctx) => [
			container(ctx, 'wrap', 'column', [
				eyebrow(ctx, 'date', ctx.copy.posts[0].date),
				heading(ctx, 'title', ctx.copy.posts[0].title, 42),
				body(ctx, 'lede', ctx.copy.posts[0].blurb, 20, { color: ctx.tone.ink }),
				artwork(ctx, 'art', 280),
				body(ctx, 'p1', `${ctx.copy.blurb} ${ctx.copy.features[0].body} ${ctx.copy.features[1].body}`, 17),
				{ id: ctx.id('h2'), type: 'text', text: ctx.copy.features[2].title, style: 'heading', tag: 'h2', css: typo(ctx.tone, 26, 700) },
				body(ctx, 'p2', `${ctx.copy.features[2].body} ${ctx.copy.features[3].body}`, 17),
				html(ctx, 'list', `<ul style="padding-left:20px;color:${ctx.tone.text};font-size:17px;line-height:1.7">${ctx.copy.steps.map((step) => `<li><strong style="color:${ctx.tone.ink}">${step.title}.</strong> ${step.body}</li>`).join('')}</ul>`)
			], { gap: 4, maxWidth: 680, css: { padding: '40px 0' } })
		],
		sidebar: (ctx) => [
			container(ctx, 'wrap', 'grid', [
				container(ctx, 'nav', 'column', [
					eyebrow(ctx, 'label', 'On this page'),
					...ctx.copy.features.slice(0, 5).map((feature, index) => body(ctx, `nav-${index}`, feature.title, 14, { color: index === 0 ? ctx.tone.ink : ctx.tone.muted, 'font-weight': index === 0 ? '600' : '400' }))
				], { gap: 2, css: { 'border-right': `1px solid ${ctx.tone.border}`, 'padding-right': '16px' } }),
				container(ctx, 'doc', 'column', [
					heading(ctx, 'title', ctx.copy.features[0].title, 34),
					body(ctx, 'p1', `${ctx.copy.features[0].body} ${ctx.copy.blurb}`, 16),
					html(ctx, 'code', `<pre style="background:${ctx.tone.soft};border-radius:12px;padding:16px;font-size:13px;color:${ctx.tone.ink};overflow:auto">curl https://api.example/v1/things?kind=webpage</pre>`),
					{ id: ctx.id('h2'), type: 'text', text: ctx.copy.features[1].title, style: 'heading', tag: 'h2', css: typo(ctx.tone, 24, 700) },
					body(ctx, 'p2', ctx.copy.features[1].body, 16)
				], { gap: 3 })
			], { columns: 2, gap: 6, css: { padding: '32px 0', 'align-items': 'start', 'grid-template-columns': '200px 1fr' } })
		]
	}
};

// Which tones each section family renders in. Section demos = layouts × tones.
const SECTION_TONES: Record<string, string[]> = {
	hero: ['paper', 'ink', 'mint', 'sunset', 'ocean', 'mono'],
	features: ['paper', 'ink', 'mint', 'ocean', 'mono'],
	pricing: ['paper', 'ink', 'mint', 'sunset', 'ocean'],
	testimonials: ['paper', 'ink', 'sunset', 'mono'],
	cta: ['paper', 'ink', 'mint', 'sunset', 'ocean', 'mono'],
	faq: ['paper', 'ink', 'ocean', 'mono'],
	stats: ['paper', 'ink', 'mint', 'sunset', 'ocean'],
	team: ['paper', 'ink', 'sunset', 'mono'],
	'logo-cloud': ['paper', 'ink', 'ocean', 'mono'],
	steps: ['paper', 'ink', 'mint', 'mono'],
	gallery: ['paper', 'ink', 'sunset', 'ocean'],
	footer: ['paper', 'ink', 'mint', 'ocean', 'mono'],
	header: ['paper', 'ink', 'mint', 'sunset', 'mono'],
	newsletter: ['paper', 'ink', 'sunset', 'mono'],
	'blog-list': ['paper', 'ink', 'ocean', 'mono'],
	contact: ['paper', 'ink', 'mint', 'mono'],
	timeline: ['paper', 'ink', 'ocean', 'mono'],
	comparison: ['paper', 'ink', 'mint', 'mono'],
	banner: ['paper', 'ink', 'mint', 'sunset', 'ocean'],
	quote: ['paper', 'ink', 'sunset', 'mono'],
	'media-text': ['paper', 'ink', 'mint', 'ocean'],
	cards: ['paper', 'ink', 'sunset', 'mono'],
	checklist: ['paper', 'ink', 'mint', 'mono'],
	video: ['paper', 'ink', 'ocean', 'mono'],
	profile: ['paper', 'ink', 'sunset', 'mono'],
	schedule: ['paper', 'ink', 'mint', 'mono'],
	menu: ['paper', 'ink', 'sunset', 'mono'],
	article: ['paper', 'ink', 'ocean', 'mono']
};

export const WEBPAGE_DEMO_FAMILIES: WebpageDemoFamily[] = [
	{ key: 'hero', title: 'Hero', emoji: '🌅', kind: 'section', description: 'Opening statements — centered, split, with stats, and minimal.' },
	{ key: 'features', title: 'Features', emoji: '✨', kind: 'section', description: 'Grids and lists that explain what a thing does.' },
	{ key: 'pricing', title: 'Pricing', emoji: '💸', kind: 'section', description: 'Tiered plans with perks and a highlighted recommendation.' },
	{ key: 'testimonials', title: 'Testimonials', emoji: '💬', kind: 'section', description: 'Quotes as cards, a single pull, or a wall.' },
	{ key: 'cta', title: 'Call to action', emoji: '🚀', kind: 'section', description: 'Bands, split rows, and cards that ask for the click.' },
	{ key: 'faq', title: 'FAQ', emoji: '❓', kind: 'section', description: 'Question lists in one or two columns.' },
	{ key: 'stats', title: 'Stats', emoji: '📈', kind: 'section', description: 'Four-up numbers, plain or as a tinted band.' },
	{ key: 'team', title: 'Team', emoji: '🧑‍🤝‍🧑', kind: 'section', description: 'People grids and row cards.' },
	{ key: 'logo-cloud', title: 'Logo cloud', emoji: '☁️', kind: 'section', description: 'Trusted-by rows and tiles.' },
	{ key: 'steps', title: 'Steps', emoji: '🪜', kind: 'section', description: 'How-it-works sequences, numbered or in columns.' },
	{ key: 'gallery', title: 'Gallery', emoji: '🖼', kind: 'section', description: 'Artwork grids with captions.' },
	{ key: 'footer', title: 'Footer', emoji: '🦶', kind: 'section', description: 'Link columns, minimal bars, and cta footers.' },
	{ key: 'header', title: 'Header', emoji: '🧭', kind: 'section', description: 'Navigation rows — simple, centered, with a cta.' },
	{ key: 'newsletter', title: 'Newsletter', emoji: '✉️', kind: 'section', description: 'Inline and card signup forms.' },
	{ key: 'blog-list', title: 'Blog list', emoji: '📰', kind: 'section', description: 'Post cards and date-led lists.' },
	{ key: 'contact', title: 'Contact', emoji: '📮', kind: 'section', description: 'Forms and split info + map panels.' },
	{ key: 'timeline', title: 'Timeline', emoji: '🕰', kind: 'section', description: 'Changelogs and roadmaps.' },
	{ key: 'comparison', title: 'Comparison', emoji: '⚖️', kind: 'section', description: 'A plan × feature table as an html block.' },
	{ key: 'banner', title: 'Banner', emoji: '📣', kind: 'section', description: 'Announcement bars, pills, and gradient cards.' },
	{ key: 'quote', title: 'Quote', emoji: '❝', kind: 'section', description: 'Manifestos and pull quotes.' },
	{ key: 'media-text', title: 'Media + text', emoji: '🖼️', kind: 'section', description: 'Artwork beside or above copy.' },
	{ key: 'cards', title: 'Cards', emoji: '🃏', kind: 'section', description: 'Product tiles and info cards.' },
	{ key: 'checklist', title: 'Checklist', emoji: '✅', kind: 'section', description: 'Benefit lists with ticks and chips.' },
	{ key: 'video', title: 'Video', emoji: '🎬', kind: 'section', description: 'A framed player placeholder with caption.' },
	{ key: 'profile', title: 'Profile', emoji: '🪪', kind: 'section', description: 'Link-in-bio stacks and profile cards.' },
	{ key: 'schedule', title: 'Schedule', emoji: '🗓', kind: 'section', description: 'Time-slot agendas.' },
	{ key: 'menu', title: 'Menu', emoji: '🍽', kind: 'section', description: 'Dish lists with prices.' },
	{ key: 'article', title: 'Article', emoji: '📝', kind: 'section', description: 'Long-form reading columns, with or without a sidebar.' },
	{ key: 'page', title: 'Full pages', emoji: '📄', kind: 'page', description: 'Whole-page templates composed from the sections above.' },
	{ key: 'component-blocks', title: 'Component blocks', emoji: '🧩', kind: 'component', description: 'Pages that reference library components by key — resolve them through the component seed.' }
];

// ---------------------------------------------------------------------------
// Full pages — ordered section recipes. Each entry names (family, layout);
// the page composer prefixes every section's ids so a page never collides.
const PAGES: Array<{ key: string; title: string; description: string; sections: Array<[string, string]>; tones: string[] }> = [
	{ key: 'landing', title: 'Landing page', description: 'The classic launch page: hero, proof, features, pricing, faq, cta.', sections: [['header', 'simple'], ['hero', 'centered'], ['logo-cloud', 'row'], ['features', 'grid-3'], ['stats', 'band'], ['testimonials', 'three-cards'], ['cta', 'band'], ['footer', 'minimal']], tones: ['paper', 'ink'] },
	{ key: 'startup', title: 'Startup site', description: 'Split hero, how-it-works, pricing, and a newsletter close.', sections: [['header', 'with-cta'], ['hero', 'split'], ['steps', 'columns'], ['pricing', 'two-tier'], ['faq', 'two-column'], ['newsletter', 'inline'], ['footer', 'minimal']], tones: ['paper', 'ocean'] },
	{ key: 'about', title: 'About page', description: 'Manifesto, team, stats, and a contact panel.', sections: [['header', 'centered'], ['quote', 'manifesto'], ['stats', 'four-up'], ['team', 'grid-4'], ['contact', 'split'], ['footer', 'columns']], tones: ['paper', 'mono'] },
	{ key: 'pricing', title: 'Pricing page', description: 'Plans, a comparison table, and the questions people ask.', sections: [['header', 'simple'], ['pricing', 'three-tier'], ['comparison', 'table'], ['faq', 'list'], ['cta', 'split'], ['footer', 'minimal']], tones: ['paper', 'mint'] },
	{ key: 'blog', title: 'Blog index', description: 'A writing home with a featured post and the archive.', sections: [['header', 'simple'], ['banner', 'gradient'], ['blog-list', 'cards'], ['blog-list', 'list'], ['newsletter', 'card'], ['footer', 'minimal']], tones: ['paper', 'ink'] },
	{ key: 'contact', title: 'Contact page', description: 'Split info + map and a message form.', sections: [['header', 'simple'], ['contact', 'split'], ['contact', 'card'], ['footer', 'minimal']], tones: ['paper', 'mono'] },
	// the block cap (120) bounds composites: this recipe uses the lighter
	// pricing/faq/footer layouts so the page keeps room for a viewer's edits
	{ key: 'event', title: 'Event page', description: 'Conference landing with schedule, speakers, and tickets.', sections: [['header', 'with-cta'], ['hero', 'with-stats'], ['schedule', 'day'], ['team', 'rows'], ['pricing', 'two-tier'], ['faq', 'two-column'], ['footer', 'minimal']], tones: ['paper', 'sunset'] },
	{ key: 'portfolio', title: 'Portfolio', description: 'Minimal hero, gallery grids, and a quiet contact footer.', sections: [['header', 'centered'], ['hero', 'minimal'], ['gallery', 'grid-3'], ['gallery', 'two-up'], ['quote', 'pull'], ['footer', 'minimal']], tones: ['paper', 'ink'] },
	{ key: 'product', title: 'Product page', description: 'Media + text stories, cards, checklist, and a cta.', sections: [['header', 'with-cta'], ['hero', 'split'], ['media-text', 'media-left'], ['media-text', 'media-right'], ['checklist', 'two-column'], ['cta', 'card'], ['footer', 'minimal']], tones: ['paper', 'ocean'] },
	{ key: 'docs', title: 'Docs page', description: 'Sidebar navigation beside a reference article.', sections: [['header', 'simple'], ['article', 'sidebar'], ['footer', 'minimal']], tones: ['paper', 'mono'] },
	{ key: 'changelog', title: 'Changelog', description: 'A release timeline with a roadmap strip.', sections: [['header', 'simple'], ['timeline', 'vertical'], ['timeline', 'horizontal'], ['newsletter', 'inline'], ['footer', 'minimal']], tones: ['paper', 'ink'] },
	{ key: 'bio', title: 'Link in bio', description: 'A single-column profile with link buttons.', sections: [['profile', 'bio-links'], ['footer', 'minimal']], tones: ['paper', 'sunset'] },
	{ key: 'restaurant', title: 'Restaurant', description: 'Menu, story, and bookings for a small kitchen.', sections: [['header', 'centered'], ['hero', 'minimal'], ['menu', 'courses'], ['media-text', 'media-top'], ['contact', 'split'], ['footer', 'minimal']], tones: ['paper', 'sunset'] },
	{ key: 'agency', title: 'Agency', description: 'Services grid, client logos, testimonials, and a project cta.', sections: [['header', 'simple'], ['hero', 'centered'], ['features', 'grid-2'], ['logo-cloud', 'grid'], ['testimonials', 'wall'], ['cta', 'split'], ['footer', 'columns']], tones: ['paper', 'mono'] },
	{ key: 'community', title: 'Community', description: 'Membership plans, a schedule, and the people who run it.', sections: [['banner', 'top-bar'], ['header', 'simple'], ['hero', 'with-stats'], ['features', 'list'], ['pricing', 'three-tier'], ['team', 'rows'], ['footer', 'minimal']], tones: ['paper', 'mint'] },
	{ key: 'newsletter', title: 'Newsletter landing', description: 'One promise, proof, and the signup.', sections: [['hero', 'centered'], ['testimonials', 'single-quote'], ['newsletter', 'card'], ['footer', 'minimal']], tones: ['paper', 'ink'] },
	{ key: 'coming-soon', title: 'Coming soon', description: 'A teaser with a waitlist form.', sections: [['banner', 'pill'], ['hero', 'minimal'], ['newsletter', 'inline'], ['footer', 'minimal']], tones: ['paper', 'ocean'] },
	{ key: 'thank-you', title: 'Thank you', description: 'A post-signup confirmation with next steps.', sections: [['hero', 'centered'], ['steps', 'numbered'], ['footer', 'minimal']], tones: ['paper', 'mint'] },
	{ key: 'careers', title: 'Careers', description: 'Culture, team, and a roles list.', sections: [['header', 'simple'], ['quote', 'manifesto'], ['checklist', 'compact'], ['team', 'grid-4'], ['schedule', 'day'], ['cta', 'band'], ['footer', 'minimal']], tones: ['paper', 'mono'] },
	{ key: 'video-launch', title: 'Video launch', description: 'A framed player, stats, and a cta card.', sections: [['header', 'with-cta'], ['video', 'frame'], ['stats', 'four-up'], ['cta', 'card'], ['footer', 'minimal']], tones: ['paper', 'ink'] }
];

// Component-block demos reference LIBRARY component keys (the components-db
// seed). The library names every entry `<library>-<family>-<variant>`, so a
// ref must be a whole seeded componentKey — a family stem like
// `thingtime-card` matches nothing. An unresolved ref renders as NOTHING for a
// viewer (the "not found" card is edit chrome — WebpageBlocksRenderer only
// draws it when the builder passes chrome), so a wrong key here shows an empty
// demo rather than a placeholder. Keep the per-block args below in step with
// the referenced component's own arg names.
export const COMPONENT_DEMO_REFS = [
	'thingtime-button-solid',
	'thingtime-button-outline',
	'thingtime-card-basic',
	'thingtime-badge-solid',
	'thingtime-input-text',
	'thingtime-avatar-status'
];

// thingtime-avatar-status draws `initials`, not a full name — one- or
// two-word demo names both fold to a two-letter monogram.
const monogram = (name: string): string => {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
	return (words[0] || '').slice(0, 2).toUpperCase();
};

const COMPONENT_PAGES: Array<{ key: string; title: string; description: string; build: (ctx: Ctx) => DemoBlock[] }> = [
	{
		key: 'buttons',
		title: 'Button components',
		description: 'Solid and outline library buttons with per-block arg overrides.',
		build: (ctx) => [
			heading(ctx, 'title', 'Buttons from the library', 30),
			body(ctx, 'blurb', 'Each block references a component thing by key and overrides its label arg.', 15),
			container(ctx, 'row', 'row', [
				{ id: ctx.id('solid'), type: 'component', component: COMPONENT_DEMO_REFS[0], args: { label: ctx.copy.ctaPrimary } },
				{ id: ctx.id('outline'), type: 'component', component: COMPONENT_DEMO_REFS[1], args: { label: ctx.copy.ctaSecondary } }
			], { gap: 3, css: { 'flex-wrap': 'wrap' } })
		]
	},
	{
		key: 'cards',
		title: 'Card components',
		description: 'Library cards arranged in a grid with text blocks between.',
		build: (ctx) => [
			heading(ctx, 'title', 'Cards from the library', 30),
			container(ctx, 'grid', 'grid', [0, 1, 2].map((index) => ({ id: ctx.id(`card-${index}`), type: 'component' as const, component: COMPONENT_DEMO_REFS[2], args: { title: ctx.copy.features[index].title, body: ctx.copy.features[index].body } })), { columns: 3, gap: 4 })
		]
	},
	{
		key: 'form',
		title: 'Form components',
		description: 'Inputs and a submit button as component blocks inside a card.',
		build: (ctx) => [
			card(ctx, 'wrap', [
				heading(ctx, 'title', 'Sign up', 26),
				{ id: ctx.id('name'), type: 'component', component: COMPONENT_DEMO_REFS[4], args: { label: 'Name', placeholder: 'Ada Lovelace' } },
				{ id: ctx.id('email'), type: 'component', component: COMPONENT_DEMO_REFS[4], args: { label: 'Email', placeholder: 'you@example.com' } },
				{ id: ctx.id('submit'), type: 'component', component: COMPONENT_DEMO_REFS[0], args: { label: 'Create account' } }
			], { 'max-width': '480px' })
		]
	},
	{
		key: 'mixed',
		title: 'Mixed blocks',
		description: 'Native text and containers around library badges and avatars.',
		build: (ctx) => [
			container(ctx, 'head', 'row', [
				{ id: ctx.id('avatar'), type: 'component', component: COMPONENT_DEMO_REFS[5], args: { initials: monogram(ctx.copy.team[0].name) } },
				container(ctx, 'names', 'column', [
					{ id: ctx.id('name'), type: 'text', text: ctx.copy.team[0].name, style: 'heading', tag: 'h3', css: typo(ctx.tone, 18, 700) },
					{ id: ctx.id('badge'), type: 'component', component: COMPONENT_DEMO_REFS[3], args: { label: ctx.copy.team[0].role } }
				], { gap: 1 })
			], { gap: 4, css: { 'align-items': 'center' } }),
			body(ctx, 'bio', ctx.copy.blurb, 15)
		]
	}
];

// ---------------------------------------------------------------------------
const titleCase = (slug: string): string => slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const copyFor = (layoutIndex: number, toneIndex: number): Copy => COPY[(layoutIndex + toneIndex) % COPY.length];

const familyByKey = new Map(WEBPAGE_DEMO_FAMILIES.map((family) => [family.key, family]));

const buildCatalog = (): WebpageDemo[] => {
	const demos: WebpageDemo[] = [];

	for (const [familyKey, layouts] of Object.entries(SECTIONS)) {
		const family = familyByKey.get(familyKey)!;
		const tones = SECTION_TONES[familyKey] || ['paper'];
		Object.entries(layouts).forEach(([layoutKey, build], layoutIndex) => {
			tones.forEach((toneKey, toneIndex) => {
				const tone = toneByKey.get(toneKey)!;
				const copy = copyFor(layoutIndex, toneIndex);
				const slug = `${familyKey}-${layoutKey}-${toneKey}`;
				demos.push({
					slug,
					name: `${family.title} · ${titleCase(layoutKey)} · ${tone.title}`,
					family: familyKey,
					kind: 'section',
					tone: toneKey,
					layout: layoutKey,
					tags: ['webpage', 'demo', familyKey, 'section', toneKey, layoutKey],
					description: `${family.description} ${titleCase(layoutKey)} layout in the ${tone.title.toLowerCase()} tone, copy from ${copy.brand}.`,
					previewBg: tone.bg,
					blocks: build({ id: makeIds(layoutKey), tone, copy })
				});
			});
		});
	}

	PAGES.forEach((page, pageIndex) => {
		page.tones.forEach((toneKey, toneIndex) => {
			const tone = toneByKey.get(toneKey)!;
			const copy = copyFor(pageIndex, toneIndex);
			const blocks = page.sections.flatMap(([familyKey, layoutKey], sectionIndex) =>
				SECTIONS[familyKey][layoutKey]({ id: makeIds(`s${sectionIndex}-${familyKey}`), tone, copy })
			);
			demos.push({
				slug: `page-${page.key}-${toneKey}`,
				name: `${page.title} · ${tone.title}`,
				family: 'page',
				kind: 'page',
				tone: toneKey,
				layout: page.key,
				tags: ['webpage', 'demo', 'page', page.key, toneKey, ...new Set(page.sections.map(([familyKey]) => familyKey))],
				description: `${page.description} ${page.sections.length} sections in the ${tone.title.toLowerCase()} tone, copy from ${copy.brand}.`,
				previewBg: tone.bg,
				blocks
			});
		});
	});

	COMPONENT_PAGES.forEach((page, pageIndex) => {
		['paper', 'ink'].forEach((toneKey, toneIndex) => {
			const tone = toneByKey.get(toneKey)!;
			const copy = copyFor(pageIndex, toneIndex);
			demos.push({
				slug: `components-${page.key}-${toneKey}`,
				name: `${page.title} · ${tone.title}`,
				family: 'component-blocks',
				kind: 'component',
				tone: toneKey,
				layout: page.key,
				tags: ['webpage', 'demo', 'component-blocks', 'component', page.key, toneKey],
				description: `${page.description} Needs the component library seed to resolve its refs.`,
				previewBg: tone.bg,
				blocks: page.build({ id: makeIds(page.key), tone, copy })
			});
		});
	});

	return demos;
};

let catalog: WebpageDemo[] | null = null;

// The full deterministic catalog (memoised — building is pure and cheap, but
// every gallery render and seed run asks for it).
export const getWebpageDemos = (): WebpageDemo[] => {
	if (!catalog) catalog = buildCatalog();
	return catalog;
};

export const getWebpageDemo = (slug: string): WebpageDemo | null => getWebpageDemos().find((demo) => demo.slug === slug) || null;

export const countDemoBlocks = (blocks: DemoBlock[]): number =>
	blocks.reduce((sum, block) => sum + 1 + (block.children ? countDemoBlocks(block.children) : 0), 0);

// The crystal a demo seeds/saves as — the same shape the builder writes.
export const webpageDemoCrystal = (demo: WebpageDemo): Record<string, unknown> => ({
	name: demo.name,
	description: demo.description,
	pageKey: webpageDemoPageKey(demo.slug),
	version: 1,
	previewBg: demo.previewBg,
	blocks: demo.blocks
});

export type WebpageDemoSummary = Omit<WebpageDemo, 'blocks'> & { id: string; blockCount: number };

export const summarizeWebpageDemo = (demo: WebpageDemo): WebpageDemoSummary => {
	const { blocks, ...rest } = demo;
	return { ...rest, id: webpageDemoShareId(demo.slug), blockCount: countDemoBlocks(blocks) };
};

export const webpageDemoFamilyCounts = (): Array<WebpageDemoFamily & { count: number }> => {
	const counts = new Map<string, number>();
	for (const demo of getWebpageDemos()) counts.set(demo.family, (counts.get(demo.family) || 0) + 1);
	return WEBPAGE_DEMO_FAMILIES.map((family) => ({ ...family, count: counts.get(family.key) || 0 }));
};

// The block helpers, exported for sibling catalogs (schemas/behaviourSuites)
// so every generated page shares one typographic and layout idiom.
export type DemoBlockCtx = Ctx;
export const demoBlockKit = {
	makeIds,
	toneByKey: (key: string): Tone => toneByKey.get(key) || TONES[0],
	defaultCopy: COPY[0],
	heading,
	eyebrow,
	body,
	button,
	container,
	card,
	artwork,
	html
};
