/** Bounded, synchronous evaluation of the existing data-program vocabulary.
 * Native callbacks cannot wait for a worker message. This interpreter runs only
 * explicitly authored callback data, with no source evaluation or global access.
 * DOM operations still go through the same run-local capability bridge. */
export const SYNC_CALLBACK_LIMITS = { definitions: 16, nodes: 256, depth: 16, steps: 2048, totalSteps: 32768, calls: 512, text: 4096, items: 64 };
export class SynchronousCallbackThrown extends Error {
	constructor(readonly value: unknown) {
		super('Authored callback threw data');
	}
}
type Binding = { value: unknown; constant: boolean };
class Scope {
	values = new Map<string, Binding>();
	constructor(readonly parent?: Scope) {}
	find(name: string): Binding {
		const value = this.values.get(name);
		if (value) return value;
		if (this.parent) return this.parent.find(name);
		throw new ReferenceError(`Unknown callback binding ${name}`);
	}
}
const key = (value: unknown): string => {
	if (typeof value !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,59}$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value))
		throw new Error('Invalid synchronous callback name');
	return value;
};
/** Copy caller data without running getters, inheriting prototypes or retaining
 * aliases that could later replace a validated definition. */
export function callbackData(value: unknown, limit = 1024, charge: () => void = () => {}): any {
	let nodes = 0,
		text = 0;
	const copy = (raw: unknown, depth: number): any => {
		charge();
		if (++nodes > limit || depth > SYNC_CALLBACK_LIMITS.depth) throw new Error('Synchronous callback data budget exceeded');
		if (raw === null || raw === undefined || typeof raw === 'boolean' || typeof raw === 'number') return raw;
		if (typeof raw === 'string') {
			text += raw.length;
			if (raw.length > SYNC_CALLBACK_LIMITS.text || text > 65536) throw new Error('Synchronous callback text budget exceeded');
			return raw;
		}
		if (typeof raw !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(raw)))
			throw new Error('Use plain synchronous callback data');
		const descriptors = Object.getOwnPropertyDescriptors(raw);
		if (Array.isArray(raw) && raw.length > SYNC_CALLBACK_LIMITS.items) throw new Error('Synchronous callback collection budget exceeded');
		if (Object.keys(descriptors).length > SYNC_CALLBACK_LIMITS.items + (Array.isArray(raw) ? 1 : 0))
			throw new Error('Synchronous callback collection budget exceeded');
		const result: any = Array.isArray(raw) ? [] : Object.create(null);
		for (const [name, descriptor] of Object.entries(descriptors)) {
			if (Array.isArray(raw) && name === 'length') continue;
			if (!('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(name))
				throw new Error('Callback accessors and prototype names are unavailable');
			if (Array.isArray(raw) && !/^(0|[1-9]\d?)$/.test(name)) throw new Error('Invalid callback array index');
			result[name] = copy(descriptor.value, depth + 1);
		}
		return result;
	};
	return copy(value, 0);
}
const binary: Record<string, (a: any, b: any) => unknown> = {
	'+': (a, b) => a + b,
	'-': (a, b) => a - b,
	'*': (a, b) => a * b,
	'/': (a, b) => a / b,
	'%': (a, b) => a % b,
	'===': (a, b) => a === b,
	'!==': (a, b) => a !== b,
	'==': (a, b) => a == b,
	'!=': (a, b) => a != b,
	'<': (a, b) => a < b,
	'<=': (a, b) => a <= b,
	'>': (a, b) => a > b,
	'>=': (a, b) => a >= b,
	'&': (a, b) => a & b,
	'|': (a, b) => a | b,
	'^': (a, b) => a ^ b,
	'<<': (a, b) => a << b,
	'>>': (a, b) => a >> b,
	'>>>': (a, b) => a >>> b
};
const expressions = new Set([
	'literal',
	'undefined',
	'variable',
	'input',
	'this',
	'get',
	'array',
	'object',
	'binary',
	'unary',
	'conditional',
	'dom',
	'method'
]);
const statements = new Set(['let', 'const', 'assign', 'expression', 'return', 'if', 'while', 'for-of', 'block', 'throw', 'try', 'break', 'continue']);
type Completion = { kind: 'return' | 'break' | 'continue'; value?: unknown };
export type SynchronousCallback = ReturnType<typeof createSynchronousCallback>;
export function createSynchronousCallback(
	raw: unknown,
	initialInputs: unknown,
	host: { dom: (request: { action: string; target: unknown; key: string; args: unknown[] }) => unknown; charge: () => void }
) {
	const definition = callbackData(raw, 1024, host.charge);
	if (
		!definition ||
		!['function', 'function-expression'].includes(definition.op) ||
		definition.async ||
		definition.generator ||
		definition.name ||
		!Array.isArray(definition.params) ||
		definition.params.length > 4
	)
		throw new Error('Expected a synchronous data function');
	const params: string[] = definition.params.map(key);
	if (new Set(params).size !== params.length) throw new Error('Use unique callback parameters');
	let count = 0;
	const validate = (value: any, depth = 0) => {
		if (++count > SYNC_CALLBACK_LIMITS.nodes || depth > SYNC_CALLBACK_LIMITS.depth)
			throw new Error('Synchronous callback definition budget exceeded');
		if (!value || typeof value !== 'object') return;
		if (!Array.isArray(value) && 'op' in value) {
			if (!expressions.has(value.op) && !statements.has(value.op)) throw new Error(`Unsupported synchronous callback operation ${value.op}`);
			if (value.op === 'literal') return;
			if (value.op === 'dom' && !['get', 'set', 'call', 'constant'].includes(value.action)) throw new Error('Unsupported synchronous DOM action');
			if (
				value.pattern ||
				value.errorPattern ||
				value.label ||
				(value.op === 'for-of' && value.declaration && !['const', 'let'].includes(value.declaration))
			)
				throw new Error('Use simple local bindings in synchronous callbacks');
		}
		for (const item of Object.values(value)) validate(item, depth + 1);
	};
	validate(definition.body === undefined ? definition.value : definition.body);
	let inputs: Record<string, unknown>;
	const setInputs = (value: unknown) => {
		const next = callbackData(value, 1024, host.charge);
		if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('Callback bindings must be a data object');
		for (const name of Object.keys(next)) key(name);
		inputs = next;
	};
	setInputs(initialInputs);
	let calls = 0;
	const invoke = (args: unknown[], thisValue: unknown) => {
		if (++calls > SYNC_CALLBACK_LIMITS.calls) throw new Error('Synchronous callback invocation budget exceeded');
		let steps = 0;
		const tick = () => {
			host.charge();
			if (++steps > SYNC_CALLBACK_LIMITS.steps) throw new Error('Synchronous callback execution budget exceeded');
		};
		const bounded = (value: any): any => {
			if (typeof value === 'string' && value.length > SYNC_CALLBACK_LIMITS.text) throw new Error('Synchronous callback text budget exceeded');
			if (Array.isArray(value) && value.length > SYNC_CALLBACK_LIMITS.items) throw new Error('Synchronous callback collection budget exceeded');
			return value;
		};
		const scope = new Scope();
		params.forEach((name, index) => scope.values.set(name, { value: args[index], constant: false }));
		const property = (target: any, name: any) => {
			if (target === null || target === undefined) throw new TypeError('Cannot read a null callback value');
			if (typeof name !== 'string' && typeof name !== 'number') throw new Error('Expected a callback property name');
			if (['__proto__', 'prototype', 'constructor'].includes(String(name))) throw new Error('Callback prototype access is unavailable');
			return Object.prototype.hasOwnProperty.call(Object(target), name) ? target[name] : undefined;
		};
		const expression = (node: any, env: Scope): any => {
			tick();
			if (node === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof node)) return node;
			if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Expected a callback expression');
			const e = (value: any) => expression(value, env);
			switch (node.op) {
				case 'literal':
					return callbackData(node.value, 1024, tick);
				case 'undefined':
					return undefined;
				case 'variable':
					return env.find(key(node.name)).value;
				case 'input':
					return inputs[key(node.name)];
				case 'this':
					return definition.op === 'function' ? undefined : thisValue;
				case 'get': {
					const target = e(node.target);
					return node.optional && target == null ? undefined : property(target, e(node.key));
				}
				case 'array':
					return bounded(node.items.map(e));
				case 'object':
					return Object.fromEntries(node.entries.map(([name, value]: [unknown, unknown]) => [key(name), e(value)]));
				case 'conditional':
					return e(node.test) ? e(node.then) : e(node.else);
				case 'binary': {
					const a = e(node.left);
					if (node.operator === '&&') return a && e(node.right);
					if (node.operator === '||') return a || e(node.right);
					if (node.operator === '??') return a ?? e(node.right);
					if (!Object.prototype.hasOwnProperty.call(binary, node.operator)) throw new Error('Unsupported synchronous callback operator');
					const b = e(node.right);
					// Registered DOM handles have identity across bridge messages.
					if (['===', '!==', '==', '!='].includes(node.operator) && a?.$dom && b?.$dom)
						return (a.$dom === b.$dom && a.type === b.type) === !['!==', '!='].includes(node.operator);
					if ((a && typeof a === 'object') || (b && typeof b === 'object')) {
						if (!['===', '!==', '==', '!='].includes(node.operator)) throw new Error('Callback operators require primitive values');
					}
					return bounded(binary[node.operator](a, b));
				}
				case 'unary': {
					const value = e(node.value);
					if (node.operator === '!') return !value;
					if (node.operator === 'typeof') return typeof value;
					if (node.operator === 'void') return undefined;
					if (value && typeof value === 'object') throw new Error('Callback operators require primitive values');
					if (node.operator === '+') return +value;
					if (node.operator === '-') return -value;
					if (node.operator === '~') return ~value;
					throw new Error('Unsupported synchronous callback unary operator');
				}
				case 'dom':
					return host.dom({ action: node.action, target: e(node.target), key: key(node.key), args: (node.args || []).map(e) });
				case 'method': {
					const target = e(node.target),
						args = (node.args || []).map(e);
					if (
						typeof target === 'string' &&
						['includes', 'startsWith', 'endsWith', 'indexOf', 'slice', 'substring', 'toLowerCase', 'toUpperCase', 'trim'].includes(node.key)
					) {
						if (args.some((v: unknown) => v && typeof v === 'object')) throw new Error('String callbacks require primitive arguments');
						return bounded(Reflect.apply((String.prototype as any)[node.key], target, args));
					}
					if (Array.isArray(target) && ['push', 'pop', 'shift', 'includes', 'indexOf', 'slice', 'join'].includes(node.key)) {
						if (node.key === 'push' && target.length + args.length > SYNC_CALLBACK_LIMITS.items)
							throw new Error('Synchronous callback collection budget exceeded');
						if (
							node.key === 'join' &&
							(args.length > 1 || (args.length && typeof args[0] !== 'string') || target.some((v) => v && typeof v === 'object'))
						)
							throw new Error('Callback joins require primitive items and a text separator');
						if (node.key === 'join') {
							const length =
								target.reduce((size, v) => size + (v == null ? 0 : String(v).length), 0) +
								Math.max(0, target.length - 1) * (args[0] === undefined ? 1 : args[0].length);
							if (length > SYNC_CALLBACK_LIMITS.text) throw new Error('Synchronous callback text budget exceeded');
						}
						return bounded(Reflect.apply((Array.prototype as any)[node.key], target, args));
					}
					throw new Error('Unregistered synchronous callback method');
				}
				default:
					throw new Error(`Unsupported synchronous callback expression ${node.op}`);
			}
		};
		const run = (body: any, env: Scope): Completion | undefined => {
			if (!Array.isArray(body) || body.length > SYNC_CALLBACK_LIMITS.items) throw new Error('Expected bounded callback statements');
			for (const node of body) {
				tick();
				const e = (value: any) => expression(value, env);
				switch (node.op) {
					case 'let':
					case 'const': {
						const name = key(node.name);
						if (env.values.has(name)) throw new SyntaxError('Callback binding already declared');
						env.values.set(name, { value: e(node.value), constant: node.op === 'const' });
						break;
					}
					case 'assign': {
						const binding = env.find(key(node.name));
						if (binding.constant) throw new TypeError('Assignment to constant callback binding');
						binding.value = e(node.value);
						break;
					}
					case 'expression':
						e(node.value);
						break;
					case 'return':
						return { kind: 'return', value: e(node.value) };
					case 'break':
					case 'continue':
						return { kind: node.op };
					case 'throw':
						throw e(node.value);
					case 'if':
					case 'block': {
						const result = run(node.op === 'block' ? node.body : e(node.test) ? node.then : node.else || [], new Scope(env));
						if (result) return result;
						break;
					}
					case 'while':
					case 'for-of': {
						let values = node.op === 'for-of' ? e(node.value) : null;
						if (node.op === 'for-of' && !Array.isArray(values) && typeof values !== 'string')
							throw new Error('Callback iteration requires an array or text');
						if (typeof values === 'string') values = Array.from(values);
						let index = 0;
						while (values === null ? e(node.test) : index < values.length) {
							tick();
							const local = new Scope(env);
							if (values !== null) local.values.set(key(node.name), { value: values[index++], constant: node.declaration !== 'let' });
							const result = run(node.body, local);
							if (result?.kind === 'return') return result;
							if (result?.kind === 'break') break;
						}
						break;
					}
					case 'try': {
						let result: Completion | undefined;
						try {
							result = run(node.body, new Scope(env));
						} catch (error) {
							const local = new Scope(env);
							local.values.set(key(node.error || 'error'), {
								value: error instanceof Error ? { name: error.name, message: error.message } : error,
								constant: false
							});
							result = run(node.catch || [], local);
						} finally {
							if (node.finally) {
								const final = run(node.finally, new Scope(env));
								if (final) return final;
							}
						}
						if (result) return result;
						break;
					}
					default:
						throw new Error(`Unsupported synchronous callback statement ${node.op}`);
				}
			}
		};
		// The worker protocol recursively restores returned records. Refuse
		// cycles and bound expanded aliases before crossing that boundary.
		return callbackData(definition.body === undefined ? expression(definition.value, scope) : run(definition.body, scope)?.value, 1024, tick);
	};
	return { invoke, setInputs, getInputs: () => callbackData(inputs) };
}
