import { accountRemoteWorkspaceLease, currentAccountWorkspace } from './runtime.client';
import { WorkspaceError } from './storage';

/** A Character selector is server-checked delegation, not local ownership.
 * Capture the root workspace and selected database before any asynchronous work. */
export async function withCharacterRequest<T>(run: (signal: AbortSignal, scope: NonNullable<ReturnType<typeof currentAccountWorkspace>>) => Promise<T>): Promise<T> {
 const scope = currentAccountWorkspace();
 if (!scope) throw new WorkspaceError('ACCOUNT_UNCONFIRMED', 'Reconnect to your account to use this Character.', 503);
 const lease = accountRemoteWorkspaceLease(scope);
 lease.assertCurrent();
 if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new WorkspaceError('CHARACTER_OFFLINE', 'Reconnect to use this Character. Device draft recovery is kept separately.', 503);
 const controller = new AbortController(), stop = lease.onInvalidate(() => controller.abort());
 try {
  const result = await run(controller.signal, scope);
  lease.assertCurrent();
  return result;
 } finally { stop(); }
}
