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

// REPEAT_HARD_CAP bounds ONE ttRepeat; it does not bound the PRODUCT across
// nested ones. `{ ttRepeat: { node: … } }` costs 2 levels of template depth
// and ~3 nodes, so the stored-crystal gates in schemas/registry.ts
// (MAX_SCHEMA_RENDER_DEPTH 48 / _NODES 2000 / _BYTES 48Ki) admit 24 nested
// repeats — depth binds first — while they expand to 24^24 values here. Those
// gates were raised for app-screen templates, so this bound grew with them:
// the budget below is what actually holds the line, not the crystal gates.
// The renderers' own 600-node budgets cannot help either: this resolver
// materialises the whole tree BEFORE they see it,
// so a hostile public component would hang the tab of everyone who opened
// /components. Resolution therefore carries ONE budget for the entire tree —
// once spent the remainder is dropped, degrading to a truncated preview
// instead of freezing the page. The cap sits far above what the renderers can
// draw at all (600 nodes), so no legitimate component can reach it.
export const MAX_RESOLVED_VALUES = 20000;

type ResolveBudget = { left: number };

export const newResolveBudget = (): ResolveBudget => ({ left: MAX_RESOLVED_VALUES });

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

const substitute = (template: string, scope: ComponentScope): string =>
	template.replace(TOKEN_PATTERN, (_match, name: string) => scalarText(argValue(scope, name)));

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

export const resolveTemplate = (
	template: unknown,
	scope: ComponentScope = {},
	budget: ResolveBudget = newResolveBudget()
): unknown => {
	// one shared budget for the whole tree — see MAX_RESOLVED_VALUES
	if (budget.left <= 0) return undefined;
	budget.left -= 1;

	if (typeof template === 'string') {
		return template.includes('{') ? substitute(template, scope) : template;
	}
	if (Array.isArray(template)) {
		const out: unknown[] = [];
		for (const entry of template) {
			if (budget.left <= 0) break;
			const resolved = resolveTemplate(entry, scope, budget);
			if (resolved === null || resolved === undefined) continue;
			if (Array.isArray(resolved)) out.push(...resolved);
			else out.push(resolved);
		}
		return out;
	}
	if (!isPlainObject(template)) return template;

	if ('ttArg' in template) {
		const value = argValue(scope, String(template.ttArg));
		return value === undefined ? undefined : value;
	}
	if ('ttMap' in template) {
		const spec = isPlainObject(template.ttMap) ? template.ttMap : {};
		const key = String(argValue(scope, String(spec.arg)));
		const values = isPlainObject(spec.values) ? spec.values : {};
		const picked = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : spec.default;
		return resolveTemplate(picked, scope, budget);
	}
	if ('ttIf' in template) {
		const spec = isPlainObject(template.ttIf) ? template.ttIf : {};
		const value = argValue(scope, String(spec.arg));
		const hit = conditionHolds(spec, value);
		const branch = hit ? spec.then : spec.else;
		return branch === undefined ? undefined : resolveTemplate(branch, scope, budget);
	}
	if ('ttFormat' in template) {
		const spec = isPlainObject(template.ttFormat) ? template.ttFormat : {};
		return formatValue(spec, argValue(scope, String(spec.arg)));
	}
	if ('ttMerge' in template) {
		const parts = Array.isArray(template.ttMerge) ? template.ttMerge : [];
		const out: Record<string, unknown> = {};
		for (const part of parts) {
			if (budget.left <= 0) break;
			const resolved = resolveTemplate(part, scope, budget);
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
			const resolved = resolveTemplate(spec.node, { ...scope, index, n: index + 1 }, budget);
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
		if (!items.length) return spec.empty === undefined ? undefined : resolveTemplate(spec.empty, scope, budget);
		const out: unknown[] = [];
		for (let index = 0; index < items.length; index++) {
			if (budget.left <= 0) break;
			const resolved = resolveTemplate(
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
		const resolved = resolveTemplate(value, scope, budget);
		if (resolved !== undefined) out[key] = resolved;
	}
	// ttAction: '<actionKey-or-id>' on a node marks it as a runnable control.
	// It resolves to data-tt-action / data-tt-action-inputs attributes (the
	// ONLY two data-* props the sanitising renderers allowlist); an
	// onClickCapture wrapper on trusted surfaces reads them and calls the run
	// API AS THE VIEWER — a click grants no authority the viewer didn't
	// already have on /actions, and the executor's capability/budget envelope
	// still bounds the run. '{arg}' tokens substitute inside both.
	//
	// The inputs subtree resolves on the SHARED budget: it is attacker-shaped
	// template like any other, and a fresh per-node budget would let a hostile
	// component nest its expansion under ttActionInputs and multiply the
	// whole-tree cap by the node count — see MAX_RESOLVED_VALUES.
	if (typeof template.ttAction === 'string' && template.ttAction.trim()) {
		const action = substitute(template.ttAction, scope).trim();
		if (action) {
			const props = isPlainObject(out.props) ? (out.props as Record<string, unknown>) : {};
			props['data-tt-action'] = action;
			if (template.ttActionInputs !== undefined) {
				const inputs = resolveTemplate(template.ttActionInputs, scope, budget);
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
