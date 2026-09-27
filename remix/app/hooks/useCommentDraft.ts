import React from 'react';
import localforage from 'localforage';
import { useAccountDraft } from '~/drafts/useAccountDraft';

// The plain comment/reply inputs share the account-backed draft protocol with
// rich posts. Migrate the former per-device text only if nothing newer exists.
export const useCommentDraft = (userId: string | null | undefined, targetId: string, isOpen = false) => {
  const scope = `${userId || 'guest'}:${targetId}`;
  const [state, setState] = React.useState({ scope, value: '' });
  const live = React.useRef(state); live.current = state;
  const pending = React.useRef(false);
  const [restored, setRestored] = React.useState(false);
  const value = state.scope === scope ? state.value : '';
  const draft = useAccountDraft({ actor: userId, surface: 'comment', resumeRemote: isOpen, context: `comment:plain:${targetId}`,
    onRestore: saved => {
      const restored = JSON.parse(saved.snapshot);
      if (typeof restored.text === 'string') { setState({ scope, value: restored.text }); setRestored(true); }
    }
  });
  const { capture, current, clear: clearDraft } = draft;
  const setValue = React.useCallback((next: string) => {
    setState({ scope, value: next });
    capture({ name: (next || 'Comment draft').slice(0, 160), surface: 'comment', context: `comment:plain:${targetId}`,
      snapshot: JSON.stringify({ text: next }), attachmentIds: [] }, !!next, true);
  }, [scope, targetId, capture]);
  React.useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void localforage.getItem<string>(`tt-draft:${userId}:${targetId}`).then(stored => {
      if (!cancelled && stored && !current()) setValue(stored);
    });
    return () => { cancelled = true; };
  }, [userId, targetId, setValue, current]);
  const clear = React.useCallback(async (submitted?: string) => {
    if (submitted !== undefined && live.current.value.trim() !== submitted) return;
    setState({ scope, value: '' });
    await clearDraft().catch(() => {});
    if (userId) void localforage.removeItem(`tt-draft:${userId}:${targetId}`);
  }, [scope, userId, targetId, clearDraft]);
  return { value, setValue, clear, hydrated: restored, flush: draft.flush,
    begin: () => { if (pending.current) return false; pending.current = true; return true; },
    end: () => { pending.current = false; }
  };
};
