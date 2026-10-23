/** MongoDB's BSON document ceiling, shared by the account writer and device
 * codec. Actual account admission still measures the complete encrypted BSON
 * document; this is not a guarantee that every payload of this size can sync. */
export const PASSWORD_STORAGE_DOCUMENT_BYTES = 16 * 1024 * 1024;
