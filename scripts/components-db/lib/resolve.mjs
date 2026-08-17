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

export const resolveTemplate = (template, scope = {}) => {
	if (typeof template === 'string') {
		return template.includes('{') ? substitute(template, scope) : template;
	}
	if (Array.isArray(template)) {
		const out = [];
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
		return scope[template.ttArg];
	}
	if ('ttMap' in template) {
		const spec = template.ttMap || {};
		const key = String(scope[spec.arg]);
		const values = isPlainObject(spec.values) ? spec.values : {};
		const picked = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : spec.default;
		return resolveTemplate(picked, scope);
	}
	if ('ttIf' in template) {
		const spec = template.ttIf || {};
		const value = scope[spec.arg];
		const hit = spec.equals !== undefined ? String(value) === String(spec.equals) : truthy(value);
		const branch = hit ? spec.then : spec.else;
		return branch === undefined ? undefined : resolveTemplate(branch, scope);
	}
	if ('ttMerge' in template) {
		const parts = Array.isArray(template.ttMerge) ? template.ttMerge : [];
		const out = {};
		for (const part of parts) {
			const resolved = resolveTemplate(part, scope);
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
			const resolved = resolveTemplate(spec.node, { ...scope, index, n: index + 1 });
			if (resolved !== null && resolved !== undefined) out.push(resolved);
		}
		return out;
	}

	const out = {};
	for (const [key, value] of Object.entries(template)) {
		const resolved = resolveTemplate(value, scope);
		if (resolved !== undefined) out[key] = resolved;
	}
	return out;
};

// Default arg values → the scope the tester starts from.
export const defaultsFromArgs = (args) => {
	const scope = {};
	for (const spec of args || []) {
		if (!spec || typeof spec.name !== 'string') continue;
		scope[spec.name] = spec.default;
	}
	return scope;
};
