import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	EXPRESSION_CATALOGUE,
	EXPRESSION_FUNCTION_NAMES,
	MAX_EXPRESSION_LIST_LENGTH,
	MAX_EXPRESSION_STRING_CHARS,
	evaluateExpression,
	isLambdaArg,
	type ExpressionContext,
	type ExpressionLambdaScope
} from './actionExpressions.ts';

// The pure compute half of the action grammar. The executor supplies the
// resolver; these tests supply a tiny one that understands `$item`/`$index`
// and a `$x` scope the way the executor's resolveValue does, so the
// catalogue's semantics are pinned independently of Mongo.

const makeContext = (scope: Record<string, unknown> = {}, random = () => 0.5): ExpressionContext => {
	const ctx: ExpressionContext = {
		resolve: (value, lambda) => resolve(value, lambda),
		budget: { nodes: 5000 },
		packs: { 'astro.meta': () => ({ pack: true }) },
		random,
		fail: (message) => {
			throw new Error(message);
		}
	};
	const resolve = (value: unknown, lambda?: ExpressionLambdaScope): unknown => {
		if (typeof value === 'string') {
			if (value === '$index') return lambda?.index;
			if (value === '$item') return lambda?.item;
			if (value.startsWith('$item.')) {
				const path = value.slice(6).split('.');
				let current: unknown = lambda?.item;
				for (const segment of path) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined;
				return current;
			}
			if (value.startsWith('$')) return scope[value.slice(1)];
			return value;
		}
		if (Array.isArray(value)) return value.map((entry) => resolve(entry, lambda));
		if (value && typeof value === 'object') {
			const record = value as Record<string, unknown>;
			if (Object.keys(record).length === 1 && Array.isArray(record.ttExpr)) return evaluateExpression(record.ttExpr, ctx, lambda);
			const out: Record<string, unknown> = {};
			for (const [key, entry] of Object.entries(record)) out[key] = resolve(entry, lambda);
			return out;
		}
		return value;
	};
	return ctx;
};

const run = (expression: unknown[], scope?: Record<string, unknown>, random?: () => number): any => evaluateExpression(expression, makeContext(scope, random));

test('math functions compute over numbers and numeric strings', () => {
	assert.equal(run(['add', 1, 2, '3']), 6);
	assert.equal(run(['sub', 10, 4]), 6);
	assert.equal(run(['mul', 2, 3, 4]), 24);
	assert.equal(run(['div', 9, 3]), 3);
	assert.equal(run(['mod', -1, 12]), 11);
	assert.equal(run(['pow', 2, 10]), 1024);
	assert.equal(run(['min', [4, 2, 9]]), 2);
	assert.equal(run(['max', 4, 2, 9]), 9);
	assert.equal(run(['floor', 2.7]), 2);
	assert.equal(run(['ceil', 2.1]), 3);
	assert.equal(run(['round', 2.456, 2]), 2.46);
	assert.equal(run(['clamp', 15, 0, 10]), 10);
	assert.equal(run(['sqrt', 16]), 4);
	assert.throws(() => run(['div', 1, 0]), /div by zero/);
	assert.throws(() => run(['add', 1, 'x']), /expected a number/);
});

test('random helpers honour the injected generator and seeded ints are stable', () => {
	assert.equal(run(['randomInt', 1, 10], {}, () => 0), 1);
	assert.equal(run(['randomInt', 1, 10], {}, () => 0.999), 10);
	assert.equal(run(['chance', 0.3], {}, () => 0.2), true);
	assert.equal(run(['chance', 0.3], {}, () => 0.9), false);
	assert.equal(run(['randomPick', ['a', 'b', 'c']], {}, () => 0.5), 'b');
	assert.equal(run(['seededInt', 'block:3,4', 1, 100]), run(['seededInt', 'block:3,4', 1, 100]));
	assert.equal(run(['hash', 'pikachu']), run(['hash', 'pikachu']));
	assert.notEqual(run(['hash', 'pikachu']), run(['hash', 'pikachU']));
});

test('comparison is numeric when both sides are numeric, else textual', () => {
	assert.equal(run(['eq', '5', 5]), true);
	assert.equal(run(['eq', 'a', 'b']), false);
	assert.equal(run(['lt', '10', '9']), false);
	assert.equal(run(['lt', 'apple', 'banana']), true);
	assert.equal(run(['gte', 3, 3]), true);
	assert.equal(run(['and', 1, 'yes', true]), true);
	assert.equal(run(['or', 0, '', false]), false);
	assert.equal(run(['not', '']), true);
	assert.equal(run(['if', ['gt', 2, 1], 'yes', 'no'].map((value) => (Array.isArray(value) ? { ttExpr: value } : value))), 'yes');
	assert.equal(run(['coalesce', null, '', 'x']), 'x');
	assert.equal(run(['isEmpty', []]), true);
	assert.equal(run(['isEmpty', 0]), false);
	assert.equal(run(['typeof', [1]]), 'list');
});

test('text functions', () => {
	assert.equal(run(['concat', 'a', 1, null, true]), 'a1true');
	assert.equal(run(['upper', 'abc']), 'ABC');
	assert.equal(run(['capitalize', 'pikachu']), 'Pikachu');
	assert.equal(run(['slice', 'abcdef', 1, 3]), 'bc');
	assert.equal(run(['length', 'abcd']), 4);
	assert.equal(run(['join', ['a', 'b'], '-']), 'a-b');
	assert.deepEqual(run(['split', 'a,b', ',']), ['a', 'b']);
	assert.equal(run(['includes', 'hello', 'ell']), true);
	assert.equal(run(['includes', [1, 2], '2']), true);
	assert.equal(run(['replace', 'a-b-c', '-', '+']), 'a+b+c');
	assert.equal(run(['padStart', '7', 3, '0']), '007');
	assert.equal(run(['toNumber', '12.5']), 12.5);
	assert.equal(run(['toNumber', 'nope']), null);
});

test('list functions with lambdas bind $item and $index', () => {
	const party = [
		{ name: 'A', hp: 10, level: 5 },
		{ name: 'B', hp: 0, level: 9 },
		{ name: 'C', hp: 3, level: 7 }
	];
	assert.equal(run(['len', party]), 3);
	assert.deepEqual(run(['filter', party, { ttExpr: ['gt', '$item.hp', 0] }]).map((entry: any) => entry.name), ['A', 'C']);
	assert.deepEqual(run(['map', party, '$item.level']), [5, 9, 7]);
	assert.deepEqual(run(['map', party, '$index']), [0, 1, 2]);
	assert.equal(run(['find', party, { ttExpr: ['eq', '$item.name', 'C'] }]).hp, 3);
	assert.equal(run(['findIndex', party, { ttExpr: ['eq', '$item.name', 'Z'] }]), -1);
	assert.equal(run(['some', party, { ttExpr: ['eq', '$item.hp', 0] }]), true);
	assert.equal(run(['every', party, { ttExpr: ['gt', '$item.hp', 0] }]), false);
	assert.equal(run(['sum', party, '$item.level']), 21);
	assert.equal(run(['avg', [2, 4]]), 3);
	assert.equal(run(['count', party, { ttExpr: ['gt', '$item.hp', 0] }]), 2);
	assert.deepEqual(run(['sortBy', party, '$item.level', 'desc']).map((entry: any) => entry.name), ['B', 'C', 'A']);
	assert.deepEqual(run(['pluck', party, 'name']), ['A', 'B', 'C']);
	assert.deepEqual(run(['range', 3]), [0, 1, 2]);
	assert.deepEqual(run(['range', 2, 4]), [2, 3]);
	assert.deepEqual(run(['uniq', [1, '1', 1, 'a']]), [1, '1', 'a']);
	assert.deepEqual(run(['append', [1], 2, 3]), [1, 2, 3]);
	assert.deepEqual(run(['flatten', [[1], [2, 3], 4]]), [1, 2, 3, 4]);
	assert.equal(run(['get', party, 1]).name, 'B');
	assert.equal(run(['get', { a: 1 }, 'missing', 'dflt']), 'dflt');
	assert.equal(run(['get', { a: 1 }, 'constructor', 'guarded']), 'guarded');
});

test('object and date functions', () => {
	assert.deepEqual(run(['merge', { a: 1 }, { b: 2 }, 'ignored']), { a: 1, b: 2 });
	assert.deepEqual(run(['set', { a: 1 }, 'b', 2]), { a: 1, b: 2 });
	assert.throws(() => run(['set', {}, '__proto__', 1]), /safe key/);
	assert.deepEqual(run(['pick', { a: 1, b: 2 }, ['a']]), { a: 1 });
	assert.deepEqual(run(['omit', { a: 1, b: 2 }, ['a']]), { b: 2 });
	assert.deepEqual(run(['keys', { a: 1 }]), ['a']);
	assert.equal(run(['has', { a: 1 }, 'a']), true);
	const parts = run(['dateParts', '2026-09-02T03:04:05.000Z', 'Australia/Melbourne']) as Record<string, unknown>;
	assert.equal(parts.year, 2026);
	assert.equal(parts.month, 9);
	assert.equal(parts.day, 2);
	assert.equal(parts.hour, 13);
	assert.equal(parts.dayOfYear, 245);
	assert.equal(run(['dateAdd', '2026-01-31T00:00:00.000Z', 1, 'day']), '2026-02-01T00:00:00.000Z');
	assert.equal(run(['dateDiff', '2026-01-01T00:00:00.000Z', '2026-01-02T12:00:00.000Z', 'hours']), 36);
	assert.equal(run(['isoDate', '2026-09-02T23:59:00.000Z']), '2026-09-02');
	assert.equal(run(['formatDate', '2026-09-02T00:00:00.000Z', 'weekday']), 'Wednesday');
});

test('the object builders refuse prototype-accessor keys, not just `set`', () => {
	// Defence in depth: today a `__proto__` key cannot reach here — action step
	// keys are refused at save time (ACTION_STEP_KEY_PATTERN +
	// ACTION_BANNED_SEGMENTS), stored data keys by the data walk
	// (PROTOTYPE_POLLUTION_KEYS), and run inputs are coerced to scalars. This
	// pins the catalogue's own guarantee so it does not silently depend on all
	// three staying exactly as they are.
	//
	// The args are handed straight to evaluateExpression rather than through
	// `run`, because the harness resolver rebuilds every object it walks and
	// would consume the own key itself before the function ever saw it.
	const direct = (expression: unknown[]): unknown =>
		evaluateExpression(expression, {
			resolve: (value) => value,
			budget: { nodes: 1000 },
			packs: {},
			random: () => 0.5,
			fail: (message) => {
				throw new Error(message);
			}
		});

	// JSON.parse, not an object literal: `{ __proto__: … }` in source SETS the
	// prototype, while JSON.parse keeps `__proto__` as an own enumerable
	// property — the shape that makes a [[Set]]-based copy re-point a prototype.
	const hostile = JSON.parse('{"__proto__": {"polluted": "ATTACKER"}, "ok": 1}');
	assert.ok(Object.prototype.hasOwnProperty.call(hostile, '__proto__'), 'fixture must carry an OWN __proto__ key');

	assert.throws(() => direct(['merge', hostile, { b: 2 }]), /safe keys/);
	assert.throws(() => direct(['merge', { a: 1 }, JSON.parse('{"constructor": 1}')]), /safe keys/);
	assert.throws(() => direct(['set', {}, '__proto__', 1]), /safe key/);

	// `pick` and `omit` build objects the same [[Set]] way, so the guarantee in
	// this test's name has to cover them too: `pick` when the key list NAMES an
	// accessor key, `omit` when the source merely CARRIES one (no hostile arg
	// needed — an untouched `omit` walks every own key of its input).
	assert.throws(() => direct(['pick', hostile, ['__proto__']]), /safe keys/);
	assert.throws(() => direct(['omit', hostile, []]), /safe keys/);
	assert.throws(() => direct(['omit', hostile, ['ok']]), /safe keys/);

	// benign merges are untouched: later wins, non-objects are skipped
	const merged = direct(['merge', { a: 1, b: 1 }, 'ignored', { b: 2 }]) as Record<string, unknown>;
	assert.deepEqual(merged, { a: 1, b: 2 });
	assert.equal(Object.getPrototypeOf(merged), Object.prototype, 'a benign merge keeps the ordinary prototype');

	// benign pick/omit keep both their data AND an ordinary prototype
	const picked = direct(['pick', { a: 1, b: 2 }, ['a']]) as Record<string, unknown>;
	assert.deepEqual(picked, { a: 1 });
	assert.equal(Object.getPrototypeOf(picked), Object.prototype, 'a benign pick keeps the ordinary prototype');
	const omitted = direct(['omit', { a: 1, b: 2 }, ['a']]) as Record<string, unknown>;
	assert.deepEqual(omitted, { b: 2 });
	assert.equal(Object.getPrototypeOf(omitted), Object.prototype, 'a benign omit keeps the ordinary prototype');

	assert.equal((({}) as Record<string, unknown>).polluted, undefined, 'nothing reaches the global prototype');
});

test('if / and / or / coalesce short-circuit — the untaken branch never evaluates', () => {
	// `set` with an empty key throws; inside the untaken branch it must not run
	assert.equal(run(['if', false, { ttExpr: ['set', {}, '', 1] }, 'safe']), 'safe');
	assert.equal(run(['if', true, 'taken', { ttExpr: ['div', 1, 0] }]), 'taken');
	assert.equal(run(['and', false, { ttExpr: ['div', 1, 0] }]), false);
	assert.equal(run(['or', true, { ttExpr: ['div', 1, 0] }]), true);
	assert.equal(run(['coalesce', 'x', { ttExpr: ['div', 1, 0] }]), 'x');
});

test('domain pack functions dispatch through the bound table and count as pack calls', () => {
	let calls = 0;
	const ctx = makeContext();
	ctx.onPackCall = () => {
		calls += 1;
	};
	assert.deepEqual(evaluateExpression(['astro.meta'], ctx), { pack: true });
	assert.equal(calls, 1);
	assert.throws(() => evaluateExpression(['pokeworld.species', 25], ctx), /not available/);
});

test('the catalogue is closed and arities are enforced', () => {
	assert.throws(() => run(['eval', '1+1']), /Unknown expression function/);
	assert.throws(() => run(['sub', 1]), /takes 2 args/);
	assert.ok(isLambdaArg('filter', 1));
	assert.ok(!isLambdaArg('filter', 0));
	for (const [name, signature] of Object.entries(EXPRESSION_CATALOGUE)) {
		assert.ok(signature.min <= signature.max, `${name} arity`);
		assert.ok(signature.doc.length > 0, `${name} doc`);
	}
});

// The catalogue and the bound pack table are plain objects, so a name off
// Object.prototype answers truthily to `TABLE[fn]` while carrying no arity —
// and `args.length < undefined` / `> undefined` are both false, so an
// unguarded gate would wave it through. Every lookup must be own-property.
test('inherited Object.prototype names are not expression functions', () => {
	const inherited = ['constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__'];
	for (const name of inherited) {
		assert.throws(() => run([name, 'x', 'y']), /Unknown expression function/, `${name} must not resolve`);
		assert.equal(isLambdaArg(name, 0), false, `${name} must not claim a lambda arg`);
		assert.equal(EXPRESSION_FUNCTION_NAMES.includes(name), false, `${name} must not be a declared name`);
	}
	// and the same hazard on the pack side: makeContext's pack table is a plain
	// object, so `packs.constructor` is a callable the default branch must not reach
	assert.throws(() => evaluateExpression(['constructor'], makeContext()), /Unknown expression function/);
});

test('budgets refuse runaway evaluation and oversized lists', () => {
	const ctx = makeContext();
	ctx.budget.nodes = 3;
	assert.throws(() => evaluateExpression(['map', [1, 2, 3, 4, 5], { ttExpr: ['add', '$item', 1] }], ctx), /budget exhausted/);
	assert.throws(() => run(['range', MAX_EXPRESSION_LIST_LENGTH + 1]), /caps at/);
});

test('flatten refuses an oversized result without building it first', () => {
	// `map(range(1000), range(1000))` is a million elements for ~2k of the
	// 20k-node budget, and NOTHING checks the run deadline inside an
	// expression. So flatten's cap has to bite during the walk: a cap that
	// only reads the finished array makes the refusal cost as much as the
	// success, and reduce+concat made that cost quadratic (~2.2s of blocking
	// CPU, measured). Every sibling on the same input stays under ~80ms.
	const nested = Array.from({ length: 400 }, () => Array.from({ length: 400 }, (_value, index) => index));
	const started = process.hrtime.bigint();
	assert.throws(() => run(['flatten', nested]), /lists cap at/);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	// 160,000 elements: linear is single-digit ms, quadratic is ~hundreds
	assert.ok(elapsedMs < 250, `flatten refusal took ${Math.round(elapsedMs)}ms — it is building the whole result before capping`);
	// and the ordinary semantics are untouched, including the exact boundary
	assert.deepEqual(run(['flatten', [[1], [2, 3], 4]]), [1, 2, 3, 4]);
	assert.equal(run(['flatten', [Array.from({ length: MAX_EXPRESSION_LIST_LENGTH }, (_value, index) => index)]]).length, MAX_EXPRESSION_LIST_LENGTH);
	assert.throws(() => run(['flatten', [Array.from({ length: MAX_EXPRESSION_LIST_LENGTH + 1 }, (_value, index) => index)]]), /lists cap at/);
});

test('replace and join refuse an oversized result without building it first', () => {
	// Same hazard as flatten, on the text side. `capText` reads `.length` on a
	// FINISHED string, and V8's Array#join materialises the whole flat result:
	// a 20k-char haystack split on a 1-char needle and rejoined with a 20k-char
	// replacement built 399,980,001 chars (~382MB RSS, ~173ms of blocking,
	// uninterruptible CPU) before the cap looked at it. Both sources are
	// reachable from one saved program — `padStart` clamps its target length to
	// exactly MAX_EXPRESSION_STRING_CHARS — and `actions.run` allows 240/min,
	// so the refusal has to cost O(input), not O(would-be output).
	const big = run(['padStart', 'x', MAX_EXPRESSION_STRING_CHARS, 'y']);
	assert.equal(big.length, MAX_EXPRESSION_STRING_CHARS);

	for (const expression of [
		['replace', big, 'y', big],
		['join', Array.from({ length: 200 }, () => big), big]
	]) {
		const started = process.hrtime.bigint();
		assert.throws(() => run(expression), /text caps at/, `${expression[0]} must refuse`);
		const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
		// projecting the length is single-digit ms; building ~400M chars first
		// is hundreds of ms and hundreds of megabytes
		assert.ok(elapsedMs < 100, `${expression[0]} refusal took ${Math.round(elapsedMs)}ms — it is building the whole result before capping`);
	}

	// ordinary semantics and the exact boundary are untouched
	assert.equal(run(['replace', 'a-b-c', '-', '+']), 'a+b+c');
	assert.equal(run(['replace', 'abc', '', '+']), 'abc');
	assert.equal(run(['replace', 'aaa', 'a', '']), '');
	assert.equal(run(['join', ['a', 'b'], '-']), 'a-b');
	assert.equal(run(['join', ['a', 'b']]), 'a, b');
	assert.equal(run(['join', []]), '');
	assert.equal(run(['join', [big.slice(0, MAX_EXPRESSION_STRING_CHARS - 1), 'z'], '']).length, MAX_EXPRESSION_STRING_CHARS);
	assert.throws(() => run(['join', [big, 'z'], '']), /text caps at/);
});

test('concat refuses an oversized result without building it first', () => {
	// The fourth text builder with the same hazard as flatten/replace/join. Its
	// arg COUNT is bounded (MAX_EXPRESSION_ARGS), which is why it reads safe —
	// but an arg's SIZE is not. A `$step` ref to a things.search result is one
	// resolved value worth hundreds of thousands of characters, and `concat`
	// took `capText(args.map(toText).join(''))`: 24 of those built ~8.4M chars
	// (423x its own 20k cap, ~25ms of blocking, uninterruptible CPU and ~16MB)
	// and only THEN refused, so the refusal cost far more than the success.
	// Capping during the walk refuses on the FIRST arg past the bound and never
	// serialises the other 23: measured 25.3ms/15.7MB → 1.8ms/0.4MB.
	const searchResult = Array.from({ length: 100 }, (_value, index) => ({
		id: `thing-${index}`,
		ownerId: 'someone',
		createdAt: '2026-01-01T00:00:00.000Z',
		crystal: { title: 'x'.repeat(400), body: 'y'.repeat(3000) }
	}));
	const args = Array.from({ length: 24 }, () => '$rows');
	const started = process.hrtime.bigint();
	assert.throws(() => run(['concat', ...args], { rows: searchResult }), /text caps at/);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	// stopping at the first oversized arg is low-single-digit ms; building the
	// whole ~8.4M-char result first is tens of ms and megabytes per refused call
	assert.ok(elapsedMs < 100, `concat refusal took ${Math.round(elapsedMs)}ms — it is building the whole result before capping`);

	// ordinary semantics and the exact boundary are untouched
	assert.equal(run(['concat', 'a', 1, null, true]), 'a1true');
	assert.equal(run(['concat', '']), '');
	const big = run(['padStart', 'x', MAX_EXPRESSION_STRING_CHARS, 'y']);
	assert.equal(run(['concat', big.slice(0, MAX_EXPRESSION_STRING_CHARS - 1), 'z']).length, MAX_EXPRESSION_STRING_CHARS);
	assert.throws(() => run(['concat', big, 'z']), /text caps at/);
});

test('dateAdd refuses an out-of-range result instead of throwing a raw RangeError', () => {
	// `toISOString()` on an overflowed Date throws RangeError('Invalid time
	// value'), which reaches the run record as an opaque message rather than a
	// catalogue-shaped refusal like every other failure in this module.
	for (const [amount, unit] of [
		[1e9, 'year'],
		[1e15, 'day']
	] as const) {
		assert.throws(() => run(['dateAdd', '2026-01-01T00:00:00.000Z', amount, unit]), /dateAdd overflowed the representable date range/);
	}
	// the ordinary range still answers
	assert.equal(run(['dateAdd', '2026-01-31T00:00:00.000Z', 1, 'day']), '2026-02-01T00:00:00.000Z');
	assert.equal(run(['dateAdd', '2026-01-31T00:00:00.000Z', 1, 'year']), '2027-01-31T00:00:00.000Z');
});
