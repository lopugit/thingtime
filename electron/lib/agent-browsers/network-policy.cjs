'use strict';
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');

const NETWORK_MODES = Object.freeze([
  { value: 'isolated', label: 'Isolated testing', description: 'Only this task’s browser, app and database can communicate.' },
  { value: 'restricted', label: 'Restricted network', description: 'Allow only the IP addresses and ranges listed below.' },
  { value: 'unrestricted', label: 'Allow all network traffic', description: 'This task can reach the internet and production services.' }
]);
const DEFAULT_NETWORK_POLICY = Object.freeze({ mode: 'isolated', rules: [] });

function normalizeNetworkPolicy(value = DEFAULT_NETWORK_POLICY) {
  if (!value || typeof value !== 'object' || !NETWORK_MODES.some(mode => mode.value === value.mode)) throw new Error('Choose a supported network security level.');
  if (value.mode !== 'restricted') return { mode: value.mode, rules: [] };
  if (!Array.isArray(value.rules)) throw new Error('Add the IP addresses or ranges this task may use.');
  const seen = new Set();
  const rules = value.rules.map(rule => {
    if (!rule || typeof rule.address !== 'string') throw new Error('Each network rule needs an IP address or CIDR range.');
    const parts = rule.address.trim().split('/');
    const family = isIP(parts[0]);
    const bits = family === 4 ? 32 : 128;
    if (!family || parts[0].includes('%') || parts.length > 2 || (parts.length === 2 && (!/^(0|[1-9]\d*)$/.test(parts[1]) || Number(parts[1]) > bits))) throw new Error('Use a valid IPv4 or IPv6 address, optionally followed by a CIDR prefix.');
    const protocol = rule.protocol || 'any';
    if (!['any', 'tcp', 'udp'].includes(protocol)) throw new Error('Choose TCP, UDP or any protocol.');
    const ports = rule.ports ?? [];
    if (!Array.isArray(ports) || ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535) || (protocol === 'any' && ports.length)) throw new Error('Ports require TCP or UDP and values from 1 to 65535.');
    const normalized = { address: parts.join('/').toLowerCase(), protocol, ports: [...new Set(ports)].sort((a, b) => a - b) };
    const key = JSON.stringify(normalized);
    if (seen.has(key)) return null;
    seen.add(key);
    return normalized;
  }).filter(Boolean).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { mode: 'restricted', rules };
}

function resolveTaskNetworkPolicy(defaults, task = {}) {
  const policy = normalizeNetworkPolicy(task.useCustomSecurity === true ? task.network : defaults);
  return {
    ...policy,
    inherited: task.useCustomSecurity !== true,
    productionProtected: policy.mode === 'isolated',
    fingerprint: createHash('sha256').update(JSON.stringify(policy)).digest('hex')
  };
}

function firewallRules(policy) {
  const normalized = normalizeNetworkPolicy(policy);
  if (normalized.mode !== 'restricted') throw new Error('An IP firewall is only used for restricted sessions.');
  // Docker’s embedded resolver forwards DNS outside the task namespace. Deny
  // it before allowing loopback, so a DNS query cannot bypass this policy.
  const rules = [
    'table inet thingtime_agent {',
    // Run before Docker's output DNAT. Otherwise its embedded DNS destination
    // can be rewritten before the 127.0.0.11 refusal is evaluated.
    ' chain output { type filter hook output priority -150; policy drop;',
    '  ip daddr 127.0.0.11 drop',
    '  oifname "lo" accept',
    '  ct state established,related accept',
    ...normalized.rules.map(rule => {
      const family = isIP(rule.address.split('/')[0]) === 4 ? 'ip' : 'ip6';
      const transport = rule.protocol === 'any' ? '' : ` meta l4proto ${rule.protocol}`;
      const ports = rule.ports.length ? ` ${rule.protocol} dport { ${rule.ports.join(', ')} }` : '';
      return `  ${family} daddr ${rule.address}${transport}${ports} accept`;
    }),
    '  reject with icmpx type admin-prohibited',
    ' }',
    ' chain input { type filter hook input priority 0; policy drop;',
    '  iifname "lo" accept',
    '  ct state established,related accept',
    ' }',
    '}'
  ];
  return rules.join('\n') + '\n';
}

module.exports = { NETWORK_MODES, DEFAULT_NETWORK_POLICY, normalizeNetworkPolicy, resolveTaskNetworkPolicy, firewallRules };
