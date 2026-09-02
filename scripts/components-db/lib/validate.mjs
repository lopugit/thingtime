// Validation for component definitions: structural caps mirroring the server
// sanitizers (registry.ts sanitizeComponentCrystal + checkSchemaRenderTree)
// and the client HtmlThingRenderer allowlist — so nothing that generates
// clean here can be refused at seed time or render time.

import { defaultsFromArgs, resolveTemplate } from './resolve.mjs';

export const ALLOWED_TAGS = new Set([
	'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'button',
	'ul', 'ol', 'li', 'section', 'article', 'header', 'footer', 'nav', 'aside',
	'main', 'strong', 'em', 'small', 'code', 'pre', 'blockquote', 'hr', 'br',
	'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'label',
	'input', 'textarea', 'select', 'option', 'video', 'audio', 'svg', 'path',
	'circle', 'rect', 'line', 'polyline', 'polygon'
]);

export const ALLOWED_PROPS = new Set([
	'style', 'className', 'class', 'href', 'target', 'rel', 'src', 'alt', 'title',
	'width', 'height', 'type', 'placeholder', 'value', 'checked', 'disabled',
	'rows', 'cols', 'controls', 'loop', 'muted', 'poster', 'viewBox', 'fill',
	'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'd', 'cx', 'cy',
	'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'points', 'xmlns'
]);

const DSL_KEYS = new Set(['ttArg', 'ttMap', 'ttIf', 'ttMerge', 'ttRepeat']);
export const ARG_TYPES = new Set(['string', 'text', 'number', 'boolean', 'enum', 'color']);

export const MAX_RENDER_BYTES = 30 * 1024; // server cap is 32KB — keep headroom
export const MAX_RESOLVED_NODES = 550; // renderer cap is 600
// Resolved TEXT, counted in characters — the resolver's own ceiling is 256KB
// (MAX_RESOLVED_CHARS in resolve.mjs), so like the node cap above this sits
// well below it: a token-heavy archetype fails generation loudly instead of
// being silently truncated at render time. Measured at the args each component
// declares as defaults (what this validator resolves), the catalog peaks at
// 3,560 chars — 9x under this cap.
export const MAX_RESOLVED_CHARS = 32 * 1024;
export const MAX_DEPTH = 22; // renderer cap is 24
export const MAX_ARGS = 16;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ARG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

export const MAX_SERVER_TEMPLATE_NODES = 580; // server cap is 600 — keep headroom

// Mirror of the server's checkSchemaRenderTree accounting: EVERY value counts
// (object, array, string, number, boolean — style values included).
export const countServerRenderNodes = (value) => {
	let nodes = 1;
	if (Array.isArray(value)) {
		for (const entry of value) nodes += countServerRenderNodes(entry);
	} else if (value && typeof value === 'object') {
		for (const entry of Object.values(value)) nodes += countServerRenderNodes(entry);
	}
	return nodes;
};

// Walk the TEMPLATE tree (pre-resolution): key hygiene + DSL shape + collect
// referenced arg names.
const walkTemplate = (value, path, issues, argRefs, depth = 0) => {
	if (depth > MAX_DEPTH + 4) {
		issues.push(`${path}: template nesting too deep`);
		return;
	}
	if (typeof value === 'string') {
		for (const match of value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) argRefs.add(match[1]);
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((entry, index) => walkTemplate(entry, `${path}[${index}]`, issues, argRefs, depth + 1));
		return;
	}
	if (!isPlainObject(value)) return;

	const dslKeys = Object.keys(value).filter((key) => DSL_KEYS.has(key));
	if (dslKeys.length > 1) issues.push(`${path}: multiple DSL keys ${dslKeys.join('+')}`);
	if (dslKeys.length === 1) {
		const key = dslKeys[0];
		if (Object.keys(value).length > 1) issues.push(`${path}: ${key} node carries extra keys`);
		const spec = value[key];
		if (key === 'ttArg') {
			if (typeof spec !== 'string') issues.push(`${path}: ttArg must be a string`);
			else argRefs.add(spec);
			return;
		}
		if (key === 'ttMerge') {
			if (!Array.isArray(spec)) issues.push(`${path}: ttMerge must be an array`);
			else spec.forEach((entry, index) => walkTemplate(entry, `${path}[${index}]`, issues, argRefs, depth + 1));
			return;
		}
		if (!isPlainObject(spec)) {
			issues.push(`${path}: ${key} spec must be an object`);
			return;
		}
		if (key === 'ttMap') {
			if (typeof spec.arg !== 'string') issues.push(`${path}: ttMap.arg missing`);
			else argRefs.add(spec.arg);
			if (!isPlainObject(spec.values)) issues.push(`${path}: ttMap.values missing`);
			else Object.entries(spec.values).forEach(([k, v]) => walkTemplate(v, `${path}.values.${k}`, issues, argRefs, depth + 1));
			if (spec.default !== undefined) walkTemplate(spec.default, `${path}.default`, issues, argRefs, depth + 1);
		} else if (key === 'ttIf') {
			if (typeof spec.arg !== 'string') issues.push(`${path}: ttIf.arg missing`);
			else argRefs.add(spec.arg);
			if (spec.then === undefined) issues.push(`${path}: ttIf.then missing`);
			else walkTemplate(spec.then, `${path}.then`, issues, argRefs, depth + 1);
			if (spec.else !== undefined) walkTemplate(spec.else, `${path}.else`, issues, argRefs, depth + 1);
		} else if (key === 'ttRepeat') {
			if (spec.arg !== undefined && typeof spec.arg !== 'string') issues.push(`${path}: ttRepeat.arg must be a string`);
			if (spec.arg) argRefs.add(spec.arg);
			if (spec.arg === undefined && typeof spec.count !== 'number') issues.push(`${path}: ttRepeat needs arg or count`);
			if (typeof spec.max !== 'number' || spec.max < 1 || spec.max > 24) issues.push(`${path}: ttRepeat.max must be 1..24`);
			if (spec.node === undefined) issues.push(`${path}: ttRepeat.node missing`);
			else walkTemplate(spec.node, `${path}.node`, issues, argRefs, depth + 1);
		}
		return;
	}

	for (const [key, entry] of Object.entries(value)) {
		if (key.startsWith('$') || key.includes('.') || key.includes('\u0000')) {
			issues.push(`${path}: illegal key '${key}'`);
			continue;
		}
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			issues.push(`${path}: forbidden key '${key}'`);
			continue;
		}
		walkTemplate(entry, `${path}.${key}`, issues, argRefs, depth + 1);
	}
};

// Every string anywhere inside a value. Used for the resolved-TEXT tally
// below, which must see prop text too: walkResolved descends `children` only
// (that is the right mirror for the NODE count — HtmlThingRenderer's 600-node
// budget also only walks children), but the resolver charges its char budget
// for every substituted string wherever it sits, props included. Counting
// children alone, the highest reading anywhere in the catalog was 255 chars
// while the most text a component actually resolves to is 3,560 — so the cap
// below was watching a small fraction of the text it claims to bound, and a
// component whose tokens expand inside props spent none of it at all.
const textLength = (value) => {
	if (typeof value === 'string') return value.length;
	if (Array.isArray(value)) return value.reduce((sum, entry) => sum + textLength(entry), 0);
	if (value && typeof value === 'object') {
		return Object.values(value).reduce((sum, entry) => sum + textLength(entry), 0);
	}
	return 0;
};

// Walk a RESOLVED tree: allowlist tags/props, count nodes, measure depth,
// catch leftover DSL objects.
const walkResolved = (node, path, issues, state, depth = 0) => {
	state.nodes += 1;
	state.maxDepth = Math.max(state.maxDepth, depth);
	if (state.nodes > MAX_RESOLVED_NODES + 50 || depth > MAX_DEPTH + 2) return;

	if (typeof node === 'string') state.chars += node.length;
	if (typeof node === 'string' || typeof node === 'number' || node === null || node === undefined) return;
	if (Array.isArray(node)) {
		node.forEach((entry, index) => walkResolved(entry, `${path}[${index}]`, issues, state, depth));
		return;
	}
	if (!isPlainObject(node)) {
		issues.push(`${path}: unexpected resolved value ${typeof node}`);
		return;
	}
	if (Object.keys(node).some((key) => DSL_KEYS.has(key))) {
		issues.push(`${path}: unresolved DSL object survived resolution`);
		return;
	}
	const tag = String(node.tag || 'div').toLowerCase();
	if (!ALLOWED_TAGS.has(tag)) issues.push(`${path}: tag '${tag}' not allowlisted`);
	if (node.props !== undefined) {
		if (!isPlainObject(node.props)) issues.push(`${path}: props must be an object`);
		else {
			// prop text is charged by the resolver, so it is charged here too —
			// style values, alt/title, and SVG `d` path data are all token sinks
			state.chars += textLength(node.props);
			for (const key of Object.keys(node.props)) {
				if (!ALLOWED_PROPS.has(key)) issues.push(`${path}: prop '${key}' not allowlisted`);
			}
			if (node.props.style !== undefined && !isPlainObject(node.props.style)) {
				issues.push(`${path}: style must resolve to an object`);
			}
		}
	}
	const children = node.children;
	if (children !== undefined) {
		const list = Array.isArray(children) ? children : [children];
		list.forEach((child, index) => walkResolved(child, `${path}>${tag}[${index}]`, issues, state, depth + 1));
	}
};

export const validateDefinition = (def) => {
	const issues = [];
	if (!isPlainObject(def)) return ['definition is not an object'];
	const label = def.slug || '(unnamed)';

	if (typeof def.slug !== 'string' || !SLUG_PATTERN.test(def.slug)) issues.push(`${label}: bad slug`);
	if (typeof def.name !== 'string' || !def.name.trim() || def.name.length > 60) issues.push(`${label}: bad name`);
	if (typeof def.library !== 'string') issues.push(`${label}: missing library`);
	if (def.slug && def.library && !def.slug.startsWith(`${def.library}-`)) issues.push(`${label}: slug must start with '<library>-'`);
	if (typeof def.category !== 'string' || !def.category.trim()) issues.push(`${label}: missing category`);
	if (typeof def.description !== 'string' || def.description.length < 20 || def.description.length > 500) {
		issues.push(`${label}: description must be 20..500 chars`);
	}
	if (!Array.isArray(def.tags) || def.tags.some((tag) => typeof tag !== 'string')) issues.push(`${label}: bad tags`);

	const args = Array.isArray(def.args) ? def.args : [];
	if (!Array.isArray(def.args)) issues.push(`${label}: args must be an array`);
	if (args.length > MAX_ARGS) issues.push(`${label}: too many args (${args.length} > ${MAX_ARGS})`);
	const argNames = new Set();
	for (const spec of args) {
		if (!isPlainObject(spec) || typeof spec.name !== 'string' || !ARG_NAME_PATTERN.test(spec.name)) {
			issues.push(`${label}: bad arg name ${spec?.name}`);
			continue;
		}
		if (argNames.has(spec.name)) issues.push(`${label}: duplicate arg ${spec.name}`);
		argNames.add(spec.name);
		if (!ARG_TYPES.has(spec.type)) issues.push(`${label}: arg ${spec.name} has bad type ${spec.type}`);
		if (spec.type === 'enum' && (!Array.isArray(spec.values) || !spec.values.length)) {
			issues.push(`${label}: enum arg ${spec.name} needs values`);
		}
		if (spec.default === undefined) issues.push(`${label}: arg ${spec.name} needs a default`);
		if (spec.type === 'enum' && Array.isArray(spec.values) && !spec.values.includes(spec.default)) {
			issues.push(`${label}: enum arg ${spec.name} default not in values`);
		}
	}

	if (def.render === undefined) {
		issues.push(`${label}: missing render`);
		return issues;
	}

	const bytes = Buffer.byteLength(JSON.stringify(def.render), 'utf8');
	if (bytes > MAX_RENDER_BYTES) issues.push(`${label}: render is ${bytes} bytes (> ${MAX_RENDER_BYTES})`);

	// The SERVER's checkSchemaRenderTree counts every JSON value in the raw
	// template (each style value is a node) with a hard 600 cap — mirror it
	// with headroom so nothing that generates clean is refused at seed time.
	const serverNodes = countServerRenderNodes(def.render);
	if (serverNodes > MAX_SERVER_TEMPLATE_NODES) {
		issues.push(`${label}: template has ${serverNodes} raw JSON nodes (> ${MAX_SERVER_TEMPLATE_NODES}; server cap 600)`);
	}

	const argRefs = new Set();
	walkTemplate(def.render, `${label}.render`, issues, argRefs);
	for (const ref of argRefs) {
		if (ref === 'index' || ref === 'n') continue; // ttRepeat scope injections
		if (!argNames.has(ref)) issues.push(`${label}: template references undeclared arg '${ref}'`);
	}

	const resolved = resolveTemplate(def.render, defaultsFromArgs(args));
	const state = { nodes: 0, maxDepth: 0, chars: 0 };
	walkResolved(resolved, label, issues, state);
	if (state.nodes > MAX_RESOLVED_NODES) issues.push(`${label}: resolves to ${state.nodes} nodes (> ${MAX_RESOLVED_NODES})`);
	if (state.maxDepth > MAX_DEPTH) issues.push(`${label}: resolves ${state.maxDepth} deep (> ${MAX_DEPTH})`);
	if (state.chars > MAX_RESOLVED_CHARS) {
		issues.push(`${label}: resolves to ${state.chars} chars of text (> ${MAX_RESOLVED_CHARS})`);
	}

	return issues;
};
