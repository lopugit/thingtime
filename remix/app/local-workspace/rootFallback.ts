import type { RootLoaderData } from '../root-data.server';
import { RootDataUnavailableError } from '../utils/rootDataRecovery';
import { isDataPlane } from '../utils/dataPlane';
import type { WorkspaceScope } from './storage';

export type AccountWorkspaceScope = Extract<WorkspaceScope, { kind: 'account' }>;
/** Added by the browser only. The server root response never grants offline
 * authority; an offline pointer is content identity, not authentication. */
export type ClientRootData = RootLoaderData & { offlineWorkspace?: AccountWorkspaceScope };
const KEY = 'thingtime:local-workspace-root:v1';
const accountScope = (value: unknown, origin?: string): AccountWorkspaceScope | null => {
 if (!Array.isArray(value) || value.length !== 5 || value[0] !== 'account' || value[1] !== 1 || value[2] !== origin ||
  typeof value[3] !== 'string' || !/^[\w-]{1,128}$/.test(value[3]) || !isDataPlane(value[4])) return null;
 try { if (!origin || new URL(origin).origin !== origin) return null; } catch { return null; }
 return { kind: 'account', origin, ownerId: value[3], dataPlane: value[4] };
};
/** Retain only the last confirmed workspace pointer. Never cache a profile,
 * session, bearer credential, deployment config or remote authorization. */
export function createLocalRootFallback(storage: Pick<Storage, 'getItem' | 'setItem'>, origin?: string) {
 return {
  confirm: (anonymous: boolean, account?: AccountWorkspaceScope) => {
   const pointer = account && ['account', 1, account.origin, account.ownerId, account.dataPlane];
   try { storage.setItem(KEY, anonymous ? 'anonymous' : accountScope(pointer, origin) ? JSON.stringify(pointer) : 'account'); } catch {}
  },
  invalidate: () => { try { storage.setItem(KEY, 'unknown'); } catch {} },
  read: (error: unknown, pending = false): ClientRootData | null => {
   if (pending || !(error instanceof RootDataUnavailableError) || !error.retryable) return null;
   let raw: string | null;
   try { raw = storage.getItem(KEY); } catch { return null; }
   if (!raw || raw.length > 1024) return null;
   let scope: AccountWorkspaceScope | null = null;
   if (raw !== 'anonymous') { try { scope = accountScope(JSON.parse(raw), origin); } catch {} if (!scope) return null; }
   return { user: null, dataPlane: scope?.dataPlane || 'home', envFromCookie: {}, devKitEnv: {}, dataEnvironment: null, titlePrefix: '[Offline]', ...(scope ? { offlineWorkspace: scope } : {}) };
  }
 };
}
