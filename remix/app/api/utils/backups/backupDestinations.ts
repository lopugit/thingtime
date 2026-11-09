import { createHash } from 'node:crypto';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { readAdminAutomationSecret } from '../admin/integrations';
import { getDeploymentDataEnvironment } from '../deployment/dataEnvironment';
import { getPrivateS3Config } from '../attachments/config';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { openS3BackupStore, validateS3BackupDestination, type S3BackupDestination } from './s3BackupStore';
import type { BackupAccess } from './portableBackup';
import { timelineScopeKey } from '../../../timeline/contract';
import type { BackupDestinationsResult } from '../../../backups/destinations';

export const BACKUP_DESTINATIONS_VAULT_LABEL = 'portable-backup-destinations';
type RegisteredDestination = S3BackupDestination & {
	id: string; label: string; provider: 'aws-s3-oidc'; roleArn: string;
};
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v: unknown, key: string) => object(v) && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined;
const originIsExact = (origin: string) => {
	try { const url = new URL(origin); return url.origin === origin && !url.username && !url.password &&
		(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))); }
	catch { return false; }
};
const invalid = (): never => { throw Error('Invalid backup destination registration'); };

/** Fixed-label vault registration, exact deployment environment and origin.
 * The caller can select only a registered opaque ID, never an endpoint, bucket,
 * role, prefix or credential. Missing aliases never borrow another origin. */
export function parseBackupDestinations(raw: string, environment: string, origin: string, primaryBucket: string): RegisteredDestination[] {
	if (!environment || !originIsExact(origin) || !primaryBucket) return invalid();
	const bundle = JSON.parse(raw);
	if (!object(bundle) || bundle.schemaVersion !== 1 || Object.keys(bundle).sort().join(',') !== 'environments,schemaVersion') return invalid();
	const selected = own(own(own(own(bundle, 'environments'), environment), 'origins'), origin);
	if (!object(selected) || Object.keys(selected).join(',') !== 'destinations' || !Array.isArray(selected.destinations)) return invalid();
	const ids = new Set<string>(), namespaces = new Set<string>();
	return selected.destinations.map((value: any) => {
		if (!object(value) || Object.keys(value).sort().join(',') !== 'bucket,expectedBucketOwner,id,label,prefix,provider,region,roleArn' ||
			value.provider !== 'aws-s3-oidc' || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) ||
			typeof value.label !== 'string' || !value.label.trim() || value.label !== value.label.trim() ||
			typeof value.roleArn !== 'string' || !/^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]{1,512}$/.test(value.roleArn) ||
			value.roleArn.split(':')[4] !== value.expectedBucketOwner || ids.has(value.id) || value.bucket === primaryBucket) return invalid();
		// AWS endpoints are derived from the trusted region; arbitrary fetch URLs
		// and alternative providers require their own deliberate adapter contract.
		if (typeof value.region !== 'string' || !/^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]+$/.test(value.region)) return invalid();
		const destination = validateS3BackupDestination({ endpoint: `https://s3.${value.region}.amazonaws.com`, region: value.region,
			bucket: value.bucket, prefix: value.prefix, expectedBucketOwner: value.expectedBucketOwner });
		const namespace = JSON.stringify([destination.bucket, destination.prefix]);
		if (namespaces.has(namespace)) return invalid();
		ids.add(value.id); namespaces.add(namespace);
		return { ...destination, id: value.id, label: value.label, provider: value.provider, roleArn: value.roleArn };
	});
}

type Dependencies = {
	read(): Promise<string | null>; environment(): string | null; primaryBucket(): string; customPlane(): boolean;
	credentials: typeof awsCredentialsProvider;
};
const defaults: Dependencies = {
	read: () => readAdminAutomationSecret(BACKUP_DESTINATIONS_VAULT_LABEL),
	environment: () => getDeploymentDataEnvironment()?.id ?? null,
	primaryBucket: () => getPrivateS3Config().bucket,
	customPlane: isCustomMongoEndpointActive,
	credentials: awsCredentialsProvider
};
export function createBackupDestinationRegistry(overrides: Partial<Dependencies> = {}) {
	const deps = { ...defaults, ...overrides };
	const load = async (origin: string): Promise<{ values: RegisteredDestination[]; reason: BackupDestinationsResult['reason'] }> => {
		const environment = deps.environment();
		if (!environment || !originIsExact(origin)) return { values: [], reason: 'environment-unavailable' };
		let primaryBucket: string;
		try { primaryBucket = deps.primaryBucket(); if (!primaryBucket) throw Error(); }
		catch { return { values: [], reason: 'primary-storage-unavailable' }; }
		try {
			const raw = await deps.read();
			if (raw === null) return { values: [], reason: 'not-configured' };
			return { values: parseBackupDestinations(raw, environment, origin, primaryBucket), reason: null };
		} catch { return { values: [], reason: 'invalid-configuration' }; }
	};
	return {
		async discover(origin: string): Promise<BackupDestinationsResult> {
			const { values, reason } = await load(origin);
			return { ok: true, destinations: values.map(({ id, label, provider }) => ({ id, label, provider, state: 'configured-unverified' })),
				availability: values.length ? 'configured' : 'unavailable', reason: reason ?? (values.length ? null : 'not-configured'), executionAvailable: false };
		},
		/** Worker-only opener. Rechecks authorization and current vault binding
		 * before provider operations and after credential resolution. No tokens
		 * or provider configuration enter durable job Things or public output. */
		async open(id: string, access: BackupAccess, expectedBinding?: string) {
			const scope = timelineScopeKey(access.scope);
			if (access.scope.dataPlane !== 'home' || deps.customPlane()) throw Error('Backups require home storage');
			await access.authorize();
			const loaded = await load(access.scope.apiOrigin), selected = loaded.values.find(value => value.id === id);
			if (!selected || loaded.reason) throw Error('The registered backup destination is unavailable');
			const binding = createHash('sha256').update(JSON.stringify([deps.environment(), access.scope.apiOrigin, selected])).digest('hex');
			if (expectedBinding !== undefined && expectedBinding !== binding) throw Error('The reviewed backup destination changed');
			const authorize = async () => {
				access.signal?.throwIfAborted();
				if (timelineScopeKey(access.scope) !== scope || deps.customPlane()) throw Error('Backup account or origin changed');
				await access.authorize();
				const current = (await load(access.scope.apiOrigin)).values.find(value => value.id === id);
				if (!current || createHash('sha256').update(JSON.stringify([deps.environment(), access.scope.apiOrigin, current])).digest('hex') !== binding)
					throw Error('The reviewed backup destination changed');
				access.signal?.throwIfAborted();
				if (timelineScopeKey(access.scope) !== scope || deps.customPlane()) throw Error('Backup account or origin changed');
			};
			await authorize();
			const { endpoint, region, bucket, prefix, expectedBucketOwner } = selected;
			const store = openS3BackupStore({ endpoint, region, bucket, prefix, expectedBucketOwner }, { ...access, authorize,
				credentials: deps.credentials({ roleArn: selected.roleArn, roleSessionName: 'thingtime-portable-backups', clientConfig: { region: selected.region } }) });
			return { store, binding };
		}
	};
}
export const backupDestinationRegistry = createBackupDestinationRegistry();
