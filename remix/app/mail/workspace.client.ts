import {
	accountRemoteWorkspaceLease,
	accountWorkspaceLease,
	anonymousWorkspaceLease,
	canSyncAccountWorkspace,
	currentAccountWorkspace,
	isAnonymousWorkspace
} from '../local-workspace/runtime.client';
import { mailStorageKey, type MailStorageScope } from './localStore';
import type { WorkspaceLease } from '../local-workspace/storage';

export type MailWorkspace = { scope: MailStorageScope; key: string; lease: WorkspaceLease; canSync: () => boolean };
/** Only root-confirmed workspace identity chooses a mail partition. Content and
 * caller-supplied owner IDs never grant access to a different partition. */
export function currentMailWorkspace(): MailWorkspace | null {
	if (isAnonymousWorkspace()) {
		const scope = { kind: 'anonymous' } as const;
		return { scope, key: mailStorageKey(scope), lease: anonymousWorkspaceLease(), canSync: () => false };
	}
	const account = currentAccountWorkspace();
	if (!account) return null;
	return { scope: account, key: mailStorageKey(account), lease: accountWorkspaceLease(account), canSync: () => canSyncAccountWorkspace(account) };
}

/** Local cached identity is not authority to attach cookies or use a relay.
 * All mail API clients, including the Gmail controls, share this gate. */
export async function withMailRemote<T>(ownerId: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const scope = currentAccountWorkspace();
	if (!scope || scope.ownerId !== ownerId) throw new Error('Sign in to this account to use Thingtime mail services.');
	const lease = accountRemoteWorkspaceLease(scope);
	lease.assertCurrent();
	const controller = new AbortController();
	const unsubscribe = lease.onInvalidate(() => controller.abort());
	const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	try {
		combined.throwIfAborted();
		lease.assertCurrent();
		const result = await work(combined);
		combined.throwIfAborted();
		lease.assertCurrent();
		return result;
	} finally {
		unsubscribe();
	}
}
