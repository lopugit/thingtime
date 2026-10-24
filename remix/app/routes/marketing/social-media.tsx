import { Box, Flex, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { MarketingColdStart, MarketingUnpublished } from '~/components/Marketing/MarketingGate';
import { PublishToggle, type AdminSurface } from '~/components/Marketing/MarketingPublishing';
import { Crumbs, MarketingShell, formatCount, useMarketingSeo } from '~/components/Marketing/MarketingShell';
import { DOWNLOAD_BATCH_CAP, downloadPng, downloadSequentially, planDownloads } from '~/components/Marketing/marketingDownload';
import { MK } from '~/components/Marketing/marketingTheme';
import { SocialCaptionPanel, SocialImageCard, useSocialActions } from '~/components/Marketing/SocialImage';
import { useMarketingVisibility } from '~/components/Marketing/useMarketingPublications';
import { MARKETING_BASE } from '~/marketing/catalog';
import { FEATURES, FEATURE_BY_KEY, FEATURE_CATEGORY_LABELS } from '~/marketing/features';
import { SOCIAL_KEY, socialFeatureKey } from '~/marketing/publishing';
import { buildSocialSvg, socialAssetFilename, socialAssetKey, socialCaption, type SocialAssetRef } from '~/marketing/social';
import { SOCIAL_FORMATS, SOCIAL_FORMAT_BY_KEY, TRENDS, TREND_BY_KEY } from '~/marketing/trends';
import type { Feature, SocialFormat, TrendKey } from '~/marketing/types';

// /marketing/social-media — the menu-navigable social image suite. A feature,
// a style (or all twelve) and a format (or all ten) are picked from a sidebar
// menu; the selection lives in the URL so every combination is a shareable
// link, and the grid renders the trend × format expansion as downloadable
// cards. There is no loader: everything is generated from the catalog.
//
// Publishing (marketing/publishing.ts): the suite is one surface, and each
// feature's image set is its own "resource" — visitors only see published
// sets, and a selection naming an unpublished feature falls back to the
// first published one.

const SUITE_SURFACE: AdminSurface = {
	key: SOCIAL_KEY,
	label: 'Social image suite',
	bulk: { noun: 'image sets', keys: FEATURES.map((feature) => socialFeatureKey(feature.key)) }
};

export type SocialSelection = { feature: string; trend: TrendKey | 'all'; format: string };

export const DEFAULT_SELECTION: SocialSelection = { feature: 'feed', trend: 'bold-brutal', format: 'all' };

/**
 * Pure: reads ?feature=&trend=&format= and falls back to the defaults for
 * anything unknown. `allowedFeatures` narrows the feature to what the viewer
 * may see (its first entry is the fallback); an empty list keeps the default
 * so the page can render its own empty state.
 */
export const resolveSocialSelection = (params: URLSearchParams, allowedFeatures: readonly Feature[] = FEATURES): SocialSelection => {
	const feature = params.get('feature');
	const trend = params.get('trend');
	const format = params.get('format');
	const allowed = allowedFeatures.length ? allowedFeatures : FEATURES;
	const featureAllowed = feature && FEATURE_BY_KEY[feature] && allowed.some((entry) => entry.key === feature);
	return {
		feature: featureAllowed ? feature : allowed.some((entry) => entry.key === DEFAULT_SELECTION.feature) ? DEFAULT_SELECTION.feature : allowed[0].key,
		trend: trend === 'all' || (trend && TREND_BY_KEY[trend as TrendKey]) ? (trend as TrendKey | 'all') : DEFAULT_SELECTION.trend,
		format: format === 'all' || (format && SOCIAL_FORMAT_BY_KEY[format]) ? format : DEFAULT_SELECTION.format
	};
};

export const socialHref = (selection: SocialSelection) =>
	`${MARKETING_BASE}/social-media?feature=${encodeURIComponent(selection.feature)}&trend=${encodeURIComponent(
		selection.trend
	)}&format=${encodeURIComponent(selection.format)}`;

type AssetGroup = { key: string; heading: string; sub?: string; assets: SocialAssetRef[] };

/** Pure: expands the selection into grid groups (per trend when style is "all", per platform when only format is "all"). */
export const groupsForSelection = (selection: SocialSelection): AssetGroup[] => {
	const formats = selection.format === 'all' ? SOCIAL_FORMATS : [SOCIAL_FORMAT_BY_KEY[selection.format]];
	const asset = (trend: TrendKey, format: SocialFormat): SocialAssetRef => ({ feature: selection.feature, trend, format: format.key });
	if (selection.trend === 'all') {
		return TRENDS.map((trend) => ({
			key: trend.key,
			heading: `${trend.emoji} ${trend.name}`,
			sub: trend.platforms.join(' · '),
			assets: formats.map((format) => asset(trend.key, format))
		}));
	}
	const trend = selection.trend;
	if (selection.format === 'all') {
		const byPlatform = new Map<string, SocialFormat[]>();
		for (const format of SOCIAL_FORMATS) byPlatform.set(format.platform, [...(byPlatform.get(format.platform) ?? []), format]);
		return Array.from(byPlatform, ([platform, list]) => ({
			key: platform,
			heading: `${list[0].emoji} ${platform}`,
			sub: list.map((format) => format.label).join(' · '),
			assets: list.map((format) => asset(trend, format))
		}));
	}
	return [{ key: 'single', heading: '', assets: formats.map((format) => asset(trend, format)) }];
};

const FEATURE_CATEGORIES = Object.keys(FEATURE_CATEGORY_LABELS) as Feature['category'][];

/** Sidebar offset: nav clearance + the marketing sub-nav row. */
const STICKY_TOP = 'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 56px)';
const DESKTOP = '@media (min-width: 900px)';
const MOBILE = '@media (max-width: 899px)';

const MenuHeading = ({ children }: { children: React.ReactNode }) => (
	<Text
		as="h2"
		fontFamily={MK.mono}
		fontSize="11px"
		fontWeight={700}
		letterSpacing="0.16em"
		textTransform="uppercase"
		color={MK.muted}
		margin="0 0 6px 8px"
	>
		{children}
	</Text>
);

const MenuSubheading = ({ children }: { children: React.ReactNode }) => (
	<Text as="h3" fontSize="12px" fontWeight={800} color={MK.ink} margin="10px 0 4px 8px">
		{children}
	</Text>
);

const MenuItem = ({ selected, onClick, sub, children }: { selected: boolean; onClick: () => void; sub?: string; children: React.ReactNode }) => (
	<Box
		as="button"
		type="button"
		onClick={onClick}
		aria-pressed={selected}
		display="flex"
		flexDirection="column"
		alignItems="flex-start"
		width="100%"
		textAlign="left"
		px={2.5}
		py={1.5}
		border="1px solid transparent"
		borderRadius={MK.radiusSm}
		background={selected ? MK.accent : 'transparent'}
		color={selected ? MK.accentContrast : MK.ink}
		fontFamily={MK.font}
		fontWeight={700}
		fontSize="13px"
		lineHeight={1.25}
		cursor="pointer"
		_hover={{ background: selected ? MK.accent : MK.tint, borderColor: MK.hairline }}
		_focusVisible={{ outline: `3px solid ${MK.accent2}`, outlineOffset: '1px' }}
	>
		<span>{children}</span>
		{sub ? (
			<Text
				as="span"
				fontFamily={MK.mono}
				fontWeight={500}
				fontSize="10.5px"
				color={selected ? MK.accentContrast : MK.muted}
				opacity={selected ? 0.85 : 1}
				marginTop="2px"
			>
				{sub}
			</Text>
		) : null}
	</Box>
);

const ToolButton = ({
	primary = false,
	children,
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; children: React.ReactNode }) => (
	<Box
		as="button"
		type="button"
		display="inline-flex"
		alignItems="center"
		gap={1.5}
		minHeight="36px"
		px={3.5}
		border={MK.border}
		borderRadius={MK.radiusSm}
		background={primary ? MK.accent : MK.cardSolid}
		color={primary ? MK.accentContrast : MK.ink}
		fontFamily={MK.font}
		fontWeight={700}
		fontSize="13px"
		cursor="pointer"
		_hover={{ transform: 'translateY(-1px)', filter: 'brightness(.96)' }}
		_active={{ transform: 'none' }}
		_disabled={{ opacity: 0.6, cursor: 'progress', transform: 'none' }}
		_focusVisible={{ outline: `3px solid ${MK.accent2}`, outlineOffset: '2px' }}
		transition="transform 140ms ease, filter 140ms ease"
		sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none', _hover: { transform: 'none' } } }}
		{...rest}
	>
		{children}
	</Box>
);

const Pill = ({ label, onRemove, removeLabel }: { label: React.ReactNode; onRemove?: () => void; removeLabel?: string }) => (
	<Flex
		as="span"
		alignItems="center"
		gap={1.5}
		pl={2.5}
		pr={onRemove ? 1 : 2.5}
		py={1}
		fontSize="12px"
		fontWeight={700}
		border={MK.border}
		borderRadius={MK.radiusSm}
		background={MK.cardSolid}
		color={MK.ink}
		minHeight="32px"
	>
		{label}
		{onRemove ? (
			<Box
				as="button"
				type="button"
				onClick={onRemove}
				aria-label={removeLabel}
				display="inline-flex"
				alignItems="center"
				justifyContent="center"
				width="24px"
				height="24px"
				borderRadius={MK.radiusSm}
				background="transparent"
				color={MK.muted}
				fontSize="16px"
				lineHeight={1}
				cursor="pointer"
				_hover={{ background: MK.tint, color: MK.ink }}
				_focusVisible={{ outline: `3px solid ${MK.accent2}`, outlineOffset: '1px' }}
			>
				×
			</Box>
		) : null}
	</Flex>
);

const QuickChip = ({ to, selected, children }: { to: string; selected?: boolean; children: React.ReactNode }) => (
	<Box
		as={RouterLink}
		to={to}
		replace
		aria-current={selected ? 'true' : undefined}
		display="inline-flex"
		alignItems="center"
		gap={1}
		px={2.5}
		py={1}
		fontSize="12px"
		fontWeight={700}
		border={`1px solid ${selected ? MK.accent : MK.hairline}`}
		borderRadius={MK.radiusSm}
		background={selected ? MK.accent : MK.tint}
		color={selected ? MK.accentContrast : MK.ink}
		whiteSpace="nowrap"
		_hover={{ borderColor: MK.ink }}
		_focusVisible={{ outline: `3px solid ${MK.accent2}`, outlineOffset: '1px' }}
	>
		{children}
	</Box>
);

export default function SocialMediaSuite() {
	const [searchParams, setSearchParams] = useSearchParams();
	const visibility = useMarketingVisibility();
	const features = React.useMemo(() => visibility.features(FEATURES), [visibility]);
	const selection = React.useMemo(() => resolveSocialSelection(searchParams, features), [features, searchParams]);
	const { feature: featureKey, trend: trendKey, format: formatKey } = selection;
	const feature = FEATURE_BY_KEY[featureKey];
	const trend = trendKey === 'all' ? null : TREND_BY_KEY[trendKey];
	const format = formatKey === 'all' ? null : SOCIAL_FORMAT_BY_KEY[formatKey];
	const groups = React.useMemo(() => groupsForSelection(selection), [selection]);
	const assets = React.useMemo(() => groups.flatMap((group) => group.assets), [groups]);
	const compact = assets.length > 24;

	const [menuOpen, setMenuOpen] = React.useState(false);
	const [showCaptions, setShowCaptions] = React.useState(false);
	const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
	const lopu = useLopu();
	const { copy } = useSocialActions();

	const visibleAssetCount = features.length * TRENDS.length * SOCIAL_FORMATS.length;

	const gated = visibility.ready && !visibility.social;
	useMarketingSeo({
		title: gated ? 'Not published yet' : 'Social media image suite',
		description: gated
			? 'This part of the Thingtime marketing site is not published yet.'
			: `${formatCount(visibleAssetCount)} downloadable social images: ${features.length === FEATURES.length ? 'every' : formatCount(features.length)} Thingtime feature${
					features.length === 1 ? '' : 's'
			  } in ${TRENDS.length} viral styles and ${SOCIAL_FORMATS.length} platform formats, each with a ready-to-post caption.`
	});

	const select = React.useCallback(
		(patch: Partial<SocialSelection>) => {
			const next = { ...selection, ...patch };
			const params = new URLSearchParams(searchParams);
			params.set('feature', next.feature);
			params.set('trend', next.trend);
			params.set('format', next.format);
			setSearchParams(params, { replace: true, preventScrollReset: true });
			setMenuOpen(false);
		},
		[searchParams, selection, setSearchParams]
	);

	const downloadAll = async () => {
		if (progress) return;
		const plan = planDownloads(assets.length);
		const batch = assets.slice(0, plan.allowed);
		if (!batch.length) return;
		lopu({
			title: `Downloading ${batch.length} PNG${batch.length === 1 ? '' : 's'}…`,
			description: plan.skipped
				? `The browser cap is ${DOWNLOAD_BATCH_CAP} per batch, so ${formatCount(
						plan.skipped
				  )} are skipped. Pick one style or one format to get the rest.`
				: 'One at a time, so your browser does not block them.',
			status: 'info',
			duration: 6000
		});
		setProgress({ done: 0, total: batch.length });
		const result = await downloadSequentially(
			batch,
			async (asset) => {
				const size = SOCIAL_FORMAT_BY_KEY[asset.format];
				await downloadPng(buildSocialSvg(asset), size.width, size.height, socialAssetFilename(asset, 'png'));
			},
			350,
			(done, total) => setProgress({ done, total })
		);
		setProgress(null);
		lopu({
			title: result.failed ? `Downloaded ${result.done}, ${result.failed} failed` : `Downloaded ${result.done} PNG${result.done === 1 ? '' : 's'}`,
			description: plan.skipped ? `${formatCount(plan.skipped)} skipped this batch.` : undefined,
			status: result.failed ? 'error' : 'success',
			duration: 6000
		});
	};

	const featureLabel = `${feature.emoji} ${feature.name}`;
	const firstAsset = assets[0];
	const crumbs = [visibility.hub ? { to: MARKETING_BASE, label: 'Marketing' } : { label: 'Marketing' }, { label: 'Social images' }];

	if (!visibility.ready) return <MarketingColdStart />;
	if (!visibility.social) return <MarketingUnpublished surface={SUITE_SURFACE} active="social-media" crumbs={crumbs} />;

	if (!features.length) {
		return (
			<MarketingShell trend="bold-brutal" active="social-media" publication={SUITE_SURFACE}>
				<Crumbs items={crumbs} />
				<Box paddingY={12} textAlign="center" data-testid="social-empty">
					<Text fontSize="48px" aria-hidden="true">
						📸
					</Text>
					<Text as="h1" fontSize="clamp(28px, 4vw, 44px)" fontWeight={900} letterSpacing="-0.02em" margin={0} color={MK.ink}>
						Images are on their way
					</Text>
					<Text color={MK.text} marginTop={3} fontSize="16px" lineHeight={1.6} maxWidth="520px" marginX="auto">
						No image sets are published yet — check back soon.
					</Text>
				</Box>
			</MarketingShell>
		);
	}

	return (
		<MarketingShell trend={trend?.key ?? 'bold-brutal'} active="social-media" publication={SUITE_SURFACE}>
			<Crumbs items={crumbs} />

			<Box as="header" paddingTop={6} paddingBottom={6} maxWidth="860px">
				<Text
					as="p"
					fontFamily={MK.mono}
					fontSize="12px"
					fontWeight={700}
					letterSpacing="0.16em"
					textTransform="uppercase"
					color={MK.accent}
					margin="0 0 10px"
				>
					📸 Social media suite
				</Text>
				<Text as="h1" fontSize="clamp(34px, 5.5vw, 64px)" fontWeight={MK.weight} lineHeight={1} letterSpacing="-0.025em" color={MK.ink} margin={0}>
					Every feature, every style, every platform.
				</Text>
				<Text as="p" fontSize="15px" lineHeight={1.6} color={MK.text} margin="14px 0 0" data-testid="social-counts">
					{formatCount(features.length)} feature{features.length === 1 ? '' : 's'} × {TRENDS.length} styles × {SOCIAL_FORMATS.length} formats ={' '}
					<Text as="strong" color={MK.ink}>
						{formatCount(visibleAssetCount)} downloadable images
					</Text>
					, each rendered as a crisp SVG you can save as a PNG at the exact platform size, with a caption to match.
				</Text>
			</Box>

			<Box sx={{ [DESKTOP]: { display: 'none' } }} marginBottom={4}>
				<ToolButton onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="social-menu">
					<span aria-hidden="true">☰</span> Menu · {featureLabel}
					{trend ? ` · ${trend.emoji}` : ' · all styles'}
					{format ? ` · ${format.emoji}` : ' · all formats'}
				</ToolButton>
			</Box>

			<Flex gap={8} alignItems="flex-start" sx={{ [MOBILE]: { flexDirection: 'column', gap: 4 } }}>
				<Box
					as="aside"
					id="social-menu"
					aria-label="Choose a feature, style and format"
					flex="none"
					sx={{
						[DESKTOP]: {
							display: 'block',
							position: 'sticky',
							top: STICKY_TOP,
							width: '260px',
							maxHeight: `calc(100vh - ${STICKY_TOP} - 16px)`,
							overflowY: 'auto'
						},
						[MOBILE]: { display: menuOpen ? 'block' : 'none', width: '100%' }
					}}
					border={MK.border}
					borderRadius={MK.radius}
					background={MK.cardSolid}
					boxShadow={MK.shadow}
					padding={3}
					data-testid="social-menu"
				>
					<Box as="section" marginBottom={4}>
						<MenuHeading>Feature</MenuHeading>
						{FEATURE_CATEGORIES.map((category) => {
							const items = features.filter((entry) => entry.category === category);
							if (!items.length) return null;
							const label = FEATURE_CATEGORY_LABELS[category];
							return (
								<Box key={category}>
									<MenuSubheading>
										<span aria-hidden="true">{label.emoji}</span> {label.name}
									</MenuSubheading>
									{items.map((entry) => (
										<Flex key={entry.key} alignItems="center" gap={1}>
											<Box flex="1 1 auto" minWidth={0} opacity={visibility.everything && !visibility.isPublished(socialFeatureKey(entry.key)) ? 0.72 : 1}>
												<MenuItem selected={entry.key === featureKey} onClick={() => select({ feature: entry.key })}>
													<span aria-hidden="true">{entry.emoji}</span> {entry.name}
												</MenuItem>
											</Box>
											<PublishToggle publicationKey={socialFeatureKey(entry.key)} label={`${entry.name} image set`} iconOnly flex="none" />
										</Flex>
									))}
								</Box>
							);
						})}
					</Box>
					<Box as="section" marginBottom={4}>
						<MenuHeading>Style</MenuHeading>
						<MenuItem selected={trendKey === 'all'} onClick={() => select({ trend: 'all' })} sub={`${TRENDS.length} styles`}>
							<span aria-hidden="true">🌈</span> All styles
						</MenuItem>
						{TRENDS.map((entry) => (
							<MenuItem
								key={entry.key}
								selected={entry.key === trendKey}
								onClick={() => select({ trend: entry.key })}
								sub={entry.platforms.join(' · ')}
							>
								<span aria-hidden="true">{entry.emoji}</span> {entry.name}
							</MenuItem>
						))}
					</Box>
					<Box as="section">
						<MenuHeading>Format</MenuHeading>
						<MenuItem selected={formatKey === 'all'} onClick={() => select({ format: 'all' })} sub={`${SOCIAL_FORMATS.length} formats`}>
							<span aria-hidden="true">🗂️</span> All formats
						</MenuItem>
						{SOCIAL_FORMATS.map((entry) => (
							<MenuItem
								key={entry.key}
								selected={entry.key === formatKey}
								onClick={() => select({ format: entry.key })}
								sub={`${entry.platform} · ${entry.label}`}
							>
								<span aria-hidden="true">{entry.emoji}</span> {entry.name}
							</MenuItem>
						))}
					</Box>
				</Box>

				<Box flex="1 1 auto" minWidth={0} width="100%">
					<Flex
						as="section"
						aria-label="Current selection"
						gap={2}
						alignItems="center"
						flexWrap="wrap"
						padding={3}
						border={MK.border}
						borderRadius={MK.radius}
						background={MK.card}
						marginBottom={4}
						data-testid="social-toolbar"
					>
						<Flex gap={2} flexWrap="wrap" alignItems="center" flex="1 1 auto" minWidth={0}>
							<Pill
								label={featureLabel}
								onRemove={featureKey === DEFAULT_SELECTION.feature ? undefined : () => select({ feature: DEFAULT_SELECTION.feature })}
								removeLabel="Reset the feature to the default"
							/>
							{trend ? (
								<Pill label={`${trend.emoji} ${trend.name}`} onRemove={() => select({ trend: 'all' })} removeLabel="Show all styles" />
							) : (
								<Pill label="🌈 All styles" />
							)}
							{format ? (
								<Pill
									label={`${format.emoji} ${format.name} · ${format.label}`}
									onRemove={() => select({ format: 'all' })}
									removeLabel="Show all formats"
								/>
							) : (
								<Pill label="🗂️ All formats" />
							)}
							<Text as="span" fontFamily={MK.mono} fontSize="11px" color={MK.muted}>
								{formatCount(assets.length)} image{assets.length === 1 ? '' : 's'}
							</Text>
						</Flex>
						<Flex gap={2} flexWrap="wrap">
							<ToolButton primary onClick={downloadAll} disabled={!!progress} aria-busy={!!progress} data-testid="social-download-all">
								{progress ? `Downloading ${progress.done}/${progress.total}…` : `⬇️ Download all shown (PNG)`}
							</ToolButton>
							<ToolButton onClick={() => firstAsset && copy(socialCaption(firstAsset), 'Caption')} aria-label={`Copy caption for ${feature.name}`}>
								📋 Copy caption
							</ToolButton>
							<ToolButton onClick={() => setShowCaptions((open) => !open)} aria-expanded={showCaptions} aria-controls="social-captions">
								💬 Captions per platform {showCaptions ? '▴' : '▾'}
							</ToolButton>
						</Flex>
					</Flex>

					{showCaptions ? (
						<Box id="social-captions" marginBottom={6}>
							<SocialCaptionPanel feature={featureKey} />
						</Box>
					) : null}

					{trend ? (
						<Box as="nav" aria-label="Quick picks" marginBottom={5} data-testid="social-quick-picks">
							<Text as="p" fontFamily={MK.mono} fontSize="11px" letterSpacing="0.12em" textTransform="uppercase" color={MK.muted} margin="0 0 6px">
								Same feature, other styles
							</Text>
							<Flex gap={1.5} flexWrap="wrap">
								{TRENDS.filter((entry) => entry.key !== trend.key).map((entry) => (
									<QuickChip key={entry.key} to={socialHref({ ...selection, trend: entry.key })}>
										<span aria-hidden="true">{entry.emoji}</span> {entry.name}
									</QuickChip>
								))}
								<QuickChip to={socialHref({ ...selection, trend: 'all' })}>
									<span aria-hidden="true">🌈</span> All styles
								</QuickChip>
							</Flex>
							{format ? (
								<>
									<Text
										as="p"
										fontFamily={MK.mono}
										fontSize="11px"
										letterSpacing="0.12em"
										textTransform="uppercase"
										color={MK.muted}
										margin="12px 0 6px"
									>
										Other formats
									</Text>
									<Flex gap={1.5} flexWrap="wrap">
										{SOCIAL_FORMATS.filter((entry) => entry.key !== format.key).map((entry) => (
											<QuickChip key={entry.key} to={socialHref({ ...selection, format: entry.key })}>
												<span aria-hidden="true">{entry.emoji}</span> {entry.name}
											</QuickChip>
										))}
										<QuickChip to={socialHref({ ...selection, format: 'all' })}>
											<span aria-hidden="true">🗂️</span> All formats
										</QuickChip>
									</Flex>
								</>
							) : null}
						</Box>
					) : null}

					<Box data-testid="social-grid" data-count={assets.length} display="grid" gap={7}>
						{groups.map((group) => (
							<Box as="section" key={group.key} aria-label={group.heading || featureLabel}>
								{group.heading ? (
									<Flex alignItems="baseline" gap={3} flexWrap="wrap" marginBottom={3}>
										<Text as="h2" fontSize="18px" fontWeight={900} letterSpacing="-0.01em" color={MK.ink} margin={0}>
											{group.heading}
										</Text>
										{group.sub ? (
											<Text as="span" fontFamily={MK.mono} fontSize="11px" color={MK.muted}>
												{group.sub}
											</Text>
										) : null}
									</Flex>
								) : null}
								<Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(min(280px, 100%), 1fr))" gap={5}>
									{group.assets.map((asset) => (
										<SocialImageCard key={socialAssetKey(asset)} asset={asset} compact={compact} showCaption={assets.length === 1} />
									))}
								</Box>
							</Box>
						))}
					</Box>
				</Box>
			</Flex>
		</MarketingShell>
	);
}
