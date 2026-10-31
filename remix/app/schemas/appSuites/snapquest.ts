// SNAPQUEST — a photo scavenger hunt. Twenty-four challenges ship as public
// system content; you claim one by uploading a photo (the builder's real
// tt-upload control) with a note, and the board fills in with your captures.
//
// Built to show: real file uploads bound into an action (photo +
// photoAttachmentId), a `system`-scope read of seeded content merged with
// your own captures, a featured pick that rotates daily (seededInt over the
// ISO date), category deep links (?category=), an image gallery drawn from
// private attachment URLs, and per-card delete groups.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites.ts';
import { appShell, boundBlock, coalesce, compute, concat, each, el, eq, firstCrystal, get, ifEquals, ifTruthy, iff, isEmpty, len, makeKit, makeTheme, merge, navComponent, notEmpty, percent, pick, returnValue, search, today, x, type Node } from './kit.ts';

const T = makeTheme({ bg: '#f3f7fb', surface: '#ffffff', ink: '#12263a', text: '#41556b', muted: '#8296ab', accent: '#0f766e', soft: '#e6f2f0', border: '#d9e4ec', ok: '#0f9d63' });
const k = makeKit(T);
const SMALL = { padding: '6px 11px', fontSize: '12px' };

type Challenge = { key: string; title: string; prompt: string; emoji: string; points: number; category: 'nature' | 'urban' | 'home' | 'people' | 'food' | 'colour'; difficulty: 'easy' | 'medium' | 'hard' };
const CHALLENGES: Challenge[] = [
	{ key: 'red-door', title: 'A red door', prompt: 'Find a door painted red. Bonus style points for a brass knocker.', emoji: '🚪', points: 10, category: 'urban', difficulty: 'easy' },
	{ key: 'three-birds', title: 'Three birds', prompt: 'Three birds in one frame — pigeons count, statues don’t.', emoji: '🐦', points: 25, category: 'nature', difficulty: 'medium' },
	{ key: 'cloud-animal', title: 'A cloud that looks like an animal', prompt: 'Say which animal in the note.', emoji: '☁️', points: 20, category: 'nature', difficulty: 'medium' },
	{ key: 'mirror-selfie-plant', title: 'Selfie with a plant', prompt: 'You and a plant, both in focus.', emoji: '🪴', points: 10, category: 'people', difficulty: 'easy' },
	{ key: 'handwritten-sign', title: 'A handwritten sign', prompt: 'Chalkboard, cardboard, sticky note — as long as a person wrote it.', emoji: '✍️', points: 15, category: 'urban', difficulty: 'easy' },
	{ key: 'tallest-thing', title: 'The tallest thing you can see', prompt: 'Stand somewhere high-ish and shoot the tallest thing on the horizon.', emoji: '🗼', points: 20, category: 'urban', difficulty: 'medium' },
	{ key: 'breakfast-face', title: 'Breakfast with a face', prompt: 'Arrange your breakfast into a face. Eat it afterwards.', emoji: '🍳', points: 15, category: 'food', difficulty: 'easy' },
	{ key: 'something-purple', title: 'Something purple', prompt: 'Not a flower. Flowers are too easy.', emoji: '🟣', points: 10, category: 'colour', difficulty: 'easy' },
	{ key: 'reflection', title: 'A reflection', prompt: 'A puddle, a window, a spoon — anything but a mirror.', emoji: '🪞', points: 20, category: 'urban', difficulty: 'medium' },
	{ key: 'oldest-object', title: 'The oldest object in your home', prompt: 'Tell its story in the note.', emoji: '🏺', points: 25, category: 'home', difficulty: 'medium' },
	{ key: 'stranger-smile', title: 'A stranger’s smile', prompt: 'Ask first! Their smile, with permission.', emoji: '😊', points: 40, category: 'people', difficulty: 'hard' },
	{ key: 'bug-close-up', title: 'A bug, close up', prompt: 'Any insect. Macro mode if you have it.', emoji: '🐞', points: 30, category: 'nature', difficulty: 'hard' },
	{ key: 'sunset-silhouette', title: 'A silhouette at sunset', prompt: 'A person, a tree, a lamppost — black against the sky.', emoji: '🌇', points: 30, category: 'nature', difficulty: 'hard' },
	{ key: 'rainbow-food', title: 'Food in rainbow order', prompt: 'At least five colours, in order.', emoji: '🌈', points: 35, category: 'food', difficulty: 'hard' },
	{ key: 'number-42', title: 'The number 42', prompt: 'A house number, a bus, a receipt — the answer to everything.', emoji: '4️⃣', points: 15, category: 'urban', difficulty: 'medium' },
	{ key: 'shadow-art', title: 'Shadow art', prompt: 'Make a shadow puppet or find a shadow that looks like something.', emoji: '🐰', points: 20, category: 'home', difficulty: 'medium' },
	{ key: 'yellow-vehicle', title: 'A yellow vehicle', prompt: 'Car, bike, digger, tram. Not a taxi if you live where taxis are yellow.', emoji: '🚕', points: 15, category: 'colour', difficulty: 'easy' },
	{ key: 'book-spine-poem', title: 'A book-spine poem', prompt: 'Stack books so the spines read as a poem. Write the poem in the note.', emoji: '📚', points: 25, category: 'home', difficulty: 'medium' },
	{ key: 'pet-hat', title: 'A pet in a hat', prompt: 'Any pet, any hat, no stress for the pet.', emoji: '🎩', points: 30, category: 'people', difficulty: 'hard' },
	{ key: 'green-everything', title: 'Everything green', prompt: 'A frame where every single thing is green.', emoji: '🟢', points: 20, category: 'colour', difficulty: 'medium' },
	{ key: 'street-musician', title: 'A street musician', prompt: 'Tip them. Then take the photo.', emoji: '🎷', points: 25, category: 'people', difficulty: 'medium' },
	{ key: 'tiny-door', title: 'A tiny door', prompt: 'Fairy door, cupboard door, a door for a cat.', emoji: '🚪', points: 15, category: 'home', difficulty: 'easy' },
	{ key: 'coffee-art', title: 'Latte art', prompt: 'Yours or the barista’s. Say which.', emoji: '☕', points: 10, category: 'food', difficulty: 'easy' },
	{ key: 'blue-hour', title: 'The blue hour', prompt: 'A photo taken in the twenty minutes after sunset.', emoji: '🌆', points: 25, category: 'colour', difficulty: 'medium' }
];
const CATEGORIES: Array<[string, string]> = [
	['nature', '🌿 Nature'],
	['urban', '🏙 Urban'],
	['home', '🏠 Home'],
	['people', '🙂 People'],
	['food', '🍽 Food'],
	['colour', '🎨 Colour']
];
const DIFFICULTY_BG = { easy: '#e6f6ee', medium: '#fff4e5', hard: '#fdecec' };
const DIFFICULTY_INK = { easy: T.ok, medium: '#b45309', hard: T.danger };

// ── components ──────────────────────────────────────────────────────────────
const nav = navComponent(T, {
	brand: 'Snapquest',
	emoji: '📸',
	home: '/p/snapquest',
	links: [
		['board', 'Board', '/p/snapquest'],
		['gallery', 'Gallery', '/p/snapquest-gallery'],
		['challenge', 'Challenge', '/p/snapquest-challenge']
	]
});

const difficultyPill = (arg: string): Node =>
	el('span', { display: 'inline-block', fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: pick(arg, DIFFICULTY_BG, T.soft), color: pick(arg, DIFFICULTY_INK, T.muted), whiteSpace: 'nowrap' }, [`{${arg}}`]);
const chip = (caption: string, href: string, key: string): Node => ifEquals('result.category', key, k.link(caption, href, 'solid', SMALL), k.link(caption, href, 'ghost', SMALL));

const challengeCard = (): Node =>
	el('a', { display: 'grid', gap: '6px', padding: '12px', borderRadius: '14px', border: `1px solid ${T.border}`, background: { ttIf: { arg: 'item.done', then: T.soft, else: T.surface } }, textDecoration: 'none', color: T.ink }, [
		k.row([k.text('{item.emoji}', { fontSize: '26px', lineHeight: 1 }), k.strong('{item.title}', { fontSize: '14px', flex: '1 1 120px' }), ifTruthy('item.done', k.pill('✓ done', { background: T.ok, color: '#ffffff' }), k.pill('+{item.points}', { background: '#fff3cf', color: '#7a5200' }))], { gap: '8px' }),
		k.muted('{item.prompt}', { fontSize: '12px' }),
		k.row([difficultyPill('item.difficulty'), k.pill('{item.category}')], { gap: '4px' }),
		ifTruthy('item.photo', k.img('{item.photo}', '{item.title}', { width: '100%', height: '110px', objectFit: 'cover', borderRadius: '10px' }))
	], { href: '/p/snapquest-challenge?key={item.key}' });

const board: SuiteComponentDef = {
	key: 'board',
	name: 'Challenge board',
	description: 'The twenty-four challenges (public system content) merged with your captures; category chips are links carrying ?category=.',
	args: [],
	render: () =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Snapquest',
				'A photo scavenger hunt: claim challenges by uploading a photo. The challenges are public; your captures are yours.',
				el('div', { display: 'grid', gap: '12px' }, [
					k.card(
						[
							k.label('Today’s featured challenge'),
							k.row([k.text('{result.featured.emoji}', { fontSize: '34px', lineHeight: 1 }), el('div', { display: 'grid', gap: '2px', flex: '1 1 200px' }, [k.strong('{result.featured.title}', { fontSize: '17px' }), k.muted('{result.featured.prompt}')]), k.link('Claim it →', '/p/snapquest-challenge?key={result.featured.key}', 'solid', SMALL)]),
							k.muted('Rotates every day — seededInt over today’s ISO date picks it.', { fontSize: '11px' })
						],
						{ background: 'linear-gradient(135deg, #e6f2f0, #f3f7fb)' }
					),
					k.row([chip('All', '/p/snapquest', 'all'), ...CATEGORIES.map(([key, caption]) => chip(caption, `/p/snapquest?category=${key}`, key)), chip('To do', '/p/snapquest?category=todo', 'todo')], { gap: '6px' }),
					el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' }, [each('result.items', challengeCard(), { max: 24, empty: k.muted('Nothing in this category.') })])
				])
			)
		])
};

const stats: SuiteComponentDef = {
	key: 'stats',
	name: 'Progress',
	description: 'Points, completion and a per-category breakdown computed from the same board source.',
	args: [],
	render: () =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Snapquest',
				'Your progress.',
				el('div', { display: 'grid', gap: '10px' }, [
					k.grid([k.stat('{result.stats.points}', 'points'), k.stat('{result.stats.done}/{result.stats.total}', 'claimed'), k.stat('{result.stats.percent}%', 'complete'), k.stat('{result.stats.remainingPoints}', 'points left')], 120),
					k.bar('result.stats.percent', T.accent),
					k.row([each('result.stats.categories', k.pill('{item.label} {item.done}/{item.total}', { background: { ttIf: { arg: 'item.complete', then: T.ok, else: T.soft } }, color: { ttIf: { arg: 'item.complete', then: '#ffffff', else: T.ink } } }))], { gap: '6px' })
				]),
				{ inert: k.grid([k.stat('120', 'points'), k.stat('6/24', 'claimed'), k.stat('25%', 'complete'), k.stat('395', 'points left')], 120) }
			)
		])
};

const claim: SuiteComponentDef = {
	key: 'claim',
	name: 'Challenge & claim',
	description: 'One challenge from ?key= with the claim form: a real tt-upload (photo + photoAttachmentId) and a note, in one fieldset with the challenge key in ttActionInputs.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Snapquest',
				'Claim a challenge.',
				ifTruthy(
					'result.found',
					k.card([
						k.row([k.link('← Board', '/p/snapquest', 'ghost', SMALL), k.muted('{result.challenge.category} · {result.challenge.difficulty} · +{result.challenge.points} points', { marginLeft: 'auto' })]),
						k.row([k.text('{result.challenge.emoji}', { fontSize: '40px', lineHeight: 1 }), el('div', { display: 'grid', gap: '2px' }, [k.title('{result.challenge.title}'), k.text('{result.challenge.prompt}')])], { gap: '12px' }),
						ifTruthy(
							'result.claimed',
							el('div', { display: 'grid', gap: '8px' }, [
								k.notice('Claimed on {result.capture.capturedOn} for {result.capture.points} points ✓', 'ok'),
								ifTruthy('result.capture.photo', k.img('{result.capture.photo}', '{result.challenge.title}', { maxHeight: '360px', borderRadius: '12px', objectFit: 'cover' })),
								ifTruthy('result.capture.note', k.text('“{result.capture.note}”', { fontStyle: 'italic' })),
								k.group([k.row([k.confirmButton('Un-claim…', 'Un-claim this challenge?', k.text('Deletes the capture record so you can redo it. The private file stays in your account.'), k.button('Yes, un-claim', refs.actionKey('uncapture'), { id: '{result.capture.id}' }, 'danger', SMALL)), k.muted('Confirmed in a native dialog.')])])
							]),
							k.group([
								k.field('Your photo', k.upload('photo', { imageOnly: true, title: 'Photo evidence' }), 'Upload, wait for processing, choose “Use file” — the form receives photo and photoAttachmentId.'),
								k.field('Note', k.textarea('note', { placeholder: 'Where, when, how — or the poem, the animal, the story.', maxLength: 600 })),
								k.row([k.button('Claim +{result.challenge.points} 📸', refs.actionKey('capture'), { challengeKey: '{result.challenge.key}' })])
							])
						)
					]),
					k.card([k.strong('Pick a challenge'), k.text('Open this page from a card on the board — the challenge key rides in the URL as ?key=.'), k.row([k.link('→ Board', '/p/snapquest', 'solid')])])
				)
			)
		])
};

const galleryCard = (refs: SuiteRefs): Node =>
	el('fieldset', { border: `1px solid ${T.border}`, margin: 0, padding: '10px', minWidth: 0, background: T.surface, borderRadius: '14px', display: 'grid', gap: '6px' }, [
		ifTruthy('item.photo', k.img('{item.photo}', '{item.title}', { width: '100%', height: '160px', objectFit: 'cover', borderRadius: '10px' }), el('div', { height: '160px', borderRadius: '10px', background: T.soft, display: 'grid', placeItems: 'center', fontSize: '40px' }, ['{item.emoji}'])),
		k.row([k.strong('{item.emoji} {item.title}', { fontSize: '14px', flex: '1 1 120px' }), k.pill('+{item.points}', { background: '#fff3cf', color: '#7a5200' })]),
		ifTruthy('item.note', k.muted('“{item.note}”', { fontSize: '12px' })),
		k.row([k.muted('{item.capturedOn}', { fontSize: '11px' }), k.link('Open', '/p/snapquest-challenge?key={item.challengeKey}', 'ghost', SMALL), k.button('🗑', refs.actionKey('uncapture'), { id: '{item.id}' }, 'ghost', SMALL)], { gap: '6px', justifyContent: 'flex-end' })
	]);
const gallery: SuiteComponentDef = {
	key: 'gallery',
	name: 'Capture gallery',
	description: 'Every capture with its photo — private attachment URLs only the owner can open — newest first, one delete group per card.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Snapquest',
				'Your captures.',
				el('div', { display: 'grid', gap: '10px' }, [
					k.row([k.strong('Gallery', { fontSize: '17px' }), k.muted('{result.count} captures · {result.points} points', { marginLeft: 'auto' })]),
					el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }, [each('result.items', galleryCard(refs), { max: 40, empty: k.soft([k.strong('No captures yet'), k.muted('Claim a challenge with a photo and it lands here.')]) })])
				])
			)
		])
};

// ── actions ─────────────────────────────────────────────────────────────────
const challengeSearch = (refs: SuiteRefs, extra: Record<string, unknown> = {}) => search(refs.schema('challenge'), { scope: 'system', limit: 60, sort: { field: 'order', dir: 'asc' }, ...extra });
const captureRows = (step: string): Node => x('map', step, merge('$item.crystal', { id: '$item.id', capturedOn: iff(notEmpty('$item.crystal.capturedAt'), x('isoDate', '$item.crystal.capturedAt'), '') }));

const boardAction: SuiteActionDef = {
	key: 'board',
	name: 'Board',
	description: 'The challenges (system content) merged with your captures, filtered by category, plus stats and today’s featured pick.',
	category: 'snapquest',
	inputs: [{ name: 'category', type: 'string', label: 'Category (or todo)', default: '', maxLength: 20 }],
	steps: (refs) => [
		challengeSearch(refs), // 1
		search(refs.schema('capture'), { limit: 100, sort: { field: 'createdAt', dir: 'desc' } }), // 2
		compute(captureRows('$step.2')), // 3
		// a lambda rebinds $item, so a nested find cannot see the outer challenge:
		// index the captures by key first, then look each challenge up by index
		compute(x('pluck', '$step.3', 'challengeKey')), // 4
		compute(
			x(
				'map',
				x('map', '$step.1', '$item.crystal'),
				merge('$item', {
					done: x('includes', '$step.4', '$item.key'),
					photo: get(coalesce(get('$step.3', x('indexOf', '$step.4', '$item.key'), null), {}), 'photo', ''),
					captureId: get(coalesce(get('$step.3', x('indexOf', '$step.4', '$item.key'), null), {}), 'id', null)
				})
			)
		), // 5
		compute(x('filter', '$step.5', x('or', isEmpty('$input.category'), eq('$input.category', 'all'), x('and', eq('$input.category', 'todo'), x('not', '$item.done')), eq('$item.category', '$input.category')))), // 6
		compute(x('sum', x('filter', '$step.5', '$item.done'), '$item.points')), // 7
		compute(x('sum', '$step.5', '$item.points')), // 8
		compute(x('seededInt', today(), 0, x('sub', x('max', 1, len('$step.5')), 1))), // 9
		returnValue({
			items: '$step.6',
			category: iff(isEmpty('$input.category'), 'all', '$input.category'),
			featured: coalesce(x('get', '$step.5', '$step.9', null), x('first', '$step.5')),
			stats: {
				points: '$step.7',
				totalPoints: '$step.8',
				remainingPoints: x('sub', '$step.8', '$step.7'),
				done: x('count', '$step.5', '$item.done'),
				total: len('$step.5'),
				percent: percent(x('count', '$step.5', '$item.done'), len('$step.5')),
				categories: CATEGORIES.map(([key, label]) => ({
					key,
					label,
					done: x('count', '$step.5', x('and', eq('$item.category', key), '$item.done')),
					total: x('count', '$step.5', eq('$item.category', key)),
					complete: x('and', x('gt', x('count', '$step.5', eq('$item.category', key)), 0), eq(x('count', '$step.5', x('and', eq('$item.category', key), '$item.done')), x('count', '$step.5', eq('$item.category', key))))
				}))
			},
			silent: true
		})
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('challenge'), refs.schema('capture')] }],
	limits: { timeoutMs: 8000, maxOperations: 16, maxResultBytes: 128 * 1024 }
};

const captureAction: SuiteActionDef = {
	key: 'capture',
	name: 'Claim a challenge',
	description: 'Creates a capture for the challenge from the uploaded photo (photo + photoAttachmentId) and the note; refuses a second claim of the same challenge and a claim without a photo.',
	category: 'snapquest',
	inputs: [
		{ name: 'challengeKey', type: 'string', label: 'Challenge key', required: true, maxLength: 40 },
		{ name: 'note', type: 'text', label: 'Note', default: '', maxLength: 600 },
		{ name: 'photo', type: 'string', label: 'Photo URL', default: '', maxLength: 500 },
		{ name: 'photoAttachmentId', type: 'string', label: 'Photo attachment id', default: '', maxLength: 80 }
	],
	steps: (refs) => [
		challengeSearch(refs, { where: { key: '$input.challengeKey' }, limit: 1 }), // 1
		{ op: 'fail', when: isEmpty('$step.1'), message: 'No such challenge.' }, // 2
		{ op: 'fail', when: isEmpty(x('trim', '$input.photoAttachmentId')), message: 'Attach a photo first — upload it, wait for processing, then choose “Use file”.' }, // 3
		search(refs.schema('capture'), { where: { challengeKey: '$input.challengeKey' }, limit: 1 }), // 4
		{ op: 'fail', when: notEmpty('$step.4'), message: 'You already claimed this one — un-claim it from the gallery to redo it.' }, // 5
		compute(firstCrystal('$step.1')), // 6
		{ op: 'things.create', schema: refs.schema('capture'), values: { challengeKey: '$input.challengeKey', title: '$step.6.title', emoji: '$step.6.emoji', category: '$step.6.category', points: '$step.6.points', note: '$input.note', photo: '$input.photo', photoAttachmentId: '$input.photoAttachmentId', capturedAt: '$now' } }, // 7
		returnValue({ id: '$step.7.id', points: '$step.6.points', title: 'Claimed! 📸', message: concat('+', '$step.6.points', ' points for “', '$step.6.title', '”.') })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('challenge'), refs.schema('capture')] }, { capability: 'things.create', schemas: [refs.schema('capture')] }],
	limits: { timeoutMs: 6000, maxOperations: 10 }
};

const uncaptureAction: SuiteActionDef = {
	key: 'uncapture',
	name: 'Un-claim',
	description: 'Deletes one of your captures (the uploaded file stays in your account).',
	category: 'snapquest',
	inputs: [{ name: 'id', type: 'string', label: 'Capture id', required: true, maxLength: 80 }],
	steps: () => [{ op: 'things.delete', id: '$input.id' }, returnValue({ message: 'Un-claimed — the challenge is open again.' })],
	capabilities: (refs) => [{ capability: 'things.delete', schemas: [refs.schema('capture')] }],
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

const galleryAction: SuiteActionDef = {
	key: 'gallery',
	name: 'Gallery',
	description: 'Your captures, newest first.',
	category: 'snapquest',
	inputs: [],
	steps: (refs) => [
		search(refs.schema('capture'), { limit: 40, sort: { field: 'createdAt', dir: 'desc' } }), // 1
		compute(captureRows('$step.1')), // 2
		returnValue({ items: '$step.2', count: len('$step.2'), points: x('sum', '$step.2', '$item.points'), silent: true })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('capture')] }],
	limits: { timeoutMs: 6000, maxOperations: 8 }
};

const challengeAction: SuiteActionDef = {
	key: 'challenge',
	name: 'Challenge',
	description: 'One challenge by key (system content) and your capture of it, if any.',
	category: 'snapquest',
	inputs: [{ name: 'key', type: 'string', label: 'Challenge key', default: '', maxLength: 40 }],
	steps: (refs) => [
		challengeSearch(refs, { where: { key: '$input.key' }, limit: 1 }), // 1
		search(refs.schema('capture'), { where: { challengeKey: '$input.key' }, limit: 1 }), // 2
		compute(captureRows('$step.2')), // 3
		returnValue({ found: notEmpty('$step.1'), challenge: coalesce(firstCrystal('$step.1'), {}), claimed: notEmpty('$step.3'), capture: coalesce(x('first', '$step.3'), null), silent: true })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('challenge'), refs.schema('capture')] }],
	limits: { timeoutMs: 6000, maxOperations: 8 }
};

// ── the suite ───────────────────────────────────────────────────────────────
export const snapquestSuite: BehaviourSuite = {
	key: 'snapquest',
	title: 'Snapquest',
	emoji: '📸',
	description: 'A photo scavenger hunt: twenty-four challenges you claim by uploading a photo — the builder’s real upload control feeding an action.',
	story: [
		'The challenges are public system content (seeded through the suite’s `content`) that the board reads in `system` scope and merges with your own capture things. Claiming one is the upload pattern from /docs/builder: a tt-upload named photo hands the action both photo and photoAttachmentId, the note rides along from the same fieldset, and the action refuses a claim without a file or a second claim of the same challenge.',
		'Today’s featured challenge is a seededInt over the ISO date, the category chips are deep links (?category=), and the gallery draws private attachment URLs only their owner can open.'
	],
	tone: 'ocean',
	app: { tagline: 'Twenty-four things to photograph 📸', entry: 'board' },
	schemas: [
		{
			key: 'challenge',
			description: 'One challenge (public content): what to photograph, points, category, difficulty.',
			fields: [
				{ name: 'key', type: 'string', required: true, maxLength: 40 },
				{ name: 'order', type: 'number' },
				{ name: 'title', type: 'string', required: true, maxLength: 80 },
				{ name: 'prompt', type: 'string', maxLength: 300 },
				{ name: 'emoji', type: 'string', maxLength: 8 },
				{ name: 'points', type: 'number', min: 0, max: 100 },
				{ name: 'category', type: 'enum', values: CATEGORIES.map(([key]) => key) },
				{ name: 'difficulty', type: 'enum', values: ['easy', 'medium', 'hard'] }
			]
		},
		{
			key: 'capture',
			description: 'Your claim of a challenge: the photo (private attachment), a note, the points.',
			fields: [
				{ name: 'challengeKey', type: 'string', required: true, maxLength: 40 },
				{ name: 'title', type: 'string', maxLength: 80 },
				{ name: 'emoji', type: 'string', maxLength: 8 },
				{ name: 'category', type: 'string', maxLength: 20 },
				{ name: 'points', type: 'number' },
				{ name: 'note', type: 'string', maxLength: 600 },
				{ name: 'photo', type: 'string', maxLength: 500, description: 'Content URL of the uploaded photo' },
				{ name: 'photoAttachmentId', type: 'string', maxLength: 80 },
				{ name: 'capturedAt', type: 'date' }
			]
		}
	],
	components: [nav, stats, board, claim, gallery],
	actions: [boardAction, captureAction, uncaptureAction, galleryAction, challengeAction],
	data: [],
	content: () => CHALLENGES.map((challenge, index) => ({ id: challenge.key, schema: 'challenge', tags: ['challenge', challenge.category, challenge.difficulty], values: { ...challenge, order: index + 1 } })),
	pages: [
		{ key: 'board', name: 'Board', description: 'Progress, the featured pick, every challenge.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'board', [boundBlock(ctx, refs, 'stats', 'stats', 'board'), boundBlock(ctx, refs, 'board', 'board', 'board', { category: '{query.category}' })], { maxWidth: 960 }) },
		{ key: 'challenge', name: 'Challenge', description: 'One challenge and the claim form (?key=).', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'challenge', [boundBlock(ctx, refs, 'claim', 'claim', 'challenge', { key: '{query.key}' })]) },
		{ key: 'gallery', name: 'Gallery', description: 'Your captures.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'gallery', [boundBlock(ctx, refs, 'gallery', 'gallery', 'gallery')], { maxWidth: 960 }) }
	]
};
