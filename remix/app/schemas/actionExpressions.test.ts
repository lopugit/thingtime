import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	EXPRESSION_CATALOGUE,
	EXPRESSION_FUNCTION_NAMES,
	MAX_EXPRESSION_LIST_LENGTH,
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
