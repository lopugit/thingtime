import { decodeTransferArchive, MAX_ARCHIVE_BYTES, type TransferBundle } from './archive';
import { parseTransfer, TRANSFER_LIMITS, TransferFormatError } from './format';

/** Detect ZIP by its bytes, not a user-controlled MIME type or extension. */
export const readTransferFile = async (file: Blob, signal?: AbortSignal): Promise<TransferBundle> => {
  signal?.throwIfAborted();
  if (file.size > MAX_ARCHIVE_BYTES) throw new TransferFormatError('Transfer file is too large');
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  signal?.throwIfAborted();
  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4) {
    return decodeTransferArchive(new Uint8Array(await file.arrayBuffer()), signal);
  }
  if (file.size > TRANSFER_LIMITS.manifestBytes) throw new TransferFormatError('Transfer manifest is too large');
  const text = await file.text();
  signal?.throwIfAborted();
  const manifest = parseTransfer(text);
  if (manifest.files.length) throw new TransferFormatError('This manifest needs its files. Choose the complete Thingtime ZIP instead.');
  return { manifest, files: new Map() };
};
