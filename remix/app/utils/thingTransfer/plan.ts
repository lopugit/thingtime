import type { TransferThing, TransferLink, TransferAnnotations } from './format';

/** Short-lived authorized download plan, never the portable archive itself.
 * File bytes and checksums are obtained before creating a portable bundle.
 */
export type TransferPlan = {
  roots: string[];
  things: TransferThing[];
  files: (TransferAnnotations & { id: string; targetId: string; name: string; mime: string; bytes: number; sharedRoot?: string })[];
  links?: TransferLink[];
  attachmentOrder?: string[];
};
