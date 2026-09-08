import type { ThingsIndexPlanEntry } from './collections';

// Candidates are review prompts, NEVER instructions to drop an index. Prefix
// equivalence alone says nothing about workload selectivity or hot-cache cost.
export const ordinaryPrefixCandidates = (entries: readonly ThingsIndexPlanEntry[]) => {
  const ordinary = entries.filter(({ keys, options }) =>
    !options.unique && !options.sparse && !options.partialFilterExpression &&
    options.expireAfterSeconds === undefined && !options.collation && !options.hidden &&
    Object.values(keys).every((value) => value === 1 || value === -1)
  );
  return ordinary.flatMap((short) => ordinary.filter((long) => {
    const prefix = Object.entries(short.keys);
    const compound = Object.entries(long.keys);
    return prefix.length < compound.length && prefix.every(([field, direction], i) =>
      compound[i][0] === field && compound[i][1] === direction
    );
  }).map((long) => ({ candidate: short.name, covering: long.name })));
};

export const summarizeThingIndexPlan = (entries: readonly ThingsIndexPlanEntry[]) => ({
  // The server creates _id_ independently of our plan.
  total: entries.length + 1,
  headroom: 64 - entries.length - 1,
  unique: entries.filter(({ options }) => options.unique).length + 1,
  ttl: entries.filter(({ options }) => options.expireAfterSeconds !== undefined).length,
  text: entries.filter(({ keys }) => Object.values(keys).includes('text')).length,
  partial: entries.filter(({ options }) => options.partialFilterExpression).length,
  sparse: entries.filter(({ options }) => options.sparse).length,
  legacy: entries.filter(({ keys, options }) => 'kind' in keys ||
    (options.partialFilterExpression && 'kind' in (options.partialFilterExpression as object))).map(({ name }) => name),
  ordinaryPrefixCandidates: ordinaryPrefixCandidates(entries)
});
