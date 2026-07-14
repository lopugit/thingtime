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

// Built-ins register lazily on the first registry access. This must live on
// the *read paths* (not in index.ts, not as side-effect imports): the app
// package declares "sideEffects": false, so the production bundler is free to
// skip re-export glue and side-effect-only modules — which shipped an empty
// registry to Vercel while dev (unbundled) looked fine. The import cycle with
// the renderer files is safe: they only call registerKindRenderer() inside
// these deferred functions, after every module has evaluated.
import { registerCoreKinds } from './kindRenderers';
import { registerMediaKinds } from './kindRenderersMedia';
import { registerSocialKinds } from './kindRenderersSocial';
import { registerCommerceKinds } from './kindRenderersCommerce';
import { registerPlanningKinds } from './kindRenderersPlanning';
import { registerKnowledgeKinds } from './kindRenderersKnowledge';

let builtinsEnsured = false;
const ensureBuiltinKinds = () => {
	if (builtinsEnsured) return;
	// set first: the register functions call registerKindRenderer, which
	// re-enters ensureBuiltinKinds
	builtinsEnsured = true;
	registerCoreKinds();
	registerMediaKinds();
	registerSocialKinds();
	registerCommerceKinds();
	registerPlanningKinds();
	registerKnowledgeKinds();
};

export const registerKindRenderer = (renderer: KindRenderer) => {
	// builtins first, so a custom renderer registered early still wins over
	// the builtin with the same kind
	ensureBuiltinKinds();
	const existing = registry.findIndex((item) => item.kind === renderer.kind);
	if (existing >= 0) {
		registry[existing] = renderer;
		return;
	}
	registry.push(renderer);
};

export const getKindRenderers = (): KindRenderer[] => {
	ensureBuiltinKinds();
	return [...registry];
};

export const getKindRenderer = (kind?: string | null): KindRenderer | undefined => {
	if (!kind) return undefined;
	ensureBuiltinKinds();
	const normalised = String(kind).toLowerCase();
	return registry.find(
		(renderer) => renderer.kind === normalised || renderer.aliases?.includes(normalised)
	);
};

export const resolveKindRenderer = (thing: unknown): KindRenderer | undefined => {
	ensureBuiltinKinds();
	if (!thing || typeof thing !== 'object' || Array.isArray(thing)) return undefined;

	const record = thing as Record<string, unknown>;

	// a `render:` prop names the renderer directly ({ render: 'markdown', … })
	// and outranks the thing's own kind — data can opt into any template
	const named = getKindRenderer(typeof record.render === 'string' ? record.render : null);
	if (named) return named;

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
