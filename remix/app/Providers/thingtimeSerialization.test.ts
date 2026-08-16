import assert from 'node:assert/strict';
import test from 'node:test';

import { stringify as stringifyAux } from 'flatted';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	hasPersistedThingtimeRuntimeMethods,
	parseThingtime,
	parseThingtimeWithDiagnostics,
	stringifyThingtime,
	stringifyThingtimeForStorage
} from './thingtimeSerialization.ts';

declare const offset: number;

type ScopedFunction = ((value: number) => number) & {
	ttScope?: Record<string, unknown>;
};

const roundTrip = <Value>(value: Value): Value => {
	return parseThingtime(stringifyThingtime(value)) as Value;
};

test('round-trips anonymous, named, arrow, and object-method functions', () => {
	const anonymous = function (value: number) {
		return value + 1;
	};
	function named(value: number) {
		return value + 2;
	}
	const arrow = (value: number) => value + 3;
	const method = {
		add(value: number) {
			return value + 4;
		}
	}.add;

	const revived = roundTrip({ anonymous, named, arrow, method });
	assert.equal(revived.anonymous(10), 11);
	assert.equal(revived.named(10), 12);
	assert.equal(revived.arrow(10), 13);
	assert.equal(revived.method(10), 14);
});

test('rebuilds a function closure from its persisted Thingtime scope', () => {
	const scoped = function (value: number) {
		return value + offset;
	} as ScopedFunction;
	scoped.ttScope = { offset: 7 };

	const revived = roundTrip({ scoped }).scoped;
	assert.equal(revived(5), 12);
	assert.deepEqual(revived.ttScope, { offset: 7 });
});

test('preserves circular Thingtime references while reviving functions', () => {
	const root: { self?: unknown; read: () => string } = {
		read: () => 'ready'
	};
	root.self = root;

	const revived = roundTrip(root);
	assert.equal(revived.self, revived);
	assert.equal(revived.read(), 'ready');
});

test('removes an invalid persisted function so defaults can repair its property', () => {
	const serialized = stringifyAux({
		keep: 'healthy',
		broken: {
			ttype: 'function',
			code: 'function () {',
			ttScope: {}
		}
	});
	const parsed = parseThingtimeWithDiagnostics(serialized);
	assert.equal(parsed.value.keep, 'healthy');
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.value, 'broken'), false);
	assert.equal(parsed.repaired, true);
	assert.equal(parsed.removedFunctionCount, 1);
});

test('removes the legacy saved no-op instead of hydrating poisoned behavior', () => {
	const serialized = stringifyAux({
		factory: {
			ttype: 'function',
			code: `function () {
				console.warn('Function could not be revived:', value.code);
			}`,
			ttScope: {}
		}
	});
	const originalConsoleError = console.error;
	console.error = () => undefined;

	try {
		const revived = parseThingtime(serialized);
		assert.equal(Object.prototype.hasOwnProperty.call(revived, 'factory'), false);
	} finally {
		console.error = originalConsoleError;
	}
});

test('rejects unsafe scope keys without executing persisted source', () => {
	const serialized = stringifyAux({
		factory: {
			ttype: 'function',
			code: '() => 42',
			ttScope: { 'invalid-key': 1 }
		}
	});
	const originalConsoleError = console.error;
	console.error = () => undefined;

	try {
		const revived = parseThingtime(serialized);
		assert.equal(Object.prototype.hasOwnProperty.call(revived, 'factory'), false);
	} finally {
		console.error = originalConsoleError;
	}
});

test('storage snapshots omit only root runtime methods and preserve circular aliases', () => {
	const root: Record<string, any> = {
		keep: 'healthy',
		set: () => 'runtime set',
		get: () => 'runtime get',
		nested: {
			set: 'user set value',
			get: 'user get value'
		}
	};
	root.tt = root;
	root.thingtime = root;

	assert.equal(hasPersistedThingtimeRuntimeMethods(root), true);
	const revived = parseThingtime(stringifyThingtimeForStorage(root));
	assert.equal(Object.prototype.hasOwnProperty.call(revived, 'set'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(revived, 'get'), false);
	assert.equal(revived.nested.set, 'user set value');
	assert.equal(revived.nested.get, 'user get value');
	assert.equal(revived.tt, revived);
	assert.equal(revived.thingtime, revived);
	assert.equal(hasPersistedThingtimeRuntimeMethods(revived), false);
});

test('a cleaned legacy snapshot stays clean on its very next parse', () => {
	const poisoned = stringifyAux({
		keep: 'healthy',
		set: {
			ttype: 'function',
			code: `function () {
				console.warn('Function could not be revived:', value.code);
			}`,
			ttScope: {}
		},
		get: {
			ttype: 'function',
			code: '() => "stale runtime getter"',
			ttScope: {}
		}
	});

	const firstParse = parseThingtimeWithDiagnostics(poisoned);
	assert.equal(firstParse.repaired, true);
	assert.equal(firstParse.removedFunctionCount, 1);
	assert.equal(hasPersistedThingtimeRuntimeMethods(firstParse.value), true);

	const cleanSnapshot = stringifyThingtimeForStorage(firstParse.value);
	const secondParse = parseThingtimeWithDiagnostics(cleanSnapshot);
	assert.equal(secondParse.repaired, false);
	assert.equal(secondParse.removedFunctionCount, 0);
	assert.equal(hasPersistedThingtimeRuntimeMethods(secondParse.value), false);
	assert.equal(secondParse.value.keep, 'healthy');
});
