import { serializeTransfer, TRANSFER_LIMITS, validateTransfer } from './format';

export const REMOTE_TRANSFER_EXPORT_VERSION = '1.18.0';
export const REMOTE_TRANSFER_IMPORT_VERSION = '1.15.0';
export const REMOTE_TRANSFER_CONTENT_VERSION = '1.18.0';

/** Requirements describe the selected origin, never the portable format version. */
export function transferImportMinimumVersion(manifest: unknown): string {
  const value = manifest && typeof manifest === 'object' ? manifest as { files?: unknown; things?: unknown } : {};
  let bytes = 0;
  if (Array.isArray(value.files)) for (const file of value.files) {
    if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 || file.bytes > Number.MAX_SAFE_INTEGER - bytes)
      return REMOTE_TRANSFER_IMPORT_VERSION; // Validation below rejects malformed metadata before transport.
    bytes += file.bytes;
    if (bytes > TRANSFER_LIMITS.fileBytes) return REMOTE_TRANSFER_IMPORT_VERSION;
  }
  return Array.isArray(value.things) && value.things.some(thing => Array.isArray(thing?.thingtime) &&
    thing.thingtime.some((kind: unknown) => kind === 'theme' || kind === 'feed-algorithm')) ? '1.14.0' : '1.13.0';
}

/** Call before uploading as well as before import. An old origin must leave the
 * original local bundle intact, without creating unnecessary remote uploads. */
export async function requireRemoteTransferImport(manifest: unknown,
  requireCapability: (feature: string, version: string) => Promise<unknown>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const checked = validateTransfer(manifest);
  serializeTransfer(checked);
  await requireCapability('api.things-import', transferImportMinimumVersion(checked));
  signal?.throwIfAborted();
}
