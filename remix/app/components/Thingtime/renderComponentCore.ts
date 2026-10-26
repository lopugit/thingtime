import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const renderRootOf = (value: unknown): Record<string, unknown> | null => {
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

/** Same Component argument/template DSL as Builder. The display never runs a
 * Component source or Action, and bindings only receive the displayed data. */
export const renderComponentScope = (component: Record<string, unknown>, thing: unknown): Record<string, unknown> => {
  const data = recordOf(thing) || {};
  const saved = recordOf(component.savedArgs) || {};
  return { ...defaultsFromArgs(sanitizeArgSpecs(component.args)), ...saved, ...data, thing: data };
};

export const renderComponentNode = (component: Record<string, unknown>, thing: unknown): unknown =>
  resolveTemplate(component.render, renderComponentScope(component, thing));

export const renderComponentReadOptions = (scope: { actor?: string; character?: string; plane: string | null; origin: string }, signal: AbortSignal) => ({
  signal, expectedActor: scope.actor, characterId: scope.character, expectedDataPlane: scope.plane, expectedApiOrigin: scope.origin
});
