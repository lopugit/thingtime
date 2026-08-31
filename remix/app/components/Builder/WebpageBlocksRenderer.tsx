import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { ChakraThingRenderer, isChakraThingNode } from '../Kinds/ChakraThingRenderer';
import type { ChakraThingNode } from '../Kinds/ChakraThingRenderer';
import { HtmlThingRenderer } from '../Kinds/HtmlThingRenderer';
import type { HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { useTtActionClicks } from '../Actions/useTtActionClicks';
import { htmlToNode } from './htmlToNode';
import { InlineTextEditor } from './InlineTextEditor';
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
	// inline edits (WYSIWYG text, media src) patch the block draft in place
	onUpdate?: (id: string, patch: Partial<WebpageBlock>) => void;
	// OS file drops upload through the attachments API, then land as media
	// blocks at (containerId, index)
	onDropFiles?: (files: File[], containerId: string | null, index: number) => void;
};

// Figma-style custom css record → React inline style (kebab → camel, custom
// properties pass through). Values were bounded by the server gate.
export const cssRecordToStyle = (css?: Record<string, string>): React.CSSProperties | undefined => {
	if (!css) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(css)) {
		if (!value || typeof value !== 'string') continue;
		out[key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = value;
	}
	return Object.keys(out).length ? (out as React.CSSProperties) : undefined;
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
// (44px when visible), the pill is just the label. Inside row containers the
// zone turns vertical (a slim upright strip between side-by-side blocks) so
// it never forces siblings onto separate lines.
const InsertZone = ({
	containerId,
	index,
	chrome,
	alwaysVisible,
	orientation = 'horizontal',
	testIdPrefix
}: {
	containerId: string | null;
	index: number;
	chrome: BuilderChrome;
	// empty containers and the end of the root list keep their zone visible —
	// a canvas must never look like there is nothing to do
	alwaysVisible?: boolean;
	orientation?: 'horizontal' | 'vertical';
	testIdPrefix?: string;
}) => {
	const [active, setActive] = React.useState(false);
	const coarse = useCoarsePointer();
	const visible = active || alwaysVisible || coarse;
	const vertical = orientation === 'vertical';
	return (
		<Flex
			as="button"
			type="button"
			aria-label="Add a block here"
			className="ttInsertZone"
			data-testid={`insert-${testIdPrefix ? `${testIdPrefix}-` : ''}${containerId ?? 'root'}-${index}`}
			alignItems="center"
			justifyContent="center"
			width={vertical ? (visible ? '28px' : '14px') : '100%'}
			height={vertical ? 'auto' : visible ? '44px' : '18px'}
			alignSelf={vertical ? 'stretch' : undefined}
			minHeight={vertical ? '44px' : undefined}
			flex={vertical ? '0 0 auto' : undefined}
			marginY={vertical ? 0 : '3px'}
			marginX={vertical ? '1px' : 0}
			opacity={active ? 1 : visible ? 0.8 : 0}
			_hover={{ opacity: 1 }}
			transition="opacity 0.12s ease, height 0.12s ease, width 0.12s ease"
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
				if (event.dataTransfer.types.includes(DRAG_MIME) || event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					event.dataTransfer.dropEffect = event.dataTransfer.types.includes(DRAG_MIME) ? 'move' : 'copy';
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
					return;
				}
				const files = Array.from(event.dataTransfer.files || []);
				if (files.length && chrome.onDropFiles) {
					event.preventDefault();
					event.stopPropagation();
					chrome.onDropFiles(files, containerId, index);
				}
			}}
		>
			{vertical ? (
				<Box position="absolute" top={0} bottom={0} left="50%" width="2px" background="var(--tt-accent, hotpink)" opacity={0.3} borderRadius="1px" pointerEvents="none" />
			) : (
				<Box position="absolute" left={0} right={0} top="50%" height="2px" background="var(--tt-accent, hotpink)" opacity={0.3} borderRadius="1px" pointerEvents="none" />
			)}
			<Box
				as="span"
				position="relative"
				pointerEvents="none"
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="12px"
				fontWeight={700}
				lineHeight="1"
				paddingX={vertical ? '6px' : '14px'}
				paddingY={vertical ? '6px' : '8px'}
				borderRadius="var(--tt-radius-pill, 999px)"
				border="1px solid"
				borderColor="var(--tt-accent, hotpink)"
				background="var(--tt-card, #ffffff)"
				color="var(--tt-accent, hotpink)"
				boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
			>
				{vertical ? '+' : '+ add block'}
			</Box>
		</Flex>
	);
};

// An empty container (or an empty page) renders a tall, unmistakable
// dropwell instead of a slim line — the whole well is tappable and droppable,
// and it can never visually collide with sibling zones outside the container.
const DropWell = ({
	containerId,
	index = 0,
	chrome,
	label,
	compact,
	testIdPrefix
}: {
	containerId: string | null;
	// insert position (grids append via a trailing add-tile cell)
	index?: number;
	chrome: BuilderChrome;
	label?: string;
	// grid add-tile: sized like a modest cell, not a hero well
	compact?: boolean;
	testIdPrefix?: string;
}) => {
	const [active, setActive] = React.useState(false);
	return (
		<Flex
			as="button"
			type="button"
			aria-label="Add the first block"
			className="ttDropWell"
			data-testid={`dropwell-${testIdPrefix ? `${testIdPrefix}-` : ''}${containerId ?? 'root'}${index ? `-${index}` : ''}`}
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			rowGap="6px"
			width="100%"
			minHeight={compact ? '56px' : '96px'}
			marginY={compact ? 0 : '6px'}
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
				chrome.onInsert(containerId, index, event.currentTarget as HTMLElement);
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes(DRAG_MIME) || event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					event.dataTransfer.dropEffect = event.dataTransfer.types.includes(DRAG_MIME) ? 'move' : 'copy';
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
					return;
				}
				const files = Array.from(event.dataTransfer.files || []);
				if (files.length && chrome.onDropFiles) {
					event.preventDefault();
					event.stopPropagation();
					chrome.onDropFiles(files, containerId, index);
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

type ParentDirection = 'column' | 'row' | 'grid';

const BlockFrame = ({
	block,
	chrome,
	locked,
	parentDirection = 'column',
	children
}: {
	block: WebpageBlock;
	chrome: BuilderChrome;
	locked?: boolean;
	parentDirection?: ParentDirection;
	children: React.ReactNode;
}) => {
	const hovered = chrome.hoverId === block.id;
	const selected = chrome.selectedId === block.id;
	const tone = locked ? 'var(--tt-muted, #9a9aa6)' : 'var(--tt-accent, hotpink)';
	const inRow = parentDirection === 'row';
	return (
		<Box
			className="ttBlockFrame"
			data-block-id={block.id}
			position="relative"
			// row children share the line (grow evenly, never force 100% width);
			// column children and grid cells fill their track
			width={inRow ? 'auto' : '100%'}
			flex={inRow ? '1 1 0%' : undefined}
			minWidth={inRow ? 0 : undefined}
			alignSelf={alignSelfOf(block)}
			maxWidth={block.maxWidth ? `${block.maxWidth}px` : undefined}
			marginX={block.align === 'center' && block.maxWidth ? 'auto' : undefined}
			style={cssRecordToStyle(block.css)}
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
				const target = event.target as HTMLElement;
				if (target.closest?.('.ttInsertZone, .ttDropWell, .ttInlineTextEditor, .ttWysiwygToolbar')) return;
				// nested frames: capture runs OUTERMOST-first, so an ancestor frame
				// sees the click before the frame that was actually clicked. Only
				// the innermost frame containing the click may handle it — anyone
				// else lets the event keep capturing down.
				const innermost = target.closest?.('[data-block-id]');
				if (innermost && innermost !== event.currentTarget) return;
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
	// distinguishes co-mounted renderers' zone test ids (e.g. 'global'/'page')
	testIdPrefix?: string;
	// view-mode compositions inside page-owned shells: render the block list
	// WITHOUT the root column Flex so the shell's own layout (centering, gap)
	// applies to sections exactly as it does on the route render
	bare?: boolean;
};

const BlockView = (
	props: WebpageBlocksRendererProps & { block: WebpageBlock; isRoot?: boolean; parentDirection?: ParentDirection }
) => {
	const { block, componentsByRef, interactive, renderNative, chrome, insetNonNative, isRoot, parentDirection = 'column' } = props;

	let body: React.ReactNode = null;
	if (block.type === 'text') {
		const { as: defaultAs, ...typo } = TEXT_STYLES[block.style || 'body'] as Record<string, unknown> & { as?: string };
		const asTag = block.tag || defaultAs || 'p';
		if (chrome && chrome.selectedId === block.id && chrome.onUpdate) {
			// selected text edits IN PLACE — WYSIWYG, caret and all. The editor
			// element is ALWAYS a div: flipping the rendered tag mid-edit would
			// swap the DOM node under the mount-only init effect and eat the text.
			body = (
				<InlineTextEditor
					html={block.html}
					text={block.text}
					typography={typo}
					onChange={(patch) => chrome.onUpdate?.(block.id, patch)}
				/>
			);
		} else if (block.html) {
			const node = htmlToNode(block.html);
			// rich text renders as a styled flow container (never inside a <p> —
			// pasted markup may hold block elements)
			body = (
				<Box as={block.tag || 'div'} {...(typo as any)}>
					{node ? <HtmlThingRenderer node={node} /> : block.text}
				</Box>
			);
		} else {
			body = (
				<Text as={asTag as any} {...(typo as any)}>
					{block.text}
				</Text>
			);
		}
	} else if (block.type === 'media') {
		const src = block.src || '';
		if (!src) {
			body = (
				<Flex
					alignItems="center"
					justifyContent="center"
					columnGap={2}
					border="1px dashed var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					padding={6}
					color="var(--tt-muted, #9a9aa6)"
					fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
					fontSize="12px"
				>
					🖼 {block.media || 'media'} — set a source in the inspector or drop a file here
				</Flex>
			);
		} else if (block.media === 'video') {
			body = <Box as="video" src={src} controls maxWidth="100%" borderRadius="var(--tt-radius-md, 12px)" />;
		} else if (block.media === 'audio') {
			body = <Box as="audio" src={src} controls width="100%" />;
		} else {
			body = <Box as="img" src={src} alt={block.alt || ''} maxWidth="100%" borderRadius="var(--tt-radius-md, 12px)" />;
		}
	} else if (block.type === 'html') {
		const node = htmlToNode(block.html || '');
		body = node ? (
			<HtmlThingRenderer node={node} />
		) : (
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
				{'</>'} empty html block — write markup in the inspector
			</Flex>
		);
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
		const children = (
			<BlockList {...props} blocks={block.children || []} containerId={block.id} parentDirection={block.direction || 'column'} />
		);
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
		// native sections render BARE in view mode — a full-width wrapper would
		// defeat page-owned shells that center their children (e.g. /welcome)
		if (block.type === 'native') return <>{body}</>;
		const inRow = parentDirection === 'row';
		return (
			<Box
				width={inRow ? 'auto' : '100%'}
				flex={inRow ? '1 1 0%' : undefined}
				minWidth={inRow ? 0 : undefined}
				alignSelf={alignSelfOf(block)}
				maxWidth={block.maxWidth ? `${block.maxWidth}px` : undefined}
				marginX={block.align === 'center' && block.maxWidth ? 'auto' : undefined}
				style={cssRecordToStyle(block.css)}
			>
				{body}
			</Box>
		);
	}
	return (
		<BlockFrame block={block} chrome={chrome} locked={block.type === 'native'} parentDirection={parentDirection}>
			{body}
		</BlockFrame>
	);
};

const BlockList = (
	props: WebpageBlocksRendererProps & { containerId: string | null; parentDirection?: ParentDirection }
) => {
	const { blocks, chrome, containerId, parentDirection = 'column' } = props;
	const isRoot = containerId === null;
	if (!chrome) {
		return (
			<>
				{blocks.map((block) => (
					<BlockView key={block.id} {...props} block={block} isRoot={isRoot} parentDirection={parentDirection} />
				))}
			</>
		);
	}
	// an empty list renders one tall dropwell (never a slim line that could
	// collide with sibling zones); the end of the root list keeps its zone
	// visible so a page always invites another block
	if (blocks.length === 0) {
		const well = (
			<DropWell
				containerId={containerId}
				chrome={chrome}
				label={isRoot ? 'Add your first block' : 'Add a block inside'}
				testIdPrefix={props.testIdPrefix}
			/>
		);
		// in a grid the well must span every column, not sit in cell 1
		return parentDirection === 'grid' ? <Box gridColumn="1 / -1">{well}</Box> : well;
	}
	if (parentDirection === 'grid') {
		// grid children are CELLS — interleaved zones would occupy cells and
		// shove real blocks into the wrong columns. Blocks flow in order and a
		// trailing add-tile occupies the next free cell (click to insert, drop
		// to move-to-end); reorder via drag onto the tile or inspector arrows.
		return (
			<>
				{blocks.map((block) => (
					<BlockView key={block.id} {...props} block={block} isRoot={isRoot} parentDirection="grid" />
				))}
				<DropWell
					containerId={containerId}
					index={blocks.length}
					chrome={chrome}
					label="add"
					compact
					testIdPrefix={props.testIdPrefix}
				/>
			</>
		);
	}
	const vertical = parentDirection === 'row';
	const zones: React.ReactNode[] = [
		<InsertZone key="zone-0" containerId={containerId} index={0} chrome={chrome} orientation={vertical ? 'vertical' : 'horizontal'} testIdPrefix={props.testIdPrefix} />
	];
	blocks.forEach((block, index) => {
		zones.push(<BlockView key={block.id} {...props} block={block} isRoot={isRoot} parentDirection={parentDirection} />);
		zones.push(
			<InsertZone
				key={`zone-${index + 1}`}
				containerId={containerId}
				index={index + 1}
				chrome={chrome}
				orientation={vertical ? 'vertical' : 'horizontal'}
				alwaysVisible={isRoot && index === blocks.length - 1}
				testIdPrefix={props.testIdPrefix}
			/>
		);
	});
	return <>{zones}</>;
};

export const WebpageBlocksRenderer = (props: WebpageBlocksRendererProps) => {
	if (props.bare && !props.chrome) return <BlockList {...props} containerId={null} />;
	return (
		<Flex flexDirection="column" width="100%" rowGap={props.chrome ? 0 : 4}>
			<BlockList {...props} containerId={null} />
		</Flex>
	);
};
