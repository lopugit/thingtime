// Domain packs: server-bound implementations of the pure, bounded functions
// the action expression catalogue declares by name + arity
// (schemas/actionExpressions.ts). A pack function receives its ALREADY
// RESOLVED args, returns JSON-safe data, and throws a plain Error whose
// message becomes the run refusal. Packs are deterministic unless documented
// otherwise (random rolls take an injectable unit-interval generator so tests
// can pin outcomes), never touch the database, the network, or the
// environment, and stay bounded in output size — the executor still caps the
// step result bytes and counts every pack call against the operation budget.

export type PackFunction = (args: unknown[], context: PackContext) => unknown;

export type PackContext = {
	random: () => number; // unit interval, seedable in tests
	now: () => Date;
};

export type ActionPack = Record<string, PackFunction>;
