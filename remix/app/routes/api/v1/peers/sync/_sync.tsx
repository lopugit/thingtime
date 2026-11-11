import { timingSafeEqual } from 'node:crypto';

import { json } from '~/api/http';
import { getDeploymentDataEnvironment } from '~/api/utils/deployment/dataEnvironment';
import { getPeerSigningIdentity, getSelfPeerOrigin, signedPeerNdjsonResponse, syncPeerMesh } from '~/api/utils/peers/peerDiscovery';

const exactCronHeader = (authorization: string | null, secret: string) => {
	const actual = Buffer.from(authorization || '', 'utf8');
	const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
	return actual.length === expected.length && timingSafeEqual(actual, expected);
};

type PeerSyncLoaderDependencies = {
	getCronSecret: () => string | undefined;
	getIdentity: typeof getPeerSigningIdentity;
	getSelfOrigin: typeof getSelfPeerOrigin;
	sync: typeof syncPeerMesh;
};

const defaults: PeerSyncLoaderDependencies = {
	getCronSecret: () => process.env.CRON_SECRET,
	getIdentity: getPeerSigningIdentity,
	getSelfOrigin: getSelfPeerOrigin,
	sync: syncPeerMesh
};

// GET /api/v1/peers/sync — a trusted scheduler or deploy hook advances one
// bounded page per known peer. Vercel calls it every five minutes for the
// production bootstrap; non-Vercel deployments may schedule the same endpoint.
export const createPeerSyncLoader = (overrides: Partial<PeerSyncLoaderDependencies> = {}) => {
	const dependencies = { ...defaults, ...overrides };
	return async ({ request }: { request: Request }) => {
		if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
		const cronSecret = dependencies.getCronSecret()?.trim();
		if (!cronSecret) return json({ ok: false, error: 'Peer sync scheduler is not configured' }, { status: 503 });
		if (!exactCronHeader(request.headers.get('authorization'), cronSecret)) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
		const identity = dependencies.getIdentity();
		const selfOrigin = dependencies.getSelfOrigin(request);
		const dataEnvironment = getDeploymentDataEnvironment();
		if (!identity || !selfOrigin || !dataEnvironment) return json({ ok: false, error: 'Peer discovery is not configured' }, { status: 503 });
		return signedPeerNdjsonResponse(identity, selfOrigin, dataEnvironment, dependencies.sync({ selfOrigin }));
	};
};

export const loader = createPeerSyncLoader();

export const action = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
