import { Binary } from 'mongodb';

// Server-owned Thing uniqueness always rides the one sparse multikey
// `uniqueKeys` index. Binary values stay outside the wildcard text index, and
// the field namespace keeps otherwise-identical domain hashes disjoint.
export const thingUniqueKey = (field: string, value: string): Binary =>
	new Binary(Buffer.from(`${field}:${value}`, 'utf8'));

export const thingUniqueKeys = (field: string, values: readonly string[]): Binary[] =>
	Array.from(new Set(values.filter(Boolean))).map((value) => thingUniqueKey(field, value));

// Lookups ride the protected root `uniqueKeys` index and nothing else. A second
// `$or` arm on `crystal.<field>` must never be added back: those five crystal
// fields carry no index, and MongoDB only unions `$or` branches when *every*
// branch is indexed — one unindexed arm downgrades the whole lookup to a
// COLLSCAN of `things` (measured on 50k rows: 1 doc examined via `uniqueKeys`
// vs 50,001 with the crystal arm), on paths that run once per synced event,
// message segment and command. No row can predate the root keys: every one of
// these key families is introduced by this branch, `newDeviceThing`/
// `newThingDoc` stamp `uniqueKeys` at insert, and
// `backfillConsolidatedThingUniqueKeys` heals preview rows at bootstrap.
export const thingUniqueKeyFilter = (field: string, value: string): Record<string, unknown> => ({
	uniqueKeys: thingUniqueKey(field, value)
});

export const thingUniqueKeysFilter = (field: string, values: readonly string[]): Record<string, unknown> => ({
	uniqueKeys: { $in: thingUniqueKeys(field, values) }
});
