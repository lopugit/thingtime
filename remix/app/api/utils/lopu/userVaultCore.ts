import { BlockList, isIP } from 'node:net';
import { normalizeLopuProviderEndpointSyntax } from './userVaultModel';
export * from './userVaultModel';

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4]
] as const)
	blockedIpv4.addSubnet(network, prefix, 'ipv4');

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['::ffff:0:0', 96],
	// NAT64 (RFC 6052 well-known prefix + RFC 8215 local-use): an IPv6 literal
	// that a translator would hand to a private IPv4 host
	['64:ff9b::', 96],
	['64:ff9b:1::', 48],
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const)
	blockedIpv6.addSubnet(network, prefix, 'ipv6');

export const isBlockedLopuProviderHostname = (hostname: string): boolean => {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	)
		return true;
	const kind = isIP(host);
	if (kind === 4) return blockedIpv4.check(host, 'ipv4');
	if (kind === 6) return blockedIpv6.check(host, 'ipv6');
	return false;
};

export const normalizeLopuProviderEndpoint = (value: unknown): string | null => {
 const endpoint = normalizeLopuProviderEndpointSyntax(value);
 return endpoint && !isBlockedLopuProviderHostname(new URL(endpoint).hostname) ? endpoint : null;
};
