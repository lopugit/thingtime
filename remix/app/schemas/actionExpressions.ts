// ACTION EXPRESSIONS — the pure compute half of the action grammar.
//
// A step value may contain `{ ttExpr: [fn, ...args] }` anywhere a literal or
// a ref may appear. `fn` names a function in the CLOSED catalogue below (math,
// logic, text, list, object, date, random, and the registered domain packs);
// args are ordinary step values (literals, $refs, nested ttExpr/ttConcat).
// This is still reference substitution plus a fixed function table — there
// is no persisted code, no eval, no prototype walk, and every evaluation is
// bounded by a per-run node budget plus list/string caps, so a hostile
// program degrades into a refusal instead of a hang.
//
// Lambda-taking list functions (filter/map/find/…) evaluate their lambda arg
// once per element with `$item` / `$index` bound. The executor supplies the
// resolver; this module only knows the catalogue and how to apply it, so the
// save-time sanitizer (registry.ts) and the run-time executor (execute.ts)
// validate and evaluate the SAME table.
//
// Domain packs are declared here by NAME + ARITY only (so save-time checks
// stay isomorphic and the inspector can list them); their implementations
// bind server-side (api/utils/actions/packs) and a missing binding is a
// run-time refusal. Pack calls count against the operation budget because
// they are the only functions with non-trivial cost.

export const MAX_EXPRESSION_ARGS = 24;
export const MAX_EXPRESSION_NODES_PER_RUN = 20_000;
export const MAX_EXPRESSION_LIST_LENGTH = 1000;
export const MAX_EXPRESSION_STRING_CHARS = 20_000;
export const MAX_EXPRESSION_RANGE = 1000;

export type ExpressionSignature = {
	min: number;
	max: number;
	// indexes of args that are LAMBDAS (evaluated per element with $item/$index)
	lambda?: number[];
	// domain pack the function belongs to (implementation binds server-side)
	pack?: string;
	doc: string;
};

const sig = (min: number, max: number, doc: string, extra: Partial<ExpressionSignature> = {}): ExpressionSignature => ({ min, max, doc, ...extra });

export const EXPRESSION_CATALOGUE: Record<string, ExpressionSignature> = {
	// ── math ──
	add: sig(2, MAX_EXPRESSION_ARGS, 'Sum of numbers.'),
	sub: sig(2, 2, 'a − b.'),
	mul: sig(2, MAX_EXPRESSION_ARGS, 'Product of numbers.'),
	div: sig(2, 2, 'a ÷ b (b must be non-zero).'),
	mod: sig(2, 2, 'a mod b (b must be non-zero).'),
	pow: sig(2, 2, 'a to the power b.'),
	min: sig(1, MAX_EXPRESSION_ARGS, 'Smallest of numbers (a single list arg is spread).'),
	max: sig(1, MAX_EXPRESSION_ARGS, 'Largest of numbers (a single list arg is spread).'),
	abs: sig(1, 1, 'Absolute value.'),
	floor: sig(1, 1, 'Round down.'),
	ceil: sig(1, 1, 'Round up.'),
	round: sig(1, 2, 'Round to the nearest integer, or to `digits` decimals.'),
	clamp: sig(3, 3, 'Clamp x into [lo, hi].'),
	sqrt: sig(1, 1, 'Square root.'),
	// ── random ──
	random: sig(0, 0, 'A float in [0, 1).'),
	randomInt: sig(2, 2, 'An integer in [lo, hi] inclusive.'),
	chance: sig(1, 1, 'true with probability p (0–1).'),
	randomPick: sig(1, 1, 'A random element of a list.'),
	seededInt: sig(3, 3, 'A deterministic integer in [lo, hi] from a seed string.'),
	hash: sig(1, 1, 'A stable non-negative 32-bit hash of a string.'),
	// ── compare / logic ──
	eq: sig(2, 2, 'a equals b (numbers and numeric strings compare as numbers).'),
	ne: sig(2, 2, 'a does not equal b.'),
	lt: sig(2, 2, 'a < b.'),
	lte: sig(2, 2, 'a ≤ b.'),
	gt: sig(2, 2, 'a > b.'),
	gte: sig(2, 2, 'a ≥ b.'),
	and: sig(1, MAX_EXPRESSION_ARGS, 'Every arg truthy.'),
	or: sig(1, MAX_EXPRESSION_ARGS, 'Any arg truthy.'),
	not: sig(1, 1, 'Logical negation.'),
	if: sig(2, 3, 'cond ? then : else (else defaults to null).'),
	coalesce: sig(1, MAX_EXPRESSION_ARGS, 'First arg that is not null/undefined/"".'),
	isEmpty: sig(1, 1, 'true for null, "", [], {}.'),
	typeof: sig(1, 1, '"string" | "number" | "boolean" | "list" | "object" | "null".'),
	// ── text ──
	concat: sig(1, MAX_EXPRESSION_ARGS, 'Join args as text (null → "").'),
	upper: sig(1, 1, 'Upper-case.'),
	lower: sig(1, 1, 'Lower-case.'),
	trim: sig(1, 1, 'Trim whitespace.'),
	capitalize: sig(1, 1, 'Upper-case the first character.'),
	slice: sig(2, 3, 'Slice a string or list from start (to end).'),
	length: sig(1, 1, 'Length of a string or list.'),
	join: sig(1, 2, 'Join a list with a separator (default ", ").'),
	split: sig(2, 2, 'Split text on a separator.'),
	includes: sig(2, 2, 'Text contains substring / list contains value.'),
	startsWith: sig(2, 2, 'Text starts with prefix.'),
	endsWith: sig(2, 2, 'Text ends with suffix.'),
	replace: sig(3, 3, 'Replace every occurrence of a substring.'),
	padStart: sig(2, 3, 'Pad text on the left to a length (fill defaults to " ").'),
	toNumber: sig(1, 1, 'Coerce to a number (null when not numeric).'),
	toString: sig(1, 1, 'Coerce to text.'),
	// ── list ──
	len: sig(1, 1, 'Length of a list (0 for non-lists).'),
	get: sig(2, 3, 'Read a key/index from an object/list (default when missing).'),
	first: sig(1, 1, 'First element.'),
	last: sig(1, 1, 'Last element.'),
	filter: sig(2, 2, 'Elements where the lambda is truthy.', { lambda: [1] }),
	map: sig(2, 2, 'Lambda applied to every element.', { lambda: [1] }),
	find: sig(2, 2, 'First element where the lambda is truthy (null when none).', { lambda: [1] }),
	findIndex: sig(2, 2, 'Index of the first match (−1 when none).', { lambda: [1] }),
	some: sig(2, 2, 'Any element matches.', { lambda: [1] }),
	every: sig(2, 2, 'Every element matches.', { lambda: [1] }),
	sum: sig(1, 2, 'Sum of elements (or of the lambda per element).', { lambda: [1] }),
	avg: sig(1, 2, 'Average of elements (or of the lambda per element).', { lambda: [1] }),
	count: sig(1, 2, 'Element count (or count where the lambda is truthy).', { lambda: [1] }),
	sortBy: sig(2, 3, 'Sort by the lambda value; dir "asc" (default) or "desc".', { lambda: [1] }),
	reverse: sig(1, 1, 'Reversed copy.'),
	range: sig(1, 2, 'Integers [0, n) or [from, to).'),
	uniq: sig(1, 1, 'Distinct scalar elements.'),
	indexOf: sig(2, 2, 'Index of a value (−1 when missing).'),
	pluck: sig(2, 2, 'The named key of every element.'),
	flatten: sig(1, 1, 'One level of list flattening.'),
	append: sig(2, MAX_EXPRESSION_ARGS, 'List with values appended.'),
	// ── object ──
	merge: sig(1, MAX_EXPRESSION_ARGS, 'Shallow-merge objects (later wins).'),
	set: sig(3, 3, 'Object with one key replaced.'),
	pick: sig(2, 2, 'Object with only the listed keys.'),
	omit: sig(2, 2, 'Object without the listed keys.'),
	keys: sig(1, 1, 'Own keys of an object.'),
	values: sig(1, 1, 'Own values of an object.'),
	entries: sig(1, 1, 'List of { key, value }.'),
	has: sig(2, 2, 'Object has an own key.'),
	// ── date ──
	dateParts: sig(1, 2, 'ISO date → { year, month, day, hour, minute, second, weekday, dayOfYear, iso } in a time zone (default UTC).'),
	dateAdd: sig(3, 3, 'ISO date + amount of unit (minute/hour/day/week/month/year).'),
	dateDiff: sig(3, 3, 'Difference b − a in unit (second/minute/hour/day/week).'),
	dayOfYear: sig(1, 1, '1-based day of the (UTC) year.'),
	isoDate: sig(1, 1, 'Calendar date "YYYY-MM-DD" of an ISO timestamp (UTC).'),
	formatDate: sig(2, 3, 'Format an ISO timestamp: kind "date" | "time" | "datetime" | "weekday" | "month", optional time zone.'),
	// ── domain packs (implementations bind server-side; arities mirror
	// api/utils/actions/packs/<pack>/index.ts *_PACK_ARITIES) ──
	'astro.sky': sig(1, 1, 'The sky at an ISO instant: planets (longitude, sign, retrograde), moon phase.', { pack: 'astro' }),
	'astro.chart': sig(1, 1, 'A natal chart from a birth profile { birthDate, birthTime?, timeKnown, place? }.', { pack: 'astro' }),
	'astro.today': sig(1, 3, 'The whole StarsAlign day model from a profile, an ISO instant (default now), and a viewer time zone.', { pack: 'astro' }),
	'astro.entryId': sig(3, 3, 'School entry id(s) for a planet / sign / house combination (nulls allowed).', { pack: 'astro' }),
	'astro.meta': sig(0, 0, 'Static astrology metadata: signs, planets, houses, aspects, sections.', { pack: 'astro' }),
	'astro.cities': sig(1, 2, 'Birth-place picker matches for a query (limit default 8).', { pack: 'astro' }),
	'astro.search': sig(1, 2, 'School search hits { id, section, title, essence, score } for a query (limit default 30).', { pack: 'astro' }),
	'astro.section': sig(1, 4, 'One school section, filtered and paginated: (section, filter?, page?, perPage?).', { pack: 'astro' }),
	'astro.entry': sig(1, 1, 'One full school entry by id (short + deep dive), or null.', { pack: 'astro' }),
	'pokeworld.species': sig(1, 1, 'A species record (stats, types, catch rate, sprites) by dex number or name.', { pack: 'pokeworld' }),
	'pokeworld.dex': sig(0, 2, 'A page of the 386-species pokédex: (page?, perPage?).', { pack: 'pokeworld' }),
	'pokeworld.blockFor': sig(2, 2, 'The world block { blockX, blockY } for a latitude / longitude.', { pack: 'pokeworld' }),
	'pokeworld.block': sig(2, 2, 'The deterministic 16×16 tile block at (blockX, blockY).', { pack: 'pokeworld' }),
	'pokeworld.view': sig(1, 3, 'The tile viewport around a trainer position: (position, radiusX?, radiusY?).', { pack: 'pokeworld' }),
	'pokeworld.step': sig(2, 3, 'Resolve one move: (position, direction, collectedItemKeys?) → new position, outcome, encounter biome, item, sign.', { pack: 'pokeworld' }),
	'pokeworld.encounter': sig(1, 1, 'Roll a wild encounter for { biome, lat?, lng? } (legendary geofences apply), or null.', { pack: 'pokeworld' }),
	'pokeworld.newPokemon': sig(1, 1, 'A full party-member record for { speciesId, level, gender?, shiny?, nickname? }.', { pack: 'pokeworld' }),
	'pokeworld.stats': sig(1, 1, 'Level-scaled Gen III stats for { speciesId, level }.', { pack: 'pokeworld' }),
	'pokeworld.moves': sig(2, 2, 'The move set for a species (or type list) at a level.', { pack: 'pokeworld' }),
	'pokeworld.battleTurn': sig(1, 1, 'Resolve one battle turn from { player, wild, moveIndex } (speed order, status, accuracy, crit, STAB, chip).', { pack: 'pokeworld' }),
	'pokeworld.catchRoll': sig(1, 1, 'A Gen III catch attempt from { wild, ball, player? } → caught, shakes, message (+ the wild’s reply turn).', { pack: 'pokeworld' }),
	'pokeworld.runRoll': sig(1, 1, 'A run attempt from { player, wild, attempts } → escaped, message (+ the wild’s reply turn).', { pack: 'pokeworld' }),
	'pokeworld.useItem': sig(1, 1, 'Apply a bag item to a party member: { member, itemId, inBattle? } → member, message, consumed.', { pack: 'pokeworld' }),
	'pokeworld.items': sig(0, 0, 'The item catalogue.', { pack: 'pokeworld' }),
	'pokeworld.defaultTrainer': sig(0, 0, 'The starting trainer: name, gender, bag, badges, party, box, pokédex.', { pack: 'pokeworld' }),
	'pokeworld.badges': sig(0, 0, 'The eight Hoenn badges.', { pack: 'pokeworld' }),
	'pokeworld.expGain': sig(1, 1, 'Award experience for a defeat: { member, defeatedSpeciesId, defeatedLevel } → member (levelled), gained, leveledUp.', { pack: 'pokeworld' }),
	'pokeworld.levelFor': sig(2, 2, 'The level a growth rate reaches at a total experience.', { pack: 'pokeworld' })
};

export const EXPRESSION_FUNCTION_NAMES = Object.keys(EXPRESSION_CATALOGUE);

// The ONE way to read the catalogue. `CATALOGUE[fn]` alone is not a closed
// lookup: the table is an object literal, so it inherits Object.prototype and
// `constructor` / `valueOf` / `hasOwnProperty` / `__proto__` all answer with a
// truthy value that is not a signature. Their `.min` / `.max` are undefined,
// and every arity comparison against undefined is false, so an inherited name
// clears both the save-time gate and the run-time gate. Own properties only.
export const catalogueSignature = (fn: string): ExpressionSignature | undefined =>
	Object.prototype.hasOwnProperty.call(EXPRESSION_CATALOGUE, fn) ? EXPRESSION_CATALOGUE[fn] : undefined;

export const isLambdaArg = (fn: string, index: number): boolean => {
	const entry = catalogueSignature(fn);
	return !!entry?.lambda?.includes(index);
};

// ── evaluation ──────────────────────────────────────────────────────────────

export type ExpressionLambdaScope = { item: unknown; index: number };

export type ExpressionContext = {
	// resolve one raw arg (literal / $ref / nested wrapper) into a value; the
	// lambda scope binds $item / $index for lambda evaluations
	resolve: (value: unknown, lambda?: ExpressionLambdaScope) => unknown;
	budget: { nodes: number };
	packs: Record<string, ((args: unknown[]) => unknown) | undefined>;
	onPackCall?: (name: string) => void;
	random: () => number;
	fail: (message: string) => never;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

// Keys that must never be written onto a result object: assigning them reaches
// Object.prototype's accessors instead of adding an own property. Shared so the
// object builders (`set`, `merge`) refuse exactly the same set — the same trio
// api/utils/things/embeddedThings.ts and api/utils/mongodb/querySafety.ts refuse.
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const toNumber = (value: unknown, ctx: ExpressionContext, label: string): number => {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) ctx.fail(`${label} is not a finite number`);
		return value;
	}
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'string' && value.trim() !== '') {
		const num = Number(value);
		if (Number.isFinite(num)) return num;
	}
	return ctx.fail(`${label} expected a number, got ${describe(value)}`);
};

const describe = (value: unknown): string => {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) return 'a list';
	return typeof value === 'object' ? 'an object' : typeof value === 'string' ? `"${value.slice(0, 24)}"` : String(value);
};

const toText = (value: unknown): string => {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return '';
	}
};

const toList = (value: unknown, ctx: ExpressionContext, label: string): unknown[] => {
	if (Array.isArray(value)) return value;
	if (value === null || value === undefined) return [];
	return ctx.fail(`${label} expected a list, got ${describe(value)}`);
};

const truthy = (value: unknown): boolean => {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim() !== '' && value !== 'false' && value !== '0';
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'object') return Object.keys(value as object).length > 0;
	return !!value;
};

const isNumeric = (value: unknown): boolean =>
	typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));

const looseEquals = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
	if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
	if (typeof a === 'object' || typeof b === 'object') {
		try {
			return JSON.stringify(a) === JSON.stringify(b);
		} catch {
			return false;
		}
	}
	return String(a) === String(b);
};

const compare = (a: unknown, b: unknown): number => {
	if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
	const left = toText(a);
	const right = toText(b);
	return left < right ? -1 : left > right ? 1 : 0;
};

const capList = (list: unknown[], ctx: ExpressionContext): unknown[] => {
	if (list.length > MAX_EXPRESSION_LIST_LENGTH) ctx.fail(`Expression lists cap at ${MAX_EXPRESSION_LIST_LENGTH} elements`);
	return list;
};

const capText = (text: string, ctx: ExpressionContext): string => {
	if (text.length > MAX_EXPRESSION_STRING_CHARS) ctx.fail(`Expression text caps at ${MAX_EXPRESSION_STRING_CHARS} characters`);
	return text;
};

// `join` and `replace` are the text builders whose OUTPUT can dwarf their
// inputs, so — exactly like `flatten` below — the cap has to bite BEFORE the
// result exists. `capText` reads `.length` on a FINISHED string, and V8's
// Array#join materialises the whole flat result rather than a lazy rope: a
// 20k-char haystack split on a 1-char needle and rejoined with a 20k-char
// replacement built 399,980,001 chars (~382MB RSS, ~173ms of blocking,
// uninterruptible CPU — no deadline check runs inside an expression) and only
// THEN failed the cap, so the refusal cost far more than the success. Project
// the length from the parts and refuse at the same bound: O(input) either way.
const capProjectedText = (projected: number, ctx: ExpressionContext): void => {
	if (projected > MAX_EXPRESSION_STRING_CHARS) ctx.fail(`Expression text caps at ${MAX_EXPRESSION_STRING_CHARS} characters`);
};

const ownGet = (target: unknown, key: unknown): unknown => {
	if (target === null || target === undefined) return undefined;
	if (Array.isArray(target)) {
		const index = Number(key);
		if (!Number.isInteger(index)) return undefined;
		return index < 0 ? target[target.length + index] : target[index];
	}
	if (typeof target === 'object') {
		const name = String(key);
		return Object.prototype.hasOwnProperty.call(target, name) ? (target as Record<string, unknown>)[name] : undefined;
	}
	if (typeof target === 'string' && Number.isInteger(Number(key))) return target[Number(key)];
	return undefined;
};

const hash32 = (text: string): number => {
	// FNV-1a — stable across runtimes, good enough for seeded game rolls
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
};

// mulberry32 — a tiny deterministic PRNG seeded from a hash
const seededUnit = (seed: number): number => {
	let t = (seed + 0x6d2b79f5) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DATE_UNITS_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

const parseDate = (value: unknown, ctx: ExpressionContext, label: string): Date => {
	const date = typeof value === 'number' ? new Date(value) : new Date(toText(value));
	if (Number.isNaN(date.getTime())) return ctx.fail(`${label} expected an ISO date, got ${describe(value)}`);
	return date;
};

const timeZoneOf = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const zone = value.trim().slice(0, 64);
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return zone;
	} catch {
		return undefined;
	}
};

const partsIn = (date: Date, timeZone: string | undefined): Record<string, number | string> => {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timeZone || 'UTC',
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		weekday: 'short'
	});
	const map = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	const year = Number(map.get('year'));
	const month = Number(map.get('month'));
	const day = Number(map.get('day'));
	const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(map.get('weekday')));
	const start = Date.UTC(year, 0, 1);
	const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - start) / DATE_UNITS_MS.day) + 1;
	return {
		year,
		month,
		day,
		hour: Number(map.get('hour')) % 24,
		minute: Number(map.get('minute')),
		second: Number(map.get('second')),
		weekday: weekdayIndex,
		dayOfYear,
		iso: date.toISOString(),
		timeZone: timeZone || 'UTC'
	};
};

export const evaluateExpression = (expression: unknown[], ctx: ExpressionContext, lambda?: ExpressionLambdaScope): unknown => {
	if (ctx.budget.nodes <= 0) ctx.fail(`Expression budget exhausted (max ${MAX_EXPRESSION_NODES_PER_RUN} evaluations per run)`);
	ctx.budget.nodes -= 1;
	const fn = String(expression[0]);
	const signature = catalogueSignature(fn);
	if (!signature) ctx.fail(`Unknown expression function "${fn.slice(0, 40)}"`);
	const rawArgs = expression.slice(1);
	if (rawArgs.length < signature.min || rawArgs.length > signature.max) {
		ctx.fail(`${fn} takes ${signature.min === signature.max ? signature.min : `${signature.min}–${signature.max}`} args`);
	}
	// SHORT-CIRCUIT forms resolve their args lazily, so a branch that is not
	// taken never evaluates (and never fails): `if` picks one branch, `and` /
	// `or` stop at the first decisive value, `coalesce` at the first present one.
	if (fn === 'if') {
		const condition = ctx.resolve(rawArgs[0], lambda);
		if (truthy(condition)) return ctx.resolve(rawArgs[1], lambda);
		return rawArgs.length > 2 ? ctx.resolve(rawArgs[2], lambda) : null;
	}
	if (fn === 'and') {
		for (const arg of rawArgs) if (!truthy(ctx.resolve(arg, lambda))) return false;
		return true;
	}
	if (fn === 'or') {
		for (const arg of rawArgs) if (truthy(ctx.resolve(arg, lambda))) return true;
		return false;
	}
	if (fn === 'coalesce') {
		for (const arg of rawArgs) {
			const value = ctx.resolve(arg, lambda);
			if (value !== null && value !== undefined && value !== '') return value;
		}
		return null;
	}
	// lambda args stay RAW — they are evaluated per element below
	const args = rawArgs.map((arg, index) => (signature.lambda?.includes(index) ? arg : ctx.resolve(arg, lambda)));
	const each = (list: unknown[], lambdaIndex: number): unknown[] => {
		const body = rawArgs[lambdaIndex];
		return list.map((item, index) => {
			if (ctx.budget.nodes <= 0) ctx.fail(`Expression budget exhausted (max ${MAX_EXPRESSION_NODES_PER_RUN} evaluations per run)`);
			ctx.budget.nodes -= 1;
			return body === undefined ? item : ctx.resolve(body, { item, index });
		});
	};
	const num = (index: number): number => toNumber(args[index], ctx, `${fn} arg ${index + 1}`);
	const list = (index: number): unknown[] => toList(args[index], ctx, `${fn} arg ${index + 1}`);
	const text = (index: number): string => toText(args[index]);

	switch (fn) {
		// ── math ──
		case 'add':
			return args.reduce<number>((sum, _value, index) => sum + num(index), 0);
		case 'sub':
			return num(0) - num(1);
		case 'mul':
			return args.reduce<number>((product, _value, index) => product * num(index), 1);
		case 'div': {
			const divisor = num(1);
			if (divisor === 0) ctx.fail('div by zero');
			return num(0) / divisor;
		}
		case 'mod': {
			const divisor = num(1);
			if (divisor === 0) ctx.fail('mod by zero');
			return ((num(0) % divisor) + divisor) % divisor;
		}
		case 'pow': {
			const result = Math.pow(num(0), num(1));
			if (!Number.isFinite(result)) ctx.fail('pow overflowed');
			return result;
		}
		case 'min':
		case 'max': {
			const values = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
			const numbers = values.map((value, index) => toNumber(value, ctx, `${fn} arg ${index + 1}`));
			if (!numbers.length) return null;
			return fn === 'min' ? Math.min(...numbers) : Math.max(...numbers);
		}
		case 'abs':
			return Math.abs(num(0));
		case 'floor':
			return Math.floor(num(0));
		case 'ceil':
			return Math.ceil(num(0));
		case 'round': {
			const digits = args.length > 1 ? Math.max(0, Math.min(10, Math.round(num(1)))) : 0;
			const factor = Math.pow(10, digits);
			return Math.round(num(0) * factor) / factor;
		}
		case 'clamp':
			return Math.min(num(2), Math.max(num(1), num(0)));
		case 'sqrt': {
			const value = num(0);
			if (value < 0) ctx.fail('sqrt of a negative number');
			return Math.sqrt(value);
		}
		// ── random ──
		case 'random':
			return ctx.random();
		case 'randomInt': {
			const lo = Math.ceil(num(0));
			const hi = Math.floor(num(1));
			if (hi < lo) ctx.fail('randomInt hi must be ≥ lo');
			return lo + Math.floor(ctx.random() * (hi - lo + 1));
		}
		case 'chance':
			return ctx.random() < Math.max(0, Math.min(1, num(0)));
		case 'randomPick': {
			const values = list(0);
			return values.length ? values[Math.floor(ctx.random() * values.length)] : null;
		}
		case 'seededInt': {
			const lo = Math.ceil(num(1));
			const hi = Math.floor(num(2));
			if (hi < lo) ctx.fail('seededInt hi must be ≥ lo');
			return lo + Math.floor(seededUnit(hash32(text(0))) * (hi - lo + 1));
		}
		case 'hash':
			return hash32(text(0));
		// ── compare / logic ──
		case 'eq':
			return looseEquals(args[0], args[1]);
		case 'ne':
			return !looseEquals(args[0], args[1]);
		case 'lt':
			return compare(args[0], args[1]) < 0;
		case 'lte':
			return compare(args[0], args[1]) <= 0;
		case 'gt':
			return compare(args[0], args[1]) > 0;
		case 'gte':
			return compare(args[0], args[1]) >= 0;
		case 'and':
			return args.every(truthy);
		case 'or':
			return args.some(truthy);
		case 'not':
			return !truthy(args[0]);
		case 'if':
			return truthy(args[0]) ? args[1] : args.length > 2 ? args[2] : null;
		case 'coalesce':
			return args.find((value) => value !== null && value !== undefined && value !== '') ?? null;
		case 'isEmpty':
			return !truthy(args[0]) && args[0] !== 0 && args[0] !== false;
		case 'typeof': {
			const value = args[0];
			if (value === null || value === undefined) return 'null';
			if (Array.isArray(value)) return 'list';
			return typeof value === 'object' ? 'object' : typeof value;
		}
		// ── text ──
		case 'concat':
			return capText(args.map(toText).join(''), ctx);
		case 'upper':
			return text(0).toUpperCase();
		case 'lower':
			return text(0).toLowerCase();
		case 'trim':
			return text(0).trim();
		case 'capitalize': {
			const value = text(0);
			return value ? value[0].toUpperCase() + value.slice(1) : value;
		}
		case 'slice': {
			const start = Math.trunc(num(1));
			const end = args.length > 2 ? Math.trunc(num(2)) : undefined;
			return Array.isArray(args[0]) ? (args[0] as unknown[]).slice(start, end) : text(0).slice(start, end);
		}
		case 'length':
			return Array.isArray(args[0]) ? (args[0] as unknown[]).length : text(0).length;
		case 'join': {
			const parts = list(0).map(toText);
			const separator = args.length > 1 ? text(1) : ', ';
			capProjectedText(parts.reduce((total, part) => total + part.length, 0) + Math.max(0, parts.length - 1) * separator.length, ctx);
			return capText(parts.join(separator), ctx);
		}
		case 'split': {
			const separator = text(1);
			return capList(separator ? text(0).split(separator) : [...text(0)], ctx);
		}
		case 'includes':
			return Array.isArray(args[0]) ? (args[0] as unknown[]).some((entry) => looseEquals(entry, args[1])) : text(0).includes(text(1));
		case 'startsWith':
			return text(0).startsWith(text(1));
		case 'endsWith':
			return text(0).endsWith(text(1));
		case 'replace': {
			const needle = text(1);
			const source = text(0);
			if (!needle) return capText(source, ctx);
			const replacement = text(2);
			const parts = source.split(needle);
			capProjectedText(source.length + (parts.length - 1) * (replacement.length - needle.length), ctx);
			return capText(parts.join(replacement), ctx);
		}
		case 'padStart':
			return capText(text(0).padStart(Math.max(0, Math.min(MAX_EXPRESSION_STRING_CHARS, Math.trunc(num(1)))), args.length > 2 ? text(2) || ' ' : ' '), ctx);
		case 'toNumber':
			return isNumeric(args[0]) ? Number(args[0]) : typeof args[0] === 'boolean' ? (args[0] ? 1 : 0) : null;
		case 'toString':
			return capText(toText(args[0]), ctx);
		// ── list ──
		case 'len':
			return Array.isArray(args[0]) ? (args[0] as unknown[]).length : 0;
		case 'get': {
			const value = ownGet(args[0], args[1]);
			return value === undefined ? (args.length > 2 ? args[2] : null) : value;
		}
		case 'first': {
			const values = list(0);
			return values.length ? values[0] : null;
		}
		case 'last': {
			const values = list(0);
			return values.length ? values[values.length - 1] : null;
		}
		case 'filter': {
			const values = list(0);
			const flags = each(values, 1);
			return values.filter((_value, index) => truthy(flags[index]));
		}
		case 'map':
			return each(list(0), 1);
		case 'find': {
			const values = list(0);
			const flags = each(values, 1);
			const index = flags.findIndex(truthy);
			return index === -1 ? null : values[index];
		}
		case 'findIndex':
			return each(list(0), 1).findIndex(truthy);
		case 'some':
			return each(list(0), 1).some(truthy);
		case 'every':
			return each(list(0), 1).every(truthy);
		case 'sum':
		case 'avg': {
			const values = list(0);
			const mapped = args.length > 1 ? each(values, 1) : values;
			const total = mapped.reduce<number>((sum, value, index) => sum + toNumber(value, ctx, `${fn} element ${index + 1}`), 0);
			return fn === 'sum' ? total : values.length ? total / values.length : 0;
		}
		case 'count': {
			const values = list(0);
			return args.length > 1 ? each(values, 1).filter(truthy).length : values.length;
		}
		case 'sortBy': {
			const values = list(0);
			const keys = each(values, 1);
			const direction = args.length > 2 && text(2).toLowerCase() === 'desc' ? -1 : 1;
			return values
				.map((value, index) => ({ value, key: keys[index], index }))
				.sort((a, b) => compare(a.key, b.key) * direction || a.index - b.index)
				.map((entry) => entry.value);
		}
		case 'reverse':
			return [...list(0)].reverse();
		case 'range': {
			const from = args.length > 1 ? Math.trunc(num(0)) : 0;
			const to = Math.trunc(args.length > 1 ? num(1) : num(0));
			const size = Math.max(0, to - from);
			if (size > MAX_EXPRESSION_RANGE) ctx.fail(`range caps at ${MAX_EXPRESSION_RANGE} elements`);
			return Array.from({ length: size }, (_value, index) => from + index);
		}
		case 'uniq': {
			const seen = new Set<string>();
			return list(0).filter((value) => {
				const key = typeof value === 'object' ? toText(value) : `${typeof value}:${String(value)}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}
		case 'indexOf':
			return list(0).findIndex((value) => looseEquals(value, args[1]));
		case 'pluck':
			return list(0).map((value) => ownGet(value, args[1]) ?? null);
		case 'flatten': {
			// The one list function whose OUTPUT can dwarf its input, so it caps
			// DURING the walk instead of after. `reduce` + `concat` copied the
			// whole accumulator per element, and the post-hoc cap only looked at
			// the finished array — so the refusal cost the same as the success:
			// `flatten(map(range(1000), range(1000)))` spent ~2.2s of blocking,
			// uninterruptible CPU (no deadline check runs inside an expression)
			// for ~2k of the 20k node budget, then refused. Push into one array
			// and stop at the cap: the same refusal now costs O(cap).
			const out: unknown[] = [];
			const push = (entry: unknown): void => {
				if (out.length >= MAX_EXPRESSION_LIST_LENGTH) ctx.fail(`Expression lists cap at ${MAX_EXPRESSION_LIST_LENGTH} elements`);
				out.push(entry);
			};
			for (const value of list(0)) {
				if (Array.isArray(value)) for (const entry of value) push(entry);
				else push(value);
			}
			return out;
		}
		case 'append':
			return capList([...list(0), ...args.slice(1)], ctx);
		// ── object ──
		case 'merge': {
			const out: Record<string, unknown> = {};
			// Own-key copy rather than Object.assign: assign writes through [[Set]], so
			// an own `__proto__` key on a merged object reaches Object.prototype's
			// setter and re-points THIS result's prototype instead of landing as data.
			// JSON.parse keeps `__proto__` as an own property, so any caller-supplied
			// $input can carry one. `set` refuses those keys already; merge has to
			// agree, or the guard is only one function wide.
			for (const value of args) {
				if (!isPlainObject(value)) continue;
				for (const key of Object.keys(value)) {
					if (UNSAFE_OBJECT_KEYS.has(key)) ctx.fail(`merge needs safe keys, got ${key}`);
					out[key] = value[key];
				}
			}
			return out;
		}
		case 'set': {
			const key = text(1);
			if (!key || UNSAFE_OBJECT_KEYS.has(key)) ctx.fail('set needs a safe key');
			return { ...(isPlainObject(args[0]) ? args[0] : {}), [key]: args[2] ?? null };
		}
		// `pick` and `omit` copy keys onto a fresh object exactly like `merge`,
		// so they need the same guard: `out[key] = …` is a [[Set]], and for the
		// accessor trio that walks up to Object.prototype's setter and re-points
		// THIS result's prototype instead of landing as data. Silently dropping
		// would be worse than refusing — the key vanishes from the result while
		// the prototype quietly changes — so both fail the way `merge` does.
		case 'pick': {
			const source = isPlainObject(args[0]) ? args[0] : {};
			const out: Record<string, unknown> = {};
			for (const key of list(1).map(toText)) {
				if (UNSAFE_OBJECT_KEYS.has(key)) ctx.fail(`pick needs safe keys, got ${key}`);
				if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
			}
			return out;
		}
		case 'omit': {
			const source = isPlainObject(args[0]) ? args[0] : {};
			const drop = new Set(list(1).map(toText));
			const out: Record<string, unknown> = {};
			for (const key of Object.keys(source)) {
				if (drop.has(key)) continue;
				if (UNSAFE_OBJECT_KEYS.has(key)) ctx.fail(`omit needs safe keys, got ${key}`);
				out[key] = source[key];
			}
			return out;
		}
		case 'keys':
			return isPlainObject(args[0]) ? Object.keys(args[0]) : [];
		case 'values':
			return isPlainObject(args[0]) ? Object.values(args[0]) : [];
		case 'entries':
			return isPlainObject(args[0]) ? Object.entries(args[0]).map(([key, value]) => ({ key, value })) : [];
		case 'has':
			return isPlainObject(args[0]) && Object.prototype.hasOwnProperty.call(args[0], text(1));
		// ── date ──
		case 'dateParts':
			return partsIn(parseDate(args[0], ctx, 'dateParts'), args.length > 1 ? timeZoneOf(args[1]) : undefined);
		case 'dateAdd': {
			const date = parseDate(args[0], ctx, 'dateAdd');
			const amount = Math.trunc(num(1));
			const unit = text(2).toLowerCase().replace(/s$/, '');
			if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
			else if (unit === 'year') date.setUTCFullYear(date.getUTCFullYear() + amount);
			else if (DATE_UNITS_MS[unit]) date.setTime(date.getTime() + amount * DATE_UNITS_MS[unit]);
			else ctx.fail('dateAdd unit must be minute/hour/day/week/month/year');
			// A big enough amount walks off the ±8.64e15ms range and `toISOString`
			// throws a raw RangeError('Invalid time value') instead of refusing the
			// way every other function here does. Every failure in this module is a
			// ctx.fail with a catalogue-shaped message; this one has to be too.
			if (!Number.isFinite(date.getTime())) ctx.fail('dateAdd overflowed the representable date range');
			return date.toISOString();
		}
		case 'dateDiff': {
			const unit = text(2).toLowerCase().replace(/s$/, '');
			if (!DATE_UNITS_MS[unit]) ctx.fail('dateDiff unit must be second/minute/hour/day/week');
			return (parseDate(args[1], ctx, 'dateDiff').getTime() - parseDate(args[0], ctx, 'dateDiff').getTime()) / DATE_UNITS_MS[unit];
		}
		case 'dayOfYear':
			return partsIn(parseDate(args[0], ctx, 'dayOfYear'), undefined).dayOfYear;
		case 'isoDate':
			return parseDate(args[0], ctx, 'isoDate').toISOString().slice(0, 10);
		case 'formatDate': {
			const date = parseDate(args[0], ctx, 'formatDate');
			const kind = text(1).toLowerCase();
			const timeZone = args.length > 2 ? timeZoneOf(args[2]) : undefined;
			const options: Intl.DateTimeFormatOptions =
				kind === 'time'
					? { hour: 'numeric', minute: '2-digit' }
					: kind === 'datetime'
						? { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
						: kind === 'weekday'
							? { weekday: 'long' }
							: kind === 'month'
								? { month: 'long', year: 'numeric' }
								: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
			return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || 'UTC' }).format(date);
		}
		default: {
			// domain packs — own properties only, for the same reason the
			// catalogue lookup is: the bound pack table is a plain object, and an
			// inherited name would hand this branch a callable that is not a pack.
			const implementation = Object.prototype.hasOwnProperty.call(ctx.packs, fn) ? ctx.packs[fn] : undefined;
			if (!implementation) ctx.fail(`Expression function ${fn} is not available on this deployment`);
			ctx.onPackCall?.(fn);
			return implementation(args);
		}
	}
};
