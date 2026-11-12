import React from 'react';
import { useApi } from '~/hooks/useApi';
import type { BackupWorkspaceAdapter, BackupWorkspaceScope } from './backupWorkspaceModel';
/** Only canonical, negotiated useApi operations; no storage credentials or
 * engine checkpoints enter this adapter. Folder confirmation re-reads its
 * canonical Timeline revision, which the server independently fences. */
export function useBackupWorkspaceAdapter(scope: BackupWorkspaceScope): BackupWorkspaceAdapter {
 const api = useApi(); const current = React.useRef(api); current.current = api;
 return React.useMemo(() => {
  const options = (signal: AbortSignal) => ({ signal, expectedActor: scope.ownerId, expectedApiOrigin: scope.apiOrigin, expectedDataPlane: scope.dataPlane });
  return {
   catalog: (signal, cursors = {}) => current.current.getBackupWorkspaceCatalog(cursors, options(signal)),
   browse: (id, signal, cursor) => current.current.getBackupWorkspaceEntries({ id, cursor }, options(signal)),
   job: async (id, signal) => (await current.current.getBackupWorkspaceJob({ id }, options(signal))).job,
   review: async (id, signal) => (await current.current.getBackupWorkspaceReview({ id }, options(signal))).review,
   command: async (command, signal) => (await current.current.sendBackupWorkspaceCommand(command, options(signal))).job,
   async destination(id, signal) {
    const { thing } = await current.current.v1.things.get({ id }, options(signal));
    if (thing.author?.id !== scope.ownerId || !thing.thingtime?.includes('folder') || typeof thing.timelineHeadId !== 'string' || !thing.timelineHeadId) throw Error('This folder has no current restore revision. Choose another folder or refresh its history.');
    return { id: thing.id, revision: thing.timelineHeadId, name: String(thing.crystal?.name || 'Untitled folder'), path: String(thing.crystal?.name || 'Untitled folder') };
   }
  };
 }, [scope.ownerId, scope.apiOrigin, scope.dataPlane]);
}
