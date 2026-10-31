const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export const renderRootOf = (value: unknown): Record<string, unknown> | null => {
  const root = recordOf(value);
  if (!root) return null;
  const html = typeof root.tag === 'string' && !!root.tag.trim();
  const chakra = (typeof root.chakra === 'string' && !!root.chakra.trim()) || root.type === 'chakra';
  return html || chakra ? root : null;
};

export const hasRenderComponent = (thing: unknown): boolean => {
  const record = recordOf(thing);
  return !!record && Object.prototype.hasOwnProperty.call(record, 'renderComponent');
};

export type ThingRenderComponent =
  | { kind: 'reference'; id: string }
  | { kind: 'embedded'; component: Record<string, unknown> }
  | { kind: 'invalid' };

export const renderComponentDeclaration = (thing: unknown): ThingRenderComponent | null => {
  if (!hasRenderComponent(thing)) return null;
  const declaration = recordOf(recordOf(thing)!.renderComponent);
  if (!declaration) return { kind: 'invalid' };
  if (typeof declaration.id === 'string' && declaration.id.trim() && !('render' in declaration)) {
    return { kind: 'reference', id: declaration.id };
  }
  if (!('id' in declaration) && renderRootOf(declaration.render)) return { kind: 'embedded', component: declaration };
  return { kind: 'invalid' };
};

export const referencedRenderComponent = (thing: unknown, expectedId: string): Record<string, unknown> | null => {
  const record = recordOf(thing);
  if (!record || record.id !== expectedId || !Array.isArray(record.thingtime) || !record.thingtime.includes('component')) return null;
  const crystal = recordOf(record.crystal);
  return crystal && renderRootOf(crystal.render) ? crystal : null;
};

// A root declaration owns presentation even when a legacy post also carries
// a nested Thing payload. Null/invalid declarations must not reveal that
// nested payload through an inferred renderer.
export const thingPresentationData = (crystal: Record<string, unknown>): unknown =>
  hasRenderComponent(crystal) ? crystal : crystal.thing || crystal;

export const THING_PRESENTATION_REQUIREMENTS = {
  'api.things': '1.42.0',
  'api.things-update': '1.13.0'
} as const;
