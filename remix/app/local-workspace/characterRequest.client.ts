import { accountRemoteWorkspaceLease, accountWorkspaceLease, currentAccountWorkspace } from './runtime.client';
import { WorkspaceError } from './storage';

/** A Character selector is server-checked delegation, not local ownership.
 * Capture the root workspace and selected database before any asynchronous work. */
type CharacterRequest<T> = (signal: AbortSignal, scope: NonNullable<ReturnType<typeof currentAccountWorkspace>>) => Promise<T>;

/** Capture when constructing a view/callback, not when a delayed callback runs.
 * Local identity survives reconnect; remote authority is rechecked per request. */
export function createCharacterRequest() {
 const scope = currentAccountWorkspace();
 const local = scope ? accountWorkspaceLease(scope) : null;
 return async <T>(run: CharacterRequest<T>): Promise<T> => {
  if (!scope || !local) throw new WorkspaceError('ACCOUNT_UNCONFIRMED', 'Reconnect to your account to use this Character.', 503);
  local.assertCurrent();
  const lease = accountRemoteWorkspaceLease(scope);
  lease.assertCurrent();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new WorkspaceError('CHARACTER_OFFLINE', 'Reconnect to use this Character. Device draft recovery is kept separately.', 503);
  const controller = new AbortController(), stop = lease.onInvalidate(() => controller.abort());
  try {
   const result = await run(controller.signal, scope);
   lease.assertCurrent();
   return result;
  } finally { stop(); }
 };
}

export const withCharacterRequest = <T>(run: CharacterRequest<T>): Promise<T> => createCharacterRequest()(run);

/** A delegated API must keep the same callback retirement rules as the owner
 * API. It grants no local account partition and cannot adopt a later session. */
export function characterApi<T extends Record<string, any>>(remote: T): T {
 const request = createCharacterRequest();
 const guard = (value: any, path: string[] = []): any => {
  // These synchronous capability predicates must remain booleans, not promises.
  if (path.length === 2 && path[0] === 'timeline' && ['canChangeLocally', 'canExportLocally'].includes(path[1])) return () => false;
  if (typeof value === 'function') return (...args: any[]) => request(async () => value(...args));
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, guard(child, [...path, key])]));
  return value;
 };
 return guard(remote);
}
