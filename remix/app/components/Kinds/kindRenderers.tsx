import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { ChakraThingRenderer, isChakraThingNode } from './ChakraThingRenderer';
import type { ChakraThingNode } from './ChakraThingRenderer';
import { HtmlThingRenderer } from './HtmlThingRenderer';
import type { HtmlThingNode } from './HtmlThingRenderer';
import { registerKindRenderer } from './kindRegistry';
import type { KindRenderContext } from './kindRegistry';
import { Avatar, KindBadge, KindCard, MutedMono, Sparkline, formatPrice, maybeTimeAgo, toArray, toNumberOr, toStringOr } from './kindPrimitives';
import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '~/components/ComponentsLibrary/componentTemplate';
import { useTtActionClicks } from '~/components/Actions/useTtActionClicks';
import { safeCssUrl, safeUrl } from './safeUrl';

// The original core kind renderers: the templates a feed/search/page can use
// to render things by kind. Category files (kindRenderersMedia/Social/
// Commerce/Planning/Knowledge) extend the gallery; importing
// '~/components/Kinds' registers everything.

// ————— 📝 post —————

type PostValue = {
	authorName: string;
	authorHandle: string;
	avatarUrl: string | null;
	text: string;
	createdAt: string;
	tags: string[];
	reactions: Array<{ emoji: string; count: number }>;
	commentCount: number | null;
};

const PostRenderer = ({ value }: { value: PostValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Avatar name={value.authorName} src={value.avatarUrl} />
			<Box minW={0} flex="1">
				<Flex alignItems="baseline" columnGap={2} flexWrap="wrap">
					<Text fontSize="sm" fontWeight={750} color="var(--tt-ink, #16161a)">
						{value.authorName}
					</Text>
					{value.authorHandle ? <MutedMono>@{value.authorHandle}</MutedMono> : null}
					{value.createdAt ? <MutedMono>· {maybeTimeAgo(value.createdAt)}</MutedMono> : null}
				</Flex>
				<Text color="var(--tt-text, #5a5a66)" fontSize="md" lineHeight="1.6" marginTop={1} whiteSpace="pre-wrap">
					{value.text}
				</Text>
				{value.tags.length ? (
					<Flex columnGap={1.5} flexWrap="wrap" marginTop={2} rowGap={1.5}>
						{value.tags.map((tag) => (
							<KindBadge key={tag} tone="accent">
								#{tag}
							</KindBadge>
						))}
					</Flex>
				) : null}
				{value.reactions.length || value.commentCount !== null ? (
					<Flex alignItems="center" columnGap={3} marginTop={3}>
						{value.reactions.map((reaction) => (
							<Flex key={reaction.emoji} alignItems="center" columnGap={1} fontSize="sm">
								<span>{reaction.emoji}</span>
								<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={700}>
									{reaction.count}
								</Text>
							</Flex>
						))}
						{value.commentCount !== null ? (
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={600}>
								💬 {value.commentCount}
							</Text>
						) : null}
					</Flex>
				) : null}
			</Box>
		</Flex>
	</KindCard>
);

// ————— 🎥 video —————

type VideoValue = {
	title: string;
	src: string | null;
	poster: string | null;
	url: string | null;
	channel: string;
	duration: string;
	views: string;
};

const VideoRenderer = ({ value }: { value: VideoValue; context: KindRenderContext }) => {
	// scheme-guard every URL sink so untrusted video data can't reach a
	// javascript: link, an unsafe media src/poster, or a CSS url() breakout
	const src = safeUrl(value.src);
	const poster = safeUrl(value.poster);
	const posterBg = safeCssUrl(value.poster);
	const url = safeUrl(value.url);
	return (
	<KindCard padding={0}>
		<Box position="relative" width="100%" paddingTop="56.25%" background="var(--tt-ink, #16161a)">
			{src ? (
				<Box
					as="video"
					controls
					poster={poster || undefined}
					src={src}
					position="absolute"
					inset={0}
					width="100%"
					height="100%"
				/>
			) : (
				<Flex
					as={url ? 'a' : 'div'}
					{...(url ? { href: url, target: '_blank', rel: 'noopener noreferrer' } : {})}
					alignItems="center"
					justifyContent="center"
					position="absolute"
					inset={0}
					backgroundImage={posterBg || 'linear-gradient(135deg, #2b2540 0%, #4a2d55 55%, #1c2a42 100%)'}
					backgroundSize="cover"
					backgroundPosition="center"
				>
					<Flex
						alignItems="center"
						justifyContent="center"
						background="rgba(255,255,255,0.92)"
						borderRadius="999px"
						boxShadow="0 8px 30px rgba(0,0,0,0.35)"
						fontSize="22px"
						height="56px"
						paddingLeft="4px"
						width="56px"
					>
						▶
					</Flex>
				</Flex>
			)}
			{value.duration ? (
				<Box
					position="absolute"
					bottom={2}
					right={2}
					background="rgba(0,0,0,0.75)"
					borderRadius="6px"
					color="white"
					fontFamily="var(--tt-font-mono, monospace)"
					fontSize="11px"
					paddingX="6px"
					paddingY="2px"
				>
					{value.duration}
				</Box>
			) : null}
		</Box>
		<Box padding={4}>
			<Text fontSize="md" fontWeight={750} color="var(--tt-ink, #16161a)" noOfLines={2}>
				{value.title}
			</Text>
			<Flex columnGap={2} marginTop={1}>
				{value.channel ? <MutedMono>{value.channel}</MutedMono> : null}
				{value.views ? <MutedMono>· {value.views} views</MutedMono> : null}
			</Flex>
		</Box>
	</KindCard>
	);
};

// ————— 🏪 marketplace listing —————

type ListingValue = {
	title: string;
	price: number | null;
	currency: string;
	condition: string;
	location: string;
	sold: boolean;
	image: string | null;
	description: string;
	seller: string;
};

const ListingRenderer = ({ value }: { value: ListingValue; context: KindRenderContext }) => {
	const imageBg = safeCssUrl(value.image);
	return (
	<KindCard padding={0}>
		<Flex flexWrap="wrap">
			<Box
				background={
					imageBg
						? undefined
						: 'linear-gradient(135deg, var(--tt-accent-tint, #fff5fa) 0%, var(--tt-surface-alt, #f5f5f7) 100%)'
				}
				backgroundImage={imageBg}
				backgroundPosition="center"
				backgroundSize="cover"
				flex="1 1 180px"
				minHeight="150px"
				position="relative"
			>
				{!imageBg ? (
					<Flex alignItems="center" height="100%" justifyContent="center" fontSize="42px" opacity={0.85}>
						🏪
					</Flex>
				) : null}
				{value.sold ? (
					<Flex position="absolute" inset={0} alignItems="center" justifyContent="center" background="rgba(255,255,255,0.72)">
						<KindBadge tone="danger">SOLD</KindBadge>
					</Flex>
				) : null}
			</Box>
			<Box flex="2 1 240px" padding={4}>
				<Flex alignItems="baseline" columnGap={3} flexWrap="wrap">
					<Text fontSize="lg" fontWeight={800} color="var(--tt-ink, #16161a)">
						{formatPrice(value.price, value.currency)}
					</Text>
					{value.condition ? <KindBadge>{value.condition}</KindBadge> : null}
				</Flex>
				<Text fontSize="md" fontWeight={650} color="var(--tt-ink, #16161a)" marginTop={1}>
					{value.title}
				</Text>
				{value.description ? (
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.55" marginTop={1} noOfLines={3}>
						{value.description}
					</Text>
				) : null}
				<Flex columnGap={2} flexWrap="wrap" marginTop={3} rowGap={1}>
					{value.location ? <MutedMono>📍 {value.location}</MutedMono> : null}
					{value.seller ? <MutedMono>👤 {value.seller}</MutedMono> : null}
				</Flex>
			</Box>
		</Flex>
	</KindCard>
	);
};

// ————— 📊 dashboard —————

type DashboardMetric = {
	label: string;
	value: string;
	change: number | null;
	series: number[];
};

type DashboardValue = {
	title: string;
	metrics: DashboardMetric[];
};

const DashboardRenderer = ({ value }: { value: DashboardValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? (
			<Text fontSize="sm" fontWeight={800} color="var(--tt-ink, #16161a)" marginBottom={3}>
				{value.title}
			</Text>
		) : null}
		<Grid gap={3} templateColumns="repeat(auto-fit, minmax(130px, 1fr))">
			{value.metrics.map((metric) => {
				const positive = (metric.change ?? 0) >= 0;

				return (
					<Box
						key={metric.label}
						background="var(--tt-surface, #fafafb)"
						border="1px solid var(--tt-border-light, #f0f0f2)"
						borderRadius="var(--tt-radius-md, 12px)"
						padding={3}
					>
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="11px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase">
							{metric.label}
						</Text>
						<Flex alignItems="baseline" columnGap={2} marginTop={1}>
							<Text fontSize="xl" fontWeight={800} color="var(--tt-ink, #16161a)">
								{metric.value}
							</Text>
							{metric.change !== null ? (
								<Text color={positive ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-danger, #d6455a)'} fontSize="xs" fontWeight={800}>
									{positive ? '▲' : '▼'} {Math.abs(metric.change)}%
								</Text>
							) : null}
						</Flex>
						{metric.series.length ? <Sparkline positive={positive} series={metric.series} /> : null}
					</Box>
				);
			})}
		</Grid>
	</KindCard>
);

// ————— 📍 place / geo —————

type PlaceValue = {
	name: string;
	lat: number | null;
	lng: number | null;
	address: string;
	note: string;
};

const PlaceRenderer = ({ value }: { value: PlaceValue; context: KindRenderContext }) => {
	const hasCoords = value.lat !== null && value.lng !== null;
	const x = hasCoords ? ((value.lng! + 180) / 360) * 100 : 50;
	const y = hasCoords ? ((90 - value.lat!) / 180) * 100 : 50;

	return (
		<KindCard padding={0}>
			<Box
				position="relative"
				height="130px"
				background="linear-gradient(180deg, #dcefe2 0%, #cfe6ef 100%)"
				overflow="hidden"
			>
				{/* graticule lines give it a "map" feel without external tiles */}
				<Box as="svg" viewBox="0 0 100 40" width="100%" height="100%" preserveAspectRatio="none" position="absolute" inset={0} aria-hidden>
					{[10, 20, 30].map((gy) => (
						<line key={`h${gy}`} x1="0" y1={gy} x2="100" y2={gy} stroke="rgba(255,255,255,0.65)" strokeWidth="0.3" />
					))}
					{[12.5, 25, 37.5, 50, 62.5, 75, 87.5].map((gx) => (
						<line key={`v${gx}`} x1={gx} y1="0" x2={gx} y2="40" stroke="rgba(255,255,255,0.65)" strokeWidth="0.3" />
					))}
				</Box>
				<Box position="absolute" left={`${x}%`} top={`${y}%`} transform="translate(-50%, -90%)" fontSize="26px" filter="drop-shadow(0 3px 4px rgba(0,0,0,0.25))">
					📍
				</Box>
			</Box>
			<Box padding={4}>
				<Text fontSize="md" fontWeight={750} color="var(--tt-ink, #16161a)">
					{value.name}
				</Text>
				{value.address ? (
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm" marginTop={0.5}>
						{value.address}
					</Text>
				) : null}
				{value.note ? (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" lineHeight="1.55" marginTop={1}>
						{value.note}
					</Text>
				) : null}
				<Flex alignItems="center" columnGap={3} marginTop={2}>
					{hasCoords ? (
						<>
							<MutedMono>
								{value.lat!.toFixed(4)}, {value.lng!.toFixed(4)}
							</MutedMono>
							<Box
								as="a"
								href={`https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=13/${value.lat}/${value.lng}`}
								target="_blank"
								rel="noopener noreferrer"
								color="var(--tt-link, #2f8fd6)"
								fontSize="xs"
								fontWeight={700}
							>
								Open map ↗
							</Box>
						</>
					) : (
						<MutedMono>No coordinates yet</MutedMono>
					)}
				</Flex>
			</Box>
		</KindCard>
	);
};

// ————— 🗞️ news / political analysis —————

type NewsClaim = { claim: string; verdict: string };
type NewsPerspective = { outlet: string; lean: string; take: string };

type NewsValue = {
	headline: string;
	summary: string;
	// -1 (left) … 1 (right)
	bias: number | null;
	claims: NewsClaim[];
	perspectives: NewsPerspective[];
	sources: string[];
};

const verdictTone = (verdict: string): 'positive' | 'danger' | 'default' => {
	const v = verdict.toLowerCase();
	if (['true', 'verified', 'accurate', 'supported'].some((word) => v.includes(word))) return 'positive';
	if (['false', 'misleading', 'debunked', 'wrong'].some((word) => v.includes(word))) return 'danger';
	return 'default';
};

const NewsAnalysisRenderer = ({ value }: { value: NewsValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={2} marginBottom={2}>
			<KindBadge>🗞️ Analysis</KindBadge>
			{value.sources.length ? <MutedMono>{value.sources.length} sources</MutedMono> : null}
		</Flex>
		<Text fontSize="lg" fontWeight={800} lineHeight="1.3" color="var(--tt-ink, #16161a)">
			{value.headline}
		</Text>
		{value.summary ? (
			<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" marginTop={2}>
				{value.summary}
			</Text>
		) : null}

		{value.bias !== null ? (
			<Box marginTop={4}>
				<Flex justifyContent="space-between" marginBottom={1}>
					<MutedMono>Lean left</MutedMono>
					<MutedMono>Centre</MutedMono>
					<MutedMono>Lean right</MutedMono>
				</Flex>
				<Box position="relative" height="8px" borderRadius="999px" background="linear-gradient(90deg, #7aa7e8 0%, #d8d8de 50%, #e88f7a 100%)">
					<Box
						position="absolute"
						left={`${((Math.max(-1, Math.min(1, value.bias)) + 1) / 2) * 100}%`}
						top="50%"
						transform="translate(-50%, -50%)"
						width="16px"
						height="16px"
						borderRadius="999px"
						background="var(--tt-card, #ffffff)"
						border="3px solid var(--tt-ink, #16161a)"
						boxShadow="0 1px 4px rgba(0,0,0,0.25)"
					/>
				</Box>
			</Box>
		) : null}

		{value.claims.length ? (
			<Box marginTop={4}>
				<MutedMono>Claim check</MutedMono>
				<Flex flexDirection="column" marginTop={2} rowGap={2}>
					{value.claims.map((item) => (
						<Flex key={item.claim} alignItems="flex-start" columnGap={2}>
							<KindBadge tone={verdictTone(item.verdict)}>{item.verdict}</KindBadge>
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.5">
								{item.claim}
							</Text>
						</Flex>
					))}
				</Flex>
			</Box>
		) : null}

		{value.perspectives.length ? (
			<Box marginTop={4}>
				<MutedMono>Perspectives</MutedMono>
				<Grid gap={2} marginTop={2} templateColumns="repeat(auto-fit, minmax(160px, 1fr))">
					{value.perspectives.map((perspective) => (
						<Box
							key={perspective.outlet}
							background="var(--tt-surface, #fafafb)"
							border="1px solid var(--tt-border-light, #f0f0f2)"
							borderRadius="var(--tt-radius-md, 12px)"
							padding={3}
						>
							<Flex alignItems="center" columnGap={2}>
								<Text fontSize="xs" fontWeight={800} color="var(--tt-ink, #16161a)">
									{perspective.outlet}
								</Text>
								<KindBadge>{perspective.lean}</KindBadge>
							</Flex>
							<Text color="var(--tt-text, #5a5a66)" fontSize="xs" lineHeight="1.5" marginTop={1}>
								{perspective.take}
							</Text>
						</Box>
					))}
				</Grid>
			</Box>
		) : null}
	</KindCard>
);

// ————— ⚖️ comparison —————

type ComparisonValue = {
	title: string;
	names: string[];
	criteria: Array<{ label: string; values: string[] }>;
};

const ComparisonRenderer = ({ value, context }: { value: ComparisonValue; context: KindRenderContext }) => {
	const compact = context.size === 'compact';

	if (compact) {
		// small containers: one stacked card per item instead of a table
		return (
			<KindCard>
				{value.title ? (
					<Text fontSize="sm" fontWeight={800} marginBottom={3} color="var(--tt-ink, #16161a)">
						{value.title}
					</Text>
				) : null}
				<Flex flexDirection="column" rowGap={3}>
					{value.names.map((name, itemIdx) => (
						<Box key={`${name}-${itemIdx}`} background="var(--tt-surface, #fafafb)" border="1px solid var(--tt-border-light, #f0f0f2)" borderRadius="var(--tt-radius-md, 12px)" padding={3}>
							<Text fontSize="sm" fontWeight={800} color="var(--tt-ink, #16161a)">
								{name}
							</Text>
							{value.criteria.map((criterion) => (
								<Flex key={criterion.label} justifyContent="space-between" columnGap={3} marginTop={1.5}>
									<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={600}>
										{criterion.label}
									</Text>
									<Text color="var(--tt-text, #5a5a66)" fontSize="xs" fontWeight={700} textAlign="right">
										{criterion.values[itemIdx] ?? '—'}
									</Text>
								</Flex>
							))}
						</Box>
					))}
				</Flex>
			</KindCard>
		);
	}

	return (
		<KindCard padding={0}>
			{value.title ? (
				<Text fontSize="sm" fontWeight={800} padding={4} paddingBottom={2} color="var(--tt-ink, #16161a)">
					{value.title}
				</Text>
			) : null}
			<Box overflowX="auto">
				<Box as="table" width="100%" style={{ borderCollapse: 'collapse' }}>
					<Box as="thead">
						<Box as="tr" background="var(--tt-surface, #fafafb)">
							<Box as="th" padding={3} textAlign="left">
								<MutedMono>Criteria</MutedMono>
							</Box>
							{value.names.map((name, itemIdx) => (
								<Box as="th" key={`${name}-${itemIdx}`} padding={3} textAlign="left">
									<Text fontSize="sm" fontWeight={800} color="var(--tt-ink, #16161a)" whiteSpace="nowrap">
										{name}
									</Text>
								</Box>
							))}
						</Box>
					</Box>
					<Box as="tbody">
						{value.criteria.map((criterion) => (
							<Box as="tr" key={criterion.label} borderTop="1px solid var(--tt-border-light, #f0f0f2)">
								<Box as="td" padding={3}>
									<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={700}>
										{criterion.label}
									</Text>
								</Box>
								{criterion.values.map((cell, idx) => (
									<Box as="td" key={idx} padding={3}>
										<Text color="var(--tt-text, #5a5a66)" fontSize="sm" fontWeight={600}>
											{cell || '—'}
										</Text>
									</Box>
								))}
							</Box>
						))}
					</Box>
				</Box>
			</Box>
		</KindCard>
	);
};

// ————— 📈 chart —————

type ChartValue = {
	title: string;
	type: 'bar' | 'line';
	labels: string[];
	values: number[];
	unit: string;
};

const ChartRenderer = ({ value }: { value: ChartValue; context: KindRenderContext }) => {
	const max = Math.max(...value.values, 1);

	return (
		<KindCard>
			{value.title ? (
				<Text fontSize="sm" fontWeight={800} marginBottom={3} color="var(--tt-ink, #16161a)">
					{value.title}
				</Text>
			) : null}
			{value.type === 'line' ? (
				<Box as="svg" viewBox="0 0 100 40" width="100%" height="120px" preserveAspectRatio="none" aria-hidden>
					<polyline
						points={value.values
							.map((v, idx) => `${(idx / Math.max(value.values.length - 1, 1)) * 100},${38 - (v / max) * 34}`)
							.join(' ')}
						fill="none"
						stroke="var(--tt-accent, hotpink)"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				</Box>
			) : (
				<Flex alignItems="flex-end" columnGap={2} height="120px">
					{value.values.map((v, idx) => (
						<Flex key={idx} flex="1" flexDirection="column" alignItems="center" rowGap={1} height="100%" justifyContent="flex-end">
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={700}>
								{v}
								{value.unit}
							</Text>
							<Box
								width="100%"
								maxWidth="44px"
								borderRadius="6px 6px 2px 2px"
								background="linear-gradient(180deg, var(--tt-accent, hotpink) 0%, var(--tt-accent-tint, #ffd1e8) 100%)"
								height={`${Math.max((v / max) * 100, 3)}%`}
							/>
						</Flex>
					))}
				</Flex>
			)}
			<Flex columnGap={2} marginTop={2}>
				{value.labels.map((label) => (
					<Text key={label} flex="1" color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={600} textAlign="center" noOfLines={1}>
						{label}
					</Text>
				))}
			</Flex>
		</KindCard>
	);
};

// ————— 👤 profile —————

type ProfileValue = {
	displayName: string;
	username: string;
	bio: string;
	avatarUrl: string | null;
	bannerUrl: string | null;
	stats: Array<{ label: string; value: string }>;
};

const ProfileRenderer = ({ value }: { value: ProfileValue; context: KindRenderContext }) => {
	const bannerBg = safeCssUrl(value.bannerUrl);
	return (
	<KindCard padding={0}>
		<Box
			height="72px"
			background={
				bannerBg
					? undefined
					: 'linear-gradient(90deg, #ffd1e8 0%, #ffe9c7 30%, #d5f6dd 60%, #cfe4ff 100%)'
			}
			backgroundImage={bannerBg}
			backgroundPosition="center"
			backgroundSize="cover"
		/>
		<Box padding={4} paddingTop={0}>
			<Box marginTop="-24px" display="inline-block" borderRadius="999px" border="3px solid var(--tt-card, #ffffff)">
				<Avatar name={value.displayName || value.username} size={52} src={value.avatarUrl} />
			</Box>
			<Text fontSize="md" fontWeight={800} color="var(--tt-ink, #16161a)" marginTop={1}>
				{value.displayName || value.username}
			</Text>
			{value.username ? <MutedMono>@{value.username}</MutedMono> : null}
			{value.bio ? (
				<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.55" marginTop={2}>
					{value.bio}
				</Text>
			) : null}
			{value.stats.length ? (
				<Flex columnGap={4} marginTop={3}>
					{value.stats.map((stat) => (
						<Box key={stat.label}>
							<Text fontSize="sm" fontWeight={800} color="var(--tt-ink, #16161a)">
								{stat.value}
							</Text>
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase">
								{stat.label}
							</Text>
						</Box>
					))}
				</Flex>
			) : null}
		</Box>
	</KindCard>
	);
};

// ————— 🍳 recipe —————

type RecipeValue = {
	title: string;
	time: string;
	serves: string;
	ingredients: string[];
	steps: string[];
};

const RecipeRenderer = ({ value }: { value: RecipeValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={2} flexWrap="wrap">
			<Text fontSize="md" fontWeight={800} color="var(--tt-ink, #16161a)">
				🍳 {value.title}
			</Text>
			{value.time ? <KindBadge>⏰ {value.time}</KindBadge> : null}
			{value.serves ? <KindBadge>👥 serves {value.serves}</KindBadge> : null}
		</Flex>
		<Grid gap={4} marginTop={3} templateColumns="repeat(auto-fit, minmax(180px, 1fr))">
			<Box>
				<MutedMono>Ingredients</MutedMono>
				<Flex flexDirection="column" marginTop={2} rowGap={1.5}>
					{value.ingredients.map((ingredient) => (
						<Flex key={ingredient} columnGap={2} alignItems="baseline">
							<Text color="var(--tt-positive, #2f8f4f)" fontSize="xs">
								•
							</Text>
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
								{ingredient}
							</Text>
						</Flex>
					))}
				</Flex>
			</Box>
			<Box>
				<MutedMono>Steps</MutedMono>
				<Flex flexDirection="column" marginTop={2} rowGap={2}>
					{value.steps.map((step, idx) => (
						<Flex key={step} columnGap={2} alignItems="baseline">
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" fontWeight={700}>
								{idx + 1}.
							</Text>
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.55">
								{step}
							</Text>
						</Flex>
					))}
				</Flex>
			</Box>
		</Grid>
	</KindCard>
);

// ————— 🧱 element (JSON → html/css) —————

const ElementRenderer = ({ value }: { value: HtmlThingNode; context: KindRenderContext }) => (
	<Box width="100%">
		<HtmlThingRenderer node={value} />
	</Box>
);

// ————— 🎛 chakra (JSON → Chakra components) —————

const ChakraKindRenderer = ({ value }: { value: ChakraThingNode; context: KindRenderContext }) => (
	<Box width="100%">
		<ChakraThingRenderer node={value} />
	</Box>
);

// ————— 🧩 component (arg-templated element/chakra tree) —————

type ComponentKindValue = { render: unknown; values: Record<string, string | number | boolean | undefined> };

const ComponentKindRenderer = ({ value, context }: { value: ComponentKindValue; context: KindRenderContext }) => {
	// Memoised like the /components preview: resolution walks the whole template
	// under the MAX_RESOLVED_VALUES budget, so a feed or search page listing
	// several component things would redo that work on every parent render.
	// adapt() rebuilds `values` on every RenderThing pass, so the memo keys on
	// its content — a bounded scalar map (≤ MAX_COMPONENT_SAVED_ARGS entries) —
	// rather than its identity, which would never hit.
	const valuesKey = JSON.stringify(value.values);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- valuesKey is the serialised form of value.values
	const resolved = React.useMemo(() => resolveTemplate(value.render, value.values), [value.render, valuesKey]);
	// ttAction controls fire only on the trusted /things render surface — a
	// component-kind thing rendered through the kind registry in your own app,
	// where context.untrusted is false. Untrusted feed/search renders pass
	// context.untrusted and get no handler. NOTE the /components catalog and
	// its args tester draw the same template DIRECTLY through the sanitising
	// renderers (ComponentPreview / ComponentDetailPage), bypassing this
	// wrapper — so authoring and browsing a component never fire a
	// side-effectful action run; explicit execution lives on the /actions run
	// panel. Keep those preview paths off this wrapper deliberately.
	const onTtAction = useTtActionClicks();
	return (
		<Box onClickCapture={context.untrusted ? undefined : onTtAction} width="100%">
			{isChakraThingNode(resolved) ? (
				<ChakraThingRenderer node={resolved as ChakraThingNode} />
			) : (
				<HtmlThingRenderer node={resolved as HtmlThingNode} />
			)}
		</Box>
	);
};

// ————— 🧱 webpage (block-based page from the /builder) —————

type WebpageKindValue = {
	name: string;
	siteRoute: string | null;
	blockCount: number;
	types: string[];
};

const WEBPAGE_TYPE_EMOJI: Record<string, string> = {
	component: '🧩',
	container: '📐',
	text: '📝',
	native: '🖥'
};

// Quiet card preview — a full page never draws inside a grid tile; the real
// render surface is /p/<id> (or the builder canvas).
const WebpageKindRenderer = ({ value, context }: { value: WebpageKindValue; context: KindRenderContext }) => (
	<Flex
		alignItems="center"
		columnGap="10px"
		width="100%"
		padding={context.size === 'compact' ? '6px 8px' : '10px 12px'}
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-card, #ffffff)"
	>
		<Text fontSize={context.size === 'compact' ? '16px' : '20px'}>🧱</Text>
		<Box minWidth={0} flex={1}>
			<Text color="var(--tt-ink, #16161a)" fontSize={context.size === 'compact' ? 'xs' : 'sm'} fontWeight={700} noOfLines={1}>
				{value.name}
			</Text>
			<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="10px" noOfLines={1}>
				{value.siteRoute ? `site page · ${value.siteRoute}` : `${value.blockCount} block${value.blockCount === 1 ? '' : 's'}`}
				{value.types.length ? ` · ${value.types.map((type) => WEBPAGE_TYPE_EMOJI[type] || type).join(' ')}` : ''}
			</Text>
		</Box>
	</Flex>
);

// ————— ⚡ action (declarative capability-bounded program) —————

type ActionKindValue = {
	name: string;
	actionKey: string | null;
	description: string | null;
	ops: string[];
	stepCount: number;
	capabilityCount: number;
};

// Minimalist, Apple-like: quiet tinted dots per op tone instead of loud
// badges, hairline chip borders, tokens throughout. Sizes ride the existing
// context scale (compact → sm row, card → md, full → lg with description).
const ACTION_OP_DOTS: Record<string, string> = {
	'things.create': 'var(--tt-warning, #e8a33d)',
	'things.update': 'var(--tt-warning, #e8a33d)',
	'things.get': 'var(--tt-link, #4c7dff)',
	'things.search': 'var(--tt-link, #4c7dff)',
	'actions.invoke': 'var(--tt-accent, #7c6cff)',
	return: 'var(--tt-muted, #9a9aa6)'
};

const ActionKindRenderer = ({ value, context }: { value: ActionKindValue; context: KindRenderContext }) => {
	const size = context.size === 'compact' ? 'sm' : context.size === 'full' ? 'lg' : 'md';
	const nameSize = size === 'sm' ? '13px' : size === 'lg' ? '16px' : '14px';
	return (
		<Box width="100%">
			<Flex align="center" gap={2} minW={0}>
				<Text fontSize={nameSize} lineHeight="1.2">
					⚡
				</Text>
				<Text color="var(--tt-ink, #16161a)" fontSize={nameSize} fontWeight="600" isTruncated>
					{value.name}
				</Text>
				<Flex align="center" gap="5px" ml="auto">
					{value.ops.map((op) => (
						<Box background={ACTION_OP_DOTS[op] || 'var(--tt-muted, #9a9aa6)'} borderRadius="full" height="6px" key={op} title={op} width="6px" />
					))}
				</Flex>
			</Flex>
			{size !== 'sm' ? (
				<Flex align="center" gap={2} mt={1.5} wrap="wrap">
					{value.actionKey ? <MutedMono>{value.actionKey}</MutedMono> : null}
					<MutedMono>
						{value.stepCount} step{value.stepCount === 1 ? '' : 's'} · {value.capabilityCount}{' '}
						{value.capabilityCount === 1 ? 'capability' : 'capabilities'}
					</MutedMono>
				</Flex>
			) : null}
			{size === 'lg' && value.description ? (
				<Text color="var(--tt-text, #33333c)" fontSize="13px" mt={2}>
					{value.description}
				</Text>
			) : null}
		</Box>
	);
};

// ————— registration —————
// Wrapped in an exported function (called lazily by kindRegistry) instead of running
// at module scope: remix/package.json sets "sideEffects": false, so a bare
// `import './kindRenderers'` gets tree-shaken out of production builds and
// the registry ships empty (dev serves modules unbundled, hiding it).

export const registerCoreKinds = () => {

registerKindRenderer({
	kind: 'post',
	title: 'Text post',
	emoji: '📝',
	category: 'Social',
	description: 'A social text post — author, message, tags, and reactions.',
	aliases: ['text-post', 'text', 'note'],
	match: (thing) => typeof thing.text === 'string' && ('author' in thing || 'reactionCounts' in thing || 'reactions' in thing),
	adapt: (thing): PostValue | null => {
		const author = (thing.author || {}) as Record<string, unknown>;
		const text = toStringOr(thing.text, toStringOr(thing.body));
		if (!text) return null;

		const reactionCounts = (thing.reactionCounts || thing.reactions || {}) as Record<string, unknown>;
		const reactions = Object.entries(reactionCounts)
			.map(([emoji, count]) => ({ emoji, count: toNumberOr(count, 0) || 0 }))
			.filter((item) => item.count > 0);

		return {
			authorName: toStringOr(author.displayName, toStringOr(author.name, toStringOr(author.username, 'Someone'))),
			authorHandle: toStringOr(author.username),
			avatarUrl: toStringOr(author.avatarUrl) || null,
			text,
			createdAt: toStringOr(thing.createdAt),
			tags: toArray(thing.tags).map((tag) => toStringOr(tag)).filter(Boolean),
			reactions,
			commentCount: toNumberOr(thing.commentCount)
		};
	},
	render: PostRenderer
});

registerKindRenderer({
	kind: 'video',
	title: 'Video',
	emoji: '🎥',
	category: 'Media',
	description: 'A watchable video — player or poster with title, channel, and duration.',
	aliases: ['movie', 'clip'],
	match: (thing) => typeof thing.videoUrl === 'string' || (typeof thing.src === 'string' && String(thing.src).match(/\.(mp4|webm|mov)($|\?)/i) !== null),
	adapt: (thing): VideoValue | null => {
		const src = toStringOr(thing.src, toStringOr(thing.videoUrl));
		const url = toStringOr(thing.url, toStringOr(thing.link));
		const title = toStringOr(thing.title, toStringOr(thing.name, 'Untitled video'));
		if (!src && !url && !thing.poster && !thing.thumbnail) return null;

		return {
			title,
			src: src && /\.(mp4|webm|mov)($|\?)/i.test(src) ? src : null,
			poster: toStringOr(thing.poster, toStringOr(thing.thumbnail)) || null,
			url: url || src || null,
			channel: toStringOr(thing.channel, toStringOr(thing.creator)),
			duration: toStringOr(thing.duration),
			views: toStringOr(thing.views)
		};
	},
	render: VideoRenderer
});

registerKindRenderer({
	kind: 'listing',
	title: 'Marketplace listing',
	emoji: '🏪',
	category: 'Commerce',
	description: 'Something for sale — price, condition, location, and seller.',
	aliases: ['marketplace', 'for-sale', 'product'],
	match: (thing) => ('price' in thing && ('title' in thing || 'name' in thing)) || 'listing' in thing,
	adapt: (thing): ListingValue | null => {
		// polymorphism in action: accept both a bare listing and a feed post
		// carrying { listing: {…} } (the PublicPost shape)
		const source = (thing.listing && typeof thing.listing === 'object' ? thing.listing : thing) as Record<string, unknown>;
		const title = toStringOr(source.title, toStringOr(source.name));
		if (!title) return null;

		return {
			title,
			price: toNumberOr(source.price),
			currency: toStringOr(source.currency, 'USD'),
			condition: toStringOr(source.condition),
			location: toStringOr(source.location),
			sold: source.sold === true,
			image: toStringOr(source.image, toStringOr(toArray(thing.images)[0])) || null,
			description: toStringOr(source.description, toStringOr(thing.text)),
			seller: toStringOr((thing.author as Record<string, unknown> | undefined)?.username, toStringOr(source.seller))
		};
	},
	render: ListingRenderer
});

registerKindRenderer({
	kind: 'dashboard',
	title: 'Dashboard',
	emoji: '📊',
	category: 'Data',
	description: 'Stat tiles with trends and sparklines, built from plain numbers.',
	aliases: ['stats', 'metrics'],
	match: (thing) => Array.isArray(thing.metrics),
	adapt: (thing): DashboardValue | null => {
		const metrics = toArray(thing.metrics)
			.map((metric) => {
				const record = (metric || {}) as Record<string, unknown>;
				const label = toStringOr(record.label, toStringOr(record.name));
				if (!label) return null;
				return {
					label,
					value: toStringOr(record.value, '—'),
					change: toNumberOr(record.change),
					series: toArray(record.series).map((v) => toNumberOr(v, 0) || 0)
				};
			})
			.filter(Boolean) as DashboardMetric[];

		if (!metrics.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name)), metrics };
	},
	render: DashboardRenderer
});

registerKindRenderer({
	kind: 'place',
	title: 'Place',
	emoji: '📍',
	category: 'World',
	description: 'Geo data as a friendly map card — pin, address, coordinates.',
	aliases: ['geo', 'location', 'map-pin'],
	match: (thing) => ('lat' in thing && ('lng' in thing || 'lon' in thing)) || 'coordinates' in thing,
	adapt: (thing): PlaceValue | null => {
		const coords = (thing.coordinates || {}) as Record<string, unknown>;
		const lat = toNumberOr(thing.lat, toNumberOr(coords.lat));
		const lng = toNumberOr(thing.lng, toNumberOr(thing.lon, toNumberOr(coords.lng, toNumberOr(coords.lon))));
		const name = toStringOr(thing.name, toStringOr(thing.title, 'Somewhere'));

		return {
			name,
			lat,
			lng,
			address: toStringOr(thing.address),
			note: toStringOr(thing.note, toStringOr(thing.description))
		};
	},
	render: PlaceRenderer
});

registerKindRenderer({
	kind: 'news-analysis',
	title: 'News analysis',
	emoji: '🗞️',
	category: 'Knowledge',
	description: 'Political/news analysis — bias spectrum, claim checks, and perspectives.',
	aliases: ['news', 'analysis', 'fact-check'],
	match: (thing) => typeof thing.headline === 'string' && (Array.isArray(thing.claims) || Array.isArray(thing.perspectives) || 'bias' in thing),
	adapt: (thing): NewsValue | null => {
		const headline = toStringOr(thing.headline, toStringOr(thing.title));
		if (!headline) return null;

		return {
			headline,
			summary: toStringOr(thing.summary, toStringOr(thing.text)),
			bias: toNumberOr(thing.bias),
			claims: toArray(thing.claims)
				.map((claim) => {
					const record = (claim || {}) as Record<string, unknown>;
					return { claim: toStringOr(record.claim, toStringOr(record.text)), verdict: toStringOr(record.verdict, 'unverified') };
				})
				.filter((item) => item.claim),
			perspectives: toArray(thing.perspectives)
				.map((perspective) => {
					const record = (perspective || {}) as Record<string, unknown>;
					return {
						outlet: toStringOr(record.outlet, toStringOr(record.source)),
						lean: toStringOr(record.lean, 'centre'),
						take: toStringOr(record.take, toStringOr(record.summary))
					};
				})
				.filter((item) => item.outlet),
			sources: toArray(thing.sources).map((source) => toStringOr(source)).filter(Boolean)
		};
	},
	render: NewsAnalysisRenderer
});

registerKindRenderer({
	kind: 'comparison',
	title: 'Comparison',
	emoji: '⚖️',
	category: 'Data',
	description: 'Compare any list of things across shared criteria — table on desktop, cards on mobile.',
	aliases: ['compare', 'versus'],
	match: (thing) => Array.isArray(thing.items) && toArray(thing.items).every((item) => item && typeof item === 'object'),
	adapt: (thing): ComparisonValue | null => {
		const items = toArray(thing.items).filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
		if (items.length < 2) return null;

		const names = items.map((item, idx) => toStringOr(item.name, toStringOr(item.title, `Option ${idx + 1}`)));

		// criteria = union of every non-name key, preserving first-seen order
		const criteriaKeys: string[] = [];
		items.forEach((item) => {
			Object.keys(item).forEach((key) => {
				if (key === 'name' || key === 'title' || key === 'kind') return;
				if (!criteriaKeys.includes(key)) criteriaKeys.push(key);
			});
		});
		if (!criteriaKeys.length) return null;

		const criteria = criteriaKeys.map((key) => ({
			label: key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
			values: items.map((item) => {
				const cell = item[key];
				if (typeof cell === 'boolean') return cell ? '✓' : '—';
				return toStringOr(cell, '—');
			})
		}));

		return { title: toStringOr(thing.title, toStringOr(thing.name)), names, criteria };
	},
	render: ComparisonRenderer
});

registerKindRenderer({
	kind: 'chart',
	title: 'Chart',
	emoji: '📈',
	category: 'Data',
	description: 'Bar or line chart from a plain list of labels and numbers.',
	aliases: ['graph'],
	match: (thing) => Array.isArray(thing.values) && toArray(thing.values).every((v) => typeof v === 'number'),
	adapt: (thing): ChartValue | null => {
		const values = toArray(thing.values).map((v) => toNumberOr(v, 0) || 0);
		if (!values.length) return null;

		return {
			title: toStringOr(thing.title, toStringOr(thing.name)),
			type: toStringOr(thing.type) === 'line' ? 'line' : 'bar',
			labels: toArray(thing.labels).map((label) => toStringOr(label)),
			values,
			unit: toStringOr(thing.unit)
		};
	},
	render: ChartRenderer
});

registerKindRenderer({
	kind: 'profile',
	title: 'Profile card',
	emoji: '👤',
	category: 'Social',
	description: 'A person or account — avatar, banner, bio, and stats.',
	aliases: ['user', 'person', 'account'],
	match: (thing) => typeof thing.username === 'string' && ('bio' in thing || 'displayName' in thing || 'avatarUrl' in thing),
	adapt: (thing): ProfileValue | null => {
		const username = toStringOr(thing.username);
		const displayName = toStringOr(thing.displayName, toStringOr(thing.name));
		if (!username && !displayName) return null;

		const statsRecord = (thing.stats || {}) as Record<string, unknown>;
		const stats = Object.entries(statsRecord)
			.map(([label, value]) => ({ label, value: toStringOr(value, '—') }))
			.slice(0, 4);

		return {
			displayName,
			username,
			bio: toStringOr(thing.bio, toStringOr(thing.about)),
			avatarUrl: toStringOr(thing.avatarUrl) || null,
			bannerUrl: toStringOr(thing.bannerUrl) || null,
			stats
		};
	},
	render: ProfileRenderer
});

registerKindRenderer({
	kind: 'recipe',
	title: 'Recipe',
	emoji: '🍳',
	category: 'Life',
	description: 'Everyday structured data — ingredients and steps, side by side.',
	aliases: ['meal', 'dish'],
	match: (thing) => Array.isArray(thing.ingredients) && Array.isArray(thing.steps),
	adapt: (thing): RecipeValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		const ingredients = toArray(thing.ingredients).map((item) => toStringOr(item)).filter(Boolean);
		const steps = toArray(thing.steps).map((item) => toStringOr(item)).filter(Boolean);
		if (!title || (!ingredients.length && !steps.length)) return null;

		return {
			title,
			time: toStringOr(thing.time, toStringOr(thing.duration)),
			serves: toStringOr(thing.serves, toStringOr(thing.servings)),
			ingredients,
			steps
		};
	},
	render: RecipeRenderer
});

registerKindRenderer({
	kind: 'element',
	title: 'Element (html/css as data)',
	emoji: '🧱',
	category: 'Builder',
	description: 'Build any component as pure JSON — tag, props, children — rendered through a sanitising gate.',
	aliases: ['html', 'component', 'page'],
	match: (thing) => typeof thing.tag === 'string',
	adapt: (thing): HtmlThingNode | null => {
		if (typeof thing.tag !== 'string' && !thing.children) return null;
		return thing as HtmlThingNode;
	},
	render: ElementRenderer
});

registerKindRenderer({
	kind: 'chakra',
	title: 'Chakra (components as data)',
	emoji: '🎛',
	category: 'Builder',
	description:
		'Serialised Chakra UI component trees — chakra, props, children as pure JSON — rendered through a sanitising allowlist gate.',
	aliases: ['chakra-component'],
	match: (thing) => isChakraThingNode(thing),
	adapt: (thing): ChakraThingNode | null => (isChakraThingNode(thing) ? (thing as ChakraThingNode) : null),
	render: ChakraKindRenderer
});

registerKindRenderer({
	kind: 'component',
	title: 'UI component',
	emoji: '🧩',
	category: 'Builder',
	description:
		'A component thing from /components — its render template resolved against savedArgs (or arg defaults), drawn through the sanitising gates.',
	aliases: ['ui-component'],
	match: (thing) => {
		const crystal = thing.crystal as Record<string, unknown> | undefined;
		return !!crystal && typeof crystal === 'object' && 'render' in crystal && ('args' in crystal || 'componentKey' in crystal || 'library' in crystal);
	},
	adapt: (thing): ComponentKindValue | null => {
		// accepts both a full component thing ({ crystal }) and a bare crystal
		const crystal = ((thing.crystal as Record<string, unknown> | undefined) ?? thing) as Record<string, unknown>;
		if (!crystal.render || typeof crystal.render !== 'object') return null;
		const args = sanitizeArgSpecs(crystal.args);
		const savedArgs =
			crystal.savedArgs && typeof crystal.savedArgs === 'object' && !Array.isArray(crystal.savedArgs)
				? (crystal.savedArgs as Record<string, string | number | boolean>)
				: {};
		return { render: crystal.render, values: { ...defaultsFromArgs(args), ...savedArgs } };
	},
	render: ComponentKindRenderer
});

registerKindRenderer({
	kind: 'action',
	title: 'Action',
	emoji: '⚡',
	category: 'Builder',
	description:
		'A declarative capability-bounded program — typed inputs, a closed step vocabulary, explicit capabilities, and a shared execution budget. Inspect and run it on /actions.',
	aliases: ['action-thing'],
	match: (thing) => {
		const crystal = thing.crystal as Record<string, unknown> | undefined;
		return !!crystal && typeof crystal === 'object' && Array.isArray(crystal.steps) && ('capabilities' in crystal || 'actionKey' in crystal);
	},
	adapt: (thing): ActionKindValue | null => {
		const crystal = ((thing.crystal as Record<string, unknown> | undefined) ?? thing) as Record<string, unknown>;
		if (!Array.isArray(crystal.steps)) return null;
		const ops = [
			...new Set(
				crystal.steps
					.map((step) => (step && typeof step === 'object' ? String((step as Record<string, unknown>).op || '') : ''))
					.filter(Boolean)
			)
		];
		return {
			name: typeof crystal.name === 'string' ? crystal.name : 'Action',
			actionKey: typeof crystal.actionKey === 'string' ? crystal.actionKey : null,
			description: typeof crystal.description === 'string' ? crystal.description : null,
			ops,
			stepCount: crystal.steps.length,
			capabilityCount: Array.isArray(crystal.capabilities) ? crystal.capabilities.length : 0
		};
	},
	render: ActionKindRenderer
});

registerKindRenderer({
	kind: 'webpage',
	title: 'Webpage',
	emoji: '🧱',
	category: 'Builder',
	description:
		'A block-based webpage built in the /builder — an ordered tree of component/container/text/native blocks. Standalone pages publish at /p/<id>; site pages personalise a built-in route.',
	aliases: ['webpage-thing'],
	match: (thing) => {
		const crystal = thing.crystal as Record<string, unknown> | undefined;
		return !!crystal && typeof crystal === 'object' && Array.isArray(crystal.blocks) && ('pageKey' in crystal || 'siteRoute' in crystal || 'name' in crystal);
	},
	adapt: (thing): WebpageKindValue | null => {
		const crystal = ((thing.crystal as Record<string, unknown> | undefined) ?? thing) as Record<string, unknown>;
		if (!Array.isArray(crystal.blocks)) return null;
		const countTree = (blocks: unknown[]): number =>
			blocks.reduce<number>((sum, block) => {
				if (!block || typeof block !== 'object') return sum;
				const children = (block as Record<string, unknown>).children;
				return sum + 1 + (Array.isArray(children) ? countTree(children) : 0);
			}, 0);
		const types = [
			...new Set(
				crystal.blocks
					.map((block) => (block && typeof block === 'object' ? String((block as Record<string, unknown>).type || '') : ''))
					.filter(Boolean)
			)
		];
		return {
			name: typeof crystal.name === 'string' ? crystal.name : 'Webpage',
			siteRoute: typeof crystal.siteRoute === 'string' ? crystal.siteRoute : null,
			blockCount: countTree(crystal.blocks),
			types
		};
	},
	render: WebpageKindRenderer
});

};
