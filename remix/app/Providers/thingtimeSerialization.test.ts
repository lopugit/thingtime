import assert from 'node:assert/strict';
import test from 'node:test';

import { stringify as stringifyAux } from 'flatted';

// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { smarts } from '../smarts/index.tsx';
// @ts-ignore Node executes this TypeScript test through the tsx loader.
import {
	hasPersistedThingtimeRuntimeMethods,
	parseThingtime,
	parseThingtimeWithDiagnostics,
	stringifyThingtime,
	stringifyThingtimeForStorage
} from './thingtimeSerialization.ts';

const roundTrip = <Value>(value: Value): Value => {
	return parseThingtime(stringifyThingtime(value)) as Value;
};

test('ordinary date-like strings stay unchanged through repeated persistence cycles', () => {
	const input = {
		post: 'Post 1',
		year: '2024',
		month: 'March 2024',
		number: '1',
		day: '5 April',
		bareDate: '2024-03-15',
		text: 'hello world'
	};

	const once = roundTrip(input);
	const twice = roundTrip(once);

	for (const key of Object.keys(input) as Array<keyof typeof input>) {
		assert.equal(typeof once[key], 'string', key + ' should remain a string after one cycle');
		assert.equal(once[key], input[key]);
		assert.equal(typeof twice[key], 'string', key + ' should remain a string after two cycles');
		assert.equal(twice[key], input[key]);
	}
});

test('real Dates and identical-looking user strings retain distinct types and exact values', () => {
	const instant = '2024-03-15T10:00:00.000Z';
	const once = roundTrip({ real: new Date(instant), userText: instant });
	const twice = roundTrip(once);

	for (const value of [once, twice]) {
		assert.ok(value.real instanceof Date);
		assert.equal(value.real.toISOString(), instant);
		assert.equal(typeof value.userText, 'string');
		assert.equal(value.userText, instant);
	}
});

test('legacy untagged ISO values stay strings because their original type is ambiguous', () => {
	const instant = '2024-03-15T10:00:00.000Z';
	const legacy = stringifyAux({
		createdAt: instant,
		offsetText: '2024-03-15T10:00:00+10:00',
		shortFractionText: '2024-03-15T10:00:00.1Z'
	});

	const parsed = parseThingtimeWithDiagnostics(legacy);
	assert.equal(parsed.value.createdAt, instant);
	assert.equal(typeof parsed.value.createdAt, 'string');
	assert.equal(parsed.value.offsetText, '2024-03-15T10:00:00+10:00');
	assert.equal(parsed.value.shortFractionText, '2024-03-15T10:00:00.1Z');
	assert.equal(parsed.repaired, false);
});

test('explicit Date tags revive while malformed tag-looking user objects survive', () => {
	const malformedDate = { ttype: 'date', iso: 'not-a-date', label: 'keep me' };
	const incompleteDate = { ttype: 'date', label: 'also keep me' };
	const serialized = stringifyAux({
		tagged: { ttype: 'date', iso: '2024-03-15T10:00:00.000Z' },
		malformedDate,
		incompleteDate
	});

	const parsed = parseThingtime(serialized);
	assert.ok(parsed.tagged instanceof Date);
	assert.equal(parsed.tagged.toISOString(), '2024-03-15T10:00:00.000Z');
	assert.deepEqual(parsed.malformedDate, malformedDate);
	assert.deepEqual(parsed.incompleteDate, incompleteDate);
});

test('functions are omitted without persisting executable source', () => {
	const customSerialized = Object.assign(
		function CUSTOM_TO_JSON_MUST_NOT_PERSIST() {
			return 7;
		},
		{
			toJSON: () => ({
				ttype: 'function',
				code: 'globalThis.__functionToJsonExecuted = true'
			})
		}
	);
	const input = {
		handler: function SHOULD_NEVER_PERSIST() {
			return 42;
		},
		customSerialized,
		nested: {
			factory: () => ({ ok: true })
		},
		keep: 'data'
	};

	const serialized = stringifyThingtime(input);
	assert.equal(serialized.includes('SHOULD_NEVER_PERSIST'), false);
	assert.equal(serialized.includes('CUSTOM_TO_JSON_MUST_NOT_PERSIST'), false);
	assert.equal(serialized.includes('__functionToJsonExecuted'), false);
	assert.equal(serialized.includes('"ttype":"function"'), false);

	const parsed = parseThingtime(serialized);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'handler'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'customSerialized'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.nested, 'factory'), false);
	assert.equal(parsed.keep, 'data');
});

test('all legacy function tags are inert, including valid-looking hostile source and scope', () => {
	const marker = '__thingtimePersistedPayloadExecuted';
	delete (globalThis as Record<string, unknown>)[marker];
	const sharedHostile = {
		ttype: 'function',
		code: '() => { globalThis.__thingtimePersistedPayloadExecuted = true; return 42; }',
		ttScope: { globalThis }
	};

	const planted = stringifyAux({
		keep: 'healthy',
		hostile: sharedHostile,
		nested: { values: [sharedHostile] },
		methodSyntax: {
			ttype: 'function',
			code: 'run() { globalThis.__thingtimePersistedPayloadExecuted = true; }',
			ttScope: {}
		},
		malformed: {
			ttype: 'function'
		}
	});

	const parsed = parseThingtimeWithDiagnostics(planted);
	assert.equal(parsed.value.keep, 'healthy');
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.value, 'hostile'), false);
	assert.equal(parsed.value.nested.values.length, 1);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.value.nested.values, 0), false);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.value, 'methodSyntax'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.value, 'malformed'), false);
	assert.equal(parsed.removedFunctionCount, 3);
	assert.equal(parsed.repaired, true);
	assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
});

test('code-defined defaults refill a property removed from legacy persisted state', () => {
	const codeDefinedFactory = () => 'runtime default';
	const planted = stringifyAux({
		settings: {
			factory: {
				ttype: 'function',
				code: '() => "attacker controlled"',
				ttScope: {}
			}
		}
	});

	const parsed = parseThingtime(planted);
	const hydrated = smarts.merge(parsed, {
		settings: {
			factory: codeDefinedFactory
		}
	});

	assert.equal(hydrated.settings.factory, codeDefinedFactory);
	assert.equal(hydrated.settings.factory(), 'runtime default');
});

test('circular references and shared aliases survive while nested functions are removed', () => {
	const shared: Record<string, unknown> = {
		label: 'shared',
		handler: () => 'runtime only'
	};
	const root: Record<string, unknown> = {
		left: shared,
		right: shared,
		createdAt: new Date('2024-03-15T10:00:00.000Z'),
		userText: '2024-03-15T10:00:00.000Z'
	};
	root.self = root;

	const parsed = roundTrip(root);
	assert.equal(parsed.self, parsed);
	assert.equal(parsed.left, parsed.right);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed.left as object, 'handler'), false);
	assert.ok(parsed.createdAt instanceof Date);
	assert.equal(parsed.userText, '2024-03-15T10:00:00.000Z');
});

test('storage snapshots omit root runtime methods and keep nested set/get data', () => {
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
	const parsed = parseThingtime(stringifyThingtimeForStorage(root));
	assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'set'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'get'), false);
	assert.equal(parsed.nested.set, 'user set value');
	assert.equal(parsed.nested.get, 'user get value');
	assert.equal(parsed.tt, parsed);
	assert.equal(parsed.thingtime, parsed);
	assert.equal(hasPersistedThingtimeRuntimeMethods(parsed), false);
});

test('an inertly repaired legacy snapshot stays clean on its next parse', () => {
	const poisoned = stringifyAux({
		keep: 'healthy',
		set: {
			ttype: 'function',
			code: '() => "stale runtime setter"',
			ttScope: {}
		},
		get: {
			ttype: 'function',
			code: '() => "stale runtime getter"',
			ttScope: {}
		}
	});

	const first = parseThingtimeWithDiagnostics(poisoned);
	assert.equal(first.repaired, true);
	assert.equal(first.removedFunctionCount, 2);
	assert.equal(hasPersistedThingtimeRuntimeMethods(first.value), false);

	const cleanSnapshot = stringifyThingtimeForStorage(first.value);
	const second = parseThingtimeWithDiagnostics(cleanSnapshot);
	assert.equal(second.repaired, false);
	assert.equal(second.removedFunctionCount, 0);
	assert.equal(second.value.keep, 'healthy');
});

test('invalid Dates degrade to null without breaking circular serialization', () => {
	const input: Record<string, unknown> = { invalid: new Date('not-a-date') };
	input.self = input;
	const parsed = roundTrip(input);
	assert.equal(parsed.invalid, null);
	assert.equal(parsed.self, parsed);
});
