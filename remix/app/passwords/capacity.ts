/** MongoDB's BSON document ceiling, shared by the account writer and device
 * codec. Actual account admission still measures the complete encrypted BSON
 * document; this is not a guarantee that every payload of this size can sync. */
export const PASSWORD_STORAGE_DOCUMENT_BYTES = 16 * 1024 * 1024;

/** Base64 expands the encrypted payload. Device records additionally carry
 * revision/retry metadata; do not apply the ordinary 1 MiB JSON-record budget
 * to an envelope that the canonical password writer can already produce. */
export const PASSWORD_DEVICE_RECORD_BYTES = Math.ceil(PASSWORD_STORAGE_DOCUMENT_BYTES * 4 / 3) + 2048;
export const PASSWORD_DEVICE_COLLECTIONS = new Set([
  'password-vault-records', 'password-vault-commands', 'password-vault-files',
  'password-vault-file-commands', 'password-vault-file-catalog'
]);
