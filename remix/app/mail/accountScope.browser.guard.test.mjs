import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMailScopeTestOrigin } from './accountScope.browser.guard.mjs';

test('mail scope browser guard accepts only exact HTTP literal-loopback origins with explicit ports', () => {
 for (const value of ['http://127.0.0.1:18724', 'http://[::1]:18724']) assert.equal(assertMailScopeTestOrigin(value), value);
 for (const value of [undefined, null, '', 'not a URL', 'https://127.0.0.1:18724', 'http://localhost:18724',
  'http://thingtime.com:18724', 'http://127.0.0.1.example:18724', 'http://[::ffff:127.0.0.1]:18724',
  'http://127.0.0.1', 'http://127.0.0.1:80', 'http://127.0.0.1:18724/', 'http://127.0.0.1:18724/mail',
  'http://user@127.0.0.1:18724', 'http://user:password@127.0.0.1:18724',
  'http://127.0.0.1:18724?scope=test', 'http://127.0.0.1:18724#mail', ' http://127.0.0.1:18724',
  'http://127.0.0.1:18724 ', 'http://127.1:18724', 'http://2130706433:18724']) {
  assert.throws(() => assertMailScopeTestOrigin(value), `Reject ${String(value)}`);
 }
});
