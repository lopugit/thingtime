// Arg-template resolver for component things. A component's crystal.render is
// an HtmlThingNode/ChakraThingNode TEMPLATE: plain nodes plus tiny wrapper
// objects (ttArg / ttMap / ttIf / ttMerge / ttRepeat / ttEach / ttFormat) and
// '{argName}' string tokens, resolved here against the tester's current args
// BEFORE the tree is drawn through the sanitising allowlist renderers. The
// canonical semantics twin used to live at scripts/components-db/lib/resolve.mjs
// (the catalog generator, now in the public thingtime-components repo) — keep
// them identical when that generator is updated, INCLUDING the
// MAX_RESOLVED_VALUES expansion budget below.
//
// The scope is a plain object. Args stay flat scalars, but a builder page can
// bind a component block to an action ("source") and the page runtime then
// adds NESTED values — `result` (the action's result), `viewer`, `state`,
// `last`, `query` — so tokens and wrappers accept dotted paths ('{result.name}',
// { ttEach: { arg: 'result.items', … } }). Path lookups walk OWN properties
// only, so no template can reach Object.prototype through a scope key.

export const REPEAT_HARD_CAP = 24;
// ttEach repeats per ELEMENT of a bound list (a pokédex page, a party, a map
// row of tiles) — larger than a static ttRepeat, still far under the
// renderers' 600-node budget for a sensible element template.
export const EACH_HARD_CAP = 160;

// Resolution can expand FAR beyond the stored template. The server render gate
// (sanitizeSchemaRender) bounds the RAW template — 600 nodes, depth 24, 32KB —
// but nested ttRepeat multiplies: ~11 nestings fit inside depth 24 and buy
// 24^11 output nodes from a few hundred stored bytes. The renderers' own
// 600-node budgets cannot help either: this resolver materialises the whole
// tree BEFORE they ever see it. The catalog generator already caps RESOLVED
// nodes (scripts/components-db/lib/validate.mjs in the catalog repo above), but
// that only covers what IT emits: `component` is
// deliberately NOT in PROTECTED_THINGTIME — any signed-in user can publish one,
// and /components, the detail page, and the `component` kind renderer
// (feed/search/things) all resolve whatever they are handed. So the live
// resolver carries its own ceiling: one budget shared across a whole resolve,
// after which expansion stops and the partial tree is drawn (a truncated
// preview beats a frozen tab). The full 2800-component catalog peaks at 560
// resolved values with args maxed out (mean 185) — ~7x headroom.
export const MAX_RESOLVED_NODES = 4000;
// Compatibility name used by Builder; both share the stricter existing ceiling.
export const MAX_RESOLVED_VALUES = MAX_RESOLVED_NODES;

// The node budget bounds how MANY values a resolve produces, not how many
// CHARACTERS. Token substitution is the second amplifier, and it multiplies
// with the first: one stored string can carry thousands of `{arg}` tokens, each
// resolving to an arg value up to MAX_COMPONENT_SAVED_ARG_CHARS (2000) long, so
// the ~4000 string nodes the node budget still permits can materialise
// gigabytes of text. Measured against this resolver: a 695-byte template that
// clears every server cap (16 raw nodes, depth 6) resolved to 43.9 MB, and a
// 9 KB one exhausted a 3 GB heap outright. So the same shared budget also
// meters every string a resolve puts in the tree — by OCCURRENCE, including
// tokenless ones returned by reference. Sharing makes a repeated string free in
// memory, so charging it looks pessimistic, but the saving is an illusion the
// moment anything serialises the tree: JSON.stringify(ttActionInputs) copies
// every shared reference out by value (see resolveNode). Node KEYS are charged
// for the same reason: a key is tree text like any other, it is NOT bounded by
// the arg caps (it comes from the stored template, where the render gate
// screens keys for dots/$/prototype names but never for LENGTH), and
// JSON.stringify copies it out per occurrence exactly like a shared string.
// Headroom, measured over the whole 2800-component catalog: 6,611 chars at
// each component's declared defaults (3,560 of values + 3,051 of keys), and
// 40,593 with every arg driven to what a saved version may actually store
// (MAX_COMPONENT_SAVED_ARGS 24 x MAX_COMPONENT_SAVED_ARG_CHARS 2000, every
// enum value swept — 37,696 of values + 2,897 of keys). So the real worst case
// sits ~6.5x under this cap and nothing that ships truncates.
export const MAX_RESOLVED_CHARS = 256 * 1024;

const TOKEN_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)\}/g;

export type ComponentArgScalar = string | number | boolean;

export type ComponentArgSpec = {
	name: string;
	type: 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'color';
	label?: string;
	description?: string;
	default?: ComponentArgScalar;
	values?: string[];
	min?: number;
	max?: number;
	maxLength?: number;
};

export type ComponentArgValues = Record<string, ComponentArgScalar | undefined>;
// The full render scope: flat args plus any nested values a trusted surface
// binds (result / viewer / state / last / query / item).
export type ComponentScope = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const BANNED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

// Scope is a plain object literal, so a bare `scope[name]` also reaches
// Object.prototype: an arg name of `constructor`/`toString`/`valueOf` resolved
// to a native function instead of "undeclared arg". Own-property only, the
// same guard ttMap already applies to its `values` table — and the same walk
// for every dotted segment.
const argValue = (scope: ComponentScope, name: string): unknown => {
	if (!name) return undefined;
	if (!name.includes('.')) return Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : undefined;
	let current: unknown = scope;
	for (const segment of name.split('.')) {
		if (BANNED_SEGMENTS.has(segment)) return undefined;
		if (current === null || current === undefined) return undefined;
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
			current = current[index];
			continue;
		}
		if (typeof current !== 'object') return undefined;
		if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
};

const scalarText = (value: unknown): string => {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	// nested values never interpolate as "[object Object]" — a template that
	// wants structure uses ttEach / ttArg, not a token
	return '';
};

const substitute = (template: string, scope: ComponentScope, budget: ResolveBudget): string => {
	let interpolated = 0;
	const out = template.replace(TOKEN_PATTERN, (_match, name: string) => {
		const value = argValue(scope, name);
		if (value === undefined || value === null) return '';
		// clamp to what the budget can still pay for, so an oversized string is
		// never built in the first place
		const room = budget.chars - interpolated;
		if (room <= 0) return '';
		const text = scalarText(value);
		interpolated += Math.min(text.length, room);
		return text.length > room ? text.slice(0, room) : text;
	});
	budget.chars -= out.length;
	if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, draw the partial tree
	return out;
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

const compareValues = (a: unknown, b: unknown): number => {
	if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
	const left = scalarText(a);
	const right = scalarText(b);
	return left < right ? -1 : left > right ? 1 : 0;
};

// ttIf conditions: `equals` (legacy, string equality) or `op` + `value`.
const conditionHolds = (spec: Record<string, unknown>, value: unknown): boolean => {
	if (spec.equals !== undefined) return String(value) === String(spec.equals);
	const op = typeof spec.op === 'string' ? spec.op : '';
	const expected = spec.value;
	switch (op) {
		case 'eq':
			return isNumeric(value) && isNumeric(expected) ? Number(value) === Number(expected) : String(value ?? '') === String(expected ?? '');
		case 'ne':
			return !(isNumeric(value) && isNumeric(expected) ? Number(value) === Number(expected) : String(value ?? '') === String(expected ?? ''));
		case 'gt':
			return compareValues(value, expected) > 0;
		case 'gte':
			return compareValues(value, expected) >= 0;
		case 'lt':
			return compareValues(value, expected) < 0;
		case 'lte':
			return compareValues(value, expected) <= 0;
		case 'in':
			return Array.isArray(expected) ? expected.some((entry) => String(entry) === String(value)) : false;
		case 'includes':
			return Array.isArray(value) ? value.some((entry) => String(entry) === String(expected)) : scalarText(value).includes(scalarText(expected));
		case 'empty':
			return !truthy(value) && value !== 0 && value !== false;
		case 'notEmpty':
			return truthy(value) || value === 0 || value === false;
		default:
			return truthy(value);
	}
};

const ORDINALS = ['th', 'st', 'nd', 'rd'];
const ordinal = (n: number): string => {
	const v = Math.abs(Math.trunc(n)) % 100;
	return `${Math.trunc(n)}${ORDINALS[(v - 20) % 10] || ORDINALS[v] || ORDINALS[0]}`;
};

const formatValue = (spec: Record<string, unknown>, value: unknown): string => {
	const kind = typeof spec.kind === 'string' ? spec.kind : 'text';
	const digits = typeof spec.digits === 'number' ? Math.max(0, Math.min(6, Math.round(spec.digits))) : 0;
	if (kind === 'upper') return scalarText(value).toUpperCase();
	if (kind === 'lower') return scalarText(value).toLowerCase();
	if (kind === 'capitalize') {
		const text = scalarText(value);
		return text ? text[0].toUpperCase() + text.slice(1) : text;
	}
	if (kind === 'number' || kind === 'fixed' || kind === 'percent' || kind === 'ordinal') {
		if (!isNumeric(value)) return scalarText(value);
		const num = Number(value);
		if (kind === 'ordinal') return ordinal(num);
		if (kind === 'percent') return `${(num * 100).toFixed(digits)}%`;
		if (kind === 'fixed') return num.toFixed(digits);
		return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(num);
	}
	if (kind === 'date' || kind === 'time' || kind === 'datetime' || kind === 'weekday') {
		const date = new Date(scalarText(value));
		if (Number.isNaN(date.getTime())) return scalarText(value);
		const timeZone = typeof spec.timeZone === 'string' && spec.timeZone ? spec.timeZone : undefined;
		try {
			const options: Intl.DateTimeFormatOptions =
				kind === 'time'
					? { hour: 'numeric', minute: '2-digit' }
					: kind === 'datetime'
						? { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
						: kind === 'weekday'
							? { weekday: 'long' }
							: { year: 'numeric', month: 'long', day: 'numeric' };
			return new Intl.DateTimeFormat(undefined, { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
		} catch {
			return date.toISOString();
		}
	}
	if (kind === 'json') {
		try {
			return JSON.stringify(value);
		} catch {
			return '';
		}
	}
	return scalarText(value);
};

type ResolveBudget = { left: number; chars: number };

// Bound nested action-result data without interpreting it as template syntax.
// In particular, ttArg and ttFormat must not reopen the expansion bypass that
// was fixed for scalar arguments in the component library.
const resolveScopeValue = (value: unknown, budget: ResolveBudget, depth = 0, ancestors = new Set<object>()): unknown => {
	if (budget.left <= 0 || budget.chars <= 0 || depth > 48) return undefined;
	budget.left -= 1;
	if (typeof value === 'string') {
		const text = value.slice(0, budget.chars);
		budget.chars -= text.length;
		if (budget.chars <= 0) budget.left = 0;
		return text;
	}
	if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value;
	if (typeof value !== 'object' || ancestors.has(value)) return undefined;
	ancestors.add(value);
	const out: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
	for (const key of Object.keys(value)) {
		if (budget.left <= 0 || budget.chars <= 0) break;
		if (BANNED_SEGMENTS.has(key)) continue;
		if (!Array.isArray(out)) {
			if (key.length > budget.chars) break;
			budget.chars -= key.length;
		}
		const child = resolveScopeValue((value as Record<string, unknown>)[key], budget, depth + 1, ancestors);
		if (child !== undefined) {
			if (Array.isArray(out)) out.push(child);
			else out[key] = child;
		}
	}
	ancestors.delete(value);
	return out;
};

const resolveNode = (template: unknown, scope: ComponentScope, budget: ResolveBudget): unknown => {
	// budget exhausted → drop this subtree (arrays skip undefined entries and
	// the object branch skips undefined keys, so the partial tree stays valid)
	if (budget.left <= 0) return undefined;
	budget.left -= 1;

	if (typeof template === 'string') {
		if (template.includes('{')) return substitute(template, scope, budget);
		// EVERY string that lands in the tree is charged, including tokenless ones
		// returned by reference. Sharing makes the repeat free in memory, but not
		// on the ttAction path: JSON.stringify(ttActionInputs) below flattens each
		// shared reference into its own copy. Uncharged, one 28KB tokenless string
		// under 3 nested ttRepeats (28,854 bytes / 17 raw nodes / depth 8 — inside
		// every server cap) serialised to 104.7 MB while this budget still read as
		// unspent. Charging by occurrence bounds the serialised size too. The
		// object branch charges node KEYS on exactly the same grounds — a key is
		// tree text that JSON.stringify copies out per occurrence. Together the
		// catalog peaks at 6,611 chars, ~40x under MAX_RESOLVED_CHARS.
		budget.chars -= template.length;
		if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, draw the partial tree
		return template;
	}
	if (Array.isArray(template)) {
		const out: unknown[] = [];
		for (const entry of template) {
			if (budget.left <= 0) break;
			const resolved = resolveNode(entry, scope, budget);
			if (resolved === null || resolved === undefined) continue;
			if (Array.isArray(resolved)) out.push(...resolved);
			else out.push(resolved);
		}
		return out;
	}
	if (!isPlainObject(template)) return template;

	if ('ttArg' in template) {
		// A { ttArg } leaf drops an arg value straight into the tree, so it is
		// tree text exactly like the '{arg}' token it is the wrapper form of —
		// and it was the one branch that returned a value without charging for
		// it, so the budget metered tokens but not their ttArg twin. savedArgs
		// values run to MAX_COMPONENT_SAVED_ARG_CHARS (2000) and `component` is
		// not protected, so nested ttRepeat around a { ttArg } leaf bought
		// MAX_RESOLVED_NODES x 2000 chars: a 139-byte template (14 raw nodes,
		// depth 8 — inside every server cap) resolved to 7.66 MB, 29x over this
		// budget, and serialised the same again through ttActionInputs, while
		// the identical template with a '{a}' leaf stayed at 1.0x. Charged by
		// occurrence like the string branch above; the value is returned whole
		// rather than truncated, so the overshoot is one arg value at most.
		const value = argValue(scope, String(template.ttArg));
		if (value === undefined) return undefined;
		return resolveScopeValue(value, budget);
	}
	if ('ttMap' in template) {
		const spec = isPlainObject(template.ttMap) ? template.ttMap : {};
		const key = String(argValue(scope, String(spec.arg)));
		const values = isPlainObject(spec.values) ? spec.values : {};
		const picked = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : spec.default;
		return resolveNode(picked, scope, budget);
	}
	if ('ttIf' in template) {
		const spec = isPlainObject(template.ttIf) ? template.ttIf : {};
		const value = argValue(scope, String(spec.arg));
		const hit = conditionHolds(spec, value);
		const branch = hit ? spec.then : spec.else;
		return branch === undefined ? undefined : resolveNode(branch, scope, budget);
	}
	if ('ttFormat' in template) {
		const spec = isPlainObject(template.ttFormat) ? template.ttFormat : {};
		const value = resolveScopeValue(argValue(scope, String(spec.arg)), budget);
		return resolveScopeValue(formatValue(spec, value), budget);
	}
	if ('ttMerge' in template) {
		const parts = Array.isArray(template.ttMerge) ? template.ttMerge : [];
		const out: Record<string, unknown> = {};
		for (const part of parts) {
			if (budget.left <= 0) break;
			const resolved = resolveNode(part, scope, budget);
			if (isPlainObject(resolved)) Object.assign(out, resolved);
		}
		return out;
	}
	if ('ttRepeat' in template) {
		const spec = isPlainObject(template.ttRepeat) ? template.ttRepeat : {};
		const raw = spec.arg !== undefined ? argValue(scope, String(spec.arg)) : spec.count;
		const max = Math.min(Number(spec.max) || 0, REPEAT_HARD_CAP) || REPEAT_HARD_CAP;
		const n = Math.max(0, Math.min(Math.round(Number(raw) || 0), max));
		const out: unknown[] = [];
		for (let index = 0; index < n; index++) {
			if (budget.left <= 0) break;
			const resolved = resolveNode(spec.node, { ...scope, index, n: index + 1 }, budget);
			// a nested repeat resolves to a list — flatten it so the renderer sees
			// nodes, never lists of lists (a grid of rows of tiles)
			if (Array.isArray(resolved)) out.push(...resolved);
			else if (resolved !== null && resolved !== undefined) out.push(resolved);
		}
		return out;
	}
	if ('ttEach' in template) {
		// repeat `node` once per element of the list at `arg`, binding `item`
		// (the element), `index`, `n`, `count`, `first`, `last`. A non-list
		// (an object) iterates its own entries as { key, value } items. Falls
		// back to `empty` when there is nothing to draw.
		const spec = isPlainObject(template.ttEach) ? template.ttEach : {};
		const raw = argValue(scope, String(spec.arg));
		const list: unknown[] = Array.isArray(raw) ? raw : isPlainObject(raw) ? Object.entries(raw).map(([key, value]) => ({ key, value })) : [];
		// `max` is an optional author hint, and EACH_HARD_CAP is the bound that
		// has to hold for markup nobody vetted. ttRepeat above floors its count
		// with Math.max(0, …); this needed the same floor, because `max` lands in
		// slice() rather than in a loop bound: a NEGATIVE max counts from the END
		// of the list, so `max: -1` both dropped the last element and iterated
		// list.length - 1 times — past the cap, with MAX_RESOLVED_VALUES left as
		// the only guard. Anything that is not a positive integer (absent, 0,
		// NaN, negative) means "unset" and falls back to the cap.
		const requested = Math.trunc(Number(spec.max) || 0);
		const items = list.slice(0, requested > 0 ? Math.min(requested, EACH_HARD_CAP) : EACH_HARD_CAP);
		if (!items.length) return spec.empty === undefined ? undefined : resolveNode(spec.empty, scope, budget);
		const out: unknown[] = [];
		for (let index = 0; index < items.length; index++) {
			if (budget.left <= 0) break;
			const resolved = resolveNode(
				spec.node,
				{ ...scope, item: items[index], index, n: index + 1, count: items.length, first: index === 0, last: index === items.length - 1 },
				budget
			);
			if (Array.isArray(resolved)) out.push(...resolved);
			else if (resolved !== null && resolved !== undefined) out.push(resolved);
		}
		return out;
	}

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(template)) {
		if (budget.left <= 0) break;
		// ttAction/ttActionInputs are interactive-intent markers, folded into
		// allowlisted data-* props below — never copied through as node keys
		if (key === 'ttAction' || key === 'ttActionInputs') continue;
		const resolved = resolveNode(value, scope, budget);
		if (resolved === undefined) continue;
		// A node KEY is tree text exactly like a string value, and nothing else
		// bounds it: the render gate screens keys for dots/$/prototype names but
		// never for LENGTH, so a ~28KB key fits in a 32KB template, and nested
		// ttRepeat then re-materialises it once per iteration. Uncharged, that
		// serialised to a 52.2 MB data-tt-action-inputs string (28,160-byte
		// template, 15 raw nodes, depth 10 — inside every server cap) while the
		// char budget read 7 of 262,144 spent. Charge by occurrence, like the
		// string branch above, and the key path is bounded by the same budget.
		budget.chars -= key.length;
		if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, draw the partial tree
		out[key] = resolved;
	}
	// ttAction: '<actionKey-or-id>' on a node marks it as a runnable control.
	// It resolves to data-tt-action / data-tt-action-inputs attributes (the
	// ONLY two data-* props the sanitising renderers allowlist); an
	// onClickCapture wrapper on trusted surfaces reads them and calls the run
	// API AS THE VIEWER — a click grants no authority the viewer didn't
	// already have on /actions, and the executor's capability/budget envelope
	// still bounds the run. '{arg}' tokens substitute inside both.
	//
	// The key and the inputs subtree resolve on the SHARED budget: they are
	// attacker-shaped template like any other, and a fresh per-node budget
	// would let a hostile component nest its expansion under ttActionInputs and
	// multiply the whole-tree caps by the node count — see MAX_RESOLVED_NODES
	// and MAX_RESOLVED_CHARS.
	if (typeof template.ttAction === 'string' && template.ttAction.trim()) {
		const action = substitute(template.ttAction, scope, budget).trim();
		if (action) {
			const props = isPlainObject(out.props) ? (out.props as Record<string, unknown>) : {};
			props['data-tt-action'] = action;
			if (template.ttActionInputs !== undefined) {
				const inputs = resolveNode(template.ttActionInputs, scope, budget);
				if (isPlainObject(inputs)) {
					try {
						props['data-tt-action-inputs'] = JSON.stringify(inputs);
					} catch {}
				}
			}
			out.props = props;
		}
	}
	return out;
};

// One budget per top-level resolve — nested ttRepeat, ttActionInputs subtrees
// and sibling nodes all share it, so both total output COUNT and total
// allocated TEXT are bounded no matter how the wrappers are nested or how many
// tokens each string carries.
export const resolveTemplate = (template: unknown, scope: ComponentScope = {}): unknown =>
	resolveNode(template, scope, { left: MAX_RESOLVED_NODES, chars: MAX_RESOLVED_CHARS });

// ---------------------------------------------------------------------------

export const sanitizeArgSpecs = (raw: unknown): ComponentArgSpec[] => {
	if (!Array.isArray(raw)) return [];
	const specs: ComponentArgSpec[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry) || typeof entry.name !== 'string' || typeof entry.type !== 'string') continue;
		specs.push(entry as unknown as ComponentArgSpec);
	}
	return specs;
};

export const defaultsFromArgs = (args: ComponentArgSpec[]): ComponentArgValues => {
	const scope: ComponentArgValues = {};
	for (const spec of args) {
		scope[spec.name] = spec.default;
	}
	return scope;
};

// Coerce one tester input back into the arg's scalar space.
export const coerceArgValue = (spec: ComponentArgSpec, raw: string | boolean): ComponentArgScalar => {
	if (spec.type === 'boolean') return typeof raw === 'boolean' ? raw : raw === 'true';
	if (spec.type === 'number') {
		const value = Number(raw);
		if (!Number.isFinite(value)) return typeof spec.default === 'number' ? spec.default : 0;
		const min = typeof spec.min === 'number' ? spec.min : -Infinity;
		const max = typeof spec.max === 'number' ? spec.max : Infinity;
		return Math.min(max, Math.max(min, value));
	}
	const text = typeof raw === 'string' ? raw : String(raw);
	if (spec.type === 'enum') {
		return spec.values?.includes(text) ? text : spec.values?.[0] ?? '';
	}
	const cap = typeof spec.maxLength === 'number' ? spec.maxLength : 2000;
	return text.slice(0, cap);
};
