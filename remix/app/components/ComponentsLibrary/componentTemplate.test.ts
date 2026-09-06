import assert from 'node:assert/strict';
import test from 'node:test';

test('Builder nested scope values preserve structure without executing template-shaped data', () => {
	const data = { label: 'Buy tubes', nested: { ttArg: 'secret' } };
	assert.deepEqual(resolveTemplate({ ttArg: 'result.item' }, { result: { item: data }, secret: 'not data' }), data);
	assert.deepEqual(resolveTemplate({ ttEach: { arg: 'result.items', node: '{item.label}' } }, { result: { items: [data] } }), ['Buy tubes']);
});

test('Builder nested ttArg and ttFormat share the existing text expansion ceiling', () => {
	const scope = { result: { payload: { text: 'x'.repeat(MAX_RESOLVED_CHARS * 2) } } };
	for (const leaf of [{ ttArg: 'result.payload' }, { ttFormat: { arg: 'result.payload', kind: 'json' } }]) {
		const resolved = resolveTemplate({ ttRepeat: { count: 24, node: leaf } }, scope);
		assert.ok(JSON.stringify(resolved).length <= MAX_RESOLVED_CHARS + 256);
	}
	const cyclic: any = { label: 'bounded' };
	cyclic.self = cyclic;
	assert.deepEqual(resolveTemplate({ ttArg: 'result' }, { result: cyclic }), { label: 'bounded' });
});

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	MAX_RESOLVED_CHARS,
	MAX_RESOLVED_NODES,
	EACH_HARD_CAP,
	MAX_RESOLVED_VALUES,
	REPEAT_HARD_CAP,
	coerceArgValue,
	defaultsFromArgs,
	resolveTemplate,
	sanitizeArgSpecs
} from './componentTemplate.ts';

// Count every value in a resolved tree the way the server's render gate counts
// the raw template (countServerRenderNodes / checkSchemaRenderTree): one per
// object, array, and leaf.
const countValues = (value: unknown): number => {
	if (Array.isArray(value)) return 1 + value.reduce((sum: number, entry) => sum + countValues(entry), 0);
	if (value && typeof value === 'object') {
		return 1 + Object.values(value as Record<string, unknown>).reduce<number>((sum, entry) => sum + countValues(entry), 0);
	}
	return 1;
};

// Count every character of resolved TEXT — what the DOM actually holds.
const countChars = (value: unknown): number => {
	if (typeof value === 'string') return value.length;
	if (Array.isArray(value)) return value.reduce((sum: number, entry) => sum + countChars(entry), 0);
	if (value && typeof value === 'object') {
		// reduce<number> like countValues above: Object.values() of an unknown
		// record is unknown[], so without the explicit type argument reduce picks
		// its T-returning overload with T = unknown and this stops matching the
		// declared `: number` return. tsc flags it; the ratchet is non-blocking,
		// so it would have slipped through as a warning.
		return Object.values(value as Record<string, unknown>).reduce<number>((sum, entry) => sum + countChars(entry), 0);
	}
	return 0;
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

// Regression: the per-level ttRepeat cap does NOT bound total output — nesting
// multiplies it (REPEAT_HARD_CAP ** depth). The server render gate only counts
// the STORED template, and `component` is not a protected kind: any signed-in
// user can publish one that every /components visitor then resolves. Total
// output must stay bounded.
test('nested ttRepeat cannot expand past the shared budget', () => {
	// 11 levels is what actually fits inside the stored-crystal caps; unbounded
	// this is 24^11 ≈ 2.4e15 values, i.e. a permanently hung tab.
	const attack = repeatBomb(11);
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');

	const started = Date.now();
	const produced = countValues(resolveTemplate(attack, {}));
	assert.ok(
		produced <= MAX_RESOLVED_NODES + 1,
		`resolution produced ${produced} values, above the ${MAX_RESOLVED_NODES} budget`
	);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

test('the budget is shared across sibling repeats, not per node', () => {
	const siblings = {
		tag: 'div',
		children: Array.from({ length: 8 }, () => repeatBomb(6))
	};
	const produced = countValues(resolveTemplate(siblings, {}));
	assert.ok(produced <= MAX_RESOLVED_NODES + 1, `siblings produced ${produced} values`);
});

// Regression: the node budget bounds output COUNT, not output SIZE. One stored
// string can carry thousands of '{arg}' tokens and each resolves to an arg
// value up to MAX_COMPONENT_SAVED_ARG_CHARS (2000) long, so the string nodes
// the node budget still allows can materialise gigabytes. Measured before the
// char budget existed: this 695-byte template resolved to 43.9 MB, and a 9 KB
// sibling exhausted a 3 GB heap.
test('token substitution cannot expand past the resolve budget', () => {
	const leaf = '{a}'.repeat(200); // 600-char string, 200 tokens
	const nest = (depth: number): unknown =>
		depth === 0 ? leaf : { ttRepeat: { count: REPEAT_HARD_CAP, node: nest(depth - 1) } };
	const attack = { tag: 'div', children: [nest(3)] };
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');
	assert.ok(JSON.stringify(attack).length <= 32 * 1024, 'attack template must pass the raw-template byte cap');

	const started = Date.now();
	// a saved-version arg value at its maximum stored length
	const produced = countChars(resolveTemplate(attack, { a: 'A'.repeat(2000) }));

	// Allow the raw template's own size on top of the budget: the last string to
	// overspend is charged in full rather than truncated mid-write.
	const ceiling = MAX_RESOLVED_CHARS + JSON.stringify(attack).length;
	assert.ok(produced <= ceiling, `resolution produced ${produced} chars, over the ${ceiling} ceiling`);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

// Regression: tokenless strings used to be exempt from the char budget on the
// reasoning that a string returned by reference is shared, so repeating it costs
// no memory. True of the tree — but NOT of anything that serialises it, and
// resolveNode itself does exactly that for ttActionInputs. Uncharged, the
// template below (28,854 bytes / 17 raw nodes / depth 8 — inside every server
// cap of 32KB / 600 / 24) produced a 104.7 MB data-tt-action-inputs string while
// the 256KB char budget still read as unspent. Charge by occurrence, and the
// serialised size is bounded by the same budget as the tree.
test('a shared tokenless string cannot expand through ttActionInputs', () => {
	const big = 'A'.repeat(28 * 1024);
	// 3 nestings is already 24^3 = 13824 >= MAX_RESOLVED_NODES
	const nest = (depth: number): unknown =>
		depth === 0 ? big : { ttRepeat: { count: REPEAT_HARD_CAP, node: nest(depth - 1) } };
	const attack = { tag: 'div', ttAction: 'run', ttActionInputs: { x: nest(3) } };
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');
	assert.ok(JSON.stringify(attack).length <= 32 * 1024, 'attack template must pass the raw-template byte cap');

	const started = Date.now();
	const resolved = resolveTemplate(attack, {}) as { props?: Record<string, unknown> };
	const serialized = String(resolved.props?.['data-tt-action-inputs'] ?? '');

	// the shared string is charged once per occurrence, so the budget stops the
	// repeat long before the serialisation can multiply it
	const ceiling = MAX_RESOLVED_CHARS + JSON.stringify(attack).length;
	assert.ok(
		serialized.length <= ceiling,
		`ttActionInputs serialised to ${serialized.length} chars, over the ${ceiling} ceiling`
	);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

// Same amplifier as the test above, reached through the one piece of tree text
// the char budget did not meter: an object KEY. Nothing bounds a key's length —
// checkSchemaRenderTree screens keys for dots, null bytes, '$' prefixes and
// prototype names, but never for size — so a ~28KB key fits inside the 32KB
// template cap, and nested ttRepeat re-materialises it once per iteration.
// Uncharged, the template below (28,160 bytes / 15 raw nodes / depth 10 —
// inside every server cap) serialised to a 52.2 MB data-tt-action-inputs string
// while the 256KB char budget read 7 of 262,144 spent.
test('a long node key cannot expand through ttActionInputs', () => {
	const bigKey = 'k'.repeat(28 * 1024); // no dot / '$' / prototype name: the render gate accepts it
	const nest = (depth: number): unknown =>
		depth === 0 ? { [bigKey]: 1 } : { ttRepeat: { count: REPEAT_HARD_CAP, node: nest(depth - 1) } };
	const attack = { tag: 'div', ttAction: 'run', ttActionInputs: { x: nest(3) } };
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');
	assert.ok(JSON.stringify(attack).length <= 32 * 1024, 'attack template must pass the raw-template byte cap');

	const started = Date.now();
	const resolved = resolveTemplate(attack, {}) as { props?: Record<string, unknown> };
	const serialized = String(resolved.props?.['data-tt-action-inputs'] ?? '');

	// one key is charged per occurrence, so the budget stops the repeat before
	// the serialisation can multiply it
	const ceiling = MAX_RESOLVED_CHARS + JSON.stringify(attack).length;
	assert.ok(
		serialized.length <= ceiling,
		`ttActionInputs serialised to ${serialized.length} chars, over the ${ceiling} ceiling`
	);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

// The same amplifier once more, through the last unmetered path: { ttArg }.
// It is the wrapper form of a '{arg}' token, but it returned the scope value
// straight out without charging it, so the char budget metered the token form
// and not this one. A saved version stores up to MAX_COMPONENT_SAVED_ARGS
// values of MAX_COMPONENT_SAVED_ARG_CHARS (2000) chars each, and `component` is
// not in PROTECTED_THINGTIME, so any signed-in user can publish this. Uncharged,
// the 139-byte template below (14 raw nodes, depth 8 — inside every server cap)
// resolved to 7,658,014 chars, 29x over the 256KB budget, while the identical
// template with a '{a}' leaf stayed at 1.0x.
const MAX_SAVED_ARG_CHARS = 2000; // MAX_COMPONENT_SAVED_ARG_CHARS in schemas/registry.ts

test('a ttArg leaf cannot expand past the resolve budget', () => {
	const nest = (depth: number): unknown =>
		depth === 0 ? { ttArg: 'a' } : { ttRepeat: { count: REPEAT_HARD_CAP, node: nest(depth - 1) } };
	const attack = { tag: 'div', children: [nest(3)] };
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');
	assert.ok(JSON.stringify(attack).length <= 32 * 1024, 'attack template must pass the raw-template byte cap');

	const started = Date.now();
	const produced = countChars(resolveTemplate(attack, { a: 'A'.repeat(MAX_SAVED_ARG_CHARS) }));

	// the last value to overspend is charged whole rather than truncated, so one
	// arg value of headroom on top of the budget — like the template-sized
	// allowance the token test above makes
	const ceiling = MAX_RESOLVED_CHARS + JSON.stringify(attack).length + MAX_SAVED_ARG_CHARS;
	assert.ok(produced <= ceiling, `resolution produced ${produced} chars, over the ${ceiling} ceiling`);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

test('a ttArg leaf cannot expand through ttActionInputs', () => {
	const nest = (depth: number): unknown =>
		depth === 0 ? { ttArg: 'a' } : { ttRepeat: { count: REPEAT_HARD_CAP, node: nest(depth - 1) } };
	const attack = { tag: 'div', ttAction: 'run', ttActionInputs: { x: nest(3) } };
	assert.ok(countValues(attack) <= 600, 'attack template must pass the raw-template node cap');
	assert.ok(JSON.stringify(attack).length <= 32 * 1024, 'attack template must pass the raw-template byte cap');

	const started = Date.now();
	const resolved = resolveTemplate(attack, { a: 'A'.repeat(MAX_SAVED_ARG_CHARS) }) as {
		props?: Record<string, unknown>;
	};
	const serialized = String(resolved.props?.['data-tt-action-inputs'] ?? '');

	// The budget meters tree TEXT; JSON.stringify also emits punctuation it does
	// not meter ({} [] "" , :), which is O(1) per resolved node and therefore
	// bounded by MAX_RESOLVED_NODES. Allow that on top of the budget, the
	// template, and the one arg value charged whole — 7.67 MB uncharged still
	// clears this by 27x, which is what the test is here to catch.
	const ceiling = MAX_RESOLVED_CHARS + JSON.stringify(attack).length + MAX_SAVED_ARG_CHARS + 4 * MAX_RESOLVED_NODES;
	assert.ok(
		serialized.length <= ceiling,
		`ttActionInputs serialised to ${serialized.length} chars, over the ${ceiling} ceiling`
	);
	assert.ok(Date.now() - started < 5_000, 'bounded resolution must stay fast');
});

// A charged ttArg must still RESOLVE normally — the budget only bounds the
// total, it must not clip an ordinary value or turn a declared arg undefined.
test('charging ttArg leaves ordinary values intact', () => {
	assert.equal(resolveTemplate({ ttArg: 'label' }, { label: 'Save' }), 'Save');
	assert.equal(resolveTemplate({ ttArg: 'count' }, { count: 42 }), 42);
	assert.equal(resolveTemplate({ ttArg: 'on' }, { on: false }), false);
	assert.equal(resolveTemplate({ ttArg: 'missing' }, { label: 'x' }), undefined);
	// a full-length saved arg resolves whole, uncut
	const long = 'A'.repeat(MAX_SAVED_ARG_CHARS);
	assert.equal(resolveTemplate({ ttArg: 'a' }, { a: long }), long);
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

test('ttArg, ttIf, ttMap and ttMerge resolve against the scope', () => {
	assert.equal(resolveTemplate('hi {who}', { who: 'there' }), 'hi there');
	assert.equal(resolveTemplate({ ttArg: 'label' }, { label: 'Save' }), 'Save');
	assert.equal(resolveTemplate({ ttIf: { arg: 'on', then: 'yes', else: 'no' } }, { on: true }), 'yes');
	assert.equal(resolveTemplate({ ttIf: { arg: 'on', then: 'yes', else: 'no' } }, { on: false }), 'no');
	assert.equal(resolveTemplate({ ttIf: { arg: 'tone', equals: 'danger', then: 'red', else: 'grey' } }, { tone: 'danger' }), 'red');
	assert.equal(resolveTemplate({ ttMap: { arg: 'tone', values: { a: 1, b: 2 }, default: 9 } }, { tone: 'b' }), 2);
	assert.equal(resolveTemplate({ ttMap: { arg: 'tone', values: { a: 1 }, default: 9 } }, { tone: 'zzz' }), 9);
	assert.deepEqual(resolveTemplate({ ttMerge: [{ a: 1 }, { b: '{label}' }] }, { label: 'x' }), { a: 1, b: 'x' });
	assert.deepEqual(resolveTemplate({ ttRepeat: { count: 3, node: '{index}' } }, {}), ['0', '1', '2']);
});

test('ttRepeat counts are capped per level', () => {
	const wild = resolveTemplate({ ttRepeat: { count: 10_000, node: 'x' } }, {}) as unknown[];
	assert.equal(wild.length, REPEAT_HARD_CAP);
	const scoped = resolveTemplate({ ttRepeat: { arg: 'rows', max: 3, node: 'x' } }, { rows: 999 }) as unknown[];
	assert.equal(scoped.length, 3);
});

test('missing tokens resolve to empty rather than the literal token', () => {
	assert.equal(resolveTemplate('{nope}', {}), '');
	assert.equal(resolveTemplate('a{nope}b', {}), 'ab');
});

test('arg lookups never reach Object.prototype', () => {
	// scope is a plain object literal, so an unguarded scope[name] resolved
	// `constructor`/`toString` to a native function — which then rode into the
	// node tree (props/children) and rendered as "function Object() {…}" text.
	// Arg names are only screened by COMPONENT_ARG_NAME_PATTERN, which admits
	// every one of these.
	for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
		assert.equal(resolveTemplate({ ttArg: inherited }, { label: 'hi' }), undefined, `ttArg ${inherited}`);
		assert.equal(resolveTemplate(`x{${inherited}}y`, { label: 'hi' }), 'xy', `token {${inherited}}`);
	}
	assert.equal(resolveTemplate({ ttIf: { arg: 'constructor', then: 'yes', else: 'no' } }, {}), 'no');
	assert.equal(resolveTemplate({ ttIf: { arg: 'valueOf', then: 'yes', else: 'no' } }, {}), 'no');
	assert.deepEqual(resolveTemplate({ ttRepeat: { arg: 'constructor', node: 'x' } }, {}), []);
	// declared args of those names still resolve normally
	assert.equal(resolveTemplate({ ttArg: 'constructor' }, { constructor: 'mine' } as any), 'mine');
	assert.equal(resolveTemplate('x={toString}', { toString: 'mine' } as any), 'x=mine');
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

// Where the two halves of this merge meet: ttAction arrived on develop without
// the char budget, the two-budget guard arrived on this branch without
// ttAction. ttActionInputs is attacker-shaped template like any other node, so
// it has to spend the SAME budget — resolved with a fresh one it would multiply
// MAX_RESOLVED_NODES by the node count and hand the repeat bomb a way around
// the whole-tree guard.

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
		produced <= MAX_RESOLVED_NODES + 1,
		`ttActionInputs produced ${produced} values, above the ${MAX_RESOLVED_NODES} shared budget`
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

// A component crystal is untrusted markup and nothing validates `max` at save
// time, so EACH_HARD_CAP is enforced here or nowhere. A negative max used to
// reach slice() as a count from the END of the list: it dropped the last
// element AND iterated list.length - 1 times, past the cap.
test('ttEach caps the element count for any max, including a negative one', () => {
	const list = Array.from({ length: EACH_HARD_CAP * 3 }, (_value, index) => index);
	const drawn = (max: unknown): number => (resolveTemplate({ ttEach: { arg: 'rows', max, node: 'x' } }, { rows: list }) as unknown[]).length;

	assert.equal(drawn(undefined), EACH_HARD_CAP, 'an absent max falls back to the cap');
	assert.equal(drawn(0), EACH_HARD_CAP, 'a zero max falls back to the cap');
	assert.equal(drawn('nope'), EACH_HARD_CAP, 'a non-numeric max falls back to the cap');
	assert.equal(drawn(EACH_HARD_CAP * 10), EACH_HARD_CAP, 'an oversized max is clamped to the cap');
	assert.equal(drawn(-1), EACH_HARD_CAP, 'a negative max never counts from the end of the list');
	assert.equal(drawn(5), 5, 'a positive max under the cap is honoured');
});
