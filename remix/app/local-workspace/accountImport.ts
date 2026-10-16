import { accountThingCanCache } from './accountSync';
import type { ThingTransfer } from '../utils/thingTransfer/format';
import { isTransferRecording, recordingTransferFile } from '../utils/thingTransfer/recording';

/** Shared capability decision for the normal import UI and account facade.
 * Bound media and managed kinds keep their complete dedicated import path. */
export function accountImportSupported(manifest: ThingTransfer): boolean {
 if (manifest.links?.length) return false;
 const files = new Set<string>();
 for (const row of manifest.things) {
  if (accountThingCanCache(row)) continue;
  if (!isTransferRecording(row) || row.crystal.filePurpose !== 'file') return false;
  try { files.add(recordingTransferFile(row, manifest).id); } catch { return false; }
 }
 return manifest.files.every(file => files.has(file.id));
}
