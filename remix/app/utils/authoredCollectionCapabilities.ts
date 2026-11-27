import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
export const AUTHORED_COLLECTION_REQUIREMENTS = { 'api.schemas': '1.3.0' } as const;
/** New cardinality support is needed only when a write exceeds the old shape.
 * This inspects declared definition structure, never execution/runtime data. */
export function usesExpandedAuthoredCollections(kinds: unknown, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Array.isArray(kinds) && !kinds.some(kind => ['schema','component','webpage'].includes(kind))) return false;
  const crystal = value as Record<string, any>;
  if (Array.isArray(crystal.args) && crystal.args.length > 16) return true;
  if (crystal.savedArgs && typeof crystal.savedArgs === 'object' && Object.keys(crystal.savedArgs).length > 24) return true;
  const stack: any[] = Array.isArray(crystal.fields) ? [...crystal.fields] : [];
  const seen = new WeakSet<object>(); let count = 0;
  while (stack.length) {
    const field = stack.pop();
    if (!field || typeof field !== 'object' || seen.has(field)) continue;
    seen.add(field);
    if (typeof field.type !== 'string') continue;
    if (++count > 80 || Number(field.minItems) > 1000 || Number(field.maxItems) > 1000) return true;
    if (Array.isArray(field.children)) for (const child of field.children) stack.push(child);
    if (field.items) stack.push(field.items);
  }
  const blocks: any[] = Array.isArray(crystal.blocks) ? [...crystal.blocks] : [];
  while (blocks.length) {
    const block = blocks.pop();
    if (!block || typeof block !== 'object' || seen.has(block)) continue;
    seen.add(block);
    if (['args','argBindings'].some(field => block[field] && typeof block[field] === 'object' && Object.keys(block[field]).length > 24)) return true;
    if (Array.isArray(block.children)) for (const child of block.children) blocks.push(child);
  }
  return false;
}
export async function requireAuthoredCollectionCapability(origin?: string) {
  await requireThingtimeCapability('api.schemas', AUTHORED_COLLECTION_REQUIREMENTS['api.schemas'], origin);
}
