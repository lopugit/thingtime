import assert from 'node:assert/strict';
import test from 'node:test';

import { isBlockedDeploymentHostname, normalizeDeploymentBaseUrl } from './remote';

// `normalizeDeploymentBaseUrl` is the ONLY gate between a signed-in user's
// typed string and a server-side fetch, so every rule it enforces is load
// bearing. It returns a bare origin string on success and a Fail object
// ({ ok: false, status, error }) on rejection.
const accepted = (value: unknown): string | null => {
  const result = normalizeDeploymentBaseUrl(value);
  return typeof result === 'string' ? result : null;
};

const rejected = (value: unknown): boolean => typeof normalizeDeploymentBaseUrl(value) !== 'string';

test('a bare public hostname is normalised to an https origin', () => {
  assert.equal(accepted('thingtime.com'), 'https://thingtime.com');
  assert.equal(accepted('  https://dev.thingtime.com  '), 'https://dev.thingtime.com');
  assert.equal(accepted('https://thingtime.com/'), 'https://thingtime.com');
});

test('a port is preserved in the origin', () => {
  assert.equal(accepted('https://deploy.example.com:8443'), 'https://deploy.example.com:8443');
});

test('credentials embedded in the URL are refused', () => {
  // otherwise the stored baseUrl itself becomes a credential store
  assert.ok(rejected('https://user:pass@thingtime.com'));
  assert.ok(rejected('https://user@thingtime.com'));
});

test('non-http(s) schemes are refused', () => {
  for (const value of ['ftp://thingtime.com', 'file:///etc/passwd', 'gopher://thingtime.com']) {
    assert.ok(rejected(value), `${value} should be refused`);
  }
});

test('plain http is refused for remote hosts but allowed for localhost dev', () => {
  assert.ok(rejected('http://thingtime.com'));
  assert.equal(accepted('http://localhost:9999'), 'http://localhost:9999');
  assert.equal(accepted('http://127.0.0.1:9999'), 'http://127.0.0.1:9999');
  assert.equal(accepted('http://tt.localhost:9999'), 'http://tt.localhost:9999');
});

test('origins only — a path, query, or fragment is refused', () => {
  for (const value of ['https://thingtime.com/api/v1', 'https://thingtime.com?a=1', 'https://thingtime.com#x']) {
    assert.ok(rejected(value), `${value} should be refused`);
  }
});

test('empty and non-string inputs are refused', () => {
  for (const value of ['', '   ', null, undefined, 42, {}, []]) {
    assert.ok(rejected(value), `${String(value)} should be refused`);
  }
});

// ————— SSRF fence —————

test('IP-literal hosts are refused — a deployment is reached by name', () => {
  // private ranges, link-local (cloud metadata), and public IPs alike: an
  // address literal is either internal or an attempt to skip name-based vetting
  for (const host of ['10.0.0.5', '192.168.1.10', '172.16.0.9', '169.254.169.254', '100.100.100.200', '8.8.8.8']) {
    assert.equal(isBlockedDeploymentHostname(host), true, `${host} should be blocked`);
    assert.ok(rejected(`https://${host}`), `https://${host} should be refused`);
  }
});

test('IPv6 literals are refused too, brackets and all', () => {
  assert.equal(isBlockedDeploymentHostname('[fd00::1]'), true);
  assert.equal(isBlockedDeploymentHostname('fd00::1'), true);
  assert.ok(rejected('https://[fd00::1]'));
});

test('internal-only suffixes are refused', () => {
  for (const host of ['metadata.google.internal', 'db.internal', 'printer.local', 'SERVICE.INTERNAL']) {
    assert.equal(isBlockedDeploymentHostname(host), true, `${host} should be blocked`);
  }
  assert.ok(rejected('https://metadata.google.internal'));
});

test('the localhost dev path stays exempt from the SSRF fence', () => {
  // these are only reachable from a URL the operator typed on their own machine
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'tt.localhost']) {
    assert.equal(isBlockedDeploymentHostname(host), false, `${host} should stay allowed`);
  }
});

test('ordinary public deployment hostnames are not blocked', () => {
  for (const host of ['thingtime.com', 'dev.thingtime.com', 'thingtime-abc.vercel.app', 'internal-tools.example.com']) {
    assert.equal(isBlockedDeploymentHostname(host), false, `${host} should stay allowed`);
  }
});
