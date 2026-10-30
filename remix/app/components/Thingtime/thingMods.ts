// Data-only, bounded presentation mods. Values never select executable code.
export type ThingFieldType = import('~/passwords/model').FieldType;
export type ThingFieldMod = { id: string; label: string; type: ThingFieldType; section?: string; concealed?: boolean; multiline?: boolean };
export type ThingMods = { layout: 'fields'; fields: ThingFieldMod[]; sortable?: boolean; removable?: boolean; revealSecrets?: boolean };
export function moveThingField<T>(fields: readonly T[], index: number, delta: number): T[] {
  const next = [...fields], target = index + delta;
  if (!Number.isInteger(index) || !Number.isInteger(delta) || index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
