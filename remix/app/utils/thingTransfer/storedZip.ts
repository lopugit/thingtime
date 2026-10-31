import { TransferFormatError } from './format';

const ZIP32 = 0xffffffff;
const safe = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TransferFormatError('Archive size exceeds safe integer precision');
  return value;
};
const add = (...values: number[]) => values.reduce((sum, value) => safe(sum + safe(value)), 0);
const record = (length: number, signature: number) => {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
};
const uint64 = (view: DataView, offset: number, value: number) => view.setBigUint64(offset, BigInt(safe(value)), true);

/** Stored ZIP layout, independent of payload reads. Overflow fields use ZIP64,
 * including values equal to the reserved ZIP32 sentinel. */
export const planStoredZip = (entries: ReadonlyArray<{ path: string; bytes: number }>) => {
  let offset = 0, directorySize = 0;
  const files = entries.map(entry => {
    const name = new TextEncoder().encode(entry.path);
    if (name.length > 0xffff) throw new TransferFormatError('Archive filename is too long');
    safe(entry.bytes);
    const large = entry.bytes >= ZIP32, largeOffset = offset >= ZIP32;
    const localSize = 30 + name.length + (large ? 20 : 0);
    const centralSize = 46 + name.length + (large || largeOffset ? 4 + (large ? 16 : 0) + (largeOffset ? 8 : 0) : 0);
    const file = { ...entry, name, offset, large, largeOffset, localSize, centralSize };
    offset = add(offset, localSize, entry.bytes);
    directorySize = add(directorySize, centralSize);
    return file;
  });
  const directoryOffset = offset;
  const zip64 = files.some(file => file.large || file.largeOffset) || entries.length >= 0xffff || directoryOffset >= ZIP32 || directorySize >= ZIP32;
  const size = add(directoryOffset, directorySize, zip64 ? 98 : 22);
  return { files, directoryOffset, directorySize, zip64, size };
};
export type StoredZipPlan = ReturnType<typeof planStoredZip>;

/** Known sizes and CRCs keep bit 3 clear: payload signatures cannot be mistaken
 * for data descriptors by streaming readers. Payload Blob references stay intact. */
export const storedZipBlob = (plan: StoredZipPlan, payloads: ReadonlyArray<{ blob: Blob; crc: number }>): Blob => {
  if (payloads.length !== plan.files.length) throw new TransferFormatError('Archive payload count mismatch');
  const parts: BlobPart[] = [], directory: Uint8Array<ArrayBuffer>[] = [];
  plan.files.forEach((file, index) => {
    const { blob, crc } = payloads[index];
    if (blob.size !== file.bytes) throw new TransferFormatError('Archive payload size mismatch');
    const local = record(file.localSize, 0x04034b50);
    local.view.setUint16(4, file.large ? 45 : 20, true);
    local.view.setUint16(6, 0x800, true);
    local.view.setUint16(12, 0x21, true); // 1980-01-01
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, file.large ? ZIP32 : file.bytes, true);
    local.view.setUint32(22, file.large ? ZIP32 : file.bytes, true);
    local.view.setUint16(26, file.name.length, true);
    local.view.setUint16(28, file.large ? 20 : 0, true);
    local.bytes.set(file.name, 30);
    if (file.large) {
      const start = 30 + file.name.length;
      local.view.setUint16(start, 1, true); local.view.setUint16(start + 2, 16, true);
      uint64(local.view, start + 4, file.bytes); uint64(local.view, start + 12, file.bytes);
    }
    parts.push(local.bytes, blob);
    const central = record(file.centralSize, 0x02014b50);
    const version = file.large || file.largeOffset ? 45 : 20;
    central.view.setUint16(4, version, true); central.view.setUint16(6, version, true);
    central.view.setUint16(8, 0x800, true); central.view.setUint16(14, 0x21, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, file.large ? ZIP32 : file.bytes, true);
    central.view.setUint32(24, file.large ? ZIP32 : file.bytes, true);
    central.view.setUint16(28, file.name.length, true);
    central.view.setUint16(30, file.centralSize - 46 - file.name.length, true);
    central.view.setUint32(42, file.largeOffset ? ZIP32 : file.offset, true);
    central.bytes.set(file.name, 46);
    if (file.large || file.largeOffset) {
      let start = 46 + file.name.length;
      central.view.setUint16(start, 1, true); central.view.setUint16(start + 2, file.centralSize - start - 4, true); start += 4;
      if (file.large) { uint64(central.view, start, file.bytes); uint64(central.view, start + 8, file.bytes); start += 16; }
      if (file.largeOffset) uint64(central.view, start, file.offset);
    }
    directory.push(central.bytes);
  });
  parts.push(...directory);
  if (plan.zip64) {
    const end = record(56, 0x06064b50);
    uint64(end.view, 4, 44); end.view.setUint16(12, 45, true); end.view.setUint16(14, 45, true);
    uint64(end.view, 24, plan.files.length); uint64(end.view, 32, plan.files.length);
    uint64(end.view, 40, plan.directorySize); uint64(end.view, 48, plan.directoryOffset);
    const locator = record(20, 0x07064b50);
    uint64(locator.view, 8, add(plan.directoryOffset, plan.directorySize)); locator.view.setUint32(16, 1, true);
    parts.push(end.bytes, locator.bytes);
  }
  const end = record(22, 0x06054b50);
  end.view.setUint16(8, Math.min(plan.files.length, 0xffff), true); end.view.setUint16(10, Math.min(plan.files.length, 0xffff), true);
  end.view.setUint32(12, Math.min(plan.directorySize, ZIP32), true); end.view.setUint32(16, Math.min(plan.directoryOffset, ZIP32), true);
  parts.push(end.bytes);
  const blob = new Blob(parts, { type: 'application/zip' });
  if (blob.size !== plan.size) throw new TransferFormatError('The archive is incomplete');
  return blob;
};
