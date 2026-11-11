/** The import capability carries write-only values to the platform provider vault. */
export const CREDENTIAL_IMPORT_FEATURE = 'api.credentials-import';
export const CREDENTIAL_IMPORT_VERSION = '1.1.0';
export const CREDENTIAL_IMPORT_BASE_VERSION = '1.0.0';
export const CREDENTIAL_IMPORT_REQUIREMENTS = { [CREDENTIAL_IMPORT_FEATURE]: CREDENTIAL_IMPORT_BASE_VERSION } as const;
export const CREDENTIAL_IMPORT_API_PATH = '/api/v1/credentials/import';
export const CREDENTIAL_IMPORT_OPERATIONS = ['start', 'status', 'upload', 'inspect', 'approve', 'revoke', 'direct'] as const;
export type CredentialImportOperation = (typeof CREDENTIAL_IMPORT_OPERATIONS)[number];
export const CREDENTIAL_IMPORT_PAGE_PATH = '/credentials/import';
export const CREDENTIAL_IMPORT_DESTINATIONS = {
	'admin-provider-vault': ['google-oauth', 'oauth-client', 'text', 'json']
} as const;
export const GOOGLE_OAUTH_CREDENTIAL_LABEL = 'connections-google-oauth';
export const GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH = '/api/v1/connections/oauth/callback';
export const CREDENTIAL_IMPORT_HEADERS = {
	expectedActor: 'x-thingtime-expected-actor',
	target: 'x-thingtime-import-target',
	request: 'x-thingtime-import-request',
	verifier: 'x-thingtime-import-verifier'
} as const;

export type CredentialImportDestination = keyof typeof CREDENTIAL_IMPORT_DESTINATIONS;
export type CredentialImportFormat = (typeof CREDENTIAL_IMPORT_DESTINATIONS)[CredentialImportDestination][number];
export const isCredentialImportFormat = (format: unknown): format is CredentialImportFormat =>
	CREDENTIAL_IMPORT_DESTINATIONS['admin-provider-vault'].some(value => value === format);
export const credentialImportMinimum = (format: CredentialImportFormat) =>
	format === 'oauth-client' ? CREDENTIAL_IMPORT_VERSION : CREDENTIAL_IMPORT_BASE_VERSION;
export type CredentialImportOverwrite = { mode: 'create' } | { mode: 'replace'; expectedId: string; expectedUpdatedAt: string };
export type CredentialImportTarget = {
	destination: CredentialImportDestination;
	format: CredentialImportFormat;
	label: string;
	environment: string;
	callbackUrl?: string;
	overwrite: CredentialImportOverwrite;
};
export type CredentialImportReceipt = {
	credentialId: string;
	label: string;
	environment: string;
	format: CredentialImportFormat;
	updatedAt: string;
};
export type CredentialImportStatus = 'pending' | 'approved' | 'revoked' | 'expired' | 'completed';
export type CredentialImportIntent = {
	requestId: string;
	target: CredentialImportTarget;
	expectedAccountId: string;
	expiresAt: string;
	status: CredentialImportStatus;
	receipt?: CredentialImportReceipt;
};
export type CredentialImportVaultMetadata = { id: string; label: string; updatedAt: string };
export type CredentialImportStart = { requestId: string; expiresAt: string; verificationUrl: string };
