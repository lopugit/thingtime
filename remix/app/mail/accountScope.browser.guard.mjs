import assert from 'node:assert/strict';

/** Opt-in browser-test destination guard. Never grants production access. */
export function assertMailScopeTestOrigin(value) {
 assert.equal(typeof value, 'string', 'Mail scope test requires an exact HTTP loopback origin.');
 const url = new URL(value);
 assert.equal(url.protocol, 'http:', 'Mail scope test requires HTTP loopback.');
 assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Mail scope test requires a literal loopback host.');
 assert.ok(url.port, 'Mail scope test requires an explicit non-default port.');
 assert.equal(url.username, '', 'Mail scope test origin must not contain credentials.');
 assert.equal(url.password, '', 'Mail scope test origin must not contain credentials.');
 assert.equal(url.pathname, '/', 'Mail scope test origin must not contain a path.');
 assert.equal(url.search, '', 'Mail scope test origin must not contain a query.');
 assert.equal(url.hash, '', 'Mail scope test origin must not contain a fragment.');
 assert.equal(value, url.origin, 'Mail scope test requires an exact canonical origin without a trailing slash.');
 return url.origin;
}
