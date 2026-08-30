import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { ChakraThingRenderer, isChakraThingNode } from '../Kinds/ChakraThingRenderer';
import type { ChakraThingNode } from '../Kinds/ChakraThingRenderer';
import { HtmlThingRenderer } from '../Kinds/HtmlThingRenderer';
import type { HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { useTtActionClicks } from '../Actions/useTtActionClicks';
import { blockLabel, type WebpageBlock } from './webpageBlocks';

// Draws a webpage block tree. Component blocks resolve their referenced
// component thing's template through the existing arg DSL and draw ONLY
// through the sanitising allowlist renderers — one renderer instance (and
// therefore one 600-node budget) per block, which is what makes pages safe at
// page scale without touching the component caps. When builder `chrome` is
// present every block gets a hover/select boundary frame, inline "+ add
// block" insert zones appear between siblings, and frames become drag
// sources/targets — the render path itself is identical in both modes, so
// what you edit is exactly what viewers see.

export type ComponentThingLike = {
	id: string;
	crystal: Record<string, any>;
};

export type ComponentsByRef = Record<string, ComponentThingLike | null>;

// Build the ref → component map from a /api/v1/webpages/resolve response.
export const buildComponentsByRef = (payload: {
	components?: Array<ComponentThingLike>;
	refs?: Record<string, string | null>;
}): ComponentsByRef => {
	const byId = new Map<string, ComponentThingLike>();
	for (const component of payload.components || []) byId.set(component.id, component);
	const out: ComponentsByRef = {};
	for (const [ref, id] of Object.entries(payload.refs || {})) {
		out[ref] = (id && byId.get(id)) || null;
	}
	return out;
};

export type BuilderChrome = {
	hoverId: string | null;
	selectedId: string | null;
	onHover: (id: string | null) => void;
	onSelect: (id: string, element: HTMLElement) => void;
	// open the inline "+ add new block" menu for (containerId, index)
	onInsert: (containerId: string | null, index: number, anchor: HTMLElement) => void;
	// drag/drop reorder — move block `id` to (containerId, index)
	onMove: (id: string, containerId: string | null, index: number) => void;
};

const DRAG_MIME = 'application/x-tt-block-id';

// Builder chrome must never behave like page text: no long-press selection,
// no iOS callout, no tap highlight, and taps fire immediately.
const CHROME_TOUCH_SX = {
	userSelect: 'none',
	WebkitUserSelect: 'none',
	WebkitTouchCallout: 'none',
	WebkitTapHighlightColor: 'transparent',
	touchAction: 'manipulation'
} as const;

// Touch devices have no hover — every affordance stays visible there.
const useCoarsePointer = (): boolean => {
	const [coarse, setCoarse] = React.useState(() => {
		try {
			return window.matchMedia('(pointer: coarse)').matches;
		} catch {
			return false;
		}
	});
	React.useEffect(() => {
		try {
			const media = window.matchMedia('(pointer: coarse)');
			const onChange = () => setCoarse(media.matches);
			media.addEventListener('change', onChange);
			return () => media.removeEventListener('change', onChange);
		} catch {
			return undefined;
		}
	}, []);
	return coarse;
};

// A slim insert line between siblings — the WHOLE strip is the tap target
// (44px when visible), the pill is just the label.
const InsertZone = ({
	containerId,
	index,
	chrome,
	alwaysVisible
}: {
	containerId: string | null;
	index: number;
	chrome: BuilderChrome;
	// empty containers and the end of the root list keep their zone visible —
	// a canvas must never look like there is nothing to do
	alwaysVisible?: boolean;
}) => {
	const [active, setActive] = React.useState(false);
	const coarse = useCoarsePointer();
	const visible = active || alwaysVisible || coarse;
	return (
		<Flex
			as="button"
			type="button"
			aria-label="Add a block here"
			className="ttInsertZone"
			data-testid={`insert-${containerId ?? 'root'}-${index}`}
			alignItems="center"
			justifyContent="center"
			width="100%"
			height={visible ? '44px' : '18px'}
			marginY="3px"
			opacity={active ? 1 : visible ? 0.8 : 0}
			_hover={{ opacity: 1 }}
			transition="opacity 0.12s ease, height 0.12s ease"
			position="relative"
			zIndex={5}
			cursor="pointer"
			sx={CHROME_TOUCH_SX}
			onClick={(event: React.MouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				chrome.onInsert(containerId, index, event.currentTarget as HTMLElement);
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes(DRAG_MIME)) {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'move';
					setActive(true);
				}
			}}
			onDragLeave={() => setActive(false)}
			onDrop={(event) => {
				const id = event.dataTransfer.getData(DRAG_MIME);
				setActive(false);
				if (id) {
					event.preventDefault();
					event.stopPropagation();
					chrome.onMove(id, containerId, index);
				}
			}}
		>
			<Box position="absolute" left={0} right={0} top="50%" height="2px" background="var(--tt-accent, hotpink)" opacity={0.3} borderRadius="1px" pointerEvents="none" />
			<Box
				as="span"
				position="relative"
				pointerEvents="none"
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="12px"
				fontWeight={700}
				lineHeight="1"
				paddingX="14px"
				paddingY="8px"
				borderRadius="var(--tt-radius-pill, 999px)"
				border="1px solid"
				borderColor="var(--tt-accent, hotpink)"
				background="var(--tt-card, #ffffff)"
				color="var(--tt-accent, hotpink)"
				boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
			>
				+ add block
			</Box>
		</Flex>
	);
};

// An empty container (or an empty page) renders a tall, unmistakable
// dropwell instead of a slim line — the whole well is tappable and droppable,
// and it can never visually collide with sibling zones outside the container.
const DropWell = ({
	containerId,
	chrome,
	label
}: {
	containerId: string | null;
	chrome: BuilderChrome;
	label?: string;
}) => {
	const [active, setActive] = React.useState(false);
	return (
		<Flex
			as="button"
			type="button"
			aria-label="Add the first block"
			className="ttDropWell"
			data-testid={`dropwell-${containerId ?? 'root'}`}
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			rowGap="6px"
			width="100%"
			minHeight="96px"
			marginY="6px"
			border="2px dashed"
			borderColor={active ? 'var(--tt-accent, hotpink)' : 'var(--tt-border, #ececef)'}
			borderRadius="var(--tt-radius-lg, 16px)"
			background={active ? 'var(--tt-accent-tint, #fff5fa)' : 'var(--tt-surface, #fafafb)'}
			cursor="pointer"
			transition="border-color 0.12s ease, background 0.12s ease"
			sx={CHROME_TOUCH_SX}
			_hover={{ borderColor: 'var(--tt-accent, hotpink)', background: 'var(--tt-accent-tint, #fff5fa)' }}
			onClick={(event: React.MouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				chrome.onInsert(containerId, 0, event.currentTarget as HTMLElement);
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes(DRAG_MIME)) {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'move';
					setActive(true);
				}
			}}
			onDragLeave={() => setActive(false)}
			onDrop={(event) => {
				const id = event.dataTransfer.getData(DRAG_MIME);
				setActive(false);
				if (id) {
					event.preventDefault();
					event.stopPropagation();
					chrome.onMove(id, containerId, 0);
				}
			}}
		>
			<Box as="span" fontSize="20px" lineHeight="1" pointerEvents="none">
				＋
			</Box>
			<Box
				as="span"
				pointerEvents="none"
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="12px"
				fontWeight={700}
				letterSpacing="0.04em"
				color="var(--tt-accent, hotpink)"
			>
				{label || 'Add a block'}
			</Box>
		</Flex>
	);
};

const alignSelfOf = (block: WebpageBlock): string | undefined =>
	block.align === 'center' ? 'center' : block.align === 'end' ? 'flex-end' : block.align === 'start' ? 'flex-start' : block.align === 'stretch' ? 'stretch' : undefined;

const BlockFrame = ({
	block,
	chrome,
	locked,
	children
}: {
	block: WebpageBlock;
	chrome: BuilderChrome;
	locked?: boolean;
	children: React.ReactNode;
}) => {
	const hovered = chrome.hoverId === block.id;
	const selected = chrome.selectedId === block.id;
	const tone = locked ? 'var(--tt-muted, #9a9aa6)' : 'var(--tt-accent, hotpink)';
	return (
		<Box
			className="ttBlockFrame"
			data-block-id={block.id}
			position="relative"
			width="100%"
			alignSelf={alignSelfOf(block)}
			maxWidth={block.maxWidth ? `${block.maxWidth}px` : undefined}
			marginX={block.align === 'center' && block.maxWidth ? 'auto' : undefined}
			outline={selected ? `2px solid ${tone}` : hovered ? `1px dashed ${tone}` : '1px dashed transparent'}
			outlineOffset="2px"
			borderRadius="var(--tt-radius-xs, 7px)"
			cursor="pointer"
			onMouseEnter={(event) => {
				event.stopPropagation();
				chrome.onHover(block.id);
			}}
			onMouseLeave={() => chrome.onHover(null)}
			onMouseOver={(event) => {
				// nested frames: the innermost hovered frame wins the highlight
				event.stopPropagation();
				if (chrome.hoverId !== block.id) chrome.onHover(block.id);
			}}
			onClickCapture={(event) => {
				// chrome controls nested inside this frame (insert zones, dropwells)
				// own their clicks — capturing them would select the container
				// instead of opening the menu
				if ((event.target as HTMLElement).closest?.('.ttInsertZone, .ttDropWell')) return;
				event.preventDefault();
				event.stopPropagation();
				chrome.onSelect(block.id, event.currentTarget as HTMLElement);
			}}
		>
			{(hovered || selected) && (
				<Flex
					position="absolute"
					top="-14px"
					left="6px"
					zIndex={6}
					alignItems="center"
					columnGap="6px"
					fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
					fontSize="11px"
					fontWeight={700}
					lineHeight="1"
					textTransform="uppercase"
					letterSpacing="0.06em"
					paddingX="10px"
					paddingY="7px"
					borderRadius="var(--tt-radius-pill, 999px)"
					background={tone}
					color="var(--tt-accent-contrast, #ffffff)"
					boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
					pointerEvents={locked ? 'none' : 'auto'}
					draggable={!locked}
					sx={CHROME_TOUCH_SX}
					onDragStart={(event) => {
						event.stopPropagation();
						event.dataTransfer.setData(DRAG_MIME, block.id);
						event.dataTransfer.effectAllowed = 'move';
					}}
					cursor={locked ? 'default' : 'grab'}
					title={locked ? 'Native app screen — this block is locked' : 'Drag to move this block'}
				>
					{locked ? '🔒' : '⠿'} {blockLabel(block)}
				</Flex>
			)}
			{children}
		</Box>
	);
};

const TEXT_STYLES: Record<string, Record<string, unknown>> = {
	heading: {
		as: 'h2',
		fontFamily: 'var(--tt-font-heading, system-ui, sans-serif)',
		fontSize: '2xl',
		fontWeight: 800,
		letterSpacing: '-0.02em',
		color: 'var(--tt-ink, #16161a)'
	},
	eyebrow: {
		fontFamily: 'var(--tt-font-mono, ui-monospace, monospace)',
		fontSize: '11px',
		fontWeight: 700,
		letterSpacing: '0.14em',
		textTransform: 'uppercase',
		color: 'var(--tt-muted, #9a9aa6)'
	},
	body: {
		fontFamily: 'var(--tt-font-body, system-ui, sans-serif)',
		fontSize: 'md',
		lineHeight: '1.65',
		color: 'var(--tt-text, #5a5a66)'
	}
};

const ComponentBlockView = ({
	block,
	component,
	interactive
}: {
	block: WebpageBlock;
	component: ComponentThingLike | null;
	interactive: boolean;
}) => {
	const onTtAction = useTtActionClicks();
	const crystal = component?.crystal;
	const specs = React.useMemo(() => sanitizeArgSpecs(crystal?.args), [crystal?.args]);
	const valuesKey = JSON.stringify({ s: crystal?.savedArgs, b: block.args });
	const resolved = React.useMemo(() => {
		if (!crystal?.render) return null;
		const values = {
			...defaultsFromArgs(specs),
			...(crystal.savedArgs && typeof crystal.savedArgs === 'object' ? crystal.savedArgs : {}),
			...(block.args || {})
		};
		return resolveTemplate(crystal.render, values);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- valuesKey is the serialised form of savedArgs+block.args
	}, [crystal?.render, specs, valuesKey]);

	if (!component || !crystal?.render) {
		return (
			<Flex
				alignItems="center"
				columnGap={2}
				border="1px dashed var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				padding={4}
				color="var(--tt-muted, #9a9aa6)"
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="12px"
			>
				🧩 {block.component || 'component'} — not found or not visible to you
			</Flex>
		);
	}

	return (
		<Box onClickCapture={interactive ? onTtAction : undefined} width="100%">
			{isChakraThingNode(resolved) ? (
				<ChakraThingRenderer node={resolved as ChakraThingNode} />
			) : (
				<HtmlThingRenderer node={resolved as HtmlThingNode} />
			)}
		</Box>
	);
};

export type WebpageBlocksRendererProps = {
	blocks: WebpageBlock[];
	componentsByRef: ComponentsByRef;
	// wire ttAction clicks (owner-viewing surfaces only — the PreviewModal
	// trust rule: interactive for the page owner, inert for everyone else)
	interactive?: boolean;
	// how native blocks render (site pages pass the app screen; builders pass
	// a placeholder; /p/ pages omit → native blocks render nothing)
	renderNative?: (key: string, block: WebpageBlock) => React.ReactNode;
	chrome?: BuilderChrome | null;
	// full-bleed surfaces (the in-place site editor): root-level non-native
	// blocks center at this readable width while native screens span full
	insetNonNative?: number;
};

const BlockView = (props: WebpageBlocksRendererProps & { block: WebpageBlock; isRoot?: boolean }) => {
	const { block, componentsByRef, interactive, renderNative, chrome, insetNonNative, isRoot } = props;

	let body: React.ReactNode = null;
	if (block.type === 'text') {
		body = <Text {...(TEXT_STYLES[block.style || 'body'] as any)}>{block.text}</Text>;
	} else if (block.type === 'component') {
		body = <ComponentBlockView block={block} component={componentsByRef[block.component || ''] ?? null} interactive={!!interactive} />;
	} else if (block.type === 'native') {
		body = renderNative ? renderNative(block.native || '', block) : null;
		if (!body && chrome) {
			body = (
				<Flex
					alignItems="center"
					columnGap={2}
					border="1px dashed var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					padding={6}
					justifyContent="center"
					color="var(--tt-muted, #9a9aa6)"
					fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
					fontSize="12px"
				>
					🖥 native screen · {block.native} (renders on its site page)
				</Flex>
			);
		}
	} else if (block.type === 'container') {
		const children = <BlockList {...props} blocks={block.children || []} containerId={block.id} />;
		if (block.direction === 'grid') {
			body = (
				<Grid templateColumns={`repeat(${block.columns || 2}, minmax(0, 1fr))`} gap={block.gap ?? 4} width="100%">
					{children}
				</Grid>
			);
		} else {
			body = (
				<Flex
					flexDirection={block.direction === 'row' ? 'row' : 'column'}
					flexWrap={block.direction === 'row' ? 'wrap' : undefined}
					alignItems={block.align === 'center' ? 'center' : undefined}
					justifyContent={block.direction === 'row' && block.align === 'center' ? 'center' : undefined}
					gap={block.gap ?? 4}
					width="100%"
				>
					{children}
				</Flex>
			);
		}
	}

	// full-bleed surfaces: root-level authored blocks center at a readable
	// width while the native screen keeps the whole viewport
	if (insetNonNative && isRoot && block.type !== 'native') {
		body = (
			<Box width="100%" maxWidth={`${insetNonNative}px`} marginX="auto" paddingX={4}>
				{body}
			</Box>
		);
	}

	if (!chrome) {
		return (
			<Box
				width="100%"
				alignSelf={alignSelfOf(block)}
				maxWidth={block.maxWidth ? `${block.maxWidth}px` : undefined}
				marginX={block.align === 'center' && block.maxWidth ? 'auto' : undefined}
			>
				{body}
			</Box>
		);
	}
	return (
		<BlockFrame block={block} chrome={chrome} locked={block.type === 'native'}>
			{body}
		</BlockFrame>
	);
};

const BlockList = (props: WebpageBlocksRendererProps & { containerId: string | null }) => {
	const { blocks, chrome, containerId } = props;
	const isRoot = containerId === null;
	if (!chrome) {
		return (
			<>
				{blocks.map((block) => (
					<BlockView key={block.id} {...props} block={block} isRoot={isRoot} />
				))}
			</>
		);
	}
	// an empty list renders one tall dropwell (never a slim line that could
	// collide with sibling zones); the end of the root list keeps its zone
	// visible so a page always invites another block
	if (blocks.length === 0) {
		return <DropWell containerId={containerId} chrome={chrome} label={isRoot ? 'Add your first block' : 'Add a block inside'} />;
	}
	const zones: React.ReactNode[] = [<InsertZone key="zone-0" containerId={containerId} index={0} chrome={chrome} />];
	blocks.forEach((block, index) => {
		zones.push(<BlockView key={block.id} {...props} block={block} isRoot={isRoot} />);
		zones.push(
			<InsertZone
				key={`zone-${index + 1}`}
				containerId={containerId}
				index={index + 1}
				chrome={chrome}
				alwaysVisible={isRoot && index === blocks.length - 1}
			/>
		);
	});
	return <>{zones}</>;
};

export const WebpageBlocksRenderer = (props: WebpageBlocksRendererProps) => (
	<Flex flexDirection="column" width="100%" rowGap={props.chrome ? 0 : 4}>
		<BlockList {...props} containerId={null} />
	</Flex>
);
