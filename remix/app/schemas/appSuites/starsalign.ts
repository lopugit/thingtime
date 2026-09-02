// STARSALIGN on Thingtime — the astrology day-at-a-glance app
// (starsalign.today) rebuilt as an installable app suite: schema things for
// the birth profile and the school entries, action things over the astro
// domain pack (the ephemeris runs server-side in api/utils/actions/packs/
// astro), component things whose templates draw the day from the action
// results, and six builder pages that link to each other by pageKey.
//
// Everything a visitor sees is a bound block: the `today` component's source
// action searches the viewer's own profile, computes the whole day model with
// astro.today, and the template prints it — signed-out viewers get the intro,
// a viewer without a profile gets the welcome form, and the seeded copy
// offers Install. Users, profiles, and data all live in Thingtime exactly as
// the original app stored them under app-data — now as data things of the
// viewer's own `profile` schema.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites';
import { demoBlockKit, type DemoBlock, type DemoBlockCtx } from '../webpageDemos';

// ── palette (night theme of the original) ───────────────────────────────────
const BG = '#0b0b16';
const RAISED = '#12121f';
const CARD = 'rgba(20, 20, 34, 0.72)';
const INK = '#f0e9dc';
const DIM = '#b9b2a6';
const FAINT = '#7d7870';
const HAIR = 'rgba(255, 255, 255, 0.12)';
const HAIR_STRONG = 'rgba(255, 255, 255, 0.22)';
const ACCENT = '#c9b9ff';
const ACCENT_DIM = 'rgba(201, 185, 255, 0.17)';
const GOLD = '#e8c98a';
const DANGER = '#ff9d9d';
const SERIF = "'Cormorant Garamond', 'Iowan Old Style', Georgia, serif";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const el = (tag: string, style: Record<string, unknown>, children: unknown[] = [], props: Record<string, unknown> = {}): Record<string, unknown> => ({
	tag,
	props: { ...props, style },
	children
});

const text = (content: string, style: Record<string, unknown> = {}): Record<string, unknown> => el('div', { fontFamily: SANS, color: DIM, fontSize: '15px', lineHeight: 1.65, ...style }, [content]);
const serif = (content: string, size = '1.4rem', style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('div', { fontFamily: SERIF, color: INK, fontSize: size, fontWeight: 500, lineHeight: 1.2, letterSpacing: '0.01em', ...style }, [content]);
const eyebrow = (content: string): Record<string, unknown> =>
	el('div', { fontFamily: SANS, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase', color: FAINT }, [content]);
const card = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('div', { background: CARD, border: `1px solid ${HAIR}`, borderRadius: '16px', padding: '22px 22px 18px', display: 'grid', gap: '10px', ...style }, children);
const chip = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px', border: `1px solid ${HAIR}`, borderRadius: '999px', padding: '4px 12px', fontSize: '0.8rem', color: DIM, whiteSpace: 'nowrap', fontFamily: SANS, ...style }, children);
const glyph = (content: string): Record<string, unknown> => el('span', { color: GOLD, fontSize: '1.05em' }, [content]);
const link = (label: unknown, href: string, style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('a', { color: DIM, textDecoration: 'none', fontFamily: SANS, fontSize: '0.95rem', ...style }, [label], { href });
const button = (label: string, action: string, inputs: Record<string, unknown> = {}, tone: 'primary' | 'ghost' | 'danger' = 'primary'): Record<string, unknown> => ({
	tag: 'button',
	props: {
		type: 'button',
		style: {
			fontFamily: SANS,
			fontSize: '0.95rem',
			fontWeight: 600,
			borderRadius: '999px',
			padding: '11px 22px',
			cursor: 'pointer',
			background: tone === 'primary' ? INK : 'transparent',
			color: tone === 'primary' ? BG : tone === 'danger' ? DANGER : DIM,
			border: `1px solid ${tone === 'danger' ? DANGER : tone === 'primary' ? INK : HAIR_STRONG}`
		}
	},
	ttAction: action,
	ttActionInputs: inputs,
	children: [label]
});
const linkButton = (label: string, href: string, primary = false): Record<string, unknown> =>
	el(
		'a',
		{
			display: 'inline-block',
			fontFamily: SANS,
			fontSize: '0.95rem',
			fontWeight: 600,
			borderRadius: '999px',
			padding: '11px 22px',
			textDecoration: 'none',
			background: primary ? INK : 'transparent',
			color: primary ? BG : DIM,
			border: `1px solid ${primary ? INK : HAIR_STRONG}`
		},
		[label],
		{ href }
	);
const row = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('div', { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', ...style }, children);
const field = (label: string, control: Record<string, unknown>): Record<string, unknown> =>
	el('label', { display: 'grid', gap: '6px' }, [el('span', { fontFamily: SANS, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: FAINT }, [label]), control]);
const INPUT_STYLE = { width: '100%', boxSizing: 'border-box', background: RAISED, color: INK, border: `1px solid ${HAIR_STRONG}`, borderRadius: '999px', padding: '11px 18px', fontFamily: SANS, fontSize: '0.95rem' };
const input = (name: string, props: Record<string, unknown> = {}): Record<string, unknown> => ({ tag: 'input', props: { name, style: INPUT_STYLE, ...props } });
const spinner = (label: string): Record<string, unknown> => text(`✶ ${label}`, { color: FAINT });
// a FORM GROUP: a control reads the named fields of its closest fieldset
const group = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('fieldset', { border: 'none', margin: 0, padding: 0, minWidth: 0, display: 'grid', gap: '10px', ...style }, children);

// Templates branch on the runtime scope: `state` (signed-out / not-installed /
// loading / ok / error), `viewer`, `result` (the source action's return),
// `last` (the most recent control run) and `query` (URL params).
const whenState = (state: string, then: unknown, otherwise?: unknown): Record<string, unknown> => ({ ttIf: { arg: 'state', equals: state, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
const ifTruthy = (arg: string, then: unknown, otherwise?: unknown): Record<string, unknown> => ({ ttIf: { arg, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
const each = (arg: string, node: unknown, options: { max?: number; empty?: unknown } = {}): Record<string, unknown> => ({ ttEach: { arg, node, ...options } });

// Sign-in / install / loading / error gates every bound component shares.
const gates = (loadingLabel: string, ready: unknown): Record<string, unknown>[] => [
	whenState('signed-out', card([serif('The sky is already talking to you.', '1.9rem'), text('Sign in with your Thingtime account — your birth data stays in your own things, readable by this app only, erasable any time.'), row([linkButton('Continue with Thingtime 🌈', '/login', true), linkButton('Browse the School first ↓', '/p/starsalign-school')])])),
	whenState('not-installed', card([eyebrow('Install StarsAlign'), serif('Make it yours ✶', '1.7rem'), text('Installing copies the schemas, controls, and programs into your own things. Your day is computed as you, from your own birth profile, on every visit.'), row([button('Install StarsAlign ✨', '$install')])])),
	whenState('loading', card([spinner(loadingLabel)])),
	whenState('error', card([text('Could not read the sky — refresh to try again.', { color: DANGER }), text('{error}', { color: FAINT, fontSize: '0.85rem' })])),
	whenState('ok', ready)
];

// ── components ──────────────────────────────────────────────────────────────

const navComponent: SuiteComponentDef = {
	key: 'nav',
	name: 'StarsAlign nav',
	description: 'The sticky top bar: brand, School, Combinator, Settings.',
	args: [{ name: 'active', type: 'enum', label: 'Active link', values: ['today', 'school', 'combos', 'settings'], default: 'today' }],
	render: () =>
		el('nav', { display: 'flex', alignItems: 'center', gap: '22px', padding: '14px 0', borderBottom: `1px solid ${HAIR}`, maxWidth: '880px', margin: '0 auto', flexWrap: 'wrap' }, [
			link(el('span', { fontFamily: SERIF, fontSize: '1.25rem', letterSpacing: '0.04em', color: INK }, ['Stars', el('span', { color: GOLD }, ['✶']), 'Align']), '/p/starsalign', { marginRight: 'auto' }),
			link('School', '/p/starsalign-school', { color: { ttIf: { arg: 'active', equals: 'school', then: INK, else: DIM } } }),
			link('Combinator', '/p/starsalign-combos', { color: { ttIf: { arg: 'active', equals: 'combos', then: INK, else: DIM } } }),
			ifTruthy('viewer.signedIn', link('{viewer.displayName}', '/p/starsalign-settings', { color: { ttIf: { arg: 'active', equals: 'settings', then: INK, else: DIM } } }), link('Sign in', '/login'))
		])
};

const footerComponent: SuiteComponentDef = {
	key: 'footer',
	name: 'StarsAlign footer',
	description: 'The two-line footer.',
	args: [],
	render: () =>
		el('footer', { display: 'grid', gap: '4px', padding: '28px 0 12px', borderTop: `1px solid ${HAIR}`, maxWidth: '720px', margin: '0 auto', textAlign: 'center' }, [
			text('StarsAlign ✶ your accounts & data live in your own Thingtime 🌈', { fontSize: '0.85rem', color: FAINT }),
			text('For reflection, not prediction. The sky suggests; you decide.', { fontSize: '0.85rem', color: FAINT })
		])
};

// The wheel: pure svg from the precomputed geometry the pack returns.
const wheel = (): Record<string, unknown> => ({
	tag: 'svg',
	props: { viewBox: '0 0 340 340', width: '100%', style: { maxWidth: '340px', display: 'block', margin: '0 auto' }, role: 'img', 'aria-label': 'Chart wheel' },
	children: [
		{ tag: 'circle', props: { cx: '{result.today.wheel.cx}', cy: '{result.today.wheel.cy}', r: '{result.today.wheel.rOuter}', fill: 'none', stroke: HAIR_STRONG, strokeWidth: 1 } },
		{ tag: 'circle', props: { cx: '{result.today.wheel.cx}', cy: '{result.today.wheel.cy}', r: '{result.today.wheel.rSignsInner}', fill: 'none', stroke: HAIR, strokeWidth: 1 } },
		{ tag: 'circle', props: { cx: '{result.today.wheel.cx}', cy: '{result.today.wheel.cy}', r: '{result.today.wheel.rHub}', fill: 'none', stroke: HAIR, strokeWidth: 1 } },
		each('result.today.wheel.spokes', { tag: 'line', props: { x1: '{item.x1}', y1: '{item.y1}', x2: '{item.x2}', y2: '{item.y2}', stroke: HAIR, strokeWidth: 1 } }, { max: 12 }),
		each('result.today.wheel.signs', { tag: 'text', props: { x: '{item.x}', y: '{item.y}', fill: FAINT, fontSize: 13, textAnchor: 'middle', dominantBaseline: 'middle' }, children: ['{item.glyph}'] }, { max: 12 }),
		ifTruthy('result.today.wheel.asc', { tag: 'g', children: [{ tag: 'line', props: { x1: '{result.today.wheel.asc.x1}', y1: '{result.today.wheel.asc.y1}', x2: '{result.today.wheel.asc.x2}', y2: '{result.today.wheel.asc.y2}', stroke: ACCENT, strokeWidth: 1.5 } }, { tag: 'text', props: { x: '{result.today.wheel.asc.labelX}', y: '{result.today.wheel.asc.labelY}', fill: ACCENT, fontSize: 9, letterSpacing: '0.1em', textAnchor: 'middle' }, children: ['ASC'] }] }),
		each('result.today.wheel.natal', { tag: 'g', children: [{ tag: 'circle', props: { cx: '{item.tickX}', cy: '{item.tickY}', r: 1.6, fill: ACCENT, fillOpacity: 0.65 } }, { tag: 'text', props: { x: '{item.x}', y: '{item.y}', fill: ACCENT, fillOpacity: 0.65, fontSize: 12, textAnchor: 'middle', dominantBaseline: 'middle' }, children: ['{item.glyph}'] }] }, { max: 10 }),
		each('result.today.wheel.sky', { tag: 'g', children: [{ tag: 'circle', props: { cx: '{item.tickX}', cy: '{item.tickY}', r: 1.8, fill: GOLD } }, { tag: 'text', props: { x: '{item.x}', y: '{item.y}', fill: GOLD, fontSize: 14, textAnchor: 'middle', dominantBaseline: 'middle' }, children: ['{item.glyph}'] }] }, { max: 10 }),
		{ tag: 'text', props: { x: '{result.today.wheel.cx}', y: '{result.today.wheel.cy}', fill: FAINT, fontSize: 11, letterSpacing: '0.18em', textAnchor: 'middle', dominantBaseline: 'middle' }, children: ['{result.today.wheel.caption}'] }
	]
});

const skyRow = (): Record<string, unknown> =>
	el('a', { display: 'grid', gridTemplateColumns: '34px 1fr auto', alignItems: 'baseline', gap: '12px', padding: '10px 0', borderBottom: `1px solid ${HAIR}`, textDecoration: 'none' }, [
		el('span', { color: GOLD, fontSize: '1.25rem' }, ['{item.glyph}']),
		el('span', { color: INK, fontFamily: SANS, fontSize: '0.95rem' }, ['{item.name} in {item.signName}', ifTruthy('item.retrograde', el('span', { color: ACCENT, fontSize: '0.72rem', verticalAlign: 'super', marginLeft: '4px' }, ['℞']))]),
		el('span', { color: DIM, fontFamily: SANS, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }, ['{item.degree}', ifTruthy('item.houseOrdinal', el('span', {}, [' · {item.houseOrdinal} house']))])
	], { href: '{item.href}' });

const houseRow = (): Record<string, unknown> =>
	el('a', { display: 'grid', gridTemplateColumns: '34px 1fr auto', alignItems: 'baseline', gap: '12px', padding: '10px 0', borderBottom: `1px solid ${HAIR}`, textDecoration: 'none' }, [
		el('span', { color: GOLD, fontSize: '1.05rem', fontFamily: SANS }, ['{item.n}']),
		el('span', { color: INK, fontFamily: SANS, fontSize: '0.95rem' }, ['{item.glyph} {item.signName} · ', el('span', { color: DIM }, ['{item.shortTheme}'])]),
		el('span', { color: GOLD, fontSize: '1rem' }, ['{item.planetGlyphs}'])
	], { href: '{item.href}' });

const transitCard = (): Record<string, unknown> =>
	card([
		eyebrow('{item.glyph} {item.aspectName} · {item.orbLabel}'),
		serif('{item.title}', '1.3rem'),
		text('{item.body}'),
		row([link('about {item.transiting.name} →', '{item.transitHref}', { color: ACCENT, fontSize: '0.85rem' }), link('about {item.natal.name} →', '{item.natalHref}', { color: ACCENT, fontSize: '0.85rem' })])
	]);

const todayBody = (): Record<string, unknown> =>
	el('div', { display: 'grid', gap: '16px' }, [
		ifTruthy(
			'result.hasProfile',
			el('div', { display: 'grid', gap: '16px' }, [
				eyebrow('{result.today.dateLabel}'),
				{ ttIf: { arg: 'result.profile.displayName', then: serif('{result.today.greeting}, {result.profile.displayName}', '2.4rem'), else: serif('{result.today.greeting}, {viewer.displayName}', '2.4rem') } },
				row([
					chip([glyph('☉'), '{result.today.chips.sun.signName} sun']),
					chip([glyph('☾'), '{result.today.chips.moon.signName} moon']),
					ifTruthy('result.today.chips.rising', chip([glyph('↑'), '{result.today.chips.rising.signName} rising']))
				]),
				serif('{result.today.summary}', '1.25rem', { color: DIM, fontStyle: 'italic', lineHeight: 1.5 }),
				card([eyebrow('The wheel · today’s sky around your natal chart'), wheel()]),
				card([eyebrow('Moon'), row([el('span', { fontSize: '1.6rem' }, ['{result.today.moon.emoji}']), text('{result.today.moon.line}', { color: INK }), text('({result.today.moon.percent}% lit)', { color: FAINT, fontSize: '0.85rem' })])]),
				el('section', { display: 'grid', gap: '4px' }, [serif('The sky today', '1.7rem'), each('result.today.sky', skyRow(), { max: 10 }), text('{result.today.houseLine}', { paddingTop: '10px' })]),
				el('section', { display: 'grid', gap: '12px' }, [
					serif('Written for you', '1.7rem'),
					text('{result.today.transitsSubtitle}', { color: FAINT, fontSize: '0.9rem' }),
					each('result.today.transits', transitCard(), { max: 5, empty: card([text('A quiet sky today — no tight aspects to your chart. Rare, and its own kind of gift.')]) })
				]),
				el('section', { display: 'grid', gap: '4px' }, [serif('Your houses today', '1.7rem'), text('{result.today.housesSubtitle}', { color: FAINT, fontSize: '0.9rem' }), each('result.today.houses', houseRow(), { max: 12 })]),
				row([linkButton('Settings & birth data', '/p/starsalign-settings'), linkButton('The School', '/p/starsalign-school'), button('↻ Refresh the sky', '$refresh', {}, 'ghost')])
			]),
			card([
				eyebrow('Welcome, {viewer.displayName}'),
				serif('When did your sky begin?', '2rem'),
				text('Your birth date is the one thing the sky insists on. Birth time and place are optional — they unlock your rising sign and true houses. Stored in your own Thingtime, erasable any time.'),
				row([linkButton('Tell me my sky ✶', '/p/starsalign-settings', true)]),
				eyebrow('Meanwhile, the sky right now'),
				row([chip([glyph('☉'), '{result.today.sky.0.signName} sun']), chip([glyph('☾'), '{result.today.sky.1.signName} moon'])]),
				text('{result.today.moon.emoji} {result.today.moon.line}')
			])
		)
	]);

const todayComponent: SuiteComponentDef = {
	key: 'today',
	name: 'Today',
	description: 'The signed-in daily brief: greeting, chips, summary, moon, wheel, the sky, transits written for you, your houses.',
	args: [],
	render: () => el('div', { display: 'grid', gap: '16px', maxWidth: '720px', margin: '0 auto', padding: '24px 0 40px' }, gates('reading the sky…', todayBody()))
};

const birthFormComponent: SuiteComponentDef = {
	key: 'settings',
	name: 'Settings & birth data',
	description: 'Account card, the birth date / time / place form, the city picker, sign out, erase.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '16px', maxWidth: '720px', margin: '0 auto', padding: '24px 0 40px' }, [
			eyebrow('Settings'),
			serif('Your sky, your data', '2rem'),
			...gates(
				'opening your settings…',
				el('div', { display: 'grid', gap: '16px' }, [
					card([eyebrow('Account'), row([el('span', { fontSize: '1.6rem' }, ['🌈']), el('div', {}, [text('{viewer.displayName}', { color: INK, fontWeight: 600 }), text('@{viewer.username} · via Thingtime', { fontSize: '0.85rem', color: FAINT })])])]),
					card([
						eyebrow('Your birth data'),
						ifTruthy('result.hasProfile', text('Saved to your Thingtime ✶ — {result.profile.birthDate}', { color: ACCENT, fontSize: '0.9rem' }), text('Nothing saved yet — the sky insists on a birth date.', { color: FAINT, fontSize: '0.9rem' })),
						group([
						field('Birth date', input('birthDate', { type: 'date', min: '1900-01-01', value: '{result.profile.birthDate}', required: true })),
						field('Birth time (optional)', input('birthTime', { type: 'time', value: '{result.profile.birthTime}' })),
						el('label', { display: 'flex', gap: '10px', alignItems: 'center', fontFamily: SANS, color: DIM, fontSize: '0.9rem' }, [{ tag: 'input', props: { type: 'checkbox', name: 'timeKnown', checked: '{result.profile.timeKnown}' } }, 'I know my birth time']),
						field('Display name', input('displayName', { type: 'text', maxLength: 60, placeholder: 'How the sky should greet you', value: '{result.profile.displayName}' })),
						ifTruthy(
							'result.profile.placeName',
							group([row([chip([glyph('⌖'), '{result.profile.placeName}, {result.profile.placeCountry} · {result.profile.tz}']), button('× clear place', refs.actionKey('set-place'), { placeName: '', placeCountry: '', lat: 0, lon: 0, tz: '' }, 'ghost')])]),
							text('No birth place yet — pick a city below to unlock your rising sign.', { fontSize: '0.85rem', color: FAINT })
						),
						row([button('Save my sky ✶', refs.actionKey('save-profile'))])
						])
					]),
					card([
						eyebrow('Birth place'),
						group([field('Search a city', input('q', { type: 'search', placeholder: 'Type a city or country…', maxLength: 80 })), row([button('Find', refs.actionKey('pick-city'), {}, 'ghost')])]),
						{
							ttIf: {
								arg: 'last.action',
								equals: refs.actionKey('pick-city'),
								then: group([
									row([
										each('last.result.cities', button('{item.name}, {item.country}', refs.actionKey('set-place'), { placeName: '{item.name}', placeCountry: '{item.country}', lat: '{item.lat}', lon: '{item.lon}', tz: '{item.tz}' }, 'ghost'), {
											max: 8,
											empty: text('No city matched — try the nearest big one.', { fontSize: '0.85rem', color: FAINT })
										})
									])
								])
							}
						}
					]),
					card([
						eyebrow('Session & data'),
						text('StarsAlign keeps exactly one data thing per person — your birth profile — under your own Thingtime account. Erasing it makes StarsAlign forget you completely.'),
						row([linkButton('Sign out', '/logout'), button('Erase my data', refs.actionKey('erase'), {}, 'danger')])
					])
				])
			)
		])
};

const schoolIndexComponent: SuiteComponentDef = {
	key: 'school',
	name: 'The School index',
	description: 'Search across the whole school plus the six section cards and the Combinator.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '16px', maxWidth: '720px', margin: '0 auto', padding: '24px 0 40px' }, [
			eyebrow('The School'),
			serif('A school of stars', '2.4rem'),
			text('Twelve signs, twelve houses, ten planets — and every pairing between them, each with a quick read and a long-form deep dive.'),
			card([
				field('Search anything', input('q', { type: 'search', placeholder: '"mars in libra", "seventh house", "money"…', maxLength: 120 })),
				row([button('Search ✶', refs.actionKey('school-search'))]),
				{
					ttIf: {
						arg: 'last.action',
						equals: refs.actionKey('school-search'),
						then: el('div', { display: 'grid' }, [
							each(
								'last.result.hits',
								el('a', { display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', padding: '10px 0', borderBottom: `1px solid ${HAIR}`, textDecoration: 'none' }, [el('span', {}, [el('span', { color: INK, fontFamily: SANS, fontSize: '0.95rem' }, ['{item.title}']), el('span', { color: DIM, fontFamily: SANS, fontSize: '0.9rem' }, [' — {item.essence}'])]), el('span', { color: FAINT, fontSize: '0.8rem', fontFamily: SANS }, ['{item.section}'])], { href: '{item.href}' }),
								{ max: 30, empty: text('Nothing found — try a planet, sign, house, or theme.', { color: FAINT }) }
							)
						])
					}
				}
			]),
			el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }, [
				each(
					'result.sections',
					el('a', { display: 'grid', gap: '6px', background: CARD, border: `1px solid ${HAIR}`, borderRadius: '16px', padding: '18px', textDecoration: 'none' }, [serif('{item.title}', '1.3rem'), text('{item.count} entries →', { color: ACCENT, fontSize: '0.85rem' }), text('{item.blurb}', { fontSize: '0.9rem' })], { href: '{item.href}' }),
					{ max: 6 }
				),
				el('a', { display: 'grid', gap: '6px', background: CARD, border: `1px solid ${ACCENT}`, borderRadius: '16px', padding: '18px', textDecoration: 'none' }, [serif('The Combinator ✶', '1.3rem'), text('Blend any 2 or 3 of planet / sign / house.', { fontSize: '0.9rem' })], { href: '/p/starsalign-combos' })
			])
		])
};

const schoolSectionComponent: SuiteComponentDef = {
	key: 'section',
	name: 'A School section',
	description: 'One shelf of the school, filterable and paginated, deep-linking to each entry.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '16px', maxWidth: '720px', margin: '0 auto', padding: '24px 0 40px' }, [
			link('← The School', '/p/starsalign-school', { color: FAINT, fontSize: '0.8rem', letterSpacing: '0.18em', textTransform: 'uppercase' }),
			...gates(
				'unrolling the scroll…',
				el('div', { display: 'grid', gap: '16px' }, [
					serif('{result.section.title}', '2.2rem'),
					text('{result.section.blurb}'),
					card([
						field('Filter this shelf', input('filter', { type: 'search', placeholder: 'title, keyword, essence…', maxLength: 80, value: '{query.filter}' })),
						{ tag: 'input', props: { type: 'hidden', name: 'section', value: '{result.section.section}' } },
						row([button('Filter', refs.actionKey('school-section'), { page: 1 }, 'ghost'), text('{result.section.total} entries · page {result.section.page} of {result.section.pages}', { fontSize: '0.85rem', color: FAINT })])
					]),
					{
						ttIf: {
							arg: 'last.action',
							equals: refs.actionKey('school-section'),
							then: each('last.result.section.entries', el('a', { display: 'grid', gridTemplateColumns: '44px 1fr', gap: '14px', padding: '18px 0', borderBottom: `1px solid ${HAIR}`, textDecoration: 'none' }, [el('span', { color: GOLD, fontSize: '1.8rem', lineHeight: 1 }, ['{item.glyph}']), el('span', { display: 'grid', gap: '4px' }, [serif('{item.title}', '1.35rem'), serif('{item.essence}', '1.05rem', { color: DIM, fontStyle: 'italic' }), row([each('item.chips', chip(['{item}'], { fontSize: '0.72rem' }), { max: 5 })])])], { href: '{item.href}' }), { max: 48, empty: text('No matches here.', { color: FAINT }) }),
							else: each('result.section.entries', el('a', { display: 'grid', gridTemplateColumns: '44px 1fr', gap: '14px', padding: '18px 0', borderBottom: `1px solid ${HAIR}`, textDecoration: 'none' }, [el('span', { color: GOLD, fontSize: '1.8rem', lineHeight: 1 }, ['{item.glyph}']), el('span', { display: 'grid', gap: '4px' }, [serif('{item.title}', '1.35rem'), serif('{item.essence}', '1.05rem', { color: DIM, fontStyle: 'italic' }), row([each('item.chips', chip(['{item}'], { fontSize: '0.72rem' }), { max: 5 })])])], { href: '{item.href}' }), { max: 48, empty: text('No matches here.', { color: FAINT }) })
						}
					},
					row([
						{ ttIf: { arg: 'result.section.page', op: 'gt', value: 1, then: linkButton('← Previous', '/p/starsalign-school-section?section={result.section.section}&page={result.section.prevPage}') } },
						{ ttIf: { arg: 'result.section.hasMore', then: linkButton('Next →', '/p/starsalign-school-section?section={result.section.section}&page={result.section.nextPage}') } }
					])
				])
			)
		])
};

const entryComponent: SuiteComponentDef = {
	key: 'entry',
	name: 'A School entry',
	description: 'One entry in full: glyph, chips, essence, quick read, deep dive.',
	args: [],
	render: () =>
		el('div', { display: 'grid', gap: '16px', maxWidth: '720px', margin: '0 auto', padding: '24px 0 40px' }, [
			...gates(
				'opening the entry…',
				ifTruthy(
					'result.entry',
					el('article', { display: 'grid', gap: '14px' }, [
						link('← {result.entry.sectionTitle}', '/p/starsalign-school-section?section={result.entry.section}', { color: FAINT, fontSize: '0.8rem', letterSpacing: '0.18em', textTransform: 'uppercase' }),
						el('div', { color: GOLD, fontSize: '2.6rem', lineHeight: 1 }, ['{result.entry.glyph}']),
						serif('{result.entry.title}', '2.4rem'),
						serif('{result.entry.essence}', '1.2rem', { color: DIM, fontStyle: 'italic' }),
						row([each('result.entry.chips', chip(['{item}']), { max: 6 })]),
						text('{result.entry.keywordsLine}', { fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: FAINT }),
						each('result.entry.short', text('{item}', { color: INK }), { max: 3 }),
						el('div', { borderTop: `1px dashed ${HAIR_STRONG}`, paddingTop: '14px', display: 'grid', gap: '12px' }, [eyebrow('The deep dive'), each('result.entry.deep', text('{item}'), { max: 8 })])
					]),
					card([text('That entry isn’t on any shelf.', { color: DANGER }), link('← The School', '/p/starsalign-school', { color: ACCENT })])
				)
			)
		])
};

const combosComponent: SuiteComponentDef = {
	key: 'combos',
	name: 'The Combinator',
	description: 'Blend any 2 or 3 of planet / sign / house into their pair readings.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '16px', maxWidth: '720px', margin: '0 auto', padding: '24px 0 40px' }, [
			link('← The School', '/p/starsalign-school', { color: FAINT, fontSize: '0.8rem', letterSpacing: '0.18em', textTransform: 'uppercase' }),
			serif('The Combinator ✶', '2.4rem'),
			text('Choose two or three ingredients. Every pair among them yields a reading; all three compose a heading.'),
			...gates(
				'loading the library…',
				el('div', { display: 'grid', gap: '16px' }, [
					card([
						el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }, [
							field('Planet', { tag: 'select', props: { name: 'planet', style: INPUT_STYLE }, children: [{ tag: 'option', props: { value: '' }, children: ['— none —'] }, each('result.meta.planets', { tag: 'option', props: { value: '{item.id}' }, children: ['{item.glyph} {item.name}'] }, { max: 10 })] }),
							field('Sign', { tag: 'select', props: { name: 'sign', style: INPUT_STYLE }, children: [{ tag: 'option', props: { value: '' }, children: ['— none —'] }, each('result.meta.signs', { tag: 'option', props: { value: '{item.id}' }, children: ['{item.glyph} {item.name}'] }, { max: 12 })] }),
							field('House', { tag: 'select', props: { name: 'house', style: INPUT_STYLE }, children: [{ tag: 'option', props: { value: '' }, children: ['— none —'] }, each('result.meta.houses', { tag: 'option', props: { value: '{item.n}' }, children: ['{item.n} · {item.name} — {item.shortTheme}'] }, { max: 12 })] })
						]),
						row([button('Blend ✶', refs.actionKey('combos'))])
					]),
					{
						ttIf: {
							arg: 'last.action',
							equals: refs.actionKey('combos'),
							then: el('div', { display: 'grid', gap: '14px' }, [
								ifTruthy('last.result.heading', card([serif('{last.result.heading}', '1.6rem'), text('Read the pairs below together — where they agree is the easy part; where they argue is the interesting part.')])),
								each(
									'last.result.entries',
									card([el('div', { color: GOLD, fontSize: '2rem', lineHeight: 1 }, ['{item.glyph}']), serif('{item.title}', '1.5rem'), serif('{item.essence}', '1.05rem', { color: DIM, fontStyle: 'italic' }), each('item.short', text('{item}'), { max: 3 }), link('Deep dive →', '{item.href}', { color: ACCENT, fontSize: '0.85rem' })]),
									{ max: 3, empty: text('Choose at least one ingredient above.', { color: FAINT }) }
								)
							])
						}
					}
				])
			)
		])
};

// ── actions ─────────────────────────────────────────────────────────────────

const profileSearch = (refs: SuiteRefs) => ({ op: 'things.search', schema: refs.schema('profile'), limit: 1, sort: { field: 'updatedAt', dir: 'desc' } });
const firstCrystal = (step: string) => ({ ttExpr: ['get', { ttExpr: ['first', step] }, 'crystal', null] });

const todayAction: SuiteActionDef = {
	key: 'today',
	name: 'Today',
	description: 'Reads your birth profile and computes the whole day: the sky, your natal chart, transits written for you, your houses, the wheel.',
	category: 'starsalign',
	inputs: [{ name: 'tz', type: 'string', label: 'Time zone', required: false, maxLength: 64 }],
	steps: (refs) => [
		profileSearch(refs),
		{ op: 'compute', value: firstCrystal('$step.1') },
		{ op: 'compute', value: { ttExpr: ['astro.today', '$step.2', '$now', { ttExpr: ['coalesce', '$input.tz', { ttExpr: ['get', '$step.2', 'tz', null] }, 'UTC'] }] } },
		{ op: 'return', value: { today: '$step.3', profile: '$step.2', hasProfile: { ttExpr: ['not', { ttExpr: ['isEmpty', { ttExpr: ['get', '$step.2', 'birthDate', ''] }] }] } } }
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('profile')] }],
	limits: { timeoutMs: 6000, maxOperations: 8 }
};

const saveProfileAction: SuiteActionDef = {
	key: 'save-profile',
	name: 'Save birth profile',
	description: 'Creates or updates your one birth-profile data thing (date, optional time, display name; the place is set separately).',
	category: 'starsalign',
	inputs: [
		{ name: 'birthDate', type: 'string', label: 'Birth date (YYYY-MM-DD)', required: true, maxLength: 10 },
		{ name: 'birthTime', type: 'string', label: 'Birth time (HH:mm)', required: false, maxLength: 8 },
		{ name: 'timeKnown', type: 'boolean', label: 'Time known', required: false, default: false },
		{ name: 'displayName', type: 'string', label: 'Display name', required: false, maxLength: 60 }
	],
	steps: (refs) => [
		{ op: 'fail', when: { ttExpr: ['not', { ttExpr: ['eq', { ttExpr: ['length', '$input.birthDate'] }, 10] }] }, message: 'Your birth date is the one thing the sky insists on (YYYY-MM-DD).' },
		{ op: 'fail', when: { ttExpr: ['gt', '$input.birthDate', { ttExpr: ['isoDate', '$now'] }] }, message: 'That date is in the future — impressive, but not chartable yet.' },
		profileSearch(refs),
		{ op: 'compute', value: { ttExpr: ['get', { ttExpr: ['first', '$step.3'] }, 'id', null] } },
		{
			op: 'things.update',
			when: '$step.4',
			id: '$step.4',
			values: { birthDate: '$input.birthDate', birthTime: { ttExpr: ['coalesce', '$input.birthTime', ''] }, timeKnown: { ttExpr: ['and', '$input.timeKnown', { ttExpr: ['not', { ttExpr: ['isEmpty', '$input.birthTime'] }] }] }, displayName: { ttExpr: ['coalesce', '$input.displayName', ''] }, updatedAt: '$now' }
		},
		{
			op: 'things.create',
			when: { ttExpr: ['isEmpty', '$step.4'] },
			schema: refs.schema('profile'),
			values: { birthDate: '$input.birthDate', birthTime: { ttExpr: ['coalesce', '$input.birthTime', ''] }, timeKnown: { ttExpr: ['and', '$input.timeKnown', { ttExpr: ['not', { ttExpr: ['isEmpty', '$input.birthTime'] }] }] }, displayName: { ttExpr: ['coalesce', '$input.displayName', ''] }, placeName: '', placeCountry: '', lat: 0, lon: 0, tz: '', updatedAt: '$now' }
		},
		{ op: 'return', value: { title: 'Saved to your Thingtime ✶', message: 'Your sky is written. The day recomputes from it on every visit.', id: { ttExpr: ['coalesce', '$step.4', { ttExpr: ['get', '$step.6', 'id', null] }] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('profile')] },
		{ capability: 'things.create', schemas: [refs.schema('profile')] },
		{ capability: 'things.update', schemas: [refs.schema('profile')] }
	],
	limits: { timeoutMs: 6000, maxOperations: 10 }
};

const setPlaceAction: SuiteActionDef = {
	key: 'set-place',
	name: 'Set birth place',
	description: 'Stores (or clears) the birth place — city, country, coordinates, IANA time zone — on your profile.',
	category: 'starsalign',
	inputs: [
		{ name: 'placeName', type: 'string', label: 'City', required: false, maxLength: 80 },
		{ name: 'placeCountry', type: 'string', label: 'Country', required: false, maxLength: 80 },
		{ name: 'lat', type: 'number', label: 'Latitude', required: false, min: -90, max: 90, default: 0 },
		{ name: 'lon', type: 'number', label: 'Longitude', required: false, min: -180, max: 180, default: 0 },
		{ name: 'tz', type: 'string', label: 'Time zone', required: false, maxLength: 64 }
	],
	steps: (refs) => [
		profileSearch(refs),
		{ op: 'compute', value: { ttExpr: ['get', { ttExpr: ['first', '$step.1'] }, 'id', null] } },
		{ op: 'things.update', when: '$step.2', id: '$step.2', values: { placeName: { ttExpr: ['coalesce', '$input.placeName', ''] }, placeCountry: { ttExpr: ['coalesce', '$input.placeCountry', ''] }, lat: '$input.lat', lon: '$input.lon', tz: { ttExpr: ['coalesce', '$input.tz', ''] }, updatedAt: '$now' } },
		{ op: 'things.create', when: { ttExpr: ['isEmpty', '$step.2'] }, schema: refs.schema('profile'), values: { birthDate: '', birthTime: '', timeKnown: false, displayName: '', placeName: { ttExpr: ['coalesce', '$input.placeName', ''] }, placeCountry: { ttExpr: ['coalesce', '$input.placeCountry', ''] }, lat: '$input.lat', lon: '$input.lon', tz: { ttExpr: ['coalesce', '$input.tz', ''] }, updatedAt: '$now' } },
		{ op: 'return', value: { title: 'Birth place set ⌖', message: { ttExpr: ['if', { ttExpr: ['isEmpty', '$input.placeName'] }, 'Birth place cleared — back to a solar chart.', { ttExpr: ['concat', '$input.placeName', ' · ', '$input.tz', ' — rising sign unlocked once your time is saved.'] }] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('profile')] },
		{ capability: 'things.create', schemas: [refs.schema('profile')] },
		{ capability: 'things.update', schemas: [refs.schema('profile')] }
	],
	limits: { timeoutMs: 6000, maxOperations: 8 }
};

const pickCityAction: SuiteActionDef = {
	key: 'pick-city',
	name: 'Find a city',
	description: 'Matches the 316-city birth-place list (name or country, prefix first).',
	category: 'starsalign',
	inputs: [{ name: 'q', type: 'string', label: 'City or country', required: true, maxLength: 80 }],
	steps: () => [
		{ op: 'compute', value: { ttExpr: ['astro.cities', '$input.q', 8] } },
		{ op: 'return', value: { cities: '$step.1', message: { ttExpr: ['concat', { ttExpr: ['len', '$step.1'] }, ' cities matched'] } } }
	],
	capabilities: () => [],
	limits: { timeoutMs: 3000, maxOperations: 4 }
};

const eraseOneAction: SuiteActionDef = {
	key: 'erase-one',
	name: 'Erase one profile thing',
	description: 'Deletes one of your birth-profile data things by id.',
	category: 'starsalign',
	inputs: [{ name: 'id', type: 'string', label: 'Thing id', required: true, maxLength: 128 }],
	steps: () => [{ op: 'things.delete', id: '$input.id' }, { op: 'return', value: '$step.1' }],
	capabilities: (refs) => [{ capability: 'things.delete', schemas: [refs.schema('profile')] }],
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

const eraseAction: SuiteActionDef = {
	key: 'erase',
	name: 'Erase my data',
	description: 'Deletes every birth-profile data thing you own — StarsAlign forgets you completely.',
	category: 'starsalign',
	inputs: [],
	steps: (refs) => [
		{ op: 'things.search', schema: refs.schema('profile'), limit: 20 },
		{ op: 'each', list: '$step.1', action: refs.action('erase-one'), max: 20, inputs: { id: '$item.id' } },
		{ op: 'return', value: { title: 'Erased ✶', message: { ttExpr: ['concat', 'Deleted ', { ttExpr: ['len', '$step.2'] }, ' profile thing(s). StarsAlign has forgotten you.'] }, deleted: { ttExpr: ['len', '$step.2'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('profile')] },
		{ capability: 'actions.invoke', actions: [refs.action('erase-one')] }
	],
	limits: { timeoutMs: 8000, maxOperations: 30, maxChildActions: 20 }
};

const schoolAction: SuiteActionDef = {
	key: 'school',
	name: 'The School index',
	description: 'The six section shelves with their counts and links.',
	category: 'starsalign',
	inputs: [],
	steps: () => [
		{ op: 'compute', value: { ttExpr: ['astro.meta'] } },
		{ op: 'return', value: { sections: { ttExpr: ['map', '$step.1.sections', { ttExpr: ['merge', '$item', { href: { ttExpr: ['concat', '/p/starsalign-school-section?section=', '$item.id'] } }] }] } } }
	],
	capabilities: () => [],
	limits: { timeoutMs: 3000, maxOperations: 4 }
};

const sectionPage = (page: unknown, pages: unknown) => ({ ttExpr: ['min', pages, { ttExpr: ['add', page, 1] }] });

const schoolSectionAction: SuiteActionDef = {
	key: 'school-section',
	name: 'A School section',
	description: 'One shelf of the school, filtered and paginated (24 per page).',
	category: 'starsalign',
	inputs: [
		{ name: 'section', type: 'string', label: 'Section', required: false, maxLength: 20, default: 'signs' },
		{ name: 'filter', type: 'string', label: 'Filter', required: false, maxLength: 80 },
		{ name: 'page', type: 'number', label: 'Page', required: false, min: 1, max: 20, default: 1 }
	],
	steps: () => [
		{ op: 'compute', value: { ttExpr: ['astro.section', { ttExpr: ['coalesce', '$input.section', 'signs'] }, { ttExpr: ['coalesce', '$input.filter', ''] }, '$input.page', 24] } },
		{
			op: 'return',
			value: {
				section: {
					ttExpr: [
						'merge',
						'$step.1',
						{
							hasMore: { ttExpr: ['lt', '$step.1.page', '$step.1.pages'] },
							nextPage: sectionPage('$step.1.page', '$step.1.pages'),
							prevPage: { ttExpr: ['max', 1, { ttExpr: ['sub', '$step.1.page', 1] }] }
						}
					]
				}
			}
		}
	],
	capabilities: () => [],
	limits: { timeoutMs: 4000, maxOperations: 4, maxResultBytes: 128 * 1024 }
};

const schoolSearchAction: SuiteActionDef = {
	key: 'school-search',
	name: 'Search the School',
	description: 'Scores every entry (title, keywords, essence, quick read) against the query — top 30.',
	category: 'starsalign',
	inputs: [{ name: 'q', type: 'string', label: 'Query', required: true, maxLength: 120 }],
	steps: () => [
		{ op: 'compute', value: { ttExpr: ['astro.search', '$input.q', 30] } },
		{ op: 'return', value: { hits: '$step.1', message: { ttExpr: ['concat', { ttExpr: ['len', '$step.1'] }, ' entries matched'] } } }
	],
	capabilities: () => [],
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

// Entries are PUBLIC DATA THINGS (seeded from the pack's content): the action
// searches them by entryId in public scope, so the page reads real things —
// browsable on /things, forkable, and exactly what the seed wrote.
const entryAction: SuiteActionDef = {
	key: 'school-entry',
	name: 'A School entry',
	description: 'One entry in full — read from the public entry data things by id.',
	category: 'starsalign',
	inputs: [{ name: 'id', type: 'string', label: 'Entry id', required: true, maxLength: 60 }],
	steps: (refs) => [
		{ op: 'things.search', schema: refs.schema('entry'), scope: 'public', where: { entryId: '$input.id' }, limit: 1 },
		{ op: 'compute', value: firstCrystal('$step.1') },
		{ op: 'compute', value: { ttExpr: ['astro.entry', '$input.id'] } },
		{
			op: 'return',
			value: {
				entry: {
					ttExpr: [
						'if',
						{ ttExpr: ['isEmpty', '$step.2'] },
						'$step.3',
						{ ttExpr: ['merge', '$step.3', '$step.2', { keywordsLine: { ttExpr: ['join', { ttExpr: ['get', '$step.2', 'keywords', []] }, ' · '] } }] }
					]
				}
			}
		}
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('entry')] }],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const combosAction: SuiteActionDef = {
	key: 'combos',
	name: 'Blend a combination',
	description: 'Resolves the pair readings for any 2–3 of planet / sign / house and composes the triple heading.',
	category: 'starsalign',
	inputs: [
		{ name: 'planet', type: 'string', label: 'Planet id', required: false, maxLength: 20 },
		{ name: 'sign', type: 'string', label: 'Sign id', required: false, maxLength: 20 },
		{ name: 'house', type: 'string', label: 'House number', required: false, maxLength: 4 }
	],
	steps: () => [
		{ op: 'compute', value: { ttExpr: ['astro.entryId', { ttExpr: ['coalesce', '$input.planet', ''] }, { ttExpr: ['coalesce', '$input.sign', ''] }, { ttExpr: ['coalesce', '$input.house', ''] }] } },
		{ op: 'compute', value: { ttExpr: ['coalesce', { ttExpr: ['get', '$step.1', 'pairs', null] }, { ttExpr: ['if', { ttExpr: ['get', '$step.1', 'id', null] }, ['$step.1'], []] }] } },
		{ op: 'compute', value: { ttExpr: ['map', '$step.2', { ttExpr: ['astro.entry', '$item.id'] }] } },
		{ op: 'return', value: { heading: { ttExpr: ['get', '$step.1', 'heading', null] }, entries: { ttExpr: ['filter', '$step.3', { ttExpr: ['not', { ttExpr: ['isEmpty', '$item'] }] }] }, message: { ttExpr: ['concat', { ttExpr: ['len', '$step.3'] }, ' reading(s) blended'] } } }
	],
	capabilities: () => [],
	limits: { timeoutMs: 4000, maxOperations: 8 }
};

const combosMetaAction: SuiteActionDef = {
	key: 'combos-meta',
	name: 'Combinator ingredients',
	description: 'The planets, signs, and houses the Combinator offers.',
	category: 'starsalign',
	inputs: [],
	steps: () => [{ op: 'compute', value: { ttExpr: ['astro.meta'] } }, { op: 'return', value: { meta: '$step.1' } }],
	capabilities: () => [],
	limits: { timeoutMs: 3000, maxOperations: 4 }
};

// ── pages ───────────────────────────────────────────────────────────────────

const shell = (ctx: DemoBlockCtx, refs: SuiteRefs, active: string, body: DemoBlock[]): DemoBlock[] => {
	const kit = demoBlockKit;
	return [
		kit.container(
			ctx,
			'shell',
			'column',
			[
				{ id: ctx.id('nav'), type: 'component', component: refs.component('nav'), args: { active } },
				...body,
				{ id: ctx.id('footer'), type: 'component', component: refs.component('footer') }
			],
			{ gap: 2, maxWidth: 960, css: { padding: '0 0 24px', color: INK } }
		)
	];
};

const bound = (ctx: DemoBlockCtx, refs: SuiteRefs, id: string, component: string, action: string, inputs?: Record<string, string | number | boolean>): DemoBlock =>
	({ id: ctx.id(id), type: 'component', component: refs.component(component), source: { action: refs.actionKey(action), ...(inputs ? { inputs } : {}) } }) as DemoBlock;

export const starsalignSuite: BehaviourSuite = {
	key: 'starsalign',
	title: 'StarsAlign',
	emoji: '✶',
	description: 'Your day at a glance, written in the sky — an astrology app whose users and data live in Thingtime.',
	story: [
		'StarsAlign stores exactly one thing per person — a birth profile — and computes everything else on the server: the current sky, your natal chart, the aspects today makes to it, and your whole-sign houses, with a real ephemeris.',
		'Every page is a builder page. The Today card is a component bound to the `today` action; the settings form posts to `save-profile`; the School reads its 418 entries from public data things; the Combinator blends any pair through the astro pack.'
	],
	tone: 'ink',
	app: { tagline: 'Your day, written in the sky ✶', entry: 'today', origin: 'https://starsalign.today' },
	schemas: [
		{
			key: 'profile',
			description: 'One birth profile: the date the sky insists on, the optional time and place that unlock the rising sign.',
			fields: [
				{ name: 'birthDate', type: 'string', required: true, maxLength: 10, description: 'YYYY-MM-DD' },
				{ name: 'birthTime', type: 'string', maxLength: 8, description: 'HH:mm, empty when unknown' },
				{ name: 'timeKnown', type: 'boolean' },
				{ name: 'displayName', type: 'string', maxLength: 60 },
				{ name: 'placeName', type: 'string', maxLength: 80 },
				{ name: 'placeCountry', type: 'string', maxLength: 80 },
				{ name: 'lat', type: 'number', min: -90, max: 90 },
				{ name: 'lon', type: 'number', min: -180, max: 180 },
				{ name: 'tz', type: 'string', maxLength: 64, description: 'IANA time zone' },
				{ name: 'updatedAt', type: 'date' }
			]
		},
		{
			key: 'entry',
			description: 'One School entry — a sign, house, planet, or a pairing — with its quick read and deep dive.',
			fields: [
				{ name: 'entryId', type: 'string', required: true, maxLength: 60 },
				{ name: 'section', type: 'enum', values: ['signs', 'houses', 'planets', 'sign-house', 'planet-sign', 'planet-house'] },
				{ name: 'title', type: 'string', required: true, maxLength: 120 },
				{ name: 'essence', type: 'string', maxLength: 160 },
				{ name: 'keywords', type: 'string[]', maxItems: 8 },
				{ name: 'short', type: 'string[]', maxItems: 3 },
				{ name: 'deep', type: 'string[]', maxItems: 8 }
			]
		}
	],
	components: [navComponent, footerComponent, todayComponent, birthFormComponent, schoolIndexComponent, schoolSectionComponent, entryComponent, combosComponent],
	actions: [todayAction, saveProfileAction, setPlaceAction, pickCityAction, eraseOneAction, eraseAction, schoolAction, schoolSectionAction, schoolSearchAction, entryAction, combosAction, combosMetaAction],
	data: [],
	pages: [
		{ key: 'today', name: 'Today', description: 'The daily brief — or the intro, or the welcome, depending on who is looking.', blocks: (ctx, refs) => shell(ctx, refs, 'today', [bound(ctx, refs, 'today', 'today', 'today')]) },
		{ key: 'settings', name: 'Settings', description: 'Account, birth data, the city picker, sign out, erase.', blocks: (ctx, refs) => shell(ctx, refs, 'settings', [bound(ctx, refs, 'settings', 'settings', 'today')]) },
		{ key: 'school', name: 'The School', description: 'Search across the whole school plus the six shelves.', blocks: (ctx, refs) => shell(ctx, refs, 'school', [bound(ctx, refs, 'school', 'school', 'school')]) },
		{ key: 'school-section', name: 'A shelf', description: 'One section, filterable and paginated.', blocks: (ctx, refs) => shell(ctx, refs, 'school', [bound(ctx, refs, 'section', 'section', 'school-section', { section: '{query.section}', page: '{query.page}', filter: '{query.filter}' })]) },
		{ key: 'entry', name: 'An entry', description: 'One entry in full.', blocks: (ctx, refs) => shell(ctx, refs, 'school', [bound(ctx, refs, 'entry', 'entry', 'school-entry', { id: '{query.id}' })]) },
		{ key: 'combos', name: 'The Combinator', description: 'Blend any 2 or 3 ingredients.', blocks: (ctx, refs) => shell(ctx, refs, 'combos', [bound(ctx, refs, 'combos', 'combos', 'combos-meta')]) }
	]
};
