// AAGUID → human provider name for passkey authenticators. Synced passkey
// providers report their AAGUID in authenticator data even under `none`
// attestation, so this is how "1Password" / "iCloud Keychain" shows up in the
// passkey manager without ever requesting identifying attestation. Subset of
// the community-maintained list (github.com/passkeydeveloper/
// passkey-authenticator-aaguids); unknown AAGUIDs simply show no provider.
const PASSKEY_PROVIDER_NAMES: Record<string, string> = {
	'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
	'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain (Managed)',
	'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
	'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
	'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
	'b5397666-4885-aa6b-cebf-e52262a439a2': 'Chromium Browser',
	'771b48fd-d3d4-4f74-9232-fc157ab0507a': 'Edge on Mac',
	'08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
	'9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
	'6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
	'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
	'531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
	'b84e4048-15dc-4dd0-8640-f4f60813c8af': 'NordPass',
	'0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6': 'Keeper',
	'f3809540-7f14-49c1-a8b3-8f813b225541': 'Enpass',
	'fdb141b2-5d84-443e-8a35-4698c205a502': 'KeePassXC',
	'50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
	'b78a0a55-6ef8-d246-a042-ba0f6d55050c': 'LastPass',
	'53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
	'66a0ccb3-bd6a-191f-ee06-e375c50b9846': 'Thales',
	'cc45f64e-52a2-451b-831a-4edd8022a202': 'ToothPic',
	'bfc748bb-3429-4faa-b9f9-7cfa9f3b76d0': 'iPasswords',
	'b35a26b2-8f6e-4697-ab1d-d44db4da28c6': 'Zoho Vault',
	'22248c4c-7a12-46e2-9a41-44291b373a4d': 'LogMeOnce',
	'a05ff112-05dd-42ac-9926-eb84e0e19c88': 'Kaspersky Password Manager'
};

const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';

export const providerNameForAaguid = (aaguid: string | null | undefined): string | null => {
	const normalized = (aaguid || '').trim().toLowerCase();
	if (!normalized || normalized === ZERO_AAGUID) return null;
	return PASSKEY_PROVIDER_NAMES[normalized] || null;
};
