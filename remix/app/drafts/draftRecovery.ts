import { validDraftId, validateDraftContent } from './draftCore';
import type { LocalDraft } from './draftSession';

/** Inspect without mutating the recovery copy. Invalid data must never seed
 * the autosave queue or be replaced by the editor's initial blank snapshot. */
export function inspectDraftRecovery(value: LocalDraft | null, validateSnapshot?: (snapshot: string) => unknown) {
 if (!value) return { seed: null, error: '' };
 try {
  if (!validDraftId(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid recovery identity');
  validateDraftContent(value.content);
  validateSnapshot?.(value.content.snapshot);
  if (value.pending) {
   if (!validDraftId(value.pending.writeId) || !Number.isSafeInteger(value.pending.revision) || value.pending.revision < 0) throw new Error('Invalid pending recovery');
   validateDraftContent(value.pending.content);
   validateSnapshot?.(value.pending.content.snapshot);
  }
  if (value.pendingCopy) {
   if (!validDraftId(value.pendingCopy.sourceId)) throw new Error('Invalid recovery source');
   validateDraftContent(value.pendingCopy.content);
   validateSnapshot?.(value.pendingCopy.content.snapshot);
  }
  return { seed: value, error: '' };
 } catch {
  return { seed: null, error: 'The saved draft could not be restored and has been kept. Draft saving is paused in this editor; you can still create the Thing.' };
 }
}
