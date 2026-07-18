// Shared "N things match" capped-count machinery for the things collection.
//
// Both /search (things/search.ts) and the schema browser (schemas/browse.ts)
// show an approximate match total next to their results. That count is a UX
// nicety, never worth a full collection scan hanging a request — so it is
// bounded two ways: a hard COUNT_LIMIT ceiling and a COUNT_MAX_TIME_MS server
// deadline. Both readers MUST share this one implementation; a cap or timeout
// tuned in only one place would make /search and /schemas report inconsistent
// totals and paging for the same query.

// Ceiling for the reported total: at most this many matches are ever counted.
export const COUNT_LIMIT = 1000;
// Server-side deadline for the count — a slower count degrades to "unknown"
// (total: null) rather than blocking the page.
export const COUNT_MAX_TIME_MS = 2000;

// Structural collection shape — only countDocuments is needed, so both a real
// mongo Collection and a lighter test double satisfy it.
type CountableCollection = {
  countDocuments: (filter: any, options: any) => Promise<number>;
};

// First-page-only capped total shared by search + browse.
//
// - cursor pages skip the count entirely: load-more keeps the total it already
//   has, so re-counting on every page would be pure waste → { total: null }.
// - a count timeout / failure degrades to { total: null } (unknown), never an
//   error that takes the whole page down.
// - "capped" means STRICTLY more than COUNT_LIMIT matched: we ask for
//   COUNT_LIMIT + 1 and report totalCapped only when that extra doc came back,
//   so EXACTLY COUNT_LIMIT matches reads as an exact total, not a capped one.
export const fetchCappedTotal = async (
  collection: CountableCollection,
  match: unknown,
  cursor: unknown
): Promise<{ total: number | null; totalCapped: boolean }> => {
  if (cursor) return { total: null, totalCapped: false };
  try {
    const count = await collection.countDocuments(match as any, {
      limit: COUNT_LIMIT + 1,
      maxTimeMS: COUNT_MAX_TIME_MS
    });
    return count > COUNT_LIMIT
      ? { total: COUNT_LIMIT, totalCapped: true }
      : { total: count, totalCapped: false };
  } catch {
    return { total: null, totalCapped: false };
  }
};
