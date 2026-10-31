import { useSyncExternalStore } from 'react';
import { useCharacterScope } from '../components/Characters/CharacterScope';
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
export const useWorkspaceScope = () => {
 const root = useSyncExternalStore(subscribe, snapshot, () => 'pending'), actor = useCharacterScope(), account = currentAccountWorkspace();
 return root !== 'pending' && account && actor && actor.id !== account.ownerId
  ? workspaceScopeKey({...account,ownerId:actor.id,delegatedBy:account.ownerId}) : root;
};
