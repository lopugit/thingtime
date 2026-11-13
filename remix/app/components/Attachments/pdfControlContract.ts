export const PDF_BUILDER_REQUIREMENTS = { 'api.things': '1.66.0', 'api.things-update': '1.30.0' } as const;
export function usesPdfBlocks(value: unknown): boolean {
  const pending = [value], seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== 'object' || seen.has(next)) continue;
    seen.add(next);
    const node = next as Record<string, unknown>;
    if (node.tag === 'tt-pdf' || node.tag === 'tt-pdf-page') return true;
    pending.push(...(Array.isArray(next) ? next : Object.values(node)));
  }
  return false;
}
