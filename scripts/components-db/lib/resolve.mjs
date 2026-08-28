// Canonical resolver for the component arg-template DSL. The client-side
// TypeScript twin lives at remix/app/components/ComponentsLibrary/
// componentTemplate.ts — keep semantics identical (this copy powers generator
// validation; that copy powers the live page).
//
// A template value resolves as:
//   string           → '{argName}' tokens substituted with String(arg value)
//   { ttArg }        → the raw arg value
//   { ttMap }        → values[String(arg value)] ?? default
//   { ttIf }         → equals given ? String(value)===String(equals) : truthy
//   { ttMerge }      → resolved entries shallow-merged (objects only)
//   { ttRepeat }     → node repeated n times (n from arg/count, capped by max,
//                      hard cap REPEAT_HARD_CAP); scope gains index (0-based)
//                      and n (1-based)
//   array            → entries resolved; null/undefined dropped
//   object           → every key resolved recursively
//
// Unknown-arg tokens resolve to '' (strings) / undefined (ttArg).

export const REPEAT_HARD_CAP = 24;

// Total resolved-value ceiling for ONE resolve, shared across every nested
// wrapper. Nested ttRepeat multiplies (24^depth), so a template that clears the
// server's raw-template caps can still explode on resolution — see the twin in
// remix/app/components/ComponentsLibrary/componentTemplate.ts for the full
// note. Once spent, expansion stops and the partial tree is returned.
export const MAX_RESOLVED_NODES = 4000;

const TOKEN_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

const substitute = (template, scope) =>
	template.replace(TOKEN_PATTERN, (match, name) => {
		const value = scope[name];
		if (value === undefined || value === null) return '';
		return String(value);
	});

const truthy = (value) => {
	if (typeof value === 'string') return value.trim() !== '' && value !== 'false' && value !== '0';
	return !!value;
};

const resolveNode = (template, scope, budget) => {
	// budget exhausted → drop this subtree (arrays skip undefined entries and
	// the object branch skips undefined keys, so the partial tree stays valid)
	if (budget.left <= 0) return undefined;
	budget.left -= 1;

	if (typeof template === 'string') {
		return template.includes('{') ? substitute(template, scope) : template;
	}
	if (Array.isArray(template)) {
		const out = [];
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
		return scope[template.ttArg];
	}
	if ('ttMap' in template) {
		const spec = template.ttMap || {};
		const key = String(scope[spec.arg]);
		const values = isPlainObject(spec.values) ? spec.values : {};
		const picked = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : spec.default;
		return resolveNode(picked, scope, budget);
	}
	if ('ttIf' in template) {
		const spec = template.ttIf || {};
		const value = scope[spec.arg];
		const hit = spec.equals !== undefined ? String(value) === String(spec.equals) : truthy(value);
		const branch = hit ? spec.then : spec.else;
		return branch === undefined ? undefined : resolveNode(branch, scope, budget);
	}
	if ('ttMerge' in template) {
		const parts = Array.isArray(template.ttMerge) ? template.ttMerge : [];
		const out = {};
		for (const part of parts) {
			if (budget.left <= 0) break;
			const resolved = resolveNode(part, scope, budget);
			if (isPlainObject(resolved)) Object.assign(out, resolved);
		}
		return out;
	}
	if ('ttRepeat' in template) {
		const spec = template.ttRepeat || {};
		const raw = spec.arg !== undefined ? scope[spec.arg] : spec.count;
		const max = Math.min(Number(spec.max) || 0, REPEAT_HARD_CAP) || REPEAT_HARD_CAP;
		const n = Math.max(0, Math.min(Math.round(Number(raw) || 0), max));
		const out = [];
		for (let index = 0; index < n; index++) {
			if (budget.left <= 0) break;
			const resolved = resolveNode(spec.node, { ...scope, index, n: index + 1 }, budget);
			if (resolved !== null && resolved !== undefined) out.push(resolved);
		}
		return out;
	}

	const out = {};
	for (const [key, value] of Object.entries(template)) {
		if (budget.left <= 0) break;
		const resolved = resolveNode(value, scope, budget);
		if (resolved !== undefined) out[key] = resolved;
	}
	return out;
};

// One budget per top-level resolve — nested ttRepeat shares it, so total output
// is bounded no matter how the wrappers are nested.
export const resolveTemplate = (template, scope = {}) => resolveNode(template, scope, { left: MAX_RESOLVED_NODES });

// Default arg values → the scope the tester starts from.
export const defaultsFromArgs = (args) => {
	const scope = {};
	for (const spec of args || []) {
		if (!spec || typeof spec.name !== 'string') continue;
		scope[spec.name] = spec.default;
	}
	return scope;
};
