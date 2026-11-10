import { SCHEMA_FIELD_TYPES } from '../../schemas/registry';
import type { DraftField } from './SchemaBuilder';

/** Incomplete authored values (including invalid numbers/names) must survive,
 * while malformed recovery envelopes must never crash the recursive editor. */
export function restoreSchemaBuilderDraft(snapshot: string): { name: string; description: string; fields: DraftField[] } {
 const value = JSON.parse(snapshot), ids = new Set<string>(); let count = 0;
 const invalid = (): never => { throw new Error('This draft is not a readable schema field tree. The saved draft has been kept.'); };
 function field(row: any, depth: number): boolean {
  if (++count > 1024 || depth > 16 || !row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) return false;
  ids.add(row.id);
  return ['name', 'description', 'values', 'min', 'max', 'unit', 'maxLength', 'minItems', 'maxItems'].every(key => typeof row[key] === 'string')
   && SCHEMA_FIELD_TYPES.includes(row.type) && typeof row.required === 'boolean'
   && Array.isArray(row.children) && row.children.every(child => field(child, depth + 1))
   && (row.items === null || field(row.items, depth + 1));
 }
 if (!value || typeof value.name !== 'string' || typeof value.description !== 'string' || !Array.isArray(value.fields) || !value.fields.every(row => field(row, 1))) return invalid();
 return { name: value.name, description: value.description, fields: value.fields };
}
