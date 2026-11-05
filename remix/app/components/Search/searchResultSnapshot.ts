export type SearchResultQuery = { text: string; key: string };
export type SearchResultSnapshot = { query: SearchResultQuery; retained: boolean };

/** Use the compiled request meaning, excluding row IDs and presentation metadata. */
export function searchResultQuery(input: { q: string; mode: string; conditions: unknown; kind: string; sort: string }): SearchResultQuery {
 const text = input.q.trim();
 const sort = input.sort === 'auto' || (input.sort === 'relevance' && !text) ? '' : input.sort;
 return { text, key: JSON.stringify([text, input.mode, input.conditions, input.kind, sort]) };
}

/** A failed refresh retains the query that actually produced these results. */
export function retainSearchResults(snapshot: SearchResultSnapshot | null): SearchResultSnapshot | null {
 return snapshot ? { ...snapshot, retained: true } : null;
}

export function searchResultSnapshotNotice(snapshot: SearchResultSnapshot | null, current: SearchResultQuery, hasResults: boolean): string | null {
 if (!snapshot || !hasResults) return null;
 if (snapshot.query.key !== current.key) return 'Showing a cached, partial snapshot from the previous search. These results may not match the current search text or filters. Run Search to update them.';
 if (snapshot.retained) return 'Showing cached search results from this workspace. This is a partial snapshot; people, subspaces and account results may have changed. Search with a connection to refresh.';
 return null;
}
