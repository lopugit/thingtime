export type PeerExplorerRow = {
	origin: string;
	signingPublicKey: string;
	firstSeenAt: string;
	lastSeenAt: string;
	expiresAt: string;
	status: 'active' | 'expired';
};

export type PeerExplorerField = 'all' | keyof PeerExplorerRow;

export const PEER_EXPLORER_FIELDS: Array<{ value: PeerExplorerField; label: string }> = [
	{ value: 'all', label: 'All peer properties' },
	{ value: 'origin', label: 'Origin' },
	{ value: 'status', label: 'Lease status' },
	{ value: 'signingPublicKey', label: 'Signing public key' },
	{ value: 'firstSeenAt', label: 'First seen' },
	{ value: 'lastSeenAt', label: 'Last seen' },
	{ value: 'expiresAt', label: 'Lease expiry' }
];

const searchValue = (value: unknown) => (value === null || value === undefined ? '' : String(value).toLocaleLowerCase());

export const peerValueMatches = (peer: PeerExplorerRow, query: string, field: PeerExplorerField = 'all') => {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	if (field !== 'all') return searchValue(peer[field]).includes(needle);
	return Object.values(peer).some((value) => searchValue(value).includes(needle));
};

export const filterPeerExplorerRows = (peers: PeerExplorerRow[], query: string, field: PeerExplorerField = 'all') =>
	peers.filter((peer) => peerValueMatches(peer, query, field));

export const mergePeerExplorerPage = (current: PeerExplorerRow[], incoming: PeerExplorerRow[]) => {
	const byOrigin = new Map(current.map((peer) => [peer.origin, peer]));
	incoming.forEach((peer) => byOrigin.set(peer.origin, peer));
	return [...byOrigin.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.origin.localeCompare(right.origin));
};
