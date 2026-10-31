export type CompleteAdminSnapshot<T> = {
  rows: T[];
};

// Drain bounded server keyset pages into one deduplicated client snapshot.
// Typed filtering/sorting happens only after this resolves, so computed and
// nested fields remain exhaustive without re-running cross-collection server
// aggregates for every query edit.
export const loadCompleteAdminSnapshot = async <T>(
  loadPage: (cursor: string | undefined, signal?: AbortSignal) => Promise<any>,
  rowsKey: 'users' | 'apps',
  getRowId: (row: T) => string,
  signal?: AbortSignal
): Promise<CompleteAdminSnapshot<T>> => {
  const byId = new Map<string, T>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    signal?.throwIfAborted();
    const resp = await loadPage(cursor, signal);
    signal?.throwIfAborted();
    if (resp?.ok !== true) throw new Error('Could not load the complete admin directory');
    const pageRows = resp[rowsKey];
    if (!Array.isArray(pageRows)) throw new Error('Admin directory returned malformed rows');
    if (resp.nextCursor !== null && (typeof resp.nextCursor !== 'string' || !resp.nextCursor)) {
      throw new Error('Admin directory returned a malformed cursor');
    }
    for (const row of pageRows as T[]) {
      const rowId = getRowId(row);
      if (typeof rowId !== 'string' || !rowId) throw new Error('Admin directory returned a row without an id');
      byId.set(rowId, row);
    }

    const nextCursor = resp.nextCursor as string | null;
    if (!nextCursor) return { rows: [...byId.values()] };
    if (seenCursors.has(nextCursor)) throw new Error('Admin directory returned a repeated cursor');
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
};
