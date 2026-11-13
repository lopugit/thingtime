import type { PublicThing } from '~/api/utils/things/things';
/** A scope is the stable page identity followed by every parent in its path.
 * Labels, query, filters, sort and view must never be used as identities. */
export const THING_BROWSER_PIN_KIND = 'thing-browser-pin';
export const THING_BROWSER_PIN_SCOPE_KIND = 'thing-browser-pin-scope';
export const THING_BROWSER_PIN_REQUIREMENTS = { 'api.things-pins': '1.0.0' } as const;
export type ThingBrowserPins = { ok: true; revision: string; nextCursor: string | null; pins: { thingId: string; order: number; presentation?: PublicThing }[] };
export type ThingBrowserPinChange = { path: string[]; revision: string } & (
  { operation: 'pin' | 'unpin'; thingId: string } | { operation: 'reorder'; thingIds: string[] }
);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && Array.from(value).every(character => character.charCodeAt(0) > 31);
export function parseThingBrowserPinPath(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || !value.every(id)) throw new TypeError('Choose a stable page and parent path.');
  return value;
}
export function parseThingBrowserPinChange(value: unknown): ThingBrowserPinChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid pin change.');
  const row = value as Record<string, unknown>;
  parseThingBrowserPinPath(row.path);
  if (!id(row.revision) || (typeof row.operation !== 'string' || !['pin', 'unpin', 'reorder'].includes(row.operation))) throw new TypeError('Invalid pin change.');
  const keys = row.operation === 'reorder' ? ['path', 'revision', 'operation', 'thingIds'] : ['path', 'revision', 'operation', 'thingId'];
  if (Object.keys(row).some(key => !keys.includes(key))) throw new TypeError('Invalid pin change.');
  if (row.operation === 'reorder') {
    if (!Array.isArray(row.thingIds) || !row.thingIds.every(id) || new Set(row.thingIds).size !== row.thingIds.length) throw new TypeError('Choose each pinned Thing once.');
  } else if (!id(row.thingId)) throw new TypeError('Choose an exact Thing.');
  return row as ThingBrowserPinChange;
}
