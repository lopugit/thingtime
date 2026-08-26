import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	MAX_RESOLVED_VALUES,
	REPEAT_HARD_CAP,
	coerceArgValue,
	defaultsFromArgs,
	resolveTemplate,
	sanitizeArgSpecs
} from './componentTemplate.ts';

const countValues = (value: unknown): number => {
	if (Array.isArray(value)) return 1 + value.reduce((sum: number, entry) => sum + countValues(entry), 0);
	if (value && typeof value === 'object') {
		return 1 + Object.values(value as Record<string, unknown>).reduce((sum: number, entry) => sum + countValues(entry), 0);
	}
	return 1;
};

// Nest `depth` ttRepeat wrappers, each at the hard cap. A crystal shaped like
// this passes every stored-render gate in schemas/registry.ts — each level
// costs 2 depth levels (< MAX_SCHEMA_RENDER_DEPTH 24), ~3 nodes
// (< MAX_SCHEMA_RENDER_NODES 600) and ~30 bytes (< MAX_SCHEMA_RENDER_BYTES
// 32Ki) — yet expands to REPEAT_HARD_CAP^depth values without a shared budget.
const repeatBomb = (depth: number): unknown => {
	let node: unknown = { tag: 'span', children: ['x'] };
	for (let level = 0; level < depth; level++) {
		node = { ttRepeat: { count: REPEAT_HARD_CAP, node } };
	}
	return { tag: 'div', children: [node] };
};

test('nested ttRepeat cannot expand past the shared budget', () => {
	// 11 levels is what actually fits inside the stored-crystal caps; unbounded
	// this is 24^11 ≈ 2.4e15 values, i.e. a permanently hung tab.
	const resolved = resolveTemplate(repeatBomb(11), {});
	const produced = countValues(resolved);
	assert.ok(
		produced <= MAX_RESOLVED_VALUES + 1,
		`resolution produced ${produced} values, above the ${MAX_RESOLVED_VALUES} budget`
	);
});

test('the budget is shared across sibling repeats, not per node', () => {
	const siblings = {
		tag: 'div',
		children: Array.from({ length: 8 }, () => repeatBomb(6))
	};
	const produced = countValues(resolveTemplate(siblings, {}));
	assert.ok(produced <= MAX_RESOLVED_VALUES + 1, `siblings produced ${produced} values`);
});

test('ordinary templates resolve untouched by the budget', () => {
	const template = {
		tag: 'button',
		props: { type: 'button', style: { padding: '0 16px', background: '{tone}' } },
		children: ['{label}']
	};
	assert.deepEqual(resolveTemplate(template, { label: 'Get started', tone: '#16161a' }), {
		tag: 'button',
		props: { type: 'button', style: { padding: '0 16px', background: '#16161a' } },
		children: ['Get started']
	});
});

test('a realistic single ttRepeat list still resolves in full', () => {
	const template = {
		tag: 'ul',
		children: [{ ttRepeat: { count: REPEAT_HARD_CAP, node: { tag: 'li', children: ['Item {n}'] } } }]
	};
	const resolved = resolveTemplate(template, {}) as { children: unknown[] };
	assert.equal(resolved.children.length, REPEAT_HARD_CAP);
	assert.deepEqual(resolved.children[0], { tag: 'li', children: ['Item 1'] });
	assert.deepEqual(resolved.children[REPEAT_HARD_CAP - 1], { tag: 'li', children: [`Item ${REPEAT_HARD_CAP}`] });
});

test('ttArg, ttIf, ttMap and ttMerge resolve against the scope', () => {
	assert.equal(resolveTemplate({ ttArg: 'label' }, { label: 'Save' }), 'Save');
	assert.equal(resolveTemplate({ ttIf: { arg: 'on', then: 'yes', else: 'no' } }, { on: true }), 'yes');
	assert.equal(resolveTemplate({ ttIf: { arg: 'on', then: 'yes', else: 'no' } }, { on: false }), 'no');
	assert.equal(resolveTemplate({ ttIf: { arg: 'tone', equals: 'danger', then: 'red', else: 'grey' } }, { tone: 'danger' }), 'red');
	assert.equal(resolveTemplate({ ttMap: { arg: 'tone', values: { a: 1, b: 2 }, default: 9 } }, { tone: 'b' }), 2);
	assert.equal(resolveTemplate({ ttMap: { arg: 'tone', values: { a: 1 }, default: 9 } }, { tone: 'zzz' }), 9);
	assert.deepEqual(resolveTemplate({ ttMerge: [{ a: 1 }, { b: '{label}' }] }, { label: 'x' }), { a: 1, b: 'x' });
});

test('missing tokens resolve to empty rather than the literal token', () => {
	assert.equal(resolveTemplate('{nope}', {}), '');
	assert.equal(resolveTemplate('a{nope}b', {}), 'ab');
});

test('sanitizeArgSpecs and defaultsFromArgs survive junk input', () => {
	assert.deepEqual(sanitizeArgSpecs(null), []);
	assert.deepEqual(sanitizeArgSpecs([{ name: 'a' }, 3, null, { type: 'string' }]), []);
	const specs = sanitizeArgSpecs([{ name: 'label', type: 'string', default: 'hi' }]);
	assert.equal(specs.length, 1);
	assert.deepEqual(defaultsFromArgs(specs), { label: 'hi' });
});

test('coerceArgValue clamps back into each arg type', () => {
	assert.equal(coerceArgValue({ name: 'n', type: 'number', min: 0, max: 10 } as any, '99'), 10);
	assert.equal(coerceArgValue({ name: 'n', type: 'number', min: 0, max: 10 } as any, '-5'), 0);
	assert.equal(coerceArgValue({ name: 'n', type: 'number', default: 3 } as any, 'abc'), 3);
	assert.equal(coerceArgValue({ name: 'b', type: 'boolean' } as any, 'true'), true);
	assert.equal(coerceArgValue({ name: 'b', type: 'boolean' } as any, 'nope'), false);
	assert.equal(coerceArgValue({ name: 'e', type: 'enum', values: ['a', 'b'] } as any, 'b'), 'b');
	assert.equal(coerceArgValue({ name: 'e', type: 'enum', values: ['a', 'b'] } as any, 'zzz'), 'a');
	assert.equal(coerceArgValue({ name: 's', type: 'string', maxLength: 3 } as any, 'abcdef'), 'abc');
});
