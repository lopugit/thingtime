import type { PlatformProgram } from './types';
const identifier = (value: unknown) => {
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(value) ||
		['eval', 'Function', 'AsyncFunction', 'GeneratorFunction', 'importScripts', 'self', 'globalThis', 'postMessage', 'close'].includes(value)
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
	const parameterNames = new Set<string>();
	for (const param of p.parameters || []) {
		identifier(param.name);
		if (typeof param.label !== 'string' || param.label.length > 160 || parameterNames.has(param.name))
			throw new Error('Use unique parameter names and text labels');
		parameterNames.add(param.name);
		if (!['text', 'number', 'boolean', 'json'].includes(param.type)) throw new Error('Unsupported parameter type');
	}
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
	const expr = (node: any, depth = 0): string => {
		checkpoint(depth);
		if (node === null || typeof node !== 'object' || Array.isArray(node)) return quoted(node);
		const e = (n: any) => expr(n, depth + 1),
			args = (n: any) => {
				if (!Array.isArray(n) || n.length > 100) throw new Error('Expected bounded arguments');
				return n.map(e).join(',');
			};
		switch (node.op) {
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
				return `(${e(node.target)})[${e(node.key)}]`;
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
				if (!Array.isArray(node.params) || node.params.length > 16) throw new Error('Expected parameters');
				return `(${node.async ? 'async ' : ''}(${node.params.map(identifier).join(',')})=>${e(node.value)})`;
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
				switch (n.op) {
					case 'let':
						return `let ${identifier(n.name)}=${expr(n.value)};`;
					case 'assign':
						return `${identifier(n.name)}=${expr(n.value)};`;
					case 'return':
						return `return ${expr(n.value)};`;
					case 'expression':
						return `${expr(n.value)};`;
					case 'if':
						return `if(${expr(n.test)}){${steps(n.then || [], depth + 1)}}else{${steps(n.else || [], depth + 1)}}`;
					case 'for-of':
						return `for(const ${identifier(n.name)} of ${expr(n.value)}){${steps(n.body || [], depth + 1)}}`;
					case 'while':
						return `while(${expr(n.test)}){${steps(n.body || [], depth + 1)}}`;
					case 'try':
						return `try{${steps(n.body || [], depth + 1)}}catch(${identifier(n.error || 'error')}){${steps(n.catch || [], depth + 1)}}finally{${steps(
							n.finally || [],
							depth + 1
						)}}`;
					case 'throw':
						return `throw ${expr(n.value)};`;
					case 'break':
						return 'break;';
					case 'continue':
						return 'continue;';
					default:
						throw new Error(`Unknown statement: ${String(n.op).slice(0, 40)}`);
				}
			})
			.join('\n');
	};
	return steps(p.steps || []);
}
