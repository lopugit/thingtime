// THINGMON — a creature-collecting game on Thingtime, with sixty ORIGINAL
// pixel-art species (drawn by scripts/generate-thingmon-sprites.mjs into
// public/demos/thingmon) and every rule in the `thingmon` domain pack.
//
// The loop: pick a starter → explore one of six zones (an action run rolls
// the encounter server-side) → a turn-based battle, one action per turn
// (moves, capture crystals, tonics, flee) → experience, levels, evolution,
// shards to spend at the shop, a dex that fills in as you meet things.
//
// Every keeper, creature and live battle is a data thing the viewer owns;
// the species catalogue is public system content read in `system` scope.
// Built to show the builder's game-shaped features: domain packs behind
// expressions, multi-page apps with deep links (?page=, ?id=), per-row
// form groups (rename), `each` over child actions (rest, reset), a
// time-gated daily bonus (dateAdd / isoDate), and PNG media in templates.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites.ts';
// the catalogue is pure generated data — the suite reads it directly rather
// than importing the server-bound pack (which would drag the pack into the
// isomorphic bundle and close an execute → packs → suite → packs cycle)
import { THINGMON_SPECIES_DATA } from '../../api/utils/actions/packs/thingmon/data/species.ts';
import { appShell, boundBlock, coalesce, compute, concat, each, el, eq, firstCrystal, firstId, get, ifEquals, ifOp, ifTruthy, iff, isEmpty, len, makeKit, makeTheme, merge, navComponent, notEmpty, percent, pick, returnValue, search, today, x, type Node } from './kit.ts';

const T = makeTheme({ bg: '#fbf7ef', surface: '#ffffff', ink: '#1f2a44', text: '#4b5470', muted: '#8a90a6', accent: '#2f6df6', soft: '#f1ede3', border: '#e6dfd0', ok: '#2ea36b', danger: '#d9453d' });
const k = makeKit(T);
const SMALL = { padding: '6px 11px', fontSize: '12px' };
const TYPE_COLORS = { ember: '#f0623a', tide: '#3f8fe0', bloom: '#5fb85a', spark: '#f4c430', frost: '#9fd8f5', stone: '#9a8f82', shade: '#5d4f8a', glow: '#ffd86b' };
const TYPE_INK = { ember: '#ffffff', tide: '#ffffff', bloom: '#ffffff', spark: '#3a2d00', frost: '#1d3f5a', stone: '#ffffff', shade: '#ffffff', glow: '#3a2d00' };
const RARITY_COLORS = { common: T.soft, uncommon: '#e6f6ee', rare: '#ede7ff', legendary: '#fff3cf' };
const CRITTER_FIELDS = ['speciesId', 'species', 'nickname', 'types', 'rarity', 'level', 'exp', 'iv', 'hp', 'maxHp', 'atk', 'def', 'spd', 'status', 'moves', 'sprite', 'stage'];
const STARTER_BAG = { 'shard-crystal': 5, tonic: 2 };
const STARTER_SHARDS = 20;

const TYPE_EMOJI: Record<string, string> = { ember: '🔥', tide: '🌊', bloom: '🌿', spark: '⚡', frost: '❄️', stone: '🪨', shade: '🌙', glow: '✨' };
type SpeciesJson = { id: number; types: string[]; rarity: string } & Record<string, unknown>;
const SPECIES_CONTENT = (THINGMON_SPECIES_DATA as unknown as SpeciesJson[]).map((species) => ({ ...species, typeEmoji: species.types.map((type) => TYPE_EMOJI[type] || '').join(''), typeLine: species.types.join(' / ') }));

// ── render bits ─────────────────────────────────────────────────────────────
const typePill = (arg: string): Node =>
	el('span', { display: 'inline-block', fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '999px', background: pick(arg, TYPE_COLORS, T.soft), color: pick(arg, TYPE_INK, T.ink) }, [`{${arg}}`]);
const typePills = (listArg: string): Node => k.row([each(listArg, typePill('item'))], { gap: '4px' });
const hpTone = (arg: string): Node => ({ ttIf: { arg, op: 'gt', value: 50, then: T.ok, else: { ttIf: { arg, op: 'gt', value: 20, then: '#e0a10e', else: T.danger } } } });
const hpBar = (percentArg: string): Node => k.bar(percentArg, hpTone(percentArg));
const sprite = (srcArg: string, altArg: string, size = 64, style: Record<string, unknown> = {}): Node => k.sprite(`{${srcArg}}`, `{${altArg}}`, size, style);
const statusPill = (arg: string): Node => ifOp(arg, 'ne', 'ok', k.pill(`{${arg}}`, { background: '#fdecec', color: T.danger }));

// the one card every creature row shares (party, box)
const critterCard = (refs: SuiteRefs, mode: 'party' | 'box'): Node =>
	el('fieldset', { border: `1px solid ${T.border}`, margin: 0, padding: '12px', minWidth: 0, background: T.surface, borderRadius: '14px', display: 'grid', gap: '8px' }, [
		k.row([
			sprite('item.sprite', 'item.species', 56, { background: pick('item.rarity', RARITY_COLORS, T.soft), borderRadius: '12px', padding: '4px' }),
			el('div', { display: 'grid', gap: '3px', flex: '1 1 160px', minWidth: 0 }, [
				k.row([k.strong('{item.name}', { fontSize: '15px' }), k.muted('Lv {item.level} · {item.species}'), statusPill('item.status')], { gap: '6px' }),
				typePills('item.types'),
				hpBar('item.hpPercent'),
				k.muted('{item.hp}/{item.maxHp} HP · ATK {item.atk} · DEF {item.def} · SPD {item.spd}', { fontSize: '11px' }),
				k.muted('{item.movesLine}', { fontSize: '11px' })
			])
		]),
		mode === 'party'
			? k.row(
					[
						ifTruthy('item.canEvolve', k.button('Evolve ✨', refs.actionKey('evolve'), { id: '{item.id}' }, 'ok', SMALL)),
						k.button('Lead', refs.actionKey('set-lead'), { id: '{item.id}' }, 'ghost', SMALL),
						k.button('Tonic 🧪', refs.actionKey('use-item'), { id: '{item.id}', itemId: 'tonic' }, 'soft', SMALL),
						k.button('To box', refs.actionKey('deposit'), { id: '{item.id}' }, 'ghost', SMALL),
						k.input('nickname', { placeholder: 'Nickname', maxLength: 16, value: '{item.nickname}' }, { width: '130px', padding: '6px 9px', fontSize: '12px' }),
						k.button('Rename', refs.actionKey('rename'), { id: '{item.id}' }, 'ghost', SMALL)
					],
					{ gap: '6px' }
				)
			: k.row([k.button('Withdraw', refs.actionKey('withdraw'), { id: '{item.id}' }, 'ghost', SMALL), k.button('Release', refs.actionKey('release'), { id: '{item.id}' }, 'danger', SMALL)], { gap: '6px' })
	]);

// ── components ──────────────────────────────────────────────────────────────
const nav = navComponent(T, {
	brand: 'Thingmon',
	emoji: '🔮',
	home: '/p/thingmon',
	links: [
		['play', 'Play', '/p/thingmon'],
		['team', 'Team', '/p/thingmon-team'],
		['dex', 'Dex', '/p/thingmon-dex'],
		['shop', 'Shop', '/p/thingmon-shop'],
		['keeper', 'Keeper', '/p/thingmon-keeper']
	]
});

const literalTypePill = (type: keyof typeof TYPE_COLORS): Node =>
	el('span', { display: 'inline-block', fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '999px', background: TYPE_COLORS[type], color: TYPE_INK[type] }, [type]);
const starterCard = (id: number, name: string, slug: string, type: keyof typeof TYPE_COLORS, blurb: string): Node =>
	el('label', { display: 'grid', gap: '6px', justifyItems: 'center', padding: '12px', border: `1px solid ${T.border}`, borderRadius: '14px', background: T.surface, cursor: 'pointer', textAlign: 'center' }, [
		{ tag: 'input', props: { type: 'radio', name: 'starterId', value: String(id), ...(id === 1 ? { checked: true } : {}) } },
		k.img(`/demos/thingmon/${String(id).padStart(2, '0')}-${slug}.png`, name, { width: '72px', height: '72px', imageRendering: 'pixelated' }),
		k.strong(name),
		literalTypePill(type),
		k.muted(blurb, { fontSize: '12px' })
	]);

const hud: SuiteComponentDef = {
	key: 'hud',
	name: 'Keeper HUD',
	description: 'Your keeper card — or, before the journey starts, the starter picker (a radio group + name field feeding the start action).',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Thingmon',
				'Sixty original creatures, six zones, turn-based battles — and every rule is a declarative action over your own things.',
				ifTruthy(
					'result.hasKeeper',
					k.card([
						k.row([
							ifTruthy('result.lead', sprite('result.lead.sprite', 'result.lead.species', 64, { background: T.soft, borderRadius: '12px', padding: '4px' })),
							el('div', { display: 'grid', gap: '3px', flex: '1 1 200px' }, [
								k.row([k.strong('{result.keeper.name}', { fontSize: '18px' }), k.pill('💎 {result.keeper.shards} shards', { background: '#fff3cf', color: '#7a5200' })]),
								k.muted('Dex {result.dexCaughtCount}/{result.total} caught · {result.dexSeenCount} seen · {result.keeper.wins} wins · {result.keeper.catches} catches · {result.keeper.explores} expeditions'),
								ifTruthy('result.lead', k.muted('Lead: {result.lead.name} (Lv {result.lead.level}) — {result.lead.hp}/{result.lead.maxHp} HP'))
							]),
							k.group([k.button('Daily bonus 🎁', refs.actionKey('daily'), {}, 'soft', SMALL)])
						]),
						ifTruthy('result.lastMessage', k.notice('{result.lastMessage}'))
					]),
					k.card([
						k.title('Choose your starter'),
						k.text('A keeper record and your first creature are created as your own data things. Pick one of the three, give yourself a name, and go.'),
						k.group([
							el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }, [
								starterCard(1, 'Cindrel', 'cindrel', 'ember', 'A warm fox-like thing. Ember.'),
								starterCard(4, 'Puddlin', 'puddlin', 'tide', 'A shy droplet. Tide.'),
								starterCard(7, 'Sproutle', 'sproutle', 'bloom', 'A hopping seed. Bloom.')
							]),
							k.field('Keeper name', k.input('name', { placeholder: 'Your keeper name', maxLength: 16, required: true })),
							k.row([k.button('Begin the journey ▶', refs.actionKey('start'), {})])
						])
					])
				),
				{ loading: 'Waking the sanctuary…' }
			)
		])
};
const zoneCard = (refs: SuiteRefs): Node =>
	el('div', { display: 'grid', gap: '6px', padding: '12px', borderRadius: '14px', border: `1px solid ${T.border}`, background: '{item.color}', opacity: { ttIf: { arg: 'item.unlocked', then: 1, else: 0.55 } } }, [
		k.row([k.strong('{item.emoji} {item.name}', { fontSize: '15px' }), ifTruthy('item.current', k.pill('you are here', { background: T.ink, color: '#ffffff' }))]),
		k.muted('{item.blurb} Lv {item.levels.0}–{item.levels.1}.', { fontSize: '12px' }),
		ifTruthy('item.unlocked', k.row([k.button('Explore →', refs.actionKey('explore'), { zone: '{item.id}' }, 'solid', SMALL)]), k.muted('🔒 Catch {item.unlockDex} species to unlock', { fontSize: '12px', fontWeight: 700 }))
	]);

const explore: SuiteComponentDef = {
	key: 'explore',
	name: 'Expedition zones',
	description: 'Six zones; an Explore button runs the explore action, which rolls the encounter through the thingmon pack and opens a battle thing.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			whenOk(
				ifTruthy(
					'result.hasKeeper',
					ifTruthy('result.inBattle', k.notice('A wild Thingmon is in front of you — finish the battle first.'), el('div', { display: 'grid', gap: '10px' }, [k.strong('Where to?', { fontSize: '17px' }), k.grid([each('result.zones', zoneCard(refs))], 200)])),
					null
				)
			)
		])
};
const whenOk = (node: unknown): Node => ({ ttIf: { arg: 'state', equals: 'ok', then: node } });

const moveButton = (refs: SuiteRefs): Node =>
	k.button(
		el('span', { display: 'grid', gap: '1px', textAlign: 'left' }, [el('span', {}, ['{item.name}']), el('span', { fontSize: '10px', fontWeight: 600, opacity: 0.8 }, ['{item.type} · {item.power} pow'])]),
		refs.actionKey('battle-move'),
		{ moveIndex: '{index}' },
		'solid',
		{ padding: '8px 12px', background: pick('item.type', TYPE_COLORS, T.accent), border: 'none', color: pick('item.type', TYPE_INK, '#ffffff') }
	);
const crystalButton = (refs: SuiteRefs, id: string, caption: string): Node =>
	ifOp(`result.bag.${id.replace('-', '_')}`, 'gt', 0, k.button(`${caption} ×{result.bag.${id.replace('-', '_')}}`, refs.actionKey('battle-catch'), { itemId: id }, 'soft', SMALL));
const battle: SuiteComponentDef = {
	key: 'battle',
	name: 'Battle arena',
	description: 'The live battle: sprites and HP bars from the battle thing, the log, one button per move (ttEach with the index as the input), crystals, tonics, flee.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			whenOk(
				ifTruthy(
					'result.inBattle',
					k.card(
						[
							el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }, [
								el('div', { display: 'grid', gap: '4px' }, [
									k.row([k.strong('Wild {result.battle.wild.species}'), k.muted('Lv {result.battle.wild.level}'), statusPill('result.battle.wild.status')], { gap: '6px' }),
									typePills('result.battle.wild.types'),
									hpBar('result.battle.wild.hpPercent'),
									k.muted('{result.battle.wild.hp}/{result.battle.wild.maxHp} HP', { fontSize: '11px' })
								]),
								sprite('result.battle.wild.sprite', 'result.battle.wild.species', 112, { justifySelf: 'end', filter: 'drop-shadow(0 6px 0 rgba(0,0,0,0.08))' })
							]),
							el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }, [
								sprite('result.battle.player.sprite', 'result.battle.player.species', 96, { transform: 'scaleX(-1)' }),
								el('div', { display: 'grid', gap: '4px' }, [
									k.row([k.strong('{result.battle.player.name}'), k.muted('Lv {result.battle.player.level}'), statusPill('result.battle.player.status')], { gap: '6px', justifyContent: 'flex-end' }),
									hpBar('result.battle.player.hpPercent'),
									k.muted('{result.battle.player.hp}/{result.battle.player.maxHp} HP · turn {result.battle.turn}', { fontSize: '11px', textAlign: 'right' })
								])
							]),
							k.soft([each('result.battle.recentLog', k.text('{item}', { fontSize: '13px' }), { empty: k.muted('…') })], { fontFamily: T.font, minHeight: '54px' }),
							k.group([
								k.label('Moves'),
								k.row([each('result.battle.player.moves', moveButton(refs), { max: 4 })], { gap: '6px' }),
								k.label('Crystals & items'),
								k.row([crystalButton(refs, 'shard-crystal', '🔹 Shard'), crystalButton(refs, 'tide-crystal', '🔷 Tide'), crystalButton(refs, 'prism-crystal', '💠 Prism'), ifOp('result.bag.tonic', 'gt', 0, k.button('🧪 Tonic ×{result.bag.tonic}', refs.actionKey('battle-item'), { itemId: 'tonic' }, 'soft', SMALL)), ifOp('result.bag.elixir', 'gt', 0, k.button('🍵 Elixir ×{result.bag.elixir}', refs.actionKey('battle-item'), { itemId: 'elixir' }, 'soft', SMALL)), k.button('Run 🏃', refs.actionKey('battle-flee'), {}, 'ghost', SMALL)], { gap: '6px' })
							])
						],
						{ background: '{result.battle.zoneColor}' }
					),
					null
				)
			)
		])
};

const team: SuiteComponentDef = {
	key: 'team',
	name: 'Team & box',
	description: 'Party of six and the storage box, one card per creature with its own fieldset (rename reads only that row), evolve when ready, rest the whole team through `each`.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Thingmon',
				'Your creatures.',
				ifTruthy(
					'result.hasKeeper',
					el('div', { display: 'grid', gap: '12px' }, [
						k.row([k.strong('Party', { fontSize: '17px' }), k.muted('{result.partyCount}/6'), k.group([k.button('Rest at the sanctuary 🛏', refs.actionKey('heal'), {}, 'ok', SMALL)], { marginLeft: 'auto' })]),
						el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }, [each('result.party', critterCard(refs, 'party'), { max: 6, empty: k.muted('No one in the party — withdraw someone from the box.') })]),
						k.row([k.strong('Box', { fontSize: '17px' }), k.muted('{result.boxCount} stored')]),
						el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }, [each('result.box', critterCard(refs, 'box'), { max: 24, empty: k.muted('The box is empty.') })])
					]),
					k.card([k.strong('No keeper yet'), k.text('Choose a starter on the Play page first.'), k.row([k.link('→ Play', '/p/thingmon', 'solid')])])
				)
			)
		])
};

const dexCard = (): Node =>
	el('a', { display: 'grid', gap: '4px', justifyItems: 'center', padding: '10px 6px', borderRadius: '14px', border: `1px solid ${T.border}`, background: pick('item.rarity', RARITY_COLORS, T.soft), textDecoration: 'none', color: T.ink, textAlign: 'center' }, [
		{ tag: 'img', props: { src: '{item.sprite}', alt: '{item.name}', style: { width: '64px', height: '64px', imageRendering: 'pixelated', filter: { ttIf: { arg: 'item.seen', then: 'none', else: 'brightness(0) opacity(0.25)' } } } } },
		k.muted('#{item.id}', { fontSize: '10px' }),
		ifTruthy('item.seen', k.strong('{item.name}', { fontSize: '13px' }), k.strong('???', { fontSize: '13px', color: T.muted })),
		ifTruthy('item.seen', typePills('item.types')),
		ifTruthy('item.caught', k.pill('caught ✓', { background: T.ok, color: '#ffffff' }))
	], { href: '/p/thingmon-species?id={item.id}' });

const dex: SuiteComponentDef = {
	key: 'dex',
	name: 'Dex',
	description: 'The 60-species catalogue, 30 per page (?page= rides through {query.page} into the source input); unseen species are silhouettes, cards link to the species page.',
	args: [],
	render: () =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Thingmon',
				'The dex.',
				el('div', { display: 'grid', gap: '10px' }, [
					k.row([k.strong('Dex', { fontSize: '17px' }), k.muted('{result.caughtCount} caught · {result.seenCount} seen · {result.total} total'), k.row([k.link('← Prev', '/p/thingmon-dex?page={result.prevPage}', 'ghost', SMALL), k.muted('page {result.page}/{result.pages}'), k.link('Next →', '/p/thingmon-dex?page={result.nextPage}', 'ghost', SMALL)], { gap: '6px', marginLeft: 'auto' })]),
					el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }, [each('result.items', dexCard(), { max: 30 })]),
					ifTruthy('result.hasKeeper', null, k.notice('Sign in and start a journey to reveal what you have met — the catalogue itself is public system data.'))
				])
			)
		])
};

const statRow = (caption: string, arg: string, max: number): Node =>
	k.row([k.muted(caption, { width: '38px', fontSize: '11px', fontWeight: 700 }), el('div', { flex: '1 1 120px', background: T.soft, borderRadius: '999px', height: '8px', overflow: 'hidden' }, [el('div', { height: '100%', width: `{${arg}Pct}%`, background: T.accent, borderRadius: '999px' }, [])]), k.strong(`{${arg}}`, { width: '30px', fontSize: '12px', textAlign: 'right' })], { gap: '8px', flexWrap: 'nowrap' });
const speciesCard: SuiteComponentDef = {
	key: 'species-card',
	name: 'Species page',
	description: 'One species from ?id= — the pack record merged with the seeded system data thing (a things.search in `system` scope), stats, evolution line, habitats.',
	args: [],
	render: () =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Thingmon',
				'One species.',
				k.card([
					k.row([k.link('← Dex', '/p/thingmon-dex', 'ghost', SMALL), k.muted('#{result.species.id} · {result.species.genus} · {result.species.rarity}', { marginLeft: 'auto' })]),
					el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', alignItems: 'start' }, [
						el('div', { display: 'grid', gap: '8px', justifyItems: 'center', padding: '16px', borderRadius: '16px', background: pick('result.species.rarity', RARITY_COLORS, T.soft) }, [
							{ tag: 'img', props: { src: '{result.species.sprite}', alt: '{result.species.name}', style: { width: '144px', height: '144px', imageRendering: 'pixelated', filter: { ttIf: { arg: 'result.seen', then: 'none', else: 'brightness(0) opacity(0.25)' } } } } },
							ifTruthy('result.seen', k.title('{result.species.name}'), k.title('???')),
							typePills('result.species.types'),
							ifTruthy('result.caught', k.pill('in your dex ✓', { background: T.ok, color: '#ffffff' }), ifTruthy('result.seen', k.pill('seen, not caught'), k.pill('not yet met')))
						]),
						el('div', { display: 'grid', gap: '8px' }, [
							ifTruthy('result.seen', k.text('{result.species.flavor}'), k.muted('Meet it in the wild to read its entry.')),
							k.label('Base stats'),
							statRow('HP', 'result.species.baseStats.hp', 130),
							statRow('ATK', 'result.species.baseStats.atk', 130),
							statRow('DEF', 'result.species.baseStats.def', 130),
							statRow('SPD', 'result.species.baseStats.spd', 130),
							k.muted('Catch rate {result.species.catchRate}/255 · {result.species.heightM} m · {result.species.weightKg} kg', { fontSize: '12px' }),
							k.label('Habitats'),
							k.row([each('result.species.habitats', k.pill('{item}'))], { gap: '4px' }),
							k.label('Evolution'),
							k.row([
								ifTruthy('result.evolvesFrom', k.link('← {result.evolvesFrom.name}', '/p/thingmon-species?id={result.evolvesFrom.id}', 'ghost', SMALL)),
								ifTruthy('result.evolvesTo', k.link('{result.evolvesTo.name} at Lv {result.species.evolvesTo.level} →', '/p/thingmon-species?id={result.evolvesTo.id}', 'ghost', SMALL), k.muted('Final form.', { fontSize: '12px' }))
							], { gap: '6px' }),
							ifTruthy('result.fromSystemData', k.muted('Record read from the seeded public species thing (system scope) and merged with the pack.', { fontSize: '11px' }))
						])
					])
				])
			)
		])
};

const shopItem = (refs: SuiteRefs): Node =>
	el('fieldset', { border: `1px solid ${T.border}`, margin: 0, padding: '12px', minWidth: 0, background: T.surface, borderRadius: '14px', display: 'grid', gap: '6px' }, [
		k.row([k.strong('{item.emoji} {item.name}', { fontSize: '15px' }), k.pill('💎 {item.price}', { background: '#fff3cf', color: '#7a5200' }), k.muted('you have {item.owned}', { marginLeft: 'auto', fontSize: '12px' })]),
		k.muted('{item.blurb}', { fontSize: '12px' }),
		k.row([k.input('qty', { type: 'number', min: 1, max: 10, value: 1 }, { width: '70px', padding: '6px 9px' }), k.button('Buy', refs.actionKey('buy'), { itemId: '{item.id}' }, 'solid', SMALL)], { gap: '6px' })
	]);
const shop: SuiteComponentDef = {
	key: 'shop',
	name: 'Shard shop',
	description: 'Spend shards won in battle: a quantity field per item, in its own fieldset, so Buy sends exactly that row’s qty.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Thingmon',
				'The shop.',
				ifTruthy(
					'result.hasKeeper',
					el('div', { display: 'grid', gap: '10px' }, [
						k.row([k.strong('Shop', { fontSize: '17px' }), k.pill('💎 {result.keeper.shards} shards', { background: '#fff3cf', color: '#7a5200' }), k.muted('Win battles or claim the daily bonus to earn more.', { marginLeft: 'auto', fontSize: '12px' })]),
						el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }, [each('result.bagList', shopItem(refs))])
					]),
					k.card([k.strong('No keeper yet'), k.row([k.link('→ Play', '/p/thingmon', 'solid')])])
				)
			)
		])
};

const keeperCard: SuiteComponentDef = {
	key: 'keeper',
	name: 'Keeper settings',
	description: 'Rename the keeper, read the ledger, and the Start over button — `each` over three searches deleting keeper, creatures and battles through a child action.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Thingmon',
				'Keeper settings.',
				ifTruthy(
					'result.hasKeeper',
					el('div', { display: 'grid', gap: '10px' }, [
						k.card([k.strong('Keeper', { fontSize: '17px' }), k.group([k.field('Name', k.input('name', { value: '{result.keeper.name}', maxLength: 16, required: true })), k.row([k.button('Save name', refs.actionKey('keeper-name'), {})])])]),
						k.card([
							k.strong('Ledger'),
							k.grid([k.stat('{result.keeper.shards}', 'shards'), k.stat('{result.keeper.wins}', 'wins'), k.stat('{result.keeper.losses}', 'losses'), k.stat('{result.keeper.catches}', 'catches'), k.stat('{result.keeper.explores}', 'expeditions'), k.stat('{result.keeper.streak}', 'daily streak')], 110),
							k.muted('Journey started {result.startedOn} · last daily bonus {result.keeper.lastDaily}')
						]),
						k.card([k.strong('Start over', { color: T.danger }), k.text('Deletes your keeper, every creature and every battle record (up to 20 of each per run — run it again for a very full box). The catalogue and the app itself stay.'), k.group([k.row([k.button('Delete my Thingmon data', refs.actionKey('reset'), {}, 'danger')])])])
					]),
					k.card([k.strong('No keeper yet'), k.row([k.link('→ Play', '/p/thingmon', 'solid')])])
				)
			)
		])
};

// ── step helpers ────────────────────────────────────────────────────────────
const keeperSearch = (refs: SuiteRefs) => search(refs.schema('keeper'), { limit: 1, sort: { field: 'updatedAt', dir: 'desc' } });
const partySearch = (refs: SuiteRefs) => search(refs.schema('critter'), { where: { slot: 'party' }, limit: 6, sort: { field: 'order', dir: 'asc' } });
const boxSearch = (refs: SuiteRefs) => search(refs.schema('critter'), { where: { slot: 'box' }, limit: 24, sort: { field: 'createdAt', dir: 'desc' } });
const battleSearch = (refs: SuiteRefs) => search(refs.schema('battle'), { where: { state: 'active' }, limit: 1, sort: { field: 'startedAt', dir: 'desc' } });
const critterPatch = (view: unknown): Node => x('pick', view, CRITTER_FIELDS);
const bagOf = (keeper: string): Node => coalesce(get(keeper, 'bag', null), {});
const bagCount = (bag: unknown, id: unknown): Node => get(bag, id, 0);
const bagAdjust = (bag: unknown, id: unknown, delta: number | Node): Node => x('set', bag, id, x('max', 0, x('add', bagCount(bag, id), delta)));
const listOf = (keeper: unknown, field: string): Node => coalesce(get(keeper, field, null), []);
const critterViews = (listStep: string, withEvolve = false): Node =>
	x(
		'map',
		listStep,
		merge('$item.crystal', {
			id: '$item.id',
			name: coalesce('$item.crystal.nickname', '$item.crystal.species'),
			hpPercent: percent('$item.crystal.hp', '$item.crystal.maxHp'),
			typeLine: x('join', coalesce('$item.crystal.types', []), ' / '),
			movesLine: x('join', x('map', coalesce('$item.crystal.moves', []), '$item.name'), ', '),
			...(withEvolve
				? {
						evolveAt: get(coalesce(get(x('thingmon.species', '$item.crystal.speciesId'), 'evolvesTo', null), {}), 'level', null),
						canEvolve: x('and', notEmpty(get(coalesce(get(x('thingmon.species', '$item.crystal.speciesId'), 'evolvesTo', null), {}), 'level', null)), x('gte', '$item.crystal.level', get(coalesce(get(x('thingmon.species', '$item.crystal.speciesId'), 'evolvesTo', null), {}), 'level', 999)))
					}
				: {})
		})
	);
const bagList = (bag: unknown): Node => x('map', x('thingmon.items'), merge('$item', { owned: bagCount(bag, '$item.id') }));
const bagView = (bag: unknown): Node => x('merge', ...['shard-crystal', 'tide-crystal', 'prism-crystal', 'tonic', 'elixir'].map((id) => ({ [id.replace('-', '_')]: bagCount(bag, id) })));
const caps = (refs: SuiteRefs, capability: string, ...schemas: string[]) => ({ capability, schemas: schemas.map((key) => refs.schema(key)) });
const invokeCap = (refs: SuiteRefs, ...actions: string[]) => ({ capability: 'actions.invoke', actions: actions.map((key) => refs.action(key)) });
const noKeeper = (step: string) => ({ op: 'fail', when: isEmpty(step), message: 'Choose a starter on the Play page first.' });
// steps 1–4 of every battle action: the active battle, its crystal, the player creature
const battlePrelude = (refs: SuiteRefs) => [
	battleSearch(refs),
	{ op: 'fail', when: isEmpty('$step.1'), message: 'No battle is on — explore a zone first.' },
	compute(firstCrystal('$step.1')),
	{ op: 'things.get', id: '$step.3.playerId' }
];
const battleState = (outcomeArg: unknown, won = 'won'): Node => iff(eq(outcomeArg, 'won'), won, iff(eq(outcomeArg, 'fainted'), 'lost', 'active'));
const appendLog = (existing: unknown, lines: unknown): Node => x('slice', x('flatten', x('append', [], coalesce(existing, []), coalesce(lines, []))), -40);

// ── actions ─────────────────────────────────────────────────────────────────
const stateAction: SuiteActionDef = {
	key: 'state',
	name: 'Game state',
	description: 'Everything the Play page draws: keeper, party, the live battle, zones with unlock flags, the bag.',
	category: 'thingmon',
	inputs: [],
	steps: (refs) => [
		keeperSearch(refs), // 1
		compute(firstCrystal('$step.1')), // 2
		partySearch(refs), // 3
		battleSearch(refs), // 4
		{ op: 'things.get', when: notEmpty('$step.4'), id: get(firstCrystal('$step.4'), 'playerId', '') }, // 5
		compute(x('thingmon.zones')), // 6
		compute(bagOf('$step.2')), // 7
		compute(len(listOf('$step.2', 'dexCaught'))), // 8
		compute(critterViews('$step.3')), // 9
		returnValue({
			hasKeeper: notEmpty('$step.2'),
			keeper: '$step.2',
			keeperId: firstId('$step.1'),
			party: '$step.9',
			partyCount: len('$step.3'),
			lead: x('find', '$step.9', x('gt', '$item.hp', 0)),
			inBattle: notEmpty('$step.4'),
			battle: iff(
				isEmpty('$step.4'),
				null,
				merge(firstCrystal('$step.4'), {
					id: firstId('$step.4'),
					player: merge(get('$step.5', 'crystal', {}), { id: get('$step.5', 'id', null), name: coalesce(get(get('$step.5', 'crystal', {}), 'nickname', null), get(get('$step.5', 'crystal', {}), 'species', '')), hpPercent: percent(get(get('$step.5', 'crystal', {}), 'hp', 0), get(get('$step.5', 'crystal', {}), 'maxHp', 1)) }),
					recentLog: x('slice', coalesce(get(firstCrystal('$step.4'), 'log', null), []), -5),
					zoneColor: get(coalesce(x('find', '$step.6', eq('$item.id', get(firstCrystal('$step.4'), 'zone', ''))), {}), 'color', T.surface)
				})
			),
			zones: x('map', '$step.6', merge('$item', { unlocked: x('gte', '$step.8', '$item.unlockDex'), current: eq('$item.id', get('$step.2', 'zone', 'meadow')) })),
			bag: bagView('$step.7'),
			bagList: bagList('$step.7'),
			dexCaughtCount: '$step.8',
			dexSeenCount: len(listOf('$step.2', 'dexSeen')),
			total: 60,
			lastMessage: coalesce(get('$step.2', 'lastMessage', null), ''),
			silent: true
		})
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper', 'critter', 'battle')],
	limits: { timeoutMs: 8000, maxOperations: 20, maxResultBytes: 160 * 1024 }
};

const startAction: SuiteActionDef = {
	key: 'start',
	name: 'Begin the journey',
	description: 'Creates your keeper (shards, bag, dex) and your starter creature.',
	category: 'thingmon',
	inputs: [
		{ name: 'name', type: 'string', label: 'Keeper name', required: true, maxLength: 16 },
		{ name: 'starterId', type: 'number', label: 'Starter species id (1, 4 or 7)', min: 1, max: 7, default: 1 }
	],
	steps: (refs) => [
		keeperSearch(refs), // 1
		{ op: 'return', when: notEmpty('$step.1'), value: { title: 'Welcome back', message: 'Your journey is already underway.' } }, // 2
		{ op: 'fail', when: x('not', x('includes', [1, 4, 7], '$input.starterId')), message: 'Pick Cindrel (1), Puddlin (4) or Sproutle (7).' }, // 3
		compute(x('thingmon.newCritter', { speciesId: '$input.starterId', level: 5 })), // 4
		{
			op: 'things.create',
			schema: refs.schema('keeper'),
			values: { name: x('slice', x('trim', '$input.name'), 0, 16), shards: STARTER_SHARDS, bag: STARTER_BAG, zone: 'meadow', dexSeen: ['$input.starterId'], dexCaught: ['$input.starterId'], wins: 0, losses: 0, catches: 1, explores: 0, streak: 0, lastDaily: null, lastMessage: concat('Welcome, keeper. ', '$step.4.species', ' is at your side — explore the Meadow!'), startedAt: '$now', updatedAt: '$now' }
		}, // 5
		{ op: 'things.create', schema: refs.schema('critter'), values: merge(critterPatch('$step.4'), { slot: 'party', order: 0, caughtAt: '$now', caughtIn: 'sanctuary', favorite: true }) }, // 6
		returnValue({ title: 'Your journey begins 🔮', message: concat('Welcome, ', '$step.5.crystal.name', '! ', '$step.4.species', ' is in your party. Explore the Meadow to meet your first wild Thingmon.') })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper'), caps(refs, 'things.create', 'keeper', 'critter')],
	limits: { timeoutMs: 8000, maxOperations: 12 }
};

const exploreAction: SuiteActionDef = {
	key: 'explore',
	name: 'Explore a zone',
	description: 'Rolls a wild encounter for the zone (rarity-weighted, legendaries gated by your dex) and opens a battle thing.',
	category: 'thingmon',
	inputs: [{ name: 'zone', type: 'enum', label: 'Zone', values: ['meadow', 'tidepool', 'embercave', 'duskmarsh', 'frostpeak', 'skybluff'], required: true }],
	steps: (refs) => [
		keeperSearch(refs), // 1
		noKeeper('$step.1'), // 2
		compute(firstCrystal('$step.1')), // 3
		battleSearch(refs), // 4
		{ op: 'fail', when: notEmpty('$step.4'), message: 'A wild Thingmon blocks the way — finish the battle first!' }, // 5
		compute(x('find', x('thingmon.zones'), eq('$item.id', '$input.zone'))), // 6
		{ op: 'fail', when: x('lt', len(listOf('$step.3', 'dexCaught')), '$step.6.unlockDex'), message: concat('Catch ', '$step.6.unlockDex', ' species to unlock the ', '$step.6.name', '.') }, // 7
		partySearch(refs), // 8
		compute(x('find', '$step.8', x('gt', '$item.crystal.hp', 0))), // 9
		{ op: 'fail', when: isEmpty('$step.9'), message: 'Your whole team has fainted — rest at the sanctuary (Team page) first.' }, // 10
		compute(x('thingmon.encounter', { zone: '$input.zone', dexCaught: len(listOf('$step.3', 'dexCaught')) })), // 11
		{
			op: 'things.create',
			schema: refs.schema('battle'),
			values: { state: 'active', zone: '$input.zone', wild: '$step.11', playerId: '$step.9.id', turn: 0, attempts: 0, log: [concat('A wild ', '$step.11.species', ' (Lv ', '$step.11.level', ') appeared in the ', '$step.6.name', '!')], startedAt: '$now', endedAt: null }
		}, // 12
		{ op: 'things.update', id: firstId('$step.1'), values: { zone: '$input.zone', explores: x('add', coalesce(get('$step.3', 'explores', null), 0), 1), dexSeen: x('uniq', x('append', listOf('$step.3', 'dexSeen'), '$step.11.speciesId')), lastMessage: concat('A wild ', '$step.11.species', ' appeared in the ', '$step.6.name', '!'), updatedAt: '$now' } }, // 13
		returnValue({ title: concat('A wild ', '$step.11.species', '!'), message: concat('Lv ', '$step.11.level', ' · ', '$step.11.typeLine', '. ', '$step.9.crystal.species', ' steps forward.'), encounter: '$step.11' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper', 'critter', 'battle'), caps(refs, 'things.update', 'keeper'), caps(refs, 'things.create', 'battle')],
	limits: { timeoutMs: 8000, maxOperations: 24 }
};

const battleMoveAction: SuiteActionDef = {
	key: 'battle-move',
	name: 'Use a move',
	description: 'One battle turn through the pack (speed order, type chart, crits, status, drain); on a win: experience, shards, a possible level-up.',
	category: 'thingmon',
	inputs: [{ name: 'moveIndex', type: 'number', label: 'Move slot', min: 0, max: 3, default: 0 }],
	steps: (refs) => [
		...battlePrelude(refs), // 1–4
		compute(x('thingmon.battleTurn', { player: '$step.4.crystal', wild: '$step.3.wild', moveIndex: '$input.moveIndex' })), // 5
		compute(x('thingmon.expGain', { member: '$step.5.player', defeated: '$step.5.wild' }), eq('$step.5.outcome', 'won')), // 6
		{ op: 'things.update', id: '$step.4.id', values: critterPatch(coalesce(get('$step.6', 'member', null), '$step.5.player')) }, // 7
		keeperSearch(refs), // 8
		compute(firstCrystal('$step.8')), // 9
		{
			op: 'things.update',
			id: firstId('$step.8'),
			values: {
				shards: x('add', coalesce(get('$step.9', 'shards', null), 0), coalesce('$step.5.shards', 0)),
				wins: x('add', coalesce(get('$step.9', 'wins', null), 0), iff(eq('$step.5.outcome', 'won'), 1, 0)),
				losses: x('add', coalesce(get('$step.9', 'losses', null), 0), iff(eq('$step.5.outcome', 'fainted'), 1, 0)),
				lastMessage: x('join', '$step.5.log', ' '),
				updatedAt: '$now'
			}
		}, // 10
		{ op: 'things.update', id: firstId('$step.1'), values: { wild: '$step.5.wild', log: appendLog('$step.3.log', '$step.5.log'), turn: x('add', coalesce('$step.3.turn', 0), 1), state: battleState('$step.5.outcome'), endedAt: iff(eq('$step.5.outcome', 'continue'), null, '$now') } }, // 11
		{ op: 'actions.invoke', when: eq('$step.5.outcome', 'fainted'), action: refs.action('heal') }, // 12
		returnValue({
			title: iff(eq('$step.5.outcome', 'won'), 'Victory! 🏆', iff(eq('$step.5.outcome', 'fainted'), 'Fainted…', 'Battle')),
			message: x(
				'join',
				x('append', '$step.5.log', iff(notEmpty('$step.6'), concat('+', coalesce(get('$step.6', 'gained', null), 0), ' EXP, +', coalesce('$step.5.shards', 0), ' shards.', iff(get('$step.6', 'leveledUp', false), concat(' Grew to Lv ', get('$step.6', 'to', ''), '!'), ''), iff(get('$step.6', 'canEvolve', false), concat(' It can evolve into ', get('$step.6', 'evolvesTo', ''), ' — see the Team page.'), '')), ''), iff(eq('$step.5.outcome', 'fainted'), 'You hurried the team back to the sanctuary — everyone is rested.', '')),
				' '
			),
			outcome: '$step.5.outcome'
		})
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'battle', 'critter', 'keeper'), caps(refs, 'things.update', 'battle', 'critter', 'keeper'), invokeCap(refs, 'heal')],
	limits: { timeoutMs: 10000, maxOperations: 30, maxChildActions: 12 }
};

const battleCatchAction: SuiteActionDef = {
	key: 'battle-catch',
	name: 'Throw a crystal',
	description: 'The capture roll (HP, catch rate, crystal bonus, status, three shakes); a miss hands the wild its turn.',
	category: 'thingmon',
	inputs: [{ name: 'itemId', type: 'enum', label: 'Crystal', values: ['shard-crystal', 'tide-crystal', 'prism-crystal'], required: true }],
	steps: (refs) => [
		...battlePrelude(refs), // 1–4
		keeperSearch(refs), // 5
		compute(firstCrystal('$step.5')), // 6
		{ op: 'fail', when: x('lte', bagCount(bagOf('$step.6'), '$input.itemId'), 0), message: concat('You have no ', x('replace', '$input.itemId', '-', ' '), ' left — the shop sells more.') }, // 7
		compute(x('thingmon.catchRoll', { player: '$step.4.crystal', wild: '$step.3.wild', itemId: '$input.itemId' })), // 8
		partySearch(refs), // 9
		{
			op: 'things.update',
			id: firstId('$step.5'),
			values: {
				bag: bagAdjust(bagOf('$step.6'), '$input.itemId', -1),
				dexCaught: iff('$step.8.caught', x('uniq', x('append', listOf('$step.6', 'dexCaught'), '$step.3.wild.speciesId')), listOf('$step.6', 'dexCaught')),
				catches: x('add', coalesce(get('$step.6', 'catches', null), 0), iff('$step.8.caught', 1, 0)),
				losses: x('add', coalesce(get('$step.6', 'losses', null), 0), iff(eq('$step.8.outcome', 'fainted'), 1, 0)),
				lastMessage: '$step.8.message',
				updatedAt: '$now'
			}
		}, // 10
		{ op: 'things.create', when: '$step.8.caught', schema: refs.schema('critter'), values: merge(critterPatch('$step.8.wild'), { slot: iff(x('lt', len('$step.9'), 6), 'party', 'box'), order: len('$step.9'), caughtAt: '$now', caughtIn: '$step.3.zone', favorite: false }) }, // 11
		{ op: 'things.update', when: x('not', '$step.8.caught'), id: '$step.4.id', values: critterPatch('$step.8.player') }, // 12
		{ op: 'things.update', id: firstId('$step.1'), values: { wild: '$step.8.wild', log: appendLog('$step.3.log', '$step.8.log'), attempts: x('add', coalesce('$step.3.attempts', 0), 1), state: iff('$step.8.caught', 'caught', battleState('$step.8.outcome')), endedAt: iff(x('or', '$step.8.caught', eq('$step.8.outcome', 'fainted')), '$now', null) } }, // 13
		{ op: 'actions.invoke', when: eq('$step.8.outcome', 'fainted'), action: refs.action('heal') }, // 14
		returnValue({ title: iff('$step.8.caught', 'Gotcha! 🔮', 'It broke free!'), message: concat('$step.8.message', iff('$step.8.caught', iff(x('lt', len('$step.9'), 6), ' It joins your party.', ' Your party is full — it went to the box.'), '')), caught: '$step.8.caught', outcome: '$step.8.outcome' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'battle', 'critter', 'keeper'), caps(refs, 'things.update', 'battle', 'critter', 'keeper'), caps(refs, 'things.create', 'critter'), invokeCap(refs, 'heal')],
	limits: { timeoutMs: 10000, maxOperations: 30, maxChildActions: 12 }
};

const battleFleeAction: SuiteActionDef = {
	key: 'battle-flee',
	name: 'Run away',
	description: 'A flee roll from the speed ratio and the number of attempts; a failure hands the wild its turn.',
	category: 'thingmon',
	inputs: [],
	steps: (refs) => [
		...battlePrelude(refs), // 1–4
		compute(x('thingmon.fleeRoll', { player: '$step.4.crystal', wild: '$step.3.wild', attempts: coalesce('$step.3.attempts', 0) })), // 5
		{ op: 'things.update', when: x('not', '$step.5.escaped'), id: '$step.4.id', values: critterPatch('$step.5.player') }, // 6
		keeperSearch(refs), // 7
		{ op: 'things.update', id: firstId('$step.7'), values: { lastMessage: '$step.5.message', losses: x('add', coalesce(get(firstCrystal('$step.7'), 'losses', null), 0), iff(eq('$step.5.outcome', 'fainted'), 1, 0)), updatedAt: '$now' } }, // 8
		{ op: 'things.update', id: firstId('$step.1'), values: { log: appendLog('$step.3.log', '$step.5.log'), attempts: x('add', coalesce('$step.3.attempts', 0), 1), state: iff('$step.5.escaped', 'fled', battleState('$step.5.outcome')), endedAt: iff(x('or', '$step.5.escaped', eq('$step.5.outcome', 'fainted')), '$now', null) } }, // 9
		{ op: 'actions.invoke', when: eq('$step.5.outcome', 'fainted'), action: refs.action('heal') }, // 10
		returnValue({ title: iff('$step.5.escaped', 'Phew', 'Can’t escape!'), message: '$step.5.message', escaped: '$step.5.escaped' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'battle', 'critter', 'keeper'), caps(refs, 'things.update', 'battle', 'critter', 'keeper'), invokeCap(refs, 'heal')],
	limits: { timeoutMs: 10000, maxOperations: 24, maxChildActions: 12 }
};

const battleItemAction: SuiteActionDef = {
	key: 'battle-item',
	name: 'Use an item in battle',
	description: 'A tonic or elixir on your creature; using it costs the turn, so the wild replies.',
	category: 'thingmon',
	inputs: [{ name: 'itemId', type: 'enum', label: 'Item', values: ['tonic', 'elixir'], required: true }],
	steps: (refs) => [
		...battlePrelude(refs), // 1–4
		keeperSearch(refs), // 5
		compute(firstCrystal('$step.5')), // 6
		{ op: 'fail', when: x('lte', bagCount(bagOf('$step.6'), '$input.itemId'), 0), message: concat('No ', '$input.itemId', ' left.') }, // 7
		compute(x('thingmon.useItem', { member: '$step.4.crystal', itemId: '$input.itemId', inBattle: true })), // 8
		compute(x('thingmon.wildTurn', { player: '$step.8.member', wild: '$step.3.wild' }), '$step.8.consumed'), // 9
		{ op: 'things.update', id: '$step.4.id', values: critterPatch(coalesce(get('$step.9', 'player', null), '$step.8.member')) }, // 10
		{ op: 'things.update', when: '$step.8.consumed', id: firstId('$step.5'), values: { bag: bagAdjust(bagOf('$step.6'), '$input.itemId', -1), lastMessage: '$step.8.message', updatedAt: '$now' } }, // 11
		{ op: 'things.update', when: '$step.8.consumed', id: firstId('$step.1'), values: { wild: coalesce(get('$step.9', 'wild', null), '$step.3.wild'), log: appendLog('$step.3.log', x('append', ['$step.8.message'], coalesce(get('$step.9', 'log', null), []))), turn: x('add', coalesce('$step.3.turn', 0), 1), state: battleState(get('$step.9', 'outcome', 'continue')), endedAt: iff(eq(get('$step.9', 'outcome', 'continue'), 'fainted'), '$now', null) } }, // 12
		{ op: 'actions.invoke', when: eq(get('$step.9', 'outcome', 'continue'), 'fainted'), action: refs.action('heal') }, // 13
		returnValue({ title: iff('$step.8.consumed', 'Used it', 'No effect'), message: concat('$step.8.message', ' ', coalesce(get('$step.9', 'message', null), '')) })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'battle', 'critter', 'keeper'), caps(refs, 'things.update', 'battle', 'critter', 'keeper'), invokeCap(refs, 'heal')],
	limits: { timeoutMs: 10000, maxOperations: 24, maxChildActions: 12 }
};

const healOneAction: SuiteActionDef = {
	key: 'heal-one',
	name: 'Heal one creature',
	description: 'Full HP and no conditions for one of your creatures.',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 }],
	steps: () => [{ op: 'things.get', id: '$input.id' }, compute(x('thingmon.heal', '$step.1.crystal')), { op: 'things.update', id: '$input.id', values: critterPatch('$step.2') }, returnValue({ id: '$input.id', hp: '$step.2.hp' })],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter'), caps(refs, 'things.update', 'critter')],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};
const healAction: SuiteActionDef = {
	key: 'heal',
	name: 'Rest at the sanctuary',
	description: 'Heals the whole party — `each` over the party search, one child heal per creature.',
	category: 'thingmon',
	inputs: [],
	steps: (refs) => [partySearch(refs), { op: 'each', action: refs.action('heal-one'), list: '$step.1', inputs: { id: '$item.id' }, max: 6 }, returnValue({ healed: len('$step.1'), message: concat('Your team of ', len('$step.1'), ' is rested and ready.') })],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter'), invokeCap(refs, 'heal-one')],
	limits: { timeoutMs: 8000, maxOperations: 30, maxChildActions: 8 }
};

const setLeadAction: SuiteActionDef = {
	key: 'set-lead',
	name: 'Make lead',
	description: 'Swaps party order so this creature fights first.',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 }],
	steps: (refs) => [
		partySearch(refs), // 1
		{ op: 'things.get', id: '$input.id' }, // 2
		{ op: 'fail', when: x('ne', '$step.2.crystal.slot', 'party'), message: 'Withdraw it from the box first.' }, // 3
		compute(x('first', '$step.1')), // 4
		{ op: 'things.update', id: '$step.4.id', values: { order: coalesce('$step.2.crystal.order', 0) } }, // 5
		{ op: 'things.update', id: '$input.id', values: { order: -1 } }, // 6
		returnValue({ message: concat(coalesce('$step.2.crystal.nickname', '$step.2.crystal.species'), ' now leads the party.') })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter'), caps(refs, 'things.update', 'critter')],
	limits: { timeoutMs: 6000, maxOperations: 10 }
};
const renameAction: SuiteActionDef = {
	key: 'rename',
	name: 'Nickname',
	description: 'Sets or clears a creature’s nickname (explicit empty clears it).',
	category: 'thingmon',
	inputs: [
		{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 },
		{ name: 'nickname', type: 'string', label: 'Nickname', default: '', maxLength: 16 }
	],
	steps: () => [{ op: 'things.update', id: '$input.id', values: { nickname: iff(isEmpty(x('trim', '$input.nickname')), null, x('trim', '$input.nickname')) } }, returnValue({ message: iff(isEmpty(x('trim', '$input.nickname')), 'Nickname cleared.', concat('It answers to ', x('trim', '$input.nickname'), ' now.')) })],
	capabilities: (refs) => [caps(refs, 'things.update', 'critter')],
	limits: { timeoutMs: 4000, maxOperations: 4 }
};
const depositAction: SuiteActionDef = {
	key: 'deposit',
	name: 'Send to box',
	description: 'Moves a creature from the party to the box (never the last one).',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 }],
	steps: (refs) => [partySearch(refs), { op: 'fail', when: x('lte', len('$step.1'), 1), message: 'You need at least one creature in the party.' }, { op: 'things.update', id: '$input.id', values: { slot: 'box', order: 99 } }, returnValue({ message: 'Sent to the box.' })],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter'), caps(refs, 'things.update', 'critter')],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};
const withdrawAction: SuiteActionDef = {
	key: 'withdraw',
	name: 'Withdraw from box',
	description: 'Moves a creature into the party when there is room.',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 }],
	steps: (refs) => [partySearch(refs), { op: 'fail', when: x('gte', len('$step.1'), 6), message: 'Your party is full (6).' }, { op: 'things.update', id: '$input.id', values: { slot: 'party', order: len('$step.1') } }, returnValue({ message: 'Joined the party.' })],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter'), caps(refs, 'things.update', 'critter')],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};
const releaseAction: SuiteActionDef = {
	key: 'release',
	name: 'Release',
	description: 'Deletes a boxed creature thing.',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 }],
	steps: () => [{ op: 'things.get', id: '$input.id' }, { op: 'fail', when: x('ne', '$step.1.crystal.slot', 'box'), message: 'Only boxed creatures can be released.' }, { op: 'things.delete', id: '$input.id' }, returnValue({ message: concat('$step.1.crystal.species', ' wandered back into the wild. Bye!') })],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter'), caps(refs, 'things.delete', 'critter')],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};
const evolveAction: SuiteActionDef = {
	key: 'evolve',
	name: 'Evolve',
	description: 'Evolves a creature that reached its line’s level; the new form lands in your dex.',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 }],
	steps: (refs) => [
		{ op: 'things.get', id: '$input.id' }, // 1
		compute(x('thingmon.evolve', '$step.1.crystal')), // 2
		{ op: 'things.update', id: '$input.id', values: critterPatch('$step.2.member') }, // 3
		keeperSearch(refs), // 4
		{ op: 'things.update', id: firstId('$step.4'), values: { dexSeen: x('uniq', x('append', listOf(firstCrystal('$step.4'), 'dexSeen'), '$step.2.member.speciesId')), dexCaught: x('uniq', x('append', listOf(firstCrystal('$step.4'), 'dexCaught'), '$step.2.member.speciesId')), lastMessage: '$step.2.message', updatedAt: '$now' } }, // 5
		returnValue({ title: 'Evolution! ✨', message: '$step.2.message', from: '$step.2.from', to: '$step.2.to' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'critter', 'keeper'), caps(refs, 'things.update', 'critter', 'keeper')],
	limits: { timeoutMs: 6000, maxOperations: 10 }
};
const useItemAction: SuiteActionDef = {
	key: 'use-item',
	name: 'Use a tonic',
	description: 'A tonic or elixir from the bag on one creature, outside battle.',
	category: 'thingmon',
	inputs: [
		{ name: 'id', type: 'string', label: 'Creature id', required: true, maxLength: 80 },
		{ name: 'itemId', type: 'enum', label: 'Item', values: ['tonic', 'elixir'], required: true }
	],
	steps: (refs) => [
		keeperSearch(refs), // 1
		noKeeper('$step.1'), // 2
		compute(firstCrystal('$step.1')), // 3
		{ op: 'fail', when: x('lte', bagCount(bagOf('$step.3'), '$input.itemId'), 0), message: concat('No ', '$input.itemId', ' in the bag — the shop sells them.') }, // 4
		{ op: 'things.get', id: '$input.id' }, // 5
		compute(x('thingmon.useItem', { member: '$step.5.crystal', itemId: '$input.itemId' })), // 6
		{ op: 'things.update', when: '$step.6.consumed', id: '$input.id', values: critterPatch('$step.6.member') }, // 7
		{ op: 'things.update', when: '$step.6.consumed', id: firstId('$step.1'), values: { bag: bagAdjust(bagOf('$step.3'), '$input.itemId', -1), updatedAt: '$now' } }, // 8
		returnValue({ message: '$step.6.message', consumed: '$step.6.consumed' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper', 'critter'), caps(refs, 'things.update', 'keeper', 'critter')],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};
const buyAction: SuiteActionDef = {
	key: 'buy',
	name: 'Buy from the shop',
	description: 'Spends shards on crystals or tonics: price × quantity checked against your balance, the bag updated with `set`.',
	category: 'thingmon',
	inputs: [
		{ name: 'itemId', type: 'enum', label: 'Item', values: ['shard-crystal', 'tide-crystal', 'prism-crystal', 'tonic', 'elixir'], required: true },
		{ name: 'qty', type: 'number', label: 'Quantity', min: 1, max: 10, default: 1 }
	],
	steps: (refs) => [
		keeperSearch(refs), // 1
		noKeeper('$step.1'), // 2
		compute(firstCrystal('$step.1')), // 3
		compute(x('find', x('thingmon.items'), eq('$item.id', '$input.itemId'))), // 4
		compute(x('mul', '$step.4.price', x('round', '$input.qty'))), // 5
		{ op: 'fail', when: x('gt', '$step.5', coalesce(get('$step.3', 'shards', null), 0)), message: concat('That costs ', '$step.5', ' shards and you have ', coalesce(get('$step.3', 'shards', null), 0), '.') }, // 6
		{ op: 'things.update', id: firstId('$step.1'), values: { shards: x('sub', coalesce(get('$step.3', 'shards', null), 0), '$step.5'), bag: bagAdjust(bagOf('$step.3'), '$input.itemId', x('round', '$input.qty') as unknown as number), updatedAt: '$now' } }, // 7
		returnValue({ message: concat('Bought ', x('round', '$input.qty'), ' × ', '$step.4.name', ' for ', '$step.5', ' shards.'), shards: '$step.7.crystal.shards' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper'), caps(refs, 'things.update', 'keeper')],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};
const dailyAction: SuiteActionDef = {
	key: 'daily',
	name: 'Daily bonus',
	description: 'Once per calendar day: shards plus a streak bonus (isoDate / dateAdd over $now).',
	category: 'thingmon',
	inputs: [],
	steps: (refs) => [
		keeperSearch(refs), // 1
		noKeeper('$step.1'), // 2
		compute(firstCrystal('$step.1')), // 3
		compute(today()), // 4
		{ op: 'fail', when: eq(get('$step.3', 'lastDaily', null), '$step.4'), message: 'Already claimed today — come back tomorrow.' }, // 5
		compute(x('isoDate', x('dateAdd', '$now', -1, 'day'))), // 6
		compute(iff(eq(get('$step.3', 'lastDaily', null), '$step.6'), x('add', coalesce(get('$step.3', 'streak', null), 0), 1), 1)), // 7
		compute(x('add', 25, x('mul', 5, x('min', 10, '$step.7')))), // 8
		{ op: 'things.update', id: firstId('$step.1'), values: { shards: x('add', coalesce(get('$step.3', 'shards', null), 0), '$step.8'), lastDaily: '$step.4', streak: '$step.7', lastMessage: concat('Daily bonus: +', '$step.8', ' shards (streak ', '$step.7', ').'), updatedAt: '$now' } }, // 9
		returnValue({ title: 'Daily bonus 🎁', message: concat('+', '$step.8', ' shards. Streak: ', '$step.7', ' day(s).'), shards: '$step.9.crystal.shards' })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper'), caps(refs, 'things.update', 'keeper')],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};
const teamAction: SuiteActionDef = {
	key: 'team',
	name: 'Team & box',
	description: 'The party (with evolve readiness from the pack) and the box.',
	category: 'thingmon',
	inputs: [],
	steps: (refs) => [
		keeperSearch(refs), // 1
		compute(firstCrystal('$step.1')), // 2
		partySearch(refs), // 3
		boxSearch(refs), // 4
		returnValue({ hasKeeper: notEmpty('$step.2'), keeper: '$step.2', party: critterViews('$step.3', true), box: critterViews('$step.4'), partyCount: len('$step.3'), boxCount: len('$step.4'), silent: true })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper', 'critter')],
	limits: { timeoutMs: 8000, maxOperations: 40, maxResultBytes: 192 * 1024 }
};
const dexAction: SuiteActionDef = {
	key: 'dex',
	name: 'Dex page',
	description: 'A page of the catalogue with your seen / caught flags.',
	category: 'thingmon',
	inputs: [{ name: 'page', type: 'number', label: 'Page', min: 1, max: 9, default: 1 }],
	steps: (refs) => [
		keeperSearch(refs), // 1
		compute(firstCrystal('$step.1')), // 2
		compute(x('thingmon.dex', x('max', 1, x('round', coalesce('$input.page', 1))), 30)), // 3
		compute(listOf('$step.2', 'dexSeen')), // 4
		compute(listOf('$step.2', 'dexCaught')), // 5
		returnValue({
			hasKeeper: notEmpty('$step.2'),
			items: x('map', '$step.3.items', merge('$item', { seen: x('includes', '$step.4', '$item.id'), caught: x('includes', '$step.5', '$item.id') })),
			page: '$step.3.page',
			pages: '$step.3.pages',
			total: '$step.3.total',
			prevPage: x('max', 1, x('sub', '$step.3.page', 1)),
			nextPage: x('min', '$step.3.pages', x('add', '$step.3.page', 1)),
			seenCount: len('$step.4'),
			caughtCount: len('$step.5'),
			silent: true
		})
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper')],
	limits: { timeoutMs: 6000, maxOperations: 10, maxResultBytes: 128 * 1024 }
};
const speciesAction: SuiteActionDef = {
	key: 'species',
	name: 'Species record',
	description: 'One species: the pack record merged with the seeded public data thing (things.search in `system` scope), plus your dex flags.',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'number', label: 'Species id', min: 1, max: 60, default: 1 }],
	steps: (refs) => [
		compute(x('thingmon.species', x('round', coalesce('$input.id', 1)))), // 1
		search(refs.schema('species'), { scope: 'system', where: { id: x('round', coalesce('$input.id', 1)) }, limit: 1 }), // 2
		keeperSearch(refs), // 3
		compute(firstCrystal('$step.3')), // 4
		compute(merge('$step.1', coalesce(firstCrystal('$step.2'), {}))), // 5
		returnValue({
			species: merge('$step.5', { baseStats: merge('$step.5.baseStats', { hpPct: percent('$step.5.baseStats.hp', 130), atkPct: percent('$step.5.baseStats.atk', 130), defPct: percent('$step.5.baseStats.def', 130), spdPct: percent('$step.5.baseStats.spd', 130) }) }),
			fromSystemData: notEmpty('$step.2'),
			seen: x('includes', listOf('$step.4', 'dexSeen'), '$step.5.id'),
			caught: x('includes', listOf('$step.4', 'dexCaught'), '$step.5.id'),
			evolvesTo: iff(isEmpty('$step.5.evolvesTo'), null, x('thingmon.species', get(coalesce('$step.5.evolvesTo', {}), 'id', 1))),
			evolvesFrom: iff(isEmpty('$step.5.evolvesFrom'), null, x('thingmon.species', coalesce('$step.5.evolvesFrom', 1))),
			silent: true
		})
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'species', 'keeper')],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};
const keeperNameAction: SuiteActionDef = {
	key: 'keeper-name',
	name: 'Rename keeper',
	description: 'Updates the keeper’s name.',
	category: 'thingmon',
	inputs: [{ name: 'name', type: 'string', label: 'Name', required: true, maxLength: 16 }],
	steps: (refs) => [keeperSearch(refs), noKeeper('$step.1'), { op: 'things.update', id: firstId('$step.1'), values: { name: x('slice', x('trim', '$input.name'), 0, 16), updatedAt: '$now' } }, returnValue({ message: concat('You are ', x('trim', '$input.name'), ' now.') })],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper'), caps(refs, 'things.update', 'keeper')],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};
const discardAction: SuiteActionDef = {
	key: 'discard',
	name: 'Discard a record',
	description: 'Deletes one of your Thingmon data things (the child of Start over).',
	category: 'thingmon',
	inputs: [{ name: 'id', type: 'string', label: 'Thing id', required: true, maxLength: 80 }],
	steps: () => [{ op: 'things.delete', id: '$input.id' }, returnValue({ id: '$input.id' })],
	capabilities: (refs) => [caps(refs, 'things.delete', 'keeper', 'critter', 'battle')],
	limits: { timeoutMs: 4000, maxOperations: 4 }
};
const resetAction: SuiteActionDef = {
	key: 'reset',
	name: 'Start over',
	description: 'Deletes your keeper, creatures and battles — three searches, three `each` loops over the discard action.',
	category: 'thingmon',
	inputs: [],
	steps: (refs) => [
		search(refs.schema('keeper'), { limit: 20 }), // 1
		search(refs.schema('critter'), { limit: 20 }), // 2
		search(refs.schema('battle'), { limit: 20 }), // 3
		{ op: 'each', action: refs.action('discard'), list: '$step.1', inputs: { id: '$item.id' }, max: 20 }, // 4
		{ op: 'each', action: refs.action('discard'), list: '$step.2', inputs: { id: '$item.id' }, max: 20 }, // 5
		{ op: 'each', action: refs.action('discard'), list: '$step.3', inputs: { id: '$item.id' }, max: 20 }, // 6
		returnValue({ removed: x('add', len('$step.1'), len('$step.2'), len('$step.3')), message: concat('Removed ', x('add', len('$step.1'), len('$step.2'), len('$step.3')), ' things. Choose a new starter on the Play page.') })
	],
	capabilities: (refs) => [caps(refs, 'things.read', 'keeper', 'critter', 'battle'), invokeCap(refs, 'discard')],
	limits: { timeoutMs: 10000, maxOperations: 100, maxChildActions: 64 }
};

// nested field shapes the schema gate needs spelled out (object fields carry children)
const BAG_FIELDS = ['shard-crystal', 'tide-crystal', 'prism-crystal', 'tonic', 'elixir'].map((name) => ({ name, type: 'number' as const, min: 0 }));
const STAT_FIELDS = ['hp', 'atk', 'def', 'spd'].map((name) => ({ name, type: 'number' as const }));
const MOVE_FIELDS = [
	{ name: 'id', type: 'string' as const, maxLength: 30 },
	{ name: 'name', type: 'string' as const, maxLength: 30 },
	{ name: 'type', type: 'string' as const, maxLength: 12 },
	{ name: 'power', type: 'number' as const }
];
const CRITTER_FIELD_DEFS = [
	{ name: 'speciesId', type: 'number' as const, required: true, min: 1, max: 60 },
	{ name: 'species', type: 'string' as const, maxLength: 40 },
	{ name: 'nickname', type: 'string' as const, maxLength: 16 },
	{ name: 'types', type: 'string[]' as const, maxItems: 2 },
	{ name: 'rarity', type: 'enum' as const, values: ['common', 'uncommon', 'rare', 'legendary'] },
	{ name: 'level', type: 'number' as const, min: 1, max: 50 },
	{ name: 'exp', type: 'number' as const },
	{ name: 'iv', type: 'number' as const },
	{ name: 'hp', type: 'number' as const },
	{ name: 'maxHp', type: 'number' as const },
	{ name: 'atk', type: 'number' as const },
	{ name: 'def', type: 'number' as const },
	{ name: 'spd', type: 'number' as const },
	{ name: 'status', type: 'enum' as const, values: ['ok', 'burned', 'chilled', 'shocked'] },
	{ name: 'moves', type: 'array' as const, items: { type: 'object' as const, children: MOVE_FIELDS }, maxItems: 4 },
	{ name: 'sprite', type: 'string' as const, maxLength: 200 },
	{ name: 'stage', type: 'number' as const }
];

// ── the suite ───────────────────────────────────────────────────────────────
export const thingmonSuite: BehaviourSuite = {
	key: 'thingmon',
	title: 'Thingmon',
	emoji: '🔮',
	description: 'A creature collector with sixty original pixel-art species: explore six zones, battle turn by turn, catch with crystals, level up, evolve, fill the dex.',
	story: [
		'Every rule lives in the `thingmon` domain pack — encounters, the eight-type chart, damage, captures, experience, evolution — and every move of the game is one declarative action run: explore rolls a wild creature into a battle thing, a move resolves one turn, a crystal rolls the capture. Your keeper, creatures and battles are data things you own.',
		'The sixty species and their sprites are original, generated deterministically by scripts/generate-thingmon-sprites.mjs and seeded as public system data the dex reads in system scope. Deep links (?page=, ?id=), per-row fieldsets (rename, buy), `each` over child actions (rest, start over) and a time-gated daily bonus round out the tour.'
	],
	tone: 'paper',
	app: { tagline: 'Sixty original creatures. Gotta thing ’em all 🔮', entry: 'play' },
	schemas: [
		{
			key: 'keeper',
			description: 'You: name, shards, bag, zone, dex flags, the ledger of wins and catches.',
			fields: [
				{ name: 'name', type: 'string', required: true, maxLength: 16 },
				{ name: 'shards', type: 'number', min: 0 },
				{ name: 'bag', type: 'object', description: 'item id → count', children: BAG_FIELDS },
				{ name: 'zone', type: 'enum', values: ['meadow', 'tidepool', 'embercave', 'duskmarsh', 'frostpeak', 'skybluff'] },
				{ name: 'dexSeen', type: 'array', items: { type: 'number' }, maxItems: 60 },
				{ name: 'dexCaught', type: 'array', items: { type: 'number' }, maxItems: 60 },
				{ name: 'wins', type: 'number' },
				{ name: 'losses', type: 'number' },
				{ name: 'catches', type: 'number' },
				{ name: 'explores', type: 'number' },
				{ name: 'streak', type: 'number' },
				{ name: 'lastDaily', type: 'date' },
				{ name: 'lastMessage', type: 'string', maxLength: 600 },
				{ name: 'startedAt', type: 'date' },
				{ name: 'updatedAt', type: 'date' }
			]
		},
		{
			key: 'critter',
			description: 'One creature you keep: species, level, stats, moves, party slot.',
			fields: [
				...CRITTER_FIELD_DEFS,
				{ name: 'slot', type: 'enum', values: ['party', 'box'] },
				{ name: 'order', type: 'number' },
				{ name: 'caughtAt', type: 'date' },
				{ name: 'caughtIn', type: 'string', maxLength: 30 },
				{ name: 'favorite', type: 'boolean' }
			]
		},
		{
			key: 'battle',
			description: 'A live (or finished) wild battle: the wild creature, which of yours fights, the log.',
			fields: [
				{ name: 'state', type: 'enum', values: ['active', 'won', 'lost', 'caught', 'fled'], required: true },
				{ name: 'zone', type: 'string', maxLength: 30 },
				{ name: 'wild', type: 'object', children: CRITTER_FIELD_DEFS },
				{ name: 'playerId', type: 'string', maxLength: 80 },
				{ name: 'turn', type: 'number' },
				{ name: 'attempts', type: 'number' },
				{ name: 'log', type: 'string[]', maxItems: 40 },
				{ name: 'startedAt', type: 'date' },
				{ name: 'endedAt', type: 'date' }
			]
		},
		{
			key: 'species',
			description: 'One of the sixty species (public content): types, stats, rarity, evolution, sprite.',
			fields: [
				{ name: 'id', type: 'number', required: true, min: 1, max: 60 },
				{ name: 'slug', type: 'string', maxLength: 40 },
				{ name: 'name', type: 'string', required: true, maxLength: 40 },
				{ name: 'line', type: 'string', maxLength: 30 },
				{ name: 'archetype', type: 'string', maxLength: 20 },
				{ name: 'stage', type: 'number' },
				{ name: 'types', type: 'string[]', maxItems: 2 },
				{ name: 'rarity', type: 'enum', values: ['common', 'uncommon', 'rare', 'legendary'] },
				{ name: 'evolvesTo', type: 'object', children: [{ name: 'id', type: 'number' }, { name: 'level', type: 'number' }] },
				{ name: 'evolvesFrom', type: 'number' },
				{ name: 'habitats', type: 'string[]', maxItems: 6 },
				{ name: 'genus', type: 'string', maxLength: 40 },
				{ name: 'flavor', type: 'string', maxLength: 400 },
				{ name: 'baseStats', type: 'object', children: STAT_FIELDS },
				{ name: 'catchRate', type: 'number' },
				{ name: 'baseExp', type: 'number' },
				{ name: 'heightM', type: 'number' },
				{ name: 'weightKg', type: 'number' },
				{ name: 'sprite', type: 'string', maxLength: 200 },
				{ name: 'typeEmoji', type: 'string', maxLength: 8 },
				{ name: 'typeLine', type: 'string', maxLength: 30 }
			]
		}
	],
	components: [nav, hud, explore, battle, team, dex, speciesCard, shop, keeperCard],
	actions: [stateAction, startAction, exploreAction, battleMoveAction, battleCatchAction, battleFleeAction, battleItemAction, healOneAction, healAction, setLeadAction, renameAction, depositAction, withdrawAction, releaseAction, evolveAction, useItemAction, buyAction, dailyAction, teamAction, dexAction, speciesAction, keeperNameAction, discardAction, resetAction],
	data: [],
	content: () => SPECIES_CONTENT.map((species) => ({ id: `species-${species.id}`, schema: 'species', tags: ['species', species.rarity, ...species.types], values: { ...species } })),
	pages: [
		{ key: 'play', name: 'Play', description: 'Keeper, zones, the battle.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'play', [boundBlock(ctx, refs, 'hud', 'hud', 'state'), boundBlock(ctx, refs, 'battle', 'battle', 'state'), boundBlock(ctx, refs, 'explore', 'explore', 'state')], { maxWidth: 860 }) },
		{ key: 'team', name: 'Team', description: 'Party and box.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'team', [boundBlock(ctx, refs, 'team', 'team', 'team')], { maxWidth: 960 }) },
		{ key: 'dex', name: 'Dex', description: 'All sixty, 30 per page.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'dex', [boundBlock(ctx, refs, 'dex', 'dex', 'dex', { page: '{query.page}' })], { maxWidth: 960 }) },
		{ key: 'species', name: 'Species', description: 'One species by ?id=.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'dex', [boundBlock(ctx, refs, 'species', 'species-card', 'species', { id: '{query.id}' })], { maxWidth: 860 }) },
		{ key: 'shop', name: 'Shop', description: 'Crystals and tonics for shards.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'shop', [boundBlock(ctx, refs, 'shop', 'shop', 'state')], { maxWidth: 860 }) },
		{ key: 'keeper', name: 'Keeper', description: 'Name, ledger, start over.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'keeper', [boundBlock(ctx, refs, 'keeper', 'keeper', 'state')], { maxWidth: 860 }) }
	]
};
