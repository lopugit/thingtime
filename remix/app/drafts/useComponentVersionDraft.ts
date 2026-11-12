import React from 'react';
import { useWorkspaceDraft } from './useWorkspaceDraft';
import { restoreComponentVersionDraft, type ComponentVersionDraft } from './componentVersionDraft';
export function useComponentVersionDraft(id: string, value: ComponentVersionDraft, onRestore: (value: ComponentVersionDraft) => void, busy: boolean, resumeRemote: boolean) {
 const draft = useWorkspaceDraft({ context: `component-version:${id}`, surface: 'definition', resumeRemote: resumeRemote && !!id,
  validateSnapshot: restoreComponentVersionDraft, onRestore: saved => onRestore(restoreComponentVersionDraft(saved.snapshot)) });
 const snapshot = JSON.stringify(value), capture = draft.capture;
 React.useEffect(() => {
  if (id && !busy) capture({ name: (value.name || 'Component version draft').slice(0, 160), surface: 'definition', context: draft.context, snapshot, attachmentIds: [] });
 }, [id, busy, snapshot, value.name, draft.context, capture]);
 return draft;
}
