import assert from 'node:assert/strict';
import test from 'node:test';

import { stringify as stringifyAux } from 'flatted';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { parseThingtime, stringifyThingtime } from './thingtimeSerialization.ts';

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
	const originalConsoleError = console.error;
	const errors: unknown[][] = [];
	console.error = (...args: unknown[]) => errors.push(args);

	try {
		const revived = parseThingtime(serialized);
		assert.equal(revived.keep, 'healthy');
		assert.equal(Object.prototype.hasOwnProperty.call(revived, 'broken'), false);
		assert.equal(errors.length, 1);
	} finally {
		console.error = originalConsoleError;
	}
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
