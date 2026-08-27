import { Binary } from 'mongodb';

// Server-owned Thing uniqueness always rides the one sparse multikey
// `uniqueKeys` index. Binary values stay outside the wildcard text index, and
// the field namespace keeps otherwise-identical domain hashes disjoint.
export const thingUniqueKey = (field: string, value: string): Binary =>
	new Binary(Buffer.from(`${field}:${value}`, 'utf8'));

export const thingUniqueKeys = (field: string, values: readonly string[]): Binary[] =>
	Array.from(new Set(values.filter(Boolean))).map((value) => thingUniqueKey(field, value));

// The crystal fallback lets a pre-consolidation preview row heal on its next
// upsert. New rows and fully migrated home rows use only the indexed root arm.
export const thingUniqueKeyFilter = (field: string, value: string, crystalField = field): Record<string, unknown> => ({
	$or: [{ uniqueKeys: thingUniqueKey(field, value) }, { [`crystal.${crystalField}`]: value }]
});

export const thingUniqueKeysFilter = (field: string, values: readonly string[], crystalField = field): Record<string, unknown> => ({
	$or: [
		{ uniqueKeys: { $in: thingUniqueKeys(field, values) } },
		{ [`crystal.${crystalField}`]: { $in: [...values] } }
	]
});
