import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { Logo } from '~/components/Branding/Logo';
import {
	LOGO_DEFAULT_COLOURS,
	LOGO_FULL_MATRIX,
	LOGO_ICON_MATRIX,
	LOGO_THEMES,
	buildLogoSvg
} from '~/components/Branding/logoMatrix';
import type { LogoColourMap, LogoMatrix } from '~/components/Branding/logoMatrix';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Brand marks entry. Every mark is rendered through the
// REAL builder (buildLogoSvg) or the real <Logo/> DOM component from the same
// logoMatrix.ts source of truth — the SVGs are built locally from constants
// and inlined as data: URIs, so everything renders offline.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const logoUri = (matrix: LogoMatrix, colourMap: LogoColourMap): string =>
	`data:image/svg+xml;utf8,${encodeURIComponent(buildLogoSvg({ matrix, colourMap }).svg)}`;

// Built once at module scope — the builder is pure.
const ICON_URI = logoUri(LOGO_ICON_MATRIX, LOGO_DEFAULT_COLOURS);
const FULL_URI = logoUri(LOGO_FULL_MATRIX, LOGO_DEFAULT_COLOURS);
const ICON_PINK_URI = logoUri(LOGO_ICON_MATRIX, LOGO_THEMES.pink);
const FULL_PINK_URI = logoUri(LOGO_FULL_MATRIX, LOGO_THEMES.pink);
// Monochrome demo: only key 1 defined — every other key falls back to
// colourMap[1] (the resolveLogoColour rule), so the whole mark goes ink.
const ICON_INK_URI = logoUri(LOGO_ICON_MATRIX, { 0: 'transparent', 1: '#16161a' });

const Caption = (props: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" textAlign="center">
		{props.children}
	</Text>
);

const Mark = (props: { src: string; width: string; label: string }) => (
	<Flex flexDirection="column" alignItems="center" rowGap="8px">
		<Box as="img" src={props.src} alt="Thingtime logo" width={props.width} style={{ imageRendering: 'pixelated' }} />
		<Caption>{props.label}</Caption>
	</Flex>
);

const LogoSizesStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<Flex alignItems="flex-end" columnGap={7} rowGap={5} flexWrap="wrap">
			<Mark src={ICON_URI} width="24px" label="24px · favicon" />
			<Mark src={ICON_URI} width="48px" label="48px · app tile" />
			<Mark src={ICON_URI} width="96px" label="96px · hero" />
		</Flex>
		<Flex alignItems="flex-end" columnGap={7} rowGap={5} flexWrap="wrap">
			<Mark src={FULL_URI} width="180px" label="wordmark · 180px" />
			<Mark src={FULL_URI} width="320px" label="wordmark · 320px" />
		</Flex>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			one buildLogoSvg() call per mark — the viewBox is in cell units and shape-rendering: crispEdges keeps voxels
			sharp at every size; trim strips empty outer rows/cols so the artwork ships with zero whitespace
		</Text>
	</Flex>
);

const LogoThemesStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<Flex alignItems="flex-end" columnGap={7} rowGap={5} flexWrap="wrap">
			<Mark src={ICON_URI} width="64px" label="default / nature" />
			<Mark src={ICON_PINK_URI} width="64px" label="pink" />
			<Mark src={ICON_INK_URI} width="64px" label="single-colour map" />
		</Flex>
		<Flex alignItems="flex-end" columnGap={7} rowGap={5} flexWrap="wrap">
			<Mark src={FULL_URI} width="240px" label="wordmark · default" />
			<Mark src={FULL_PINK_URI} width="240px" label="wordmark · pink" />
		</Flex>
		<Flex flexDirection="column" rowGap="4px">
			<Box>
				<Logo icon theme="nature" voxelSize={10} space="0px" />
			</Box>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				the live &lt;Logo/&gt; DOM component (landing/nav idiom) — same matrix, voxels are hoverable
			</Text>
		</Flex>
	</Flex>
);

const TAB_EXAMPLES: { prefix: string; title: string; host: string; hint: string }[] = [
	{ prefix: '[LC]', title: 'Thingtime - Feed', host: 'localhost / 127.0.0.1', hint: 'local dev' },
	{ prefix: '[VC]', title: 'Thingtime docs', host: '*.vercel.app', hint: 'Vercel preview' },
	{ prefix: '[TS]', title: 'Thingtime - Settings', host: '*.ts.net', hint: 'Tailscale funnel' },
	{ prefix: '[DEV]', title: 'Thingtime', host: 'anything else, non-dev build', hint: 'unknown non-prod' },
	{ prefix: '', title: 'Thingtime - Feed', host: 'thingtime.com', hint: 'production — no prefix' }
];

const TitlePrefixStory = () => (
	<Flex flexDirection="column" rowGap="10px" maxWidth="460px">
		{TAB_EXAMPLES.map((tab) => (
			<Flex key={tab.host} alignItems="center" columnGap={3}>
				<Flex
					alignItems="center"
					columnGap="8px"
					paddingX="12px"
					paddingY="6px"
					minWidth="240px"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-sm, 9px) var(--tt-radius-sm, 9px) 0 0"
					borderBottom="none"
					boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
				>
					<Box as="img" src={ICON_URI} alt="" width="14px" flexShrink={0} />
					<Text fontSize="12px" color="var(--tt-ink, #16161a)" noOfLines={1}>
						{tab.prefix ? (
							<Box as="span" fontWeight={700}>
								{tab.prefix}{' '}
							</Box>
						) : null}
						{tab.title}
					</Text>
				</Flex>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{tab.host} · {tab.hint}
				</Text>
			</Flex>
		))}
	</Flex>
);

export const brandMarkStories: DesignSystemStory[] = [
	{
		id: 'logo-sizes',
		title: 'The voxel mark, built at sizes',
		description:
			'The real buildLogoSvg() output at favicon, tile, and hero sizes: LOGO_ICON_MATRIX is the 3×3 plus, LOGO_FULL_MATRIX the voxel wordmark. The builder trims transparent outer rows/columns (the branding-page zero-whitespace rule), emits one <rect> per voxel in cell units, and sets shape-rendering: crispEdges — so a single SVG string scales from 24px to a wall poster without softening.',
		render: LogoSizesStory,
		note: 'The same builder drives the /branding previews and the PNG export path — DOM, SVG, and PNG always match voxel-for-voxel.'
	},
	{
		id: 'logo-themes',
		title: 'Colour themes + the live logo',
		description:
			'Colour is a map, not a bake: LOGO_THEMES holds named maps (default/nature/tt/thingtime share the 10-colour voxel palette; pink defines only stops 0–2). Unknown keys fall back to colourMap[1] — which is exactly how the pink theme turns the whole mark hotpink, and how a single-entry map makes a monochrome mark. The bottom row is the live <Logo/> DOM component the landing page renders, drawing from the same matrices.',
		render: LogoThemesStory,
		note: 'New colourways are new maps in logoMatrix.ts — never fork the matrix. A map value of "random" re-rolls from the default palette per voxel.'
	},
	{
		id: 'title-prefix',
		title: 'Title-prefix convention',
		description:
			'Every non-production tab announces its environment: root-data.server.ts derives titlePrefix from the request hostname — [LC] for localhost, [VC] for *.vercel.app, [TS] for *.ts.net, [DEV] for anything else that is not thingtime.com — and root.tsx prepends it to every document.title ("[LC] Thingtime - Feed"). Production gets no prefix. One glance at a wall of tabs tells you which ones can hurt you.',
		render: TitlePrefixStory,
		note: 'The same hostname rules are mirrored in statusEnvironment.ts for the /status page badges — extend both together if a new environment class appears.'
	}
];
