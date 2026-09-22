// PIXEL GARDEN — a tiny time-based garden. Plant seeds in six beds, water
// them, and watch them grow between visits: growth is computed from real
// elapsed time (dateDiff over the planting and watering timestamps) so the
// page changes even when nobody clicks — and the garden component polls on
// an interval source so it visibly ticks.
//
// Built to show: `refresh: 'interval'` sources (a live tally without a
// click), date expressions ($now, dateDiff, dateAdd, formatDate), a
// deterministic daily weather from seededInt, per-bed form groups (a select
// of seeds in each empty bed), and the harvest → coins → seeds economy
// through things.update.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites.ts';
import { appShell, boundBlock, coalesce, compute, concat, each, el, eq, firstCrystal, firstId, get, ifOp, ifTruthy, iff, isEmpty, len, makeKit, makeTheme, merge, navComponent, notEmpty, percent, pick, returnValue, search, today, x, type Node } from './kit.ts';

const T = makeTheme({ bg: '#f2f8ee', surface: '#ffffff', ink: '#1f3a25', text: '#3f5f47', muted: '#7f9a86', accent: '#2f7d4a', soft: '#e6f2e2', border: '#d5e6d2', ok: '#2f7d4a', danger: '#c2452d' });
const k = makeKit(T);
const SMALL = { padding: '6px 11px', fontSize: '12px' };

// seeds: hours to full growth (with 2 waterings), coins on harvest, seed price
type Seed = { id: string; name: string; emoji: string; stages: [string, string, string, string]; hours: number; coins: number; price: number; blurb: string };
const SEEDS: Seed[] = [
	{ id: 'radish', name: 'Radish', emoji: '🌶', stages: ['🌱', '🌿', '🍃', '🌶'], hours: 0.05, coins: 3, price: 1, blurb: 'Grows in about three minutes. For the impatient.' },
	{ id: 'sunflower', name: 'Sunflower', emoji: '🌻', stages: ['🌱', '🌿', '🌼', '🌻'], hours: 0.5, coins: 12, price: 4, blurb: 'Half an hour to bloom. Faces the sun, allegedly.' },
	{ id: 'tomato', name: 'Tomato', emoji: '🍅', stages: ['🌱', '🌿', '🌸', '🍅'], hours: 2, coins: 30, price: 8, blurb: 'Two hours. Needs both waterings or it sulks.' },
	{ id: 'pumpkin', name: 'Pumpkin', emoji: '🎃', stages: ['🌱', '🌿', '🌼', '🎃'], hours: 6, coins: 80, price: 18, blurb: 'Six hours. The big one.' },
	{ id: 'cactus', name: 'Cactus', emoji: '🌵', stages: ['🌱', '🌵', '🌵', '🌵'], hours: 12, coins: 140, price: 30, blurb: 'Twelve hours. Never needs water, never says thanks.' },
	{ id: 'bonsai', name: 'Bonsai', emoji: '🌳', stages: ['🌱', '🌿', '🎋', '🌳'], hours: 24, coins: 300, price: 60, blurb: 'A day. Patience is the crop.' }
];
const SEED_BY_ID = Object.fromEntries(SEEDS.map((seed) => [seed.id, seed]));
const BEDS = 6;
const WATER_HOURS = 0.25; // a watering counts again after fifteen minutes
const STAGE_NAMES = ['seedling', 'sprout', 'budding', 'ready'];
const STAGE_BG = { seedling: '#eef7e8', sprout: '#e3f1dc', budding: '#fdf6d8', ready: '#ffe9d6' };
const WEATHER = ['☀️ sunny', '🌤 fair', '🌧 rainy', '🌫 misty', '🌬 breezy', '🌈 rainbow'];

// ── components ──────────────────────────────────────────────────────────────
const nav = navComponent(T, {
	brand: 'Pixel Garden',
	emoji: '🌱',
	home: '/p/garden',
	links: [
		['beds', 'Garden', '/p/garden'],
		['shed', 'Shed', '/p/garden-shed']
	]
});

const seedOptions = (): Array<[string, string]> => SEEDS.map((seed) => [seed.id, `${seed.emoji} ${seed.name} · ${seed.price}c`]);
const bedCard = (refs: SuiteRefs): Node =>
	el('fieldset', { border: `1px solid ${T.border}`, margin: 0, padding: '12px', minWidth: 0, borderRadius: '16px', display: 'grid', gap: '8px', background: { ttIf: { arg: 'item.planted', then: pick('item.stageName', STAGE_BG, T.soft), else: T.surface } } }, [
		k.row([k.label('Bed {item.n}'), ifTruthy('item.planted', k.pill('{item.stageName}', { background: T.ink, color: '#ffffff' }), k.pill('empty'))]),
		el('div', { display: 'grid', placeItems: 'center', height: '84px', fontSize: '52px', lineHeight: 1, filter: { ttIf: { arg: 'item.thirsty', then: 'saturate(0.4)', else: 'none' } } }, [ifTruthy('item.planted', '{item.stageEmoji}', el('span', { fontSize: '30px', opacity: 0.4 }, ['🟫']))]),
		ifTruthy(
			'item.planted',
			el('div', { display: 'grid', gap: '6px' }, [
				k.row([k.strong('{item.seedName}'), k.muted('planted {item.plantedAgo}', { marginLeft: 'auto', fontSize: '11px' })]),
				k.bar('item.percent', T.ok),
				k.row([k.muted('{item.percent}% grown', { fontSize: '11px' }), ifTruthy('item.thirsty', k.pill('💧 thirsty', { background: '#dff1ff', color: '#1d4f7a' }), k.muted('watered {item.waterings}/2', { fontSize: '11px' }))], { gap: '6px' }),
				k.row([
					ifTruthy('item.ready', k.button('Harvest +{item.coins}c 🧺', refs.actionKey('harvest'), { bed: '{item.n}' }, 'ok', SMALL)),
					ifTruthy('item.thirsty', k.button('Water 💧', refs.actionKey('water'), { bed: '{item.n}' }, 'solid', SMALL)),
					k.button('Dig up', refs.actionKey('clear'), { bed: '{item.n}' }, 'ghost', SMALL)
				], { gap: '6px' })
			]),
			el('div', { display: 'grid', gap: '6px' }, [k.select('seed', seedOptions()), k.row([k.button('Plant 🌱', refs.actionKey('plant'), { bed: '{item.n}' }, 'solid', SMALL)])])
		)
	]);

const garden: SuiteComponentDef = {
	key: 'garden',
	name: 'Garden beds',
	description: 'Six beds bound to the garden action on an INTERVAL source: growth is elapsed real time, so the page ticks on its own. Each bed is its own fieldset (Plant reads only that bed’s seed select).',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Pixel Garden',
				'Plant, water, wait — growth is computed from the clock, and the page refreshes itself every fifteen seconds.',
				ifTruthy(
					'result.hasGarden',
					el('div', { display: 'grid', gap: '10px' }, [
						k.row([k.strong('{result.weather}', { fontSize: '16px' }), k.muted('{result.weatherNote}'), k.pill('🪙 {result.coins} coins', { background: '#fff3cf', color: '#7a5200', marginLeft: 'auto' }), k.muted('{result.clock}', { fontSize: '11px' })]),
						el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }, [each('result.beds', bedCard(refs), { max: 6 })]),
						k.muted('Growth: each seed has a full-growth time; a bed that has not been watered in the last fifteen minutes grows at half speed (cactus does not care). Rainy days water everything.', { fontSize: '12px' })
					]),
					k.card([k.title('Start a garden'), k.text('Six empty beds, twenty coins and a packet of radish seeds. Everything after that you grow yourself.'), k.group([k.row([k.button('Open the garden 🌱', refs.actionKey('start'), {})])])])
				),
				{ inert: el('div', { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }, ['🌱', '🌻', '🍅', '🌵', '🎃', '🌳'].map((emoji) => el('div', { display: 'grid', placeItems: 'center', height: '90px', fontSize: '44px', background: T.soft, borderRadius: '16px' }, [emoji]))) }
			)
		])
};

const shed: SuiteComponentDef = {
	key: 'shed',
	name: 'The shed',
	description: 'Coins, seed packets, the harvest ledger, and the seed catalogue with grow times — bound to the same garden action (one request, shared).',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Pixel Garden',
				'The shed.',
				ifTruthy(
					'result.hasGarden',
					el('div', { display: 'grid', gap: '10px' }, [
						k.grid([k.stat('{result.coins}', 'coins'), k.stat('{result.harvests}', 'harvests'), k.stat('{result.earned}', 'coins earned, ever'), k.stat('{result.plantedCount}/6', 'beds planted')], 120),
						k.card([
							k.strong('Seed catalogue', { fontSize: '17px' }),
							el('div', { display: 'grid', gap: '6px' }, [
								each(
									'result.catalogue',
									el('div', { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${T.border}` }, [
										el('span', { fontSize: '26px', lineHeight: 1 }, ['{item.emoji}']),
										el('div', { display: 'grid', gap: '2px', flex: '1 1 200px' }, [k.strong('{item.name}'), k.muted('{item.blurb}', { fontSize: '12px' })]),
										k.pill('{item.hoursLabel}'),
										k.pill('costs {item.price}c → yields {item.coins}c', { background: '#fff3cf', color: '#7a5200' })
									])
								)
							])
						]),
						k.card([k.strong('Compost everything', { color: T.danger }), k.text('Digs up every bed and resets coins to twenty. Your harvest ledger is kept.'), k.group([k.row([k.button('Compost the garden', refs.actionKey('compost'), {}, 'danger')])])])
					]),
					k.card([k.strong('No garden yet'), k.row([k.link('→ Garden', '/p/garden', 'solid')])])
				)
			)
		])
};

// ── actions ─────────────────────────────────────────────────────────────────
const gardenSearch = (refs: SuiteRefs) => search(refs.schema('garden'), { limit: 1, sort: { field: 'updatedAt', dir: 'desc' } });
const noGarden = { op: 'fail', when: isEmpty('$step.1'), message: 'Open the garden first.' };
const bedsOf = (garden: unknown): Node => coalesce(get(garden, 'beds', null), []);
const bedAt = (beds: unknown, n: unknown): Node => x('get', beds, x('sub', x('round', n), 1), null);
// a plain `get` on the literal catalogue — a nested find lambda would rebind $item
const seedSpec = (seedId: unknown): Node => get(SEED_BY_ID, seedId, {});
// elapsed growth hours, halved while thirsty (cactus is never thirsty)
const bedView = (): Node =>
	x(
		'map',
		'$step.3',
		iff(
			isEmpty('$item.seed'),
			merge('$item', { n: x('add', '$index', 1), planted: false }),
			merge('$item', {
				n: x('add', '$index', 1),
				planted: true,
				seedName: get(seedSpec('$item.seed'), 'name', '?'),
				stagesList: get(seedSpec('$item.seed'), 'stages', []),
				hours: get(seedSpec('$item.seed'), 'hours', 1),
				coins: get(seedSpec('$item.seed'), 'coins', 0),
				thirsty: x('and', x('ne', '$item.seed', 'cactus'), x('or', isEmpty('$item.wateredAt'), x('gt', x('dateDiff', '$item.wateredAt', '$now', 'hour'), WATER_HOURS))),
				plantedAgo: concat(x('round', x('dateDiff', '$item.plantedAt', '$now', 'minute')), ' min ago')
			})
		)
	);
// grown fraction = (well-watered hours + half of the thirsty hours) / seed hours; a
// bed accrues "growth minutes" on every visit and stores them, so growth
// survives long absences without back-computing a watering history
const grownPercent = (): Node =>
	x('map', '$step.4', iff('$item.planted', merge('$item', {
		percent: x('min', 100, x('round', x('mul', 100, x('div', x('add', coalesce('$item.growth', 0), x('mul', x('dateDiff', '$item.tickedAt', '$now', 'hour'), iff('$item.thirsty', 0.5, 1))), '$item.hours')))),
		growth: x('add', coalesce('$item.growth', 0), x('mul', x('dateDiff', '$item.tickedAt', '$now', 'hour'), iff('$item.thirsty', 0.5, 1))),
		tickedAt: '$now'
	}), '$item'));
const stageFields = (): Node =>
	x('map', '$step.5', iff('$item.planted', merge('$item', {
		stageIndex: iff(x('gte', '$item.percent', 100), 3, iff(x('gte', '$item.percent', 60), 2, iff(x('gte', '$item.percent', 25), 1, 0))),
		stageName: x('get', STAGE_NAMES, iff(x('gte', '$item.percent', 100), 3, iff(x('gte', '$item.percent', 60), 2, iff(x('gte', '$item.percent', 25), 1, 0))), 'seedling'),
		stageEmoji: x('get', '$item.stagesList', iff(x('gte', '$item.percent', 100), 3, iff(x('gte', '$item.percent', 60), 2, iff(x('gte', '$item.percent', 25), 1, 0))), '🌱'),
		ready: x('gte', '$item.percent', 100)
	}), '$item'));
const storedBeds = (): Node => x('map', '$step.6', x('pick', '$item', ['seed', 'plantedAt', 'wateredAt', 'waterings', 'growth', 'tickedAt']));
const weatherIndex = (): Node => x('seededInt', today(), 0, WEATHER.length - 1);
// steps 1–6: the garden thing → beds → views with elapsed growth → stages
const gardenPrelude = (refs: SuiteRefs) => [gardenSearch(refs), noGarden, compute(bedsOf(firstCrystal('$step.1'))), compute(bedView()), compute(grownPercent()), compute(stageFields())];

const gardenAction: SuiteActionDef = {
	key: 'garden',
	name: 'Garden state',
	description: 'The beds with growth computed from elapsed time, today’s weather (seededInt over the date), coins and the ledger. Persists the accrued growth so a long absence still counts.',
	category: 'garden',
	inputs: [],
	steps: (refs) => [
		gardenSearch(refs), // 1
		compute(bedsOf(firstCrystal('$step.1'))), // 2
		compute(bedsOf(firstCrystal('$step.1'))), // 3 (bedView reads $step.3)
		compute(bedView()), // 4
		compute(grownPercent()), // 5
		compute(stageFields()), // 6
		{ op: 'things.update', when: notEmpty('$step.1'), id: firstId('$step.1'), values: { beds: storedBeds() } }, // 7
		returnValue({
			hasGarden: notEmpty('$step.1'),
			beds: '$step.6',
			coins: coalesce(get(firstCrystal('$step.1'), 'coins', null), 0),
			harvests: coalesce(get(firstCrystal('$step.1'), 'harvests', null), 0),
			earned: coalesce(get(firstCrystal('$step.1'), 'earned', null), 0),
			plantedCount: x('count', '$step.6', '$item.planted'),
			weather: x('get', WEATHER, weatherIndex(), WEATHER[0]),
			weatherNote: iff(eq(weatherIndex(), 2), 'rain waters every bed today', iff(eq(weatherIndex(), 5), 'a rainbow — lucky harvests pay double', 'a fine day for gardening')),
			weatherIndex: weatherIndex(),
			clock: x('formatDate', '$now', 'time'),
			catalogue: SEEDS.map((seed) => ({ ...seed, hoursLabel: seed.hours < 1 ? `${Math.round(seed.hours * 60)} min` : `${seed.hours} h` })),
			silent: true
		})
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.update', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 6000, maxOperations: 12, maxResultBytes: 64 * 1024 }
};

const emptyBeds = Array.from({ length: BEDS }, () => ({ seed: null, plantedAt: null, wateredAt: null, waterings: 0, growth: 0, tickedAt: null }));
const startAction: SuiteActionDef = {
	key: 'start',
	name: 'Open the garden',
	description: 'Creates your garden thing: six empty beds and twenty coins.',
	category: 'garden',
	inputs: [],
	steps: (refs) => [
		gardenSearch(refs), // 1
		{ op: 'return', when: notEmpty('$step.1'), value: { message: 'Your garden is already open.' } }, // 2
		{ op: 'things.create', schema: refs.schema('garden'), values: { coins: 20, harvests: 0, earned: 0, beds: emptyBeds, openedAt: '$now', updatedAt: '$now' } }, // 3
		returnValue({ title: 'The garden is open 🌱', message: 'Six beds, twenty coins. Radish grows in three minutes — start there.' })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.create', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const bedInput = { name: 'bed', type: 'number' as const, label: 'Bed (1–6)', min: 1, max: BEDS, required: true };
const plantAction: SuiteActionDef = {
	key: 'plant',
	name: 'Plant a seed',
	description: 'Buys a seed with coins and plants it in an empty bed.',
	category: 'garden',
	inputs: [bedInput, { name: 'seed', type: 'enum', label: 'Seed', values: SEEDS.map((seed) => seed.id), required: true }],
	steps: (refs) => [
		...gardenPrelude(refs), // 1–6
		compute(bedAt('$step.6', '$input.bed')), // 7
		{ op: 'fail', when: get('$step.7', 'planted', false), message: 'That bed is taken — harvest or dig it up first.' }, // 8
		compute(seedSpec('$input.seed')), // 9
		{ op: 'fail', when: x('gt', '$step.9.price', coalesce(get(firstCrystal('$step.1'), 'coins', null), 0)), message: concat('A ', '$step.9.name', ' seed costs ', '$step.9.price', ' coins — harvest something first.') }, // 10
		compute(x('map', '$step.6', iff(eq(x('add', '$index', 1), x('round', '$input.bed')), { seed: '$input.seed', plantedAt: '$now', wateredAt: '$now', waterings: 1, growth: 0, tickedAt: '$now' }, x('pick', '$item', ['seed', 'plantedAt', 'wateredAt', 'waterings', 'growth', 'tickedAt'])))), // 11
		{ op: 'things.update', id: firstId('$step.1'), values: { beds: '$step.11', coins: x('sub', coalesce(get(firstCrystal('$step.1'), 'coins', null), 0), '$step.9.price'), updatedAt: '$now' } }, // 12
		returnValue({ message: concat('Planted a ', '$step.9.name', ' in bed ', x('round', '$input.bed'), '. ', '$step.9.blurb') })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.update', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 6000, maxOperations: 16 }
};
const waterAction: SuiteActionDef = {
	key: 'water',
	name: 'Water a bed',
	description: 'Marks the bed watered (counts again after fifteen minutes) — growth is full speed while watered.',
	category: 'garden',
	inputs: [bedInput],
	steps: (refs) => [
		...gardenPrelude(refs), // 1–6
		compute(bedAt('$step.6', '$input.bed')), // 7
		{ op: 'fail', when: x('not', get('$step.7', 'planted', false)), message: 'Nothing is planted there.' }, // 8
		{ op: 'fail', when: x('not', get('$step.7', 'thirsty', false)), message: concat(get('$step.7', 'seedName', 'It'), ' is not thirsty yet.') }, // 9
		compute(x('map', '$step.6', iff(eq(x('add', '$index', 1), x('round', '$input.bed')), merge(x('pick', '$item', ['seed', 'plantedAt', 'waterings', 'growth', 'tickedAt']), { wateredAt: '$now', waterings: x('add', coalesce('$item.waterings', 0), 1) }), x('pick', '$item', ['seed', 'plantedAt', 'wateredAt', 'waterings', 'growth', 'tickedAt'])))), // 10
		{ op: 'things.update', id: firstId('$step.1'), values: { beds: '$step.10', updatedAt: '$now' } }, // 11
		returnValue({ message: concat('Watered the ', get('$step.7', 'seedName', 'bed'), ' 💧') })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.update', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 6000, maxOperations: 16 }
};
const harvestAction: SuiteActionDef = {
	key: 'harvest',
	name: 'Harvest',
	description: 'Harvests a fully grown bed for coins (double on rainbow days) and empties it.',
	category: 'garden',
	inputs: [bedInput],
	steps: (refs) => [
		...gardenPrelude(refs), // 1–6
		compute(bedAt('$step.6', '$input.bed')), // 7
		{ op: 'fail', when: x('not', get('$step.7', 'ready', false)), message: iff(get('$step.7', 'planted', false), concat('Not ready — ', get('$step.7', 'percent', 0), '% grown.'), 'Nothing is planted there.') }, // 8
		compute(x('mul', get('$step.7', 'coins', 0), iff(eq(weatherIndex(), 5), 2, 1))), // 9
		compute(x('map', '$step.6', iff(eq(x('add', '$index', 1), x('round', '$input.bed')), { seed: null, plantedAt: null, wateredAt: null, waterings: 0, growth: 0, tickedAt: null }, x('pick', '$item', ['seed', 'plantedAt', 'wateredAt', 'waterings', 'growth', 'tickedAt'])))), // 10
		{ op: 'things.update', id: firstId('$step.1'), values: { beds: '$step.10', coins: x('add', coalesce(get(firstCrystal('$step.1'), 'coins', null), 0), '$step.9'), harvests: x('add', coalesce(get(firstCrystal('$step.1'), 'harvests', null), 0), 1), earned: x('add', coalesce(get(firstCrystal('$step.1'), 'earned', null), 0), '$step.9'), updatedAt: '$now' } }, // 11
		returnValue({ title: 'Harvest 🧺', message: concat('+', '$step.9', ' coins for the ', get('$step.7', 'seedName', 'crop'), iff(eq(weatherIndex(), 5), ' — rainbow bonus, doubled!', '.')), coins: '$step.11.crystal.coins' })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.update', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 6000, maxOperations: 16 }
};
const clearAction: SuiteActionDef = {
	key: 'clear',
	name: 'Dig up a bed',
	description: 'Empties a bed without harvesting.',
	category: 'garden',
	inputs: [bedInput],
	steps: (refs) => [
		...gardenPrelude(refs), // 1–6
		compute(x('map', '$step.6', iff(eq(x('add', '$index', 1), x('round', '$input.bed')), { seed: null, plantedAt: null, wateredAt: null, waterings: 0, growth: 0, tickedAt: null }, x('pick', '$item', ['seed', 'plantedAt', 'wateredAt', 'waterings', 'growth', 'tickedAt'])))), // 7
		{ op: 'things.update', id: firstId('$step.1'), values: { beds: '$step.7', updatedAt: '$now' } }, // 8
		returnValue({ message: concat('Bed ', x('round', '$input.bed'), ' is empty again.') })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.update', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 6000, maxOperations: 14 }
};
const compostAction: SuiteActionDef = {
	key: 'compost',
	name: 'Compost the garden',
	description: 'Empties every bed and resets coins to twenty; the harvest ledger stays.',
	category: 'garden',
	inputs: [],
	steps: (refs) => [gardenSearch(refs), noGarden, { op: 'things.update', id: firstId('$step.1'), values: { beds: emptyBeds, coins: 20, updatedAt: '$now' } }, returnValue({ message: 'Composted. Six empty beds and twenty coins.' })],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('garden')] }, { capability: 'things.update', schemas: [refs.schema('garden')] }],
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

// ── the suite ───────────────────────────────────────────────────────────────
const BED_FIELDS = [
	{ name: 'seed', type: 'string' as const, maxLength: 20 },
	{ name: 'plantedAt', type: 'date' as const },
	{ name: 'wateredAt', type: 'date' as const },
	{ name: 'waterings', type: 'number' as const },
	{ name: 'growth', type: 'number' as const, description: 'accrued well-watered hours' },
	{ name: 'tickedAt', type: 'date' as const }
];
export const gardenSuite: BehaviourSuite = {
	key: 'garden',
	title: 'Pixel Garden',
	emoji: '🌱',
	description: 'A tiny garden that grows on the clock: plant, water, harvest — growth is computed from real elapsed time and the page ticks on an interval source.',
	story: [
		'One garden thing holds six beds. Every read recomputes growth from the timestamps (dateDiff over plantedAt / wateredAt / tickedAt) and persists the accrued growth, so a bed keeps growing while you are away and a thirsty bed grows at half speed. The beds component binds the garden action with refresh: interval, so the percentages move without a click.',
		'Today’s weather is a seededInt over the ISO date — rain waters everything, a rainbow doubles harvests — and every bed is its own fieldset so Plant reads only that bed’s seed select. Coins buy seeds; harvests pay coins.'
	],
	tone: 'mint',
	app: { tagline: 'Plant, water, wait 🌱', entry: 'beds' },
	schemas: [
		{
			key: 'garden',
			description: 'Your garden: six beds, coins, the harvest ledger.',
			fields: [
				{ name: 'coins', type: 'number', min: 0 },
				{ name: 'harvests', type: 'number' },
				{ name: 'earned', type: 'number' },
				{ name: 'beds', type: 'array', maxItems: BEDS, items: { type: 'object', children: BED_FIELDS } },
				{ name: 'openedAt', type: 'date' },
				{ name: 'updatedAt', type: 'date' }
			]
		}
	],
	components: [nav, garden, shed],
	actions: [gardenAction, startAction, plantAction, waterAction, harvestAction, clearAction, compostAction],
	data: [],
	pages: [
		{ key: 'beds', name: 'Garden', description: 'Six beds that grow on the clock.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'beds', [boundBlock(ctx, refs, 'garden', 'garden', 'garden', undefined, { source: { action: refs.actionKey('garden'), refresh: 'interval', intervalMs: 15000 } })], { maxWidth: 900 }) },
		{ key: 'shed', name: 'Shed', description: 'Coins, catalogue, compost.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'shed', [boundBlock(ctx, refs, 'shed', 'shed', 'garden')], { maxWidth: 900 }) }
	]
};
