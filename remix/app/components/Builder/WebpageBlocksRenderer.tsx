import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { ChakraThingRenderer, isChakraThingNode } from '../Kinds/ChakraThingRenderer';
import type { ChakraThingNode } from '../Kinds/ChakraThingRenderer';
import { HtmlThingRenderer } from '../Kinds/HtmlThingRenderer';
import type { HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { useTtActionClicks } from '../Actions/useTtActionClicks';
import { htmlToNode } from './htmlToNode';
import { InlineRichTextEditor } from './InlineRichTextEditor';
import { RICH_HTML_SX } from './richHtmlStyles';
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
	// right-click (or the chip's ⊞) opens the block context menu at (x, y);
	// wrapOnly jumps straight to the wrap-with drill-down
	onContextMenu?: (id: string, x: number, y: number, wrapOnly?: boolean) => void;
	// OS file drops upload through the attachments API, then land as media
	// blocks at (containerId, index)
	onDropFiles?: (files: File[], containerId: string | null, index: number) => void;
	// files dropped/pasted ONTO a block: media blocks swap src in place,
	// containers take the media inside, others get it inserted right after
	onMediaToBlock?: (blockId: string, files: File[]) => void;
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

// An empty container (or an empty page) renders a tall, unmistakable
// dropwell instead of a slim line — the whole well is tappable and droppable,
// and it can never visually collide with sibling zones outside the container.
const DropWell = ({
	containerId,
	index = 0,
	chrome,
	label,
	compact,
	trailing,
	testIdPrefix
}: {
	containerId: string | null;
	// insert position (grids append via a trailing add-tile cell)
	index?: number;
	chrome: BuilderChrome;
	label?: string;
	// grid add-tile: sized like a modest cell, not a hero well
	compact?: boolean;
	// the root's trailing well: clear air between it and the last block
	trailing?: boolean;
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
			marginTop={trailing ? '28px' : undefined}
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

// Insert affordances as pure OVERLAYS on block edges: they participate in no
// layout, so edit mode is geometrically IDENTICAL to view mode (true
// WYSIWYG). A strip covers the seam before/after a block on its parent's
// axis; hovering (or dragging over) reveals the accent line + pill, clicking
// opens the insert menu at that position, dropping moves blocks / uploads
// files there. Adjacent blocks' strips overlap on the same seam and resolve
// to the same index, so whichever wins the event does the same thing.
const EdgeInsertStrip = ({
	side,
	containerId,
	index,
	chrome,
	testIdPrefix
}: {
	side: 'top' | 'bottom' | 'left' | 'right';
	containerId: string | null;
	index: number;
	chrome: BuilderChrome;
	testIdPrefix?: string;
}) => {
	const [active, setActive] = React.useState(false);
	const coarse = useCoarsePointer();
	const vertical = side === 'left' || side === 'right';
	const rect =
		side === 'top'
			? { top: '-8px', left: 0, right: 0, height: '16px' }
			: side === 'bottom'
				? { bottom: '-8px', left: 0, right: 0, height: '16px' }
				: side === 'left'
					? { left: '-9px', top: 0, bottom: 0, width: '18px' }
					: { right: '-9px', top: 0, bottom: 0, width: '18px' };
	return (
		<Flex
			as="button"
			type="button"
			aria-label="Add a block here"
			className="ttInsertZone"
			data-testid={`insert-${testIdPrefix ? `${testIdPrefix}-` : ''}${containerId ?? 'root'}-${index}${side === 'top' || side === 'left' ? '' : `-${side}`}`}
			position="absolute"
			{...rect}
			zIndex={6}
			alignItems="center"
			justifyContent="center"
			opacity={active ? 1 : coarse ? 0.45 : 0}
			_hover={{ opacity: 1 }}
			transition="opacity 0.1s ease"
			cursor="copy"
			sx={CHROME_TOUCH_SX}
			onClick={(event: React.MouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				chrome.onInsert(containerId, index, event.currentTarget as HTMLElement);
			}}
			onMouseEnter={() => setActive(true)}
			onMouseLeave={() => setActive(false)}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes(DRAG_MIME) || event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect = event.dataTransfer.types.includes(DRAG_MIME) ? 'move' : 'copy';
					setActive(true);
				}
			}}
			onDragLeave={() => setActive(false)}
			onDrop={(event) => {
				setActive(false);
				if (event.defaultPrevented) return;
				const id = event.dataTransfer.getData(DRAG_MIME);
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
			<Box
				position="absolute"
				{...(vertical ? { top: '2px', bottom: '2px', left: '50%', width: '2px' } : { left: '2px', right: '2px', top: '50%', height: '2px' })}
				background="var(--tt-accent, hotpink)"
				opacity={0.55}
				borderRadius="1px"
				pointerEvents="none"
			/>
			<Box
				as="span"
				position="relative"
				pointerEvents="none"
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="11px"
				fontWeight={700}
				lineHeight="1"
				paddingX="6px"
				paddingY="5px"
				borderRadius="var(--tt-radius-pill, 999px)"
				border="1px solid var(--tt-accent, hotpink)"
				background="var(--tt-card, #ffffff)"
				color="var(--tt-accent, hotpink)"
				boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
			>
				+
			</Box>
		</Flex>
	);
};

const alignSelfOf = (block: WebpageBlock): string | undefined =>
	block.align === 'center' ? 'center' : block.align === 'end' ? 'flex-end' : block.align === 'start' ? 'flex-start' : block.align === 'stretch' ? 'stretch' : undefined;

// Align must be VISIBLE: a 100%-wide box centers to nothing, and grid cells
// place on the inline axis with justify-self, not align-self. An aligned
// block therefore shrinks to fit-content (unless stretching) and gets the
// right placement prop for its parent's layout model. Rows keep flex sizing —
// there align works on the cross axis.
const selfPlacement = (block: WebpageBlock, parentDirection: ParentDirection) => {
	const align = block.align;
	const inRow = parentDirection === 'row';
	// fit-content ONLY when no maxWidth: blocks that pair align with a
	// maxWidth were already visibly aligned the old way (100% width capped +
	// auto margins) — shrinking those would re-layout saved pages
	const fit = !inRow && !!align && align !== 'stretch' && !block.maxWidth;
	return {
		width: inRow ? 'auto' : fit ? 'fit-content' : '100%',
		flex: inRow ? '1 1 0%' : undefined,
		minWidth: inRow ? 0 : undefined,
		maxWidth: block.maxWidth ? `${block.maxWidth}px` : fit ? '100%' : undefined,
		alignSelf: alignSelfOf(block),
		justifySelf:
			parentDirection === 'grid' && align
				? align === 'center'
					? 'center'
					: align === 'end'
						? 'end'
						: align === 'stretch'
							? 'stretch'
							: 'start'
				: undefined,
		marginX: block.align === 'center' ? 'auto' : undefined
	} as const;
};

type ParentDirection = 'column' | 'row' | 'grid';

const BlockFrame = ({
	block,
	chrome,
	locked,
	parentDirection = 'column',
	containerId = null,
	indexInParent = 0,
	testIdPrefix,
	children
}: {
	block: WebpageBlock;
	chrome: BuilderChrome;
	locked?: boolean;
	parentDirection?: ParentDirection;
	// where this block lives — powers the overlay insert strips and grid-cell
	// drop targets without any layout participation
	containerId?: string | null;
	indexInParent?: number;
	testIdPrefix?: string;
	children: React.ReactNode;
}) => {
	const hovered = chrome.hoverId === block.id;
	const selected = chrome.selectedId === block.id;
	const [dropTarget, setDropTarget] = React.useState(false);
	const tone = locked ? 'var(--tt-muted, #9a9aa6)' : 'var(--tt-accent, hotpink)';
	// EVERY frame is a file-drop target (media blocks swap their src, others
	// receive the upload via onMediaToBlock) — otherwise the browser opens the
	// dropped file. Grid cells additionally accept block drags (insert-before),
	// since grids have no between-cell zones. Innermost frame wins via
	// stopPropagation.
	const acceptsBlockDrag = parentDirection === 'grid';
	// locked frames (live native app screens) keep their hands off drops —
	// the app inside owns them (e.g. the post composer's own file drop zone);
	// unclaimed drops there fall through to the window guard
	const dropProps = locked
		? {}
		: {
				onDragOver: (event: React.DragEvent) => {
					if (event.defaultPrevented) return;
					const hasFiles = event.dataTransfer.types.includes('Files');
					const hasBlock = acceptsBlockDrag && event.dataTransfer.types.includes(DRAG_MIME);
					if (hasFiles || hasBlock) {
						event.preventDefault();
						event.stopPropagation();
						event.dataTransfer.dropEffect = hasBlock ? 'move' : 'copy';
						setDropTarget(true);
					}
				},
				onDragLeave: () => setDropTarget(false),
				onDrop: (event: React.DragEvent) => {
					setDropTarget(false);
					// a nested handler (composer drop zone, an inner frame) already
					// claimed this drop
					if (event.defaultPrevented) return;
					const id = event.dataTransfer.getData(DRAG_MIME);
					if (id && id !== block.id && acceptsBlockDrag) {
						event.preventDefault();
						event.stopPropagation();
						chrome.onMove(id, containerId, indexInParent);
						return;
					}
					const files = Array.from(event.dataTransfer.files || []);
					if (files.length && chrome.onMediaToBlock) {
						event.preventDefault();
						event.stopPropagation();
						chrome.onMediaToBlock(block.id, files);
					}
				}
		  };
	return (
		<Box
			{...dropProps}
			className="ttBlockFrame"
			data-block-id={block.id}
			position="relative"
			{...selfPlacement(block, parentDirection)}
			style={cssRecordToStyle(block.css)}
			onContextMenu={
				chrome.onContextMenu && !locked
					? (event: React.MouseEvent) => {
							const target = event.target as HTMLElement;
							// native context menus stay native inside editors/inputs
							if (target.closest?.('.codex-editor, input, textarea, [contenteditable="true"]')) return;
							if (target.closest?.('[data-block-id]') !== event.currentTarget) return;
							event.preventDefault();
							event.stopPropagation();
							chrome.onSelect(block.id, event.currentTarget as HTMLElement);
							chrome.onContextMenu?.(block.id, event.clientX, event.clientY);
					  }
					: undefined
			}
			outline={
				dropTarget
					? `2px dashed ${tone}`
					: selected
						? `2px solid ${tone}`
						: hovered
							? `1px dashed ${tone}`
							: '1px dashed transparent'
			}
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
				if (
					target.closest?.(
						'.ttInsertZone, .ttDropWell, .ttInlineTextEditor, .ttInlineRichTextEditor, .codex-editor, .ce-toolbar, .ce-popover, .ttWysiwygToolbar, .ttArgEditPopover, .ttBlockContextMenu'
					)
				)
					return;
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
					{!locked && chrome.onContextMenu ? (
						<Box
							as="button"
							type="button"
							aria-label="Wrap this block"
							title="Wrap with a block (row / column / grid)"
							data-testid={`wrap-block-${block.id}`}
							marginLeft="2px"
							fontSize="12px"
							lineHeight="1"
							opacity={0.85}
							_hover={{ opacity: 1, transform: 'scale(1.15)' }}
							cursor="pointer"
							onClick={(event: React.MouseEvent) => {
								event.preventDefault();
								event.stopPropagation();
								const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
								chrome.onSelect(block.id, event.currentTarget as HTMLElement);
								chrome.onContextMenu?.(block.id, rect.left, rect.bottom + 6, true);
							}}
						>
							⊞
						</Box>
					) : null}
				</Flex>
			)}
			{children}
			{/* overlay insert strips on the parent-axis seams — zero layout
			    impact, so the edit canvas is pixel-identical to view mode */}
			<EdgeInsertStrip
				side={parentDirection === 'column' ? 'top' : 'left'}
				containerId={containerId}
				index={indexInParent}
				chrome={chrome}
				testIdPrefix={testIdPrefix}
			/>
			<EdgeInsertStrip
				side={parentDirection === 'column' ? 'bottom' : 'right'}
				containerId={containerId}
				index={indexInParent + 1}
				chrome={chrome}
				testIdPrefix={testIdPrefix}
			/>
		</Box>
	);
};

// Sanitised rich markup, parsed once per html string and drawn with a real
// document typography scale (Chakra's reset would otherwise render headings
// at body size — the "Editor.js heading doesn't render" bug).
const RichHtmlView = React.memo(function RichHtmlView({
	html,
	as,
	typo,
	fallback
}: {
	html: string;
	as?: string;
	typo?: Record<string, unknown>;
	fallback?: React.ReactNode;
}) {
	const node = React.useMemo(() => htmlToNode(html), [html]);
	if (!node) return <>{fallback ?? null}</>;
	return (
		<Box as={(as || 'div') as any} {...(typo as any)} sx={RICH_HTML_SX}>
			<HtmlThingRenderer node={node} />
		</Box>
	);
});

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
	interactive,
	chrome
}: {
	block: WebpageBlock;
	component: ComponentThingLike | null;
	interactive: boolean;
	chrome?: BuilderChrome | null;
}) => {
	const onTtAction = useTtActionClicks();
	const crystal = component?.crystal;
	const specs = React.useMemo(() => sanitizeArgSpecs(crystal?.args), [crystal?.args]);
	const valuesKey = JSON.stringify({ s: crystal?.savedArgs, b: block.args });
	const argValues = React.useMemo(
		() => ({
			...defaultsFromArgs(specs),
			...(crystal?.savedArgs && typeof crystal.savedArgs === 'object' ? crystal.savedArgs : {}),
			...(block.args || {})
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- valuesKey is the serialised form of savedArgs+block.args
		[specs, valuesKey]
	);
	const resolved = React.useMemo(() => {
		if (!crystal?.render) return null;
		return resolveTemplate(crystal.render, argValues);
	}, [crystal?.render, argValues]);

	// Inline text editing INSIDE components: double-click a piece of rendered
	// text and, when it matches a string/text arg's current value verbatim, a
	// small in-place editor patches that arg — every text a component shows
	// stays clickable-editable, not just text blocks.
	const [argEdit, setArgEdit] = React.useState<{ name: string; value: string; left: number; top: number; width: number } | null>(null);
	const commitArgEdit = React.useCallback(() => {
		setArgEdit((current) => {
			if (current && chrome?.onUpdate) {
				const args = { ...(block.args || {}) };
				args[current.name] = current.value;
				chrome.onUpdate(block.id, { args });
			}
			return null;
		});
	}, [block.args, block.id, chrome]);
	const handleDoubleClick = chrome
		? (event: React.MouseEvent) => {
				const target = event.target as HTMLElement;
				const text = (target.textContent || '').trim();
				if (!text || text.length > 400) return;
				const spec = specs.find(
					(candidate) =>
						(candidate.type === 'string' || candidate.type === 'text' || !candidate.type) &&
						String(argValues[candidate.name] ?? '').trim() === text
				);
				if (!spec) return;
				event.preventDefault();
				event.stopPropagation();
				const rect = target.getBoundingClientRect();
				setArgEdit({
					name: spec.name,
					value: String(argValues[spec.name] ?? ''),
					left: Math.min(rect.left, Math.max(8, window.innerWidth - 260)),
					top: rect.bottom + 6,
					width: Math.max(220, Math.min(420, rect.width))
				});
		  }
		: undefined;

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
		<Box onClickCapture={interactive ? onTtAction : undefined} onDoubleClickCapture={handleDoubleClick} width="100%">
			{isChakraThingNode(resolved) ? (
				<ChakraThingRenderer node={resolved as ChakraThingNode} />
			) : (
				<HtmlThingRenderer node={resolved as HtmlThingNode} />
			)}
			{argEdit ? (
				<Box
					className="ttArgEditPopover"
					position="fixed"
					left={`${argEdit.left}px`}
					top={`${argEdit.top}px`}
					width={`${argEdit.width}px`}
					zIndex={10200}
					padding="6px"
					borderRadius="var(--tt-radius-md, 12px)"
					border="1px solid"
					borderColor="var(--tt-border, #ececef)"
					background="var(--tt-card, #ffffff)"
					boxShadow="var(--tt-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.12))"
				>
					<Box
						as="input"
						// eslint-disable-next-line jsx-a11y/no-autofocus -- the popover exists to type into
						autoFocus
						width="100%"
						fontSize="13px"
						padding="6px 8px"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-sm, 9px)"
						data-testid="component-arg-inline-input"
						value={argEdit.value}
						onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
							setArgEdit((current) => (current ? { ...current, value: event.target.value } : current))
						}
						onKeyDown={(event: React.KeyboardEvent) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								commitArgEdit();
							}
							if (event.key === 'Escape') {
								event.preventDefault();
								setArgEdit(null);
							}
						}}
						onBlur={commitArgEdit}
						onClick={(event: React.MouseEvent) => event.stopPropagation()}
					/>
				</Box>
			) : null}
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
	props: WebpageBlocksRendererProps & {
		block: WebpageBlock;
		isRoot?: boolean;
		parentDirection?: ParentDirection;
		containerId?: string | null;
		indexInParent?: number;
	}
) => {
	const {
		block,
		componentsByRef,
		interactive,
		renderNative,
		chrome,
		insetNonNative,
		isRoot,
		parentDirection = 'column',
		containerId = null,
		indexInParent = 0
	} = props;

	let body: React.ReactNode = null;
	if (block.type === 'text') {
		const { as: defaultAs, ...typo } = TEXT_STYLES[block.style || 'body'] as Record<string, unknown> & { as?: string };
		const asTag = block.tag || defaultAs || 'p';
		if (chrome && chrome.selectedId === block.id && chrome.onUpdate) {
			// selected text edits IN PLACE with the FULL Editor.js editor —
			// headings, lists, quotes, tables, inline formatting, right there on
			// the canvas (the drawer's modal remains the "advanced" surface)
			body = <InlineRichTextEditor html={block.html} text={block.text} onChange={(patch) => chrome.onUpdate?.(block.id, patch)} />;
		} else if (block.html) {
			// rich text renders as a styled flow container (never inside a <p> —
			// pasted markup may hold block elements)
			body = <RichHtmlView html={block.html} as={block.tag || 'div'} typo={typo} fallback={block.text} />;
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
					🖼 {block.media || 'media'} — drop a file here, paste (⌘/Ctrl+V), or upload / set a URL in the inspector
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
		body = block.html ? (
			<RichHtmlView html={block.html} />
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
		body = (
			<ComponentBlockView
				block={block}
				component={componentsByRef[block.component || ''] ?? null}
				interactive={!!interactive}
				chrome={chrome}
			/>
		);
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
		return (
			<Box {...selfPlacement(block, parentDirection)} style={cssRecordToStyle(block.css)}>
				{body}
			</Box>
		);
	}
	return (
		<BlockFrame
			block={block}
			chrome={chrome}
			locked={block.type === 'native'}
			parentDirection={parentDirection}
			containerId={containerId}
			indexInParent={indexInParent}
			testIdPrefix={props.testIdPrefix}
		>
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
	// TRUE WYSIWYG: blocks render exactly as view mode lays them out — insert
	// affordances live on each frame as overlay edge strips (BlockFrame), so
	// no chrome element ever participates in layout. Only the root keeps a
	// trailing "+ add block" line BELOW the content (it shifts nothing above).
	return (
		<>
			{blocks.map((block, index) => (
				<BlockView
					key={block.id}
					{...props}
					block={block}
					isRoot={isRoot}
					parentDirection={parentDirection}
					containerId={containerId}
					indexInParent={index}
				/>
			))}
			{isRoot ? (
				<DropWell
					containerId={null}
					index={blocks.length}
					chrome={chrome}
					label="Add a block"
					trailing
					testIdPrefix={props.testIdPrefix}
				/>
			) : null}
		</>
	);
};

export const WebpageBlocksRenderer = (props: WebpageBlocksRendererProps) => {
	if (props.bare && !props.chrome) return <BlockList {...props} containerId={null} />;
	// identical root spacing in both modes — WYSIWYG includes the gaps
	return (
		<Flex flexDirection="column" width="100%" rowGap={4}>
			<BlockList {...props} containerId={null} />
		</Flex>
	);
};
