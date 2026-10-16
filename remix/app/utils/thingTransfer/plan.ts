import type { TransferThing, TransferLink, TransferAnnotations } from './format';

/** Short-lived authorized download plan, never the portable archive itself.
 * File bytes and checksums are obtained before creating a portable bundle.
 */
export type TransferPlan = {
  /** In-process account/workspace availability fence. Never serialized into
   * portable content or supplied as executable code by a remote response. */
  assertCurrent?: (signal?: AbortSignal) => Promise<void>;
  /** In-process local adapter only. JSON from a remote server cannot supply a
   * callable reader. This capability is scoped and excluded from the bundle. */
  readLocalFile?: (id: string, signal?: AbortSignal) => Promise<Uint8Array>;
  roots: string[];
  things: TransferThing[];
  files: (TransferAnnotations & { id: string; sourceId?: string; inlineBase64?: string; targetId: string; name: string; mime: string; bytes: number; sharedRoot?: string })[];
  links?: TransferLink[];
  attachmentOrder?: string[];
};
