import React from 'react';
import { Box, Flex, Tooltip } from '@chakra-ui/react';
import { Subject } from 'rxjs';

import { isKindSafeForUntrusted, resolveKindRender } from '../Kinds';
import type { KindRenderer, PollRenderPollContext } from '../Kinds';
import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';

import { ThingtimeContext } from '~/Providers/ThingtimeProvider';
import { smarts } from '~/smarts';

// A standalone thing rendered natively — the full Thingtime tree (right-click
// context menu, view/edit toggle, collapse, type changes) mounted over a LOCAL
// sandbox store, so feeds and search results can show OTHER people's things
// without writing into the viewer's persisted thingtime blob (localforage) or
// colliding with the composer's tmp draft branch. Edits are local exploration:
// they live in component state and evaporate on unmount.
//
// When the thing resolves a kind renderer (a `render:` prop naming one, an
// explicit kind, or a structural match) AND that kind is safe to auto-render
// for untrusted data, it shows the rendered form by default, with a small
// corner icon flipping between rendered ✨ and the Thingtime 🌀 view.

const BORDER = '1px solid var(--tt-border, #ececef)';

// The feed shows other users' things, which the server bounds only loosely
// (up to ~10k nodes). Mounting one interactive Thingtime node per value would
// let a single crafted post jank every viewer's feed, so past this many nodes
// the tree mounts COLLAPSED and the viewer expands it progressively.
const EAGER_NODE_LIMIT = 150;

// Deep-clone for the sandbox store. Deliberately NO shallow-spread fallback:
// a shallow copy would share nested references with the source `thing` prop
// (the feed's cached post), so a sandbox edit could write through into shared
// state. On the rare value neither tier can clone, the caller keeps the prior
// tree instead of pretending to clone.
const cloneTree = (tree: Record<string, unknown>): Record<string, unknown> | null => {
	try {
		return structuredClone(tree);
	} catch {
		try {
			return JSON.parse(JSON.stringify(tree));
		} catch {
			return null;
		}
	}
};

// Bounded node count — stops at `cap`, so a hostile 10k-node thing costs at
// most `cap` steps to classify as "too big to mount eagerly".
const measureNodeCount = (value: unknown, cap: number): number => {
	let count = 0;
	const stack: unknown[] = [value];
	while (stack.length) {
		if (count >= cap) return cap;
		const current = stack.pop();
		count += 1;
		if (current && typeof current === 'object') {
			const children = Array.isArray(current) ? current : Object.values(current as Record<string, unknown>);
			for (const child of children) stack.push(child);
		}
	}
	return count;
};

const isEmptyPath = (path: unknown): boolean =>
	path === undefined || path === null || path === '' || (Array.isArray(path) && path.length === 0);

// Is this thing empty (nothing for the tree to show)? Empty object/array ⇒
// render nothing rather than the tree's "Imagine.." placeholder.
const isEmptyThing = (thing: unknown): boolean => {
	if (!thing || typeof thing !== 'object') return thing === undefined || thing === null;
	return Object.keys(thing as Record<string, unknown>).length === 0;
};

// Scoped stand-in for ThingtimeProvider: same context surface
// (setThingtime/getThingtime/events), but state is component-local and never
// persisted. It shares the app's real event bus so cross-tree coordination
// (the single-open context-menu protocol) keeps working across feed cards.
const LocalThingProvider = (props: {
	initialTree: Record<string, unknown>;
	// the app's real event bus (shared so the single-open context-menu protocol
	// still coordinates across feed cards); a local fallback covers the rare
	// pre-hydration render where the provider hasn't published one yet
	events: Subject<any> | null | undefined;
	children: React.ReactNode;
}) => {
	const [tree, setTree] = React.useState<Record<string, unknown>>(props.initialTree);
	const [fallbackEvents] = React.useState(() => new Subject<any>());
	const events = props.events ?? fallbackEvents;
	const treeRef = React.useRef(tree);
	treeRef.current = tree;

	// Once the viewer edits the sandbox it's "dirty" — a feed refetch (which
	// replaces post.thing with a fresh but usually identical object) must not
	// clobber an in-progress edit. Until then, a genuinely new source tree
	// reseeds so fresh server data still wins (optimistic-render friendly).
	const dirtyRef = React.useRef(false);
	const initialTreeRef = React.useRef(props.initialTree);
	React.useEffect(() => {
		if (dirtyRef.current) return;
		if (initialTreeRef.current !== props.initialTree) {
			initialTreeRef.current = props.initialTree;
			setTree(props.initialTree);
		}
	}, [props.initialTree]);

	const setThingtime = React.useCallback((path: unknown, value: unknown) => {
		dirtyRef.current = true;
		setTree((prev) => {
			try {
				if (isEmptyPath(path)) {
					if (value && typeof value === 'object' && !Array.isArray(value)) {
						return cloneTree(value as Record<string, unknown>) ?? prev;
					}
					return prev;
				}
				const next = cloneTree(prev);
				if (!next) return prev;
				smarts.setsmart(next, path, value);
				return next;
			} catch (err) {
				console.error('[tt][ThingView] sandbox update failed', err);
				return prev;
			}
		});
	}, []);

	const getThingtime = React.useCallback(
		(path?: unknown) => (isEmptyPath(path) ? tree : smarts.getsmart(tree, path)),
		[tree]
	);

	// Stable per-render identity so context consumers only re-render when the
	// sandbox tree (or the shared handlers) actually change.
	const contextValue = React.useMemo(
		() => ({
			Everything: {
				thingtime: tree,
				set: setThingtime,
				setThingtime,
				getThingtime,
				thingtimeRef: treeRef,
				paths: [] as string[],
				loading: false,
				events
			}
		}),
		[tree, setThingtime, getThingtime, events]
	);

	return <ThingtimeContext.Provider value={contextValue}>{props.children}</ThingtimeContext.Provider>;
};

// reads the sandbox store so context-menu mutations (paste, duplicate, type
// changes) repaint — the same lookup pattern EditorSplit's windows use
const SandboxedThingtime = (props: { storeKey: string; humanLabel: string; collapsed: boolean }) => {
	const { getThingtime, thingtime } = useThingtime();

	// path.key is the (unique) store address; path.human is what the tree shows
	const pathProp = React.useMemo(
		() => ({ key: props.storeKey, human: props.humanLabel }),
		[props.storeKey, props.humanLabel]
	);

	const thing = React.useMemo(() => {
		return getThingtime(props.storeKey);
		// thingtime: refresh the lookup whenever the sandbox tree changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [getThingtime, props.storeKey, thingtime]);

	// untrusted: other users' data — Thingtime skips its chakra path (which
	// spreads thing.props into components) and its window.meta.things writes.
	return (
		<Thingtime
			path={pathProp}
			thing={thing}
			pathPl="0px"
			untrusted
			collapsed={props.collapsed}
			debugId={`ThingView-${props.storeKey}`}
		/>
	);
};

const CornerToggle = (props: { rendered: boolean; rendererTitle: string; onToggle: () => void }) => {
	const label = props.rendered ? 'Show the Thingtime view 🌀' : `Show as ${props.rendererTitle} ✨`;

	return (
		<Tooltip label={label} fontSize="xs" borderRadius="8px" hasArrow>
			<Flex
				as="button"
				type="button"
				aria-label={label}
				className="thing-view-toggle"
				position="absolute"
				top="6px"
				right="6px"
				zIndex={2}
				alignItems="center"
				justifyContent="center"
				width="24px"
				height="24px"
				borderRadius="999px"
				border={BORDER}
				background="var(--tt-card, #ffffff)"
				boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
				fontSize="12px"
				lineHeight={1}
				cursor="pointer"
				opacity={0.6}
				transition="opacity 0.15s ease, transform 0.1s ease"
				_hover={{ opacity: 1, transform: 'scale(1.08)' }}
				_focusVisible={{ opacity: 1, outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '1px' }}
				onClick={props.onToggle}
			>
				{props.rendered ? '🌀' : '✨'}
			</Flex>
		</Tooltip>
	);
};

export type ThingViewProps = {
	thing: unknown;
	// what the native tree shows as the root label (display only — the store
	// address is a unique per-instance key, so feed cards never collide)
	label?: string;
	// tighter type sizing for nested contexts (shared-post sub-cards)
	compact?: boolean;
	// live poll wiring for poll things (server tally + optimistic vote handler,
	// supplied by PostCard) — passed through to the kind renderer's context
	poll?: PollRenderPollContext;
};

export const ThingView = (props: ThingViewProps) => {
	const { thing, label, compact, poll } = props;
	const { events } = useThingtime();

	// resolve the renderer AND its adapted value in one pass (the registry
	// cascades render: → kind → structural match, returning the first that
	// actually adapts)
	const resolved = React.useMemo<{ renderer: KindRenderer; value: unknown } | null>(
		() => resolveKindRender(thing),
		[thing]
	);

	// only auto-render kinds vetted safe for untrusted (other users') data;
	// everything else falls back to the sanitising native tree
	const canRender = !!resolved && isKindSafeForUntrusted(resolved.renderer.kind);

	// default to the rendered form when one is available ("render mode by
	// default"); the corner icon flips to the native Thingtime view and back
	const [showRendered, setShowRendered] = React.useState(true);
	const rendered = canRender && showRendered;

	// unique, stable store address per ThingView instance so sibling feed cards
	// never share a path (which would cross-wire renames / global registry)
	const rawId = React.useId();
	const storeKey = React.useMemo(() => `tv-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);
	const humanLabel = React.useMemo(() => (label || 'Thing').split('.').join('·').trim() || 'Thing', [label]);

	const initialTree = React.useMemo(() => ({ [storeKey]: thing }), [storeKey, thing]);

	// too big to mount eagerly ⇒ start collapsed (viewer expands progressively)
	const collapsed = React.useMemo(() => measureNodeCount(thing, EAGER_NODE_LIMIT) >= EAGER_NODE_LIMIT, [thing]);

	// contain Cmd/Ctrl+Z: the app's global undo listener (root ThingtimeProvider)
	// would otherwise fire against the viewer's REAL tree while they edit this
	// sandbox. Stop the event before it reaches window; don't preventDefault, so
	// the focused field's own native undo still works.
	const onKeyDownCapture = React.useCallback((event: React.KeyboardEvent) => {
		if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')) {
			event.stopPropagation();
		}
	}, []);

	if (rendered && resolved) {
		const Component = resolved.renderer.render;
		return (
			<Box position="relative" maxWidth="100%">
				<Component value={resolved.value} context={{ size: compact ? 'compact' : 'card', untrusted: true, ...(poll ? { poll } : {}) }} />
				<CornerToggle rendered rendererTitle={resolved.renderer.title} onToggle={() => setShowRendered(false)} />
			</Box>
		);
	}

	// nothing to show and nothing to render ⇒ render nothing (don't leak the
	// tree's "Imagine.." placeholder for an empty shared thing)
	if (!canRender && isEmptyThing(thing)) return null;

	return (
		<Box position="relative" maxWidth="100%">
			<Box
				border={BORDER}
				borderRadius="var(--tt-radius-md, 12px)"
				background="var(--tt-surface, #fafafb)"
				paddingX={3}
				paddingY={2}
				maxWidth="100%"
				maxHeight="560px"
				overflow="auto"
				onKeyDown={onKeyDownCapture}
			>
				<LocalThingProvider initialTree={initialTree} events={events}>
					<SandboxedThingtime storeKey={storeKey} humanLabel={humanLabel} collapsed={collapsed} />
				</LocalThingProvider>
			</Box>
			{canRender && resolved && (
				<CornerToggle rendered={false} rendererTitle={resolved.renderer.title} onToggle={() => setShowRendered(true)} />
			)}
		</Box>
	);
};
