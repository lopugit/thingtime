import { Box, Flex, Grid, Text } from '@chakra-ui/react';
import type { BoxProps, SystemStyleObject, TextProps } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import React from 'react';
import { Link as RouterLink } from 'react-router';

import { MK, RAINBOW_TEXT_STYLE } from '~/components/Marketing/marketingTheme';
import { RAINBOW, SampleTree, highlightTitle } from '~/components/Marketing/SampleTree';
import { SocialImageCard } from '~/components/Marketing/SocialImage';
import { WalkthroughPlayer } from '~/components/Marketing/WalkthroughPlayer';
import { MARKETING_BASE } from '~/marketing/catalog';
import type { BuiltPage, SectionBlock, Walkthrough } from '~/marketing/types';
import { getWalkthrough } from '~/marketing/walkthroughs';

// Section renderers for the generated marketing pages. A BuiltPage is an
// ordered list of SectionBlocks (marketing/types.ts); this file owns one
// renderer per block type plus the shared primitives (eyebrow, header,
// neo-brutalist button). Every colour, radius, border and shadow comes from
// the --mk-* variables MarketingShell sets, so the same markup re-cuts into
// any of the twelve trends, light or dark.

export { highlightTitle };

type Block<T extends SectionBlock['type']> = Extract<SectionBlock, { type: T }>;

const SECTION_PAD = 'clamp(40px, 7vw, 88px)';
const AT_640 = '@media (min-width: 640px)';
const AT_900 = '@media (min-width: 900px)';
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
const RAINBOW_BAR = `linear-gradient(90deg, ${RAINBOW.join(', ')})`;

/** Headings must wrap at 390px, never overflow. */
const HEADING_WRAP: SystemStyleObject = { wordBreak: 'normal', overflowWrap: 'anywhere' };

const FOCUS_RING: SystemStyleObject = { outline: `3px solid ${MK.accent2}`, outlineOffset: '3px' };

const floatKeyframes = keyframes`
	0%, 100% { transform: translateY(0); }
	50% { transform: translateY(-10px); }
`;

/**
 * Decorative motion is gated twice: by the OS (prefers-reduced-motion) and by
 * the theme's motion switch (--tt-motion, the JS twin of --tt-rainbow-anim).
 * Starts optimistic so SSR and first paint match; settles on mount.
 */
const useMotionAllowed = () => {
	const [allowed, setAllowed] = React.useState(true);
	React.useEffect(() => {
		if (typeof window === 'undefined') return undefined;
		const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		const compute = () => {
			const flag = getComputedStyle(document.documentElement).getPropertyValue('--tt-motion').trim();
			setAllowed(!media?.matches && flag !== '0');
		};
		compute();
		media?.addEventListener?.('change', compute);
		return () => media?.removeEventListener?.('change', compute);
	}, []);
	return allowed;
};

/** Swallows a render error from a sibling-authored widget so a page never blanks. */
class SilentBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: unknown) {
		if (typeof console !== 'undefined') console.warn('[marketing] section widget failed to render', error);
	}

	render() {
		return this.state.failed ? null : this.props.children;
	}
}

// ------------------------------------------------------------ primitives

/** RouterLink for in-app paths, <a> for everything else (new tab for absolute URLs). */
const linkProps = (to?: string, type: MkButtonType = 'button'): Record<string, any> => {
	if (!to) return { as: 'button', type };
	if (to.startsWith('/')) return { as: RouterLink, to };
	const external = /^[a-z][a-z0-9+.-]*:/i.test(to);
	return { as: 'a', href: to, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) };
};

export type MkButtonVariant = 'primary' | 'secondary' | 'ink';
export type MkButtonType = 'button' | 'submit' | 'reset';

const BUTTON_VARIANTS: Record<MkButtonVariant, { background: string; color: string; hoverBackground: string }> = {
	primary: { background: MK.accent, color: MK.accentContrast, hoverBackground: MK.accent },
	secondary: { background: MK.cardSolid, color: MK.ink, hoverBackground: MK.tint },
	ink: { background: MK.ink, color: MK.bg, hoverBackground: MK.ink }
};

export type MkButtonProps = {
	/** In-app path ('/…') renders a RouterLink; any other string renders <a>; omitted renders <button>. */
	to?: string;
	variant?: MkButtonVariant;
	size?: 'md' | 'lg';
	/** Only meaningful without `to` (a real <button>); defaults to 'button' so forms never submit by accident. */
	type?: MkButtonType;
	onClick?: React.MouseEventHandler<HTMLElement>;
	/** Override the variant's fill (also used on hover) — e.g. an inverted button on the CTA banner. */
	background?: string;
	color?: string;
	'aria-label'?: string;
	'data-testid'?: string;
	sx?: SystemStyleObject;
	children: React.ReactNode;
};

/**
 * The neo-brutalist CTA: chunky --mk-border, hard --mk-shadow, lifts on hover
 * to --mk-shadow-lg. 44px minimum height for touch. Renders as RouterLink,
 * <a>, or <button> depending on `to`.
 */
export const MkButton = ({
	to,
	variant = 'primary',
	size = 'md',
	type = 'button',
	onClick,
	background,
	color,
	sx,
	children,
	...rest
}: MkButtonProps) => {
	const palette = BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary;
	const fill = background ?? palette.background;
	const hoverFill = background ?? palette.hoverBackground;
	const ink = color ?? palette.color;
	return (
		<Box
			{...linkProps(to, type)}
			onClick={onClick}
			display="inline-flex"
			alignItems="center"
			justifyContent="center"
			gap="8px"
			minHeight={size === 'lg' ? '52px' : '44px'}
			padding={size === 'lg' ? '14px 26px' : '11px 20px'}
			fontFamily={MK.font}
			fontWeight={800}
			fontSize={size === 'lg' ? '17px' : '15px'}
			lineHeight={1.2}
			letterSpacing="-0.01em"
			textAlign="center"
			textDecoration="none"
			cursor="pointer"
			userSelect="none"
			border={MK.border}
			borderRadius={MK.radiusSm}
			boxShadow={MK.shadow}
			background={fill}
			color={ink}
			transition="transform 120ms ease, box-shadow 120ms ease, background 120ms ease"
			_hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg, background: hoverFill, color: ink, textDecoration: 'none' }}
			_active={{ transform: 'translate(0, 0)', boxShadow: MK.shadow }}
			_focusVisible={FOCUS_RING}
			sx={{ [REDUCED_MOTION]: { transition: 'none' }, ...(sx ?? {}) }}
			{...rest}
		>
			{children}
		</Box>
	);
};

/** Mono, uppercase, tracked-out label above a heading. */
export const SectionEyebrow = ({ children, color = MK.muted, ...rest }: TextProps) => (
	<Text
		as="p"
		margin={0}
		fontFamily={MK.mono}
		fontSize="11px"
		fontWeight={600}
		textTransform="uppercase"
		letterSpacing="0.16em"
		lineHeight={1.4}
		color={color}
		{...rest}
	>
		{children}
	</Text>
);

const SectionHeader = ({
	eyebrow,
	title,
	body,
	align = 'start',
	maxWidth = '780px'
}: {
	eyebrow?: string;
	title: React.ReactNode;
	body?: React.ReactNode;
	align?: 'start' | 'center';
	maxWidth?: string;
}) => (
	<Box maxWidth={maxWidth} marginX={align === 'center' ? 'auto' : undefined} textAlign={align} marginBottom={{ base: 7, md: 9 }} minWidth={0}>
		{eyebrow ? <SectionEyebrow marginBottom={3}>{eyebrow}</SectionEyebrow> : null}
		<Text
			as="h2"
			margin={0}
			fontFamily={MK.font}
			fontSize="clamp(28px, 4vw, 44px)"
			lineHeight={1.06}
			letterSpacing="-0.03em"
			fontWeight={MK.weight}
			color={MK.ink}
			sx={HEADING_WRAP}
		>
			{title}
		</Text>
		{body ? (
			<Text fontSize="17px" lineHeight={1.6} color={MK.text} marginTop={4} maxWidth="640px" marginX={align === 'center' ? 'auto' : undefined}>
				{body}
			</Text>
		) : null}
	</Box>
);

const MkSection = ({
	type,
	hero = false,
	children,
	...rest
}: { type: SectionBlock['type']; hero?: boolean; children: React.ReactNode } & BoxProps) => (
	<Box
		as="section"
		data-section={type}
		data-testid={`marketing-section-${type}`}
		paddingY={SECTION_PAD}
		paddingTop={hero ? 'clamp(28px, 5vw, 64px)' : undefined}
		borderTop={hero ? undefined : `1px solid ${MK.hairline}`}
		minWidth={0}
		maxWidth="100%"
		{...rest}
	>
		{children}
	</Box>
);

// ---------------------------------------------------------------- hero

/** Plus-shaped voxel logo: blue / green amber purple / red (DESIGN_LANGUAGE.md). */
const VOXEL_CELLS: (string | null)[] = [null, RAINBOW[3], null, RAINBOW[2], RAINBOW[1], RAINBOW[4], null, RAINBOW[0], null];

export const VoxelLogo = ({ cell = 28, animate = false }: { cell?: number; animate?: boolean }) => (
	<Box
		aria-hidden="true"
		display="grid"
		gridTemplateColumns={`repeat(3, ${cell}px)`}
		gridAutoRows={`${cell}px`}
		width={`${cell * 3}px`}
		flex="none"
		sx={{
			animation: animate ? `${floatKeyframes} 2.4s ease-in-out infinite` : 'none',
			[REDUCED_MOTION]: { animation: 'none' }
		}}
	>
		{VOXEL_CELLS.map((colour, index) => (
			<Box key={index} background={colour ?? 'transparent'} />
		))}
	</Box>
);

const HeroSticker = ({ children, ...rest }: BoxProps) => (
	<Box
		position="absolute"
		display="inline-flex"
		alignItems="center"
		gap="6px"
		padding="6px 10px"
		fontFamily={MK.font}
		fontSize="12px"
		fontWeight={800}
		color={MK.ink}
		background={MK.cardSolid}
		border={MK.border}
		borderRadius={MK.radiusSm}
		boxShadow={MK.shadow}
		whiteSpace="nowrap"
		{...rest}
	>
		{children}
	</Box>
);

const HeroOrnament = () => {
	const motion = useMotionAllowed();
	return (
		<Box
			aria-hidden="true"
			display="none"
			sx={{ [AT_900]: { display: 'flex' } }}
			alignItems="center"
			justifyContent="center"
			position="relative"
			minWidth={0}
		>
			<Box
				position="relative"
				width="260px"
				height="260px"
				display="flex"
				alignItems="center"
				justifyContent="center"
				background={MK.cardSolid}
				border={MK.border}
				borderRadius={MK.radius}
				boxShadow={MK.shadow}
				overflow="visible"
			>
				<Box
					position="absolute"
					top={0}
					left={0}
					right={0}
					height="6px"
					background={RAINBOW_BAR}
					borderTopLeftRadius="inherit"
					borderTopRightRadius="inherit"
				/>
				<VoxelLogo cell={28} animate={motion} />
				<Text
					position="absolute"
					bottom="16px"
					left="0"
					right="0"
					textAlign="center"
					fontFamily={MK.mono}
					fontSize="11px"
					letterSpacing="0.14em"
					textTransform="uppercase"
					color={MK.muted}
				>
					everything is a thing
				</Text>
				<HeroSticker top="-14px" right="-22px" transform="rotate(6deg)">
					<span>🌈</span> yours
				</HeroSticker>
				<HeroSticker bottom="34px" left="-30px" transform="rotate(-7deg)">
					<span>🔌</span> same API
				</HeroSticker>
			</Box>
		</Box>
	);
};

export const MarketingHero = ({ section }: { section: Block<'hero'> }) => (
	<MkSection type="hero" hero>
		<Grid
			gap={{ base: 8, md: 12 }}
			alignItems="center"
			sx={{ gridTemplateColumns: 'minmax(0, 1fr)', [AT_900]: { gridTemplateColumns: 'minmax(0, 1fr) 320px' } }}
		>
			<Box minWidth={0}>
				{section.eyebrow ? <SectionEyebrow marginBottom={4}>{section.eyebrow}</SectionEyebrow> : null}
				<Text
					as="h1"
					margin={0}
					fontFamily={MK.font}
					fontSize="clamp(38px, 6.5vw, 76px)"
					lineHeight={1.02}
					letterSpacing="-0.03em"
					fontWeight={MK.weight}
					color={MK.ink}
					maxWidth="16ch"
					sx={HEADING_WRAP}
					data-testid="marketing-hero-title"
				>
					{highlightTitle(section.title, section.highlight)}
				</Text>
				<Text fontSize="18px" lineHeight={1.6} color={MK.text} maxWidth="640px" marginTop={{ base: 5, md: 6 }}>
					{section.body}
				</Text>
				<Flex gap={3} flexWrap="wrap" marginTop={{ base: 6, md: 8 }} alignItems="center">
					<MkButton to={section.cta.to} variant="primary" size="lg" data-testid="marketing-hero-cta">
						{section.cta.label}
					</MkButton>
					{section.secondary ? (
						<MkButton to={section.secondary.to} variant="secondary" size="lg">
							{section.secondary.label}
						</MkButton>
					) : null}
				</Flex>
				{section.badges?.length ? (
					<Flex as="ul" listStyleType="none" margin={0} padding={0} gap={2} flexWrap="wrap" marginTop={6} aria-label="Available on">
						{section.badges.map((badge) => (
							<Box
								as="li"
								key={badge}
								display="inline-flex"
								alignItems="center"
								padding="6px 10px"
								fontSize="12px"
								fontWeight={700}
								lineHeight={1.2}
								fontFamily={MK.font}
								color={MK.ink}
								background={MK.card}
								border={MK.border}
								borderRadius={MK.radiusSm}
								whiteSpace="nowrap"
							>
								{badge}
							</Box>
						))}
					</Flex>
				) : null}
			</Box>
			<HeroOrnament />
		</Grid>
	</MkSection>
);

// ------------------------------------------------------------- bullets

const BulletsSection = ({ section }: { section: Block<'bullets'> }) => (
	<MkSection type="bullets">
		<SectionHeader eyebrow={section.eyebrow} title={section.title} />
		<Grid
			gap={{ base: 4, md: 5 }}
			sx={{
				gridTemplateColumns: 'minmax(0, 1fr)',
				[AT_640]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
				[AT_900]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }
			}}
		>
			{section.items.map((item, index) => (
				<Box
					as="article"
					key={`${item.title}-${index}`}
					background={MK.cardSolid}
					border={MK.border}
					borderRadius={MK.radius}
					boxShadow={MK.shadow}
					padding="24px"
					minWidth={0}
					display="flex"
					flexDirection="column"
					gap={3}
				>
					<Text as="span" display="block" fontSize="28px" lineHeight={1} aria-hidden="true">
						{item.emoji}
					</Text>
					<Text
						as="h3"
						margin={0}
						fontFamily={MK.font}
						fontSize="18px"
						fontWeight={800}
						lineHeight={1.25}
						letterSpacing="-0.01em"
						color={MK.ink}
						sx={HEADING_WRAP}
					>
						{item.title}
					</Text>
					<Text margin={0} fontSize="14px" lineHeight={1.6} color={MK.text}>
						{item.body}
					</Text>
				</Box>
			))}
		</Grid>
	</MkSection>
);

// --------------------------------------------------------------- steps

/** Catalog step titles already carry "1. " (and "☐ 1. " for checklists); the big number replaces it. */
const stripOrdinal = (title: string) => title.replace(/^(☐\s*)?\d+\.\s+/, '$1');

const StepsSection = ({ section }: { section: Block<'steps'> }) => (
	<MkSection type="steps">
		<SectionHeader eyebrow={section.eyebrow} title={section.title} />
		<Box as="ol" listStyleType="none" margin={0} padding={0} maxWidth="820px">
			{section.steps.map((step, index) => (
				<Flex
					as="li"
					key={`${step.title}-${index}`}
					gap={{ base: 4, md: 6 }}
					paddingY={5}
					alignItems="flex-start"
					borderTop={index ? `1px solid ${MK.hairline}` : undefined}
				>
					<Text
						as="span"
						fontFamily={MK.font}
						fontSize="40px"
						fontWeight={900}
						lineHeight={1}
						letterSpacing="-0.04em"
						color={MK.accent}
						minWidth="56px"
						flex="none"
						aria-hidden="true"
					>
						{String(index + 1).padStart(2, '0')}
					</Text>
					<Box minWidth={0} paddingTop="6px">
						<Text as="h3" margin={0} fontFamily={MK.font} fontSize="18px" fontWeight={800} lineHeight={1.3} color={MK.ink} sx={HEADING_WRAP}>
							{stripOrdinal(step.title)}
						</Text>
						<Text margin={0} marginTop={1.5} fontSize="14px" lineHeight={1.6} color={MK.text}>
							{step.body}
						</Text>
					</Box>
				</Flex>
			))}
		</Box>
	</MkSection>
);

// --------------------------------------------------------------- table

const TableSection = ({ section }: { section: Block<'table'> }) => {
	const found = section.columns.findIndex((column) => /thingtime/i.test(column));
	const ttColumn = found === -1 ? 1 : found;
	const cellPad = '12px 14px';
	return (
		<MkSection type="table">
			<SectionHeader eyebrow={section.eyebrow} title={section.title} />
			<Box
				overflowX="auto"
				maxWidth="100%"
				minWidth={0}
				border={MK.border}
				borderRadius={MK.radius}
				background={MK.cardSolid}
				boxShadow={MK.shadow}
				sx={{ WebkitOverflowScrolling: 'touch' }}
				tabIndex={0}
				role="region"
				aria-label={section.title}
			>
				<Box as="table" width="100%" minWidth="560px" fontSize="14px" color={MK.text} fontFamily={MK.font} sx={{ borderCollapse: 'collapse' }}>
					<thead>
						<tr>
							{section.columns.map((column, index) => (
								<Box
									as="th"
									key={`${column}-${index}`}
									scope="col"
									textAlign="left"
									fontFamily={MK.mono}
									fontSize="11px"
									fontWeight={600}
									letterSpacing="0.12em"
									textTransform="uppercase"
									color={index === ttColumn ? MK.ink : MK.muted}
									padding={cellPad}
									borderBottom={`1px solid ${MK.hairline}`}
									background={index === ttColumn ? MK.tint : undefined}
									whiteSpace="nowrap"
								>
									{column}
								</Box>
							))}
						</tr>
					</thead>
					<tbody>
						{section.rows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{row.map((cell, cellIndex) => (
									<Box
										as={cellIndex === 0 ? 'th' : 'td'}
										scope={cellIndex === 0 ? 'row' : undefined}
										key={cellIndex}
										textAlign="left"
										verticalAlign="top"
										padding={cellPad}
										lineHeight={1.5}
										fontWeight={cellIndex === 0 ? 700 : 400}
										color={cellIndex === 0 ? MK.ink : MK.text}
										background={cellIndex === ttColumn ? MK.tint : undefined}
										borderTop={rowIndex ? `1px solid ${MK.hairline}` : undefined}
									>
										{cell}
									</Box>
								))}
							</tr>
						))}
					</tbody>
				</Box>
			</Box>
		</MkSection>
	);
};

// --------------------------------------------------------------- quote

const QuoteSection = ({ section }: { section: Block<'quote'> }) => (
	<MkSection type="quote">
		<Box as="blockquote" margin="0 auto" padding={0} maxWidth="860px" textAlign="center">
			<Text
				as="p"
				margin={0}
				fontFamily={MK.font}
				fontSize="clamp(24px, 3.4vw, 40px)"
				fontWeight={800}
				letterSpacing="-0.02em"
				lineHeight={1.2}
				color={MK.ink}
				sx={HEADING_WRAP}
			>
				“{section.text}”
			</Text>
			<Text as="footer" marginTop={5} fontFamily={MK.mono} fontSize="12px" color={MK.muted}>
				— {section.by}
			</Text>
		</Box>
	</MkSection>
);

// --------------------------------------------------------------- stats

const StatsSection = ({ section }: { section: Block<'stats'> }) => (
	<MkSection type="stats">
		<Grid
			gap={{ base: 6, md: 8 }}
			sx={{
				gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
				[AT_900]: { gridTemplateColumns: `repeat(${Math.max(1, Math.min(section.items.length, 4))}, minmax(0, 1fr))` }
			}}
		>
			{section.items.map((item, index) => (
				<Box key={`${item.label}-${index}`} textAlign="center" minWidth={0}>
					<Text
						as="p"
						margin={0}
						fontFamily={MK.font}
						fontSize="clamp(36px, 5vw, 64px)"
						fontWeight={900}
						lineHeight={1}
						letterSpacing="-0.04em"
						sx={{ ...RAINBOW_TEXT_STYLE, ...HEADING_WRAP }}
					>
						{item.value}
					</Text>
					<Text margin={0} marginTop={2} fontSize="13px" fontWeight={600} lineHeight={1.4} color={MK.muted}>
						{item.label}
					</Text>
				</Box>
			))}
		</Grid>
	</MkSection>
);

// ----------------------------------------------------------------- faq

const FaqSection = ({ section }: { section: Block<'faq'> }) => (
	<MkSection type="faq">
		<SectionHeader eyebrow={section.eyebrow} title={section.title} />
		<Box maxWidth="820px" borderBottom={`1px solid ${MK.hairline}`}>
			{section.items.map((item, index) => (
				<Box
					as="details"
					key={`${item.q}-${index}`}
					data-testid="marketing-faq-item"
					borderTop={`1px solid ${MK.hairline}`}
					sx={{ '&[open] .mk-faq-plus': { transform: 'rotate(45deg)' } }}
				>
					<Box
						as="summary"
						display="flex"
						alignItems="center"
						justifyContent="space-between"
						gap={4}
						cursor="pointer"
						padding="16px 0"
						listStyleType="none"
						fontFamily={MK.font}
						fontSize="16px"
						fontWeight={700}
						lineHeight={1.35}
						color={MK.ink}
						sx={{ '&::-webkit-details-marker': { display: 'none' }, '&::marker': { content: '""' } }}
						_hover={{ color: MK.accent }}
						_focusVisible={FOCUS_RING}
					>
						<Text as="span" sx={HEADING_WRAP}>
							{item.q}
						</Text>
						<Box
							as="span"
							className="mk-faq-plus"
							aria-hidden="true"
							flex="none"
							width="28px"
							height="28px"
							display="inline-flex"
							alignItems="center"
							justifyContent="center"
							border={MK.border}
							borderRadius={MK.radiusSm}
							background={MK.cardSolid}
							color={MK.ink}
							fontSize="18px"
							lineHeight={1}
							transition="transform 160ms ease"
							sx={{ [REDUCED_MOTION]: { transition: 'none' } }}
						>
							＋
						</Box>
					</Box>
					<Text margin={0} paddingBottom={5} fontSize="15px" lineHeight={1.65} color={MK.text} maxWidth="680px">
						{item.a}
					</Text>
				</Box>
			))}
		</Box>
	</MkSection>
);

// -------------------------------------------------------------- sample

const SampleSection = ({ section }: { section: Block<'sample'> }) => {
	const firstKey = Object.keys(section.sample ?? {})[0] ?? 'thing';
	return (
		<MkSection type="sample">
			<SectionHeader eyebrow={section.eyebrow} title={section.title} body={section.body} />
			<Box
				maxWidth="820px"
				border={MK.border}
				borderRadius={MK.radius}
				boxShadow={MK.shadow}
				background={MK.cardSolid}
				overflow="hidden"
				data-testid="marketing-sample-window"
			>
				<Flex
					alignItems="center"
					position="relative"
					minHeight="40px"
					padding="10px 14px"
					borderBottom={`1px solid ${MK.hairline}`}
					background={MK.bg2}
				>
					<Flex gap="6px" flex="none" aria-hidden="true">
						{[0, 1, 2].map((index) => (
							<Box key={index} width="12px" height="12px" borderRadius={MK.radiusSm} background={RAINBOW[index]} />
						))}
					</Flex>
					<Text
						position="absolute"
						left="0"
						right="0"
						paddingX="72px"
						textAlign="center"
						fontFamily={MK.mono}
						fontSize="12px"
						color={MK.muted}
						whiteSpace="nowrap"
						overflow="hidden"
						textOverflow="ellipsis"
						pointerEvents="none"
					>
						tt · {firstKey}
					</Text>
				</Flex>
				<Box padding={{ base: 3, md: 5 }} overflowX="auto">
					<SampleTree value={section.sample} />
				</Box>
			</Box>
		</MkSection>
	);
};

// --------------------------------------------------------- walkthrough

const WalkthroughSection = ({ section }: { section: Block<'walkthrough'> }) => {
	let walkthrough: Walkthrough | null = null;
	try {
		walkthrough = getWalkthrough(section.walkthrough);
	} catch {
		walkthrough = null;
	}
	if (!walkthrough) return null;
	return (
		<MkSection type="walkthrough">
			<SectionHeader eyebrow="Watch it" title="See it move" body={walkthrough.intro} />
			<SilentBoundary>
				<WalkthroughPlayer walkthrough={walkthrough} autoplay />
			</SilentBoundary>
		</MkSection>
	);
};

// -------------------------------------------------------------- social

const SOCIAL_PREVIEW_FORMATS = ['ig-square', 'story', 'x-post'] as const;

const SocialSection = ({ section }: { section: Block<'social'> }) => (
	<MkSection type="social">
		<SectionHeader eyebrow={section.eyebrow} title={section.title} />
		<Grid
			gap={{ base: 5, md: 6 }}
			alignItems="start"
			sx={{ gridTemplateColumns: 'minmax(0, 1fr)', [AT_900]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } }}
		>
			{SOCIAL_PREVIEW_FORMATS.map((format) => (
				<Box key={format} minWidth={0}>
					<SilentBoundary>
						<SocialImageCard asset={{ feature: section.feature, trend: section.trend, format }} compact />
					</SilentBoundary>
				</Box>
			))}
		</Grid>
		<Box marginTop={{ base: 6, md: 8 }}>
			<MkButton
				to={`${MARKETING_BASE}/social-media?feature=${encodeURIComponent(section.feature)}&trend=${encodeURIComponent(section.trend)}`}
				variant="secondary"
			>
				Browse all social images →
			</MkButton>
		</Box>
	</MkSection>
);

// ----------------------------------------------------------------- cta

export const MarketingCta = ({ section }: { section: Block<'cta'> }) => (
	<MkSection type="cta">
		<Box
			position="relative"
			overflow="hidden"
			background={MK.ink}
			color={MK.bg}
			borderRadius={MK.radius}
			padding="clamp(28px, 5vw, 56px)"
			data-testid="marketing-cta-banner"
		>
			<Box position="absolute" top={0} left={0} right={0} height="6px" background={RAINBOW_BAR} aria-hidden="true" />
			<Text
				as="h2"
				margin={0}
				fontFamily={MK.font}
				fontSize="clamp(28px, 4.5vw, 52px)"
				fontWeight={900}
				lineHeight={1.04}
				letterSpacing="-0.03em"
				color="inherit"
				maxWidth="18ch"
				sx={HEADING_WRAP}
			>
				{section.title}
			</Text>
			<Text margin={0} marginTop={3} fontSize="16px" lineHeight={1.6} opacity={0.85} color="inherit" maxWidth="620px">
				{section.body}
			</Text>
			<Flex gap={3} flexWrap="wrap" marginTop={{ base: 6, md: 8 }} alignItems="center">
				<MkButton to={section.cta.to} variant="primary" size="lg">
					{section.cta.label}
				</MkButton>
				{section.secondary ? (
					<MkButton to={section.secondary.to} variant="secondary" size="lg" background={MK.bg} color={MK.ink}>
						{section.secondary.label}
					</MkButton>
				) : null}
			</Flex>
		</Box>
	</MkSection>
);

// --------------------------------------------------------------- links

const LinksSection = ({ section }: { section: Block<'links'> }) => (
	<MkSection type="links">
		<SectionHeader eyebrow={section.eyebrow} title={section.title} />
		<Flex as="ul" listStyleType="none" margin={0} padding={0} gap={2.5} flexWrap="wrap">
			{section.links.map((link, index) => (
				<Box as="li" key={`${link.to}-${index}`} minWidth={0} maxWidth="100%">
					<Box
						{...linkProps(link.to)}
						display="inline-flex"
						alignItems="center"
						gap={2}
						minHeight="40px"
						padding="8px 12px"
						fontFamily={MK.font}
						fontSize="13px"
						fontWeight={700}
						lineHeight={1.3}
						color={MK.ink}
						background={MK.card}
						border={MK.border}
						borderRadius={MK.radiusSm}
						textDecoration="none"
						maxWidth="100%"
						transition="background 120ms ease"
						_hover={{ background: MK.tint, textDecoration: 'none' }}
						_focusVisible={FOCUS_RING}
						sx={{ overflowWrap: 'anywhere' }}
					>
						<Text as="span" aria-hidden="true" flex="none">
							{link.emoji}
						</Text>
						<Text as="span">{link.label}</Text>
					</Box>
				</Box>
			))}
		</Flex>
	</MkSection>
);

// -------------------------------------------------------------- render

const SectionRenderer = ({ section }: { section: SectionBlock }) => {
	switch (section.type) {
		case 'hero':
			return <MarketingHero section={section} />;
		case 'bullets':
			return <BulletsSection section={section} />;
		case 'steps':
			return <StepsSection section={section} />;
		case 'table':
			return <TableSection section={section} />;
		case 'quote':
			return <QuoteSection section={section} />;
		case 'stats':
			return <StatsSection section={section} />;
		case 'faq':
			return <FaqSection section={section} />;
		case 'sample':
			return <SampleSection section={section} />;
		case 'walkthrough':
			return <WalkthroughSection section={section} />;
		case 'social':
			return <SocialSection section={section} />;
		case 'cta':
			return <MarketingCta section={section} />;
		case 'links':
			return <LinksSection section={section} />;
		default:
			return null;
	}
};

/** Renders a built page's sections in order, one renderer per block type. */
export const MarketingSections = ({ page }: { page: BuiltPage }) => (
	<>
		{page.sections.map((section, index) => (
			<SectionRenderer key={`${section.type}-${index}`} section={section} />
		))}
	</>
);
