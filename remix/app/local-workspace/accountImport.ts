import { accountThingCanCache } from './accountSync';
import type { ThingTransfer } from '../utils/thingTransfer/format';
import { isTransferRecording, recordingTransferFile } from '../utils/thingTransfer/recording';
import { isTransferTheme } from '../utils/thingTransfer/theme';

/** Shared capability decision for the normal import UI and account facade.
 * Post/comment files share the existing receipt-dependent content queue. */
export function accountImportSupported(manifest: ThingTransfer): boolean {
 if (manifest.links?.length) return false;
 const files = new Set<string>();
 for (const row of manifest.things) {
  if (accountThingCanCache(row) || isTransferTheme(row)) continue;
  if (!isTransferRecording(row)) return false;
  try { files.add(recordingTransferFile(row, manifest).id); } catch { return false; }
 }
 const posts = new Set(manifest.things.filter(row => row.thingtime.includes('post')).map(row => row.id));
 return manifest.files.every(file => files.has(file.id) || posts.has(file.targetId));
}
