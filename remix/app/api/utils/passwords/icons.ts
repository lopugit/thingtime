import { openVaultValue, sealVaultValue, type VaultDataKey } from '../auth/vaultEnvelope';
import { validatePasswordIcon, type PasswordIcon } from '~/passwords/icons';
// Presentation gets its own authenticated purpose; it can never open secret fields.
export const sealPasswordIcon = (ownerId: string, key: VaultDataKey, id: string, icon: PasswordIcon, maxBytes: number) =>
  sealVaultValue(ownerId, key, id, 'password-icon', JSON.stringify(validatePasswordIcon(icon)), maxBytes);
export function openPasswordIcon(ownerId: string, key: VaultDataKey, id: string, value: any, maxBytes: number): PasswordIcon | undefined {
  if (!value) return undefined;
  try { return validatePasswordIcon(JSON.parse(openVaultValue(ownerId, key, id, 'password-icon', value, maxBytes))); }
  catch { return undefined; } // Invalid legacy presentation never blocks the vault list.
}
