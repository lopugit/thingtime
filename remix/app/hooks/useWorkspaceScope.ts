import { useSyncExternalStore } from 'react';
import { currentAccountWorkspace, isAnonymousWorkspace, subscribeWorkspaceBinding } from '../local-workspace/runtime.client';
import { workspaceScopeKey } from '../local-workspace/storage';
import { rootIdentity } from '../utils/rootIdentity';
const snapshot = () => {
	const account = currentAccountWorkspace();
	return account ? workspaceScopeKey(account) : isAnonymousWorkspace() ? workspaceScopeKey({ kind: 'anonymous' }) : 'pending';
};
const subscribe = (notify: () => void) => {
	const unbind = subscribeWorkspaceBinding(notify),
		unroot = rootIdentity.subscribe(notify);
	return () => {
		unbind();
		unroot();
	};
};
/** Key local-capable views and caches by the full partition, including data plane. */
export const useWorkspaceScope = () => useSyncExternalStore(subscribe, snapshot, () => 'pending');
