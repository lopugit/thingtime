import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';
import type { TimelineSnapshot } from './contract.ts';

export type VersionValue = { present: false } | { present: true; value: JsonValue };
export type VersionConflict = { path: string[]; base: VersionValue; current: VersionValue; incoming: VersionValue };
export type VersionChoices = Record<string, 'current' | 'incoming'>;
const absent: VersionValue = { present: false };
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const present = (value: JsonValue): VersionValue => ({ present: true, value });
const equal = (a: VersionValue, b: VersionValue) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: VersionValue): value is { present: true; value: Record<string, JsonValue> } => value.present && value.value !== null && typeof value.value === 'object' && !Array.isArray(value.value);
const copy = (value: unknown): JsonValue => copyBoundedJson(value, { maxBytes: 4 * 1024 * 1024, maxDepth: 90, maxNodes: 100_000, sortKeys: true }, 'Version content');

/** Deterministic three-way merge. Absent properties differ from null. Arrays
 * remain atomic so reorders/deletions never silently change index identities. */
export function mergeVersionValues(base: unknown, current: unknown, incoming: unknown, choices: VersionChoices = {}) {
 const conflicts: VersionConflict[] = []; const used = new Set<string>(); let visits = 0;
 const merge = (a: VersionValue, b: VersionValue, c: VersionValue, path: string[]): VersionValue => {
  if (++visits > 100_000) throw new Error('This merge is too large to preview.');
  if (equal(b, c)) return b;
  if (equal(a, b)) return c;
  if (equal(a, c)) return b;
  if (record(b) && record(c) && (record(a) || !a.present)) {
   const previous = record(a) ? a.value : {};
   const value: Record<string, JsonValue> = Object.create(null);
   for (const key of [...new Set([...Object.keys(previous), ...Object.keys(b.value), ...Object.keys(c.value)])].sort()) {
    const child = (object: Record<string, JsonValue>) => own(object, key) ? present(object[key]) : absent;
    const result = merge(child(previous), child(b.value), child(c.value), [...path, key]);
    if (result.present) value[key] = result.value;
   }
   return present(value);
  }
  const key = JSON.stringify(path); const choice = own(choices, key) ? choices[key] : undefined;
  if (choice !== undefined) { if (choice !== 'current' && choice !== 'incoming') throw new Error('Invalid conflict choice.'); used.add(key); return choice === 'current' ? b : c; }
  conflicts.push({ path, base: a, current: b, incoming: c });
  return b;
 };
 const result = merge(present(copy(base)), present(copy(current)), present(copy(incoming)), []);
 if (Object.keys(choices).some(key => !used.has(key))) throw new Error('Conflict choices no longer match this version. Refresh the comparison.');
 return { value: result.present ? result.value : null, conflicts };
}

/** Restorable fields pass through the ordinary Thing validator on commit.
 * Credentials, link tokens, ownership and operational state never enter here. */
export function versionContent(snapshot: TimelineSnapshot | null, basis?: JsonValue): Record<string, JsonValue> {
 if (!snapshot || snapshot.version !== 1) throw new Error('This event has no restorable content.');
 const value = copy(snapshot.value) as any;
 let content: Record<string, JsonValue>;
 if (snapshot.adapter === 'thing-content') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Thing version.');
  content = value;
 } else {
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) throw new Error('Load the saved ancestor before using this draft.');
  content = { ...basis };
  if (snapshot.adapter === 'webpage-draft' && value?.crystal && typeof value.crystal === 'object' && !Array.isArray(value.crystal)) content.crystal = value.crystal;
  else if (snapshot.adapter === 'definition-source' && typeof value?.source === 'string') {
   try { content.crystal = copy(JSON.parse(value.source)); } catch { throw new Error('This definition draft contains invalid JSON. Recover it in the editor first.'); }
  } else throw new Error('This draft format cannot be applied as a saved version.');
 }
 const result: Record<string, JsonValue> = Object.create(null);
 for (const key of ['crystal', 'extended', 'tags', 'geo', 'acl', 'folderId']) {
  if (!own(content, key)) throw new Error(`This version is missing ${key}.`);
  result[key] = content[key];
 }
 return result;
}
