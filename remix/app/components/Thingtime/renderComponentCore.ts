import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { hasRenderComponent, renderComponentDeclaration, referencedRenderComponent, type ThingRenderComponent } from './renderComponentDeclaration';

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export { hasRenderComponent, renderComponentDeclaration, referencedRenderComponent };
export type { ThingRenderComponent };

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
