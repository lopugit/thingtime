import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  consumeAuthReturnTo,
  readAuthReturnTo,
  rememberAuthReturnTo,
  safeAuthReturnPath,
  type AuthReturnStorage
} from './authReturn.ts';

const memoryStorage = (): AuthReturnStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
};

test('preserves safe app paths with query strings and hashes', () => {
  assert.equal(safeAuthReturnPath('/feed?algorithm=friends#latest'), '/feed?algorithm=friends#latest');
  assert.equal(safeAuthReturnPath('/'), '/');
});

test('rejects external, auth-loop, backslash, and API destinations', () => {
  for (const candidate of [
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example/steal',
    '/login?again=1',
    '/register/',
    '/api/v1/auth/me',
    `${'java'}script:alert(1)`
  ]) {
    assert.equal(safeAuthReturnPath(candidate), null, candidate);
  }
});

test('remembered destinations survive reads and are consumed once', () => {
  const storage = memoryStorage();
  assert.equal(rememberAuthReturnTo('/raw?view=table#results', storage), true);
  assert.equal(rememberAuthReturnTo('/login', storage), false);
  assert.equal(rememberAuthReturnTo('/register', storage), false);
  assert.equal(readAuthReturnTo('/', storage), '/raw?view=table#results');
  assert.equal(readAuthReturnTo('/', storage), '/raw?view=table#results');
  assert.equal(consumeAuthReturnTo('/', storage), '/raw?view=table#results');
  assert.equal(readAuthReturnTo('/', storage), '/');
});

test('invalid stored destinations fall back safely and are cleared', () => {
  const storage = memoryStorage();
  storage.setItem('thingtime:auth-return-to:v1', '//evil.example');
  assert.equal(consumeAuthReturnTo('/welcome', storage), '/welcome');
  assert.equal(readAuthReturnTo('/', storage), '/');
});
