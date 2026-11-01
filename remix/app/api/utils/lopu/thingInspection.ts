import { createHash } from 'node:crypto';

export type ThingInspection = { path: string; offset: number; revision?: string };
export const THING_INSPECTION_CHARS = 4000;

// Pointers are relative to the already-authorized public crystal, never the
// storage envelope. Own-property traversal cannot follow the prototype chain.
export function parseThingInspection(input: Record<string, unknown>): ThingInspection | undefined {
  if (input.path === undefined && input.offset === undefined && input.revision === undefined) return undefined;
  const path = input.path ?? '';
  const offset = input.offset ?? 0;
  if (typeof path !== 'string' || path.length > 512 || (path !== '' && !path.startsWith('/')) || /~(?![01])/.test(path) || path.split('/').length > 65)
    throw new Error('path must be a JSON Pointer within the crystal, such as /render or /steps, at most 512 characters and 64 levels. Use an empty path for the whole crystal.');
  if (!Number.isSafeInteger(offset) || Number(offset) < 0) throw new Error('offset must be a nonnegative integer from the previous read.');
  if (input.revision !== undefined && (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)))
    throw new Error('revision must be the revision returned by a previous crystal read.');
  if (Number(offset) > 0 && !input.revision) throw new Error('Continuing a crystal read requires its revision. Start with offset 0.');
  return { path, offset: Number(offset), ...(input.revision ? { revision: String(input.revision) } : {}) };
}

export function inspectThingCrystal(crystal: unknown, input: ThingInspection) {
  let selected = crystal;
  for (const part of input.path === '' ? [] : input.path.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!selected || typeof selected !== 'object' || !Object.prototype.hasOwnProperty.call(selected, key))
      throw new Error('That crystal path does not exist. Read its parent path to find the current keys.');
    selected = (selected as Record<string, unknown>)[key];
  }
  let json: string | undefined;
  try { json = JSON.stringify(selected); } catch { throw new Error('This crystal value cannot be represented as JSON. Read a smaller path.'); }
  if (json === undefined) throw new Error('This crystal value cannot be represented as JSON. Read its parent path.');
  const revision = createHash('sha256').update(json).digest('hex');
  if (input.revision && input.revision !== revision) throw new Error('The crystal changed during this read. Start again at offset 0; do not combine pages from different revisions.');
  if (input.offset > json.length) throw new Error('offset is beyond this crystal value. Start again at offset 0.');
  if (input.offset > 0 && /[\uDC00-\uDFFF]/.test(json[input.offset] ?? '') && /[\uD800-\uDBFF]/.test(json[input.offset - 1]))
    throw new Error('offset splits a Unicode character. Use the nextOffset returned by the previous read.');
  let end = Math.min(json.length, input.offset + THING_INSPECTION_CHARS);
  // Keep UTF-16 offsets exact while avoiding a split surrogate at a page edge.
  if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end -= 1;
  return { path: input.path, revision, offset: input.offset, nextOffset: end < json.length ? end : null,
    totalChars: json.length, complete: end === json.length, json: json.slice(input.offset, end) };
}
