import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { parsePartialJson } from './partialJson.ts';

test('a complete document parses exactly like JSON.parse and reports complete', () => {
  const result = parsePartialJson('{"a": [1, 2, {"b": "c"}], "d": true, "e": null}');
  assert.equal(result.complete, true);
  assert.deepEqual(result.value, { a: [1, 2, { b: 'c' }], d: true, e: null });
});

test('an open string yields the characters so far', () => {
  const result = parsePartialJson('{"name": "Hel');
  assert.equal(result.complete, false);
  assert.deepEqual(result.value, { name: 'Hel' });
});

test('open arrays and objects close from the inside out', () => {
  const result = parsePartialJson('{"blocks": [{"id": "hero", "type": "container", "children": [{"id": "t", "type": "text", "text": "Hi');
  assert.equal(result.complete, false);
  assert.deepEqual(result.value, { blocks: [{ id: 'hero', type: 'container', children: [{ id: 't', type: 'text', text: 'Hi' }] }] });
});

test('a dangling key is never materialised — with or without its colon', () => {
  assert.deepEqual(parsePartialJson('{"a": 1, "b').value, { a: 1 });
  assert.deepEqual(parsePartialJson('{"a": 1, "b"').value, { a: 1 });
  assert.deepEqual(parsePartialJson('{"a": 1, "b":').value, { a: 1 });
  assert.deepEqual(parsePartialJson('{"a": 1, "b": ').value, { a: 1 });
});

test('trailing commas are tolerated', () => {
  assert.deepEqual(parsePartialJson('[1, 2,').value, [1, 2]);
  assert.deepEqual(parsePartialJson('{"a": 1,').value, { a: 1 });
});

test('truncated literals resolve by their first letter, truncated numbers keep their prefix', () => {
  assert.deepEqual(parsePartialJson('{"ok": tr').value, { ok: true });
  assert.deepEqual(parsePartialJson('[fa').value, [false]);
  assert.deepEqual(parsePartialJson('{"x": nu').value, { x: null });
  assert.deepEqual(parsePartialJson('{"n": 12').value, { n: 12 });
  assert.deepEqual(parsePartialJson('{"n": -').value, {});
  assert.deepEqual(parsePartialJson('{"n": 1.').value, { n: 1 });
  assert.deepEqual(parsePartialJson('{"n": 1e').value, { n: 1 });
  assert.deepEqual(parsePartialJson('[1.5e+2, 3').value, [150, 3]);
});

test('escape sequences survive, and a half-streamed escape is dropped', () => {
  assert.deepEqual(parsePartialJson('{"s": "a\\"b\\n').value, { s: 'a"b\n' });
  assert.deepEqual(parsePartialJson('{"s": "a\\').value, { s: 'a' });
  assert.deepEqual(parsePartialJson('{"s": "\\u00e9\\u00').value, { s: 'é' });
  assert.deepEqual(parsePartialJson('"\\u2603 snow"').value, '☃ snow');
});

test('empty or whitespace input is undefined and incomplete', () => {
  assert.deepEqual(parsePartialJson(''), { value: undefined, complete: false });
  assert.deepEqual(parsePartialJson('   \n'), { value: undefined, complete: false });
  assert.deepEqual(parsePartialJson(undefined as unknown as string), { value: undefined, complete: false });
});

test('garbage stops at the last consistent point instead of throwing', () => {
  assert.deepEqual(parsePartialJson('{"a": 1, }}}').value, { a: 1 });
  assert.deepEqual(parsePartialJson('{"a": 1, b: 2}').value, { a: 1 });
  assert.deepEqual(parsePartialJson('hello').value, undefined);
  assert.deepEqual(parsePartialJson('{"a": [1, ]').value, { a: [1] });
});

test('__proto__ keys never land on the result object', () => {
  const result = parsePartialJson('{"__proto__": {"polluted": true}, "a": 1');
  assert.deepEqual(result.value, { a: 1 });
  assert.equal(({} as any).polluted, undefined);
});

test('every prefix of a streamed tool input parses, and the full text matches JSON.parse', () => {
  const full = JSON.stringify({
    name: 'Pricing',
    componentKey: 'pricing-card',
    args: [{ name: 'title', type: 'string', default: 'Pro ✨' }],
    render: { tag: 'div', props: { style: { padding: '16px' } }, children: ['{title}', { tag: 'span', children: ['$9 / mo'] }] },
    public: false,
    weights: [0.5, -2, 1e3]
  });
  let previousKeys = 0;
  for (let cut = 1; cut <= full.length; cut++) {
    const result = parsePartialJson(full.slice(0, cut));
    // never throws, and once the root object opens it is always an object
    if (cut >= 1) assert.equal(typeof result.value === 'object' || result.value === undefined, true, `prefix ${cut}`);
    if (result.value && typeof result.value === 'object') {
      const keys = Object.keys(result.value as object).length;
      assert.ok(keys >= previousKeys, `keys never regress at prefix ${cut}`);
      previousKeys = keys;
    }
  }
  const final = parsePartialJson(full);
  assert.equal(final.complete, true);
  assert.deepEqual(final.value, JSON.parse(full));
});
