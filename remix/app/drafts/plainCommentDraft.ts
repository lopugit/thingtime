import { DRAFT_MAX_BYTES } from './draftCore';
import { inspectDraftRecovery } from './draftRecovery';
import type { LocalDraft } from './draftSession';
import { workspaceDraftContext, workspaceDraftRecoveryKey } from './workspaceDraft';
import type { WorkspaceScope, WorkspaceLease } from '../local-workspace/storage';

export const plainCommentContext = (target: string) => `comment:plain:${target}`;
export function restorePlainComment(snapshot: string) {
 if (typeof snapshot !== 'string' || new TextEncoder().encode(snapshot).length > DRAFT_MAX_BYTES) throw Error('This comment draft is too large. Its saved copy has been kept.');
 const value = JSON.parse(snapshot);
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.text !== 'string')
  throw Error('This is not a plain-text comment draft. Open its original editor; the saved copy has been kept.');
 return value.text as string;
}
export type PlainCommentLegacySource = { key: string; store: 'text' | 'draft'; context?: string; label: string };
export type PlainCommentReview = { source: PlainCommentLegacySource; raw: string; text: string };
export async function plainCommentLegacySources(origin: string, actor: string, target: string, scope: WorkspaceScope) {
 const context = plainCommentContext(target), hashed = await workspaceDraftContext(scope, context);
 const prefix = `tt-account-draft:${origin}:${actor}:`;
 return [
  { key: `tt-draft:${actor}:${target}`, store: 'text', label: 'Earlier text draft' },
  { key: prefix + context, store: 'draft', context, label: 'Earlier account draft' },
  { key: workspaceDraftRecoveryKey(origin, actor, context, scope), store: 'draft', context, label: 'Earlier workspace draft' },
  { key: prefix + hashed, store: 'draft', context: hashed, label: 'Earlier scoped draft' }
 ] satisfies PlainCommentLegacySource[];
}
/** Read only the selected source. No old operation, ID or media is adopted. */
export async function reviewPlainComment(source: PlainCommentLegacySource, read: (source: PlainCommentLegacySource) => Promise<unknown>, lease: Pick<WorkspaceLease, 'assertCurrent'>): Promise<PlainCommentReview> {
 lease.assertCurrent(); const raw = await read(source); lease.assertCurrent();
 if (typeof raw !== 'string' || raw.length > DRAFT_MAX_BYTES * 4) throw Error('The earlier comment draft could not be read. Its original copy has been kept.');
 let text: string;
 if (source.store === 'text') text = restorePlainComment(JSON.stringify({ text: raw }));
 else {
  const value = JSON.parse(raw) as LocalDraft, inspected = inspectDraftRecovery(value, restorePlainComment);
  if (inspected.error || !inspected.seed) throw Error(inspected.error || 'The earlier comment draft is missing.');
  for (const content of [value.content, value.pending?.content, value.pendingCopy?.content].filter(Boolean)) {
   if (content!.surface !== 'comment' || content!.context !== source.context || content!.attachmentIds.length) throw Error('This draft belongs to a different editor. Its original copy has been kept.');
  }
  text = restorePlainComment(value.content.snapshot);
 }
 if (!text) throw Error('The earlier comment draft is empty.');
 return { source, raw, text };
}
export async function copyReviewedPlainComment(review: PlainCommentReview, read: (source: PlainCommentLegacySource) => Promise<unknown>, lease: Pick<WorkspaceLease, 'assertCurrent'>, current: () => string, copy: (text: string) => void) {
 const fresh = await reviewPlainComment(review.source, read, lease);
 if (fresh.raw !== review.raw) throw Error('The earlier draft changed. Review it again before copying.');
 lease.assertCurrent();
 const existing = current(), text = existing ? `${existing}\n\n${fresh.text}` : fresh.text;
 restorePlainComment(JSON.stringify({ text }));
 copy(text);
}
