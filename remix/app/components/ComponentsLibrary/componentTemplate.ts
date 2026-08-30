// Arg-template resolver for component things. A component's crystal.render is
// an HtmlThingNode/ChakraThingNode TEMPLATE: plain nodes plus tiny wrapper
// objects (ttArg / ttMap / ttIf / ttMerge / ttRepeat) and '{argName}' string
// tokens, resolved here against the tester's current args BEFORE the tree is
// drawn through the sanitising allowlist renderers. The canonical semantics
// twin lives at scripts/components-db/lib/resolve.mjs — keep them identical,
// INCLUDING the MAX_RESOLVED_VALUES expansion budget below. That generator
// ships separately from this runtime, so it needs the same guard when it lands.

export const REPEAT_HARD_CAP = 24;

// REPEAT_HARD_CAP bounds ONE ttRepeat; it does not bound the PRODUCT across
// nested ones. `{ ttRepeat: { node: … } }` costs 2 levels of template depth
// and ~3 nodes, so 11 nested repeats still pass the stored-crystal gates in
// schemas/registry.ts (MAX_SCHEMA_RENDER_DEPTH 24 / _NODES 600 / _BYTES 32Ki)
// while expanding to 24^11 values here. The renderers' own 600-node budgets
// cannot help: this resolver materialises the whole tree BEFORE they see it,
// so a hostile public component would hang the tab of everyone who opened
// /components. Resolution therefore carries ONE budget for the entire tree —
// once spent the remainder is dropped, degrading to a truncated preview
// instead of freezing the page. The cap sits far above what the renderers can
// draw at all (600 nodes), so no legitimate component can reach it.
export const MAX_RESOLVED_VALUES = 20000;

type ResolveBudget = { left: number };

export const newResolveBudget = (): ResolveBudget => ({ left: MAX_RESOLVED_VALUES });

const TOKEN_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

// Scope is a plain object literal, so a bare `scope[name]` also reaches
// Object.prototype: an arg name of `constructor`/`toString`/`valueOf` resolved
// to a native function instead of "undeclared arg". Own-property only, the
// same guard ttMap already applies to its `values` table.
const argValue = (scope: ComponentArgValues, name: string): ComponentArgScalar | undefined =>
	Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : undefined;

const substitute = (template: string, scope: ComponentArgValues): string =>
	template.replace(TOKEN_PATTERN, (_match, name: string) => {
		const value = argValue(scope, name);
		if (value === undefined || value === null) return '';
		return String(value);
	});

const truthy = (value: unknown): boolean => {
	if (typeof value === 'string') return value.trim() !== '' && value !== 'false' && value !== '0';
	return !!value;
};

export const resolveTemplate = (
	template: unknown,
	scope: ComponentArgValues = {},
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
		return argValue(scope, String(template.ttArg));
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
		const hit = spec.equals !== undefined ? String(value) === String(spec.equals) : truthy(value);
		const branch = hit ? spec.then : spec.else;
		return branch === undefined ? undefined : resolveTemplate(branch, scope, budget);
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
			if (resolved !== null && resolved !== undefined) out.push(resolved);
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
