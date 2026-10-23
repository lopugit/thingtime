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
// Resolution order (resolveKindRender): a `render:` prop naming a renderer,
// then explicit `kind`, then structural matching — and for each candidate the
// renderer is only chosen if its adapt() actually produces a value, so a
// coincidental `render`/`kind` string that a renderer can't adapt cascades to
// the next candidate instead of blanking the card.

// Live poll wiring for the poll renderer: the host (PostCard) supplies the
// server tally + the viewer's vote and an optimistic vote handler. Absent for
// surfaces with no vote pipeline (docs galleries, previews) — the renderer
// then falls back to its self-contained demo behavior.
export type PollRenderPollContext = {
	// per-option counts, index-aligned with the poll's options
	counts: number[];
	totalVotes: number;
	// the viewer's current option (null = hasn't voted)
	viewerVote: number | null;
	// false for logged-out viewers — results only, taps route to onVote which
	// may explain why (login toast)
	canVote: boolean;
	// splash is the renderer's emoji-burst thunk for the tapped option; the
	// host invokes it only when the tap actually lands a vote (past its
	// login/in-flight guards), so dropped taps never burst
	onVote?: (optionIndex: number, splash?: () => void) => void;
};

export type KindRenderContext = {
	// how much room the renderer has — 'card' (feed/search), 'full' (own page),
	// 'compact' (inside a nested viewer row)
	size?: 'compact' | 'card' | 'full';
	// the thing is other people's data (a feed/search post), so renderers and
	// callers must not trust its URLs/markup. ThingView sets this; the trusted
	// surfaces (concept docs, schema browse, the viewer's own tree) leave it off.
	untrusted?: boolean;
	// invoked when the renderer wants to open the raw nested data
	onInspect?: () => void;
	// live poll voting (PollRenderer) — see PollRenderPollContext
	poll?: PollRenderPollContext;
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

// Kinds whose renderers are verified safe to auto-render for UNTRUSTED (other
// users') data: their output is sanitising text/media cards and every href/src
// sink is scheme-guarded (see kindRenderersMedia + kindPrimitives). This is an
// explicit allowlist, not a denylist, so it fails closed — a newly added kind
// is NOT auto-rendered in feeds/search until its renderer's sinks are vetted
// and its id added here. Untrusted things resolving any other kind (including
// the arbitrary-markup 'element'/'chakra' kinds, and the commerce/social/etc.
// renderers whose URL sinks aren't audited yet) fall back to the sanitising
// native tree. Trusted surfaces (the viewer's own things, concept docs, schema
// browse) render every kind and never consult this set.
const UNTRUSTED_SAFE_KINDS = new Set([
	'rich-text',
	'image',
	'audio',
	'playlist',
	'podcast',
	'article',
	'quote',
	'book',
	'movie',
	'link',
	'file',
	'code',
	'repository',
	// vetted: PollRenderer emits only text (question/option labels/counts) and
	// the ProgressBar primitive — no href/src sinks anywhere in its output
	'poll'
]);

export const isKindSafeForUntrusted = (kind?: string | null): boolean =>
	!!kind && UNTRUSTED_SAFE_KINDS.has(String(kind).toLowerCase());

// The candidates a thing resolves, in priority order: a `render:` prop naming a
// renderer, the explicit `kind`, then every structural match. Deduped so the
// same renderer isn't tried twice.
const resolutionCandidates = (record: Record<string, unknown>): KindRenderer[] => {
	const candidates: KindRenderer[] = [];
	const push = (renderer?: KindRenderer) => {
		if (renderer && !candidates.includes(renderer)) candidates.push(renderer);
	};

	push(getKindRenderer(typeof record.render === 'string' ? record.render : null));
	push(getKindRenderer(typeof record.kind === 'string' ? record.kind : null));
	for (const renderer of registry) {
		try {
			if (renderer.match?.(record) === true) push(renderer);
		} catch {
			// a throwing matcher just doesn't match
		}
	}
	return candidates;
};

// Resolve the renderer AND its adapted value in one pass: the first candidate
// whose adapt() yields a value wins. Returning the value here means callers
// (RenderThing, ThingView) never re-run adapt, and a candidate that resolves by
// name/kind but can't adapt the actual shape cascades instead of blanking.
export const resolveKindRender = (thing: unknown): { renderer: KindRenderer; value: unknown } | null => {
	ensureBuiltinKinds();
	if (!thing || typeof thing !== 'object' || Array.isArray(thing)) return null;

	const record = thing as Record<string, unknown>;
	for (const renderer of resolutionCandidates(record)) {
		let value: unknown = null;
		try {
			value = renderer.adapt(record);
		} catch {
			value = null;
		}
		if (value !== null && value !== undefined) return { renderer, value };
	}
	return null;
};

export const resolveKindRenderer = (thing: unknown): KindRenderer | undefined =>
	resolveKindRender(thing)?.renderer;

export type RenderThingProps = {
	thing: unknown;
	context?: KindRenderContext;
	// rendered when no renderer resolves (e.g. fall back to a nested viewer)
	fallback?: React.ReactNode;
};

// The dispatcher: <RenderThing thing={anyJson}/> renders the right template
// for the thing's kind, or the fallback when nothing matches.
export const RenderThing = ({ thing, context = {}, fallback = null }: RenderThingProps) => {
	const resolved = resolveKindRender(thing);

	if (!resolved) return <>{fallback}</>;

	const Component = resolved.renderer.render;
	return <Component value={resolved.value} context={context} />;
};
