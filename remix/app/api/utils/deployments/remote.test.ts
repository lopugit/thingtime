import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isBlockedDeploymentAddress,
  isBlockedDeploymentHostname,
  isUsableRemoteIdentity,
  normalizeDeploymentBaseUrl,
  remoteErrorText,
  resolvedDeploymentHostBlocked
} from './remote';

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

// ————— resolved-address fence —————
//
// The syntactic fence above only ever sees the string a user typed. A public
// NAME pointing at private space passes every one of those rules, so the
// address a resolver actually returns is judged separately.

test('reserved IPv4 space is refused whatever name pointed at it', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.5',
    '127.0.0.1',
    '169.254.169.254', // cloud metadata
    '172.16.0.9',
    '172.31.255.254',
    '192.168.1.10',
    '192.0.0.1',
    '100.64.0.1', // carrier-grade NAT
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '255.255.255.255'
  ]) {
    assert.equal(isBlockedDeploymentAddress(address, 4), true, `${address} should be blocked`);
  }
});

test('ordinary public IPv4 addresses stay allowed', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
    assert.equal(isBlockedDeploymentAddress(address, 4), false, `${address} should stay allowed`);
  }
});

test('reserved IPv6 space is refused, including v4-mapped spellings', () => {
  for (const address of [
    '::1', // loopback
    '::', // unspecified
    'fd00::1', // unique-local
    'fe80::1', // link-local
    'fec0::1', // site-local
    'ff02::1', // multicast
    '::ffff:169.254.169.254', // v4-mapped metadata, dotted spelling
    '::ffff:a9fe:a9fe', // the SAME address as a resolver may render it
    '::ffff:10.0.0.5',
    'fe80::1%eth0' // zone index must not defeat the check
  ]) {
    assert.equal(isBlockedDeploymentAddress(address, 6), true, `${address} should be blocked`);
  }
});

test('ordinary public IPv6 addresses stay allowed', () => {
  for (const address of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedDeploymentAddress(address, 6), false, `${address} should stay allowed`);
  }
});

test('an unparseable address is refused rather than guessed at', () => {
  assert.equal(isBlockedDeploymentAddress('not-an-address', 6), true);
  assert.equal(isBlockedDeploymentAddress('1.2.3', 4), true);
  assert.equal(isBlockedDeploymentAddress('1.2.3.999', 4), true);
});

test('an IP literal is judged directly by the resolved fence', async () => {
  assert.equal(await resolvedDeploymentHostBlocked('169.254.169.254'), true);
  assert.equal(await resolvedDeploymentHostBlocked('[fd00::1]'), true);
  assert.equal(await resolvedDeploymentHostBlocked('8.8.8.8'), false);
});

test('localhost-shaped hosts keep their documented dev exemption', async () => {
  // they resolve to loopback, which the address rules block by design — the
  // dev-against-dev path has to opt out explicitly or it would break
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'tt.localhost']) {
    assert.equal(await resolvedDeploymentHostBlocked(host), false, `${host} should stay allowed`);
  }
});

test('a name that does not resolve is not refused by this fence', async () => {
  // fetch() fails on it anyway; inventing a refusal would report a DNS outage
  // as "not a public deployment"
  assert.equal(await resolvedDeploymentHostBlocked('no-such-host.invalid'), false);
});

// ————— bounded untrusted strings —————
//
// The response-size cap bounds what we READ. These bound what we KEEP: an
// `error` reaches the link's stored lastSyncSummary (inside the owner's secure
// blob) and a toast, and the identity fields are written into the saved link.
// Megabytes in either would push the account document at Mongo's 16MB ceiling.

test('remote error text is truncated, not stored whole', () => {
  const huge = 'x'.repeat(50_000);
  const text = remoteErrorText(huge, 'fallback');
  assert.ok(text.length < 400, `expected a bounded string, got ${text.length} chars`);
  assert.ok(text.endsWith('…'), 'truncation should be visible to the reader');
  assert.ok(text.startsWith('xxxx'), 'the useful head of the remote complaint is kept');
});

test('a short remote error is passed through untouched', () => {
  assert.equal(remoteErrorText('Thing not found', 'fallback'), 'Thing not found');
  assert.equal(remoteErrorText('  padded  ', 'fallback'), 'padded');
});

test('a missing or non-string remote error falls back to our own wording', () => {
  // a remote answering { error: { nested: 1 } } must not become "[object Object]"
  for (const value of [undefined, null, '', '   ', 42, {}, [], { message: 'nope' }]) {
    assert.equal(remoteErrorText(value, 'fallback'), 'fallback', `${JSON.stringify(value)} should fall back`);
  }
});

test('oversized remote identities are refused rather than truncated', () => {
  // a silently shortened id would compare equal to itself on every later pass
  // and quietly bind the link to the wrong account string
  assert.equal(isUsableRemoteIdentity('x'.repeat(50_000)), false);
  assert.equal(isUsableRemoteIdentity(''), false);
  assert.equal(isUsableRemoteIdentity(undefined), false);
  assert.equal(isUsableRemoteIdentity(null), false);
  assert.equal(isUsableRemoteIdentity(42), false);
});

test('ordinary remote identities stay usable', () => {
  assert.equal(isUsableRemoteIdentity('68b3f2a1c9d4e5f60718293a'), true, 'a Mongo ObjectId hex');
  assert.equal(isUsableRemoteIdentity('nikolaj'), true);
});
