'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNetworkPolicy, resolveTaskNetworkPolicy, firewallRules } = require('../lib/agent-browsers/network-policy.cjs');

test('task checkbox selects an override and running policy snapshots do not follow later defaults', () => {
  const defaults = { mode: 'isolated', rules: [] };
  const running = resolveTaskNetworkPolicy(defaults, { useCustomSecurity: false, network: { mode: 'unrestricted' } });
  assert.equal(running.mode, 'isolated');
  assert.equal(running.productionProtected, true);
  defaults.mode = 'unrestricted';
  assert.equal(running.mode, 'isolated');
  const overridden = resolveTaskNetworkPolicy(defaults, { useCustomSecurity: true, network: { mode: 'restricted', rules: [] } });
  assert.equal(overridden.mode, 'restricted');
  assert.equal(overridden.inherited, false);
  assert.equal(overridden.productionProtected, false);
  assert.notEqual(overridden.fingerprint, running.fingerprint);
});

test('IP rules cannot inject firewall statements or masquerade hostnames as addresses', () => {
  for (const address of ['example.com', '1.2.3.4 accept; accept', '127.0.0.1/33', '::1/129', '1.2.3.4/0/1', '1.2.3.4/-1']) {
    assert.throws(() => normalizeNetworkPolicy({ mode: 'restricted', rules: [{ address }] }));
  }
  assert.throws(() => normalizeNetworkPolicy({ mode: 'restricted', rules: [{ address: '1.1.1.1', protocol: 'tcp', ports: ['443 accept'] }] }));
  assert.throws(() => normalizeNetworkPolicy({ mode: 'restricted', rules: [{ address: '1.1.1.1', ports: [443] }] }));
  const policy = normalizeNetworkPolicy({ mode: 'restricted', rules: [{ address: '1.1.1.1', protocol: 'tcp', ports: [443, 443] }, { address: '2001:db8::/32' }] });
  const compiled = firewallRules(policy);
  assert.match(compiled, /policy drop/);
  assert.match(compiled, /ip daddr 1.1.1.1 meta l4proto tcp tcp dport \{ 443 \} accept/);
  assert.match(compiled, /ip6 daddr 2001:db8::\/32 accept/);
  assert.ok(compiled.indexOf('127.0.0.11 drop') < compiled.indexOf('oifname "lo" accept'));
});
