// POKEWORLD on Thingtime — the Game Boy style Pokémon world (pokeworld.center)
// rebuilt as an installable app suite. The original is a real-time canvas
// game over Google-Maps-derived terrain; on Thingtime it becomes a
// TURN-BASED grid explorer: every D-pad press is an action run (`move`) that
// resolves the step server-side through the pokeworld pack — collisions,
// ledges, surfing, field items, signs, and the 12% / 10% wild-encounter roll
// on long grass, water, and near caves — and the page refetches the viewport.
// Battles are the same turn machine as the original (Gen III damage, status,
// accuracy, crits, the 4-shake catch formula, run odds), one action per turn.
//
// The world is deterministic and procedural (no map API): blocks derive from
// their coordinates, and a trainer may still stand on the REAL map — "Set
// location" converts a latitude/longitude to the same Mercator block the
// original used, so legendary geofences (Groudon at Uluru, Mewtwo in Tokyo…)
// apply exactly as they did.
//
// State lives in the viewer's own data things: one `trainer` (position, bag,
// badges, pokédex), one `pokemon` per creature (party or box), one `battle`
// while a wild fight is on. The species catalogue is public system data.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites';
import { demoBlockKit, type DemoBlock, type DemoBlockCtx } from '../webpageDemos';

// ── palette (the original's Tailwind + game-ui.css) ─────────────────────────
const GRASS = '#70c0a0';
const GREEN = '#b2f594';
const SHELL = '#ebe6e2';
const SCREEN = '#181818';
const CREAM = '#f8f8f0';
const NAVY = '#385088';
const TEXT = '#303030';
const MUTED = '#707880';
const RED = '#c04040';
const TEAL = '#48a8a0';
const TEAL_DARK = '#2a7a74';
const PANEL = '#d8d8d0';
const HP_HIGH = '#58d080';
const HP_MID = '#f8d030';
const HP_LOW = '#e83838';
const HP_TRACK = '#283860';
const PIXEL = "'Pokemon Classic', 'Press Start 2P', ui-monospace, 'SFMono-Regular', Menlo, monospace";

const el = (tag: string, style: Record<string, unknown>, children: unknown[] = [], props: Record<string, unknown> = {}): Record<string, unknown> => ({
	tag,
	props: { ...props, style },
	children
});
const text = (content: string, style: Record<string, unknown> = {}): Record<string, unknown> => el('div', { fontFamily: PIXEL, color: TEXT, fontSize: '12px', lineHeight: 1.6, ...style }, [content]);
const label = (content: string): Record<string, unknown> => text(content, { fontSize: '10px', color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' });
const textbox = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('div', { background: CREAM, border: `3px solid ${NAVY}`, borderRadius: '8px', padding: '12px 14px', display: 'grid', gap: '8px', boxShadow: '0 2px 0 rgba(0,0,0,0.25)', ...style }, children);
const button = (content: string, action: string, inputs: Record<string, unknown> = {}, tone: 'teal' | 'cream' | 'red' | 'grey' = 'teal', style: Record<string, unknown> = {}): Record<string, unknown> => ({
	tag: 'button',
	props: {
		type: 'button',
		style: {
			fontFamily: PIXEL,
			fontSize: '11px',
			fontWeight: 700,
			padding: '9px 12px',
			borderRadius: '6px',
			cursor: 'pointer',
			border: `2px solid ${tone === 'red' ? RED : tone === 'grey' ? MUTED : NAVY}`,
			background: tone === 'teal' ? TEAL : tone === 'red' ? RED : tone === 'grey' ? PANEL : CREAM,
			color: tone === 'teal' || tone === 'red' ? CREAM : TEXT,
			whiteSpace: 'nowrap',
			...style
		}
	},
	ttAction: action,
	ttActionInputs: inputs,
	children: [content]
});
const linkButton = (content: string, href: string, active = false): Record<string, unknown> =>
	el('a', { fontFamily: PIXEL, fontSize: '11px', fontWeight: 700, padding: '8px 12px', borderRadius: '6px', border: `2px solid ${NAVY}`, background: active ? NAVY : CREAM, color: active ? CREAM : TEXT, textDecoration: 'none', whiteSpace: 'nowrap' }, [content], { href });
const row = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> => el('div', { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', ...style }, children);
const INPUT_STYLE = { fontFamily: PIXEL, fontSize: '12px', padding: '8px 10px', border: `2px solid ${NAVY}`, borderRadius: '6px', background: '#ffffff', color: TEXT, width: '100%', boxSizing: 'border-box' };
const input = (name: string, props: Record<string, unknown> = {}): Record<string, unknown> => ({ tag: 'input', props: { name, style: INPUT_STYLE, ...props } });
const field = (title: string, control: Record<string, unknown>): Record<string, unknown> => el('label', { display: 'grid', gap: '4px' }, [label(title), control]);
// a FORM GROUP: a control reads the named fields of its closest fieldset
const group = (children: unknown[], style: Record<string, unknown> = {}): Record<string, unknown> =>
	el('fieldset', { border: 'none', margin: 0, padding: 0, minWidth: 0, display: 'grid', gap: '8px', ...style }, children);
const whenState = (state: string, then: unknown, otherwise?: unknown): Record<string, unknown> => ({ ttIf: { arg: 'state', equals: state, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
const ifTruthy = (arg: string, then: unknown, otherwise?: unknown): Record<string, unknown> => ({ ttIf: { arg, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
const each = (arg: string, node: unknown, options: { max?: number; empty?: unknown } = {}): Record<string, unknown> => ({ ttEach: { arg, node, ...options } });
const hpTone = (arg: string): Record<string, unknown> => ({ ttIf: { arg, op: 'gt', value: 50, then: HP_HIGH, else: { ttIf: { arg, op: 'gt', value: 20, then: HP_MID, else: HP_LOW } } } });
const hpBar = (percentArg: string): Record<string, unknown> =>
	el('div', { background: HP_TRACK, borderRadius: '4px', height: '8px', overflow: 'hidden', border: `1px solid ${NAVY}` }, [el('div', { height: '100%', width: `{${percentArg}}%`, background: hpTone(percentArg) }, [])]);

const gates = (loadingLabel: string, ready: unknown): Record<string, unknown>[] => [
	whenState('signed-out', textbox([text('Welcome to the POKéMON WORLD!', { fontWeight: 700 }), text('Sign in with your Thingtime account to become a trainer. Your party, bag, and pokédex are your own data things — no one else can touch them.'), row([linkButton('Login with Thingtime', '/login', true), linkButton('Read about the game', 'https://www.pokeworld.center')])])),
	whenState('not-installed', textbox([text('Install POKéMON WORLD', { fontWeight: 700 }), text('Installing copies the game programs into your things. Every D-pad press and every battle turn then runs as you, on your own trainer.'), row([button('Install the game ▶', '$install')])])),
	whenState('loading', textbox([text(`▶ ${loadingLabel}`, { color: MUTED })])),
	whenState('error', textbox([text('MAP SIGNAL LOST', { color: RED, fontWeight: 700 }), text('{error}', { fontSize: '10px', color: MUTED }), row([button('RETRY', '$refresh', {}, 'cream')])])),
	whenState('ok', ready)
];

// ── components ──────────────────────────────────────────────────────────────

const navComponent: SuiteComponentDef = {
	key: 'nav',
	name: 'Pokeworld nav',
	description: 'The grass-green top bar of the original site.',
	args: [{ name: 'active', type: 'enum', label: 'Active', values: ['play', 'party', 'bag', 'pokedex', 'pc', 'settings'], default: 'play' }],
	render: () =>
		el('nav', { background: GRASS, color: '#ffffff', padding: '10px 14px', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }, [
			el('a', { fontFamily: PIXEL, fontSize: '13px', fontWeight: 700, color: '#ffffff', textDecoration: 'none', marginRight: 'auto' }, ['◓ Pokémon World'], { href: '/p/pokeworld' }),
			...[
				['play', 'GAME', '/p/pokeworld'],
				['party', 'POKéMON', '/p/pokeworld-party'],
				['bag', 'BAG', '/p/pokeworld-bag'],
				['pokedex', 'POKéDEX', '/p/pokeworld-pokedex'],
				['pc', 'PC', '/p/pokeworld-pc'],
				['settings', 'OPTION', '/p/pokeworld-settings']
			].map(([key, title, href]) => ({
				ttIf: {
					arg: 'active',
					equals: key,
					then: el('a', { fontFamily: PIXEL, fontSize: '10px', fontWeight: 700, color: GRASS, background: '#ffffff', padding: '5px 9px', borderRadius: '6px', textDecoration: 'none' }, [title], { href }),
					else: el('a', { fontFamily: PIXEL, fontSize: '10px', fontWeight: 700, color: '#ffffff', padding: '5px 9px', borderRadius: '6px', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.5)' }, [title], { href })
				}
			}))
		])
};

const hudComponent: SuiteComponentDef = {
	key: 'hud',
	name: 'Trainer HUD',
	description: 'Trainer card — or the new-trainer form when the journey has not started.',
	args: [],
	render: (refs) =>
		el('div', {}, [
			...gates(
				'Loading..',
				ifTruthy(
					'result.hasTrainer',
					textbox([
						row([text('{result.trainer.name}', { fontWeight: 700, fontSize: '14px' }), text('{result.trainer.gender}', { color: MUTED }), text('·'), text('{result.partyCount}/6 in party', { color: MUTED }), text('·'), text('{result.badgeCount}/8 badges', { color: MUTED }), text('·'), text('{result.trainer.steps} steps', { color: MUTED })]),
						row([text('Block {result.trainer.blockX},{result.trainer.blockY} · tile {result.trainer.x},{result.trainer.y} · {result.view.biome}', { fontSize: '10px', color: MUTED })])
					]),
					textbox([
						text('Hello there! Welcome to the world of POKéMON!', { fontWeight: 700 }),
						text('Your very own POKéMON legend is about to unfold. First, tell me a little about yourself.'),
						group([
							row([field('Your name (max 7)', input('name', { type: 'text', maxLength: 7, placeholder: 'LOPU' })), field('Are you a boy or a girl?', { tag: 'select', props: { name: 'gender', style: INPUT_STYLE }, children: [{ tag: 'option', props: { value: 'boy' }, children: ['BOY'] }, { tag: 'option', props: { value: 'girl' }, children: ['GIRL'] }] })]),
							row([button('Begin the journey ▶', refs.actionKey('start'))])
						]),
						text('You start with TREECKO, RALTS and ZIGZAGOON, three more in the PC, a few POTIONs and six POKé BALLs.', { fontSize: '10px', color: MUTED })
					])
				)
			)
		])
};

// The screen: an 11×9 viewport of 32px tiles (the pack's view), the player
// sprite over the centre tile, and the D-pad. Every button is one `move` run.
const mapComponent: SuiteComponentDef = {
	key: 'map',
	name: 'Game screen',
	description: 'The tile viewport around the trainer plus the D-pad — each press is one step.',
	args: [],
	render: (refs) =>
		el('div', { background: SHELL, borderRadius: '18px', padding: '14px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', display: 'grid', gap: '12px' }, [
			// the screen keeps its own signed-out / not-installed idle frames — the
			// HUD above already carries the sign-in and install cards
			whenState('signed-out', el('div', { background: SCREEN, borderRadius: '10px', padding: '40px 16px', border: `4px solid ${TEXT}`, textAlign: 'center' }, [text('PRESS START', { color: GREEN, fontWeight: 700, fontSize: '14px' }), text('Sign in to explore the world.', { color: '#9aa', fontSize: '10px' })])),
			whenState('not-installed', el('div', { background: SCREEN, borderRadius: '10px', padding: '40px 16px', border: `4px solid ${TEXT}`, textAlign: 'center' }, [text('PRESS START', { color: GREEN, fontWeight: 700, fontSize: '14px' }), text('Install the game to begin.', { color: '#9aa', fontSize: '10px' })])),
			whenState('loading', el('div', { background: SCREEN, borderRadius: '10px', padding: '40px 16px', border: `4px solid ${TEXT}`, textAlign: 'center' }, [text('MAPPING NEARBY ROUTES…', { color: GREEN, fontSize: '11px' })])),
			whenState('error', textbox([text('MAP SIGNAL LOST', { color: RED, fontWeight: 700 }), text('{error}', { fontSize: '10px', color: MUTED }), row([button('RETRY', '$refresh', {}, 'cream')])])),
			whenState(
				'ok',
				ifTruthy(
					'result.hasTrainer',
					el('div', { display: 'grid', gap: '12px' }, [
						ifTruthy(
							'result.inBattle',
							textbox([text('A wild {result.battle.wild.species} blocks the way!', { fontWeight: 700 }), text('Finish the battle below before moving on.', { color: MUTED, fontSize: '10px' })]),
							el('div', { background: SCREEN, borderRadius: '10px', padding: '6px', border: `4px solid ${TEXT}` }, [
								el('div', { display: 'grid', gridTemplateColumns: 'repeat({result.view.width}, 1fr)', gap: 0, imageRendering: 'pixelated', lineHeight: 0 }, [
									each(
										'result.view.rows',
										each(
											'item',
											el('div', { position: 'relative', aspectRatio: '1 / 1', width: '100%' }, [
												{ tag: 'img', props: { src: '{item.url}', alt: '', width: '100%', style: { width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' } } },
												ifTruthy('item.overlayUrl', { tag: 'img', props: { src: '{item.overlayUrl}', alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' } } }),
												ifTruthy('item.isPlayer', { tag: 'img', props: { src: '{item.playerUrl}', alt: 'You', style: { position: 'absolute', left: 0, bottom: 0, width: '100%', height: '200%', imageRendering: 'pixelated', transform: { ttIf: { arg: 'item.flip', then: 'scaleX(-1)', else: 'none' } } } } })
											]),
											{ max: 17 }
										),
										{ max: 13 }
									)
								])
							])
						),
						row(
							[
								el('div', { display: 'grid', gridTemplateColumns: '48px 48px 48px', gridTemplateRows: '48px 48px 48px', gap: '2px' }, [
									el('span', {}, []),
									button('▲', refs.actionKey('move'), { direction: 'up' }, 'grey', { padding: 0, fontSize: '16px', background: '#565e6a', color: CREAM, border: `2px solid ${SCREEN}` }),
									el('span', {}, []),
									button('◀', refs.actionKey('move'), { direction: 'left' }, 'grey', { padding: 0, fontSize: '16px', background: '#565e6a', color: CREAM, border: `2px solid ${SCREEN}` }),
									el('span', { background: '#565e6a', borderRadius: '4px' }, []),
									button('▶', refs.actionKey('move'), { direction: 'right' }, 'grey', { padding: 0, fontSize: '16px', background: '#565e6a', color: CREAM, border: `2px solid ${SCREEN}` }),
									el('span', {}, []),
									button('▼', refs.actionKey('move'), { direction: 'down' }, 'grey', { padding: 0, fontSize: '16px', background: '#565e6a', color: CREAM, border: `2px solid ${SCREEN}` }),
									el('span', {}, [])
								]),
								el('div', { display: 'grid', gap: '8px', marginLeft: 'auto' }, [
									button('A · Surf / interact', refs.actionKey('interact'), {}, 'cream', { borderRadius: '999px', background: '#2c313e', color: CREAM, border: `2px solid ${SCREEN}` }),
									button('↻ Refresh', '$refresh', {}, 'grey'),
									text('{result.lastMessage}', { fontSize: '10px', color: MUTED, maxWidth: '220px' })
								])
							],
							{ alignItems: 'flex-start' }
						),
						{ ttIf: { arg: 'last.result.message', then: textbox([text('{last.result.message}')]) } }
					]),
					el('div', { background: SCREEN, borderRadius: '10px', padding: '40px 16px', border: `4px solid ${TEXT}`, textAlign: 'center' }, [text('PRESS START', { color: GREEN, fontWeight: 700, fontSize: '14px' }), text('Begin your journey above.', { color: '#9aa', fontSize: '10px' })])
				)
			)
		])
};

const moveButton = (refs: SuiteRefs): Record<string, unknown> =>
	button('{item.name} · {item.type} · {item.pp}/{item.maxPp}', refs.actionKey('battle-move'), { moveIndex: '{index}' }, 'cream', { textAlign: 'left' });

const battleComponent: SuiteComponentDef = {
	key: 'battle',
	name: 'Battle screen',
	description: 'The wild encounter: sprites, HP bars, four moves, balls, items, run.',
	args: [],
	render: (refs) =>
		el('div', {}, [
			whenState(
				'ok',
				ifTruthy(
					'result.inBattle',
					el('div', { background: 'linear-gradient(180deg, #d0f0d8, #b4e4a4 36%, #90cc78 68%, #74b85c)', borderRadius: '14px', padding: '14px', display: 'grid', gap: '12px', border: `4px solid ${TEXT}` }, [
						el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }, [
							el('div', { display: 'grid', gap: '6px' }, [
								textbox([text('{result.battle.wild.species} Lv{result.battle.wild.level}', { fontWeight: 700 }), hpBar('result.battle.wildHpPercent'), text('{result.battle.wild.status}', { fontSize: '10px', color: MUTED })], { padding: '8px 10px' }),
								{ tag: 'img', props: { src: '{result.battle.wild.sprite}', alt: '{result.battle.wild.species}', style: { width: '128px', imageRendering: 'pixelated', justifySelf: 'end' } } }
							]),
							el('div', { display: 'grid', gap: '6px' }, [
								{ tag: 'img', props: { src: '{result.battle.player.spriteBack}', alt: '{result.battle.player.species}', style: { width: '128px', imageRendering: 'pixelated' } } },
								textbox([text('{result.battle.player.species} Lv{result.battle.player.level}', { fontWeight: 700 }), hpBar('result.battle.playerHpPercent'), text('{result.battle.player.hp}/{result.battle.player.maxHp} · {result.battle.player.status}', { fontSize: '10px', color: MUTED })], { padding: '8px 10px' })
							])
						]),
						textbox([each('result.battle.log', text('{item}'), { max: 12, empty: text('…') })], { minHeight: '60px' }),
						el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }, [each('result.battle.player.moves', moveButton(refs), { max: 4 })]),
						row([
							...['poke-ball', 'great-ball', 'ultra-ball'].map((ball) => ({
								ttIf: { arg: `result.bag.${ball.replace('-', '_')}`, op: 'gt', value: 0, then: button(`${ball.toUpperCase().replace('-', ' ')} ×{result.bag.${ball.replace('-', '_')}}`, refs.actionKey('battle-ball'), { ball }, 'cream') }
							})),
							...['potion', 'super-potion', 'antidote', 'full-heal', 'revive', 'max-revive'].map((item) => ({
								ttIf: { arg: `result.bag.${item.replace('-', '_')}`, op: 'gt', value: 0, then: button(`${item.toUpperCase().replace('-', ' ')} ×{result.bag.${item.replace('-', '_')}}`, refs.actionKey('battle-item'), { itemId: item }, 'grey') }
							})),
							button('RUN', refs.actionKey('battle-run'), {}, 'red')
						])
					])
				)
			)
		])
};

const memberRow = (refs: SuiteRefs, actions: unknown[]): Record<string, unknown> =>
	el('div', { display: 'grid', gridTemplateColumns: '64px 1fr', gap: '10px', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${PANEL}` }, [
		{ tag: 'img', props: { src: '{item.sprite}', alt: '{item.species}', style: { width: '64px', imageRendering: 'pixelated' } } },
		el('div', { display: 'grid', gap: '4px' }, [
			row([text('{item.species}', { fontWeight: 700 }), text('Lv{item.level}', { color: MUTED }), text('{item.typesLine}', { fontSize: '10px', color: MUTED }), text('{item.status}', { fontSize: '10px', color: MUTED })]),
			hpBar('item.hpPercent'),
			text('{item.hp}/{item.maxHp} HP · {item.movesLine}', { fontSize: '10px', color: MUTED }),
			row(actions)
		])
	]);

const partyComponent: SuiteComponentDef = {
	key: 'party',
	name: 'Party panel',
	description: 'Up to six party members with HP bars; make a lead, deposit to the PC, heal.',
	args: [],
	render: (refs) =>
		el('div', {}, [
			...gates(
				'Loading party..',
				textbox([
					row([text('POKéMON', { fontWeight: 700 }), text('{result.partyCount}/6', { color: MUTED }), button('Heal the party', refs.actionKey('heal'), {}, 'cream', { marginLeft: 'auto' })]),
					each('result.party', memberRow(refs, [button('MAKE LEAD', refs.actionKey('set-lead'), { pokemonId: '{item.thingId}' }, 'cream'), button('DEPOSIT', refs.actionKey('deposit'), { pokemonId: '{item.thingId}' }, 'grey')]), { max: 6, empty: text('No POKéMON yet — start your journey on the GAME page.', { color: MUTED }) })
				])
			)
		])
};

const bagComponent: SuiteComponentDef = {
	key: 'bag',
	name: 'Bag panel',
	description: 'Every item you carry; use one on a party member.',
	args: [],
	render: (refs) =>
		el('div', {}, [
			...gates(
				'Loading bag..',
				textbox([
					text('BAG', { fontWeight: 700 }),
					field('USE ON', { tag: 'select', props: { name: 'pokemonId', style: INPUT_STYLE }, children: [each('result.party', { tag: 'option', props: { value: '{item.thingId}' }, children: ['{item.species} Lv{item.level} ({item.hp}/{item.maxHp})'] }, { max: 6 })] }),
					each('result.bagList', el('div', { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '10px', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${PANEL}` }, [el('div', {}, [text('{item.name}', { fontWeight: 700 }), text('{item.description}', { fontSize: '10px', color: MUTED })]), text('×{item.qty}'), button('USE', refs.actionKey('use-item'), { itemId: '{item.id}' }, 'cream')]), { max: 24, empty: text('Your bag is empty.', { color: MUTED }) })
				])
			)
		])
};

const pokedexComponent: SuiteComponentDef = {
	key: 'pokedex',
	name: 'Pokédex',
	description: 'All 386 species, 100 per page; silhouettes until seen, names until caught.',
	args: [],
	render: () =>
		el('div', {}, [
			...gates(
				'Loading POKéDEX..',
				textbox([
					row([text('POKéDEX', { fontWeight: 700 }), text('SEEN {result.seenCount} · CAUGHT {result.caughtCount}', { color: MUTED }), text('page {result.page}/{result.pages}', { color: MUTED, marginLeft: 'auto' })]),
					el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '6px' }, [
						each(
							'result.entries',
							el('div', { display: 'grid', justifyItems: 'center', gap: '2px', padding: '6px', border: `1px solid ${PANEL}`, borderRadius: '6px', background: { ttIf: { arg: 'item.caught', then: '#eef8ee', else: CREAM } } }, [
								{ tag: 'img', props: { src: '{item.sprite}', alt: '', style: { width: '56px', imageRendering: 'pixelated', filter: { ttIf: { arg: 'item.seen', then: 'none', else: 'brightness(0) opacity(0.35)' } } } } },
								text('No. {item.no}', { fontSize: '9px', color: MUTED }),
								ifTruthy('item.seen', text('{item.displayName}', { fontSize: '10px', fontWeight: 700 }), text('?????', { fontSize: '10px', color: MUTED })),
								ifTruthy('item.caught', text('◓ caught', { fontSize: '9px', color: TEAL_DARK }))
							]),
							{ max: 100 }
						)
					]),
					row([
						{ ttIf: { arg: 'result.page', op: 'gt', value: 1, then: linkButton('◀ PREV', '/p/pokeworld-pokedex?page={result.prevPage}') } },
						{ ttIf: { arg: 'result.hasMore', then: linkButton('NEXT ▶', '/p/pokeworld-pokedex?page={result.nextPage}') } }
					])
				])
			)
		])
};

const pcComponent: SuiteComponentDef = {
	key: 'pc',
	name: 'PC box',
	description: 'BOX 1 — withdraw into the party.',
	args: [],
	render: (refs) =>
		el('div', {}, [
			...gates(
				'Booting the PC..',
				textbox([
					row([text('BOX 1', { fontWeight: 700 }), text('{result.boxCount} stored · party {result.partyCount}/6', { color: MUTED })]),
					each('result.box', memberRow(refs, [button('WITHDRAW', refs.actionKey('withdraw'), { pokemonId: '{item.thingId}' }, 'cream')]), { max: 40, empty: text('The box is empty.', { color: MUTED }) })
				])
			)
		])
};

const settingsComponent: SuiteComponentDef = {
	key: 'settings',
	name: 'Options',
	description: 'Player name and sprite, real-world location, badges.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '12px' }, [
			...gates(
				'Loading options..',
				ifTruthy(
					'result.hasTrainer',
					el('div', { display: 'grid', gap: '12px' }, [
						textbox([
							text('OPTION', { fontWeight: 700 }),
							group([
								row([field('PLAYER NAME', input('name', { type: 'text', maxLength: 7, value: '{result.trainer.name}' })), field('SPRITE', { tag: 'select', props: { name: 'gender', style: INPUT_STYLE }, children: [{ tag: 'option', props: { value: 'boy', selected: { ttIf: { arg: 'result.trainer.gender', equals: 'boy', then: true, else: false } } }, children: ['BOY'] }, { tag: 'option', props: { value: 'girl', selected: { ttIf: { arg: 'result.trainer.gender', equals: 'girl', then: true, else: false } } }, children: ['GIRL'] }] })]),
								row([button('SAVE', refs.actionKey('settings'))])
							])
						]),
						textbox([
							text('LOCATION', { fontWeight: 700 }),
							text('Stand on the real map: your latitude / longitude picks the same Mercator block the original game used, so legendary POKéMON roam where they should (Uluru, Tokyo, the Great Barrier Reef…).', { fontSize: '10px', color: MUTED }),
							group([
								row([field('LATITUDE', input('lat', { type: 'number', step: 'any', min: -87, max: 87, value: '{result.trainer.lat}' })), field('LONGITUDE', input('lng', { type: 'number', step: 'any', min: -180, max: 180, value: '{result.trainer.lng}' }))]),
								row([button('TELEPORT', refs.actionKey('set-location'), {}, 'cream')])
							]),
							// presets carry their own coordinates — their own group so the
							// typed fields above never override them
							group([row([button('MELBOURNE', refs.actionKey('set-location'), { lat: -37.8757, lng: 145.0057 }, 'grey'), button('ULURU', refs.actionKey('set-location'), { lat: -25.3444, lng: 131.0369 }, 'grey'), button('TOKYO', refs.actionKey('set-location'), { lat: 35.6762, lng: 139.6503 }, 'grey')])])
						]),
						textbox([
							text('BADGES', { fontWeight: 700 }),
							el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '6px' }, [
								each('result.badges', button('{item.name}', refs.actionKey('toggle-badge'), { badgeId: '{item.id}' }, 'cream', { background: { ttIf: { arg: 'item.earned', then: '{item.color}', else: PANEL } }, color: TEXT, fontSize: '9px' }), { max: 8 })
							])
						])
					]),
					textbox([text('Start your journey on the GAME page first.', { color: MUTED })])
				)
			)
		])
};

// ── actions ─────────────────────────────────────────────────────────────────

const trainerSearch = (refs: SuiteRefs) => ({ op: 'things.search', schema: refs.schema('trainer'), limit: 1, sort: { field: 'updatedAt', dir: 'desc' } });
const partySearch = (refs: SuiteRefs) => ({ op: 'things.search', schema: refs.schema('pokemon'), where: { slot: 'party' }, limit: 6, sort: { field: 'order', dir: 'asc' } });
const activeBattleSearch = (refs: SuiteRefs) => ({ op: 'things.search', schema: refs.schema('battle'), where: { state: 'active' }, limit: 1, sort: { field: 'createdAt', dir: 'desc' } });
const first = (step: string) => ({ ttExpr: ['first', step] });
const firstCrystal = (step: string) => ({ ttExpr: ['get', { ttExpr: ['first', step] }, 'crystal', null] });
const firstId = (step: string) => ({ ttExpr: ['get', { ttExpr: ['first', step] }, 'id', null] });
const percent = (hp: unknown, maxHp: unknown) => ({ ttExpr: ['round', { ttExpr: ['mul', 100, { ttExpr: ['div', hp, { ttExpr: ['max', 1, maxHp] }] }] }] });
// a pokemon search row → the member record + its thing id + display extras
const memberView = (listStep: string) => ({
	ttExpr: [
		'map',
		listStep,
		{
			ttExpr: [
				'merge',
				'$item.crystal',
				{
					thingId: '$item.id',
					hpPercent: percent('$item.crystal.hp', '$item.crystal.maxHp'),
					typesLine: { ttExpr: ['join', '$item.crystal.types', ' / '] },
					movesLine: { ttExpr: ['join', { ttExpr: ['map', '$item.crystal.moves', '$item.name'] }, ', '] }
				}
			]
		}
	]
});
const positionOf = (trainer: string) => ({
	blockX: `${trainer}.blockX`,
	blockY: `${trainer}.blockY`,
	x: `${trainer}.x`,
	y: `${trainer}.y`,
	facing: `${trainer}.facing`,
	surfing: `${trainer}.surfing`,
	gender: `${trainer}.gender`,
	name: `${trainer}.name`
});
const bagKey = (id: unknown) => ({ ttExpr: ['replace', id, '-', '_'] });
const bagCount = (bag: string, id: unknown) => ({ ttExpr: ['get', bag, id, 0] });
const bagAdjust = (bag: string, id: unknown, delta: number) => ({ ttExpr: ['set', bag, id, { ttExpr: ['max', 0, { ttExpr: ['add', bagCount(bag, id), delta] }] }] });
const bagView = (bag: string) => ({
	ttExpr: ['merge', {}, { ttExpr: ['merge', ...['poke-ball', 'great-ball', 'ultra-ball', 'potion', 'super-potion', 'antidote', 'full-heal', 'revive', 'max-revive'].map((id) => ({ [id.replace('-', '_')]: bagCount(bag, id) }))] }]
});
const STARTER_BAG = { potion: 3, antidote: 2, 'escape-rope': 1, 'poke-ball': 6 };

const stateAction: SuiteActionDef = {
	key: 'state',
	name: 'Game state',
	description: 'Everything the screen needs: trainer, party, the viewport around you, the active battle, your bag.',
	category: 'pokeworld',
	inputs: [],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'compute', value: firstCrystal('$step.1') },
		partySearch(refs),
		activeBattleSearch(refs),
		{ op: 'compute', when: '$step.2', value: { ttExpr: ['pokeworld.view', positionOf('$step.2'), 5, 4] } },
		{ op: 'compute', value: { ttExpr: ['pokeworld.items'] } },
		{ op: 'compute', value: { ttExpr: ['coalesce', { ttExpr: ['get', '$step.2', 'bag', null] }, {}] } },
		{ op: 'compute', when: { ttExpr: ['not', { ttExpr: ['isEmpty', '$step.4'] }] }, value: { ttExpr: ['get', firstCrystal('$step.4'), 'playerId', null] } },
		{ op: 'things.get', when: '$step.8', id: '$step.8' },
		{ op: 'compute', value: { ttExpr: ['pokeworld.badges'] } },
		{
			op: 'return',
			value: {
				hasTrainer: { ttExpr: ['not', { ttExpr: ['isEmpty', '$step.2'] }] },
				trainer: '$step.2',
				trainerId: firstId('$step.1'),
				party: memberView('$step.3'),
				partyCount: { ttExpr: ['len', '$step.3'] },
				badgeCount: { ttExpr: ['len', { ttExpr: ['coalesce', { ttExpr: ['get', '$step.2', 'badges', null] }, []] }] },
				badges: { ttExpr: ['map', '$step.10', { ttExpr: ['merge', '$item', { earned: { ttExpr: ['includes', { ttExpr: ['coalesce', { ttExpr: ['get', '$step.2', 'badges', null] }, []] }, '$item.id'] } }] }] },
				view: '$step.5',
				inBattle: { ttExpr: ['not', { ttExpr: ['isEmpty', '$step.4'] }] },
				battle: {
					ttExpr: [
						'if',
						{ ttExpr: ['isEmpty', '$step.4'] },
						null,
						{
							ttExpr: [
								'merge',
								firstCrystal('$step.4'),
								{
									id: firstId('$step.4'),
									player: { ttExpr: ['get', '$step.9', 'crystal', null] },
									wildHpPercent: percent({ ttExpr: ['get', firstCrystal('$step.4'), 'wild.hp', 0] }, { ttExpr: ['get', { ttExpr: ['get', firstCrystal('$step.4'), 'wild', {}] }, 'maxHp', 1] }),
									playerHpPercent: percent({ ttExpr: ['get', { ttExpr: ['get', '$step.9', 'crystal', {}] }, 'hp', 0] }, { ttExpr: ['get', { ttExpr: ['get', '$step.9', 'crystal', {}] }, 'maxHp', 1] })
								}
							]
						}
					]
				},
				bag: bagView('$step.7'),
				bagList: { ttExpr: ['filter', { ttExpr: ['map', '$step.6', { ttExpr: ['merge', '$item', { qty: bagCount('$step.7', '$item.id') }] }] }, { ttExpr: ['gt', '$item.qty', 0] }] },
				lastMessage: { ttExpr: ['coalesce', { ttExpr: ['get', '$step.2', 'lastMessage', null] }, ''] },
				silent: true
			}
		}
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('trainer'), refs.schema('pokemon'), refs.schema('battle')] }],
	limits: { timeoutMs: 8000, maxOperations: 20, maxResultBytes: 192 * 1024 }
};

const addPokemonAction: SuiteActionDef = {
	key: 'add-pokemon',
	name: 'Add a Pokémon',
	description: 'Mints one Pokémon data thing (stats, moves, sprite) into the party or the PC box.',
	category: 'pokeworld',
	inputs: [
		{ name: 'speciesId', type: 'number', label: 'Species #', required: true, min: 1, max: 386 },
		{ name: 'level', type: 'number', label: 'Level', required: true, min: 1, max: 100 },
		{ name: 'slot', type: 'enum', label: 'Slot', values: ['party', 'box'], default: 'party' },
		{ name: 'order', type: 'number', label: 'Order', min: 0, max: 999, default: 0 },
		{ name: 'nickname', type: 'string', label: 'Nickname', required: false, maxLength: 12 }
	],
	steps: (refs) => [
		{ op: 'compute', value: { ttExpr: ['pokeworld.newPokemon', { speciesId: '$input.speciesId', level: '$input.level', nickname: '$input.nickname' }] } },
		{ op: 'things.create', schema: refs.schema('pokemon'), values: { ttExpr: ['merge', '$step.1', { slot: '$input.slot', order: '$input.order', caughtAt: '$now' }] } },
		{ op: 'return', value: '$step.2' }
	],
	capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('pokemon')] }],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const startAction: SuiteActionDef = {
	key: 'start',
	name: 'Begin the journey',
	description: 'Creates your trainer with the starter party, the PC box, and the starting bag.',
	category: 'pokeworld',
	inputs: [
		{ name: 'name', type: 'string', label: 'Trainer name', required: false, maxLength: 7 },
		{ name: 'gender', type: 'enum', label: 'Sprite', values: ['boy', 'girl'], default: 'boy' }
	],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'return', when: { ttExpr: ['not', { ttExpr: ['isEmpty', '$step.1'] }] }, value: { title: 'Welcome back!', message: 'Your journey is already underway.' } },
		{ op: 'compute', value: { ttExpr: ['pokeworld.defaultTrainer'] } },
		{
			op: 'things.create',
			schema: refs.schema('trainer'),
			values: {
				name: { ttExpr: ['upper', { ttExpr: ['slice', { ttExpr: ['coalesce', { ttExpr: ['trim', { ttExpr: ['coalesce', '$input.name', ''] }] }, 'LOPU'] }, 0, 7] }] },
				gender: '$input.gender',
				blockX: 0,
				blockY: 0,
				x: 8,
				y: 8,
				facing: 'down',
				surfing: false,
				lat: 0,
				lng: 0,
				badges: [],
				bag: STARTER_BAG,
				seen: '$step.3.pokedex.seen',
				caught: '$step.3.pokedex.caught',
				collected: [],
				steps: 0,
				lastMessage: 'Your adventure begins. Walk into the tall grass!',
				updatedAt: '$now'
			}
		},
		{ op: 'each', list: '$step.3.party', action: refs.action('add-pokemon'), max: 6, inputs: { speciesId: '$item.speciesId', level: '$item.level', slot: 'party', order: '$index' } },
		{ op: 'each', list: '$step.3.box', action: refs.action('add-pokemon'), max: 6, inputs: { speciesId: '$item.speciesId', level: '$item.level', slot: 'box', order: '$index' } },
		{ op: 'return', value: { title: 'Your journey begins ◓', message: { ttExpr: ['concat', 'Welcome, ', '$step.4.crystal.name', '! TREECKO, RALTS and ZIGZAGOON are in your party. Walk into the tall grass.'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer')] },
		{ capability: 'things.create', schemas: [refs.schema('trainer')] },
		{ capability: 'actions.invoke', actions: [refs.action('add-pokemon')] }
	],
	limits: { timeoutMs: 10000, maxOperations: 30, maxChildActions: 12 }
};

const moveAction: SuiteActionDef = {
	key: 'move',
	name: 'Take a step',
	description: 'Resolves one D-pad press: collision, ledges, surfing, field items, signs, and the wild-encounter roll.',
	category: 'pokeworld',
	inputs: [{ name: 'direction', type: 'enum', label: 'Direction', values: ['up', 'down', 'left', 'right'], required: true }],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'fail', when: { ttExpr: ['isEmpty', '$step.1'] }, message: 'Begin your journey first — tell me your name on the GAME page.' },
		{ op: 'compute', value: firstCrystal('$step.1') },
		activeBattleSearch(refs),
		{ op: 'fail', when: { ttExpr: ['not', { ttExpr: ['isEmpty', '$step.4'] }] }, message: 'A wild POKéMON blocks the way — finish the battle first!' },
		{ op: 'compute', value: { ttExpr: ['pokeworld.step', positionOf('$step.3'), '$input.direction', { ttExpr: ['coalesce', '$step.3.collected', []] }] } },
		{ op: 'compute', when: '$step.6.encounterTriggered', value: { ttExpr: ['pokeworld.encounter', { biome: '$step.6.biome', lat: { ttExpr: ['if', { ttExpr: ['eq', '$step.3.lat', 0] }, null, '$step.3.lat'] }, lng: { ttExpr: ['if', { ttExpr: ['eq', '$step.3.lng', 0] }, null, '$step.3.lng'] } }] } },
		{ op: 'compute', when: '$step.7', value: { ttExpr: ['pokeworld.newPokemon', { speciesId: '$step.7.speciesId', level: '$step.7.level', gender: '$step.7.gender', shiny: '$step.7.shiny' }] } },
		partySearch(refs),
		{ op: 'compute', value: { ttExpr: ['find', '$step.9', { ttExpr: ['gt', '$item.crystal.hp', 0] }] } },
		{
			op: 'compute',
			value: {
				ttExpr: [
					'coalesce',
					'$step.6.sign',
					'$step.6.house',
					'$step.6.cave',
					{ ttExpr: ['if', '$step.6.item', { ttExpr: ['concat', 'You found a ', { ttExpr: ['get', { ttExpr: ['coalesce', '$step.6.item', {}] }, 'name', ''] }, '!'] }, null] },
					{ ttExpr: ['if', '$step.8', { ttExpr: ['concat', 'A wild ', { ttExpr: ['get', { ttExpr: ['coalesce', '$step.8', {}] }, 'species', ''] }, ' appeared!'] }, null] },
					{ ttExpr: ['if', { ttExpr: ['eq', '$step.6.outcome', 'dismount'] }, 'You hopped back onto land.', null] },
					{ ttExpr: ['if', { ttExpr: ['eq', '$step.6.outcome', 'jump'] }, 'You hopped down the ledge.', null] },
					''
				]
			}
		},
		{
			op: 'things.update',
			id: firstId('$step.1'),
			values: {
				blockX: '$step.6.position.blockX',
				blockY: '$step.6.position.blockY',
				x: '$step.6.position.x',
				y: '$step.6.position.y',
				facing: '$step.6.position.facing',
				surfing: '$step.6.position.surfing',
				bag: { ttExpr: ['if', '$step.6.item', bagAdjust({ ttExpr: ['coalesce', '$step.3.bag', {}] } as unknown as string, { ttExpr: ['get', { ttExpr: ['coalesce', '$step.6.item', {}] }, 'id', ''] }, 1), { ttExpr: ['coalesce', '$step.3.bag', {}] }] },
				collected: { ttExpr: ['if', '$step.6.itemKey', { ttExpr: ['slice', { ttExpr: ['append', { ttExpr: ['coalesce', '$step.3.collected', []] }, '$step.6.itemKey'] }, -400] }, { ttExpr: ['coalesce', '$step.3.collected', []] }] },
				seen: { ttExpr: ['if', '$step.8', { ttExpr: ['uniq', { ttExpr: ['append', { ttExpr: ['coalesce', '$step.3.seen', []] }, { ttExpr: ['get', { ttExpr: ['coalesce', '$step.8', {}] }, 'speciesId', 0] }] }] }, { ttExpr: ['coalesce', '$step.3.seen', []] }] },
				steps: { ttExpr: ['add', { ttExpr: ['coalesce', '$step.3.steps', 0] }, 1] },
				lastMessage: '$step.11',
				updatedAt: '$now'
			}
		},
		{
			op: 'things.create',
			when: { ttExpr: ['and', '$step.8', '$step.10'] },
			schema: refs.schema('battle'),
			values: { state: 'active', wild: '$step.8', playerId: { ttExpr: ['get', { ttExpr: ['coalesce', '$step.10', {}] }, 'id', ''] }, turn: 0, attempts: 0, log: [{ ttExpr: ['concat', 'A wild ', { ttExpr: ['get', { ttExpr: ['coalesce', '$step.8', {}] }, 'species', ''] }, ' appeared!'] }], biome: '$step.6.biome', startedAt: '$now' }
		},
		{ op: 'return', value: { silent: true, outcome: '$step.6.outcome', message: '$step.11', encounter: '$step.8', position: '$step.6.position' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer'), refs.schema('pokemon'), refs.schema('battle')] },
		{ capability: 'things.update', schemas: [refs.schema('trainer')] },
		{ capability: 'things.create', schemas: [refs.schema('battle')] }
	],
	limits: { timeoutMs: 8000, maxOperations: 24 }
};

const interactAction: SuiteActionDef = {
	key: 'interact',
	name: 'Press A',
	description: 'Facing water with a WATER-type in the party: start surfing. Otherwise: look around.',
	category: 'pokeworld',
	inputs: [],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'fail', when: { ttExpr: ['isEmpty', '$step.1'] }, message: 'Begin your journey first.' },
		{ op: 'compute', value: firstCrystal('$step.1') },
		partySearch(refs),
		{ op: 'compute', value: { ttExpr: ['some', '$step.4', { ttExpr: ['and', { ttExpr: ['gt', '$item.crystal.hp', 0] }, { ttExpr: ['includes', '$item.crystal.types', 'WATER'] }] }] } },
		// a step in the facing direction while "surfing" is what lets the pack
		// accept water; without a surfer it stays a normal (blocked) step
		{ op: 'compute', value: { ttExpr: ['pokeworld.step', { ttExpr: ['merge', positionOf('$step.3'), { surfing: '$step.5' }] }, '$step.3.facing', { ttExpr: ['coalesce', '$step.3.collected', []] }] } },
		{ op: 'compute', value: { ttExpr: ['and', '$step.5', { ttExpr: ['eq', '$step.6.tile.terrain', 'water'] }, { ttExpr: ['ne', '$step.6.outcome', 'blocked'] }] } },
		{ op: 'things.update', when: '$step.7', id: firstId('$step.1'), values: { blockX: '$step.6.position.blockX', blockY: '$step.6.position.blockY', x: '$step.6.position.x', y: '$step.6.position.y', surfing: true, lastMessage: 'You hopped onto your POKéMON and started surfing!', updatedAt: '$now' } },
		{ op: 'return', value: { silent: true, message: { ttExpr: ['if', '$step.7', 'You started surfing!', { ttExpr: ['coalesce', '$step.6.sign', '$step.6.house', { ttExpr: ['if', { ttExpr: ['eq', '$step.6.tile.terrain', 'water'] }, 'The water is dyed a deep blue… you need a WATER-type POKéMON to surf.', 'Nothing here.'] }] }] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer'), refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('trainer')] }
	],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};

// battle prelude: steps 1–4 fetch the active battle and the player's Pokémon
const battlePrelude = (refs: SuiteRefs) => [
	activeBattleSearch(refs),
	{ op: 'fail', when: { ttExpr: ['isEmpty', '$step.1'] }, message: 'There is no battle right now.' },
	{ op: 'compute', value: firstCrystal('$step.1') },
	{ op: 'things.get', id: '$step.3.playerId' }
];
const battleLogAppend = (log: string, more: string) => ({ ttExpr: ['slice', { ttExpr: ['flatten', [{ ttExpr: ['coalesce', log, []] }, { ttExpr: ['coalesce', more, []] }]] }, -12] });

const battleMoveAction: SuiteActionDef = {
	key: 'battle-move',
	name: 'Use a move',
	description: 'One battle turn: both sides act in speed order with the Gen III damage, accuracy, crit, status and chip rules.',
	category: 'pokeworld',
	inputs: [{ name: 'moveIndex', type: 'number', label: 'Move slot', min: 0, max: 3, default: 0 }],
	steps: (refs) => [
		...battlePrelude(refs),
		{ op: 'compute', value: { ttExpr: ['pokeworld.battleTurn', { player: '$step.4.crystal', wild: '$step.3.wild', moveIndex: '$input.moveIndex' }] } },
		{ op: 'compute', when: { ttExpr: ['eq', '$step.5.outcome', 'won'] }, value: { ttExpr: ['pokeworld.expGain', { member: '$step.5.player', defeatedSpeciesId: '$step.3.wild.speciesId', defeatedLevel: '$step.3.wild.level' }] } },
		{ op: 'things.update', id: '$step.4.id', values: { ttExpr: ['coalesce', { ttExpr: ['get', '$step.6', 'member', null] }, '$step.5.player'] } },
		{
			op: 'things.update',
			id: firstId('$step.1'),
			values: {
				wild: '$step.5.wild',
				log: battleLogAppend('$step.3.log', '$step.5.log'),
				turn: { ttExpr: ['add', { ttExpr: ['coalesce', '$step.3.turn', 0] }, 1] },
				state: { ttExpr: ['if', { ttExpr: ['eq', '$step.5.outcome', 'won'] }, 'won', { ttExpr: ['if', { ttExpr: ['eq', '$step.5.outcome', 'fainted'] }, 'lost', 'active'] }] },
				endedAt: { ttExpr: ['if', { ttExpr: ['eq', '$step.5.outcome', 'continue'] }, null, '$now'] }
			}
		},
		{ op: 'actions.invoke', when: { ttExpr: ['eq', '$step.5.outcome', 'fainted'] }, action: refs.action('heal') },
		{
			op: 'return',
			value: {
				title: { ttExpr: ['if', { ttExpr: ['eq', '$step.5.outcome', 'won'] }, 'Victory!', { ttExpr: ['if', { ttExpr: ['eq', '$step.5.outcome', 'fainted'] }, 'Whited out…', 'Battle'] }] },
				message: { ttExpr: ['join', { ttExpr: ['append', '$step.5.log', { ttExpr: ['if', '$step.6', { ttExpr: ['concat', 'Gained ', { ttExpr: ['get', { ttExpr: ['coalesce', '$step.6', {}] }, 'gained', 0] }, ' EXP.', { ttExpr: ['if', { ttExpr: ['get', { ttExpr: ['coalesce', '$step.6', {}] }, 'leveledUp', false] }, { ttExpr: ['concat', ' Grew to Lv', { ttExpr: ['get', { ttExpr: ['coalesce', '$step.6', {}] }, 'newLevel', ''] }, '!'] }, ''] }] }, ''] }, { ttExpr: ['if', { ttExpr: ['eq', '$step.5.outcome', 'fainted'] }, 'You whited out and rushed the team to safety — everyone is healed.', ''] }] }, ' '] },
				outcome: '$step.5.outcome'
			}
		}
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('battle'), refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('battle'), refs.schema('pokemon')] },
		{ capability: 'actions.invoke', actions: [refs.action('heal')] }
	],
	limits: { timeoutMs: 8000, maxOperations: 24, maxChildActions: 8 }
};

const battleBallAction: SuiteActionDef = {
	key: 'battle-ball',
	name: 'Throw a ball',
	description: 'The Gen III catch formula (HP, catch rate, ball bonus, status, four shakes); a miss gives the wild Pokémon its turn.',
	category: 'pokeworld',
	inputs: [{ name: 'ball', type: 'enum', label: 'Ball', values: ['poke-ball', 'great-ball', 'ultra-ball'], required: true }],
	steps: (refs) => [
		...battlePrelude(refs),
		trainerSearch(refs),
		{ op: 'compute', value: firstCrystal('$step.5') },
		{ op: 'fail', when: { ttExpr: ['lte', bagCount({ ttExpr: ['coalesce', '$step.6.bag', {}] } as unknown as string, '$input.ball'), 0] }, message: { ttExpr: ['concat', 'You have no ', { ttExpr: ['upper', { ttExpr: ['replace', '$input.ball', '-', ' '] }] }, ' left!'] } },
		{ op: 'compute', value: { ttExpr: ['pokeworld.catchRoll', { wild: '$step.3.wild', ball: '$input.ball', player: '$step.4.crystal' }] } },
		partySearch(refs),
		{
			op: 'things.update',
			id: firstId('$step.5'),
			values: {
				bag: bagAdjust({ ttExpr: ['coalesce', '$step.6.bag', {}] } as unknown as string, '$input.ball', -1),
				caught: { ttExpr: ['if', '$step.8.caught', { ttExpr: ['uniq', { ttExpr: ['append', { ttExpr: ['coalesce', '$step.6.caught', []] }, '$step.3.wild.speciesId'] }] }, { ttExpr: ['coalesce', '$step.6.caught', []] }] },
				lastMessage: '$step.8.message',
				updatedAt: '$now'
			}
		},
		{ op: 'things.create', when: '$step.8.caught', schema: refs.schema('pokemon'), values: { ttExpr: ['merge', '$step.8.member', { slot: { ttExpr: ['if', { ttExpr: ['lt', { ttExpr: ['len', '$step.9'] }, 6] }, 'party', 'box'] }, order: { ttExpr: ['len', '$step.9'] }, caughtAt: '$now' }] } },
		{ op: 'things.update', when: { ttExpr: ['not', '$step.8.caught'] }, id: '$step.4.id', values: '$step.8.player' },
		{
			op: 'things.update',
			id: firstId('$step.1'),
			values: {
				wild: { ttExpr: ['coalesce', '$step.8.wild', '$step.3.wild'] },
				log: battleLogAppend('$step.3.log', '$step.8.log'),
				state: { ttExpr: ['if', '$step.8.caught', 'caught', { ttExpr: ['if', { ttExpr: ['eq', { ttExpr: ['get', '$step.8', 'outcome', 'continue'] }, 'fainted'] }, 'lost', 'active'] }] },
				endedAt: { ttExpr: ['if', '$step.8.caught', '$now', null] }
			}
		},
		{ op: 'return', value: { title: { ttExpr: ['if', '$step.8.caught', 'Gotcha! ◓', 'Oh no!'] }, message: { ttExpr: ['join', '$step.8.log', ' '] }, caught: '$step.8.caught' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('battle'), refs.schema('pokemon'), refs.schema('trainer')] },
		{ capability: 'things.update', schemas: [refs.schema('battle'), refs.schema('pokemon'), refs.schema('trainer')] },
		{ capability: 'things.create', schemas: [refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 8000, maxOperations: 24 }
};

const battleRunAction: SuiteActionDef = {
	key: 'battle-run',
	name: 'Run away',
	description: 'The run-odds formula; a failed escape gives the wild Pokémon its turn.',
	category: 'pokeworld',
	inputs: [],
	steps: (refs) => [
		...battlePrelude(refs),
		{ op: 'compute', value: { ttExpr: ['pokeworld.runRoll', { player: '$step.4.crystal', wild: '$step.3.wild', attempts: { ttExpr: ['coalesce', '$step.3.attempts', 0] } }] } },
		{ op: 'things.update', when: { ttExpr: ['not', '$step.5.escaped'] }, id: '$step.4.id', values: '$step.5.player' },
		{
			op: 'things.update',
			id: firstId('$step.1'),
			values: {
				attempts: '$step.5.attempts',
				wild: { ttExpr: ['coalesce', '$step.5.wild', '$step.3.wild'] },
				log: battleLogAppend('$step.3.log', '$step.5.log'),
				state: { ttExpr: ['if', '$step.5.escaped', 'fled', { ttExpr: ['if', { ttExpr: ['eq', { ttExpr: ['get', '$step.5', 'outcome', 'continue'] }, 'fainted'] }, 'lost', 'active'] }] },
				endedAt: { ttExpr: ['if', '$step.5.escaped', '$now', null] }
			}
		},
		{ op: 'return', value: { title: { ttExpr: ['if', '$step.5.escaped', 'Phew', 'Oh no'] }, message: { ttExpr: ['join', '$step.5.log', ' '] }, escaped: '$step.5.escaped' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('battle'), refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('battle'), refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};

const battleItemAction: SuiteActionDef = {
	key: 'battle-item',
	name: 'Use an item in battle',
	description: 'Potions, status cures and revives on your active Pokémon.',
	category: 'pokeworld',
	inputs: [{ name: 'itemId', type: 'enum', label: 'Item', values: ['potion', 'super-potion', 'antidote', 'full-heal', 'revive', 'max-revive'], required: true }],
	steps: (refs) => [
		...battlePrelude(refs),
		trainerSearch(refs),
		{ op: 'compute', value: firstCrystal('$step.5') },
		{ op: 'fail', when: { ttExpr: ['lte', bagCount({ ttExpr: ['coalesce', '$step.6.bag', {}] } as unknown as string, '$input.itemId'), 0] }, message: { ttExpr: ['concat', 'You have no ', { ttExpr: ['upper', '$input.itemId'] }, ' left!'] } },
		{ op: 'compute', value: { ttExpr: ['pokeworld.useItem', { member: '$step.4.crystal', itemId: '$input.itemId', inBattle: true }] } },
		{ op: 'things.update', when: '$step.8.consumed', id: '$step.4.id', values: '$step.8.member' },
		{ op: 'things.update', when: '$step.8.consumed', id: firstId('$step.5'), values: { bag: bagAdjust({ ttExpr: ['coalesce', '$step.6.bag', {}] } as unknown as string, '$input.itemId', -1), updatedAt: '$now' } },
		{ op: 'things.update', id: firstId('$step.1'), values: { log: battleLogAppend('$step.3.log', { ttExpr: ['append', [], '$step.8.message'] } as unknown as string) } },
		{ op: 'return', value: { message: '$step.8.message', consumed: '$step.8.consumed' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('battle'), refs.schema('pokemon'), refs.schema('trainer')] },
		{ capability: 'things.update', schemas: [refs.schema('battle'), refs.schema('pokemon'), refs.schema('trainer')] }
	],
	limits: { timeoutMs: 6000, maxOperations: 16 }
};

const useItemAction: SuiteActionDef = {
	key: 'use-item',
	name: 'Use an item',
	description: 'Use a bag item on a party member outside battle (rare candy levels up, revives restore, potions heal).',
	category: 'pokeworld',
	inputs: [
		{ name: 'itemId', type: 'string', label: 'Item id', required: true, maxLength: 40 },
		{ name: 'pokemonId', type: 'string', label: 'Pokémon thing id', required: true, maxLength: 128 }
	],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'compute', value: firstCrystal('$step.1') },
		{ op: 'fail', when: { ttExpr: ['lte', bagCount({ ttExpr: ['coalesce', '$step.2.bag', {}] } as unknown as string, '$input.itemId'), 0] }, message: 'You do not have that item.' },
		{ op: 'things.get', id: '$input.pokemonId' },
		{ op: 'compute', value: { ttExpr: ['pokeworld.useItem', { member: '$step.4.crystal', itemId: '$input.itemId', inBattle: false }] } },
		{ op: 'things.update', when: '$step.5.consumed', id: '$step.4.id', values: '$step.5.member' },
		{ op: 'things.update', when: '$step.5.consumed', id: firstId('$step.1'), values: { bag: bagAdjust({ ttExpr: ['coalesce', '$step.2.bag', {}] } as unknown as string, '$input.itemId', -1), updatedAt: '$now' } },
		{ op: 'return', value: { message: '$step.5.message', consumed: '$step.5.consumed' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer'), refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('trainer'), refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 6000, maxOperations: 12 }
};

const healOneAction: SuiteActionDef = {
	key: 'heal-one',
	name: 'Heal one Pokémon',
	description: 'Full HP, status cleared, PP restored.',
	category: 'pokeworld',
	inputs: [{ name: 'id', type: 'string', label: 'Pokémon thing id', required: true, maxLength: 128 }],
	steps: () => [
		{ op: 'things.get', id: '$input.id' },
		{ op: 'things.update', id: '$step.1.id', values: { hp: '$step.1.crystal.maxHp', status: 'healthy', moves: { ttExpr: ['map', { ttExpr: ['coalesce', '$step.1.crystal.moves', []] }, { ttExpr: ['set', '$item', 'pp', { ttExpr: ['coalesce', '$item.maxPp', '$item.pp'] }] }] } } },
		{ op: 'return', value: '$step.2.id' }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const healAction: SuiteActionDef = {
	key: 'heal',
	name: 'Heal the party',
	description: 'The Pokémon Center: every party member back to full.',
	category: 'pokeworld',
	inputs: [],
	steps: (refs) => [
		partySearch(refs),
		{ op: 'each', list: '$step.1', action: refs.action('heal-one'), max: 6, inputs: { id: '$item.id' } },
		{ op: 'return', value: { title: 'Fully healed ◓', message: { ttExpr: ['concat', 'Your ', { ttExpr: ['len', '$step.2'] }, ' POKéMON are fighting fit!'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('pokemon')] },
		{ capability: 'actions.invoke', actions: [refs.action('heal-one')] }
	],
	limits: { timeoutMs: 8000, maxOperations: 20, maxChildActions: 6 }
};

const setLeadAction: SuiteActionDef = {
	key: 'set-lead',
	name: 'Make lead',
	description: 'Moves a party member to the front.',
	category: 'pokeworld',
	inputs: [{ name: 'pokemonId', type: 'string', label: 'Pokémon thing id', required: true, maxLength: 128 }],
	steps: (refs) => [
		partySearch(refs),
		{ op: 'compute', value: { ttExpr: ['min', { ttExpr: ['append', { ttExpr: ['map', '$step.1', { ttExpr: ['coalesce', '$item.crystal.order', 0] }] }, 0] }] } },
		{ op: 'things.update', id: '$input.pokemonId', values: { order: { ttExpr: ['sub', '$step.2', 1] }, slot: 'party' } },
		{ op: 'return', value: { message: { ttExpr: ['concat', '$step.3.crystal.species', ' leads the party.'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const depositAction: SuiteActionDef = {
	key: 'deposit',
	name: 'Deposit to the PC',
	description: 'Party → BOX 1 (never the last party member).',
	category: 'pokeworld',
	inputs: [{ name: 'pokemonId', type: 'string', label: 'Pokémon thing id', required: true, maxLength: 128 }],
	steps: (refs) => [
		partySearch(refs),
		{ op: 'fail', when: { ttExpr: ['lte', { ttExpr: ['len', '$step.1'] }, 1] }, message: 'You cannot deposit your last POKéMON!' },
		{ op: 'things.update', id: '$input.pokemonId', values: { slot: 'box', order: 999 } },
		{ op: 'return', value: { message: { ttExpr: ['concat', '$step.3.crystal.species', ' was deposited in BOX 1.'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const withdrawAction: SuiteActionDef = {
	key: 'withdraw',
	name: 'Withdraw from the PC',
	description: 'BOX 1 → party (max six).',
	category: 'pokeworld',
	inputs: [{ name: 'pokemonId', type: 'string', label: 'Pokémon thing id', required: true, maxLength: 128 }],
	steps: (refs) => [
		partySearch(refs),
		{ op: 'fail', when: { ttExpr: ['gte', { ttExpr: ['len', '$step.1'] }, 6] }, message: 'Your party is full!' },
		{ op: 'things.update', id: '$input.pokemonId', values: { slot: 'party', order: { ttExpr: ['add', 10, { ttExpr: ['len', '$step.1'] }] } } },
		{ op: 'return', value: { message: { ttExpr: ['concat', '$step.3.crystal.species', ' joined the party.'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('pokemon')] },
		{ capability: 'things.update', schemas: [refs.schema('pokemon')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const boxAction: SuiteActionDef = {
	key: 'box',
	name: 'PC box',
	description: 'Everything stored in BOX 1 plus the party count.',
	category: 'pokeworld',
	inputs: [],
	steps: (refs) => [
		{ op: 'things.search', schema: refs.schema('pokemon'), where: { slot: 'box' }, limit: 40, sort: { field: 'createdAt', dir: 'asc' } },
		partySearch(refs),
		{ op: 'return', value: { box: memberView('$step.1'), boxCount: { ttExpr: ['len', '$step.1'] }, partyCount: { ttExpr: ['len', '$step.2'] }, silent: true } }
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('pokemon')] }],
	limits: { timeoutMs: 6000, maxOperations: 8, maxResultBytes: 128 * 1024 }
};

const settingsAction: SuiteActionDef = {
	key: 'settings',
	name: 'Save options',
	description: 'Player name (max 7, upper-cased) and sprite.',
	category: 'pokeworld',
	inputs: [
		{ name: 'name', type: 'string', label: 'Name', required: true, maxLength: 7 },
		{ name: 'gender', type: 'enum', label: 'Sprite', values: ['boy', 'girl'], default: 'boy' }
	],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'fail', when: { ttExpr: ['isEmpty', '$step.1'] }, message: 'Begin your journey first.' },
		{ op: 'things.update', id: firstId('$step.1'), values: { name: { ttExpr: ['upper', { ttExpr: ['slice', { ttExpr: ['trim', '$input.name'] }, 0, 7] }] }, gender: '$input.gender', updatedAt: '$now' } },
		{ op: 'return', value: { message: 'Saved!' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer')] },
		{ capability: 'things.update', schemas: [refs.schema('trainer')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const setLocationAction: SuiteActionDef = {
	key: 'set-location',
	name: 'Set location',
	description: 'Teleports you to the world block of a real latitude / longitude (the original game’s Mercator mapping).',
	category: 'pokeworld',
	inputs: [
		{ name: 'lat', type: 'number', label: 'Latitude', required: true, min: -87, max: 87 },
		{ name: 'lng', type: 'number', label: 'Longitude', required: true, min: -180, max: 180 }
	],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'fail', when: { ttExpr: ['isEmpty', '$step.1'] }, message: 'Begin your journey first.' },
		{ op: 'compute', value: { ttExpr: ['pokeworld.blockFor', '$input.lat', '$input.lng'] } },
		{ op: 'things.update', id: firstId('$step.1'), values: { blockX: '$step.3.blockX', blockY: '$step.3.blockY', x: 8, y: 8, facing: 'down', surfing: false, lat: '$input.lat', lng: '$input.lng', lastMessage: 'You arrived somewhere new.', updatedAt: '$now' } },
		{ op: 'return', value: { title: 'Teleported', message: { ttExpr: ['concat', 'Block ', '$step.3.blockX', ',', '$step.3.blockY', ' — legendary POKéMON roam by real geography.'] } } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer')] },
		{ capability: 'things.update', schemas: [refs.schema('trainer')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const toggleBadgeAction: SuiteActionDef = {
	key: 'toggle-badge',
	name: 'Toggle a badge',
	description: 'Marks one of the eight Hoenn badges earned or not.',
	category: 'pokeworld',
	inputs: [{ name: 'badgeId', type: 'enum', label: 'Badge', values: ['stone', 'knuckle', 'dynamo', 'heat', 'balance', 'feather', 'mind', 'rain'], required: true }],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'fail', when: { ttExpr: ['isEmpty', '$step.1'] }, message: 'Begin your journey first.' },
		{ op: 'compute', value: { ttExpr: ['coalesce', { ttExpr: ['get', firstCrystal('$step.1'), 'badges', null] }, []] } },
		{ op: 'compute', value: { ttExpr: ['if', { ttExpr: ['includes', '$step.3', '$input.badgeId'] }, { ttExpr: ['filter', '$step.3', { ttExpr: ['ne', '$item', '$input.badgeId'] }] }, { ttExpr: ['append', '$step.3', '$input.badgeId'] }] } },
		{ op: 'things.update', id: firstId('$step.1'), values: { badges: '$step.4', updatedAt: '$now' } },
		{ op: 'return', value: { silent: true, badges: '$step.4' } }
	],
	capabilities: (refs) => [
		{ capability: 'things.read', schemas: [refs.schema('trainer')] },
		{ capability: 'things.update', schemas: [refs.schema('trainer')] }
	],
	limits: { timeoutMs: 4000, maxOperations: 8 }
};

const pokedexAction: SuiteActionDef = {
	key: 'pokedex',
	name: 'Pokédex page',
	description: '100 species per page with your seen / caught flags.',
	category: 'pokeworld',
	inputs: [{ name: 'page', type: 'number', label: 'Page', min: 1, max: 4, default: 1 }],
	steps: (refs) => [
		trainerSearch(refs),
		{ op: 'compute', value: firstCrystal('$step.1') },
		{ op: 'compute', value: { ttExpr: ['pokeworld.dex', '$input.page', 100] } },
		{ op: 'compute', value: { ttExpr: ['coalesce', { ttExpr: ['get', '$step.2', 'seen', null] }, []] } },
		{ op: 'compute', value: { ttExpr: ['coalesce', { ttExpr: ['get', '$step.2', 'caught', null] }, []] } },
		{
			op: 'return',
			value: {
				silent: true,
				page: '$step.3.page',
				pages: '$step.3.pages',
				hasMore: { ttExpr: ['lt', '$step.3.page', '$step.3.pages'] },
				nextPage: { ttExpr: ['min', '$step.3.pages', { ttExpr: ['add', '$step.3.page', 1] }] },
				prevPage: { ttExpr: ['max', 1, { ttExpr: ['sub', '$step.3.page', 1] }] },
				seenCount: { ttExpr: ['len', '$step.4'] },
				caughtCount: { ttExpr: ['len', '$step.5'] },
				entries: { ttExpr: ['map', '$step.3.entries', { ttExpr: ['merge', '$item', { no: { ttExpr: ['padStart', '$item.id', 3, '0'] }, seen: { ttExpr: ['or', { ttExpr: ['includes', '$step.4', '$item.id'] }, { ttExpr: ['includes', '$step.5', '$item.id'] }] }, caught: { ttExpr: ['includes', '$step.5', '$item.id'] } }] }] }
			}
		}
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('trainer')] }],
	limits: { timeoutMs: 6000, maxOperations: 8, maxResultBytes: 128 * 1024 }
};


// nested schema shapes (the registry nests via children / items)
const STAT_FIELDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((name) => ({ name, type: 'number' as const, min: 0 }));
const BAG_FIELDS = ['poke-ball', 'great-ball', 'ultra-ball', 'potion', 'super-potion', 'antidote', 'full-heal', 'revive', 'max-revive', 'rare-candy', 'escape-rope', 'nugget'].map((name) => ({ name, type: 'number' as const, min: 0 }));
const MOVE_FIELDS = [
	{ name: 'name', type: 'string' as const, maxLength: 20 },
	{ name: 'type', type: 'string' as const, maxLength: 12 },
	{ name: 'power', type: 'number' as const, min: 0 },
	{ name: 'pp', type: 'number' as const, min: 0 },
	{ name: 'maxPp', type: 'number' as const, min: 0 }
];
const WILD_FIELDS = [
	{ name: 'id', type: 'string' as const, maxLength: 64 },
	{ name: 'speciesId', type: 'number' as const, min: 1, max: 386 },
	{ name: 'species', type: 'string' as const, maxLength: 20 },
	{ name: 'level', type: 'number' as const, min: 1, max: 100 },
	{ name: 'hp', type: 'number' as const, min: 0 },
	{ name: 'maxHp', type: 'number' as const, min: 1 },
	{ name: 'status', type: 'string' as const, maxLength: 12 },
	{ name: 'sprite', type: 'string' as const, maxLength: 200 }
];

// ── pages ───────────────────────────────────────────────────────────────────

const shell = (ctx: DemoBlockCtx, refs: SuiteRefs, active: string, body: DemoBlock[]): DemoBlock[] => {
	const kit = demoBlockKit;
	return [
		kit.container(
			ctx,
			'shell',
			'column',
			[{ id: ctx.id('nav'), type: 'component', component: refs.component('nav'), args: { active } }, ...body],
			{ gap: 3, maxWidth: 760, css: { padding: '8px 0 32px' } }
		)
	];
};
const bound = (ctx: DemoBlockCtx, refs: SuiteRefs, id: string, component: string, action: string, inputs?: Record<string, string | number | boolean>): DemoBlock =>
	({ id: ctx.id(id), type: 'component', component: refs.component(component), source: { action: refs.actionKey(action), ...(inputs ? { inputs } : {}) } }) as DemoBlock;

export const pokeworldSuite: BehaviourSuite = {
	key: 'pokeworld',
	title: 'Pokeworld',
	emoji: '◓',
	description: 'The Game Boy style Pokémon world — explore, find wild Pokémon in the tall grass, battle, catch, fill the Pokédex.',
	story: [
		'A turn-based rebuild of pokeworld.center: every D-pad press is an action run that resolves the step server-side (collisions, ledges, surfing, field items, signs, the 12% encounter roll on tall grass) through the pokeworld domain pack, and the page refetches the viewport.',
		'Battles are the original Gen III turn machine — damage, STAB, crits, status, accuracy, the four-shake catch formula, run odds — one action per turn. Your trainer, every Pokémon, and the live battle are data things you own; the 386-species catalogue is public system data.'
	],
	tone: 'mint',
	app: { tagline: 'Gotta catch ’em all — on Thingtime ◓', entry: 'play', origin: 'https://www.pokeworld.center' },
	schemas: [
		{
			key: 'trainer',
			description: 'You: name, sprite, where you stand, your bag, badges, and pokédex flags.',
			fields: [
				{ name: 'name', type: 'string', required: true, maxLength: 7 },
				{ name: 'gender', type: 'enum', values: ['boy', 'girl'] },
				{ name: 'blockX', type: 'number' },
				{ name: 'blockY', type: 'number' },
				{ name: 'x', type: 'number', min: 0, max: 15 },
				{ name: 'y', type: 'number', min: 0, max: 15 },
				{ name: 'facing', type: 'enum', values: ['up', 'down', 'left', 'right'] },
				{ name: 'surfing', type: 'boolean' },
				{ name: 'lat', type: 'number', min: -90, max: 90 },
				{ name: 'lng', type: 'number', min: -180, max: 180 },
				{ name: 'badges', type: 'string[]', maxItems: 8 },
				{ name: 'bag', type: 'object', description: 'item id → quantity', children: BAG_FIELDS },
				{ name: 'seen', type: 'array', description: 'species ids seen', items: { type: 'number' } },
				{ name: 'caught', type: 'array', description: 'species ids caught', items: { type: 'number' } },
				{ name: 'collected', type: 'string[]', description: 'field-item tile keys already picked up (last 400)' },
				{ name: 'steps', type: 'number' },
				{ name: 'lastMessage', type: 'string', maxLength: 400 },
				{ name: 'updatedAt', type: 'date' }
			]
		},
		{
			key: 'pokemon',
			description: 'One Pokémon you own: species, level, stats, moves, status, and whether it is in the party or the PC.',
			fields: [
				{ name: 'id', type: 'string', required: true, maxLength: 64 },
				{ name: 'speciesId', type: 'number', required: true, min: 1, max: 386 },
				{ name: 'species', type: 'string', required: true, maxLength: 20 },
				{ name: 'nickname', type: 'string', maxLength: 12 },
				{ name: 'level', type: 'number', min: 1, max: 100 },
				{ name: 'exp', type: 'number', min: 0 },
				{ name: 'hp', type: 'number', min: 0 },
				{ name: 'maxHp', type: 'number', min: 1 },
				{ name: 'stats', type: 'object', children: STAT_FIELDS },
				{ name: 'types', type: 'string[]', maxItems: 2 },
				{ name: 'status', type: 'enum', values: ['healthy', 'poisoned', 'paralyzed', 'asleep', 'burned', 'frozen'] },
				{ name: 'gender', type: 'enum', values: ['male', 'female', 'genderless'] },
				{ name: 'shiny', type: 'boolean' },
				{ name: 'sprite', type: 'string', maxLength: 200 },
				{ name: 'spriteBack', type: 'string', maxLength: 200 },
				{ name: 'moves', type: 'array', description: 'up to four moves', items: { type: 'object', children: MOVE_FIELDS } },
				{ name: 'slot', type: 'enum', values: ['party', 'box'] },
				{ name: 'order', type: 'number' },
				{ name: 'caughtAt', type: 'date' }
			]
		},
		{
			key: 'battle',
			description: 'A wild encounter in progress: the wild Pokémon, which of yours is out, the log.',
			fields: [
				{ name: 'state', type: 'enum', values: ['active', 'won', 'lost', 'caught', 'fled'] },
				{ name: 'wild', type: 'object', children: WILD_FIELDS },
				{ name: 'playerId', type: 'string', maxLength: 128 },
				{ name: 'turn', type: 'number' },
				{ name: 'attempts', type: 'number' },
				{ name: 'log', type: 'string[]', maxItems: 12 },
				{ name: 'biome', type: 'string', maxLength: 20 },
				{ name: 'startedAt', type: 'date' },
				{ name: 'endedAt', type: 'date' }
			]
		},
		{
			key: 'species',
			description: 'One of the 386 species (public content): stats, types, catch rate, sprite.',
			fields: [
				{ name: 'id', type: 'number', required: true, min: 1, max: 386 },
				{ name: 'name', type: 'string', required: true, maxLength: 40 },
				{ name: 'displayName', type: 'string', maxLength: 40 },
				{ name: 'types', type: 'string[]', maxItems: 2 },
				{ name: 'baseStats', type: 'object', children: STAT_FIELDS },
				{ name: 'catchRate', type: 'number' },
				{ name: 'genderRate', type: 'number' },
				{ name: 'baseExp', type: 'number' },
				{ name: 'growthRate', type: 'string', maxLength: 30 },
				{ name: 'isLegendary', type: 'boolean' },
				{ name: 'genus', type: 'string', maxLength: 60 },
				{ name: 'flavor', type: 'string', maxLength: 600 },
				{ name: 'heightM', type: 'number' },
				{ name: 'weightKg', type: 'number' },
				{ name: 'sprite', type: 'string', maxLength: 200 }
			]
		}
	],
	components: [navComponent, hudComponent, mapComponent, battleComponent, partyComponent, bagComponent, pokedexComponent, pcComponent, settingsComponent],
	actions: [
		stateAction,
		addPokemonAction,
		startAction,
		moveAction,
		interactAction,
		battleMoveAction,
		battleBallAction,
		battleRunAction,
		battleItemAction,
		useItemAction,
		healOneAction,
		healAction,
		setLeadAction,
		depositAction,
		withdrawAction,
		boxAction,
		settingsAction,
		setLocationAction,
		toggleBadgeAction,
		pokedexAction
	],
	data: [],
	pages: [
		{ key: 'play', name: 'Game', description: 'The screen, the D-pad, the battle.', blocks: (ctx, refs) => shell(ctx, refs, 'play', [bound(ctx, refs, 'hud', 'hud', 'state'), bound(ctx, refs, 'battle', 'battle', 'state'), bound(ctx, refs, 'map', 'map', 'state')]) },
		{ key: 'party', name: 'Party', description: 'Your six.', blocks: (ctx, refs) => shell(ctx, refs, 'party', [bound(ctx, refs, 'party', 'party', 'state')]) },
		{ key: 'bag', name: 'Bag', description: 'Items and where to use them.', blocks: (ctx, refs) => shell(ctx, refs, 'bag', [bound(ctx, refs, 'bag', 'bag', 'state')]) },
		{ key: 'pokedex', name: 'Pokédex', description: 'All 386, 100 per page.', blocks: (ctx, refs) => shell(ctx, refs, 'pokedex', [bound(ctx, refs, 'pokedex', 'pokedex', 'pokedex', { page: '{query.page}' })]) },
		{ key: 'pc', name: 'PC', description: 'BOX 1.', blocks: (ctx, refs) => shell(ctx, refs, 'pc', [bound(ctx, refs, 'pc', 'pc', 'box')]) },
		{ key: 'settings', name: 'Options', description: 'Name, sprite, location, badges.', blocks: (ctx, refs) => shell(ctx, refs, 'settings', [bound(ctx, refs, 'settings', 'settings', 'state')]) }
	]
};
