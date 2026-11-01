// The one way the marketing suite builds a key → entry lookup map.
//
// `Object.fromEntries` (and a plain `{}` literal) inherits Object.prototype,
// so `MAP[key]` answers truthily for "constructor", "toString", "valueOf",
// "__proto__" and friends even though no such entry exists. Every guard in
// the suite is written as `if (MAP[key])` / `MAP[key] ? … : fallback`, so an
// inherited hit walks a non-entry straight past the check: `/marketing/
// constructor` rendered a category page titled "Object" instead of "No such
// section", and `?feature=constructor` reached buildSocialSvg and threw.
//
// A null-prototype map has no inherited keys at all, so those guards answer
// only for real entries and the existing fallbacks do their job.

export const byKey = <T, K extends string = string>(items: readonly T[], key: (item: T) => K): Record<K, T> => {
	const map = Object.create(null) as Record<K, T>;
	for (const item of items) map[key(item)] = item;
	return map;
};
