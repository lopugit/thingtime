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
		return 1 + Object.values(value as Record<string, unknown>).reduce<number>((sum, entry) => sum + countValues(entry), 0);
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

test('arg lookups never reach Object.prototype', () => {
	// scope is a plain object literal, so an unguarded scope[name] resolved
	// `constructor`/`toString` to a native function — which then rode into the
	// node tree (props/children) and rendered as "function Object() {…}" text.
	for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
		assert.equal(resolveTemplate({ ttArg: inherited }, { label: 'hi' }), undefined, `ttArg ${inherited}`);
		assert.equal(resolveTemplate(`x{${inherited}}y`, { label: 'hi' }), 'xy', `token {${inherited}}`);
	}
	assert.equal(resolveTemplate({ ttIf: { arg: 'constructor', then: 'yes', else: 'no' } }, {}), 'no');
	assert.deepEqual(resolveTemplate({ ttRepeat: { arg: 'constructor', node: 'x' } }, {}), []);
	// a declared arg of the same name still resolves normally
	assert.equal(resolveTemplate({ ttArg: 'constructor' }, { constructor: 'mine' } as any), 'mine');
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

// The ttAction binding's markup half: a ttAction key on a node folds into the
// two allowlisted data-* props and NEVER survives as a node key. These are
// the guards that keep the interactive marker inert markup — the click half
// (useTtActionClicks) and the executor's envelope carry the actual authority.

test('ttAction folds into data-tt-action and is stripped from the node', () => {
	const resolved = resolveTemplate(
		{ tag: 'div', ttAction: 'send-invoice', props: { style: { color: '#fff' } }, children: ['Send'] },
		{}
	) as Record<string, unknown>;
	assert.equal('ttAction' in resolved, false);
	const props = resolved.props as Record<string, unknown>;
	assert.equal(props['data-tt-action'], 'send-invoice');
	assert.equal((props.style as Record<string, unknown>).color, '#fff');
});

test('ttActionInputs serialize to JSON with {arg} tokens substituted', () => {
	const resolved = resolveTemplate(
		{ tag: 'div', ttAction: 'send-invoice', ttActionInputs: { invoiceId: '{invoiceId}', note: 'literal' }, children: ['Send'] },
		{ invoiceId: 'abc123' }
	) as Record<string, unknown>;
	const props = resolved.props as Record<string, unknown>;
	assert.equal('ttActionInputs' in resolved, false);
	assert.deepEqual(JSON.parse(String(props['data-tt-action-inputs'])), { invoiceId: 'abc123', note: 'literal' });
});

test('ttAction with no props object creates one', () => {
	const resolved = resolveTemplate({ tag: 'span', ttAction: 'ping', children: ['go'] }, {}) as Record<string, unknown>;
	assert.equal((resolved.props as Record<string, unknown>)['data-tt-action'], 'ping');
});

test('{arg} tokens substitute inside the ttAction key itself', () => {
	const resolved = resolveTemplate({ tag: 'div', ttAction: '{which}', children: ['go'] }, { which: 'tag-customer' }) as Record<
		string,
		unknown
	>;
	assert.equal((resolved.props as Record<string, unknown>)['data-tt-action'], 'tag-customer');
});

test('an empty resolved ttAction attaches nothing', () => {
	const resolved = resolveTemplate({ tag: 'div', ttAction: '{missing}', children: ['go'] }, {}) as Record<string, unknown>;
	assert.equal(resolved.props, undefined);
});

test('ttAction inside a ttIf branch resolves with the branch', () => {
	const resolved = resolveTemplate(
		{
			ttIf: {
				arg: 'sent',
				equals: 'true',
				then: { tag: 'div', children: ['✓ sent'] },
				else: { tag: 'div', ttAction: 'send-invoice', ttActionInputs: { invoiceId: '{invoiceId}' }, children: ['Send'] }
			}
		},
		{ sent: 'false', invoiceId: 'inv9' }
	) as Record<string, unknown>;
	const props = resolved.props as Record<string, unknown>;
	assert.equal(props['data-tt-action'], 'send-invoice');
	assert.deepEqual(JSON.parse(String(props['data-tt-action-inputs'])), { invoiceId: 'inv9' });
});

// Where the two halves of this rebase meet: ttAction arrived without the
// shared budget, the budget arrived without ttAction. ttActionInputs is
// attacker-shaped template like any other node, so it has to spend the SAME
// budget — resolved with a fresh one it would multiply MAX_RESOLVED_VALUES by
// the node count and hand the repeat bomb a way around the whole-tree guard.

const sumActionInputValues = (value: unknown): number => {
	if (Array.isArray(value)) return value.reduce((sum: number, entry) => sum + sumActionInputValues(entry), 0);
	if (!value || typeof value !== 'object') return 0;
	const record = value as Record<string, unknown>;
	const blob = (record.props as Record<string, unknown> | undefined)?.['data-tt-action-inputs'];
	let total = 0;
	if (typeof blob === 'string') {
		try {
			total += countValues(JSON.parse(blob));
		} catch {}
	}
	// the blob itself is a string, so recursing through props cannot double-count
	for (const entry of Object.values(record)) total += sumActionInputValues(entry);
	return total;
};

test('ttActionInputs spend the shared budget, not a fresh one per node', () => {
	const template = {
		tag: 'div',
		children: Array.from({ length: 8 }, () => ({
			tag: 'span',
			ttAction: 'send-invoice',
			ttActionInputs: repeatBomb(6),
			children: ['Send']
		}))
	};
	const produced = sumActionInputValues(resolveTemplate(template, {}));
	assert.ok(
		produced <= MAX_RESOLVED_VALUES + 1,
		`ttActionInputs produced ${produced} values, above the ${MAX_RESOLVED_VALUES} shared budget`
	);
});

test('nested ttEach flattens into one list of nodes (a grid of rows of tiles)', () => {
	const template = {
		tag: 'div',
		children: [{ ttEach: { arg: 'rows', node: { ttEach: { arg: 'item', node: { tag: 'img', props: { src: '{item.url}' } } } } } }]
	};
	const resolved = resolveTemplate(template, { rows: [[{ url: 'https://a/1.png' }, { url: 'https://a/2.png' }], [{ url: 'https://a/3.png' }]] }) as { children: unknown[] };
	assert.equal(resolved.children.length, 3);
	assert.deepEqual(resolved.children.map((child: any) => child.props.src), ['https://a/1.png', 'https://a/2.png', 'https://a/3.png']);
});

test('ttEach binds item/index/count and dotted tokens read nested scope', () => {
	const template = { ttEach: { arg: 'result.items', node: { tag: 'li', children: ['{n}/{count} {item.name} {first}'] } } };
	const resolved = resolveTemplate(template, { result: { items: [{ name: 'a' }, { name: 'b' }] } }) as any[];
	assert.deepEqual(resolved.map((node) => node.children[0]), ['1/2 a true', '2/2 b false']);
	const empty = resolveTemplate({ ttEach: { arg: 'result.items', node: 'x', empty: 'none' } }, { result: { items: [] } });
	assert.equal(empty, 'none');
	const ops = resolveTemplate({ ttIf: { arg: 'hp', op: 'gt', value: 50, then: 'high', else: 'low' } }, { hp: 51 });
	assert.equal(ops, 'high');
});
