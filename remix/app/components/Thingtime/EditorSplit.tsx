import React from 'react';
import { Box, Flex, Input } from '@chakra-ui/react';
import { Columns2, Eye, Paintbrush, Rows2, X } from 'lucide-react';

import { Thingtime } from './Thingtime';
import { useThingtime } from './useThingtime';

// Editor mode: an infinitely sub-splittable window system.
//
// The layout is a binary tree — every window (leaf) can split horizontally
// (side by side) or vertically (stacked), any divider drags to resize, every
// window closes back into its sibling, and each window carries its own thing
// path + view/edit mode. Windows scroll independently (no synced scrolling).

type EditorLeaf = {
	id: string;
	kind: 'leaf';
	path: string;
	edit: boolean;
};

type EditorBranch = {
	id: string;
	kind: 'split';
	// 'row' = windows side by side, 'column' = stacked
	direction: 'row' | 'column';
	// share of the first child, 0..1
	ratio: number;
	a: EditorNode;
	b: EditorNode;
};

type EditorNode = EditorLeaf | EditorBranch;

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;

const uid = () => Math.random().toString(36).slice(2, 9);

const makeLeaf = (path: string, edit: boolean): EditorLeaf => ({ id: uid(), kind: 'leaf', path, edit });

// immutable tree ops -------------------------------------------------------

const updateLeaf = (node: EditorNode, id: string, patch: Partial<EditorLeaf>): EditorNode => {
	if (node.kind === 'leaf') {
		return node.id === id ? { ...node, ...patch } : node;
	}

	return { ...node, a: updateLeaf(node.a, id, patch), b: updateLeaf(node.b, id, patch) };
};

const splitLeaf = (node: EditorNode, id: string, direction: 'row' | 'column'): EditorNode => {
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
			b: makeLeaf(node.path, node.edit)
		};
	}

	return { ...node, a: splitLeaf(node.a, id, direction), b: splitLeaf(node.b, id, direction) };
};

const removeLeaf = (node: EditorNode, id: string): EditorNode => {
	if (node.kind === 'leaf') {
		return node;
	}

	if (node.a.kind === 'leaf' && node.a.id === id) {
		return node.b;
	}
	if (node.b.kind === 'leaf' && node.b.id === id) {
		return node.a;
	}

	return { ...node, a: removeLeaf(node.a, id), b: removeLeaf(node.b, id) };
};

const setRatio = (node: EditorNode, id: string, ratio: number): EditorNode => {
	if (node.kind === 'leaf') {
		return node;
	}

	if (node.id === id) {
		return { ...node, ratio };
	}

	return { ...node, a: setRatio(node.a, id, ratio), b: setRatio(node.b, id, ratio) };
};

const countLeaves = (node: EditorNode): number => {
	return node.kind === 'leaf' ? 1 : countLeaves(node.a) + countLeaves(node.b);
};

// window chrome ------------------------------------------------------------

type WindowActions = {
	onPatch: (id: string, patch: Partial<EditorLeaf>) => void;
	onSplit: (id: string, direction: 'row' | 'column') => void;
	onClose: (id: string) => void;
	canClose: boolean;
};

const toolbarButtonStyles = {
	alignItems: 'center',
	justifyContent: 'center',
	width: '24px',
	height: '24px',
	borderRadius: 'var(--tt-radius-xs, 7px)',
	color: 'var(--tt-muted, #9a9aa6)',
	cursor: 'pointer',
	transition: 'background 0.15s ease, color 0.15s ease',
	_hover: { background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' }
} as const;

const EditorWindow = (props: { leaf: EditorLeaf; actions: WindowActions }) => {
	const { leaf, actions } = props;
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
			{/* window toolbar: path + mode + split/close controls */}
			<Flex
				className="editor-window-toolbar"
				alignItems="center"
				columnGap="4px"
				flexShrink={0}
				paddingX="8px"
				paddingY="4px"
				borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
				background="var(--tt-surface, #fafafb)"
			>
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
				<Flex
					{...toolbarButtonStyles}
					flexShrink={0}
					color={leaf.edit ? 'var(--tt-accent, hotpink)' : 'var(--tt-muted, #9a9aa6)'}
					title={leaf.edit ? 'Editing — switch to view' : 'Viewing — switch to edit'}
					onClick={() => actions.onPatch(leaf.id, { edit: !leaf.edit })}
				>
					{leaf.edit ? <Paintbrush size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
				</Flex>
				<Flex
					{...toolbarButtonStyles}
					flexShrink={0}
					title="Split horizontally (side by side)"
					onClick={() => actions.onSplit(leaf.id, 'row')}
				>
					<Columns2 size={13} strokeWidth={2} />
				</Flex>
				<Flex
					{...toolbarButtonStyles}
					flexShrink={0}
					title="Split vertically (stacked)"
					onClick={() => actions.onSplit(leaf.id, 'column')}
				>
					<Rows2 size={13} strokeWidth={2} />
				</Flex>
				{actions.canClose && (
					<Flex {...toolbarButtonStyles} flexShrink={0} title="Close window" onClick={() => actions.onClose(leaf.id)}>
						<X size={13} strokeWidth={2} />
					</Flex>
				)}
			</Flex>

			{/* window body: its own scroll context (no synced scrolling) */}
			<Box flex="1" minHeight={0} overflow="auto" paddingX="18px" paddingY="16px">
				<Thingtime
					key={`${leaf.id}:${leaf.path}`}
					path={leaf.path}
					thing={thing}
					edit={leaf.edit}
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

			const pointerId = e.pointerId;

			const handleMove = (move: PointerEvent) => {
				if (move.pointerId !== pointerId) {
					return;
				}

				const rect = container.getBoundingClientRect();
				const raw =
					branch.direction === 'row'
						? (move.clientX - rect.left) / Math.max(rect.width, 1)
						: (move.clientY - rect.top) / Math.max(rect.height, 1);

				onRatio(branch.id, Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw)));
			};

			const teardown = () => {
				window.removeEventListener('pointermove', handleMove);
				window.removeEventListener('pointerup', stop);
				window.removeEventListener('pointercancel', stop);
				window.removeEventListener('blur', teardown);
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

// root ----------------------------------------------------------------------

export const EditorSplit = (props: { initialPath: string }) => {
	// default layout: rendered view beside an editable view of the same thing
	const [tree, setTree] = React.useState<EditorNode>(() => ({
		id: uid(),
		kind: 'split',
		direction: 'row',
		ratio: 0.5,
		a: makeLeaf(props.initialPath, false),
		b: makeLeaf(props.initialPath, true)
	}));

	const leafCount = countLeaves(tree);

	const actions = React.useMemo<WindowActions>(
		() => ({
			onPatch: (id, patch) => setTree((prev) => updateLeaf(prev, id, patch)),
			onSplit: (id, direction) => setTree((prev) => splitLeaf(prev, id, direction)),
			onClose: (id) => setTree((prev) => removeLeaf(prev, id)),
			canClose: leafCount > 1
		}),
		[leafCount]
	);

	const onRatio = React.useCallback((id: string, ratio: number) => {
		setTree((prev) => setRatio(prev, id, ratio));
	}, []);

	return (
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
			<EditorNodeView node={tree} actions={actions} onRatio={onRatio} />
		</Box>
	);
};
