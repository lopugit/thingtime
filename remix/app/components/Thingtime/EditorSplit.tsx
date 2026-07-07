import React from 'react';
import { Box, Flex, Input } from '@chakra-ui/react';
import { Columns2, Eye, Paintbrush, PictureInPicture, PictureInPicture2, Rows2 } from 'lucide-react';

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
// minimise / maximise), pop out into floating frames (which are themselves
// sub-splittable trees, draggable, resizable, and dockable back in), and
// scroll independently. Dragging any window toolbar moves the window: docked
// windows show a skeleton ghost, and hovering another window previews the
// half it will dock into (left/right/top/bottom) before dropping.
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
};

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;
const FLOATING_Z_INDEX = 1250;
const DRAG_GHOST_Z_INDEX = 1350;
const DRAG_THRESHOLD_PX = 6;

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

type WindowContext = 'main' | 'frame' | 'maximised';

type WindowActions = {
	onPatch: (id: string, patch: Partial<EditorLeaf>) => void;
	onSplit: (id: string, direction: 'row' | 'column') => void;
	onClose: (id: string) => void;
	onMinimise: (id: string) => void;
	onMaximise: (id: string) => void;
	onPopOut: (id: string) => void;
	onDockIn: (id: string) => void;
	onStartWindowDrag: (e: React.PointerEvent, leafId: string, label: string) => void;
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
			<Box width="8px" height="8px" borderRadius="2.5px" background="var(--tt-rainbow-1, #f34a4a)" />
			<Box width="8px" height="8px" borderRadius="2.5px" background="var(--tt-rainbow-2, #ffbc48)" />
			<Box width="8px" height="8px" borderRadius="2.5px" background="var(--tt-rainbow-3, #58ca70)" />
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

const EditorWindow = (props: { leaf: EditorLeaf; actions: WindowActions; context: WindowContext; dropSide?: DropSide | null }) => {
	const { leaf, actions, context } = props;
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
	const inFrame = context === 'frame';

	const onToolbarPointerDown = React.useCallback(
		(e: React.PointerEvent) => {
			// frames delegate toolbar drags to the frame itself
			if (context !== 'main') {
				return;
			}

			if ((e.target as HTMLElement)?.closest?.('button, input, [contenteditable]')) {
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
			{/* window toolbar: traffic lights + path + content mode + controls.
			The empty middle is the drag handle for moving the window. */}
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
}) => {
	const { node, actions, onRatio, context, dropTarget } = props;

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

		return <EditorWindow leaf={node} actions={actions} context={context} dropSide={dropSide} />;
	}

	const isRow = node.direction === 'row';

	return (
		<Flex flexDirection={isRow ? 'row' : 'column'} width="100%" height="100%" minWidth={0} minHeight={0}>
			<Box flex={node.ratio} minWidth={0} minHeight={0} overflow="hidden">
				<EditorNodeView node={node.a} actions={actions} onRatio={onRatio} context={context} dropTarget={dropTarget} />
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
				<EditorNodeView node={node.b} actions={actions} onRatio={onRatio} context={context} dropTarget={dropTarget} />
			</Box>
		</Flex>
	);
};

// floating (popped-out) frames ----------------------------------------------

const FloatingWindowView = (props: {
	win: FloatingWindow;
	actions: WindowActions;
	onGeometry: (id: string, patch: Partial<FloatingWindow>) => void;
	onStartFrameDrag: (e: React.PointerEvent, frameId: string) => void;
	onRatio: (id: string, ratio: number) => void;
	dragging: boolean;
}) => {
	const { win, actions, onGeometry, onStartFrameDrag, onRatio, dragging } = props;

	const onFramePointerDown = React.useCallback(
		(e: React.PointerEvent) => {
			// any toolbar inside the frame drags the whole frame (controls stay usable)
			const target = e.target as HTMLElement | null;

			if (!target?.closest?.('.editor-window-toolbar')) {
				return;
			}
			if (target?.closest?.('button, input, [contenteditable]')) {
				return;
			}

			e.preventDefault();
			onStartFrameDrag(e, win.id);
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
			zIndex={FLOATING_Z_INDEX}
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

	// window drag-docking state (ghost + skeleton drop previews)
	const [windowDrag, setWindowDrag] = React.useState<WindowDragState | null>(null);
	const [dropTarget, setDropTarget] = React.useState<DropTarget>(null);

	const rootRef = React.useRef<HTMLDivElement | null>(null);

	// refs so gesture/event handlers never act on stale state
	const layoutRef = React.useRef({ tree, floating, minimised });

	React.useEffect(() => {
		layoutRef.current = { tree, floating, minimised };
	}, [tree, floating, minimised]);

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
		setTree(sanitizeNodeData(layout.tree));
		setFloating((Array.isArray(layout.floating) ? layout.floating : []).map(sanitizeFloatingData).filter(Boolean) as FloatingWindow[]);
		setMinimised((Array.isArray(layout.minimised) ? layout.minimised : []).map(sanitizeLeafData).filter(Boolean) as EditorLeaf[]);
		setMaximisedId(null);
	}, []);

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
	// window operations (shared by toolbars, drags, and drawer commands)
	// ------------------------------------------------------------------

	// apply a tree transform to the main tree and every floating frame;
	// frames whose tree empties out are removed
	const mapAllTrees = React.useCallback((fn: (node: EditorNode | null) => EditorNode | null) => {
		setTree((prev) => fn(prev));
		setFloating((prev) =>
			prev
				.map((win) => ({ ...win, node: fn(win.node) }))
				.filter((win): win is FloatingWindow => !!win.node)
		);
	}, []);

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

			setFloating((prev) =>
				prev
					.map((win) => ({ ...win, node: removeLeaf(win.node, id) }))
					.filter((win): win is FloatingWindow => !!win.node)
			);
			dockLeaf(leaf);
		},
		[dockLeaf]
	);

	const toggleMaximise = React.useCallback((id: string) => {
		setMaximisedId((prev) => (prev === id ? null : id));
	}, []);

	const addWindow = React.useCallback(() => {
		dockLeaf(makeLeaf(props.initialPath, true));
	}, [dockLeaf, props.initialPath]);

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
			setFloating((prev) =>
				prev
					.map((win) => ({ ...win, node: removeLeaf(win.node, leafId) }))
					.filter((win): win is FloatingWindow => !!win.node)
			);
			setMaximisedId(null);
		},
		[findLeafEverywhere]
	);

	const moveFrameToTarget = React.useCallback((frameId: string, target: NonNullable<DropTarget>) => {
		const frame = layoutRef.current.floating.find((win) => win.id === frameId);

		if (!frame) {
			return;
		}

		setFloating((prev) => prev.filter((win) => win.id !== frameId));
		setMaximisedId(null);
		setTree((prev) => (target.kind === 'root' ? frame.node : insertAtLeaf(prev, target.leafId, frame.node, target.side)));
	}, []);

	const windowDragRef = React.useRef<WindowDragState | null>(null);

	const setWindowDragBoth = React.useCallback((next: WindowDragState | null) => {
		windowDragRef.current = next;
		setWindowDrag(next);
	}, []);

	const completeWindowDrag = React.useCallback(() => {
		const drag = windowDragRef.current;
		const target = dropTargetRef.current;

		if (drag && drag.active && target) {
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

			setWindowDragBoth({ kind: 'docked', sourceId: leafId, label, x: startX, y: startY, active: false });

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

	// floating frames: the frame follows the pointer and can dock on drop
	const startFrameDrag = React.useCallback(
		(e: React.PointerEvent, frameId: string) => {
			const frame = layoutRef.current.floating.find((win) => win.id === frameId);

			if (!frame) {
				return;
			}

			const startX = e.clientX;
			const startY = e.clientY;
			const origin = { x: frame.x, y: frame.y };

			setWindowDragBoth({ kind: 'frame', sourceId: frameId, label: '', x: startX, y: startY, active: true });

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
					setWindowDragBoth({ kind: 'frame', sourceId: frameId, label: '', x: move.clientX, y: move.clientY, active: true });
					setDropTarget(resolveDropTarget(move.clientX, move.clientY));
				},
				completeWindowDrag
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
		const { tree: currentTree, floating: currentFloating, minimised: currentMinimised } = layoutRef.current;

		setThingtimeRef.current(
			'settings.editor.configs',
			{ ...existing, [name]: { tree: currentTree, floating: currentFloating, minimised: currentMinimised } },
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
	}, [events, restoreById, minimiseById, closeById, saveConfig, overwriteConfig, applyLayout, addWindow]);

	const actions = React.useMemo<WindowActions>(
		() => ({
			onPatch: patchLeaf,
			onSplit: splitById,
			onClose: closeById,
			onMinimise: minimiseById,
			onMaximise: toggleMaximise,
			onPopOut: popOutById,
			onDockIn: dockInById,
			onStartWindowDrag: startWindowDrag,
			maximisedId
		}),
		[patchLeaf, splitById, closeById, minimiseById, toggleMaximise, popOutById, dockInById, startWindowDrag, maximisedId]
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
				height="calc(100vh - 92px)"
				minHeight="440px"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				overflow="hidden"
				background="var(--tt-card, #ffffff)"
				position="relative"
			>
				{maximisedLeaf ? (
					<EditorWindow leaf={maximisedLeaf} actions={actions} context="maximised" />
				) : tree ? (
					<EditorNodeView node={tree} actions={actions} onRatio={onRatio} context="main" dropTarget={dropTarget} />
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

			{floating.map((win) => (
				<FloatingWindowView
					key={win.id}
					win={win}
					actions={actions}
					onGeometry={onFloatingGeometry}
					onStartFrameDrag={startFrameDrag}
					onRatio={onRatio}
					dragging={windowDrag?.kind === 'frame' && windowDrag.sourceId === win.id}
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
		</>
	);
};
