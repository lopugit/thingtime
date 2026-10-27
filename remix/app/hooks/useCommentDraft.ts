import React from 'react';
import { LOCAL_WORKSPACE_OWNER } from '~/local-workspace/runtime.client';
import localforage from 'localforage';
import { useWorkspaceDraft } from '~/drafts/useWorkspaceDraft';
import { accountDraftReview } from '~/drafts/draftClient';
import { plainCommentContext, restorePlainComment, plainCommentLegacySources, reviewPlainComment, copyReviewedPlainComment, type PlainCommentLegacySource, type PlainCommentReview } from '~/drafts/plainCommentDraft';
import { subscribeWorkspaceStorage, workspaceStorageBinding, workspaceStorageIdentity } from '~/local-workspace/storageStatus.client';

const readLegacy = async (source: PlainCommentLegacySource) => source.store === 'text' ? localforage.getItem(source.key) : localStorage.getItem(source.key);
export const useCommentDraft = (userId: string | null | undefined, targetId: string, isOpen = false) => {
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const binding = React.useMemo(() => workspaceStorageBinding(), [identity]);
 const enabled = !!binding && !!userId && (binding.scope.kind === 'account' ? userId !== LOCAL_WORKSPACE_OWNER : userId === LOCAL_WORKSPACE_OWNER);
 const scope = JSON.stringify([identity, userId, targetId]);
 const active = React.useRef(scope); active.current = scope;
 const mounted = React.useRef(true);
 React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 const [state, setState] = React.useState({ scope, value: '', touched: false, restored: false });
 const live = React.useRef(state); live.current = state;
 const pending = React.useRef<string | null>(null);
 const lease = React.useMemo(() => ({ assertCurrent() {
  if (!mounted.current || !binding || !enabled || active.current !== scope) throw Error('The comment workspace changed. Reopen this editor.');
  binding.lease.assertCurrent();
 } }), [binding, scope, enabled]);
 const isCurrent = () => { try { lease.assertCurrent(); return true; } catch { return false; } };
 const accountRecovery = enabled && binding?.scope.kind === 'account' && binding.scope.ownerId === userId;
 const readSource = async (source: PlainCommentLegacySource) => {
  lease.assertCurrent();
  if (source.store !== 'account') return readLegacy(source);
  if (!accountRecovery) throw Error('Reconnect to your account to review this draft.');
  return JSON.stringify(await accountDraftReview(userId!, binding!.lease).read(source.key));
 };
 const update = (next: typeof state) => { live.current = next; setState(next); };
 const value = state.scope === scope ? state.value : '';
 const draft = useWorkspaceDraft({ enabled, actor: userId, surface: 'comment', resumeRemote: isOpen, context: plainCommentContext(targetId), validateSnapshot: restorePlainComment,
  onRestore: saved => {
   if (isCurrent() && !(live.current.scope === scope && live.current.touched)) update({ scope, value: restorePlainComment(saved.snapshot), touched: false, restored: true });
  }
 });
 const { capture, context, retire } = draft;
 const setValue = (next: string) => {
  lease.assertCurrent();
  update({ scope, value: next, touched: true, restored: false });
  if (context) capture({ name: (next || 'Comment draft').slice(0,160), surface: 'comment', context, snapshot: JSON.stringify({ text: next }), attachmentIds: [] }, !!next, true);
 };
 // A keystroke received while the scoped context hash is being prepared must
 // survive preparation and must not be replaced by late automatic recovery.
 React.useEffect(() => {
  if (!context || live.current.scope !== scope || !live.current.touched) return;
  const text = live.current.value;
  capture({ name: (text || 'Comment draft').slice(0,160), surface: 'comment', context, snapshot: JSON.stringify({ text }), attachmentIds: [] }, !!text, true);
 }, [capture, context, scope]);
 const clear = async (submitted?: string) => {
  if (!isCurrent() || live.current.scope !== scope || (submitted !== undefined && live.current.value.trim() !== submitted)) return;
  update({ scope, value: '', touched: false, restored: false });
  // Content completion does not await draft retirement, and never deletes an
  // older device key that has not been explicitly adopted by this session.
  void retire().catch(() => {});
 };
 const [legacy, setLegacy] = React.useState<{ scope: string; sources: PlainCommentLegacySource[]; error: string }>({ scope, sources: [], error: '' });
 React.useEffect(() => {
  let current = true;
  if (binding && userId && enabled && isOpen) void (async () => {
   const sources = await plainCommentLegacySources(location.origin, userId, targetId, binding.scope), keys = await localforage.keys();
   lease.assertCurrent();
   const localKeys = new Set(Object.keys(localStorage));
   if (current) setLegacy({ scope, sources: sources.filter(source => source.store === 'text' ? keys.includes(source.key) : localKeys.has(source.key)), error: '' });
  })().catch(error => { if (current && isCurrent()) setLegacy({ scope, sources: [], error: error.message || 'Earlier draft discovery failed.' }); });
  return () => { current = false; };
 // isCurrent checks the captured lease; it is deliberately not an effect identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [binding, userId, targetId, isOpen, lease, scope, enabled]);
 return { ...draft, value, setValue, clear, hydrated: state.scope === scope && state.restored,
  legacySources: legacy.scope === scope ? legacy.sources : [], legacyError: legacy.scope === scope ? legacy.error : '', identity: scope,
  accountRecovery,
  listLegacyAccount: async (cursor: string | null = null) => {
   lease.assertCurrent(); if (!accountRecovery) throw Error('Reconnect to your account to review earlier drafts.');
   const page = await accountDraftReview(userId!, binding!.lease).list(plainCommentContext(targetId), cursor); lease.assertCurrent();
   return { sources: page.drafts.map(saved => ({ key: saved.id, store: 'account' as const, context: saved.context, label: saved.name || 'Untitled account draft' })), nextCursor: page.nextCursor };
  },
  reviewLegacy: (source: PlainCommentLegacySource) => reviewPlainComment(source, readSource, lease),
  copyLegacy: (review: PlainCommentReview) => copyReviewedPlainComment(review, readSource, lease, () => live.current.scope === scope ? live.current.value : '', setValue),
  begin: () => { if (!isCurrent() || pending.current === scope) return false; pending.current = scope; return true; },
  end: () => { if (pending.current === scope) pending.current = null; }
 };
};
