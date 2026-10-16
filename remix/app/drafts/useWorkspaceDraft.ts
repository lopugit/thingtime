import React from 'react';
import { readLocalCache } from '../hooks/localCache';
import { validateDraftContent, type AccountDraft } from './draftCore';
import type { LocalDraft } from './draftSession';
import { useWorkspaceUser } from '../hooks/useWorkspaceUser';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '../local-workspace/storageStatus.client';
import { useAccountDraft } from './useAccountDraft';
import { workspaceDraftContext, workspaceDraftRequest } from './workspaceDraft';

/** Reuse the existing draft session, local recovery, retry and retirement.
 * Offline account transport may fail; content creation never awaits that queue. */
export function useWorkspaceDraft(input: Omit<Parameters<typeof useAccountDraft>[0], 'actor' | 'request'> & { enabled?: boolean }) {
 const user = useWorkspaceUser();
 const { enabled = true, ...draftInput } = input;
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 // Recreate the captured lease on identity changes even when the scope is the same.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const binding = React.useMemo(() => workspaceStorageBinding(), [identity]);
 const [resolutionError, setResolutionError] = React.useState('');
 const [resolved, setResolved] = React.useState<{ identity: string; original: string; context: string } | null>(null);
 React.useEffect(() => {
  let active = true;
  if (binding) void workspaceDraftContext(binding.scope, input.context).then(context => {
   try { binding.lease.assertCurrent(); if (active) setResolved({ identity, original: input.context, context }); } catch { /* retired editor */ }
  }).catch(() => { if (active) setResolutionError('Could not prepare draft recovery. Keep this editor open; saving the Thing is still available.'); });
  return () => { active = false; };
 }, [binding, identity, input.context]);
 const context = resolved?.identity === identity && resolved.original === input.context ? resolved.context : '';
 const request = React.useMemo(() => binding ? workspaceDraftRequest(binding.lease) : undefined, [binding]);
 const draft = useAccountDraft({ ...draftInput, context, actor: enabled && context ? user?.id : null, request });
 const legacyKey = typeof location === 'undefined' || !user || !enabled ? null : `tt-account-draft:${location.origin}:${user.id}:${input.context}`;
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
 return { ...draft, error: resolutionError || draft.error, context, copyIntoEditor,
  legacy: legacy?.content?.context === input.context ? { ...legacy.content, id: legacy.id, revision: legacy.revision, mode: 'draft' as const, createdAt: '', updatedAt: '' } : null };

}
