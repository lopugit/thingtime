import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { MAX_RESOLVED_NODES, REPEAT_HARD_CAP, resolveTemplate } from './componentTemplate.ts';

// Count every value in a resolved tree the way the server's render gate counts
// the raw template (countServerRenderNodes / checkSchemaRenderTree): one per
// object, array, and leaf.
const countValues = (value: unknown): number => {
	let nodes = 1;
	if (Array.isArray(value)) {
		for (const entry of value) nodes += countValues(entry);
	} else if (value && typeof value === 'object') {
		for (const entry of Object.values(value as Record<string, unknown>)) nodes += countValues(entry);
	}
	return nodes;
};

const nestedRepeats = (depth: number): unknown =>
	depth === 0
		? { tag: 'span', children: ['x'] }
		: { ttRepeat: { count: REPEAT_HARD_CAP, node: nestedRepeats(depth - 1) } };

test('token substitution and the tt* wrappers resolve against scope', () => {
	assert.equal(resolveTemplate('hi {who}', { who: 'there' }), 'hi there');
	assert.equal(resolveTemplate('{missing}', {}), '');
	assert.equal(resolveTemplate({ ttArg: 'tone' }, { tone: 'primary' }), 'primary');
	assert.equal(resolveTemplate({ ttMap: { arg: 'tone', values: { a: 1 }, default: 9 } }, { tone: 'a' }), 1);
	assert.equal(resolveTemplate({ ttMap: { arg: 'tone', values: { a: 1 }, default: 9 } }, { tone: 'zz' }), 9);
	assert.equal(resolveTemplate({ ttIf: { arg: 'on', then: 'yes', else: 'no' } }, { on: true }), 'yes');
	assert.equal(resolveTemplate({ ttIf: { arg: 'on', then: 'yes', else: 'no' } }, { on: false }), 'no');
	assert.deepEqual(resolveTemplate({ ttMerge: [{ a: 1 }, { b: 2 }] }, {}), { a: 1, b: 2 });
	assert.deepEqual(resolveTemplate({ ttRepeat: { count: 3, node: '{index}' } }, {}), ['0', '1', '2']);
});

test('ttRepeat counts are capped per level', () => {
	const wild = resolveTemplate({ ttRepeat: { count: 10_000, node: 'x' } }, {}) as unknown[];
	assert.equal(wild.length, REPEAT_HARD_CAP);
	const scoped = resolveTemplate({ ttRepeat: { arg: 'rows', max: 3, node: 'x' } }, { rows: 999 }) as unknown[];
	assert.equal(scoped.length, 3);
});

// Regression: the per-level ttRepeat cap does NOT bound total output — nesting
// multiplies it (REPEAT_HARD_CAP ** depth). The server render gate only counts
// the STORED template, so a few hundred bytes can ask for ~10^12 nodes, and
// `component` is not a protected kind: any signed-in user can publish one that
// every /components visitor then resolves. Total output must stay bounded.
test('nested ttRepeat cannot expand past the resolve budget', () => {
	// this template clears the server gate: 34 raw nodes (cap 600), depth 22
	// (cap 24), 355 bytes (cap 32768) — yet asks for 24^9 ≈ 2.6e12 nodes
	const attack = { tag: 'div', children: [nestedRepeats(9)] };
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');

	const started = Date.now();
	const resolved = resolveTemplate(attack, {});
	const produced = countValues(resolved);

	assert.ok(
		produced <= MAX_RESOLVED_NODES + 1,
		`resolution produced ${produced} values, over the ${MAX_RESOLVED_NODES} budget`
	);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

test('the budget leaves ordinary components untouched', () => {
	// the whole 2800-component catalog peaks at 560 resolved values
	const card = {
		tag: 'div',
		props: { style: { padding: '12px', borderRadius: '9px' } },
		children: [
			{ tag: 'h3', children: ['{title}'] },
			{ ttRepeat: { arg: 'rows', max: 8, node: { tag: 'p', children: ['row {n}'] } } },
			{ ttIf: { arg: 'showFooter', then: { tag: 'footer', children: ['{title} footer'] } } }
		]
	};
	const resolved = resolveTemplate(card, { title: 'Standings', rows: 8, showFooter: true }) as any;
	assert.ok(countValues(resolved) < MAX_RESOLVED_NODES);
	assert.equal(resolved.children[0].children[0], 'Standings');
	// 1 heading + 8 repeated rows + 1 footer
	assert.equal(resolved.children.length, 10);
	assert.equal(resolved.children[1].children[0], 'row 1');
	assert.equal(resolved.children[8].children[0], 'row 8');
	assert.equal(resolved.children[9].children[0], 'Standings footer');
	// props survive resolution untouched
	assert.deepEqual(resolved.props.style, { padding: '12px', borderRadius: '9px' });
});
