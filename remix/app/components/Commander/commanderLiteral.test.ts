import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { parseCommanderLiteral } from './commanderLiteral.ts';

test('Commander parses explicit data literals without JavaScript evaluation', () => {
	assert.equal(parseCommanderLiteral('42'), 42);
	assert.equal(parseCommanderLiteral('true'), true);
	assert.equal(parseCommanderLiteral('null'), null);
	assert.equal(parseCommanderLiteral('"hello"'), 'hello');
	assert.equal(parseCommanderLiteral("'hello'"), 'hello');
	assert.deepEqual(parseCommanderLiteral('{"ready":true}'), { ready: true });
	assert.deepEqual(parseCommanderLiteral('[1,2,3]'), [1, 2, 3]);
});

test('Commander preserves non-literal input as text and never executes it', () => {
	const marker = '__commanderLiteralExecuted';
	delete (globalThis as Record<string, unknown>)[marker];
	const hostile = '(() => { globalThis.__commanderLiteralExecuted = true })()';

	assert.equal(parseCommanderLiteral(hostile), hostile);
	assert.equal(parseCommanderLiteral('March 2024'), 'March 2024');
	assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
});

test('Commander retains its single-quoted string convenience safely', () => {
	assert.equal(parseCommanderLiteral("'it\\'s safe'"), "it's safe");
	assert.equal(parseCommanderLiteral("'a\\\\b'"), 'a\\b');
});
