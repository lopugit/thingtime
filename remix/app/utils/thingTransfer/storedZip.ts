import { TransferFormatError } from './format';
import { planStoredZip as plan, storedZipBlob as blob, StoredZipError } from './storedZipCore.mjs';

// Preserve the canonical transfer validator error while sharing identical ZIP
// framing with the native release publisher (no parallel archive implementation).
const transferError = (error: unknown): never => {
  if (error instanceof StoredZipError) throw new TransferFormatError(error.message);
  throw error;
};
export const planStoredZip = (entries: ReadonlyArray<{ path: string; bytes: number }>) => {
  try { return plan(entries); } catch (error) { return transferError(error); }
};
export type StoredZipPlan = ReturnType<typeof planStoredZip>;
export const storedZipBlob = (layout: StoredZipPlan, payloads: ReadonlyArray<{ blob: Blob; crc: number }>): Blob => {
  try { return blob(layout, payloads); } catch (error) { return transferError(error); }
};
