import type { ClientRootData } from '../local-workspace/rootFallback';
import { useRouteLoaderData } from 'react-router';
import { useCurrentUser, type CurrentUser } from './useCurrentUser';
import { LOCAL_WORKSPACE_OWNER } from '../local-workspace/runtime.client';

/** Content ownership for local-capable editors ONLY. Authentication, account
 * settings, sharing and cloud clients must continue to use useCurrentUser. */
export type WorkspaceUser = NonNullable<CurrentUser> & { localOnly?: true; offline?: true };
const anonymous: WorkspaceUser = {
	id: LOCAL_WORKSPACE_OWNER, ttid: LOCAL_WORKSPACE_OWNER, username: 'local', displayName: 'Local workspace',
	email: '', bio: null, avatarUrl: null, bannerUrl: null, avatarAttachmentId: null, bannerAttachmentId: null,
	avatarLinkedUrl: null, bannerLinkedUrl: null, birthday: null, emailVerified: false, isAdmin: false,
	publicUploadsEnabled: false, privateUploadsEnabled: false, createdAt: '', accountKind: 'user',
	emailVerificationRequiredBy: null, storageAllowanceBytes: null, storageUsedBytes: null, storageRemainingBytes: null,
	storageAccountingReady: false, storage: { usedBytes: null, allowanceBytes: null, remainingBytes: null, overageBytes: null,
		status: 'unavailable', accountingVersion: null, reconciledAt: null }, activeThemeId: null, activeFeedAlgorithmId: null,
	localOnly: true
};
/** Display identity for local editors; this projection carries no remote grants. */
export const offlineWorkspaceUser = (user: Pick<WorkspaceUser,'id'> & Partial<Pick<WorkspaceUser,'username'|'displayName'|'isCharacter'>>): WorkspaceUser => ({
 ...anonymous, ...user, ttid:user.id, username:user.username || 'offline', displayName:user.displayName || 'Offline account workspace', localOnly:undefined, offline:true
});
export function useWorkspaceUser(): WorkspaceUser | null {
	const data = useRouteLoaderData('root') as ClientRootData | undefined; const user = useCurrentUser();
	if (user && !user.temporary) return user;
	if (data?.offlineWorkspace) return offlineWorkspaceUser({id:data.offlineWorkspace.ownerId});
	return data ? anonymous : null;
}

export function useOfflineWorkspace() {
 return (useRouteLoaderData('root') as ClientRootData | undefined)?.offlineWorkspace;
}
