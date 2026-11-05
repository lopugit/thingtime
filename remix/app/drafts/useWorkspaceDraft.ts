import React from 'react';
import { readLocalCache } from '../hooks/localCache';
import { validateDraftContent, type AccountDraft } from './draftCore';
import type { LocalDraft } from './draftSession';
import { useWorkspaceUser } from '../hooks/useWorkspaceUser';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '../local-workspace/storageStatus.client';
import { useAccountDraft } from './useAccountDraft';
import { workspaceDraftContextSync, workspaceDraftRequest } from './workspaceDraft';

/** Reuse the existing draft session, local recovery, retry and retirement.
 * Offline account transport may fail; content creation never awaits that queue. */
export function useWorkspaceDraft(input: Omit<Parameters<typeof useAccountDraft>[0], 'actor' | 'request'> & { enabled?: boolean; actor?: string | null }) {
 const user = useWorkspaceUser();
 const { enabled = true, actor = user?.id, ...draftInput } = input;
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 // Recreate the captured lease on identity changes even when the scope is the same.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const binding = React.useMemo(() => workspaceStorageBinding(), [identity]);
 const resolved = React.useMemo(() => {
  try { return { context: binding ? workspaceDraftContextSync(binding.scope, input.context) : '', error: '' }; }
  catch { return { context: '', error: 'Could not prepare draft recovery. Keep this editor open; saving the Thing is still available.' }; }
 }, [binding, input.context]);
 const context = resolved.context;
 const request = React.useMemo(() => binding ? workspaceDraftRequest(binding.lease) : undefined, [binding]);
 const draft = useAccountDraft({ ...draftInput, context, actor: enabled && context ? actor : null, request });
 const legacyKey = typeof location === 'undefined' || !actor || !enabled ? null : `tt-account-draft:${location.origin}:${actor}:${input.context}`;
 const legacy = legacyKey && context ? readLocalCache<LocalDraft>(legacyKey) : null;
 const copyIntoEditor = async (saved: AccountDraft) => {
  binding?.lease.assertCurrent();
  if (!binding || !context || !enabled) throw new Error('Draft recovery is not ready. Try again.');
  const content = validateDraftContent({ ...saved, context });
  input.onRestore(saved);
  // Copy just the authored snapshot into this editor's independent session.
  // The old draft and its device recovery key remain untouched.
  draft.capture(content, true, true);
 };
 return { ...draft, error: resolved.error || draft.error, context, copyIntoEditor,
  legacy: legacy?.content?.context === input.context ? { ...legacy.content, id: legacy.id, revision: legacy.revision, mode: 'draft' as const, createdAt: '', updatedAt: '' } : null };

}
