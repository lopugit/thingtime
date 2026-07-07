import React from 'react';
import { Box, Flex, Input } from '@chakra-ui/react';
import { Columns2, Eye, Paintbrush, PictureInPicture2, Rows2 } from 'lucide-react';

import { useLopu } from '../Lopu/useLopu';
import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';

// Editor mode: an infinitely sub-splittable window system.
//
// The layout is a binary tree — every window (leaf) can split horizontally
// (side by side) or vertically (stacked), any divider drags to resize, and
// each window carries its own thing path, view/edit mode, and content mode
// (Aa reader view / {} code view — both are the Thingtime component; {} adds
// developer chrome). Windows have macOS-style traffic lights (close /
// minimise / maximise), can pop out into floating windows (drag + resize +
// dock back), and scroll independently.
//
// The live layout mirrors into thingtime.settings.editor.live (debounced) so
// the drawer's Editor section can list and manage windows, and named layouts
// persist under thingtime.settings.editor.configs. The drawer drives the
// mounted editor over the shared events bus with 'editor-command' events.

// Aa = reader view; {} = code view — both render the Thingtime component,
// the code view just adds developer chrome (type icons, key counts, [n]
// indices, value pills) via Thingtime's codeView prop
export type EditorContentMode = 'reader' | 'code';

export type EditorLeaf = {
	id: string;
	kind: 'leaf';
	path: string;
	edit: boolean;
	contentMode: EditorContentMode;
};

export type EditorBranch = {
	id: string;
	kind: 'split';
	// 'row' = windows side by side, 'column' = stacked
	direction: 'row' | 'column';
	// share of the first child, 0..1
	ratio: number;
	a: EditorNode;
	b: EditorNode;
};

export type EditorNode = EditorLeaf | EditorBranch;

export type FloatingWindow = {
	leaf: EditorLeaf;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type EditorLayoutSnapshot = {
	tree: EditorNode | null;
	floating: FloatingWindow[];
	minimised: EditorLeaf[];
};

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;
const FLOATING_Z_INDEX = 1250;

const uid = () => Math.random().toString(36).slice(2, 9);

const makeLeaf = (path: string, edit: boolean): EditorLeaf => ({
	id: uid(),
	kind: 'leaf',
	path,
	edit,
	contentMode: 'reader'
});

// immutable tree ops -------------------------------------------------------

const updateLeaf = (node: EditorNode | null, id: string, patch: Partial<EditorLeaf>): EditorNode | null => {
	if (!node) {
		return node;
	}

	if (node.kind === 'leaf') {
		return node.id === id ? { ...node, ...patch } : node;
	}

	return { ...node, a: updateLeaf(node.a, id, patch) as EditorNode, b: updateLeaf(node.b, id, patch) as EditorNode };
};

const splitLeaf = (node: EditorNode | null, id: string, direction: 'row' | 'column'): EditorNode | null => {
	if (!node) {
		return node;
	}

	if (node.kind === 'leaf') {
		if (node.id !== id) {
			return node;
		}

		return {
			id: uid(),
			kind: 'split',
			direction,
			ratio: 0.5,
			a: node,
			b: { ...makeLeaf(node.path, node.edit), contentMode: node.contentMode }
		};
	}

	return {
		...node,
		a: splitLeaf(node.a, id, direction) as EditorNode,
		b: splitLeaf(node.b, id, direction) as EditorNode
	};
};

const removeLeaf = (node: EditorNode | null, id: string): EditorNode | null => {
	if (!node) {
		return node;
	}

	if (node.kind === 'leaf') {
		return node.id === id ? null : node;
	}

	const a = removeLeaf(node.a, id);
	const b = removeLeaf(node.b, id);

	if (!a && !b) {
		return null;
	}
	if (!a) {
		return b;
	}
	if (!b) {
		return a;
	}

	return { ...node, a, b };
};

const setRatio = (node: EditorNode | null, id: string, ratio: number): EditorNode | null => {
	if (!node || node.kind === 'leaf') {
		return node;
	}

	if (node.id === id) {
		return { ...node, ratio };
	}

	return { ...node, a: setRatio(node.a, id, ratio) as EditorNode, b: setRatio(node.b, id, ratio) as EditorNode };
};

const collectLeaves = (node: EditorNode | null): EditorLeaf[] => {
	if (!node) {
		return [];
	}

	return node.kind === 'leaf' ? [node] : [...collectLeaves(node.a), ...collectLeaves(node.b)];
};

// configs live in settings.editor.configs where the {} editor can produce
// arbitrary shapes — sanitize before anything reaches render state
const sanitizeLeafData = (raw: any): EditorLeaf | null => {
	if (!raw || raw.kind !== 'leaf' || typeof raw.path !== 'string' || !raw.path) {
		return null;
	}

	return {
		id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
		kind: 'leaf',
		path: raw.path,
		edit: !!raw.edit,
		// 'json' was the pre-rework name for the code view
		contentMode: raw.contentMode === 'code' || raw.contentMode === 'json' ? 'code' : 'reader'
	};
};

const sanitizeNodeData = (raw: any): EditorNode | null => {
	if (!raw) {
		return null;
	}

	if (raw.kind === 'leaf') {
		return sanitizeLeafData(raw);
	}

	if (raw.kind === 'split') {
		const a = sanitizeNodeData(raw.a);
		const b = sanitizeNodeData(raw.b);

		if (!a && !b) {
			return null;
		}
		if (!a) {
			return b;
		}
		if (!b) {
			return a;
		}

		const ratio = typeof raw.ratio === 'number' && !Number.isNaN(raw.ratio) ? raw.ratio : 0.5;

		return {
			id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
			kind: 'split',
			direction: raw.direction === 'column' ? 'column' : 'row',
			ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)),
			a,
			b
		};
	}

	return null;
};

// keep floating windows reachable: clamp geometry into the viewport
const clampFloatingGeometry = (win: FloatingWindow): FloatingWindow => ({
	...win,
	width: Math.max(300, Math.min(Number(win.width) || 440, window.innerWidth - 24)),
	height: Math.max(220, Math.min(Number(win.height) || 380, window.innerHeight - 24)),
	x: Math.max(0, Math.min(Number(win.x) || 90, window.innerWidth - 120)),
	y: Math.max(0, Math.min(Number(win.y) || 90, window.innerHeight - 60))
});

const sanitizeFloatingData = (raw: any): FloatingWindow | null => {
	const leaf = sanitizeLeafData(raw?.leaf);

	if (!leaf) {
		return null;
	}

	return clampFloatingGeometry({ leaf, x: raw.x, y: raw.y, width: raw.width, height: raw.height });
};

const findLeaf = (node: EditorNode | null, id: string): EditorLeaf | null => {
	return collectLeaves(node).find((leaf) => leaf.id === id) || null;
};

// pointer gesture helper (pointer-id filtered, cancel/blur teardown) --------

const startPointerGesture = (e: React.PointerEvent, onMove: (move: PointerEvent) => void, onDone?: () => void) => {
	const pointerId = e.pointerId;

	const handleMove = (move: PointerEvent) => {
		if (move.pointerId !== pointerId) {
			return;
		}
		onMove(move);
	};

	const teardown = () => {
		window.removeEventListener('pointermove', handleMove);
		window.removeEventListener('pointerup', stop);
		window.removeEventListener('pointercancel', stop);
		window.removeEventListener('blur', teardown);
		onDone?.();
	};

	const stop = (ev: PointerEvent) => {
		if (ev.pointerId !== pointerId) {
			return;
		}
		teardown();
	};

	window.addEventListener('pointermove', handleMove);
	window.addEventListener('pointerup', stop);
	window.addEventListener('pointercancel', stop);
	window.addEventListener('blur', teardown);
};

// window chrome ------------------------------------------------------------

type WindowActions = {
	onPatch: (id: string, patch: Partial<EditorLeaf>) => void;
	onSplit: (id: string, direction: 'row' | 'column') => void;
	onClose: (id: string) => void;
	onMinimise: (id: string) => void;
	onMaximise: (id: string) => void;
	onPopOut: (id: string) => void;
	onDockIn: (id: string) => void;
	maximisedId: string | null;
};

const toolbarButtonStyles = {
	alignItems: 'center',
	justifyContent: 'center',
	width: '24px',
	height: '24px',
	borderRadius: 'var(--tt-radius-xs, 7px)',
	color: 'var(--tt-muted, #9a9aa6)',
	cursor: 'pointer',
	flexShrink: 0,
	transition: 'background 0.15s ease, color 0.15s ease',
	_hover: { background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' }
} as const;

const TrafficLight = (props: { color: string; glyph: string; title: string; onClick: () => void }) => (
	<Flex
		as="button"
		type="button"
		aria-label={props.title}
		title={props.title}
		alignItems="center"
		justifyContent="center"
		position="relative"
		width="12px"
		height="12px"
		flexShrink={0}
		borderRadius="3.5px"
		background={props.color}
		color="rgba(20, 20, 26, 0.6)"
		fontSize="9px"
		fontWeight={800}
		lineHeight="1"
		cursor="pointer"
		transition="transform 0.1s ease"
		_active={{ transform: 'scale(0.9)' }}
		// the visual stays 12px; the hit target is ~20px
		_before={{ content: '""', position: 'absolute', inset: '-4px' }}
		_focusVisible={{ outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '1px' }}
		onClick={props.onClick}
	>
		<Box as="span" className="traffic-glyph" opacity={0} transition="opacity 0.12s ease">
			{props.glyph}
		</Box>
	</Flex>
);

const TrafficLights = (props: {
	onClose: () => void;
	onMinimise: () => void;
	onGreen: () => void;
	greenGlyph: string;
	greenTitle: string;
}) => (
	<Flex
		className="editor-traffic-lights"
		alignItems="center"
		columnGap="6px"
		flexShrink={0}
		paddingRight="4px"
		sx={{ '&:hover .traffic-glyph, &:focus-within .traffic-glyph': { opacity: 1 } }}
	>
		<TrafficLight color="var(--tt-rainbow-1, #f34a4a)" glyph="×" title="Close window" onClick={props.onClose} />
		<TrafficLight color="var(--tt-rainbow-2, #ffbc48)" glyph="−" title="Minimise window" onClick={props.onMinimise} />
		<TrafficLight color="var(--tt-rainbow-3, #58ca70)" glyph={props.greenGlyph} title={props.greenTitle} onClick={props.onGreen} />
	</Flex>
);

// Aa / {} — reader view vs code view (the claude-design-mockup-v1 pattern)
const ContentModeToggle = (props: { mode: EditorContentMode; onChange: (mode: EditorContentMode) => void }) => (
	<Flex
		className="editor-content-mode"
		flexShrink={0}
		alignItems="center"
		columnGap="2px"
		padding="2px"
		background="var(--tt-surface-alt, #f5f5f7)"
		borderRadius="var(--tt-radius-sm, 9px)"
	>
		{(['reader', 'code'] as EditorContentMode[]).map((mode) => {
			const active = props.mode === mode;

			return (
				<Flex
					key={mode}
					as="button"
					type="button"
					title={mode === 'reader' ? 'Reader view' : 'Code view (developer chrome)'}
					aria-pressed={active}
					alignItems="center"
					justifyContent="center"
					height="19px"
					paddingX="7px"
					borderRadius="7px"
					background={active ? 'var(--tt-ink, #16161a)' : 'transparent'}
					color={active ? 'var(--tt-card, #ffffff)' : 'var(--tt-muted, #9a9aa6)'}
					fontSize="10.5px"
					fontWeight={700}
					fontFamily={mode === 'code' ? 'var(--tt-font-mono, monospace)' : 'inherit'}
					cursor="pointer"
					transition="background 0.15s ease, color 0.15s ease"
					onClick={() => props.onChange(mode)}
				>
					{mode === 'reader' ? 'Aa' : '{}'}
				</Flex>
			);
		})}
	</Flex>
);

const EditorWindow = (props: {
	leaf: EditorLeaf;
	actions: WindowActions;
	floating?: boolean;
	onToolbarPointerDown?: (e: React.PointerEvent) => void;
}) => {
	const { leaf, actions, floating } = props;
	const { getThingtime, thingtime } = useThingtime();

	const [pathDraft, setPathDraft] = React.useState(leaf.path);

	React.useEffect(() => {
		setPathDraft(leaf.path);
	}, [leaf.path]);

	const commitPath = React.useCallback(() => {
		const next = pathDraft.trim() || 'thingtime';
		if (next !== leaf.path) {
			actions.onPatch(leaf.id, { path: next });
		}
	}, [pathDraft, leaf.id, leaf.path, actions]);

	const thing = React.useMemo(() => {
		return getThingtime(leaf.path);
		// thingtime: refresh the lookup whenever the tree changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [getThingtime, leaf.path, thingtime]);

	const maximised = actions.maximisedId === leaf.id;

	return (
		<Flex
			className="editor-window"
			flexDirection="column"
			width="100%"
			height="100%"
			minWidth={0}
			minHeight={0}
			background="var(--tt-card, #ffffff)"
		>
			{/* window toolbar: traffic lights + path + content mode + controls */}
			<Flex
				className="editor-window-toolbar"
				alignItems="center"
				columnGap="4px"
				flexShrink={0}
				paddingX="8px"
				paddingY="4px"
				borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
				background="var(--tt-surface, #fafafb)"
				cursor={floating ? 'grab' : undefined}
				sx={floating ? { touchAction: 'none', '&:active': { cursor: 'grabbing' } } : undefined}
				onPointerDown={props.onToolbarPointerDown}
			>
				<TrafficLights
					onClose={() => actions.onClose(leaf.id)}
					onMinimise={() => actions.onMinimise(leaf.id)}
					onGreen={() => (floating ? actions.onDockIn(leaf.id) : actions.onMaximise(leaf.id))}
					greenGlyph={floating ? '◱' : maximised ? '−' : '+'}
					greenTitle={floating ? 'Dock back into the layout' : maximised ? 'Restore layout' : 'Maximise window'}
				/>
				<Input
					value={pathDraft}
					onChange={(e) => setPathDraft(e.target.value)}
					onBlur={commitPath}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							commitPath();
							(e.target as HTMLElement).blur?.();
						}
					}}
					aria-label="Window thing path"
					variant="unstyled"
					fontFamily="var(--tt-font-mono, monospace)"
					fontSize="11px"
					color="var(--tt-muted, #9a9aa6)"
					_focus={{ color: 'var(--tt-ink, #16161a)' }}
					paddingX="6px"
					height="22px"
					minWidth={0}
					background="transparent"
					borderRadius="var(--tt-radius-xs, 7px)"
					_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
				/>
				<ContentModeToggle mode={leaf.contentMode} onChange={(mode) => actions.onPatch(leaf.id, { contentMode: mode })} />
				<Flex
					{...toolbarButtonStyles}
					color={leaf.edit ? 'var(--tt-accent, hotpink)' : 'var(--tt-muted, #9a9aa6)'}
					title={leaf.edit ? 'Editing — switch to view' : 'Viewing — switch to edit'}
					onClick={() => actions.onPatch(leaf.id, { edit: !leaf.edit })}
				>
					{leaf.edit ? <Paintbrush size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
				</Flex>
				{!floating && (
					<>
						<Flex {...toolbarButtonStyles} title="Split horizontally (side by side)" onClick={() => actions.onSplit(leaf.id, 'row')}>
							<Columns2 size={13} strokeWidth={2} />
						</Flex>
						<Flex {...toolbarButtonStyles} title="Split vertically (stacked)" onClick={() => actions.onSplit(leaf.id, 'column')}>
							<Rows2 size={13} strokeWidth={2} />
						</Flex>
						<Flex {...toolbarButtonStyles} title="Pop out into a floating window" onClick={() => actions.onPopOut(leaf.id)}>
							<PictureInPicture2 size={13} strokeWidth={2} />
						</Flex>
					</>
				)}
			</Flex>

			{/* window body: its own scroll context. Aa and {} are the same
			Thingtime tree — {} adds developer chrome via codeView */}
			<Box flex="1" minHeight={0} overflow="auto" paddingX="18px" paddingY="16px">
				<Thingtime
					key={`${leaf.id}:${leaf.path}`}
					path={leaf.path}
					thing={thing}
					edit={leaf.edit}
					codeView={leaf.contentMode === 'code'}
					debugId={`EditorWindow-${leaf.id}`}
				/>
			</Box>
		</Flex>
	);
};

// recursive renderer -------------------------------------------------------

const EditorNodeView = (props: { node: EditorNode; actions: WindowActions; onRatio: (id: string, ratio: number) => void }) => {
	const { node, actions, onRatio } = props;

	const startDividerDrag = React.useCallback(
		(e: React.PointerEvent, branch: EditorBranch) => {
			e.preventDefault();

			const container = (e.currentTarget as HTMLElement).parentElement;
			if (!container) {
				return;
			}

			startPointerGesture(e, (move) => {
				const rect = container.getBoundingClientRect();
				const raw =
					branch.direction === 'row'
						? (move.clientX - rect.left) / Math.max(rect.width, 1)
						: (move.clientY - rect.top) / Math.max(rect.height, 1);

				onRatio(branch.id, Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw)));
			});
		},
		[onRatio]
	);

	if (node.kind === 'leaf') {
		return <EditorWindow leaf={node} actions={actions} />;
	}

	const isRow = node.direction === 'row';

	return (
		<Flex flexDirection={isRow ? 'row' : 'column'} width="100%" height="100%" minWidth={0} minHeight={0}>
			<Box flex={node.ratio} minWidth={0} minHeight={0} overflow="hidden">
				<EditorNodeView node={node.a} actions={actions} onRatio={onRatio} />
			</Box>
			<Box
				className="editor-split-divider"
				flexShrink={0}
				width={isRow ? '5px' : '100%'}
				height={isRow ? '100%' : '5px'}
				cursor={isRow ? 'col-resize' : 'row-resize'}
				background="var(--tt-border-light, #f0f0f2)"
				transition="background 0.15s ease"
				_hover={{ background: 'var(--tt-accent, hotpink)' }}
				sx={{ touchAction: 'none' }}
				onPointerDown={(e) => startDividerDrag(e, node)}
			/>
			<Box flex={1 - node.ratio} minWidth={0} minHeight={0} overflow="hidden">
				<EditorNodeView node={node.b} actions={actions} onRatio={onRatio} />
			</Box>
		</Flex>
	);
};

// floating (popped-out) windows ---------------------------------------------

const FloatingWindowView = (props: {
	win: FloatingWindow;
	actions: WindowActions;
	onGeometry: (id: string, patch: Partial<FloatingWindow>) => void;
}) => {
	const { win, actions, onGeometry } = props;

	const startDrag = React.useCallback(
		(e: React.PointerEvent) => {
			// keep toolbar controls usable
			if ((e.target as HTMLElement)?.closest?.('button, input, [contenteditable]')) {
				return;
			}

			e.preventDefault();

			const startX = e.clientX;
			const startY = e.clientY;
			const origin = { x: win.x, y: win.y };

			startPointerGesture(e, (move) => {
				onGeometry(win.leaf.id, {
					x: Math.max(0, Math.min(origin.x + move.clientX - startX, window.innerWidth - 120)),
					y: Math.max(0, Math.min(origin.y + move.clientY - startY, window.innerHeight - 60))
				});
			});
		},
		[win.leaf.id, win.x, win.y, onGeometry]
	);

	const startResize = React.useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();

			const startX = e.clientX;
			const startY = e.clientY;
			const origin = { width: win.width, height: win.height };

			startPointerGesture(e, (move) => {
				onGeometry(win.leaf.id, {
					width: Math.max(300, Math.min(origin.width + move.clientX - startX, window.innerWidth - 24)),
					height: Math.max(220, Math.min(origin.height + move.clientY - startY, window.innerHeight - 24))
				});
			});
		},
		[win.leaf.id, win.width, win.height, onGeometry]
	);

	return (
		<Flex
			className="editor-floating-window"
			position="fixed"
			left={`${win.x}px`}
			top={`${win.y}px`}
			width={`${win.width}px`}
			height={`${win.height}px`}
			zIndex={FLOATING_Z_INDEX}
			flexDirection="column"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
			overflow="hidden"
		>
			<Box flex="1" minHeight={0}>
				<EditorWindow leaf={win.leaf} actions={actions} floating onToolbarPointerDown={startDrag} />
			</Box>
			<Box
				aria-hidden
				position="absolute"
				right="1px"
				bottom="1px"
				width="15px"
				height="15px"
				cursor="nwse-resize"
				color="var(--tt-faint, #b6b6c0)"
				sx={{ touchAction: 'none' }}
				title="Drag to resize"
				onPointerDown={startResize}
			>
				<svg viewBox="0 0 14 14" width="14" height="14">
					<path d="M12 6 L6 12 M12 10 L10 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
				</svg>
			</Box>
		</Flex>
	);
};

// root ----------------------------------------------------------------------

const defaultTree = (initialPath: string): EditorNode => ({
	id: uid(),
	kind: 'split',
	direction: 'row',
	ratio: 0.5,
	a: makeLeaf(initialPath, false),
	b: makeLeaf(initialPath, true)
});

export const EditorSplit = (props: { initialPath: string }) => {
	const { thingtime, setThingtime, events } = useThingtime();
	const lopu = useLopu();

	// setThingtime's identity changes on every thingtime write — read it
	// through a ref so effects that write settings never re-trigger themselves
	const setThingtimeRef = React.useRef(setThingtime);
	setThingtimeRef.current = setThingtime;

	// default layout: rendered view beside an editable view of the same thing
	const [tree, setTree] = React.useState<EditorNode | null>(() => defaultTree(props.initialPath));
	const [floating, setFloating] = React.useState<FloatingWindow[]>([]);
	const [minimised, setMinimised] = React.useState<EditorLeaf[]>([]);
	const [maximisedId, setMaximisedId] = React.useState<string | null>(null);

	// refs so events-bus command handlers never act on stale state
	const layoutRef = React.useRef({ tree, floating, minimised });

	React.useEffect(() => {
		layoutRef.current = { tree, floating, minimised };
	}, [tree, floating, minimised]);

	const configs = thingtime?.settings?.editor?.configs || {};
	const configsRef = React.useRef(configs);

	React.useEffect(() => {
		configsRef.current = configs;
	}, [configs]);

	const applyLayout = React.useCallback((layout: Partial<EditorLayoutSnapshot> | null | undefined) => {
		if (!layout) {
			return;
		}

		// configs are user-editable data ({} editor writes anywhere) — never
		// trust their shape
		setTree(sanitizeNodeData(layout.tree));
		setFloating((Array.isArray(layout.floating) ? layout.floating : []).map(sanitizeFloatingData).filter(Boolean) as FloatingWindow[]);
		setMinimised((Array.isArray(layout.minimised) ? layout.minimised : []).map(sanitizeLeafData).filter(Boolean) as EditorLeaf[]);
		setMaximisedId(null);
	}, []);

	// viewport shrinks (window resize) never strand floating windows offscreen
	React.useEffect(() => {
		const onResize = () => {
			setFloating((prev) => prev.map(clampFloatingGeometry));
		};

		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('resize', onResize);
		};
	}, []);

	// the drawer opens a saved config by name, then navigates here
	const openedConfigRef = React.useRef(false);
	const pendingConfigName = thingtime?.settings?.editor?.openConfig;

	React.useEffect(() => {
		if (!pendingConfigName || openedConfigRef.current) {
			return;
		}

		openedConfigRef.current = true;

		const config = configsRef.current?.[pendingConfigName];

		if (config) {
			applyLayout(config);
		}

		// always clear the flag — a stale name must not re-fire on the next mount
		setThingtimeRef.current('settings.editor.openConfig', null, { namespace: 'editor', ignoreUndoRedo: true });
	}, [pendingConfigName, applyLayout]);

	// mirror the live layout into settings for the drawer: first write lands
	// immediately (so the drawer never shows a previous session's windows),
	// later ones debounce. Reads setThingtime via ref and skips identical
	// payloads — never re-triggers itself, never touches the undo timeline.
	const lastMirrorRef = React.useRef<string>('');
	const firstMirrorRef = React.useRef(true);

	React.useEffect(() => {
		const write = () => {
			const payload = {
				windows: [
					...collectLeaves(tree).map((leaf) => ({ id: leaf.id, path: leaf.path, edit: leaf.edit, contentMode: leaf.contentMode, location: 'docked' })),
					...floating.map((win) => ({ id: win.leaf.id, path: win.leaf.path, edit: win.leaf.edit, contentMode: win.leaf.contentMode, location: 'floating' }))
				],
				minimised: minimised.map((leaf) => ({ id: leaf.id, path: leaf.path, edit: leaf.edit, contentMode: leaf.contentMode }))
			};

			const serialized = JSON.stringify(payload);

			if (serialized === lastMirrorRef.current) {
				return;
			}

			lastMirrorRef.current = serialized;
			setThingtimeRef.current('settings.editor.live', payload, { namespace: 'editor', ignoreUndoRedo: true });
		};

		if (firstMirrorRef.current) {
			firstMirrorRef.current = false;
			write();
			return;
		}

		const timer = setTimeout(write, 600);

		return () => clearTimeout(timer);
	}, [tree, floating, minimised]);

	// ------------------------------------------------------------------
	// window operations (shared by toolbars and drawer commands)
	// ------------------------------------------------------------------

	const patchLeaf = React.useCallback((id: string, patch: Partial<EditorLeaf>) => {
		setTree((prev) => updateLeaf(prev, id, patch));
		setFloating((prev) => prev.map((win) => (win.leaf.id === id ? { ...win, leaf: { ...win.leaf, ...patch } } : win)));
		setMinimised((prev) => prev.map((leaf) => (leaf.id === id ? { ...leaf, ...patch } : leaf)));
	}, []);

	const splitById = React.useCallback((id: string, direction: 'row' | 'column') => {
		setTree((prev) => splitLeaf(prev, id, direction));
	}, []);

	const closeById = React.useCallback((id: string) => {
		setTree((prev) => removeLeaf(prev, id));
		setFloating((prev) => prev.filter((win) => win.leaf.id !== id));
		setMinimised((prev) => prev.filter((leaf) => leaf.id !== id));
		setMaximisedId((prev) => (prev === id ? null : prev));
	}, []);

	const dockLeaf = React.useCallback((leaf: EditorLeaf) => {
		// docking always exits maximise so the arriving window is visible
		setMaximisedId(null);
		setTree((prev) => {
			if (!prev) {
				return leaf;
			}

			return { id: uid(), kind: 'split', direction: 'row', ratio: 0.5, a: prev, b: leaf };
		});
	}, []);

	const minimiseById = React.useCallback((id: string) => {
		const { tree: currentTree, floating: currentFloating } = layoutRef.current;
		const leaf = findLeaf(currentTree, id) || currentFloating.find((win) => win.leaf.id === id)?.leaf;

		if (!leaf) {
			return;
		}

		setTree((prev) => removeLeaf(prev, id));
		setFloating((prev) => prev.filter((win) => win.leaf.id !== id));
		setMinimised((prev) => (prev.some((item) => item.id === id) ? prev : [...prev, leaf]));
		setMaximisedId((prev) => (prev === id ? null : prev));
	}, []);

	const restoreById = React.useCallback(
		(id: string) => {
			const leaf = layoutRef.current.minimised.find((item) => item.id === id);

			if (!leaf) {
				return;
			}

			setMinimised((prev) => prev.filter((item) => item.id !== id));
			dockLeaf(leaf);
		},
		[dockLeaf]
	);

	const popOutById = React.useCallback((id: string) => {
		const leaf = findLeaf(layoutRef.current.tree, id);

		if (!leaf) {
			return;
		}

		setTree((prev) => removeLeaf(prev, id));
		setMaximisedId((prev) => (prev === id ? null : prev));
		setFloating((prev) => {
			const offset = 90 + prev.length * 28;

			return [
				...prev,
				{
					leaf,
					x: Math.max(12, Math.min(offset, window.innerWidth - 560)),
					y: Math.max(70, Math.min(offset, window.innerHeight - 460)),
					width: Math.min(540, window.innerWidth - 48),
					height: Math.min(420, window.innerHeight - 120)
				}
			];
		});
	}, []);

	const dockInById = React.useCallback(
		(id: string) => {
			const win = layoutRef.current.floating.find((item) => item.leaf.id === id);

			if (!win) {
				return;
			}

			setFloating((prev) => prev.filter((item) => item.leaf.id !== id));
			dockLeaf(win.leaf);
		},
		[dockLeaf]
	);

	const toggleMaximise = React.useCallback((id: string) => {
		setMaximisedId((prev) => (prev === id ? null : id));
	}, []);

	const addWindow = React.useCallback(() => {
		dockLeaf(makeLeaf(props.initialPath, true));
	}, [dockLeaf, props.initialPath]);

	const saveConfig = React.useCallback(() => {
		const existing = configsRef.current || {};
		let index = 1;
		let name = 'Layout 1';
		while (Object.hasOwnProperty.call(existing, name) && index <= 999) {
			index++;
			name = `Layout ${index}`;
		}

		const { tree: currentTree, floating: currentFloating, minimised: currentMinimised } = layoutRef.current;

		setThingtimeRef.current(
			'settings.editor.configs',
			{ ...existing, [name]: { tree: currentTree, floating: currentFloating, minimised: currentMinimised } },
			{ namespace: 'editor' }
		);

		lopu({
			title: `Layout saved 💾`,
			description: `"${name}" — open or manage it from the drawer's Editor section (or edit settings.editor.configs directly).`,
			status: 'success',
			duration: 6000
		});
	}, [lopu]);

	// drawer → editor commands over the shared events bus
	React.useEffect(() => {
		const subscription = events.subscribe((event: any) => {
			if (event?.type !== 'editor-command') {
				return;
			}

			switch (event.command) {
				case 'restore-window':
					restoreById(event.id);
					break;
				case 'minimise-window':
					minimiseById(event.id);
					break;
				case 'close-window':
					closeById(event.id);
					break;
				case 'save-config':
					saveConfig();
					break;
				case 'apply-config': {
					const config = configsRef.current?.[event.name];
					if (config) {
						applyLayout(config);
					}
					break;
				}
				case 'new-window':
					addWindow();
					break;
				default:
					break;
			}
		});

		return () => {
			subscription?.unsubscribe?.();
		};
	}, [events, restoreById, minimiseById, closeById, saveConfig, applyLayout, addWindow]);

	const actions = React.useMemo<WindowActions>(
		() => ({
			onPatch: patchLeaf,
			onSplit: splitById,
			onClose: closeById,
			onMinimise: minimiseById,
			onMaximise: toggleMaximise,
			onPopOut: popOutById,
			onDockIn: dockInById,
			maximisedId
		}),
		[patchLeaf, splitById, closeById, minimiseById, toggleMaximise, popOutById, dockInById, maximisedId]
	);

	const onRatio = React.useCallback((id: string, ratio: number) => {
		setTree((prev) => setRatio(prev, id, ratio));
	}, []);

	const onFloatingGeometry = React.useCallback((id: string, patch: Partial<FloatingWindow>) => {
		setFloating((prev) => prev.map((win) => (win.leaf.id === id ? { ...win, ...patch } : win)));
	}, []);

	const maximisedLeaf = maximisedId ? findLeaf(tree, maximisedId) : null;

	return (
		<>
			<Box
				className="editor-split-root"
				width="100%"
				height="calc(100vh - 92px)"
				minHeight="440px"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				overflow="hidden"
				background="var(--tt-card, #ffffff)"
			>
				{maximisedLeaf ? (
					<EditorWindow leaf={maximisedLeaf} actions={actions} />
				) : tree ? (
					<EditorNodeView node={tree} actions={actions} onRatio={onRatio} />
				) : (
					<Flex
						alignItems="center"
						justifyContent="center"
						flexDirection="column"
						rowGap="12px"
						height="100%"
						color="var(--tt-muted, #9a9aa6)"
					>
						<Box fontSize="sm">All windows are closed or minimised</Box>
						<Flex
							as="button"
							type="button"
							alignItems="center"
							paddingX="14px"
							height="30px"
							border="1px dashed var(--tt-faint, #b6b6c0)"
							borderRadius="var(--tt-radius-sm, 9px)"
							color="var(--tt-muted, #9a9aa6)"
							fontSize="12.5px"
							fontWeight={600}
							cursor="pointer"
							_hover={{ background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' }}
							onClick={addWindow}
						>
							+ New window
						</Flex>
						<Box fontSize="11px" fontFamily="var(--tt-font-mono, monospace)">
							minimised windows live in the drawer&apos;s Editor section
						</Box>
					</Flex>
				)}
			</Box>

			{floating.map((win) => (
				<FloatingWindowView key={win.leaf.id} win={win} actions={actions} onGeometry={onFloatingGeometry} />
			))}
		</>
	);
};
