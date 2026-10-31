import { json } from '~/api/http';
import {
	announcePeer,
	boundedPeerLimit,
	decodePeerCursor,
	getPeerSigningIdentity,
	getSelfPeerOrigin,
	listActivePeers,
	normalizePeerOrigin,
	PEER_SYNC_MAX_ORIGINS,
	PeerIdentityMismatchError,
	signedPeerNdjsonResponse,
	syncPeerMesh,
	verifyPeerRequest
} from '~/api/utils/peers/peerDiscovery';
import { enforceFixedRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 4096;

const peerBody = async (request: Request) => {
	const declared = Number(request.headers.get('content-length') || 0);
	if (declared > MAX_BODY_BYTES) return null;
	const body = await request.text();
	if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return null;
	return body;
};

const boundedPeerRate = (request: Request, origin: string) =>
	enforceFixedRateLimit(request, 'peer.discovery', `peer:${origin}`, { limit: 60, windowMs: 60_000 });

const pinAuthenticatedPeer = async (
	origin: string,
	publicKey: string,
	dataEnvironment: Parameters<typeof announcePeer>[2]
) => {
	try {
		await announcePeer(origin, publicKey, dataEnvironment);
		return null;
	} catch (error) {
		if (error instanceof PeerIdentityMismatchError)
			return json({ ok: false, error: 'Peer signing key does not match its pinned identity' }, { status: 409 });
		throw error;
	}
};

// GET /api/v1/peers — an authenticated, capped NDJSON page. This intentionally
// never returns a materialized "all peers" JSON array.
export const loader = async ({ request }: { request: Request }) => {
	if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
	const auth = verifyPeerRequest(request);
	if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
	const rate = await boundedPeerRate(request, auth.origin);
	if (!rate.allowed) return json({ ok: false, error: 'Peer discovery is moving too quickly' }, rateLimitedResponseInit(rate));
	const pinError = await pinAuthenticatedPeer(auth.origin, auth.publicKey, auth.dataEnvironment);
	if (pinError) return pinError;

	const page = await listActivePeers({
		cursor: decodePeerCursor(new URL(request.url).searchParams.get('cursor')),
		limit: boundedPeerLimit(new URL(request.url).searchParams.get('limit')),
		dataEnvironment: auth.dataEnvironment
	});
	const identity = getPeerSigningIdentity();
	const selfOrigin = getSelfPeerOrigin(request);
	if (!identity || !selfOrigin) return json({ ok: false, error: 'Peer discovery is not configured' }, { status: 503 });
	return signedPeerNdjsonResponse(identity, selfOrigin, auth.dataEnvironment, [
		...page.peers.map((peer) => ({ type: 'peer', peer })),
		{ type: 'page.complete', nextCursor: page.nextCursor, count: page.peers.length }
	]);
};

// POST /api/v1/peers — signed announcement, or a bounded self-sync which
// announces to the production bootstrap then gossips through a capped peer set.
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
	const raw = await peerBody(request);
	if (raw === null) return json({ ok: false, error: 'Peer request body is too large' }, { status: 413 });
	const auth = verifyPeerRequest(request, raw);
	if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
	const rate = await boundedPeerRate(request, auth.origin);
	if (!rate.allowed) return json({ ok: false, error: 'Peer discovery is moving too quickly' }, rateLimitedResponseInit(rate));
	const pinError = await pinAuthenticatedPeer(auth.origin, auth.publicKey, auth.dataEnvironment);
	if (pinError) return pinError;
	let body: any;
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ ok: false, error: 'Peer request must be JSON' }, { status: 400 });
	}

	if (body?.op === 'announce') {
		const origin = normalizePeerOrigin(body.origin, { allowLoopback: process.env.NODE_ENV === 'test' });
		if (!origin || origin !== auth.origin || Object.keys(body).some((key) => key !== 'op' && key !== 'origin')) {
			return json({ ok: false, error: 'Peer announcement is invalid' }, { status: 400 });
		}
		return json({ ok: true, peer: await announcePeer(origin, auth.publicKey, auth.dataEnvironment) });
	}

	if (body?.op === 'sync' && Object.keys(body).length === 1) {
		const selfOrigin = getSelfPeerOrigin(request);
		if (!selfOrigin || selfOrigin !== auth.origin)
			return json({ ok: false, error: 'Only a deployment may start its own peer sync' }, { status: 403 });
		const identity = getPeerSigningIdentity();
		if (!identity) return json({ ok: false, error: 'Peer discovery is not configured' }, { status: 503 });
		return signedPeerNdjsonResponse(identity, selfOrigin, auth.dataEnvironment, syncPeerMesh({ selfOrigin }));
	}

	return json({ ok: false, error: 'Unknown peer operation' }, { status: 400 });
};

export const PEER_DISCOVERY_LIMITS = { maxBodyBytes: MAX_BODY_BYTES, maxSyncOrigins: PEER_SYNC_MAX_ORIGINS };
