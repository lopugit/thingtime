import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { registerKindRenderer } from './kindRegistry';
import type { KindRenderContext } from './kindRegistry';
import { safeCssUrl, safeUrl } from './safeUrl';
import { getEditorJsHeadingFontSize, isEditorJsDoc, normalizeEditorJsHeadingLevel } from '~/components/Editor/editorJsValue';
import { inlineHtmlToText, sanitizeEditorJsInlineHtml } from '~/components/Editor/inlineHtmlText';
import { sanitizeStyleTokens, styleTokensToCss } from '~/components/Editor/styleTokens';
import {
	Avatar,
	BodyText,
	CardTitle,
	CoverArea,
	KindBadge,
	KindCard,
	MutedMono,
	StarRating,
	StatCell,
	maybeTimeAgo,
	toArray,
	toNumberOr,
	toStringArray,
	toStringOr
} from './kindPrimitives';

// Media & content kinds — the shapes people share and consume everywhere on
// the internet: images, audio, articles, books, films, links, files, code.

// ————— 🖼️ image —————

type ImageValue = { images: Array<{ src: string | null; alt: string }>; caption: string; credit: string };

const ImageRenderer = ({ value }: { value: ImageValue; context: KindRenderContext }) => (
	<KindCard padding={0}>
		<Grid gap="2px" templateColumns={value.images.length > 1 ? 'repeat(auto-fit, minmax(140px, 1fr))' : '1fr'}>
			{value.images.slice(0, 6).map((image, idx) => {
				const src = safeUrl(image.src);
				return (
				<Box key={idx} position="relative" paddingTop={value.images.length > 1 ? '75%' : '56%'}>
					{src ? (
						<Box as="img" src={src} alt={image.alt} position="absolute" inset={0} width="100%" height="100%" objectFit="cover" />
					) : (
						<Flex position="absolute" inset={0} alignItems="center" justifyContent="center" background="var(--tt-surface-alt, #f5f5f7)" fontSize="34px">
							🖼️
						</Flex>
					)}
				</Box>
				);
			})}
		</Grid>
		{value.caption || value.credit ? (
			<Flex alignItems="baseline" columnGap={2} justifyContent="space-between" padding={3}>
				{value.caption ? <BodyText>{value.caption}</BodyText> : <span />}
				{value.credit ? <MutedMono>© {value.credit}</MutedMono> : null}
			</Flex>
		) : null}
	</KindCard>
);

// ————— 🎵 audio —————

type AudioValue = { title: string; artist: string; src: string | null; duration: string; artwork: string | null };

const AudioRenderer = ({ value }: { value: AudioValue; context: KindRenderContext }) => {
	// gate the gradient + emoji placeholder on the SANITIZED artwork so an
	// unsafe URL falls back to the placeholder, not a blank box
	const artwork = safeCssUrl(value.artwork);
	const src = safeUrl(value.src);
	return (
	<KindCard>
		<Flex alignItems="center" columnGap={3}>
			<Flex
				alignItems="center"
				justifyContent="center"
				background={artwork ? undefined : 'linear-gradient(135deg, #2b2540, #4a2d55)'}
				backgroundImage={artwork}
				backgroundSize="cover"
				borderRadius="var(--tt-radius-md, 12px)"
				flexShrink={0}
				fontSize="22px"
				height="56px"
				width="56px"
			>
				{!artwork ? '🎵' : ''}
			</Flex>
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">{value.title}</CardTitle>
				<Flex columnGap={2}>
					{value.artist ? <MutedMono>{value.artist}</MutedMono> : null}
					{value.duration ? <MutedMono>· {value.duration}</MutedMono> : null}
				</Flex>
				{src ? <Box as="audio" controls preload="none" src={src} marginTop={2} width="100%" /> : null}
			</Box>
		</Flex>
	</KindCard>
	);
};

// ————— 📻 playlist —————

type PlaylistValue = { title: string; curator: string; tracks: Array<{ title: string; artist: string; duration: string }> };

const PlaylistRenderer = ({ value }: { value: PlaylistValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="baseline" columnGap={2} marginBottom={2}>
			<CardTitle>📻 {value.title}</CardTitle>
			{value.curator ? <MutedMono>by {value.curator}</MutedMono> : null}
			<MutedMono>· {value.tracks.length} tracks</MutedMono>
		</Flex>
		<Flex flexDirection="column">
			{value.tracks.slice(0, 8).map((track, idx) => (
				<Flex key={idx} alignItems="baseline" borderTop={idx === 0 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'} columnGap={3} paddingY={1.5}>
					<MutedMono>{idx + 1}</MutedMono>
					<Box flex="1" minWidth={0}>
						<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650} noOfLines={1}>
							{track.title}
						</Text>
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" noOfLines={1}>
							{track.artist}
						</Text>
					</Box>
					<MutedMono>{track.duration}</MutedMono>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— 🎙️ podcast —————

type PodcastValue = { show: string; episode: string; description: string; duration: string; publishedAt: string; episodeNumber: number | null };

const PodcastRenderer = ({ value }: { value: PodcastValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Flex alignItems="center" justifyContent="center" background="linear-gradient(135deg, #42275a, #734b6d)" borderRadius="var(--tt-radius-md, 12px)" flexShrink={0} fontSize="24px" height="64px" width="64px">
				🎙️
			</Flex>
			<Box flex="1" minWidth={0}>
				<MutedMono>{value.show}</MutedMono>
				<CardTitle size="sm">
					{value.episodeNumber !== null ? `#${value.episodeNumber} — ` : ''}
					{value.episode}
				</CardTitle>
				<BodyText lines={2}>{value.description}</BodyText>
				<Flex columnGap={2} marginTop={1.5}>
					{value.duration ? <KindBadge>▶ {value.duration}</KindBadge> : null}
					{value.publishedAt ? <MutedMono>{maybeTimeAgo(value.publishedAt)}</MutedMono> : null}
				</Flex>
			</Box>
		</Flex>
	</KindCard>
);

// ————— 📰 article —————

type ArticleValue = { title: string; excerpt: string; author: string; source: string; readingTime: string; cover: string | null; publishedAt: string };

const ArticleRenderer = ({ value }: { value: ArticleValue; context: KindRenderContext }) => (
	<KindCard padding={0}>
		<CoverArea emoji="📰" image={value.cover} gradient="linear-gradient(135deg, #e8f0fe 0%, #fdf1e8 100%)" />
		<Box padding={4}>
			<Flex columnGap={2} marginBottom={1}>
				{value.source ? <MutedMono>{value.source}</MutedMono> : null}
				{value.publishedAt ? <MutedMono>· {maybeTimeAgo(value.publishedAt)}</MutedMono> : null}
			</Flex>
			<CardTitle>{value.title}</CardTitle>
			<BodyText lines={3}>{value.excerpt}</BodyText>
			<Flex alignItems="center" columnGap={2} marginTop={3}>
				{value.author ? (
					<>
						<Avatar name={value.author} size={22} />
						<Text color="var(--tt-ink, #16161a)" fontSize="xs" fontWeight={700}>
							{value.author}
						</Text>
					</>
				) : null}
				{value.readingTime ? <MutedMono>· {value.readingTime} read</MutedMono> : null}
			</Flex>
		</Box>
	</KindCard>
);

// ————— 💬 quote —————

type QuoteValue = { text: string; attribution: string; source: string };

const QuoteRenderer = ({ value }: { value: QuoteValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Text color="var(--tt-accent, hotpink)" fontSize="34px" fontWeight={800} lineHeight="1">
				“
			</Text>
			<Box>
				<Text color="var(--tt-ink, #16161a)" fontSize="lg" fontStyle="italic" fontWeight={550} lineHeight="1.5">
					{value.text}
				</Text>
				<Flex alignItems="baseline" columnGap={2} marginTop={2}>
					{value.attribution ? (
						<Text color="var(--tt-text, #5a5a66)" fontSize="sm" fontWeight={750}>
							— {value.attribution}
						</Text>
					) : null}
					{value.source ? <MutedMono>{value.source}</MutedMono> : null}
				</Flex>
			</Box>
		</Flex>
	</KindCard>
);

// ————— 📕 book —————

type BookValue = { title: string; author: string; cover: string | null; rating: number | null; pages: number | null; year: string; blurb: string };

const BookRenderer = ({ value }: { value: BookValue; context: KindRenderContext }) => {
	const cover = safeCssUrl(value.cover);
	return (
	<KindCard>
		<Flex columnGap={4}>
			<Flex
				alignItems="center"
				justifyContent="center"
				background={cover ? undefined : 'linear-gradient(160deg, #4b6cb7, #182848)'}
				backgroundImage={cover}
				backgroundSize="cover"
				borderRadius="6px"
				boxShadow="2px 3px 10px rgba(0,0,0,0.22)"
				flexShrink={0}
				fontSize="26px"
				height="110px"
				width="76px"
			>
				{!cover ? '📕' : ''}
			</Flex>
			<Box flex="1" minWidth={0}>
				<CardTitle>{value.title}</CardTitle>
				<MutedMono>
					{value.author}
					{value.year ? ` · ${value.year}` : ''}
				</MutedMono>
				{value.rating !== null ? (
					<Box marginTop={1}>
						<StarRating rating={value.rating} />
					</Box>
				) : null}
				<BodyText lines={3}>{value.blurb}</BodyText>
				{value.pages !== null ? <MutedMono>{value.pages} pages</MutedMono> : null}
			</Box>
		</Flex>
	</KindCard>
	);
};

// ————— 🎬 movie —————

type MovieValue = { title: string; year: string; poster: string | null; rating: number | null; runtime: string; genres: string[]; synopsis: string };

const MovieRenderer = ({ value }: { value: MovieValue; context: KindRenderContext }) => {
	const poster = safeCssUrl(value.poster);
	return (
	<KindCard padding={0}>
		<Flex>
			<Flex
				alignItems="center"
				justifyContent="center"
				background={poster ? undefined : 'linear-gradient(160deg, #232526, #414345)'}
				backgroundImage={poster}
				backgroundSize="cover"
				flexShrink={0}
				fontSize="30px"
				minHeight="150px"
				width="100px"
			>
				{!poster ? '🎬' : ''}
			</Flex>
			<Box flex="1" minWidth={0} padding={4}>
				<CardTitle>
					{value.title} {value.year ? <MutedMono>({value.year})</MutedMono> : null}
				</CardTitle>
				<Flex alignItems="center" columnGap={2} flexWrap="wrap" marginTop={1} rowGap={1}>
					{value.rating !== null ? <StarRating rating={value.rating} max={10} /> : null}
					{value.runtime ? <KindBadge>⏱ {value.runtime}</KindBadge> : null}
				</Flex>
				<Flex columnGap={1.5} flexWrap="wrap" marginTop={1.5} rowGap={1.5}>
					{value.genres.map((genre) => (
						<KindBadge key={genre} tone="info">
							{genre}
						</KindBadge>
					))}
				</Flex>
				<BodyText lines={2}>{value.synopsis}</BodyText>
			</Box>
		</Flex>
	</KindCard>
	);
};

// ————— 🔗 link —————

type LinkValue = { url: string; title: string; description: string; site: string; image: string | null };

const LinkRenderer = ({ value }: { value: LinkValue; context: KindRenderContext }) => {
	const href = safeUrl(value.url);
	const imageBg = safeCssUrl(value.image);
	const card = (
		<KindCard padding={0}>
			<Flex>
				<Box flex="1" minWidth={0} padding={4}>
					<MutedMono>{value.site || value.url.replace(/^https?:\/\//, '').split('/')[0]}</MutedMono>
					<CardTitle size="sm">{value.title || value.url}</CardTitle>
					<BodyText lines={2}>{value.description}</BodyText>
					{href ? (
						<Text color="var(--tt-link, #2f8fd6)" fontSize="xs" fontWeight={700} marginTop={2}>
							Open link ↗
						</Text>
					) : null}
				</Box>
				{imageBg ? (
					<Box backgroundImage={imageBg} backgroundPosition="center" backgroundSize="cover" flexShrink={0} width="110px" />
				) : (
					<Flex alignItems="center" justifyContent="center" background="var(--tt-surface-alt, #f5f5f7)" flexShrink={0} fontSize="26px" width="82px">
						🔗
					</Flex>
				)}
			</Flex>
		</KindCard>
	);

	// only make the card a real link when the URL is a safe protocol; an
	// unsafe (javascript:/data:/…) url renders the same card, not clickable
	if (!href) return card;
	return (
		<Box as="a" href={href} target="_blank" rel="noopener noreferrer" display="block" _hover={{ textDecoration: 'none' }}>
			{card}
		</Box>
	);
};

// ————— 📎 file —————

const FILE_EMOJI: Record<string, string> = {
	pdf: '📕',
	doc: '📘',
	docx: '📘',
	xls: '📗',
	xlsx: '📗',
	csv: '📗',
	ppt: '📙',
	pptx: '📙',
	zip: '🗜️',
	mp3: '🎵',
	mp4: '🎥',
	png: '🖼️',
	jpg: '🖼️',
	svg: '🎨',
	txt: '📄',
	json: '🧾'
};

type FileValue = { name: string; size: string; type: string; url: string | null; modifiedAt: string };

const FileRenderer = ({ value }: { value: FileValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={3}>
			<Flex alignItems="center" justifyContent="center" background="var(--tt-surface, #fafafb)" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" flexShrink={0} fontSize="22px" height="48px" width="48px">
				{FILE_EMOJI[value.type.toLowerCase()] || '📎'}
			</Flex>
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">{value.name}</CardTitle>
				<Flex columnGap={2}>
					<MutedMono>{value.type.toUpperCase()}</MutedMono>
					{value.size ? <MutedMono>· {value.size}</MutedMono> : null}
					{value.modifiedAt ? <MutedMono>· {maybeTimeAgo(value.modifiedAt)}</MutedMono> : null}
				</Flex>
			</Box>
			{safeUrl(value.url) ? (
				<Box as="a" href={safeUrl(value.url)} target="_blank" rel="noopener noreferrer" color="var(--tt-link, #2f8fd6)" fontSize="sm" fontWeight={800}>
					⬇
				</Box>
			) : null}
		</Flex>
	</KindCard>
);

// ————— ⌨️ code —————

type CodeValue = { code: string; language: string; filename: string; description: string };

const CodeRenderer = ({ value }: { value: CodeValue; context: KindRenderContext }) => (
	<KindCard padding={0}>
		<Flex alignItems="center" background="var(--tt-surface, #fafafb)" borderBottom="1px solid var(--tt-border-light, #f0f0f2)" columnGap={2} paddingX={4} paddingY={2}>
			<Flex columnGap={1.5}>
				{['#f87171', '#fbbf24', '#34d399'].map((dot) => (
					<Box key={dot} background={dot} borderRadius="999px" height="9px" width="9px" />
				))}
			</Flex>
			{value.filename ? <MutedMono>{value.filename}</MutedMono> : null}
			<Box marginLeft="auto">
				<KindBadge tone="info">{value.language || 'code'}</KindBadge>
			</Box>
		</Flex>
		<Box
			as="pre"
			background="var(--tt-ink, #16161a)"
			color="#e6e6ea"
			fontFamily="var(--tt-font-mono, monospace)"
			fontSize="12.5px"
			lineHeight="1.6"
			overflowX="auto"
			padding={4}
			whiteSpace="pre"
		>
			{value.code}
		</Box>
		{value.description ? (
			<Box padding={3}>
				<BodyText>{value.description}</BodyText>
			</Box>
		) : null}
	</KindCard>
);

// ————— 📦 repository —————

type RepoValue = { name: string; owner: string; description: string; language: string; stars: number | null; forks: number | null; url: string | null };

const RepositoryRenderer = ({ value }: { value: RepoValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="baseline" columnGap={1}>
			<MutedMono>{value.owner} /</MutedMono>
			<CardTitle size="sm">{value.name}</CardTitle>
		</Flex>
		<BodyText lines={2}>{value.description}</BodyText>
		<Flex columnGap={4} marginTop={3}>
			{value.language ? (
				<Flex alignItems="center" columnGap={1.5}>
					<Box background="var(--tt-accent, hotpink)" borderRadius="999px" height="9px" width="9px" />
					<MutedMono>{value.language}</MutedMono>
				</Flex>
			) : null}
			{value.stars !== null ? <StatCell label="stars" value={`⭐ ${value.stars.toLocaleString()}`} /> : null}
			{value.forks !== null ? <StatCell label="forks" value={`🔱 ${value.forks.toLocaleString()}`} /> : null}
			{safeUrl(value.url) ? (
				<Box as="a" href={safeUrl(value.url)} target="_blank" rel="noopener noreferrer" color="var(--tt-link, #2f8fd6)" fontSize="xs" fontWeight={700} marginLeft="auto">
					View ↗
				</Box>
			) : null}
		</Flex>
	</KindCard>
);

// ————— 📄 rich-text (Editor.js blocks) —————

type RichTextBlock = { type: string; data: Record<string, unknown>; tunes?: Record<string, unknown> };
type RichTextValue = { blocks: RichTextBlock[] };
type RichTextRenderLimits = { remaining: number; textRemaining: number; truncated: boolean };

const MAX_RENDER_BLOCKS = 500;
const MAX_RENDER_UNITS = 1_000;
const MAX_RENDER_FIELD_LENGTH = 100_000;
const MAX_RENDER_TEXT_LENGTH = 1_000_000;
const MAX_LIST_DEPTH = 16;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 50;

const boundedRenderValue = (value: unknown, limits?: RichTextRenderLimits): unknown => {
	if (!limits || typeof value !== 'string') return value;
	const allowedLength = Math.min(MAX_RENDER_FIELD_LENGTH, Math.max(0, limits.textRemaining));
	limits.textRemaining -= Math.min(value.length, allowedLength);
	if (value.length <= allowedLength) return value;
	limits.truncated = true;
	return value.slice(0, allowedLength);
};

// strip inline HTML that editor.js allows (b/i/a/mark) down to text
const inlineText = (html: unknown, limits?: RichTextRenderLimits): string => inlineHtmlToText(boundedRenderValue(html, limits));

// The sanitizer is deliberately shared with the plain-text conversion so
// server rendering and browser hydration use the exact same parser policy.
export const sanitizeInlineHtml = (html: unknown, limits?: RichTextRenderLimits): string =>
	sanitizeEditorJsInlineHtml(boundedRenderValue(html, limits));

// theme styling for the sanitised inline tags
const inlineMarkupSx = {
	whiteSpace: 'pre-wrap',
	overflowWrap: 'anywhere',
	'b, strong': { fontWeight: 800, color: 'inherit' },
	'i, em': { fontStyle: 'italic' },
	u: { textDecoration: 'underline' },
	s: { textDecoration: 'line-through' },
	a: { color: 'var(--tt-link, #2f8fd6)', textDecoration: 'underline' },
	mark: { background: 'var(--tt-accent-tint, #fff5fa)', color: 'var(--tt-accent, hotpink)', borderRadius: '4px', padding: '0 3px' },
	code: { fontFamily: 'var(--tt-font-mono, monospace)', fontSize: '0.9em', background: 'var(--tt-surface-alt, #f5f5f7)', borderRadius: '4px', padding: '0 4px' }
} as const;

// one normalised shape for every list flavour: the standalone Checklist tool
// ({ text, checked }) and List v2 ({ content, meta: { checked }, items })
type NormalizedListItem = { html: string; checked: boolean | null; children: NormalizedListItem[] };

const normalizeListItems = (items: unknown[], checklist: boolean, limits: RichTextRenderLimits, depth = 0): NormalizedListItem[] => {
	if (depth >= MAX_LIST_DEPTH) {
		if (items.length) limits.truncated = true;
		return [];
	}

	const normalized: NormalizedListItem[] = [];
	for (const item of items) {
		if (limits.remaining <= 0) {
			limits.truncated = true;
			break;
		}
		limits.remaining -= 1;
		const record = (item || {}) as Record<string, unknown>;
		const meta = (record.meta || {}) as Record<string, unknown>;
		normalized.push({
			html: sanitizeInlineHtml(typeof item === 'string' ? item : record.text ?? record.content, limits),
			checked: checklist ? record.checked === true || meta.checked === true : null,
			children: normalizeListItems(toArray(record.items), checklist, limits, depth + 1)
		});
	}
	return normalized;
};

const boundedTableContent = (content: unknown[], limits: RichTextRenderLimits): unknown[][] => {
	const rows: unknown[][] = [];
	let clippedColumns = false;
	for (const row of content.slice(0, MAX_TABLE_ROWS)) {
		const cells: unknown[] = [];
		const rowValues = toArray(row);
		if (rowValues.length > MAX_TABLE_COLUMNS) clippedColumns = true;
		for (const cell of rowValues.slice(0, MAX_TABLE_COLUMNS)) {
			if (limits.remaining <= 0) {
				limits.truncated = true;
				break;
			}
			limits.remaining -= 1;
			cells.push(cell);
		}
		rows.push(cells);
		if (limits.remaining <= 0) break;
	}
	if (content.length > rows.length || clippedColumns) limits.truncated = true;
	return rows;
};

const ListLevel = ({
	items,
	ordered,
	depth,
	itemStyle,
	bodyFontSize
}: {
	items: NormalizedListItem[];
	ordered: boolean;
	depth: number;
	itemStyle?: React.CSSProperties;
	bodyFontSize: 'sm' | 'md';
}) => (
	<Flex flexDirection="column" paddingLeft={depth ? 4 : 0} rowGap={1}>
		{items.map((item, idx) => (
			<React.Fragment key={idx}>
				<Flex columnGap={2} alignItems="baseline">
					<Text color={item.checked ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-muted, #9a9aa6)'} fontSize="sm">
						{item.checked !== null ? (item.checked ? '☑' : '☐') : ordered ? `${idx + 1}.` : '•'}
					</Text>
					<Text
						color="var(--tt-text, #5a5a66)"
						fontSize={bodyFontSize}
						lineHeight="1.55"
						opacity={item.checked ? 0.6 : 1}
						style={itemStyle}
						sx={inlineMarkupSx}
						textDecoration={item.checked ? 'line-through' : 'none'}
						dangerouslySetInnerHTML={{ __html: item.html }}
					/>
				</Flex>
				{item.children.length ? (
					<ListLevel items={item.children} ordered={ordered} depth={depth + 1} itemStyle={itemStyle} bodyFontSize={bodyFontSize} />
				) : null}
			</React.Fragment>
		))}
	</Flex>
);

export const RichTextBlocks = ({ blocks, bodyFontSize = 'sm' }: { blocks: RichTextBlock[]; bodyFontSize?: 'sm' | 'md' }) => {
	const limits: RichTextRenderLimits = {
		remaining: MAX_RENDER_UNITS,
		textRemaining: MAX_RENDER_TEXT_LENGTH,
		truncated: blocks.length > MAX_RENDER_BLOCKS
	};
	const visibleBlocks = blocks.slice(0, MAX_RENDER_BLOCKS);

	return (
		<Flex flexDirection="column" rowGap={2}>
			{visibleBlocks.map((block, idx) => {
				if (limits.remaining <= 0) {
					limits.truncated = true;
					return null;
				}
				limits.remaining -= 1;
			// 🎨 Style tune data: re-validated here, so a hostile stored doc can
			// only ever contribute clean colour/size/font/align tokens
			const tuneStyle = styleTokensToCss(sanitizeStyleTokens((block.tunes as Record<string, unknown> | undefined)?.style));

			if (block.type === 'header') {
				const level = normalizeEditorJsHeadingLevel(block.data.level);
				const headingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
				return (
					<Box
						as={headingTag}
						key={idx}
						color="var(--tt-ink, #16161a)"
						fontSize={getEditorJsHeadingFontSize(level)}
						fontWeight={800}
						lineHeight="1.25"
						margin={0}
						style={tuneStyle}
						sx={inlineMarkupSx}
						dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(block.data.text, limits) }}
					/>
				);
			}
			if (block.type === 'list' || block.type === 'checklist') {
				const style = toStringOr(block.data.style);
				const checklist = block.type === 'checklist' || style === 'checklist';
				const items = normalizeListItems(toArray(block.data.items), checklist, limits);
				return <ListLevel key={idx} items={items} ordered={style === 'ordered'} depth={0} itemStyle={tuneStyle} bodyFontSize={bodyFontSize} />;
			}
			if (block.type === 'quote') {
				return (
					<Box key={idx} borderLeft="3px solid var(--tt-accent, hotpink)" paddingLeft={3} style={{ textAlign: tuneStyle.textAlign }}>
						<Text
							color="var(--tt-ink, #16161a)"
							fontSize={bodyFontSize}
							fontStyle="italic"
							lineHeight="1.6"
							style={tuneStyle}
							sx={inlineMarkupSx}
							dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(block.data.text, limits) }}
						/>
						{block.data.caption ? <MutedMono>— {inlineText(block.data.caption, limits)}</MutedMono> : null}
					</Box>
				);
			}
			if (block.type === 'delimiter') {
				return (
					<Text key={idx} color="var(--tt-faint, #b6b6c0)" letterSpacing="0.5em" textAlign="center">
						***
					</Text>
				);
			}
			if (block.type === 'code') {
				return (
					<Box
						key={idx}
						as="pre"
						background="var(--tt-ink, #16161a)"
						borderRadius="var(--tt-radius-sm, 9px)"
						color="#e6e6ea"
						fontFamily="var(--tt-font-mono, monospace)"
						fontSize="12.5px"
						lineHeight="1.6"
						overflowX="auto"
						padding={3}
						whiteSpace="pre"
					>
						{toStringOr(boundedRenderValue(block.data.code, limits))}
					</Box>
				);
			}
			if (block.type === 'table') {
				const content = boundedTableContent(toArray(block.data.content), limits);
				const withHeadings = block.data.withHeadings === true;
				return (
					<Box key={idx} overflowX="auto">
						<Box as="table" width="100%" style={{ borderCollapse: 'collapse' }}>
							<Box as="tbody">
								{content.map((row, rowIdx) => (
									<Box as="tr" key={rowIdx} background={withHeadings && rowIdx === 0 ? 'var(--tt-surface, #fafafb)' : 'transparent'}>
										{toArray(row).map((cell, cellIdx) => (
											<Box
												as={withHeadings && rowIdx === 0 ? 'th' : 'td'}
												key={cellIdx}
												border="1px solid var(--tt-border, #ececef)"
												paddingX={2.5}
												paddingY={1.5}
												textAlign="left"
											>
												<Text
													color={withHeadings && rowIdx === 0 ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)'}
													fontSize={bodyFontSize}
													fontWeight={withHeadings && rowIdx === 0 ? 750 : 500}
													sx={inlineMarkupSx}
													dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(cell, limits) }}
												/>
											</Box>
										))}
									</Box>
								))}
							</Box>
						</Box>
					</Box>
				);
			}
			if (block.type === 'warning') {
				return (
					<Flex key={idx} background="#fdf6e3" border="1px solid #f2e2b8" borderRadius="var(--tt-radius-md, 12px)" columnGap={2.5} padding={3}>
						<Text fontSize="md" aria-hidden>
							⚠️
						</Text>
						<Box minWidth={0}>
							<Text color="#78350f" fontSize={bodyFontSize} fontWeight={800} sx={inlineMarkupSx} dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(block.data.title, limits) }} />
							{block.data.message ? (
								<Text color="#8a6d3b" fontSize={bodyFontSize} lineHeight="1.5" sx={inlineMarkupSx} dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(block.data.message, limits) }} />
							) : null}
						</Box>
					</Flex>
				);
			}
			if (block.type === 'image') {
				const file = (block.data.file || {}) as Record<string, unknown>;
				const url = toStringOr(boundedRenderValue(toStringOr(block.data.url, toStringOr(file.url)), limits));
				const caption = inlineText(block.data.caption, limits);
				const safeUrl = /^(https?:\/\/|\/(?!\/))/i.test(url.trim());
				if (!safeUrl) return null;
				return (
					<Box key={idx}>
						<Box as="img" src={url} alt={caption || 'image'} borderRadius="var(--tt-radius-md, 12px)" maxWidth="100%" />
						{caption ? <MutedMono>{caption}</MutedMono> : null}
					</Box>
				);
			}
			if (block.type === 'embed') {
				const source = toStringOr(boundedRenderValue(toStringOr(block.data.source, toStringOr(block.data.embed)), limits));
				const caption = inlineText(block.data.caption, limits);
				const safeUrl = /^https?:\/\//i.test(source.trim());
				if (!safeUrl) return null;
				// link-out card, never an iframe — embeds stay sandboxed to a click
				return (
					<Box key={idx} as="a" href={source} target="_blank" rel="noopener noreferrer" display="block" _hover={{ textDecoration: 'none' }}>
						<Flex alignItems="center" background="var(--tt-surface, #fafafb)" border="1px solid var(--tt-border-light, #f0f0f2)" borderRadius="var(--tt-radius-md, 12px)" columnGap={2.5} padding={3}>
							<Text fontSize="md" aria-hidden>
								▶️
							</Text>
							<Box minWidth={0}>
								<Text color="var(--tt-link, #2f8fd6)" fontSize="sm" fontWeight={700} noOfLines={1}>
									{toStringOr(boundedRenderValue(toStringOr(block.data.service, 'Embedded media'), limits))} ↗
								</Text>
								<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" noOfLines={1}>
									{caption || source}
								</Text>
							</Box>
						</Flex>
					</Box>
				);
			}
			// paragraph + anything unknown with a text field
			return (
				<Text
					key={idx}
					color="var(--tt-text, #5a5a66)"
					fontSize={bodyFontSize}
					lineHeight="1.65"
					whiteSpace="pre-wrap"
					style={tuneStyle}
					sx={inlineMarkupSx}
					dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(block.data.text, limits) }}
				/>
			);
			})}
			{limits.truncated ? <MutedMono>Rich text preview truncated for performance.</MutedMono> : null}
		</Flex>
	);
};

const RichTextRenderer = ({ value }: { value: RichTextValue; context: KindRenderContext }) => (
	<KindCard>
		<RichTextBlocks blocks={value.blocks} />
	</KindCard>
);

// ————— registration —————
// Explicit registration, called lazily by kindRegistry: "sideEffects": false would
// tree-shake a bare side-effect import out of production builds.

export const registerMediaKinds = () => {

registerKindRenderer({
	kind: 'image',
	title: 'Image / gallery',
	emoji: '🖼️',
	description: 'One photo or a gallery grid, with caption and credit.',
	category: 'Media',
	aliases: ['photo', 'picture', 'gallery'],
	match: (thing) => typeof thing.src === 'string' && /\.(png|jpe?g|gif|webp|avif|svg)($|\?)/i.test(String(thing.src)),
	adapt: (thing): ImageValue | null => {
		const list = toArray(thing.images).length ? toArray(thing.images) : [thing.src ?? thing.image ?? null];
		const images = list.slice(0, 12).map((item) => {
			const record = (item || {}) as Record<string, unknown>;
			return typeof item === 'string'
				? { src: item, alt: toStringOr(thing.alt, 'image') }
				: { src: toStringOr(record.src) || null, alt: toStringOr(record.alt, 'image') };
		});
		if (!images.length) return null;
		return { images, caption: toStringOr(thing.caption, toStringOr(thing.title)), credit: toStringOr(thing.credit) };
	},
	render: ImageRenderer
});

registerKindRenderer({
	kind: 'audio',
	title: 'Audio track',
	emoji: '🎵',
	description: 'A playable track — artwork, artist, and an audio player.',
	category: 'Media',
	aliases: ['track', 'song', 'music'],
	match: (thing) => typeof thing.src === 'string' && /\.(mp3|wav|ogg|m4a|flac)($|\?)/i.test(String(thing.src)),
	adapt: (thing): AudioValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (!title) return null;
		return {
			title,
			artist: toStringOr(thing.artist, toStringOr(thing.creator)),
			src: toStringOr(thing.src, toStringOr(thing.url)) || null,
			duration: toStringOr(thing.duration),
			artwork: toStringOr(thing.artwork, toStringOr(thing.cover)) || null
		};
	},
	render: AudioRenderer
});

registerKindRenderer({
	kind: 'playlist',
	title: 'Playlist',
	emoji: '📻',
	description: 'An ordered track list with curator and durations.',
	category: 'Media',
	aliases: ['album', 'tracklist'],
	match: (thing) => Array.isArray(thing.tracks),
	adapt: (thing): PlaylistValue | null => {
		const tracks = toArray(thing.tracks).map((track) => {
			const record = (track || {}) as Record<string, unknown>;
			return typeof track === 'string'
				? { title: track, artist: '', duration: '' }
				: { title: toStringOr(record.title, toStringOr(record.name)), artist: toStringOr(record.artist), duration: toStringOr(record.duration) };
		});
		if (!tracks.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name, 'Playlist')), curator: toStringOr(thing.curator, toStringOr(thing.by)), tracks };
	},
	render: PlaylistRenderer
});

registerKindRenderer({
	kind: 'podcast',
	title: 'Podcast episode',
	emoji: '🎙️',
	description: 'Show, episode, description, and duration.',
	category: 'Media',
	aliases: ['episode'],
	match: (thing) => 'show' in thing && ('episode' in thing || 'episodeNumber' in thing),
	adapt: (thing): PodcastValue | null => {
		const episode = toStringOr(thing.episode, toStringOr(thing.title));
		if (!episode) return null;
		return {
			show: toStringOr(thing.show),
			episode,
			description: toStringOr(thing.description, toStringOr(thing.summary)),
			duration: toStringOr(thing.duration),
			publishedAt: toStringOr(thing.publishedAt, toStringOr(thing.date)),
			episodeNumber: toNumberOr(thing.episodeNumber)
		};
	},
	render: PodcastRenderer
});

registerKindRenderer({
	kind: 'article',
	title: 'Article',
	emoji: '📰',
	description: 'Long-form piece — cover, byline, excerpt, reading time.',
	category: 'Media',
	aliases: ['blog-post', 'story'],
	match: (thing) => typeof thing.title === 'string' && ('excerpt' in thing || 'readingTime' in thing),
	adapt: (thing): ArticleValue | null => {
		const title = toStringOr(thing.title);
		if (!title) return null;
		return {
			title,
			excerpt: toStringOr(thing.excerpt, toStringOr(thing.summary, toStringOr(thing.text))),
			author: toStringOr(thing.author && typeof thing.author === 'object' ? (thing.author as Record<string, unknown>).name : thing.author),
			source: toStringOr(thing.source, toStringOr(thing.publication)),
			readingTime: toStringOr(thing.readingTime),
			cover: toStringOr(thing.cover, toStringOr(thing.image)) || null,
			publishedAt: toStringOr(thing.publishedAt, toStringOr(thing.date))
		};
	},
	render: ArticleRenderer
});

registerKindRenderer({
	kind: 'quote',
	title: 'Quote',
	emoji: '💬',
	description: 'A pull-quote with attribution.',
	category: 'Media',
	aliases: ['pullquote', 'saying'],
	match: (thing) => typeof thing.quote === 'string' || (typeof thing.text === 'string' && 'attribution' in thing),
	adapt: (thing): QuoteValue | null => {
		const text = toStringOr(thing.quote, toStringOr(thing.text));
		if (!text) return null;
		return { text, attribution: toStringOr(thing.attribution, toStringOr(thing.by)), source: toStringOr(thing.source) };
	},
	render: QuoteRenderer
});

registerKindRenderer({
	kind: 'book',
	title: 'Book',
	emoji: '📕',
	description: 'Cover spine, author, rating, and blurb.',
	category: 'Media',
	aliases: ['novel', 'ebook'],
	match: (thing) => typeof thing.title === 'string' && 'author' in thing && ('pages' in thing || 'isbn' in thing),
	adapt: (thing): BookValue | null => {
		const title = toStringOr(thing.title);
		if (!title) return null;
		return {
			title,
			author: toStringOr(thing.author),
			cover: toStringOr(thing.cover) || null,
			rating: toNumberOr(thing.rating),
			pages: toNumberOr(thing.pages),
			year: toStringOr(thing.year),
			blurb: toStringOr(thing.blurb, toStringOr(thing.description))
		};
	},
	render: BookRenderer
});

registerKindRenderer({
	kind: 'movie',
	title: 'Movie',
	emoji: '🎬',
	description: 'Poster, rating out of 10, runtime, and genres.',
	category: 'Media',
	aliases: ['film', 'tv-show', 'show'],
	match: (thing) => typeof thing.title === 'string' && ('runtime' in thing || 'genres' in thing) && ('year' in thing || 'rating' in thing),
	adapt: (thing): MovieValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (!title) return null;
		return {
			title,
			year: toStringOr(thing.year),
			poster: toStringOr(thing.poster) || null,
			rating: toNumberOr(thing.rating),
			runtime: toStringOr(thing.runtime),
			genres: toStringArray(thing.genres),
			synopsis: toStringOr(thing.synopsis, toStringOr(thing.description))
		};
	},
	render: MovieRenderer
});

registerKindRenderer({
	kind: 'link',
	title: 'Link preview',
	emoji: '🔗',
	description: 'Open-graph style bookmark card for any URL.',
	category: 'Media',
	aliases: ['bookmark', 'url'],
	match: (thing) => typeof thing.url === 'string' && !('price' in thing) && !('videoUrl' in thing) && ('title' in thing || 'site' in thing || 'description' in thing),
	adapt: (thing): LinkValue | null => {
		const url = toStringOr(thing.url, toStringOr(thing.href));
		if (!url) return null;
		return {
			url,
			title: toStringOr(thing.title, toStringOr(thing.name)),
			description: toStringOr(thing.description),
			site: toStringOr(thing.site, toStringOr(thing.siteName)),
			image: toStringOr(thing.image) || null
		};
	},
	render: LinkRenderer
});

registerKindRenderer({
	kind: 'file',
	title: 'File',
	emoji: '📎',
	description: 'A download card with type icon, size, and date.',
	category: 'Media',
	aliases: ['document', 'attachment', 'download'],
	match: (thing) => typeof thing.filename === 'string' || (typeof thing.name === 'string' && 'size' in thing && 'type' in thing),
	adapt: (thing): FileValue | null => {
		const name = toStringOr(thing.filename, toStringOr(thing.name));
		if (!name) return null;
		return {
			name,
			size: toStringOr(thing.size),
			type: toStringOr(thing.type, name.includes('.') ? name.split('.').pop() || '' : ''),
			url: toStringOr(thing.url) || null,
			modifiedAt: toStringOr(thing.modifiedAt, toStringOr(thing.updatedAt))
		};
	},
	render: FileRenderer
});

registerKindRenderer({
	kind: 'code',
	title: 'Code snippet',
	emoji: '⌨️',
	description: 'A mono block with language chip and window chrome.',
	category: 'Media',
	aliases: ['snippet', 'source'],
	match: (thing) => typeof thing.code === 'string',
	adapt: (thing): CodeValue | null => {
		const code = toStringOr(thing.code);
		if (!code) return null;
		return {
			code,
			language: toStringOr(thing.language, toStringOr(thing.lang)),
			filename: toStringOr(thing.filename),
			description: toStringOr(thing.description)
		};
	},
	render: CodeRenderer
});

registerKindRenderer({
	kind: 'repository',
	title: 'Repository',
	emoji: '📦',
	description: 'GitHub-style repo card — stars, forks, language.',
	category: 'Media',
	aliases: ['repo', 'project'],
	match: (thing) => 'stars' in thing && ('forks' in thing || 'owner' in thing),
	adapt: (thing): RepoValue | null => {
		const name = toStringOr(thing.name, toStringOr(thing.repo));
		if (!name) return null;
		return {
			name,
			owner: toStringOr(thing.owner),
			description: toStringOr(thing.description),
			language: toStringOr(thing.language),
			stars: toNumberOr(thing.stars),
			forks: toNumberOr(thing.forks),
			url: toStringOr(thing.url) || null
		};
	},
	render: RepositoryRenderer
});

registerKindRenderer({
	kind: 'rich-text',
	title: 'Rich text (blocks)',
	emoji: '📝',
	description: 'An Editor.js block document — headings, lists, quotes, checklists — rendered read-only.',
	category: 'Media',
	aliases: ['blocks', 'editorjs'],
	match: (thing) => isEditorJsDoc(thing),
	adapt: (thing): RichTextValue | null => (isEditorJsDoc(thing) ? { blocks: thing.blocks } : null),
	render: RichTextRenderer
});

};
