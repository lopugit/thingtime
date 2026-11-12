export type RankedSearchResult = { id: string; rankScore?: number };
export type RankedSearchSource = { shareId: string; score?: unknown };

// Mongo's text score is query-relative metadata, not part of the persisted
// Thing. Carry it onto the search-only public projection without leaking an
// invalid/driver-shaped value or adding the field to chronological results.
export const attachRankScores = <T extends { id: string }>(
  projected: T[],
  sources: RankedSearchSource[]
): Array<T & RankedSearchResult> => {
  const scores = new Map<string, number>();
  for (const source of sources) {
    if (typeof source.score === 'number' && Number.isFinite(source.score)) {
      scores.set(source.shareId, source.score);
    }
  }
  return projected.map((thing) => {
    const rankScore = scores.get(thing.id);
    return rankScore === undefined ? thing : { ...thing, rankScore };
  });
};
