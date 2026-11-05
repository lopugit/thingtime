import React from 'react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { workspaceIdentityKey, subscribeWorkspaceIdentity } from '../local-workspace/runtime.client';
import { currentMailWorkspace } from './workspace.client';

export function useMailWorkspace() {
	const user = useCurrentUser();
	const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, () => '');
	const workspace = React.useMemo(() => (identity ? currentMailWorkspace() : null), [identity]);
	// Service accounts do not inherit personal mail authority.
	return { identity, workspace: user?.accountKind === 'service' ? null : workspace };
}
