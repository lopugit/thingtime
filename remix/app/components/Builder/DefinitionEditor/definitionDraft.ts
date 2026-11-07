import { snapshotTransferValue } from '../../../utils/thingTransfer/value';
export type DefinitionFields = Record<string, { number?: string; newKey?: string; expanded?: boolean }>;
export type DefinitionDraft = { source: string; baseUpdatedAt: string | null; mode: 'fields' | 'source'; fields: DefinitionFields };
const invalid = (): never => { throw new Error('This definition draft cannot be restored. Its saved copy has been kept.'); };
export function restoreDefinitionDraft(snapshot: string): DefinitionDraft {
 const value = JSON.parse(snapshot);
 if (!value || typeof value.source !== 'string' || value.source.length > 512 * 1024 || (value.baseUpdatedAt != null && typeof value.baseUpdatedAt !== 'string') ||
  (value.mode !== undefined && !['fields','source'].includes(value.mode))) return invalid();
 const fields = value.fields ?? {};
 if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 1024) return invalid();
 for (const [key, field] of Object.entries(fields)) {
  let path: unknown; try { path = JSON.parse(key); } catch { return invalid(); }
  if (!Array.isArray(path) || path.length > 32 || path.some(key => typeof key !== 'string' || key.length > 256) || !field || typeof field !== 'object' || Array.isArray(field)) return invalid();
  if (Object.entries(field).some(([name, entry]) => name === 'expanded' ? typeof entry !== 'boolean' : !['number','newKey'].includes(name) || typeof entry !== 'string' || entry.length > 5000)) return invalid();
 }
 return { source: value.source, baseUpdatedAt: value.baseUpdatedAt ?? null, mode: value.mode || 'source', fields };
}
/** Raw source may be incomplete; only the recursive Fields view needs bounded,
 * safe JSON. Recovery validates its envelope without discarding authored text. */
export const parseDefinitionSource = (source: string) => snapshotTransferValue(JSON.parse(source));
export const validDefinitionNumber = (value: string) => /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
export function hasInvalidDefinitionNumbers(fields: DefinitionFields, source: unknown) {
 return Object.entries(fields).some(([path, field]) => {
  let value: any = source;
  for (const key of JSON.parse(path)) value = value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  return typeof value === 'number' && field.number !== undefined && !validDefinitionNumber(field.number);
 });
}
/** Preserve field drafts by position when arrays move; remove only explicitly
 * removed/replaced subtrees, never another row's unfinished numeric input. */
export function remapDefinitionFields(fields: DefinitionFields, path: string[], change: { remove?: string; move?: [number, number]; reset?: boolean }): DefinitionFields {
 const result: DefinitionFields = {};
 for (const [key, field] of Object.entries(fields)) {
  const parts = JSON.parse(key) as string[];
  if (path.every((part, index) => parts[index] === part)) {
   if (change.reset) continue;
   const next = parts[path.length];
   if (next !== undefined && change.remove !== undefined) {
    if (next === change.remove) continue;
    if (/^\d+$/.test(next) && /^\d+$/.test(change.remove) && Number(next) > Number(change.remove)) parts[path.length] = String(Number(next) - 1);
   }
   if (next !== undefined && change.move) {
    if (next === String(change.move[0])) parts[path.length] = String(change.move[1]);
    else if (next === String(change.move[1])) parts[path.length] = String(change.move[0]);
   }
  }
  result[JSON.stringify(parts)] = field;
 }
 return result;
}
