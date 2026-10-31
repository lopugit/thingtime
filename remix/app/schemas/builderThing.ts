// Builder identity is an ordinary composable schema id, never an access grant.
export const BUILDER_THING_KIND = 'builder-thing';
export const BUILDER_THING_REQUIREMENTS = { 'api.things': '1.46.0' } as const;
export const BUILDER_CONTENT_KINDS = ['webpage', 'component', 'action', 'schema'] as const;

type BuilderThing = { thingtime?: readonly string[]; crystal?: Record<string, unknown> | null };

/** Older Builder content and explicitly marked app folders remain discoverable
 * without rewriting them on read. Ordinary data/folders are not Builder Things. */
export function isBuilderThing(thing: BuilderThing): boolean {
  const kinds = thing.thingtime || [];
  return kinds.includes(BUILDER_THING_KIND) || BUILDER_CONTENT_KINDS.some(kind => kinds.includes(kind)) ||
    (kinds.includes('folder') && thing.crystal?.builderApp === true);
}

export function withBuilderThingKind(thingtime: readonly string[], crystal?: Record<string, unknown> | null): string[] {
  const builder = isBuilderThing({ thingtime, crystal });
  const kinds = [...new Set(thingtime)].filter(kind => kind !== BUILDER_THING_KIND);
  if (builder) kinds.push(BUILDER_THING_KIND);
  return kinds;
}

/** An edit can add provenance, but cannot change its stored content schemas. */
export function builderThingUpdateKinds(current: readonly string[], requested: unknown): string[] | null {
  if (requested === undefined) return [...current];
  if (!Array.isArray(requested) || requested.some(kind => typeof kind !== 'string' || !kind.trim())) return null;
  const next = [...new Set(requested.map(kind => kind.trim()))] as string[];
  const content = (kinds: readonly string[]) => kinds.filter(kind => kind !== BUILDER_THING_KIND);
  const before = content(current);
  const after = content(next);
  if (before.length !== after.length || before.some(kind => !after.includes(kind))) return null;
  return [...new Set([...current, ...(next.includes(BUILDER_THING_KIND) ? [BUILDER_THING_KIND] : [])])];
}
