import type { ThingsThing } from '../Things/thingsCore';
import { validateSchemaRender } from '../../schemas/schemaRenderValidation';

export type ExplicitComponentDefinition = {
	args?: unknown;
	savedArgs?: unknown;
	render: Record<string, unknown>;
};

export type ExplicitRenderComponent =
	| { kind: 'reference'; thingId: string }
	| { kind: 'embedded'; component: { id: string; author?: { id?: string } | null; crystal: ExplicitComponentDefinition } };

export type ExplicitRenderComponentParse =
	| { status: 'absent' | 'invalid' }
	| { status: 'ready'; value: ExplicitRenderComponent };

export type ExplicitComponentResolution = {
	key: string;
	status: 'loading' | 'ready' | 'unavailable' | 'wrong-kind' | 'invalid';
	component: { id: string; author?: { id?: string } | null; crystal: ExplicitComponentDefinition } | null;
};

export type SavedRenderComponentResult =
	| { status: 'ready'; component: NonNullable<ExplicitComponentResolution['component']> }
	| { status: 'unavailable' | 'wrong-kind' | 'invalid'; component: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const componentDefinitionOf = (value: unknown): ExplicitComponentDefinition | null => {
	if (!isRecord(value)) return null;
	const checked = validateSchemaRender(value.render);
	if (!checked.ok) return null;
	return {
		...(value.args !== undefined ? { args: value.args } : {}),
		...(value.savedArgs !== undefined ? { savedArgs: value.savedArgs } : {}),
		render: checked.render
	};
};

// Explicit means exactly one of these authored shapes. We deliberately do not
// infer a renderer from the Thing's kind, type, schema, or data shape.
export const parseExplicitRenderComponent = (thing: Pick<ThingsThing, 'id' | 'crystal'>): ExplicitRenderComponentParse => {
	const value = thing.crystal?.renderComponent;
	if (value === undefined || value === null) return { status: 'absent' };
	if (!isRecord(value)) return { status: 'invalid' };

	const hasPointer = Object.prototype.hasOwnProperty.call(value, 'thingId');
	const hasDefinition = Object.prototype.hasOwnProperty.call(value, 'definition');
	if (hasPointer === hasDefinition) return { status: 'invalid' };
	if (hasPointer) {
		const thingId = typeof value.thingId === 'string' ? value.thingId.trim() : '';
		if (!thingId) return { status: 'invalid' };
		return { status: 'ready', value: { kind: 'reference', thingId } };
	}

	const definition = componentDefinitionOf(value.definition);
	if (!definition) return { status: 'invalid' };
	return {
		status: 'ready',
		value: { kind: 'embedded', component: { id: `${thing.id}:renderComponent`, crystal: definition } }
	};
};

export const resolveSavedRenderComponent = (value: unknown, expectedId: string): SavedRenderComponentResult => {
	if (!isRecord(value)) return { status: 'unavailable', component: null };
	if (value.id !== expectedId) return { status: 'invalid', component: null };
	if (!Array.isArray(value.thingtime) || !value.thingtime.includes('component')) return { status: 'wrong-kind', component: null };
	const definition = componentDefinitionOf(value.crystal);
	if (!definition) return { status: 'invalid', component: null };
	const author = isRecord(value.author) && typeof value.author.id === 'string' ? { id: value.author.id } : null;
	return { status: 'ready', component: { id: expectedId, author, crystal: definition } };
};

export const explicitComponentInteractive = (
	kind: ExplicitRenderComponent['kind'],
	viewerId: string | null | undefined,
	sourceAuthorId: string | null | undefined,
	componentAuthorId: string | null | undefined
): boolean =>
	!!viewerId && sourceAuthorId === viewerId && (kind === 'embedded' || componentAuthorId === viewerId);

// The visible content stays on the source Thing. A component receives it as a
// nested `content` scope, so `{content.text}` and ttEach/ttIf bindings use the
// normal component composition contract without copying or freezing fields.
export const explicitThingRenderScope = (thing: Pick<ThingsThing, 'crystal'>): { content: Record<string, unknown> } => ({
	content: isRecord(thing.crystal?.thing) ? thing.crystal.thing : thing.crystal
});

export const currentExplicitComponentResolution = (
	resolution: ExplicitComponentResolution | null,
	key: string
): ExplicitComponentResolution =>
	resolution?.key === key ? resolution : { key, status: 'loading', component: null };
