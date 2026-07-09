import React from 'react';

// The kind renderer registry — the pipeline that turns a plain JSON thing
// (stored in Mongo via /api/v1/things) into a rendered component.
//
// A thing opts into rendering by carrying a `kind` (e.g. { kind: 'post', … }).
// Each renderer registers:
//   - kind:    the canonical kind id it renders
//   - aliases: other kind strings it also accepts
//   - match:   a structural matcher so kind-less data can still resolve a
//              renderer (data-shape polymorphism)
//   - adapt:   maps *any* accepted shape onto the renderer's canonical props —
//              this is the polymorphism layer: many shapes, one template
//   - render:  the component
//
// resolveKindRenderer() picks explicit kind first, then falls back to
// structural matching, so feeds/search can render mixed data automatically.

export type KindRenderContext = {
	// how much room the renderer has — 'card' (feed/search), 'full' (own page),
	// 'compact' (inside a nested viewer row)
	size?: 'compact' | 'card' | 'full';
	// invoked when the renderer wants to open the raw nested data
	onInspect?: () => void;
};

export type KindRenderer<Props = any> = {
	kind: string;
	title: string;
	emoji: string;
	description: string;
	// gallery/registry grouping: 'Social', 'Media', 'Commerce', 'Planning', …
	category?: string;
	aliases?: string[];
	// structural matcher for kind-less things (return true when the shape fits)
	match?: (thing: Record<string, unknown>) => boolean;
	// adapt any accepted shape onto the canonical props for render()
	adapt: (thing: Record<string, unknown>) => Props | null;
	render: React.ComponentType<{ value: Props; context: KindRenderContext }>;
};

const registry: KindRenderer[] = [];

export const registerKindRenderer = (renderer: KindRenderer) => {
	const existing = registry.findIndex((item) => item.kind === renderer.kind);
	if (existing >= 0) {
		registry[existing] = renderer;
		return;
	}
	registry.push(renderer);
};

export const getKindRenderers = (): KindRenderer[] => [...registry];

export const getKindRenderer = (kind?: string | null): KindRenderer | undefined => {
	if (!kind) return undefined;
	const normalised = String(kind).toLowerCase();
	return registry.find(
		(renderer) => renderer.kind === normalised || renderer.aliases?.includes(normalised)
	);
};

export const resolveKindRenderer = (thing: unknown): KindRenderer | undefined => {
	if (!thing || typeof thing !== 'object' || Array.isArray(thing)) return undefined;

	const record = thing as Record<string, unknown>;

	// explicit kind wins
	const explicit = getKindRenderer(typeof record.kind === 'string' ? record.kind : null);
	if (explicit) return explicit;

	// then structural matching (data-shape polymorphism)
	return registry.find((renderer) => {
		try {
			return renderer.match?.(record) === true;
		} catch {
			return false;
		}
	});
};

export type RenderThingProps = {
	thing: unknown;
	context?: KindRenderContext;
	// rendered when no renderer resolves (e.g. fall back to a nested viewer)
	fallback?: React.ReactNode;
};

// The dispatcher: <RenderThing thing={anyJson}/> renders the right template
// for the thing's kind, or the fallback when nothing matches.
export const RenderThing = ({ thing, context = {}, fallback = null }: RenderThingProps) => {
	const renderer = resolveKindRenderer(thing);

	if (!renderer) return <>{fallback}</>;

	let value: unknown = null;
	try {
		value = renderer.adapt(thing as Record<string, unknown>);
	} catch {
		value = null;
	}

	if (value === null || value === undefined) return <>{fallback}</>;

	const Component = renderer.render;
	return <Component value={value} context={context} />;
};
