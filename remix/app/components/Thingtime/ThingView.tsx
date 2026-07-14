import React from 'react';
import { Box, Flex, Tooltip } from '@chakra-ui/react';
import { Subject } from 'rxjs';

import { resolveKindRenderer } from '../Kinds';
import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';

import { ThingtimeContext } from '~/Providers/ThingtimeProvider';
import { smarts } from '~/smarts';

// A standalone thing rendered natively — the full Thingtime tree (right-click
// context menu, view/edit toggle, collapse, type changes) mounted over a LOCAL
// sandbox store, so feeds and search results can show other people's things
// without writing into the viewer's persisted thingtime blob (localforage) or
// colliding with the composer's tmp draft branch. Edits are local exploration:
// they live in component state and evaporate on unmount.
//
// When the thing resolves a kind renderer (a `render:` prop naming one, an
// explicit kind, or a structural match) it shows the rendered form by default,
// with a small corner icon flipping between rendered ✨ and Thingtime 🌀 views.

const BORDER = '1px solid var(--tt-border, #ececef)';

const cloneTree = (tree: Record<string, unknown>): Record<string, unknown> => {
	try {
		return structuredClone(tree);
	} catch {
		try {
			return JSON.parse(JSON.stringify(tree));
		} catch {
			return { ...tree };
		}
	}
};

const isEmptyPath = (path: unknown): boolean =>
	path === undefined || path === null || path === '' || (Array.isArray(path) && path.length === 0);

// Scoped stand-in for ThingtimeProvider: same context, same read/write
// surface (setThingtime/getThingtime/events), but state is component-local
// and never persisted. Mutations clone the whole tree — things here are
// bounded API projections, so a full clone per write stays cheap and keeps
// the source thing prop untouched.
const LocalThingProvider = (props: { initialTree: Record<string, unknown>; children: React.ReactNode }) => {
	const [tree, setTree] = React.useState<Record<string, unknown>>(props.initialTree);
	const [events] = React.useState(() => new Subject());
	const treeRef = React.useRef(tree);
	treeRef.current = tree;

	// reseed when the source thing changes identity (a feed refetch replacing
	// the post) — the fresh server value wins over local exploration edits
	const initialTreeRef = React.useRef(props.initialTree);
	React.useEffect(() => {
		if (initialTreeRef.current !== props.initialTree) {
			initialTreeRef.current = props.initialTree;
			setTree(props.initialTree);
		}
	}, [props.initialTree]);

	const setThingtime = React.useCallback((path: unknown, value: unknown) => {
		setTree((prev) => {
			try {
				if (isEmptyPath(path)) {
					return value && typeof value === 'object' && !Array.isArray(value)
						? cloneTree(value as Record<string, unknown>)
						: prev;
				}
				const next = cloneTree(prev);
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

	const Everything = {
		thingtime: tree,
		set: setThingtime,
		setThingtime,
		getThingtime,
		thingtimeRef: treeRef,
		paths: [],
		loading: false,
		events
	};

	return <ThingtimeContext.Provider value={{ Everything }}>{props.children}</ThingtimeContext.Provider>;
};

// reads the sandbox store so context-menu mutations (paste, duplicate, type
// changes) repaint — the same lookup pattern EditorSplit's windows use
const SandboxedThingtime = (props: { rootKey: string }) => {
	const { getThingtime, thingtime } = useThingtime();

	const pathProp = React.useMemo(() => ({ key: props.rootKey, human: props.rootKey }), [props.rootKey]);

	const thing = React.useMemo(() => {
		return getThingtime(props.rootKey);
		// thingtime: refresh the lookup whenever the sandbox tree changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [getThingtime, props.rootKey, thingtime]);

	// untrusted: these are other users' things — Thingtime's chakra path
	// (which spreads thing.props into components) must stay off
	return <Thingtime path={pathProp} thing={thing} pathPl="0px" untrusted debugId={`ThingView-${props.rootKey}`} />;
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
	// the key the sandbox mounts the thing under — it's the label the tree
	// shows. Dots are path separators in thingtime, so they get swapped out.
	label?: string;
	// tighter type sizing for nested contexts (shared-post sub-cards)
	compact?: boolean;
};

export const ThingView = (props: ThingViewProps) => {
	const { thing, label, compact } = props;

	const renderer = React.useMemo(() => resolveKindRenderer(thing), [thing]);

	const adapted = React.useMemo(() => {
		if (!renderer) return null;
		try {
			return renderer.adapt(thing as Record<string, unknown>);
		} catch {
			return null;
		}
	}, [renderer, thing]);

	const canRender = !!renderer && adapted !== null && adapted !== undefined;

	// default to the rendered form whenever one is available ("render mode by
	// default"); the corner icon flips to the native Thingtime view and back
	const [showRendered, setShowRendered] = React.useState(true);
	const rendered = canRender && showRendered;

	const rootKey = React.useMemo(() => {
		const cleaned = (label || 'Thing').split('.').join('·').trim();
		return cleaned || 'Thing';
	}, [label]);

	const initialTree = React.useMemo(() => ({ [rootKey]: thing }), [rootKey, thing]);

	if (rendered) {
		const Component = renderer!.render;
		return (
			<Box position="relative" maxWidth="100%">
				<Component value={adapted} context={{ size: compact ? 'compact' : 'card' }} />
				<CornerToggle rendered rendererTitle={renderer!.title} onToggle={() => setShowRendered(false)} />
			</Box>
		);
	}

	return (
		<Box position="relative" maxWidth="100%">
			<Box
				border={BORDER}
				borderRadius="var(--tt-radius-md, 12px)"
				background="var(--tt-surface, #fafafb)"
				paddingX={3}
				paddingY={2}
				maxWidth="100%"
				overflowX="auto"
			>
				<LocalThingProvider initialTree={initialTree}>
					<SandboxedThingtime rootKey={rootKey} />
				</LocalThingProvider>
			</Box>
			{canRender && (
				<CornerToggle rendered={false} rendererTitle={renderer!.title} onToggle={() => setShowRendered(true)} />
			)}
		</Box>
	);
};
