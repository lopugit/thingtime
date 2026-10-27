import { PASSWORD_STORAGE_DOCUMENT_BYTES } from './capacity';
import { sealDeviceVaultValue, openDeviceVaultValue, type DeviceVaultKey } from './vaultCrypto';
import type { VaultEnvelope } from './vaultEnvelopeContract';

/** Password entries and file metadata share the account password codec's
 * capacity. Provider credentials and key wrappers keep their own defaults. */
export async function sealDevicePasswordValue(ownerId: string, key: DeviceVaultKey, recordId: string, value: string) {
  const fail = () => new Error('This password value exceeds the account database document capacity. Your source data has not been truncated.');
  if (typeof value !== 'string' || value.length > PASSWORD_STORAGE_DOCUMENT_BYTES) throw fail();
  const bytes = new TextEncoder().encode(value);
  try { if (bytes.byteLength > PASSWORD_STORAGE_DOCUMENT_BYTES) throw fail(); } finally { bytes.fill(0); }
  return sealDeviceVaultValue(ownerId, key, recordId, value, PASSWORD_STORAGE_DOCUMENT_BYTES);
}
export function openDevicePasswordValue(ownerId: string, key: DeviceVaultKey, recordId: string, envelope: VaultEnvelope) {
  return openDeviceVaultValue(ownerId, key, recordId, envelope, PASSWORD_STORAGE_DOCUMENT_BYTES);
}
