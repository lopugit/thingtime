import React from 'react';
import { Box, Flex, Input } from '@chakra-ui/react';
import { ArrowDown, ArrowUp, Columns2, Ellipsis, Eye, Grip, Paintbrush, PictureInPicture, PictureInPicture2, Rows2 } from 'lucide-react';

import { useTtCustomClasses } from '../../hooks/useTtTheme';
import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
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
// minimise / maximise — themeable via the --tt-traffic-* vars), pop out into
// floating frames (which are themselves sub-splittable trees, draggable,
// resizable, and dockable back in), and scroll independently. Dragging a
// docked window's toolbar picks it up for re-layout: a skeleton ghost follows
// the pointer and hovering another window previews the half it will dock into
// (left/right/top/bottom) before dropping. Dragging a floating frame just
// MOVES it — placing a frame into the layout is explicit: drag its grip
// handle (the touch path — no modifier needed), or hold ⌘/Ctrl mid-drag.
// A hint pill by the pointer teaches whichever path fits the input device.
// Toolbar controls collapse behind a single "…" expander (hover to peek,
// click to pin) so the toolbar stays clean at small widths.
//
// The live layout mirrors into thingtime.settings.editor.live (deduped,
// ignoreUndoRedo) so the drawer's Editor section can list and manage windows,
// and named layouts persist under thingtime.settings.editor.configs. The
// drawer drives the mounted editor over the events bus ('editor-command').

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

// a popped-out frame: its own sub-splittable tree + viewport geometry
export type FloatingWindow = {
	id: string;
	node: EditorNode;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type EditorLayoutSnapshot = {
	tree: EditorNode | null;
	floating: FloatingWindow[];
	minimised: EditorLeaf[];
	// the maximised window survives save/restore (null = normal layout)
	maximisedId?: string | null;
	// how many floating frames (from the bottom of the stack) sit BELOW the
	// drawer layer; absent on old configs = all below (their legacy stacking)
	drawerLayerIndex?: number;
};

export type DropSide = 'left' | 'right' | 'top' | 'bottom';

type DropTarget = { kind: 'leaf'; leafId: string; side: DropSide } | { kind: 'root' } | null;

type WindowDragState = {
	kind: 'docked' | 'frame';
	sourceId: string; // leaf id (docked) or frame id (frame)
	label: string;
	x: number;
	y: number;
	// docked drags activate after a small movement threshold
	active: boolean;
	// whether this drag places into the layout (docked drags always do;
	// frame drags only from the grip handle or while ⌘/Ctrl is held)
	docking: boolean;
	// touch drags have no modifier key — hints point at the grip instead
	touch: boolean;
};

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;
// Floating frames layer around the drawer (DRAWER_Z): the below band still
// floats over page content but slides under the drawer and the fixed nav
// (9999); the above band clears both. Within a band, array order (bottom →
// top) sets the stacking; the ▲▼ layer controls move frames within and
// ACROSS the bands, treating the drawer itself as one layer index.
const FRAME_BELOW_DRAWER_BASE = DRAWER_Z - 100;
const FRAME_ABOVE_DRAWER_BASE = DRAWER_Z + 40;
const DRAG_GHOST_Z_INDEX = DRAWER_Z + 190;
const DRAG_THRESHOLD_PX = 6;

// the platform's dock-while-dragging modifier, for hints ('⌘' or 'Ctrl')
const MOD_KEY =
	typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/i.test(navigator.platform || '') ? '⌘' : 'Ctrl';

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

const findLeaf = (node: EditorNode | null, id: string): EditorLeaf | null => {
	return collectLeaves(node).find((leaf) => leaf.id === id) || null;
};

// replace the target leaf with a split of (dropped node | target), the
// dropped node taking the chosen half
const insertAtLeaf = (tree: EditorNode | null, targetId: string, node: EditorNode, side: DropSide): EditorNode | null => {
	if (!tree) {
		return node;
	}

	const walk = (current: EditorNode): EditorNode => {
		if (current.kind === 'leaf') {
			if (current.id !== targetId) {
				return current;
			}

			const direction = side === 'left' || side === 'right' ? 'row' : 'column';
			const droppedFirst = side === 'left' || side === 'top';

			return {
				id: uid(),
				kind: 'split',
				direction,
				ratio: 0.5,
				a: droppedFirst ? node : current,
				b: droppedFirst ? current : node
			};
		}

		return { ...current, a: walk(current.a), b: walk(current.b) };
	};

	return walk(tree);
};

// configs live in settings.editor.configs, which is ordinary thing data —
// sanitize before anything reaches render state
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

// keep floating frames reachable: clamp geometry into the viewport
const clampFloatingGeometry = (win: FloatingWindow): FloatingWindow => ({
	...win,
	width: Math.max(300, Math.min(Number(win.width) || 440, window.innerWidth - 24)),
	height: Math.max(220, Math.min(Number(win.height) || 380, window.innerHeight - 24)),
	x: Math.max(0, Math.min(Number(win.x) || 90, window.innerWidth - 120)),
	y: Math.max(0, Math.min(Number(win.y) || 90, window.innerHeight - 60))
});

const sanitizeFloatingData = (raw: any): FloatingWindow | null => {
	// legacy frames stored a single `leaf`; current frames store a `node` tree
	const node = sanitizeNodeData(raw?.node ?? raw?.leaf);

	if (!node) {
		return null;
	}

	return clampFloatingGeometry({
		id: typeof raw?.id === 'string' && raw.id ? raw.id : uid(),
		node,
		x: raw?.x,
		y: raw?.y,
		width: raw?.width,
		height: raw?.height
	});
};

// pointer gesture helper (pointer-id filtered, cancel/blur teardown) --------
// exported for the composer's thing-editor shell (resize handle, popout drag)

export const startPointerGesture = (e: React.PointerEvent, onMove: (move: PointerEvent) => void, onDone?: () => void) => {
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

// the corner resize grip on floating frames (the context menu keeps its own
// copy — importing from here would cycle through Thingtime → the menu trigger)
const ResizeGrip = (props: { onPointerDown: (e: React.PointerEvent) => void; title?: string }) => (
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
		title={props.title || 'Drag to resize'}
		onPointerDown={props.onPointerDown}
	>
		<svg viewBox="0 0 14 14" width="14" height="14">
			<path d="M12 6 L6 12 M12 10 L10 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
		</svg>
	</Box>
);

// window chrome ------------------------------------------------------------

type WindowContext = 'main' | 'frame' | 'maximised';

type WindowActions = {
	onPatch: (id: string, patch: Partial<EditorLeaf>) => void;
	onSplit: (id: string, direction: 'row' | 'column') => void;
	onClose: (id: string) => void;
	onMinimise: (id: string) => void;
	onMaximise: (id: string) => void;
	onPopOut: (id: string) => void;
	// frame windows only: move the enclosing frame through the layer stack
	// (direction 1 = raise, -1 = lower; toEnd = bring-to-front / send-to-back)
	onLayerMove: (id: string, direction: 1 | -1, toEnd?: boolean) => void;
	onDockIn: (id: string) => void;
	onStartWindowDrag: (e: React.PointerEvent, leafId: string, label: string) => void;
	maximisedId: string | null;
};

// the className rides every toolbar control so the frame-drag pointerdown
// (which starts a drag from anywhere on a frame's toolbar) can tell controls
// from empty toolbar space — without it, clicking a control on a FLOATING
// window started a drag instead of firing the action
const toolbarButtonStyles = {
	className: 'editor-toolbar-control',
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

const TrafficLight = (props: {
	color: string;
	radius: string;
	glyph: string;
	title: string;
	// stable class + the user's custom classes (customise popover) hook CSS
	htmlClass: string;
	customKey: string;
	onClick: () => void;
}) => {
	const customClasses = useTtCustomClasses(props.customKey);

	return (
		<Flex
			as="button"
			type="button"
			className={customClasses ? `${props.htmlClass} ${customClasses}` : props.htmlClass}
			aria-label={props.title}
			title={props.title}
			alignItems="center"
			justifyContent="center"
			position="relative"
			width="12px"
			height="12px"
			flexShrink={0}
			borderRadius={props.radius}
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
};

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
		<TrafficLight
			color="var(--tt-traffic-close, var(--tt-rainbow-1, #f34a4a))"
			radius="var(--tt-traffic-close-radius, 3.5px)"
			htmlClass="tt-traffic-close"
			customKey="windows.close"
			glyph="×"
			title="Close window"
			onClick={props.onClose}
		/>
		<TrafficLight
			color="var(--tt-traffic-minimise, var(--tt-rainbow-2, #ffbc48))"
			radius="var(--tt-traffic-minimise-radius, 3.5px)"
			htmlClass="tt-traffic-minimise"
			customKey="windows.minimise"
			glyph="−"
			title="Minimise window"
			onClick={props.onMinimise}
		/>
		<TrafficLight
			color="var(--tt-traffic-maximise, var(--tt-rainbow-3, #58ca70))"
			radius="var(--tt-traffic-maximise-radius, 3.5px)"
			htmlClass="tt-traffic-maximise"
			customKey="windows.maximise"
			glyph={props.greenGlyph}
			title={props.greenTitle}
			onClick={props.onGreen}
		/>
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

// skeleton window (used by drop previews and the drag ghost)
const SkeletonWindow = (props: { label?: string }) => (
	<Flex
		flexDirection="column"
		width="100%"
		height="100%"
		border="1.5px dashed var(--tt-accent, hotpink)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-accent-tint, #fff5fa)"
		overflow="hidden"
		sx={{
			'@keyframes tt-skeleton-pulse': {
				'0%, 100%': { opacity: 0.45 },
				'50%': { opacity: 0.9 }
			}
		}}
	>
		<Flex
			alignItems="center"
			columnGap="5px"
			flexShrink={0}
			paddingX="9px"
			paddingY="6px"
			borderBottom="1px dashed var(--tt-accent, hotpink)"
			opacity={0.75}
		>
			<Box width="8px" height="8px" borderRadius="2.5px" background="var(--tt-traffic-close, var(--tt-rainbow-1, #f34a4a))" />
			<Box width="8px" height="8px" borderRadius="2.5px" background="var(--tt-traffic-minimise, var(--tt-rainbow-2, #ffbc48))" />
			<Box width="8px" height="8px" borderRadius="2.5px" background="var(--tt-traffic-maximise, var(--tt-rainbow-3, #58ca70))" />
			{props.label && (
				<Box
					marginLeft="4px"
					fontFamily="var(--tt-font-mono, monospace)"
					fontSize="9.5px"
					color="var(--tt-accent, hotpink)"
					noOfLines={1}
				>
					{props.label}
				</Box>
			)}
		</Flex>
		<Flex flexDirection="column" rowGap="7px" padding="10px">
			{['72%', '54%', '63%'].map((width, idx) => (
				<Box
					key={idx}
					width={width}
					height="7px"
					borderRadius="4px"
					background="var(--tt-accent, hotpink)"
					sx={{ animation: `tt-skeleton-pulse 1.2s ease-in-out ${idx * 0.15}s infinite` }}
				/>
			))}
		</Flex>
	</Flex>
);

const EditorWindow = (props: {
	leaf: EditorLeaf;
	actions: WindowActions;
	context: WindowContext;
	dropSide?: DropSide | null;
	chromeless?: boolean;
}) => {
	const { leaf, actions, context, chromeless } = props;
	const { getThingtime, thingtime } = useThingtime();

	// stable identity per path — Thingtime's memos key on this prop, and a
	// fresh object per render would defeat them all (recompute + log spam on
	// every drag/hover/keystroke). The tree root labels itself with the TAIL
	// (the toolbar input shows the full path).
	const thingPathProp = React.useMemo(
		() => ({ key: leaf.path, human: leaf.path.split('.').pop() || leaf.path }),
		[leaf.path]
	);

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
	const inFrame = context === 'frame';

	// toolbar controls live behind a "…" expander: hover peeks, click pins
	const [controlsHover, setControlsHover] = React.useState(false);
	const [controlsPinned, setControlsPinned] = React.useState(false);
	const showControls = controlsHover || controlsPinned;

	const onToolbarPointerDown = React.useCallback(
		(e: React.PointerEvent) => {
			// frames delegate toolbar drags to the frame itself
			if (context !== 'main') {
				return;
			}

			if ((e.target as HTMLElement)?.closest?.('button, input, [contenteditable], .editor-toolbar-control')) {
				return;
			}

			actions.onStartWindowDrag(e, leaf.id, leaf.path);
		},
		[context, actions, leaf.id, leaf.path]
	);

	return (
		<Flex
			className="editor-window"
			data-tt-editor-leaf={context === 'main' ? leaf.id : undefined}
			position="relative"
			flexDirection="column"
			width="100%"
			height="100%"
			minWidth={0}
			minHeight={0}
			background="var(--tt-card, #ffffff)"
		>
			{/* window toolbar: traffic lights + path + collapsed controls ("…").
			The empty middle is the drag handle for moving the window. */}
			{!chromeless && (
			<Flex
				className="editor-window-toolbar"
				alignItems="center"
				columnGap="4px"
				flexShrink={0}
				paddingX="8px"
				paddingY="4px"
				borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
				background="var(--tt-surface, #fafafb)"
				cursor={context === 'maximised' ? undefined : 'grab'}
				sx={context === 'maximised' ? undefined : { touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
				onPointerDown={onToolbarPointerDown}
			>
				<TrafficLights
					onClose={() => actions.onClose(leaf.id)}
					onMinimise={() => actions.onMinimise(leaf.id)}
					onGreen={() => (inFrame ? actions.onDockIn(leaf.id) : actions.onMaximise(leaf.id))}
					greenGlyph={inFrame ? '◱' : maximised ? '−' : '+'}
					greenTitle={inFrame ? 'Pop back into the layout' : maximised ? 'Restore layout' : 'Maximise window'}
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
					// content-sized, not full width — the leftover toolbar space
					// stays free for dragging the window
					width={`${Math.min(Math.max(pathDraft.length + 3, 10), 42)}ch`}
					maxWidth="55%"
					flexShrink={1}
					background="transparent"
					borderRadius="var(--tt-radius-xs, 7px)"
					_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
				/>
				{/* free drag area; pushes the controls to the right edge */}
				<Box className="editor-toolbar-drag-space" flex="1" minWidth="10px" alignSelf="stretch" />
				{/* frames get an always-visible grip: dragging it places the
				frame into the layout (plain toolbar drags just move it) */}
				{inFrame && (
					<Flex
						{...toolbarButtonStyles}
						// AFTER the spread — toolbarButtonStyles carries its own
						// className, and the dock-handle class must win or the
						// pointerdown guard treats the grip as a plain control and
						// never starts the place-into-layout drag
						className="tt-frame-dock-handle"
						role="button"
						aria-label="Drag to place this window into the layout"
						title={`Drag to place into the layout — or hold ${MOD_KEY} while dragging the window`}
						cursor="grab"
						position="relative"
						// the visual stays 24px; the touch target is ~36px
						_before={{ content: '""', position: 'absolute', inset: '-6px' }}
						sx={{ touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
					>
						<Grip size={13} strokeWidth={2} />
					</Flex>
				)}
				{/* the icon cluster collapses behind "…" so the toolbar stays
				clean at small widths — hover peeks, click pins */}
				<Flex
					className="editor-toolbar-controls"
					alignItems="center"
					columnGap="4px"
					flexShrink={0}
					onPointerEnter={(e) => {
						if (e.pointerType !== 'touch') {
							setControlsHover(true);
						}
					}}
					onPointerLeave={(e) => {
						if (e.pointerType !== 'touch') {
							setControlsHover(false);
						}
					}}
				>
					{showControls && (
						<Flex
							alignItems="center"
							columnGap="4px"
							sx={{
								'@keyframes tt-controls-in': {
									from: { opacity: 0, transform: 'translateX(8px)' },
									to: { opacity: 1, transform: 'translateX(0)' }
								},
								animation: 'tt-controls-in 0.15s ease'
							}}
						>
							<ContentModeToggle mode={leaf.contentMode} onChange={(mode) => actions.onPatch(leaf.id, { contentMode: mode })} />
							<Flex
								{...toolbarButtonStyles}
								color={leaf.edit ? 'var(--tt-accent, hotpink)' : 'var(--tt-muted, #9a9aa6)'}
								title={leaf.edit ? 'Editing — switch to view' : 'Viewing — switch to edit'}
								onClick={() => actions.onPatch(leaf.id, { edit: !leaf.edit })}
							>
								{leaf.edit ? <Paintbrush size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
							</Flex>
							<Flex {...toolbarButtonStyles} title="Split horizontally (side by side)" onClick={() => actions.onSplit(leaf.id, 'row')}>
								<Columns2 size={13} strokeWidth={2} />
							</Flex>
							<Flex {...toolbarButtonStyles} title="Split vertically (stacked)" onClick={() => actions.onSplit(leaf.id, 'column')}>
								<Rows2 size={13} strokeWidth={2} />
							</Flex>
							{!inFrame && context !== 'maximised' && (
								<Flex {...toolbarButtonStyles} title="Pop out into a floating window" onClick={() => actions.onPopOut(leaf.id)}>
									<PictureInPicture2 size={13} strokeWidth={2} />
								</Flex>
							)}
							{inFrame && (
								<>
									<Flex {...toolbarButtonStyles} title="Pop out into its own floating window" onClick={() => actions.onPopOut(leaf.id)}>
										<PictureInPicture2 size={13} strokeWidth={2} />
									</Flex>
									<Flex {...toolbarButtonStyles} title="Pop back into the layout" onClick={() => actions.onDockIn(leaf.id)}>
										<PictureInPicture size={13} strokeWidth={2} />
									</Flex>
									<Flex
										{...toolbarButtonStyles}
										title="Raise a layer — layers cross the drawer (⇧-click: bring to front)"
										onClick={(e) => actions.onLayerMove(leaf.id, 1, e.shiftKey)}
									>
										<ArrowUp size={13} strokeWidth={2} />
									</Flex>
									<Flex
										{...toolbarButtonStyles}
										title="Lower a layer — layers cross the drawer (⇧-click: send to back)"
										onClick={(e) => actions.onLayerMove(leaf.id, -1, e.shiftKey)}
									>
										<ArrowDown size={13} strokeWidth={2} />
									</Flex>
								</>
							)}
						</Flex>
					)}
					<Flex
						as="button"
						type="button"
						{...toolbarButtonStyles}
						aria-expanded={showControls}
						aria-label="Window controls"
						title={controlsPinned ? 'Hide window controls' : 'Window controls'}
						color={controlsPinned ? 'var(--tt-accent, hotpink)' : 'var(--tt-muted, #9a9aa6)'}
						onClick={() => setControlsPinned((pinned) => !pinned)}
					>
						<Ellipsis size={13} strokeWidth={2} />
					</Flex>
				</Flex>
			</Flex>
			)}

			{/* window body: its own scroll context. Aa and {} are the same
			Thingtime tree — {} adds developer chrome via codeView */}
			<Box flex="1" minHeight={0} overflow="auto" paddingX="18px" paddingY="16px">
				<Thingtime
					key={`${leaf.id}:${leaf.path}`}
					path={thingPathProp}
					thing={thing}
					edit={leaf.edit}
					codeView={leaf.contentMode === 'code'}
					// the window body already pads — the tree's keys sit flush
					// (collapse lives in the row's hover quick actions, not a
					// left-gutter caret, so no gutter inset is needed)
					pathPl="0px"
					debugId={`EditorWindow-${leaf.id}`}
					hideRootPath={chromeless}
				/>
			</Box>

			{/* drop preview: the half this drag would dock into */}
			{props.dropSide && (
				<Box
					className="editor-drop-preview"
					position="absolute"
					pointerEvents="none"
					zIndex={5}
					left={props.dropSide === 'right' ? '50%' : 0}
					top={props.dropSide === 'bottom' ? '50%' : 0}
					width={props.dropSide === 'left' || props.dropSide === 'right' ? '50%' : '100%'}
					height={props.dropSide === 'top' || props.dropSide === 'bottom' ? '50%' : '100%'}
					padding="7px"
				>
					<SkeletonWindow />
				</Box>
			)}
		</Flex>
	);
};

// recursive renderer -------------------------------------------------------

const EditorNodeView = (props: {
	node: EditorNode;
	actions: WindowActions;
	onRatio: (id: string, ratio: number) => void;
	context: WindowContext;
	dropTarget?: DropTarget;
	chromeless?: boolean;
}) => {
	const { node, actions, onRatio, context, dropTarget, chromeless } = props;

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
		const dropSide = dropTarget && dropTarget.kind === 'leaf' && dropTarget.leafId === node.id ? dropTarget.side : null;

		return <EditorWindow leaf={node} actions={actions} context={context} dropSide={dropSide} chromeless={chromeless} />;
	}

	const isRow = node.direction === 'row';

	return (
		<Flex flexDirection={isRow ? 'row' : 'column'} width="100%" height="100%" minWidth={0} minHeight={0}>
			<Box flex={node.ratio} minWidth={0} minHeight={0} overflow="hidden">
				<EditorNodeView node={node.a} actions={actions} onRatio={onRatio} context={context} dropTarget={dropTarget} chromeless={chromeless} />
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
				<EditorNodeView node={node.b} actions={actions} onRatio={onRatio} context={context} dropTarget={dropTarget} chromeless={chromeless} />
			</Box>
		</Flex>
	);
};

// floating (popped-out) frames ----------------------------------------------

const FloatingWindowView = (props: {
	win: FloatingWindow;
	actions: WindowActions;
	onGeometry: (id: string, patch: Partial<FloatingWindow>) => void;
	onStartFrameDrag: (e: React.PointerEvent, frameId: string, opts?: { dock?: boolean }) => void;
	onRatio: (id: string, ratio: number) => void;
	dragging: boolean;
	// stacking slot from the layer system (frames sit above or below the drawer)
	zIndex: number;
}) => {
	const { win, actions, onGeometry, onStartFrameDrag, onRatio, dragging, zIndex } = props;

	const onFramePointerDown = React.useCallback(
		(e: React.PointerEvent) => {
			// any toolbar inside the frame drags the whole frame (controls stay
			// usable); the grip handle starts a place-into-layout drag instead
			const target = e.target as HTMLElement | null;

			if (!target?.closest?.('.editor-window-toolbar')) {
				return;
			}

			const dockHandle = !!target?.closest?.('.tt-frame-dock-handle');

			if (!dockHandle && target?.closest?.('button, input, [contenteditable], .editor-toolbar-control')) {
				return;
			}

			e.preventDefault();
			onStartFrameDrag(e, win.id, { dock: dockHandle });
		},
		[onStartFrameDrag, win.id]
	);

	const startResize = React.useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();

			const startX = e.clientX;
			const startY = e.clientY;
			const origin = { width: win.width, height: win.height };

			startPointerGesture(e, (move) => {
				onGeometry(win.id, {
					width: Math.max(300, Math.min(origin.width + move.clientX - startX, window.innerWidth - 24)),
					height: Math.max(220, Math.min(origin.height + move.clientY - startY, window.innerHeight - 24))
				});
			});
		},
		[win.id, win.width, win.height, onGeometry]
	);

	return (
		<Flex
			className="editor-floating-window"
			position="fixed"
			left={`${win.x}px`}
			top={`${win.y}px`}
			width={`${win.width}px`}
			height={`${win.height}px`}
			zIndex={zIndex}
			flexDirection="column"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
			overflow="hidden"
			// while dragged, let hit-testing see the windows underneath
			pointerEvents={dragging ? 'none' : undefined}
			opacity={dragging ? 0.85 : 1}
			transition="opacity 0.15s ease"
			onPointerDown={onFramePointerDown}
		>
			<Box flex="1" minHeight={0}>
				<EditorNodeView node={win.node} actions={actions} onRatio={onRatio} context="frame" />
			</Box>
			<ResizeGrip onPointerDown={startResize} />
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

export type EditorSplitProps = {
	initialPath: string;
	// Embedded instances (the post composer's thing editor, its popout) start
	// with a single editable window, size to their container, and stay off the
	// shared editor plumbing: they never mirror into settings.editor.live,
	// never consume settings.editor.openConfig, and ignore the drawer's
	// editor-command bus — all of that belongs to the one true /editor.
	embedded?: boolean;
	// root height override (embedded containers own their sizing)
	height?: string;
	// imperative surface for hosts (the composer's pop-out button duplicates
	// the current window into a floating frame — the docked editor stays).
	// Called with null on unmount so hosts never hold a stale api.
	onApi?: (api: { popOutDuplicate: () => void } | null) => void;
	// composer mode: the docked window drops its toolbar (traffic lights +
	// path) and the tree hides its root key — the value IS the editor. Popped
	// out / floating windows keep their chrome.
	chromeless?: boolean;
};

export const EditorSplit = (props: EditorSplitProps) => {
	const { thingtime, setThingtime, events } = useThingtime();
	const lopu = useLopu();

	// setThingtime's identity changes on every thingtime write — read it
	// through a ref so effects that write settings never re-trigger themselves
	const setThingtimeRef = React.useRef(setThingtime);
	setThingtimeRef.current = setThingtime;

	// default layout: rendered view beside an editable view of the same thing;
	// embedded editors start as one editable window
	const [tree, setTree] = React.useState<EditorNode | null>(() =>
		props.embedded ? makeLeaf(props.initialPath, true) : defaultTree(props.initialPath)
	);
	const [floating, setFloating] = React.useState<FloatingWindow[]>([]);
	const [minimised, setMinimised] = React.useState<EditorLeaf[]>([]);
	const [maximisedId, setMaximisedId] = React.useState<string | null>(null);
	// the drawer's slot in the frame stack: frames before this index (bottom →
	// top) render below the drawer, the rest above. 0 = everything above (the
	// default — new windows float over the drawer until sent back).
	const [drawerLayerIndex, setDrawerLayerIndex] = React.useState(0);
	const drawerLayerIndexRef = React.useRef(drawerLayerIndex);
	drawerLayerIndexRef.current = drawerLayerIndex;

	// window drag-docking state (ghost + skeleton drop previews)
	const [windowDrag, setWindowDrag] = React.useState<WindowDragState | null>(null);
	const [dropTarget, setDropTarget] = React.useState<DropTarget>(null);

	const rootRef = React.useRef<HTMLDivElement | null>(null);

	// refs so gesture/event handlers never act on stale state
	const layoutRef = React.useRef({ tree, floating, minimised, maximisedId });

	React.useEffect(() => {
		layoutRef.current = { tree, floating, minimised, maximisedId };
	}, [tree, floating, minimised, maximisedId]);

	const dropTargetRef = React.useRef<DropTarget>(null);

	React.useEffect(() => {
		dropTargetRef.current = dropTarget;
	}, [dropTarget]);

	const configs = thingtime?.settings?.editor?.configs || {};
	const configsRef = React.useRef(configs);

	React.useEffect(() => {
		configsRef.current = configs;
	}, [configs]);

	const applyLayout = React.useCallback((layout: Partial<EditorLayoutSnapshot> | null | undefined) => {
		if (!layout) {
			return;
		}

		// configs are user-editable data — never trust their shape
		const nextTree = sanitizeNodeData(layout.tree);
		const nextFloating = (Array.isArray(layout.floating) ? layout.floating : [])
			.map(sanitizeFloatingData)
			.filter(Boolean) as FloatingWindow[];

		setTree(nextTree);
		setFloating(nextFloating);
		setMinimised((Array.isArray(layout.minimised) ? layout.minimised : []).map(sanitizeLeafData).filter(Boolean) as EditorLeaf[]);
		// configs saved before the layer system stacked every frame below the
		// drawer — keep that look for them; new saves restore their divider
		const savedDivider = Number(layout.drawerLayerIndex);
		setDrawerLayerIndex(
			Number.isFinite(savedDivider) ? Math.min(Math.max(0, Math.floor(savedDivider)), nextFloating.length) : nextFloating.length
		);

		// restore a saved maximised window — only if that leaf still exists in
		// the (sanitized) docked tree, since maximise renders from the main tree
		const savedMaximisedId = layout.maximisedId;

		setMaximisedId(typeof savedMaximisedId === 'string' && findLeaf(nextTree, savedMaximisedId) ? savedMaximisedId : null);
	}, []);

	// Renaming a thing's key (Thingtime's updatePath) emits 'path-renamed' —
	// every window bound to that path (or below it) follows, or its leaf would
	// point at a key that no longer exists and the window would go blank.
	// Applies to embedded editors too (the composer's window roots rename).
	React.useEffect(() => {
		const subscription = events.subscribe((event: any) => {
			if (event?.type !== 'path-renamed' || typeof event.from !== 'string' || typeof event.to !== 'string') {
				return;
			}

			const rewrite = (leafPath: string) =>
				leafPath === event.from || leafPath.startsWith(`${event.from}.`)
					? `${event.to}${leafPath.slice(event.from.length)}`
					: leafPath;
			const rewriteNode = (node: EditorNode | null): EditorNode | null => {
				if (!node) return node;
				if (node.kind === 'leaf') {
					const next = rewrite(node.path);
					return next === node.path ? node : { ...node, path: next };
				}
				return { ...node, a: rewriteNode(node.a) as EditorNode, b: rewriteNode(node.b) as EditorNode };
			};

			setTree((prev) => rewriteNode(prev));
			setFloating((prev) => prev.map((win) => ({ ...win, node: rewriteNode(win.node) as EditorNode })));
			setMinimised((prev) => prev.map((leaf) => ({ ...leaf, path: rewrite(leaf.path) })));
		});

		return () => {
			subscription?.unsubscribe?.();
		};
	}, [events]);

	// closing/docking frames must never strand the drawer divider past the
	// stack's end (a dangling divider would mis-band the next popped frame)
	React.useEffect(() => {
		setDrawerLayerIndex((divider) => Math.min(divider, floating.length));
	}, [floating.length]);

	// viewport shrinks (window resize) never strand floating frames offscreen
	React.useEffect(() => {
		const onResize = () => {
			setFloating((prev) => prev.map(clampFloatingGeometry));
		};

		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('resize', onResize);
		};
	}, []);

	// the drawer opens a saved config by name, then navigates here — embedded
	// editors must never consume (and clear) a flag meant for /editor
	const openedConfigRef = React.useRef(false);
	const pendingConfigName = props.embedded ? null : thingtime?.settings?.editor?.openConfig;

	React.useEffect(() => {
		if (!pendingConfigName || openedConfigRef.current) {
			return;
		}

		openedConfigRef.current = true;

		const config = configsRef.current?.[pendingConfigName];

		if (config) {
			applyLayout(config);
		}

		// always clear the flag — a stale name must not re-fire on the next mount.
		// Tab-local for the same reason the write is: consuming this tab's intent
		// must not erase an intent another tab set and has not navigated to yet.
		setThingtimeRef.current('settings.editor.openConfig', null, { namespace: 'editor', ignoreUndoRedo: true, tabLocal: true });
	}, [pendingConfigName, applyLayout]);

	// mirror the live layout into settings for the drawer: first write lands
	// immediately (so the drawer never shows a previous session's windows),
	// later ones debounce. Reads setThingtime via ref and skips identical
	// payloads — never re-triggers itself, never touches the undo timeline.
	const lastMirrorRef = React.useRef<string>('');
	const firstMirrorRef = React.useRef(true);
	const embedded = !!props.embedded;

	React.useEffect(() => {
		if (embedded) {
			return;
		}

		const write = () => {
			const summarise = (leaf: EditorLeaf, location: 'docked' | 'floating') => ({
				id: leaf.id,
				path: leaf.path,
				edit: leaf.edit,
				contentMode: leaf.contentMode,
				location
			});

			const payload = {
				windows: [
					...collectLeaves(tree).map((leaf) => summarise(leaf, 'docked')),
					...floating.flatMap((win) => collectLeaves(win.node).map((leaf) => summarise(leaf, 'floating')))
				],
				minimised: minimised.map((leaf) => ({ id: leaf.id, path: leaf.path, edit: leaf.edit, contentMode: leaf.contentMode }))
			};

			const serialized = JSON.stringify(payload);

			if (serialized === lastMirrorRef.current) {
				return;
			}

			lastMirrorRef.current = serialized;
			// tabLocal: `live` IS this viewport — the windows open in THIS editor,
			// keyed by ids this mount generated. EditorDrawerSection renders it as
			// that tab's own window list, so broadcasting swaps a peer's list for
			// this tab's: its real windows vanish from its drawer (nothing there
			// can close or minimise a row it can no longer see) and the foreign
			// rows it does show act on ids absent from its tree, so they do
			// nothing. A peer cannot correct it either — this effect depends on
			// tree/floating/minimised, which a remote write does not touch, and
			// lastMirrorRef still holds that peer's own payload, so its list stays
			// wrong until its layout happens to change. Persisted as before, and
			// the first mirror after mount rewrites it from the local layout.
			setThingtimeRef.current('settings.editor.live', payload, { namespace: 'editor', ignoreUndoRedo: true, tabLocal: true });
		};

		if (firstMirrorRef.current) {
			firstMirrorRef.current = false;
			write();
			return;
		}

		const timer = setTimeout(write, 600);

		return () => clearTimeout(timer);
	}, [tree, floating, minimised, embedded]);

	// ------------------------------------------------------------------
	// window operations (shared by toolbars, drags, and drawer commands)
	// ------------------------------------------------------------------

	// apply a tree transform to the main tree and every floating frame;
	// frames whose tree empties out are removed
	// every frame removal must tell the layer divider which band the frame
	// left: dropping a below-drawer frame without decrementing the divider
	// would mis-band the frames above it (they'd silently fall behind the
	// drawer). Both removal paths (emptied frames here, dockInById) route
	// through this accounting.
	const setFloatingAccountingForDivider = React.useCallback(
		(compute: (prev: FloatingWindow[]) => FloatingWindow[]) => {
			// computed OUTSIDE the setState updater — the divider adjustment must
			// run exactly once (updaters can be re-invoked under StrictMode), and
			// every caller is one discrete user action, so layoutRef is fresh
			const prev = layoutRef.current.floating;
			const next = compute(prev);
			const divider = drawerLayerIndexRef.current;
			const removedBelow = prev.filter(
				(win, index) => index < divider && !next.some((kept) => kept.id === win.id)
			).length;

			if (removedBelow) {
				setDrawerLayerIndex(Math.max(0, divider - removedBelow));
			}
			setFloating(next);
		},
		[]
	);

	const mapAllTrees = React.useCallback(
		(fn: (node: EditorNode | null) => EditorNode | null) => {
			setTree((prev) => fn(prev));
			setFloatingAccountingForDivider((prev) =>
				prev
					.map((win) => ({ ...win, node: fn(win.node) }))
					.filter((win): win is FloatingWindow => !!win.node)
			);
		},
		[setFloatingAccountingForDivider]
	);

	const findLeafEverywhere = React.useCallback((id: string): EditorLeaf | null => {
		const { tree: currentTree, floating: currentFloating } = layoutRef.current;

		return findLeaf(currentTree, id) || currentFloating.map((win) => findLeaf(win.node, id)).find(Boolean) || null;
	}, []);

	const patchLeaf = React.useCallback(
		(id: string, patch: Partial<EditorLeaf>) => {
			mapAllTrees((node) => updateLeaf(node, id, patch));
			setMinimised((prev) => prev.map((leaf) => (leaf.id === id ? { ...leaf, ...patch } : leaf)));
		},
		[mapAllTrees]
	);

	const splitById = React.useCallback(
		(id: string, direction: 'row' | 'column') => {
			mapAllTrees((node) => splitLeaf(node, id, direction));
		},
		[mapAllTrees]
	);

	const closeById = React.useCallback(
		(id: string) => {
			mapAllTrees((node) => removeLeaf(node, id));
			setMinimised((prev) => prev.filter((leaf) => leaf.id !== id));
			setMaximisedId((prev) => (prev === id ? null : prev));
		},
		[mapAllTrees]
	);

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

	const minimiseById = React.useCallback(
		(id: string) => {
			const leaf = findLeafEverywhere(id);

			if (!leaf) {
				return;
			}

			mapAllTrees((node) => removeLeaf(node, id));
			setMinimised((prev) => (prev.some((item) => item.id === id) ? prev : [...prev, leaf]));
			setMaximisedId((prev) => (prev === id ? null : prev));
		},
		[findLeafEverywhere, mapAllTrees]
	);

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

	const popOutById = React.useCallback(
		(id: string) => {
			const leaf = findLeafEverywhere(id);

			if (!leaf) {
				return;
			}

			mapAllTrees((node) => removeLeaf(node, id));
			setMaximisedId((prev) => (prev === id ? null : prev));
			setFloating((prev) => {
				const offset = 90 + prev.length * 28;

				return [
					...prev,
					clampFloatingGeometry({
						id: uid(),
						node: leaf,
						x: offset,
						y: offset,
						width: 540,
						height: 420
					})
				];
			});
		},
		[findLeafEverywhere, mapAllTrees]
	);

	const dockInById = React.useCallback(
		(id: string) => {
			const leaf = layoutRef.current.floating.map((win) => findLeaf(win.node, id)).find(Boolean);

			if (!leaf) {
				return;
			}

			setFloatingAccountingForDivider((prev) =>
				prev
					.map((win) => ({ ...win, node: removeLeaf(win.node, id) }))
					.filter((win): win is FloatingWindow => !!win.node)
			);
			dockLeaf(leaf);
		},
		[dockLeaf, setFloatingAccountingForDivider]
	);

	const toggleMaximise = React.useCallback((id: string) => {
		setMaximisedId((prev) => (prev === id ? null : id));
	}, []);

	const addWindow = React.useCallback(() => {
		dockLeaf(makeLeaf(props.initialPath, true));
	}, [dockLeaf, props.initialPath]);

	// Duplicate the current window into a floating frame WITHOUT removing the
	// docked one — the composer's pop-out button. Both windows edit the same
	// path, so they live-sync through the store.
	const popOutDuplicate = React.useCallback(() => {
		const layout = layoutRef.current;
		const source =
			collectLeaves(layout.tree)[0] || layout.floating.flatMap((win) => collectLeaves(win.node))[0] || null;
		const leaf: EditorLeaf = source ? { ...source, id: uid() } : makeLeaf(props.initialPath, true);

		setFloating((prev) => {
			const offset = 90 + prev.length * 28;

			return [
				...prev,
				clampFloatingGeometry({ id: uid(), node: leaf, x: offset, y: offset, width: 760, height: 540 })
			];
		});
	}, [props.initialPath]);

	const onApi = props.onApi;

	React.useEffect(() => {
		onApi?.({ popOutDuplicate });

		return () => {
			onApi?.(null);
		};
	}, [onApi, popOutDuplicate]);

	// Move a frame through the layer stack. `floating` is the bottom → top
	// order; the drawer occupies the slot at drawerLayerIndex. Raising the
	// top-most below-drawer frame (or lowering the bottom-most above one)
	// crosses the drawer by moving the DIVIDER, not the frame, so relative
	// window order is preserved across the crossing.
	const moveFrameLayer = React.useCallback((leafId: string, direction: 1 | -1, toEnd = false) => {
		const frames = layoutRef.current.floating;
		const divider = drawerLayerIndexRef.current;
		const index = frames.findIndex((win) => findLeaf(win.node, leafId));

		if (index < 0) {
			return;
		}

		if (toEnd) {
			// bring-to-front / send-to-back, crossing the drawer if needed
			setFloating((prev) => {
				const win = prev[index];
				const rest = prev.filter((_, i) => i !== index);
				return direction === 1 ? [...rest, win] : [win, ...rest];
			});
			if (direction === 1 && index < divider) setDrawerLayerIndex(divider - 1);
			if (direction === -1 && index >= divider) setDrawerLayerIndex(divider + 1);
			return;
		}

		if (direction === 1) {
			if (index === divider - 1) {
				setDrawerLayerIndex(divider - 1);
				return;
			}
			if (index < frames.length - 1) {
				setFloating((prev) => {
					const next = [...prev];
					[next[index], next[index + 1]] = [next[index + 1], next[index]];
					return next;
				});
			}
			return;
		}

		if (index === divider) {
			setDrawerLayerIndex(divider + 1);
			return;
		}
		if (index > 0) {
			setFloating((prev) => {
				const next = [...prev];
				[next[index - 1], next[index]] = [next[index], next[index - 1]];
				return next;
			});
		}
	}, []);

	// ------------------------------------------------------------------
	// drag-docking: move windows/frames by their toolbars, preview the half
	// they will land in, drop to dock
	// ------------------------------------------------------------------

	const resolveDropTarget = React.useCallback((x: number, y: number, excludeLeafId?: string): DropTarget => {
		const el = document.elementFromPoint(x, y) as HTMLElement | null;
		const leafEl = el?.closest?.('[data-tt-editor-leaf]') as HTMLElement | null;

		if (leafEl) {
			const leafId = leafEl.getAttribute('data-tt-editor-leaf') || '';

			if (!leafId || leafId === excludeLeafId) {
				return null;
			}

			// more than one editor can be mounted at once (the composer's in-post
			// editor + its popout, both fixed-positioned): the element under the
			// pointer may belong to the OTHER instance. Docking there would remove
			// the window from this instance and insert it nowhere — reject foreign
			// leaves so the drag ends harmlessly instead of losing the window.
			const ownLeaf =
				!!findLeaf(layoutRef.current.tree, leafId) ||
				layoutRef.current.floating.some((win) => findLeaf(win.node, leafId));

			if (!ownLeaf) {
				return null;
			}

			const rect = leafEl.getBoundingClientRect();
			const dx = (x - rect.left) / Math.max(rect.width, 1);
			const dy = (y - rect.top) / Math.max(rect.height, 1);
			const edges: [DropSide, number][] = [
				['left', dx],
				['right', 1 - dx],
				['top', dy],
				['bottom', 1 - dy]
			];

			edges.sort((a, b) => a[1] - b[1]);

			return { kind: 'leaf', leafId, side: edges[0][0] };
		}

		// an empty workspace accepts drops directly
		if (!layoutRef.current.tree) {
			const rootRect = rootRef.current?.getBoundingClientRect();

			if (rootRect && x >= rootRect.left && x <= rootRect.right && y >= rootRect.top && y <= rootRect.bottom) {
				return { kind: 'root' };
			}
		}

		return null;
	}, []);

	const moveLeafToTarget = React.useCallback(
		(leafId: string, target: NonNullable<DropTarget>) => {
			const leaf = findLeafEverywhere(leafId);

			if (!leaf) {
				return;
			}

			setTree((prev) => {
				const removed = removeLeaf(prev, leafId);

				return target.kind === 'root' ? leaf : insertAtLeaf(removed, target.leafId, leaf, target.side);
			});
			setFloatingAccountingForDivider((prev) =>
				prev
					.map((win) => ({ ...win, node: removeLeaf(win.node, leafId) }))
					.filter((win): win is FloatingWindow => !!win.node)
			);
			setMaximisedId(null);
		},
		[findLeafEverywhere, setFloatingAccountingForDivider]
	);

	const moveFrameToTarget = React.useCallback((frameId: string, target: NonNullable<DropTarget>) => {
		const frame = layoutRef.current.floating.find((win) => win.id === frameId);

		if (!frame) {
			return;
		}

		setFloatingAccountingForDivider((prev) => prev.filter((win) => win.id !== frameId));
		setMaximisedId(null);
		setTree((prev) => (target.kind === 'root' ? frame.node : insertAtLeaf(prev, target.leafId, frame.node, target.side)));
	}, [setFloatingAccountingForDivider]);

	const windowDragRef = React.useRef<WindowDragState | null>(null);

	const setWindowDragBoth = React.useCallback((next: WindowDragState | null) => {
		windowDragRef.current = next;
		setWindowDrag(next);
	}, []);

	const completeWindowDrag = React.useCallback(() => {
		const drag = windowDragRef.current;
		const target = dropTargetRef.current;

		if (drag && drag.active && drag.docking && target) {
			if (drag.kind === 'docked') {
				moveLeafToTarget(drag.sourceId, target);
			} else {
				moveFrameToTarget(drag.sourceId, target);
			}
		}

		setWindowDragBoth(null);
		setDropTarget(null);
	}, [moveLeafToTarget, moveFrameToTarget, setWindowDragBoth]);

	// docked windows: toolbar drag shows a skeleton ghost + drop previews
	const startWindowDrag = React.useCallback(
		(e: React.PointerEvent, leafId: string, label: string) => {
			e.preventDefault();

			const startX = e.clientX;
			const startY = e.clientY;

			setWindowDragBoth({
				kind: 'docked',
				sourceId: leafId,
				label,
				x: startX,
				y: startY,
				active: false,
				docking: true,
				touch: e.pointerType === 'touch'
			});

			startPointerGesture(
				e,
				(move) => {
					const current = windowDragRef.current;

					if (!current) {
						return;
					}

					const active =
						current.active || Math.hypot(move.clientX - startX, move.clientY - startY) > DRAG_THRESHOLD_PX;

					setWindowDragBoth({ ...current, x: move.clientX, y: move.clientY, active });
					setDropTarget(active ? resolveDropTarget(move.clientX, move.clientY, leafId) : null);
				},
				completeWindowDrag
			);
		},
		[setWindowDragBoth, resolveDropTarget, completeWindowDrag]
	);

	// floating frames: a plain toolbar drag just MOVES the frame; dragging the
	// grip handle (or holding ⌘/Ctrl mid-drag) places it into the layout
	const startFrameDrag = React.useCallback(
		(e: React.PointerEvent, frameId: string, opts?: { dock?: boolean }) => {
			const frame = layoutRef.current.floating.find((win) => win.id === frameId);

			if (!frame) {
				return;
			}

			const dockIntent = !!opts?.dock;
			const touch = e.pointerType === 'touch';
			const startX = e.clientX;
			const startY = e.clientY;
			const origin = { x: frame.x, y: frame.y };
			const initialDocking = dockIntent || e.metaKey || e.ctrlKey;

			setWindowDragBoth({
				kind: 'frame',
				sourceId: frameId,
				label: '',
				x: startX,
				y: startY,
				active: true,
				docking: initialDocking,
				touch
			});
			setDropTarget(initialDocking ? resolveDropTarget(startX, startY) : null);

			// pressing/releasing ⌘/Ctrl toggles docking without pointer movement
			const onModifier = (ev: KeyboardEvent) => {
				if (ev.key !== 'Meta' && ev.key !== 'Control') {
					return;
				}

				const current = windowDragRef.current;

				if (!current || current.kind !== 'frame') {
					return;
				}

				const docking = dockIntent || ev.metaKey || ev.ctrlKey;

				setWindowDragBoth({ ...current, docking });
				setDropTarget(docking ? resolveDropTarget(current.x, current.y) : null);
			};

			window.addEventListener('keydown', onModifier);
			window.addEventListener('keyup', onModifier);

			startPointerGesture(
				e,
				(move) => {
					setFloating((prev) =>
						prev.map((win) =>
							win.id === frameId
								? {
										...win,
										x: Math.max(0, Math.min(origin.x + move.clientX - startX, window.innerWidth - 120)),
										y: Math.max(0, Math.min(origin.y + move.clientY - startY, window.innerHeight - 60))
								  }
								: win
						)
					);

					const docking = dockIntent || move.metaKey || move.ctrlKey;

					setWindowDragBoth({
						kind: 'frame',
						sourceId: frameId,
						label: '',
						x: move.clientX,
						y: move.clientY,
						active: true,
						docking,
						touch
					});
					setDropTarget(docking ? resolveDropTarget(move.clientX, move.clientY) : null);
				},
				() => {
					window.removeEventListener('keydown', onModifier);
					window.removeEventListener('keyup', onModifier);
					completeWindowDrag();
				}
			);
		},
		[setWindowDragBoth, resolveDropTarget, completeWindowDrag]
	);

	// ------------------------------------------------------------------
	// configs
	// ------------------------------------------------------------------

	// write the current layout into a named config (used by save + overwrite)
	const writeConfigNamed = React.useCallback((name: string) => {
		const existing = configsRef.current || {};
		const {
			tree: currentTree,
			floating: currentFloating,
			minimised: currentMinimised,
			maximisedId: currentMaximisedId
		} = layoutRef.current;

		setThingtimeRef.current(
			'settings.editor.configs',
			{
				...existing,
				[name]: {
					tree: currentTree,
					floating: currentFloating,
					minimised: currentMinimised,
					maximisedId: currentMaximisedId,
					drawerLayerIndex: drawerLayerIndexRef.current
				}
			},
			{ namespace: 'editor' }
		);
	}, []);

	const saveConfig = React.useCallback(() => {
		const existing = configsRef.current || {};
		let index = 1;
		let name = 'Layout 1';
		while (Object.hasOwnProperty.call(existing, name) && index <= 999) {
			index++;
			name = `Layout ${index}`;
		}

		writeConfigNamed(name);

		lopu({
			title: `Layout saved 💾`,
			description: `"${name}" — open or manage it from the drawer's Editor section (or edit settings.editor.configs directly).`,
			status: 'success',
			duration: 6000
		});
	}, [writeConfigNamed, lopu]);

	const overwriteConfig = React.useCallback(
		(name: string) => {
			if (!Object.hasOwnProperty.call(configsRef.current || {}, name)) {
				return;
			}

			writeConfigNamed(name);

			lopu({
				title: 'Layout overwritten 💾',
				description: `"${name}" now holds the current window layout.`,
				status: 'success',
				duration: 5000
			});
		},
		[writeConfigNamed, lopu]
	);

	// drawer → editor commands over the shared events bus (the drawer manages
	// the one true /editor — embedded instances stay out of its way)
	React.useEffect(() => {
		if (embedded) {
			return;
		}

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
				case 'overwrite-config':
					overwriteConfig(event.name);
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
	}, [events, restoreById, minimiseById, closeById, saveConfig, overwriteConfig, applyLayout, addWindow, embedded]);

	const actions = React.useMemo<WindowActions>(
		() => ({
			onPatch: patchLeaf,
			onSplit: splitById,
			onClose: closeById,
			onMinimise: minimiseById,
			onMaximise: toggleMaximise,
			onPopOut: popOutById,
			onDockIn: dockInById,
			onLayerMove: moveFrameLayer,
			onStartWindowDrag: startWindowDrag,
			maximisedId
		}),
		[patchLeaf, splitById, closeById, minimiseById, toggleMaximise, popOutById, dockInById, moveFrameLayer, startWindowDrag, maximisedId]
	);

	const onRatio = React.useCallback(
		(id: string, ratio: number) => {
			mapAllTrees((node) => setRatio(node, id, ratio));
		},
		[mapAllTrees]
	);

	const onFloatingGeometry = React.useCallback((id: string, patch: Partial<FloatingWindow>) => {
		setFloating((prev) => prev.map((win) => (win.id === id ? { ...win, ...patch } : win)));
	}, []);

	// maximise applies to docked windows (frame leaves dock via green instead)
	const maximisedLeaf = maximisedId ? findLeaf(tree, maximisedId) : null;

	const draggingDocked = windowDrag?.kind === 'docked' && windowDrag.active;

	return (
		<>
			<Box
				ref={rootRef}
				className="editor-split-root"
				width="100%"
				height={props.height || 'calc(100vh - 92px)'}
				minHeight={props.embedded ? undefined : '440px'}
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				overflow="hidden"
				background="var(--tt-card, #ffffff)"
				position="relative"
			>
				{maximisedLeaf ? (
					<EditorWindow leaf={maximisedLeaf} actions={actions} context="maximised" />
				) : tree ? (
					<EditorNodeView node={tree} actions={actions} onRatio={onRatio} context="main" dropTarget={dropTarget} chromeless={props.embedded ? props.chromeless : undefined} />
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
						{/* whole-root drop preview when dragging over an empty workspace */}
						{dropTarget?.kind === 'root' && (
							<Box position="absolute" inset={0} pointerEvents="none" padding="10px">
								<SkeletonWindow label={windowDrag?.label || undefined} />
							</Box>
						)}
					</Flex>
				)}
			</Box>

			{floating.map((win, index) => (
				<FloatingWindowView
					key={win.id}
					win={win}
					actions={actions}
					onGeometry={onFloatingGeometry}
					onStartFrameDrag={startFrameDrag}
					onRatio={onRatio}
					dragging={windowDrag?.kind === 'frame' && windowDrag.sourceId === win.id}
					zIndex={index < drawerLayerIndex ? FRAME_BELOW_DRAWER_BASE + index : FRAME_ABOVE_DRAWER_BASE + index}
				/>
			))}

			{/* skeleton ghost following the pointer while dragging a docked window */}
			{draggingDocked && (
				<Box
					position="fixed"
					left={`${windowDrag.x + 14}px`}
					top={`${windowDrag.y + 14}px`}
					width="150px"
					height="96px"
					zIndex={DRAG_GHOST_Z_INDEX}
					pointerEvents="none"
				>
					<SkeletonWindow label={windowDrag.label} />
				</Box>
			)}

			{/* hint pill while dragging a floating frame: how to place it into
			the layout, and live feedback once docking is armed */}
			{windowDrag?.kind === 'frame' && windowDrag.active && (
				<Flex
					position="fixed"
					left={`${windowDrag.x + 16}px`}
					top={`${windowDrag.y + 22}px`}
					zIndex={DRAG_GHOST_Z_INDEX}
					pointerEvents="none"
					alignItems="center"
					columnGap="5px"
					paddingX="10px"
					height="24px"
					borderRadius="var(--tt-radius-pill, 999px)"
					background={windowDrag.docking ? 'var(--tt-accent, hotpink)' : 'var(--tt-ink, #16161a)'}
					color={windowDrag.docking ? 'var(--tt-accent-contrast, #ffffff)' : 'var(--tt-card, #ffffff)'}
					fontSize="10.5px"
					fontWeight={600}
					fontFamily="var(--tt-font-mono, monospace)"
					whiteSpace="nowrap"
					boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
					transition="background 0.15s ease"
				>
					{windowDrag.docking ? (
						dropTarget ? (
							'release to place here'
						) : (
							'drag over a window to place'
						)
					) : windowDrag.touch ? (
						// no modifier key on touch — point at the grip handle instead
						<>
							drag the
							<Grip size={11} strokeWidth={2.5} />
							grip to place into the layout
						</>
					) : (
						`hold ${MOD_KEY} to place into the layout`
					)}
				</Flex>
			)}
		</>
	);
};
