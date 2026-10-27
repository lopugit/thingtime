import { WorkspaceError } from './storage';
const prefix = 'workspace-search:';
type Continuation = { key: string; remote: string | null; pending: string | null };
const keyOf = (scope: string, query: Record<string, unknown>) => JSON.stringify([scope, query.q || '', query.thingtime || '']);
export function readWorkspaceSearchCursor(cursor: unknown, scope: string, query: Record<string, unknown>): Continuation | null {
 if (!cursor || (typeof cursor === 'string' && cursor.startsWith('local-search:'))) return null;
 try {
  if (typeof cursor !== 'string' || cursor.length > 8192 || !cursor.startsWith(prefix)) throw new Error();
  const value = JSON.parse(cursor.slice(prefix.length));
  if (value?.key !== keyOf(scope, query) || ![value.remote, value.pending].every(item => item === null || typeof item === 'string') || (value.pending && !value.pending.startsWith('local-search:'))) throw new Error();
  return value;
 } catch { throw new WorkspaceError('INVALID_SEARCH_CURSOR', 'Search scope or filters changed. Start a new search.'); }
}
export function workspaceSearchCursor(scope: string, query: Record<string, unknown>, remote: string | null, pending: string | null) {
 return remote || pending ? prefix + JSON.stringify({ key: keyOf(scope, query), remote, pending }) : null;
}
