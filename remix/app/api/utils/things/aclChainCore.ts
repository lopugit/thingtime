// Pure inherit-chain resolution (no DB): walk a thing's tt:inherit chain to
// the first ancestor that carries its own acl, and return that ancestor. The
// walk is bounded by a visited set — a cycle can never loop — plus a
// far-out-of-band ceiling for pathological data. Comment-on-comment chains
// have no natural depth limit (humans nest replies as deep as they like), so
// legitimate chains must never be cut off: a small depth cap here once made
// 5-deep replies invisible — reacting returned "Post not found" while the
// feed still rendered them.
export const MAX_INHERIT_CHAIN = 256;

export type ChainDoc = { shareId: string; targetId?: string | null };

// Returns the terminal (non-inheriting) ancestor, or null when the chain is
// broken: a missing/deleted target, a cycle, or a chain past MAX_INHERIT_CHAIN.
export const resolveInheritChain = async <T extends ChainDoc>(
  doc: T,
  inheritsAcl: (doc: T) => boolean,
  findByShareId: (shareId: string) => Promise<T | null>
): Promise<T | null> => {
  let current = doc;
  const seen = new Set<string>([current.shareId]);
  while (inheritsAcl(current)) {
    if (!current.targetId || seen.has(current.targetId) || seen.size > MAX_INHERIT_CHAIN) return null;
    seen.add(current.targetId);
    const target = await findByShareId(current.targetId);
    if (!target) return null;
    current = target;
  }
  return current;
};
