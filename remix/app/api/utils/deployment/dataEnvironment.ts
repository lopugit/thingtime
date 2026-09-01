export type DataEnvironmentKind = 'production' | 'development' | 'custom';

export type DeploymentDataEnvironment = {
	schemaVersion: 1;
	/** Stable, non-secret identifier for the database/authentication authority. */
	id: string;
	kind: DataEnvironmentKind;
	/** Deployments with this value may exchange authenticated peer and account-hint metadata. */
	federationId: string;
	/** The first-party origin that owns sign-in for this data environment. */
	authorityOrigin: string | null;
};

const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const normaliseId = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const normalised = value.trim().toLowerCase();
	return ID.test(normalised) ? normalised : null;
};

const normaliseOrigin = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value.trim()) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
		return url.origin;
	} catch {
		return null;
	}
};

/**
 * Resolves the explicitly configured database/authentication environment.
 *
 * `THINGTIME_DATA_ENV` is deliberately public metadata, never a URI or
 * credential: `production`, `development`, or `custom:<stable-id>`. A custom
 * environment also needs `THINGTIME_DATA_AUTHORITY_ORIGIN`. The optional
 * `THINGTIME_FEDERATION_ID` groups aliases that share one identity database.
 */
export const getDeploymentDataEnvironment = (
	env: Record<string, string | undefined> = process.env
): DeploymentDataEnvironment | null => {
	const raw = env.THINGTIME_DATA_ENV?.trim().toLowerCase() || '';
	let kind: DataEnvironmentKind;
	let id: string;
	if (raw === 'production') {
		kind = 'production';
		id = 'production';
	} else if (raw === 'development') {
		kind = 'development';
		id = 'development';
	} else if (raw.startsWith('custom:')) {
		const customId = normaliseId(raw.slice('custom:'.length));
		if (!customId) return null;
		kind = 'custom';
		id = customId;
	} else {
		return null;
	}

	const authorityOrigin =
		normaliseOrigin(env.THINGTIME_DATA_AUTHORITY_ORIGIN) ||
		(kind === 'production' ? 'https://thingtime.com' : kind === 'development' ? 'https://dev.thingtime.com' : null);
	if (kind === 'custom' && !authorityOrigin) return null;

	const federationId = normaliseId(env.THINGTIME_FEDERATION_ID) || id;
	return { schemaVersion: 1, id, kind, federationId, authorityOrigin };
};

export const isSameDataEnvironment = (
	left: Pick<DeploymentDataEnvironment, 'federationId'> | null | undefined,
	right: Pick<DeploymentDataEnvironment, 'federationId'> | null | undefined
) => Boolean(left && right && left.federationId === right.federationId);
