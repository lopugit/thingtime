// Arg-template resolver for component things. A component's crystal.render is
// an HtmlThingNode/ChakraThingNode TEMPLATE: plain nodes plus tiny wrapper
// objects (ttArg / ttMap / ttIf / ttMerge / ttRepeat) and '{argName}' string
// tokens, resolved here against the tester's current args BEFORE the tree is
// drawn through the sanitising allowlist renderers. The canonical semantics
// twin lives at scripts/components-db/lib/resolve.mjs — keep them identical.

export const REPEAT_HARD_CAP = 24;

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

const substitute = (template: string, scope: ComponentArgValues): string =>
	template.replace(TOKEN_PATTERN, (_match, name: string) => {
		const value = scope[name];
		if (value === undefined || value === null) return '';
		return String(value);
	});

const truthy = (value: unknown): boolean => {
	if (typeof value === 'string') return value.trim() !== '' && value !== 'false' && value !== '0';
	return !!value;
};

export const resolveTemplate = (template: unknown, scope: ComponentArgValues = {}): unknown => {
	if (typeof template === 'string') {
		return template.includes('{') ? substitute(template, scope) : template;
	}
	if (Array.isArray(template)) {
		const out: unknown[] = [];
		for (const entry of template) {
			const resolved = resolveTemplate(entry, scope);
			if (resolved === null || resolved === undefined) continue;
			if (Array.isArray(resolved)) out.push(...resolved);
			else out.push(resolved);
		}
		return out;
	}
	if (!isPlainObject(template)) return template;

	if ('ttArg' in template) {
		return scope[String(template.ttArg)];
	}
	if ('ttMap' in template) {
		const spec = isPlainObject(template.ttMap) ? template.ttMap : {};
		const key = String(scope[String(spec.arg)]);
		const values = isPlainObject(spec.values) ? spec.values : {};
		const picked = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : spec.default;
		return resolveTemplate(picked, scope);
	}
	if ('ttIf' in template) {
		const spec = isPlainObject(template.ttIf) ? template.ttIf : {};
		const value = scope[String(spec.arg)];
		const hit = spec.equals !== undefined ? String(value) === String(spec.equals) : truthy(value);
		const branch = hit ? spec.then : spec.else;
		return branch === undefined ? undefined : resolveTemplate(branch, scope);
	}
	if ('ttMerge' in template) {
		const parts = Array.isArray(template.ttMerge) ? template.ttMerge : [];
		const out: Record<string, unknown> = {};
		for (const part of parts) {
			const resolved = resolveTemplate(part, scope);
			if (isPlainObject(resolved)) Object.assign(out, resolved);
		}
		return out;
	}
	if ('ttRepeat' in template) {
		const spec = isPlainObject(template.ttRepeat) ? template.ttRepeat : {};
		const raw = spec.arg !== undefined ? scope[String(spec.arg)] : spec.count;
		const max = Math.min(Number(spec.max) || 0, REPEAT_HARD_CAP) || REPEAT_HARD_CAP;
		const n = Math.max(0, Math.min(Math.round(Number(raw) || 0), max));
		const out: unknown[] = [];
		for (let index = 0; index < n; index++) {
			const resolved = resolveTemplate(spec.node, { ...scope, index, n: index + 1 });
			if (resolved !== null && resolved !== undefined) out.push(resolved);
		}
		return out;
	}

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(template)) {
		const resolved = resolveTemplate(value, scope);
		if (resolved !== undefined) out[key] = resolved;
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
