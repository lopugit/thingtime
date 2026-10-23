import React from 'react';
import { Box, Flex, Switch, Text } from '@chakra-ui/react';

import { getEditorJsDoc } from '~/components/Editor/editorJsValue';
import { LongTextEditor } from '~/components/Editor/LongTextEditor';
import type { LongTextBlockTypes } from '~/components/Editor/LongTextEditor';
import { RichTextBlocks } from '~/components/Kinds/kindRenderersMedia';
import { MagicInput } from '~/components/MagicInput/MagicInput';
import { NumberValueInput } from '~/components/Thingtime/Thingtime';
import { RenderThing, resolveKindRenderer } from '~/components/Kinds';

import { thingTypeOf } from './conceptData';
import type { ThingPath } from './conceptData';

// Small shared pieces used by every nested-data-viewer concept
// (components/Thingtime/concepts/*Viewer.tsx).

export type ConceptViewerProps = {
	thing: unknown;
	onThingChange?: (next: unknown) => void;
	// edit mode: leaves become editable, add/delete affordances appear
	edit?: boolean;
	// force a layout; 'auto' measures the container width
	variant?: 'auto' | 'desktop' | 'mobile';
};

// container-driven responsiveness: concepts react to the space they're given
// (a docs device frame, a drawer, a feed card), not the viewport
export const useContainerWidth = <T extends HTMLElement>(): [React.RefObject<T>, number] => {
	const ref = React.useRef<T>(null);
	const [width, setWidth] = React.useState(0);

	React.useEffect(() => {
		const node = ref.current;
		if (!node) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(node);
		setWidth(node.getBoundingClientRect().width);

		return () => observer.disconnect();
	}, []);

	return [ref, width];
};

export const useConceptLayout = (variant: 'auto' | 'desktop' | 'mobile' | undefined, width: number, breakpoint = 560) => {
	if (variant === 'desktop') return 'desktop';
	if (variant === 'mobile') return 'mobile';
	// until measured, assume desktop; ResizeObserver corrects on first frame
	return width > 0 && width < breakpoint ? 'mobile' : 'desktop';
};

// The shared leaf value editor — the same editors the live tree uses:
// MagicInput for strings, the − / + stepper for numbers, Switch for booleans.
export const LeafValueEditor = (props: {
	value: unknown;
	edit?: boolean;
	onValueChange?: (value: unknown) => void;
	fontSize?: string;
	// forwarded to LongTextEditor: enable/disable block tools per field
	blockTypes?: LongTextBlockTypes;
}) => {
	const { value, edit, onValueChange } = props;
	const editorJsDoc = getEditorJsDoc(value);
	const type = thingTypeOf(value);

	if (editorJsDoc) {
		return edit ? (
			<LongTextEditor value={editorJsDoc} blockTypes={props.blockTypes} onValueChange={(next) => onValueChange?.(next)} />
		) : (
			<Box width="100%" minWidth={0} paddingY={1}>
				<RichTextBlocks blocks={editorJsDoc.blocks} />
			</Box>
		);
	}

	if (type === 'boolean') {
		return (
			<Flex alignItems="center" columnGap={2}>
				<Switch
					isChecked={Boolean(value)}
					isReadOnly={!edit}
					onChange={() => edit && onValueChange?.(!value)}
					size="md"
				/>
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
					{value ? 'Yes' : 'No'}
				</Text>
			</Flex>
		);
	}

	if (type === 'number') {
		if (!edit) {
			return (
				<Text color="var(--tt-ink, #16161a)" fontSize={props.fontSize || 'md'}>
					{String(value)}
				</Text>
			);
		}
		return <NumberValueInput value={value as number} onValueChange={(next) => onValueChange?.(next)} />;
	}

	if (type === 'string') {
		return (
			<MagicInput
				value={value as string}
				readonly={!edit}
				placeholder="Imagine.."
				onValueChange={({ value: next }) => onValueChange?.(next)}
				chakras={{ fontSize: props.fontSize || 'md', color: 'var(--tt-ink, #16161a)' }}
			/>
		);
	}

	return (
		<Text color="var(--tt-faint, #b6b6c0)" fontSize={props.fontSize || 'md'}>
			Imagine..
		</Text>
	);
};

// Breadcrumb chips shared by the drill-down style concepts
export const ConceptCrumbs = (props: {
	path: ThingPath;
	rootLabel?: string;
	onNavigate: (path: ThingPath) => void;
}) => {
	const { path, onNavigate } = props;
	const crumbs = [{ label: props.rootLabel || '🏡 Home', path: [] as ThingPath }].concat(
		path.map((segment, idx) => ({
			label: typeof segment === 'number' ? `#${segment + 1}` : String(segment),
			path: path.slice(0, idx + 1)
		}))
	);

	return (
		<Flex alignItems="center" columnGap={1} flexWrap="wrap" rowGap={1}>
			{crumbs.map((crumb, idx) => {
				const isLast = idx === crumbs.length - 1;

				return (
					<React.Fragment key={idx}>
						{idx > 0 ? (
							<Text color="var(--tt-faint, #b6b6c0)" fontSize="xs">
								›
							</Text>
						) : null}
						<Box
							as="button"
							type="button"
							background={isLast ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-alt, #f5f5f7)'}
							borderRadius="999px"
							color={isLast ? 'var(--tt-card, #ffffff)' : 'var(--tt-text, #5a5a66)'}
							cursor={isLast ? 'default' : 'pointer'}
							fontSize="12px"
							fontWeight={700}
							maxWidth="160px"
							overflow="hidden"
							paddingX="10px"
							paddingY="3px"
							textOverflow="ellipsis"
							whiteSpace="nowrap"
							onClick={() => !isLast && onNavigate(crumb.path)}
							_hover={isLast ? {} : { background: 'var(--tt-surface-hover, #ececee)' }}
						>
							{crumb.label}
						</Box>
					</React.Fragment>
				);
			})}
		</Flex>
	);
};

// "✨ Rendered / 🔍 Data" flip — when a subtree carries a kind, concepts show
// the kind renderer with a flip back to the raw structure.
export const KindFlip = (props: { thing: unknown; children: React.ReactNode; defaultRendered?: boolean }) => {
	const renderer = resolveKindRenderer(props.thing);
	const [showRendered, setShowRendered] = React.useState(props.defaultRendered ?? true);

	if (!renderer) return <>{props.children}</>;

	return (
		<Box width="100%">
			<Flex justifyContent="flex-end" marginBottom={2}>
				<Flex
					background="var(--tt-surface-alt, #f5f5f7)"
					borderRadius="999px"
					columnGap={0}
					padding="2px"
				>
					{[
						{ key: true, label: `✨ ${renderer.title}` },
						{ key: false, label: '🔍 Data' }
					].map((option) => (
						<Box
							key={String(option.key)}
							as="button"
							type="button"
							background={showRendered === option.key ? 'var(--tt-card, #ffffff)' : 'transparent'}
							borderRadius="999px"
							boxShadow={showRendered === option.key ? 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.08))' : 'none'}
							color={showRendered === option.key ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
							cursor="pointer"
							fontSize="11px"
							fontWeight={700}
							paddingX="10px"
							paddingY="3px"
							whiteSpace="nowrap"
							onClick={() => setShowRendered(option.key)}
						>
							{option.label}
						</Box>
					))}
				</Flex>
			</Flex>
			{showRendered ? <RenderThing thing={props.thing} context={{ size: 'card' }} /> : props.children}
		</Box>
	);
};

// Dashed "grow a new thing" button (the seedling affordance of the live tree)
export const AddChildButton = (props: { onClick: () => void; label?: string }) => (
	<Box
		as="button"
		type="button"
		border="1px dashed var(--tt-faint, #b6b6c0)"
		borderRadius="var(--tt-radius-sm, 9px)"
		background="transparent"
		color="var(--tt-muted, #9a9aa6)"
		cursor="pointer"
		fontSize="12.5px"
		fontWeight={600}
		paddingX="11px"
		paddingY="5px"
		transition="all 150ms ease"
		width="fit-content"
		onClick={props.onClick}
		_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)', color: 'var(--tt-ink, #16161a)' }}
	>
		🌱 {props.label || 'Grow something new'}
	</Box>
);

export const DeleteButton = (props: { onClick: () => void }) => (
	<Box
		as="button"
		type="button"
		aria-label="Recycle"
		title="Recycle"
		background="transparent"
		border="none"
		borderRadius="var(--tt-radius-xs, 7px)"
		color="var(--tt-faint, #b6b6c0)"
		cursor="pointer"
		fontSize="13px"
		lineHeight={1}
		padding="4px"
		onClick={(e) => {
			e.stopPropagation();
			props.onClick();
		}}
		_hover={{ color: 'var(--tt-danger, #d6455a)' }}
	>
		🗑️
	</Box>
);
