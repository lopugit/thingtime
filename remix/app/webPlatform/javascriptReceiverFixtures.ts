import type { Feature, PlatformProgram, Recipe } from './types';
import { base, parameter, input, global, get, method, make, recipe, returns, variable as v, object, array, fn, call, awaited, declare, perform } from './programBuilders';

const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
const from = (value: unknown) => method(global('Array'), 'from', [value]);
const recordFunction = (params: string[], body: unknown[]) => ({ op: 'function-expression', params, body });

/** Complete native-receiver examples expressed only with reusable language nodes. */
export function javascriptReceiverRecipe(f: Feature): Recipe | undefined {
	if (f.kind !== 'built-in') return;
	const name = f.name.replace(/^(get|set) /, '').split(' (')[0].trim();
	const parts = name.split('.'), root = parts[0], member = parts.at(-1)!;
	if (['prototype', 'constructor', '__proto__'].includes(member) || name.includes('%')) return;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: [] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type)); return input(name);
	};
	const done = (value: unknown, note: string) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] }, 'interactive', note);
	const requireMember = (type: string, key: string) => p.requires!.push([type, 'prototype', key]);

	if (root === 'DataView') {
		const operation = /^(get|set)(BigInt64|BigUint64|Float16|Float32|Float64|Int8|Int16|Int32|Uint8|Uint16|Uint32)$/.exec(member);
		if (!operation && !['buffer', 'byteLength', 'byteOffset'].includes(member)) return;
		p.requires = [['DataView']];
		p.steps!.push(declare('bytes', make('Uint8Array', [param('bytes', 'Backing bytes', Array.from({ length: 32 }, (_, i) => i))])),
			declare('view', make('DataView', [get(v('bytes'), 'buffer'), param('viewOffset', 'View byte offset', 4, 'number'), param('viewLength', 'View byte length', 24, 'number')])));
		if (!operation) return done(object({ value: get(v('view'), member), bytes: from(v('bytes')), byteOffset: get(v('view'), 'byteOffset'), byteLength: get(v('view'), 'byteLength') }),
			'The DataView is a real window into the backing bytes. Change the view offset and length; the buffer property retains the complete backing allocation.');
		const [, verb, format] = operation;
		const getter = `get${format}`, setter = `set${format}`;
		requireMember('DataView', getter); requireMember('DataView', setter);
		const offset = param('offset', 'Offset within view', 1, 'number');
		const big = format.startsWith('Big');
		const value = param('value', 'Value to store', big ? '9007199254740993' : format.startsWith('Float') ? 1.5 : 258, big ? 'text' : 'number');
		const endian = format.endsWith('8') ? [] : [param('littleEndian', 'Little endian', true, 'boolean')];
		p.steps!.push(declare('writeResult', method(v('view'), setter, [offset, big ? call(global('BigInt'), [value]) : value, ...endian])),
			declare('readBack', method(v('view'), getter, [offset, ...endian])));
		return done(object({ result: verb === 'set' ? v('writeResult') : v('readBack'), readBack: v('readBack'), bytes: from(v('bytes')),
			...(endian.length ? { oppositeEndian: method(v('view'), getter, [offset, { op: 'unary', operator: '!', value: endian[0] }]) } : {}) }),
			'Write and read the same native DataView format, inspect the backing bytes, and compare byte order. BigInt values use editable decimal strings without Number rounding. Invalid offsets return native errors.');
	}
	if (root === 'Iterator' && ['drop', 'every', 'filter', 'find', 'flatMap', 'forEach', 'map', 'reduce', 'some', 'take', 'toArray'].includes(member)) {
		requireMember('Iterator', member);
		p.steps!.push(declare('source', method(param('values', 'Values', [1, 2, 3, 4, 5]), 'values')), declare('visited', array()));
		const factor = ['map', 'flatMap'].includes(member) ? param('factor', 'Multiplier', 2, 'number') : undefined;
		const threshold = ['filter', 'find', 'some', 'every'].includes(member) ? param('threshold', 'Greater than', 2, 'number') : undefined;
		const mapped = factor === undefined ? v('value') : binary('*', v('value'), factor);
		const callback = recordFunction(member === 'reduce' ? ['total', 'value'] : ['value', 'index'], [
			perform(method(v('visited'), 'push', [v('value')])), ...returns(member === 'reduce' ? binary('+', v('total'), v('value'))
				: threshold !== undefined ? binary('>', v('value'), threshold) : member === 'flatMap' ? array(v('value'), mapped) : mapped)
		]);
		const args = ['drop', 'take'].includes(member) ? [param('limit', 'Limit', 2, 'number')]
			: member === 'toArray' ? [] : member === 'reduce' ? [callback, param('initial', 'Initial total', 10, 'number')] : [callback];
		p.steps!.push(declare('result', method(v('source'), member, args)), declare('visitedBeforeConsumption', get(v('visited'), 'length')));
		const lazy = ['drop', 'take', 'map', 'filter', 'flatMap'].includes(member);
		if (lazy) p.steps!.push({ op: 'assign', name: 'result', value: from(v('result')) });
		return done(object({ result: v('result'), visitedBeforeConsumption: v('visitedBeforeConsumption'), visited: v('visited'), remaining: from(v('source')) }),
			'Runs the native iterator helper. Callback receipts expose lazy consumption or short-circuiting; remaining values come from the same original iterator.');
	}
	if (['WeakMap', 'WeakSet'].includes(root) && ['set', 'get', 'has', 'delete', 'add', 'getOrInsert', 'getOrInsertComputed'].includes(member)) {
		requireMember(root, member);
		p.steps!.push(declare('key', param('key', 'Object key', { label: 'Thingtime' })), declare('otherKey', method(global('Object'), 'assign', [object({}), v('key')])),
			declare('collection', make(root)), declare('computed', array()));
		const initial = root === 'WeakMap' ? param('initial', 'Existing value', 'existing', 'text') : undefined;
		p.steps!.push({ op: 'if', test: param('present', 'Start with key present', !['add', 'set', 'getOrInsert', 'getOrInsertComputed'].includes(member), 'boolean'),
			then: [perform(method(v('collection'), root === 'WeakMap' ? 'set' : 'add', root === 'WeakMap' ? [v('key'), initial] : [v('key')]))] });
		const args: unknown[] = [v('key')];
		if (['set', 'getOrInsert', 'getOrInsertComputed'].includes(member)) {
			const next = param('value', 'New or fallback value', 'new value', 'text');
			args.push(member === 'getOrInsertComputed' ? recordFunction(['key'], [perform(method(v('computed'), 'push', [v('key')])), ...returns(next)]) : next);
		}
		p.steps!.push(declare('result', method(v('collection'), member, args)));
		return done(object({ result: choose(binary('===', v('result'), v('collection')), 'same collection', v('result')),
			hasKey: method(v('collection'), 'has', [v('key')]), hasEqualLookingObject: method(v('collection'), 'has', [v('otherKey')]),
			...(root === 'WeakMap' ? { stored: method(v('collection'), 'get', [v('key')]) } : {}), computedCalls: get(v('computed'), 'length') }),
			'Weak collections use actual object identity. Toggle whether the key is already present and compare a separate object. Keys stay strongly held during this run; garbage collection is not forced.');
	}
	if (root === 'WeakRef' && member === 'deref') {
		requireMember(root, member);
		p.steps!.push(declare('target', param('target', 'Target object', { label: 'Reusable Thing' })), declare('reference', make(root, [v('target')])), declare('result', method(v('reference'), member)));
		return done(object({ value: v('result'), sameIdentity: binary('===', v('result'), v('target')) }),
			'The native WeakRef dereferences its actual target. The target stays strongly reachable for this deterministic example; later collection is intentionally not promised.');
	}
	if (root === 'FinalizationRegistry' && ['register', 'unregister'].includes(member)) {
		requireMember(root, member);
		p.steps!.push(declare('target', object({ label: 'target' })), declare('token', object({ label: 'token' })), declare('cleanup', array()),
			declare('registry', make(root, [fn(['held'], method(v('cleanup'), 'push', [v('held')]))])),
			declare('registered', method(v('registry'), 'register', [v('target'), param('held', 'Held value', { label: 'cleanup receipt' }), v('token')])),
			declare('removed', method(v('registry'), 'unregister', [v('token')])));
		return done(object({ result: member === 'register' ? v('registered') : v('removed'), unregistered: v('removed'), secondUnregister: method(v('registry'), 'unregister', [v('token')]), cleanup: v('cleanup') }),
			'Register with a distinct held value and unregister token, then prove removal by unregistering twice. Cleanup timing is nondeterministic; this run retains the target and makes no cleanup-callback claim.');
	}
	if (root === 'Function' && ['apply', 'bind', 'call', 'toString'].includes(member)) {
		const factor = param('factor', 'Multiplier', 2, 'number');
		p.steps!.push(declare('compute', { op: 'function-expression', name: 'compute', params: ['a', 'b'], body: returns(binary('+', get({ op: 'this' }, 'base'), binary('+', binary('*', v('a'), factor), v('b')))) }));
		if (member === 'toString') return done(object({ source: method(v('compute'), member), result: method(v('compute'), 'call', [object({ base: 10 }), 3, 4]) }),
			'Inspect the native source representation of a function compiled from editable language nodes. Its source is an output, never an executable source-string input.');
		const receiver = object({ base: param('base', 'Receiver base', 10, 'number') });
		const first = param('first', 'First argument', 3, 'number'), second = param('second', 'Second argument', 4, 'number');
		if (member === 'bind') {
			p.steps!.push(declare('bound', method(v('compute'), member, [receiver, first])));
			return done(object({ result: call(v('bound'), [second]), changedThisIgnored: method(v('bound'), 'call', [object({ base: -1000 }), second]), name: get(v('bound'), 'name'), length: get(v('bound'), 'length') }),
			'Bind a native function receiver and its first argument, call it, and compare an attempted this replacement. The remaining arity and bound name are native properties.');
		}
		return done(method(v('compute'), member, member === 'apply' ? [receiver, array(first, second)] : [receiver, first, second]),
			'Call the structured function with an explicit this receiver and editable arguments through the native Function method.');
	}
	if (root === 'Promise' && ['then', 'catch', 'finally'].includes(member)) {
		requireMember(root, member);
		const value = param('value', 'Value or rejection reason', 'Thingtime', 'text');
		p.steps!.push(declare('trace', array()), declare('source', choose(param('reject', 'Start rejected', member === 'catch', 'boolean'), method(global(root), 'reject', [value]), method(global(root), 'resolve', [value]))));
		const handler = (state: string) => recordFunction(['value'], [perform(method(v('trace'), 'push', [state])), ...returns(object({ handled: state, value: v('value') }))]);
		const args = member === 'then' ? [handler('fulfilled'), handler('rejected')] : member === 'catch' ? [handler('caught')] : [recordFunction([], [
			perform(method(v('trace'), 'push', ['finally'])),
			{ op: 'if', test: param('cleanupThrows', 'Throw from cleanup', false, 'boolean'), then: [{ op: 'throw', value: make('Error', ['cleanup failed']) }] },
			...returns('cleanup return value is ignored')
		])];
		p.steps!.push(declare('result', awaited(method(method(v('source'), member, args), 'then', [
			fn(['value'], object({ status: 'fulfilled', value: v('value') })), fn(['reason'], object({ status: 'rejected', reason: call(global('String'), [v('reason')]) }))
		]))));
		return done(object({ result: v('result'), trace: v('trace') }), 'Compare native promise fulfillment and rejection paths. finally preserves the settled value unless cleanup throws; every rejection is observed in this program.');
	}
	if (['Error', 'AggregateError', 'NativeError'].includes(root) && ['name', 'message', 'toString'].includes(member)) {
		const type = root === 'NativeError' ? 'TypeError' : root;
		p.requires = [[type]];
		const message = param('message', 'Message', 'A reusable error', 'text');
		p.steps!.push(declare('error', make(type, root === 'AggregateError' ? [param('errors', 'Contained errors', ['first failure', 'second failure']), message] : [message])));
		if (member === 'name') p.steps!.push(perform(method(global('Reflect'), 'set', [v('error'), 'name', param('name', 'Instance name', type, 'text')])));
		return done(object({ value: member === 'toString' ? method(v('error'), member) : get(v('error'), member), inheritedDefault: get(get(global(type), 'prototype'), member), ownsMessage: method(global('Object'), 'hasOwn', [v('error'), 'message']),
			...(root === 'AggregateError' ? { errors: get(v('error'), 'errors') } : {}) }),
			'Create a native error and compare instance state with its prototype default.' + (root === 'NativeError' ? ' NativeError is the specification family placeholder; this example uses TypeError.' : ''));
	}
	if (root === 'Symbol' && ['description', 'toString', 'valueOf'].includes(member)) {
		p.steps!.push(declare('symbol', call(global('Symbol'), [param('description', 'Description', 'Thingtime', 'text')])));
		return done(object({ value: member === 'description' ? get(v('symbol'), member) : method(v('symbol'), member), sameSymbol: binary('===', method(v('symbol'), 'valueOf'), v('symbol')) }),
			'Read or invoke the native Symbol member on a real symbol. Equal descriptions do not create equal symbol identities.');
	}
	if (parts.length === 1 && ['encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isFinite', 'isNaN'].includes(root)) {
		const uri = root.endsWith('URI');
		const value = param('value', uri ? 'URI' : 'Value', uri ? (root === 'encodeURI' ? 'https://example.invalid/Hello Thingtime?q=🌈' : 'https://example.invalid/Hello%20Thingtime?q=%F0%9F%8C%88') : root === 'parseInt' ? '2a' : root === 'parseFloat' ? '3.14 metres' : '42', uri || root.startsWith('parse') ? 'text' : 'json');
		return done(object({ result: call(global(root), root === 'parseInt' ? [value, param('radix', 'Radix', 16, 'number')] : [value]),
			...(['isFinite', 'isNaN'].includes(root) ? { withoutCoercion: method(global('Number'), root, [value]) } : {}) }),
			'Runs the actual global built-in with editable inputs. URI operations only transform text; numeric predicates compare coercing globals with Number predicates.');
	}
}
