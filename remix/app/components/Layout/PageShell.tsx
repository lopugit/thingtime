import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { RAINBOW_TEXT } from '../../theme/rainbow';

// The canonical Thingtime page scaffold, extracted verbatim from the idiom
// every conforming page hand-copied (SettingsPage/Feed/post/media/...): a
// centered column on the --tt-surface wash, clearing the fixed nav via the
// safe-area + nav-clearance calc, with Main's global pre-wrap neutralised.
// One definition so top-clearance and surface drift (pt 28/32, 90px, 108px,
// 200px-margin variants) can't recur. See docs/design/DESIGN_LANGUAGE.md and
// /docs/design-system.

// The content-column width scale in use across the app. Pick the narrowest
// that fits the page's densest row.
export type PageShellWidth = 680 | 760 | 860 | 920 | 1100 | 1180 | 1280 | 1400;

/** Top padding that clears the fixed nav (+ iOS safe area). */
export const PAGE_TOP_CLEARANCE =
	'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))';

export const PageShell = (props: {
	children: React.ReactNode;
	/** Content column max width — defaults to the 680px reading column. */
	width?: PageShellWidth;
	/** Override the page wash (defaults to --tt-surface). */
	background?: string;
	/** Extra props for the inner column (rowGap, alignItems, ...). */
	columnProps?: Record<string, unknown>;
}) => {
	const { children, width = 680, background, columnProps } = props;

	return (
		<Flex
			className="ttPageShell"
			justifyContent="center"
			width="100%"
			minHeight="100vh"
			background={background ?? 'var(--tt-surface, #fafafb)'}
			paddingTop={PAGE_TOP_CLEARANCE}
		>
			<Flex
				flexDirection="column"
				rowGap={4}
				width="100%"
				maxWidth={`${width}px`}
				px={4}
				pb={12}
				whiteSpace="normal"
				{...columnProps}
			>
				{children}
			</Flex>
		</Flex>
	);
};

/**
 * The canonical page header: mono uppercase eyebrow + animated rainbow (or
 * ink) h1. Extracted from SettingsPage.tsx / Feed.tsx so every page shares
 * one recipe and the motion toggle (--tt-rainbow-anim) is always respected.
 */
export const PageHeader = (props: {
	eyebrow: string;
	title: React.ReactNode;
	/** 'rainbow' (default) animates the brand gradient; 'ink' is solid. */
	variant?: 'rainbow' | 'ink';
	subtitle?: React.ReactNode;
	/** Rendered on the right of the title row (actions, badges). */
	after?: React.ReactNode;
}) => {
	const { eyebrow, title, variant = 'rainbow', subtitle, after } = props;

	const titleStyles =
		variant === 'rainbow'
			? {
					background: RAINBOW_TEXT,
					backgroundSize: 'calc(100px + 200%)',
					sx: {
						WebkitBackgroundClip: 'text',
						backgroundClip: 'text',
						WebkitTextFillColor: 'transparent',
						animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
					}
				}
			: { color: 'var(--tt-ink, #16161a)' };

	return (
		<Box paddingTop={[4, 8]}>
			<Text
				fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
				fontSize="10px"
				fontWeight={600}
				letterSpacing="0.08em"
				textTransform="uppercase"
				color="var(--tt-muted, #9a9aa6)"
			>
				{eyebrow}
			</Text>
			<Flex alignItems="baseline" columnGap={3} flexWrap="wrap" justifyContent="space-between">
				<Box
					as="h1"
					fontFamily="heading"
					fontSize="2xl"
					fontWeight={700}
					letterSpacing="-0.02em"
					{...titleStyles}
				>
					{title}
				</Box>
				{after}
			</Flex>
			{subtitle ? (
				<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" marginTop={1} maxWidth="720px">
					{subtitle}
				</Text>
			) : null}
		</Box>
	);
};
