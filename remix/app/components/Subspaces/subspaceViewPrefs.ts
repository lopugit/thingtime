export type SubspaceViewPrefs = { mode: 'posts' | 'messages'; expandComments: boolean };
export type SubspaceViewScope = { origin: string; dataPlane: string | null; viewerId: string | null; subspaceId: string };
export const DEFAULT_SUBSPACE_VIEW_PREFS: SubspaceViewPrefs = { mode: 'posts', expandComments: false };

// Both authority and resource are explicit. Never let a second account or
// another database on the same origin inherit a private subspace's view.
export const subspaceViewPrefsKey = (scope: SubspaceViewScope) =>
  `tt-subspace-view-v1:${JSON.stringify([scope.origin, scope.dataPlane, scope.viewerId || 'anonymous', scope.subspaceId])}`;
export function normalizeSubspaceViewPrefs(value: unknown): SubspaceViewPrefs {
  const input = value as Partial<SubspaceViewPrefs> | null;
  return { mode: input?.mode === 'messages' ? 'messages' : 'posts', expandComments: input?.expandComments === true };
}
export function readSubspaceViewPrefs(storage: Pick<Storage, 'getItem'> | undefined, key: string): SubspaceViewPrefs {
  try { return normalizeSubspaceViewPrefs(JSON.parse(storage?.getItem(key) || 'null')); }
  catch { return { ...DEFAULT_SUBSPACE_VIEW_PREFS }; }
}
