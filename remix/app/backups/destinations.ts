/** Public owner-only destination discovery. Configuration and credentials stay
 * in the origin's server vault. Configured is not a provider durability proof. */
export const BACKUP_DESTINATIONS_PATH = '/api/v1/backups/destinations';
export const BACKUP_DESTINATIONS_REQUIREMENTS = { 'api.backup-destinations': '1.0.0' } as const;
export type BackupDestinationStatus = {
	provider: 'aws-s3-oidc'; id: string; label: string;
	state: 'configured-unverified';
};
export type BackupDestinationsResult = {
	ok: true;
	destinations: BackupDestinationStatus[];
	availability: 'configured' | 'unavailable';
	reason: 'not-configured' | 'invalid-configuration' | 'environment-unavailable' | 'primary-storage-unavailable' | null;
	/** Discovery grants neither execution nor a proof that bytes were retained. */
	executionAvailable: false;
};
