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

// Operator-side, read-only native evidence through the API utility boundary.
// Return counts/plans only, never sampled identities or protected key bytes.
export const inspectHomeRelationshipLookups = async () => {
  const [{ getHomeThingsCollection, getSettingsCollection }, layout, { RELATIONSHIP_UNIQUE_CRYSTAL_KEYS }, { thingUniqueKeyFilter }] = await Promise.all([
    import('./collections'), import('./relationshipIndexLayout'), import('../messenger/shared'), import('./uniqueKeys')
  ]);
  const things = await getHomeThingsCollection();
  const ready = await layout.relationshipIndexLayoutReady(await getSettingsCollection());
  const rows: { family: string; sampled: boolean; returned?: number; docsExamined?: number; keysExamined?: number }[] = [];
  for (const family of layout.SHARED_RELATIONSHIP_KINDS) {
    const field = RELATIONSHIP_UNIQUE_CRYSTAL_KEYS[family];
    const sample = await things.findOne({ thingtime: family, [`crystal.${field}`]: { $type: 'string', $ne: '' } }, { projection: { [`crystal.${field}`]: 1 }, maxTimeMS: 5000 });
    if (!sample) { rows.push({ family, sampled: false }); continue; }
    const identity = { thingtime: family, [`crystal.${field}`]: sample.crystal[field] };
    const filter = ready ? { ...identity, ...thingUniqueKeyFilter(field, sample.crystal[field]) } : identity;
    // No hint: measure the actual planner's choice in the selected layout.
    const { executionStats } = await things.find(filter).limit(1).maxTimeMS(5000).explain('executionStats');
    rows.push({ family, sampled: true, returned: executionStats.nReturned, docsExamined: executionStats.totalDocsExamined, keysExamined: executionStats.totalKeysExamined });
  }
  return { ready, indexCount: (await things.indexes()).length, rows };
};

export const inspectHomeLegacyThingQueries = async (ownerId: string) => {
  const [{ getHomeThingsCollection }, { postMatch }, { embeddedThingListFilter }] = await Promise.all([
    import('./collections'), import('../things/things'), import('../things/embeddedThings')
  ]);
  const things = await getHomeThingsCollection();
  const queries = [
    { name: 'profile-posts', filter: { ...await postMatch(), ownerId }, sort: { createdAt: -1, shareId: 1 } },
    { name: 'owner-embeds', filter: await embeddedThingListFilter(ownerId), sort: { updatedAt: -1, shareId: 1 } }
  ];
  const hasSort = (node: any): boolean => !!node && typeof node === 'object' &&
    (node.stage === 'SORT' || Object.values(node).some(value => typeof value === 'object' && hasSort(value)));
  const rows = [];
  for (const query of queries) {
    const plan = await things.find(query.filter).sort(query.sort).limit(20).maxTimeMS(5000).explain('executionStats');
    rows.push({ name: query.name, returned: plan.executionStats.nReturned, docsExamined: plan.executionStats.totalDocsExamined, keysExamined: plan.executionStats.totalKeysExamined, blockingSort: hasSort(plan.queryPlanner.winningPlan) });
  }
  return rows;
};
