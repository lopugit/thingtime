import React from 'react';
import { Box, Button, Flex, Grid } from '@chakra-ui/react';

const BORDER = '1px solid var(--tt-border, #ececef)';

export type MediaGalleryGridProps = {
	children: React.ReactNode;
	ariaLabel: string;
	templateColumns?: React.ComponentProps<typeof Grid>['templateColumns'];
};

export const MediaGalleryGrid = ({ children, ariaLabel, templateColumns }: MediaGalleryGridProps) => (
	<Grid
		as="ul"
		aria-label={ariaLabel}
		listStyleType="none"
		margin={0}
		padding={0}
		templateColumns={templateColumns ?? { base: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }}
		gap={2}
	>
		{children}
	</Grid>
);

export type MediaGalleryTileProps = {
	ariaLabel: string;
	preview: React.ReactNode;
	action?: React.ReactNode;
	overlay?: React.ReactNode;
	children?: React.ReactNode;
	invalid?: boolean;
	aspectRatio?: React.ComponentProps<typeof Box>['aspectRatio'];
	// reorder support: data attributes land here; the dragged tile dims and the
	// hovered drop position outlines so the pending order reads clearly
	dragging?: boolean;
	dropTarget?: boolean;
	containerProps?: React.ComponentProps<typeof Flex>;
};

export const MediaGalleryTile = (props: MediaGalleryTileProps) => (
	<Flex
		as="li"
		aria-label={props.ariaLabel}
		flexDirection="column"
		minWidth={0}
		border={props.invalid ? '1px solid var(--tt-danger, #e5484d)' : BORDER}
		borderRadius="var(--tt-radius-md, 12px)"
		overflow="hidden"
		background="var(--tt-card, #ffffff)"
		opacity={props.dragging ? 0.55 : undefined}
		outline={props.dropTarget ? '2px solid var(--tt-accent, #7c5cff)' : undefined}
		outlineOffset={props.dropTarget ? '1px' : undefined}
		{...props.containerProps}
	>
		<Box position="relative" width="100%" aspectRatio={props.aspectRatio ?? 1} overflow="hidden" background="var(--tt-surface-alt, #f5f5f7)">
			{props.preview}
			{props.action}
			{props.overlay}
		</Box>
		{props.children === undefined || props.children === null ? null : (
			<Box padding={2} minWidth={0}>
				{props.children}
			</Box>
		)}
	</Flex>
);

export type MediaAddTileProps = {
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
	ariaLabel?: string;
	minHeight?: React.ComponentProps<typeof Button>['minHeight'];
};

export const MediaAddTile = (props: MediaAddTileProps) => (
	<Box as="li" listStyleType="none" minWidth={0}>
		<Button
			type="button"
			width="100%"
			height="100%"
			minHeight={props.minHeight ?? '132px'}
			whiteSpace="normal"
			textAlign="center"
			variant="outline"
			borderStyle="dashed"
			borderColor="var(--tt-border, #d8d8df)"
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-surface, #fafafb)"
			_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
			isDisabled={props.disabled}
			aria-label={props.ariaLabel}
			onClick={props.onClick}
		>
			{props.children}
		</Button>
	</Box>
);
