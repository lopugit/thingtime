const ROLE_ARN_RE = new RegExp(String.raw`^arn:aws:iam::(\d{12}):role/[A-Za-z0-9+=,.@_/-]{1,512}$`);
const BUCKET_RE = /^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const REGION_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;

export type PrivateS3Config = {
	roleArn: string;
	bucket: string;
	region: string;
	expectedBucketOwner: string;
};

export class PrivateS3ConfigError extends Error {
	constructor() {
		super('Private attachment storage is not configured');
		this.name = 'PrivateS3ConfigError';
	}
}

// S3 credentials are intentionally absent from this configuration. Vercel's
// request-scoped OIDC token is exchanged for the one narrowly scoped role.
// Keeping every app-owned name PRIVATE also keeps root-data.server.ts from
// exposing bucket or role details to browser root data.
export const getPrivateS3Config = (env: NodeJS.ProcessEnv = process.env): PrivateS3Config => {
	const roleArn = String(env.THINGTIME_PRIVATE_S3_ROLE_ARN || '').trim();
	const bucket = String(env.THINGTIME_PRIVATE_S3_BUCKET || '').trim();
	const region = String(env.THINGTIME_PRIVATE_S3_REGION || '').trim();
	const role = ROLE_ARN_RE.exec(roleArn);

	// Dotted bucket names are valid in S3 but do not match the virtual-hosted
	// TLS wildcard. Rejecting them keeps every SDK request on a hostname with a
	// directly valid certificate instead of silently falling back to path style.
	if (!role || !BUCKET_RE.test(bucket) || !REGION_RE.test(region)) {
		throw new PrivateS3ConfigError();
	}

	return {
		roleArn,
		bucket,
		region,
		expectedBucketOwner: role[1]
	};
};
