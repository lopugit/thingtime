import { createHash, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';

import { getDeploymentDataEnvironment, type DeploymentDataEnvironment } from '../deployment/dataEnvironment';
import { getDeploymentPeersCollection } from '../mongodb/collections';

export const PEER_DISCOVERY_PROTOCOL_VERSION = 2;
export const PEER_LEASE_MS = 10 * 60_000;
export const PEER_STREAM_DEFAULT_LIMIT = 25;
export const PEER_STREAM_MAX_LIMIT = 50;
export const PEER_SYNC_MAX_ORIGINS = 8;
export const PEER_SYNC_MAX_RESPONSE_BYTES = 256 * 1024;
export const PEER_SIGNATURE_MAX_SKEW_MS = 5 * 60_000;

export type PeerPublicRecord = {
	origin: string;
	signingPublicKey: string;
	dataEnvironment: Pick<DeploymentDataEnvironment, 'id' | 'kind' | 'federationId'>;
	firstSeenAt: string;
	lastSeenAt: string;
	expiresAt: string;
};
// The browser-facing developer projection intentionally contains only the
// lease's public identity, its non-secret data-authority descriptor, and
// observed timestamps. In particular, it never exposes `syncCursor`, request
// signatures, or any deployment secret.
export type PeerExplorerRecord = PeerPublicRecord & { status: 'active' | 'expired' };
export type PeerCursor = { lastSeenAt: string; origin: string };

type PeerSigningIdentity = { privateKey: ReturnType<typeof createPrivateKey>; publicKey: string };
export class PeerIdentityMismatchError extends Error {}

const base64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const unbase64url = (value: string) => Buffer.from(value, 'base64url').toString('utf8');
const bodyDigest = (body: string) => createHash('sha256').update(body).digest('hex');
const canonicalJson = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(',')}}`;
};
const digestJson = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const federationIdFromWire = (value: unknown): string | null =>
	typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value) ? value : null;

const peerIdentityFromPrivateKey = (value: string): PeerSigningIdentity | null => {
	try {
		const privateKey = createPrivateKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'pkcs8' });
		if (privateKey.asymmetricKeyType !== 'ed25519') return null;
		const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64url');
		return { privateKey, publicKey };
	} catch {
		return null;
	}
};

const peerPublicKeyFromWire = (value: unknown) => {
	if (typeof value !== 'string' || value.length < 40 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
	try {
		const publicKey = createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
		return publicKey.asymmetricKeyType === 'ed25519' ? publicKey : null;
	} catch {
		return null;
	}
};

export const getPeerSigningIdentity = () => peerIdentityFromPrivateKey(process.env.THINGTIME_PEER_SIGNING_PRIVATE_KEY?.trim() || '');

const allowedPeerHost = (hostname: string) => {
	const configured = (process.env.THINGTIME_PEER_ALLOWED_HOST_SUFFIXES || 'thingtime.com,vercel.app')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
	return configured.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
};

export const normalizePeerOrigin = (value: unknown, { allowLoopback = false } = {}): string | null => {
	if (typeof value !== 'string' || value.length > 512) return null;
	try {
		const url = new URL(value.trim());
		const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
		if (
			(url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && loopback)) ||
			url.username ||
			url.password ||
			url.pathname !== '/' ||
			url.search ||
			url.hash ||
			(loopback && !allowLoopback) ||
			(!loopback && !allowedPeerHost(url.hostname.toLowerCase()))
		) {
			return null;
		}
		return url.origin;
	} catch {
		return null;
	}
};

export const getPeerDiscoverySecret = () => {
	const value = process.env.THINGTIME_PEER_DISCOVERY_SECRET?.trim() || '';
	return value.length >= 32 ? value : null;
};

export const peerSigningPayload = (method: string, path: string, timestamp: string, body: string, federationId: string) =>
	`${PEER_DISCOVERY_PROTOCOL_VERSION}\n${federationId}\n${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyDigest(body)}`;

const publicPeerSigningPayload = (method: string, path: string, timestamp: string, body: string, publicKey: string, federationId: string) =>
	`${peerSigningPayload(method, path, timestamp, body, federationId)}\n${publicKey}`;

const peerStreamSigningPayload = (origin: string, timestamp: string, event: unknown, publicKey: string, federationId: string) =>
	`${PEER_DISCOVERY_PROTOCOL_VERSION}\npeer-stream\n${origin}\n${federationId}\n${timestamp}\n${digestJson(event)}\n${publicKey}`;

export const signPeerRequest = (secret: string, method: string, path: string, timestamp: string, body = '', federationId?: string) => {
	const resolvedFederationId = federationId || getDeploymentDataEnvironment()?.federationId;
	if (!resolvedFederationId) throw new Error('Peer data environment is not configured');
	return createHmac('sha256', secret)
		.update(peerSigningPayload(method, path, timestamp, body, resolvedFederationId))
		.digest('base64url');
};

const signWithPeerIdentity = (identity: PeerSigningIdentity, payload: string) =>
	sign(null, Buffer.from(payload), identity.privateKey).toString('base64url');

export const signPeerPublicRequest = (method: string, path: string, timestamp: string, body = '', federationId?: string) => {
	const identity = getPeerSigningIdentity();
	const resolvedFederationId = federationId || getDeploymentDataEnvironment()?.federationId;
	if (!identity || !resolvedFederationId) throw new Error('Peer signing identity or data environment is not configured');
	return {
		publicKey: identity.publicKey,
		signature: signWithPeerIdentity(identity, publicPeerSigningPayload(method, path, timestamp, body, identity.publicKey, resolvedFederationId))
	};
};

const verifyPeerSignature = (publicKey: string, signature: string, payload: string) => {
	const key = peerPublicKeyFromWire(publicKey);
	if (!key || !/^[A-Za-z0-9_-]{86}$/.test(signature) || Buffer.from(signature, 'base64url').toString('base64url') !== signature) return false;
	try {
		return verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64url'));
	} catch {
		return false;
	}
};

export const verifyPeerRequest = (request: Request, body = '', now = Date.now()) => {
	const secret = getPeerDiscoverySecret();
	const dataEnvironment = getDeploymentDataEnvironment();
	if (!secret || !getPeerSigningIdentity() || !dataEnvironment)
		return { ok: false as const, status: 503, error: 'Peer discovery is not configured' };
	const origin = normalizePeerOrigin(request.headers.get('x-thingtime-peer-origin'), { allowLoopback: process.env.NODE_ENV === 'test' });
	const federationId = federationIdFromWire(request.headers.get('x-thingtime-peer-federation-id'));
	const timestamp = request.headers.get('x-thingtime-peer-timestamp') || '';
	const signature = request.headers.get('x-thingtime-peer-signature') || '';
	const publicKey = request.headers.get('x-thingtime-peer-public-key') || '';
	const publicSignature = request.headers.get('x-thingtime-peer-public-signature') || '';
	const timestampMs = Date.parse(timestamp);
	if (
		!origin ||
		!federationId ||
		federationId !== dataEnvironment.federationId ||
		!Number.isFinite(timestampMs) ||
		Math.abs(now - timestampMs) > PEER_SIGNATURE_MAX_SKEW_MS ||
		!/^[A-Za-z0-9_-]{43}$/.test(signature)
	) {
		return { ok: false as const, status: 401, error: 'Unauthorized peer request' };
	}
	const url = new URL(request.url);
	const expected = signPeerRequest(secret, request.method, `${url.pathname}${url.search}`, timestamp, body, federationId);
	const actualBytes = Buffer.from(signature);
	const expectedBytes = Buffer.from(expected);
	if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
		return { ok: false as const, status: 401, error: 'Unauthorized peer request' };
	}
	if (
		!verifyPeerSignature(
			publicKey,
			publicSignature,
			publicPeerSigningPayload(request.method, `${url.pathname}${url.search}`, timestamp, body, publicKey, federationId)
		)
	) {
		return { ok: false as const, status: 401, error: 'Unauthorized peer request' };
	}
	return { ok: true as const, origin, publicKey, dataEnvironment };
};

export const encodePeerCursor = (cursor: PeerCursor) => base64url(JSON.stringify(cursor));
export const decodePeerCursor = (value: string | null): PeerCursor | null => {
	if (!value || value.length > 512) return null;
	try {
		const parsed = JSON.parse(unbase64url(value));
		return typeof parsed?.lastSeenAt === 'string' && typeof parsed?.origin === 'string' && normalizePeerOrigin(parsed.origin) ? parsed : null;
	} catch {
		return null;
	}
};

export const boundedPeerLimit = (value: string | null) => {
	const parsed = Number(value);
	return Number.isInteger(parsed) ? Math.max(1, Math.min(PEER_STREAM_MAX_LIMIT, parsed)) : PEER_STREAM_DEFAULT_LIMIT;
};

const projectPeer = (row: any): PeerPublicRecord => ({
	origin: row.origin,
	signingPublicKey: row.signingPublicKey,
	dataEnvironment: {
		id: row.dataEnvironmentId,
		kind: row.dataEnvironmentKind,
		federationId: row.federationId
	},
	firstSeenAt: new Date(row.firstSeenAt).toISOString(),
	lastSeenAt: new Date(row.lastSeenAt).toISOString(),
	expiresAt: new Date(row.expiresAt).toISOString()
});

const projectPeerExplorer = (row: any, now: Date): PeerExplorerRecord => ({
	...projectPeer(row),
	status: new Date(row.expiresAt).getTime() > now.getTime() ? 'active' : 'expired'
});

export const announcePeer = async (
	origin: string,
	signingPublicKey: string,
	dataEnvironment: DeploymentDataEnvironment,
	now = new Date()
): Promise<PeerPublicRecord> => {
	const canonical = normalizePeerOrigin(origin, { allowLoopback: process.env.NODE_ENV === 'test' });
	if (!canonical || !peerPublicKeyFromWire(signingPublicKey)) throw new Error('Invalid peer identity');
	const expiresAt = new Date(now.getTime() + PEER_LEASE_MS);
	const peers = await getDeploymentPeersCollection();
	let result;
	try {
		result = await peers.updateOne(
			{
				origin: canonical,
				$and: [
					{ $or: [{ signingPublicKey: { $exists: false } }, { signingPublicKey }] },
					{ $or: [{ federationId: { $exists: false } }, { federationId: dataEnvironment.federationId }] }
				]
			},
			{
				$setOnInsert: { origin: canonical, firstSeenAt: now, schemaVersion: 1 },
				$set: {
					signingPublicKey,
					dataEnvironmentId: dataEnvironment.id,
					dataEnvironmentKind: dataEnvironment.kind,
					federationId: dataEnvironment.federationId,
					lastSeenAt: now,
					expiresAt,
					updatedAt: now
				}
			},
			{ upsert: true }
		);
	} catch (error: any) {
		if (error?.code === 11000) throw new PeerIdentityMismatchError('Peer signing key does not match its pinned identity');
		throw error;
	}
	if (!result.acknowledged || (!result.matchedCount && !result.upsertedCount))
		throw new PeerIdentityMismatchError('Peer signing key does not match its pinned identity');
	const row = await peers.findOne({ origin: canonical });
	if (!row?.signingPublicKey || row.federationId !== dataEnvironment.federationId)
		throw new Error('Peer signing identity was not retained');
	return projectPeer(row);
};

export const listActivePeers = async ({
	cursor,
	limit,
	dataEnvironment,
	now = new Date()
}: {
	cursor: PeerCursor | null;
	limit: number;
	dataEnvironment: Pick<DeploymentDataEnvironment, 'federationId'>;
	now?: Date;
}) => {
	const filter: any = {
		expiresAt: { $gt: now },
		signingPublicKey: { $exists: true },
		federationId: dataEnvironment.federationId
	};
	if (cursor) {
		filter.$or = [{ lastSeenAt: { $lt: new Date(cursor.lastSeenAt) } }, { lastSeenAt: new Date(cursor.lastSeenAt), origin: { $gt: cursor.origin } }];
	}
	const rows = await (
		await getDeploymentPeersCollection()
	)
		.find(filter)
		.sort({ lastSeenAt: -1, origin: 1 })
		.limit(limit + 1)
		.toArray();
	const page = rows.slice(0, limit).map(projectPeer);
	const next =
		rows.length > limit && page.length
			? encodePeerCursor({ lastSeenAt: page[page.length - 1].lastSeenAt, origin: page[page.length - 1].origin })
			: null;
	return { peers: page, nextCursor: next };
};

// Admin-only diagnostic read. It uses exactly the same keyset cursor and
// maximum page limit as the signed mesh route, but includes temporarily
// expired rows until MongoDB's TTL monitor reaps them. That makes lease health
// visible without creating an all-peers browser endpoint or revealing the
// private traversal cursor held on each row.
export const listKnownPeers = async ({ cursor, limit, now = new Date() }: { cursor: PeerCursor | null; limit: number; now?: Date }) => {
	const filter: any = { signingPublicKey: { $exists: true } };
	if (cursor) {
		filter.$or = [{ lastSeenAt: { $lt: new Date(cursor.lastSeenAt) } }, { lastSeenAt: new Date(cursor.lastSeenAt), origin: { $gt: cursor.origin } }];
	}
	const rows = await (
		await getDeploymentPeersCollection()
	)
		.find(filter)
		.sort({ lastSeenAt: -1, origin: 1 })
		.limit(limit + 1)
		.toArray();
	const peers = rows.slice(0, limit).map((row) => projectPeerExplorer(row, now));
	const nextCursor =
		rows.length > limit && peers.length
			? encodePeerCursor({ lastSeenAt: peers[peers.length - 1].lastSeenAt, origin: peers[peers.length - 1].origin })
			: null;
	return { peers, nextCursor };
};

const validRemoteCursor = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);

// Consume at most one remote page per peer per pass. The cursor belongs to the
// peer's own lease row so repeated bounded syncs traverse a large mesh over
// time instead of asking any deployment for an all-peers payload.
const getPeerSyncCursor = async (origin: string): Promise<string | null> => {
	const row = await (await getDeploymentPeersCollection()).findOne({ origin }, { projection: { syncCursor: 1 } });
	return validRemoteCursor(row?.syncCursor) ? row.syncCursor : null;
};

const setPeerSyncCursor = async (origin: string, cursor: string | null) => {
	await (await getDeploymentPeersCollection()).updateOne({ origin }, { $set: { syncCursor: cursor, updatedAt: new Date() } });
};

export const ndjsonResponse = (lines: Iterable<unknown> | AsyncIterable<unknown>) => {
	const encoder = new TextEncoder();
	const iterator =
		Symbol.asyncIterator in Object(lines)
			? (lines as AsyncIterable<unknown>)[Symbol.asyncIterator]()
			: (lines as Iterable<unknown>)[Symbol.iterator]();
	return new Response(
		new ReadableStream({
			async pull(controller) {
				const next = await iterator.next();
				if (next.done) return controller.close();
				controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
			}
		}),
		{ headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } }
	);
};

type PeerStreamSigner = { origin: string; federationId: string; publicKey: string; timestamp: string; signature: string };

export const signedPeerStreamEvent = (
	identity: PeerSigningIdentity,
	origin: string,
	dataEnvironment: Pick<DeploymentDataEnvironment, 'federationId'>,
	event: Record<string, unknown>
) => {
	const timestamp = new Date().toISOString();
	return {
		...event,
		signer: {
			origin,
			federationId: dataEnvironment.federationId,
			publicKey: identity.publicKey,
			timestamp,
			signature: signWithPeerIdentity(identity, peerStreamSigningPayload(origin, timestamp, event, identity.publicKey, dataEnvironment.federationId))
		} satisfies PeerStreamSigner
	};
};

export const signedPeerNdjsonResponse = (
	identity: PeerSigningIdentity,
	origin: string,
	dataEnvironment: Pick<DeploymentDataEnvironment, 'federationId'>,
	lines: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>
) => {
	async function* signedLines() {
		for await (const line of lines) yield signedPeerStreamEvent(identity, origin, dataEnvironment, line);
	}
	return ndjsonResponse(signedLines());
};

export const verifyPeerStreamEvent = (value: unknown, expectedOrigin: string, expectedFederationId: string) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const { signer, ...event } = value as Record<string, unknown>;
	if (!signer || typeof signer !== 'object' || Array.isArray(signer)) return null;
	const candidate = signer as Partial<PeerStreamSigner>;
	if (
		candidate.origin !== expectedOrigin ||
		candidate.federationId !== expectedFederationId ||
		typeof candidate.publicKey !== 'string' ||
		typeof candidate.timestamp !== 'string' ||
		typeof candidate.signature !== 'string' ||
		!Number.isFinite(Date.parse(candidate.timestamp)) ||
		Math.abs(Date.now() - Date.parse(candidate.timestamp)) > PEER_SIGNATURE_MAX_SKEW_MS ||
		!verifyPeerSignature(
			candidate.publicKey,
			candidate.signature,
			peerStreamSigningPayload(expectedOrigin, candidate.timestamp, event, candidate.publicKey, expectedFederationId)
		)
	) {
		return null;
	}
	return { event, publicKey: candidate.publicKey };
};

/**
 * Decode remote NDJSON as it arrives rather than materializing a peer page.
 * The byte ceiling still makes a compromised peer unable to turn one request
 * into an unbounded response allocation or gossip fan-out.
 */
async function* readBoundedNdjson(response: Response): AsyncGenerator<unknown> {
	const reader = response.body?.getReader();
	if (!reader) return;
	let bytes = 0;
	let remainder = '';
	const decoder = new TextDecoder();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		bytes += value.byteLength;
		if (bytes > PEER_SYNC_MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error('Peer response exceeded its discovery budget');
		}
		remainder += decoder.decode(value, { stream: true });
		const lines = remainder.split('\n');
		remainder = lines.pop() || '';
		for (const line of lines) {
			if (!line) continue;
			try {
				yield JSON.parse(line);
			} catch {
				throw new Error('peer stream returned invalid NDJSON');
			}
		}
	}
	remainder += decoder.decode();
	if (!remainder) return;
	try {
		yield JSON.parse(remainder);
	} catch {
		throw new Error('peer stream returned invalid NDJSON');
	}
}

const remoteHeaders = (
	secret: string,
	identity: PeerSigningIdentity,
	origin: string,
	dataEnvironment: Pick<DeploymentDataEnvironment, 'federationId'>,
	method: string,
	path: string,
	body = ''
) => {
	const timestamp = new Date().toISOString();
	const publicRequest = {
		publicKey: identity.publicKey,
		signature: signWithPeerIdentity(
			identity,
			publicPeerSigningPayload(method, path, timestamp, body, identity.publicKey, dataEnvironment.federationId)
		)
	};
	return {
		'x-thingtime-peer-origin': origin,
		'x-thingtime-peer-federation-id': dataEnvironment.federationId,
		'x-thingtime-peer-timestamp': timestamp,
		'x-thingtime-peer-signature': signPeerRequest(secret, method, path, timestamp, body, dataEnvironment.federationId),
		'x-thingtime-peer-public-key': publicRequest.publicKey,
		'x-thingtime-peer-public-signature': publicRequest.signature
	};
};

export const getSelfPeerOrigin = (request: Request) =>
	normalizePeerOrigin(process.env.THINGTIME_PUBLIC_ORIGIN || new URL(request.url).origin, { allowLoopback: process.env.NODE_ENV === 'test' });

export type PeerSyncEvent =
	| { type: 'peer.announced'; origin: string }
	| { type: 'peer.discovered'; origin: string; via: string }
	| { type: 'peer.warning'; origin: string; message: string }
	| { type: 'complete'; discovered: number; probed: number };

/**
 * Bounded breadth-first gossip. A self-signed caller can learn from the fixed
 * production bootstrap and at most seven already trusted peers per run;
 * repeated trusted scheduler or deployment-hook calls converge without a
 * fan-out storm.
 */
export async function* syncPeerMesh({
	selfOrigin,
	fetchImpl = fetch
}: {
	selfOrigin: string;
	fetchImpl?: typeof fetch;
}): AsyncGenerator<PeerSyncEvent> {
	const secret = getPeerDiscoverySecret();
	const identity = getPeerSigningIdentity();
	const dataEnvironment = getDeploymentDataEnvironment();
	if (!secret || !identity || !dataEnvironment) throw new Error('Peer discovery is not configured');
	const bootstrap = normalizePeerOrigin(process.env.THINGTIME_PEER_BOOTSTRAP_ORIGIN || dataEnvironment.authorityOrigin || '');
	if (!bootstrap) throw new Error('Peer bootstrap origin is invalid');

	await announcePeer(selfOrigin, identity.publicKey, dataEnvironment);
	yield { type: 'peer.announced', origin: selfOrigin };
	const known = await listActivePeers({ cursor: null, limit: PEER_SYNC_MAX_ORIGINS, dataEnvironment });
	const seeds = [bootstrap, ...known.peers.map((peer) => peer.origin)].filter(
		(origin, index, values) => origin !== selfOrigin && values.indexOf(origin) === index
	);
	const queue = seeds.slice(0, PEER_SYNC_MAX_ORIGINS);
	const visited = new Set<string>();
	let discovered = 0;

	while (queue.length && visited.size < PEER_SYNC_MAX_ORIGINS) {
		const peerOrigin = queue.shift()!;
		if (visited.has(peerOrigin)) continue;
		visited.add(peerOrigin);
		try {
			const announceBody = JSON.stringify({ op: 'announce', origin: selfOrigin });
			const announcePath = '/api/v1/peers';
			const announce = await fetchImpl(new URL(announcePath, peerOrigin), {
				method: 'POST',
				headers: { ...remoteHeaders(secret, identity, selfOrigin, dataEnvironment, 'POST', announcePath, announceBody), 'content-type': 'application/json' },
				body: announceBody,
				redirect: 'error',
				signal: AbortSignal.timeout(8_000)
			});
			if (!announce.ok) throw new Error(`announcement returned HTTP ${announce.status}`);

			const cursor = await getPeerSyncCursor(peerOrigin);
			const params = new URLSearchParams({ limit: String(PEER_STREAM_DEFAULT_LIMIT) });
			if (cursor) params.set('cursor', cursor);
			const streamPath = `/api/v1/peers?${params}`;
			const response = await fetchImpl(new URL(streamPath, peerOrigin), {
				headers: remoteHeaders(secret, identity, selfOrigin, dataEnvironment, 'GET', streamPath),
				redirect: 'error',
				signal: AbortSignal.timeout(8_000)
			});
			if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson'))
				throw new Error(`peer stream returned HTTP ${response.status}`);
			let nextCursor: string | null | undefined;
			for await (const event of readBoundedNdjson(response)) {
				const signed = verifyPeerStreamEvent(event, peerOrigin, dataEnvironment.federationId);
				if (!signed) throw new Error('peer stream signature is invalid');
				await announcePeer(peerOrigin, signed.publicKey, dataEnvironment);
				const remoteEvent: any = signed.event;
				if (remoteEvent?.type === 'page.complete') {
					if (nextCursor !== undefined || (remoteEvent.nextCursor !== null && !validRemoteCursor(remoteEvent.nextCursor))) {
						throw new Error('peer stream returned an invalid page cursor');
					}
					nextCursor = remoteEvent.nextCursor;
					continue;
				}
				if (remoteEvent?.type !== 'peer' || !remoteEvent.peer) continue;
				const origin = normalizePeerOrigin(remoteEvent.peer.origin);
				const signingPublicKey = remoteEvent.peer.signingPublicKey;
				if (remoteEvent.peer.dataEnvironment?.federationId !== dataEnvironment.federationId) continue;
				if (!origin || origin === selfOrigin) continue;
				await announcePeer(origin, signingPublicKey, dataEnvironment);
				discovered += 1;
				yield { type: 'peer.discovered', origin, via: peerOrigin };
				if (!visited.has(origin) && queue.length + visited.size < PEER_SYNC_MAX_ORIGINS) queue.push(origin);
			}
			if (nextCursor === undefined) throw new Error('peer stream ended without a page cursor');
			await setPeerSyncCursor(peerOrigin, nextCursor);
		} catch (error) {
			yield { type: 'peer.warning', origin: peerOrigin, message: error instanceof Error ? error.message.slice(0, 160) : 'peer probe failed' };
		}
	}
	yield { type: 'complete', discovered, probed: visited.size };
}
