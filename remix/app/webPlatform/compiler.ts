import type { PlatformProgram } from './types';
import { validateLiveDOMBinding } from './liveDOM';
const identifier = (value: unknown) => {
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(value) ||
		['eval', 'Function', 'AsyncFunction', 'GeneratorFunction', 'importScripts', 'self', 'globalThis', 'postMessage', 'close', '__ttDom'].includes(
			value
		)
	)
		throw new Error('Use a supported identifier');
	return value;
};
const quoted = (v: unknown) => {
	const s = JSON.stringify(v);
	if (s === undefined) throw new Error('Expected JSON data');
	return s
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
};
const operators = new Set([
	'+',
	'-',
	'*',
	'/',
	'%',
	'**',
	'===',
	'!==',
	'==',
	'!=',
	'<',
	'<=',
	'>',
	'>=',
	'&&',
	'||',
	'??',
	'&',
	'|',
	'^',
	'<<',
	'>>',
	'>>>',
	'in',
	'instanceof'
]);
const unary = new Set(['!', '~', '+', '-', 'typeof', 'void']);
export function validatePlatformProgram(raw: unknown): PlatformProgram {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected a Web Platform program');
	const p = raw as PlatformProgram;
	if (p.version !== 1 || typeof p.title !== 'string' || p.title.length > 200) throw new Error('Unsupported Web Platform program version or title');
	if (JSON.stringify(p).length > 24576) throw new Error('Program exceeds 24 KB');
	if (p.allowFormEvents !== undefined && typeof p.allowFormEvents !== 'boolean') throw new Error('Expected a boolean form event context');
	if (
		(p.parameters && !Array.isArray(p.parameters)) ||
		(p.steps && !Array.isArray(p.steps)) ||
		(p.document && !Array.isArray(p.document)) ||
		(p.styles && !Array.isArray(p.styles)) ||
		(p.dom && !Array.isArray(p.dom))
	)
		throw new Error('Program collections must be arrays');
	if ((p.parameters?.length || 0) > 16 || (p.steps?.length || 0) > 100 || (p.dom?.length || 0) > 40)
		throw new Error('Program exceeds its operation budget');
	for (const operation of p.dom || []) validateLiveDOMBinding(operation);
	const parameterNames = new Set<string>();
	for (const param of p.parameters || []) {
		identifier(param.name);
		if (typeof param.label !== 'string' || param.label.length > 160 || parameterNames.has(param.name))
			throw new Error('Use unique parameter names and text labels');
		parameterNames.add(param.name);
		if (!['text', 'number', 'boolean', 'json'].includes(param.type)) throw new Error('Unsupported parameter type');
	}
	if (
		p.requires !== undefined &&
		(!Array.isArray(p.requires) ||
			p.requires.length > 32 ||
			p.requires.some(
				(path) =>
					!Array.isArray(path) ||
					!path.length ||
					path.length > 8 ||
					path.some((part) => typeof part !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(part) || ['__proto__', 'constructor'].includes(part))
			))
	)
		throw new Error('Expected bounded feature availability paths');
	return p;
}
/** Data-only ECMAScript authoring. No source-code escape, eval, arbitrary import,
 * or string concatenation of identifiers. The output runs ONLY in an opaque
 * frame's throwaway worker with network/storage denied and a hard deadline. */
export function compilePlatformProgram(raw: unknown): string {
	const p = validatePlatformProgram(raw);
	let budget = 1000;
	const checkpoint = (depth: number) => {
		if (--budget < 0 || depth > 28) throw new Error('Expression exceeds its complexity budget');
	};
	const has = (node: any, key: string) => Object.prototype.hasOwnProperty.call(node, key);
	const isPattern = (node: any) => node && ['array-pattern', 'object-pattern'].includes(node.op);
	/** Patterns emit native syntax so defaults, iterator closing, property order
	 * and lexical binding semantics stay with the engine. They share the same
	 * expression budget and never accept source fragments. */
	const pattern = (node: any, depth: number, assignment = false, defaults = false): string => {
		checkpoint(depth);
		if (typeof node === 'string') return identifier(node);
		if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Expected a binding pattern');
		if (node.op === 'default-pattern') {
			if (!defaults) throw new Error('A default is only allowed on a pattern element');
			return `${pattern(node.target, depth + 1, assignment)}=${expr(node.value, depth + 1)}`;
		}
		if (node.op === 'array-pattern') {
			if (!Array.isArray(node.items) || node.items.length > 100) throw new Error('Expected bounded array pattern items');
			let items = node.items.map((item: any) => (item === null ? '' : pattern(item, depth + 1, assignment, true))).join(',');
			// A final elision needs its own comma: [x,] does not skip an item.
			if (has(node, 'rest')) items += `${node.items.length ? ',' : ''}...${pattern(node.rest, depth + 1, assignment)}`;
			else if (node.items.at(-1) === null) items += ',';
			return `[${items}]`;
		}
		if (node.op === 'object-pattern') {
			if (!Array.isArray(node.entries) || node.entries.length > 100) throw new Error('Expected bounded object pattern entries');
			const entries = node.entries.map((entry: any) => {
				checkpoint(depth + 1);
				if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Expected an object pattern entry');
				if (entry.computed !== undefined && typeof entry.computed !== 'boolean') throw new Error('Expected a computed-key flag');
				if (
					entry.computed !== true &&
					!((typeof entry.key === 'string' && entry.key.length <= 200) || (typeof entry.key === 'number' && Number.isFinite(entry.key)))
				)
					throw new Error('Expected a bounded property key');
				if (['constructor', '__proto__', 'eval'].includes(entry.key)) throw new Error('Dynamic code constructors are unavailable');
				const key = entry.computed === true ? expr(entry.key, depth + 1) : quoted(String(entry.key));
				return `[${key}]:${pattern(entry.target, depth + 1, assignment, true)}`;
			});
			if (has(node, 'rest')) {
				if (isPattern(node.rest) || node.rest?.op === 'default-pattern') throw new Error('Object rest requires a simple target');
				entries.push(`...${pattern(node.rest, depth + 1, assignment)}`);
			}
			return `{${entries.join(',')}}`;
		}
		if (assignment && ['variable', 'get', 'private-get', 'super-get'].includes(node.op) && !node.optional) return expr(node, depth + 1);
		throw new Error('Expected a binding pattern or assignment target');
	};
	const binding = (node: any, depth: number, assignment = false): string => {
		if (has(node, 'pattern') && has(node, 'name')) throw new Error('Choose a name or a pattern');
		return has(node, 'pattern') ? pattern(node.pattern, depth + 1, assignment) : identifier(node.name);
	};
	const parameters = (list: any[], depth: number): string => {
		if (!Array.isArray(list) || list.length > 16) throw new Error('Expected bounded parameters');
		return list
			.map((p, index) => {
				checkpoint(depth);
				if (typeof p === 'string') return identifier(p);
				if (!p || typeof p !== 'object') throw new Error('Expected a parameter');
				const name = binding(p, depth + 1);
				if (p.rest === true) {
					if (index !== list.length - 1 || Object.prototype.hasOwnProperty.call(p, 'default'))
						throw new Error('Rest parameters must be last and have no default');
					return `...${name}`;
				}
				return Object.prototype.hasOwnProperty.call(p, 'default') ? `${name}=${expr(p.default, depth + 1)}` : name;
			})
			.join(',');
	};
	const classSource = (node: any, depth: number, declaration = false): string => {
		checkpoint(depth);
		if (!Array.isArray(node.members) || node.members.length > 40) throw new Error('Expected bounded class members');
		const name = node.name === undefined && !declaration ? '' : ` ${identifier(node.name)}`;
		const heritage = node.extends === undefined ? '' : ` extends (${expr(node.extends, depth + 1)})`;
		const members = node.members
			.map((member: any) => {
				checkpoint(depth + 1);
				if (!member || typeof member !== 'object') throw new Error('Expected a class member');
				if (member.kind === 'static-block') return `static{${steps(member.body || [], depth + 1)}}`;
				const prefix = member.static === true ? 'static ' : '';
				if (member.kind !== 'constructor' && member.computed !== true && (typeof member.name !== 'string' || member.name.length > 200))
					throw new Error('Expected a bounded member name');
				if (member.private === true && (member.name === 'constructor' || member.computed === true)) throw new Error('Invalid private name');
				const key =
					member.private === true
						? `#${identifier(member.name)}`
						: `[${member.computed === true ? expr(member.key, depth + 1) : quoted(String(member.name))}]`;
				if (member.kind === 'field')
					return `${prefix}${key}${Object.prototype.hasOwnProperty.call(member, 'value') ? `=${expr(member.value, depth + 1)}` : ''};`;
				if (!['constructor', 'method', 'get', 'set'].includes(member.kind)) throw new Error('Unsupported class member');
				const args = parameters(member.params || [], depth + 1);
				if (member.kind === 'constructor') {
					if (member.static || member.private || member.async || member.generator) throw new Error('Invalid constructor modifiers');
					return `constructor(${args}){${steps(member.body || [], depth + 1)}}`;
				}
				if (['get', 'set'].includes(member.kind)) {
					// A rest parameter satisfies the setter arity check but is illegal source.
					if (
						member.async ||
						member.generator ||
						(member.params || []).length !== (member.kind === 'get' ? 0 : 1) ||
						(member.params || []).some((p: any) => p && p.rest === true)
					)
						throw new Error('Invalid accessor parameters or modifiers');
					return `${prefix}${member.kind} ${key}(${args}){${steps(member.body || [], depth + 1)}}`;
				}
				return `${prefix}${member.async === true ? 'async ' : ''}${member.generator === true ? '*' : ''}${key}(${args}){${steps(
					member.body || [],
					depth + 1
				)}}`;
			})
			.join('\n');
		return `class${name}${heritage}{${members}}`;
	};
	const expr = (node: any, depth = 0): string => {
		checkpoint(depth);
		if (node === null || typeof node !== 'object' || Array.isArray(node)) return quoted(node);
		const e = (n: any) => expr(n, depth + 1),
			args = (n: any) => {
				if (!Array.isArray(n) || n.length > 100) throw new Error('Expected bounded arguments');
				return n.map(e).join(',');
			};
		switch (node.op) {
			case 'dom':
				if (!['document', 'get', 'set', 'call'].includes(node.action)) throw new Error('Unsupported DOM action');
				if (node.action !== 'document' && (typeof node.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(node.key)))
					throw new Error('Expected a DOM member name');
				return `__ttDom(${quoted(node.action)},${node.action === 'document' ? 'null' : e(node.target)},${quoted(node.key || '')},[${args(
					node.args || []
				)}])`;
			case 'this':
				return 'this';
			case 'new-target':
				return 'new.target';
			case 'super-get':
				return `super[${e(node.key)}]`;
			case 'super-call':
				return `super(${args(node.args || [])})`;
			case 'private-get':
				return `(${e(node.target)}).#${identifier(node.name)}`;
			case 'private-in':
				return `(#${identifier(node.name)} in (${e(node.target)}))`;
			case 'class':
				return `(${classSource(node, depth + 1)})`;
			case 'function-expression':
				return `(${node.async === true ? 'async ' : ''}function${node.generator === true ? '*' : ''}${
					node.name === undefined ? '' : ` ${identifier(node.name)}`
				}(${parameters(node.params || [], depth + 1)}){${steps(node.body || [], depth + 1)}})`;
			case 'yield':
				return `(yield${node.delegate === true ? '*' : ''} ${e(node.value)})`;
			case 'assign-expression': {
				const target = node.target;
				if (isPattern(target)) {
					if ((node.operator || '=') !== '=') throw new Error('Destructuring requires plain assignment');
					return `(${pattern(target, depth + 1, true)}=${e(node.value)})`;
				}
				if (!target || !['variable', 'get', 'private-get', 'super-get'].includes(target.op) || target.optional)
					throw new Error('Expected an assignable reference');
				if (!['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??='].includes(node.operator || '='))
					throw new Error('Unsupported assignment operator');
				return `(${e(target)} ${node.operator || '='} ${e(node.value)})`;
			}
			case 'update':
				if (!node.target || !['variable', 'get', 'private-get', 'super-get'].includes(node.target.op) || node.target.optional)
					throw new Error('Expected an update reference');
				if (!['++', '--'].includes(node.operator)) throw new Error('Unsupported update operator');
				return node.prefix === true ? `(${node.operator}${e(node.target)})` : `(${e(node.target)}${node.operator})`;
			case 'delete':
				if (!node.target || node.target.op !== 'get') throw new Error('Delete requires an object property');
				return `(delete ${e(node.target)})`;
			case 'sequence':
				if (!Array.isArray(node.items) || node.items.length === 0) throw new Error('Expected sequence expressions');
				return `(${args(node.items)})`;
			case 'group':
				return `(${e(node.value)})`;
			case 'template-literal':
			case 'tagged-template': {
				if (
					!Array.isArray(node.strings) ||
					!Array.isArray(node.values) ||
					node.strings.length !== node.values.length + 1 ||
					node.strings.length > 100 ||
					node.strings.some((s: unknown) => typeof s !== 'string')
				)
					throw new Error('Expected bounded template segments and substitutions');
				// Escape backslashes before template delimiters. Control characters and
				// UTF-16 surrogates use JSON escapes, preserving even lone surrogates.
				const escape = (s: string) =>
					s
						.replace(/\\/g, '\\\\')
						.replace(/`/g, '\\`')
						.replace(/\$\{/g, '\\${')
						// Control characters must be escaped in generated template source.
						// eslint-disable-next-line no-control-regex
						.replace(/[\u0000-\u001f<\u2028\u2029\ud800-\udfff]/g, (character) => quoted(character).slice(1, -1));
				const body = node.strings
					.map((s: string, i: number) => escape(s) + (i < node.values.length ? '${(' + e(node.values[i]) + ')}' : ''))
					.join('');
				return (node.op === 'tagged-template' ? `(${e(node.tag)})` : '') + '`' + body + '`';
			}
			case 'literal':
				return quoted(node.value);
			case 'input':
				return `input[${quoted(identifier(node.name))}]`;
			case 'variable':
			case 'global':
				return identifier(node.name);
			case 'undefined':
				return 'undefined';
			case 'bigint':
				if (!/^-?\d{1,1000}$/.test(node.value)) throw new Error('Invalid BigInt');
				return `BigInt(${quoted(node.value)})`;
			case 'get':
				if (['constructor', '__proto__'].includes(node.key)) throw new Error('Dynamic code constructors are unavailable');
				return `(${e(node.target)})${node.optional === true ? '?.' : ''}[${e(node.key)}]`;
			case 'call':
				return `(${e(node.target)})(${args(node.args || [])})`;
			case 'method':
				if (['constructor', '__proto__', 'eval'].includes(node.key)) throw new Error('Dynamic code constructors are unavailable');
				return `(${e(node.target)})[${quoted(String(node.key))}](${args(node.args || [])})`;
			case 'new':
				return `new (${e(node.target)})(${args(node.args || [])})`;
			case 'array':
				return `[${args(node.items || [])}]`;
			case 'object':
				if (!Array.isArray(node.entries)) throw new Error('Expected object entries');
				return `({${node.entries.map((v: any) => `[${quoted(String(v[0]))}]:${e(v[1])}`).join(',')}})`;
			case 'binary':
				if (!operators.has(node.operator)) throw new Error('Unsupported operator');
				return `(${e(node.left)} ${node.operator} ${e(node.right)})`;
			case 'unary':
				if (!unary.has(node.operator)) throw new Error('Unsupported unary operator');
				return `(${node.operator} ${e(node.value)})`;
			case 'conditional':
				return `(${e(node.test)}?${e(node.then)}:${e(node.else)})`;
			case 'await':
				return `(await ${e(node.value)})`;
			case 'spread':
				return `...${e(node.value)}`;
			case 'function':
				return `(${node.async ? 'async ' : ''}(${parameters(node.params, depth + 1)})=>${
					node.body === undefined ? e(node.value) : `{${steps(node.body, depth + 1)}}`
				})`;
			case 'regex':
				if (typeof node.pattern !== 'string' || node.pattern.length > 1000 || !/^[dgimsuvy]*$/.test(node.flags || ''))
					throw new Error('Invalid regular expression');
				return `new RegExp(${quoted(node.pattern)},${quoted(node.flags || '')})`;
			case 'template':
				if (!Array.isArray(node.parts)) throw new Error('Expected template parts');
				return `[${args(node.parts)}].join('')`;
			default:
				throw new Error(`Unknown expression: ${String(node.op).slice(0, 40)}`);
		}
	};
	const steps = (list: any[], depth = 0): string => {
		checkpoint(depth);
		if (!Array.isArray(list) || list.length > 100) throw new Error('Expected statements');
		return list
			.map((n) => {
				checkpoint(depth);
				if (!n || typeof n !== 'object') throw new Error('Expected a statement');
				switch (n.op) {
					case 'class':
						return classSource(n, depth + 1, true);
					case 'function-declaration':
						return `${n.async === true ? 'async ' : ''}function${n.generator === true ? '*' : ''} ${identifier(n.name)}(${parameters(
							n.params || [],
							depth + 1
						)}){${steps(n.body || [], depth + 1)}}`;
					case 'block':
						return `{${steps(n.body || [], depth + 1)}}`;
					case 'empty':
						return ';';
					case 'label':
						return `${identifier(n.name)}:${steps([n.body], depth + 1)}`;
					case 'switch': {
						if (
							!Array.isArray(n.cases) ||
							n.cases.length > 40 ||
							n.cases.some((c: any) => !c || typeof c !== 'object') ||
							n.cases.filter((c: any) => c.default === true).length > 1
						)
							throw new Error('Expected bounded switch cases with at most one default');
						return `switch(${expr(n.value, depth + 1)}){${n.cases
							.map((c: any) => `${c.default === true ? 'default' : `case ${expr(c.test, depth + 1)}`}:${steps(c.body || [], depth + 1)}`)
							.join('\n')}}`;
					}
					case 'do-while':
						return `do{${steps(n.body || [], depth + 1)}}while(${expr(n.test, depth + 1)});`;
					case 'for': {
						if (n.init !== undefined && !['let', 'const', 'var', 'assign', 'expression'].includes(n.init?.op))
							throw new Error('Invalid for initializer');
						const init = n.init === undefined ? '' : steps([n.init], depth + 1).slice(0, -1);
						return `for(${init};${n.test === undefined ? '' : expr(n.test, depth + 1)};${
							n.update === undefined ? '' : expr(n.update, depth + 1)
						}){${steps(n.body || [], depth + 1)}}`;
					}
					case 'for-in':
					case 'for-await-of':
					case 'for-of': {
						const declaration = n.declaration === undefined ? 'const' : n.declaration;
						if (!['const', 'let', 'var', 'assign'].includes(declaration)) throw new Error('Unsupported loop declaration');
						return `for${n.op === 'for-await-of' ? ' await' : ''}(${declaration === 'assign' ? '' : declaration + ' '}${binding(
							n,
							depth + 1,
							declaration === 'assign'
						)} ${n.op === 'for-in' ? 'in' : 'of'} ${expr(n.value, depth + 1)}){${steps(n.body || [], depth + 1)}}`;
					}
					case 'let':
					case 'const':
					case 'var':
						return `${n.op} ${binding(n, depth + 1)}=${expr(n.value, depth + 1)};`;
					case 'assign':
						return `(${binding(n, depth + 1, true)}=${expr(n.value, depth + 1)});`;
					case 'return':
						return `return ${expr(n.value, depth + 1)};`;
					case 'expression':
						return `${expr(n.value, depth + 1)};`;
					case 'if':
						return `if(${expr(n.test, depth + 1)}){${steps(n.then || [], depth + 1)}}else{${steps(n.else || [], depth + 1)}}`;
					case 'while':
						return `while(${expr(n.test, depth + 1)}){${steps(n.body || [], depth + 1)}}`;
					case 'try': {
						if (has(n, 'errorPattern') && has(n, 'error')) throw new Error('Choose a catch name or a catch pattern');
						const target = has(n, 'errorPattern') ? pattern(n.errorPattern, depth + 1) : identifier(n.error || 'error');
						return `try{${steps(n.body || [], depth + 1)}}catch(${target}){${steps(n.catch || [], depth + 1)}}finally{${steps(
							n.finally || [],
							depth + 1
						)}}`;
					}
					case 'throw':
						return `throw ${expr(n.value, depth + 1)};`;
					case 'break':
						return `break${n.label === undefined ? '' : ` ${identifier(n.label)}`};`;
					case 'continue':
						return `continue${n.label === undefined ? '' : ` ${identifier(n.label)}`};`;
					default:
						throw new Error(`Unknown statement: ${String(n.op).slice(0, 40)}`);
				}
			})
			.join('\n');
	};
	return steps(p.steps || []);
}
