import assert from 'node:assert/strict';
import test from 'node:test';
import { basic, deletesmart, escapeEscapes, getParent, getThing, local, mapsmart, merge, optIn, pathToString, ppa, ppp, pushOpts, replacer, setsmart, smarts, thingIn } from './index';

test('property path aliases preserve escaped and ordinary path segments', () => {
  assert.deepEqual(ppp('a.b'), ['a', 'b']);
  assert.equal(ppa(['a', 'b']), '["a"]["b"]');
  assert.equal(pathToString('a.b'), '["a"]["b"]');
  assert.equal(escapeEscapes('["a"]'), '[\\"a\\"]');
});

test('list helpers accept their implemented optional named and positional flags', () => {
  const list = [{ id: 'one' }];
  assert.equal(thingIn({ option: { id: 'one' }, list, keys: ['id'] }), true);
  assert.equal(getThing({ option: { id: 'one' }, list, keys: ['id'] }), list[0]);
  assert.equal(getThing({ option: { id: 'missing' }, list, keys: ['id'], defaultValue: 'missing' }), 'missing');
  assert.equal(optIn('one', ['one'], false, [], undefined), true);
  const strings = ['one'];
  pushOpts(['one', 'two'], strings, false, [], undefined);
  assert.deepEqual(strings, ['one', 'two']);
});

test('bound legacy parent lookup accepts numeric and dotted ancestor counts', () => {
  const lookup = getParent.bind({ pathAsArray: ['root', 'parent', 'child'] });
  assert.equal(lookup(1), 'parent');
  assert.equal(lookup('..'), 'parent');
  assert.equal(lookup(), 'root');
});

test('unbound writes and merge retain ordinary object behavior', () => {
  const obj = {};
  setsmart(obj, 'nested.value', 4);
  assert.deepEqual(obj, { nested: { value: 4 } });
  assert.deepEqual(merge({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  assert.equal(basic([]), false);
  assert.equal(basic(null), true);
});

test('standalone replacer uses supplied serialization state', () => {
  const known = new Map();
  const input = [];
  assert.equal(replacer('field', 'hello', { stringifier: (_key, value) => ({ key: value, value }), known, input }), '0');
  assert.deepEqual(input, ['hello']);
});


test('bound legacy helpers honor reactive setters and deletes', async () => {
  const previousVue = local.vue;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  local.vue = { reactiveSetter: true };
  const calls: string[] = [];
  const context = {
    $set(target: object, key: string, value: unknown) {
      calls.push(key);
      Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value });
    },
    $delete(target: object, key: string) {
      calls.push(`delete:${key}`);
      Reflect.deleteProperty(target, key);
    }
  };
  try {
    const obj = { nested: { value: 1 } };
    setsmart.bind(context)(obj, 'nested.value', 2);
    assert.equal(obj.nested.value, 2);
    merge.bind(context)(obj.nested, { added: 3 });
    deletesmart.bind(context)(obj, 'nested.value');
    assert.equal('value' in obj.nested, false);
    const list = [{ title: 'first' }];
    assert.equal(await mapsmart.bind(context)(list, 'title', undefined), true);
    assert.deepEqual(calls, ['value', 'added', 'delete:value', 'mapped', 'first']);
  } finally {
    local.vue = previousVue;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});


test('exported smarts namespace remains a supported method receiver', async () => {
  const obj = { nested: { value: 1 } };
  smarts.setsmart(obj, 'nested.value', 2);
  assert.equal(obj.nested.value, 2);
  smarts.merge(obj.nested, { added: 3 });
  assert.deepEqual(obj.nested, { value: 2, added: 3 });
  smarts.deletesmart(obj, 'nested.value');
  assert.deepEqual(obj.nested, { added: 3 });
  assert.equal(await smarts.mapsmart([{ title: 'first' }], 'title', undefined), true);
});
