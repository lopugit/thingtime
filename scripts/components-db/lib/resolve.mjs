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

// Total resolved-TEXT ceiling for ONE resolve, shared like the node budget. The
// node budget bounds how many values a resolve produces, not how many
// characters: one stored string can carry thousands of '{arg}' tokens, each
// resolving to an arg value up to 2000 chars, so the ~4000 string nodes the
// node budget still permits can materialise gigabytes of text. See the twin in
// remix/app/components/ComponentsLibrary/componentTemplate.ts for the measured
// numbers. Every string in the tree is charged by occurrence, tokenless ones
// included: sharing makes a repeated string free in memory, but not once the
// tree is serialised — see that twin's resolveNode. Node KEYS are charged for
// the same reason and are bounded by nothing else: the render gate screens keys
// for dots/$/prototype names but never for LENGTH.
export const MAX_RESOLVED_CHARS = 256 * 1024;

const TOKEN_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// Scope lookups must not fall through to Object.prototype — arg names admit
// `constructor`, `toString`, … so a bare scope[name] would resolve an
// UNDECLARED token to a native function instead of the documented '' /
// undefined.
const argValue = (scope, name) => (Object.prototype.hasOwnProperty.call(scope, name) ? scope[name] : undefined);

const substitute = (template, scope, budget) => {
	let interpolated = 0;
	const out = template.replace(TOKEN_PATTERN, (match, name) => {
		const value = argValue(scope, name);
		if (value === undefined || value === null) return '';
		// clamp to what the budget can still pay for, so an oversized string is
		// never built in the first place
		const room = budget.chars - interpolated;
		if (room <= 0) return '';
		const text = String(value);
		interpolated += Math.min(text.length, room);
		return text.length > room ? text.slice(0, room) : text;
	});
	budget.chars -= out.length;
	if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, return the partial tree
	return out;
};

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
		if (template.includes('{')) return substitute(template, scope, budget);
		// charged by OCCURRENCE even though it is returned by reference — see the
		// twin's resolveNode: sharing is free in memory but not once the tree is
		// serialised, and this resolver must stay semantically identical to it
		budget.chars -= template.length;
		if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, return the partial tree
		return template;
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
		// charged by occurrence like every string above — a { ttArg } leaf is the
		// wrapper form of an '{arg}' token, so it is tree text too. See the twin's
		// resolveNode: uncharged, nested ttRepeat around a { ttArg } leaf resolved
		// a 139-byte template to 7.66 MB, 29x over MAX_RESOLVED_CHARS.
		const value = argValue(scope, template.ttArg);
		if (value === undefined) return undefined;
		budget.chars -= typeof value === 'string' ? value.length : String(value).length;
		if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, return the partial tree
		return value;
	}
	if ('ttMap' in template) {
		const spec = template.ttMap || {};
		const key = String(argValue(scope, spec.arg));
		const values = isPlainObject(spec.values) ? spec.values : {};
		const picked = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : spec.default;
		return resolveNode(picked, scope, budget);
	}
	if ('ttIf' in template) {
		const spec = template.ttIf || {};
		const value = argValue(scope, spec.arg);
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
		const raw = spec.arg !== undefined ? argValue(scope, spec.arg) : spec.count;
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
		if (resolved === undefined) continue;
		// keys are tree text too — charged by occurrence like every string above
		budget.chars -= key.length;
		if (budget.chars <= 0) budget.left = 0; // spent → stop expanding, return the partial tree
		out[key] = resolved;
	}
	return out;
};

// One budget per top-level resolve — nested ttRepeat shares it, so both total
// output COUNT and total allocated TEXT are bounded no matter how the wrappers
// are nested or how many tokens each string carries.
export const resolveTemplate = (template, scope = {}) =>
	resolveNode(template, scope, { left: MAX_RESOLVED_NODES, chars: MAX_RESOLVED_CHARS });

// Default arg values → the scope the tester starts from.
export const defaultsFromArgs = (args) => {
	const scope = {};
	for (const spec of args || []) {
		if (!spec || typeof spec.name !== 'string') continue;
		scope[spec.name] = spec.default;
	}
	return scope;
};
