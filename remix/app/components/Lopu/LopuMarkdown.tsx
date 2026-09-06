import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';
import { Check, Copy } from 'lucide-react';

import { LOPU_UI, lopuEyebrowSx, lopuFocusRingSx, lopuRainbowTextSx, lopuReducedMotionSx } from './lopuTheme';
import { describeLopuCodeBlock, parseLopuMarkdown, type LopuInline, type LopuMdBlock } from './lopuTurnCore';

// Lopu's bubble text: the tiny markdown-ish grammar from lopuTurnCore
// (paragraphs, headings, bullet/numbered lists, inline code, bold/italic,
// site-relative links, fenced code with a copy button) drawn through React
// text nodes ONLY — there is no HTML sink here, so a model that emits markup
// shows the literal characters. Streaming aware: an open fence keeps growing
// as a code block and the caret rides the last line. `compact` is the
// floating window's 13px body.

const COPIED_FOR_MS = 1600;

// Clipboard write with a textarea fallback for browsers without the async API.
const writeClipboard = async (text: string): Promise<boolean> => {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to the legacy path
	}
	try {
		const area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', 'true');
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(area);
		return ok;
	} catch {
		return false;
	}
};

const CopyButton = ({ text, label }: { text: string; label: string }) => {
	const [copied, setCopied] = React.useState(false);
	const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	React.useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);
	const onCopy = async () => {
		const ok = await writeClipboard(text);
		if (!ok) return;
		setCopied(true);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
	};
	return (
		<Box
			as="button"
			type="button"
			className="lopuCodeCopy"
			aria-label={copied ? 'Copied' : label}
			title={label}
			display="inline-flex"
			alignItems="center"
			gap="5px"
			height="22px"
			px="7px"
			borderRadius={LOPU_UI.radiusXs}
			border={LOPU_UI.border}
			bg={LOPU_UI.card}
			color={copied ? LOPU_UI.positive : LOPU_UI.muted}
			fontSize="11px"
			fontWeight={600}
			lineHeight={1}
			cursor="pointer"
			transition={`color ${LOPU_UI.transitionFast}, border-color ${LOPU_UI.transitionFast}`}
			_hover={{ color: LOPU_UI.ink, borderColor: LOPU_UI.faint }}
			sx={lopuFocusRingSx}
			onClick={onCopy}
		>
			{copied ? <Check size={12} strokeWidth={2.2} aria-hidden /> : <Copy size={12} strokeWidth={2} aria-hidden />}
			<Box as="span">{copied ? 'Copied' : 'Copy'}</Box>
		</Box>
	);
};

const InlineRun = ({ inlines }: { inlines: LopuInline[] }) => (
	<>
		{inlines.map((inline, index) => {
			switch (inline.kind) {
				case 'code':
					return (
						<Box
							as="code"
							key={index}
							fontFamily={LOPU_UI.fontMono}
							fontSize="0.9em"
							bg={LOPU_UI.surfaceAlt}
							border={LOPU_UI.border}
							borderRadius="6px"
							px="4px"
							py="1px"
							whiteSpace="pre-wrap"
							overflowWrap="anywhere"
						>
							{inline.text}
						</Box>
					);
				case 'strong':
					return (
						<Box as="strong" key={index} fontWeight={700}>
							{inline.text}
						</Box>
					);
				case 'em':
					return (
						<Box as="em" key={index} fontStyle="italic">
							{inline.text}
						</Box>
					);
				case 'link':
					return (
						<Box
							as={RouterLink}
							key={index}
							to={inline.href}
							color={LOPU_UI.link}
							fontWeight={600}
							textDecoration="underline"
							textUnderlineOffset="2px"
							textDecorationColor={LOPU_UI.faint}
							overflowWrap="anywhere"
							_hover={{ textDecorationColor: LOPU_UI.ink }}
							sx={lopuFocusRingSx}
						>
							{inline.text}
						</Box>
					);
				default:
					return <React.Fragment key={index}>{inline.text}</React.Fragment>;
			}
		})}
	</>
);

// The streaming caret — the one place Lopu's text wears the rainbow.
export const StreamingCaret = () => (
	<Box
		as="span"
		className="lopuCaret"
		ml="1px"
		fontWeight={700}
		sx={{ ...lopuRainbowTextSx, animation: `tt-blink 1s steps(1) infinite, ${LOPU_UI.rainbowAnim}`, ...lopuReducedMotionSx }}
		aria-hidden="true"
	>
		▍
	</Box>
);

const CodeBlock = ({ block, caret, compact }: { block: Extract<LopuMdBlock, { kind: 'code' }>; caret: boolean; compact: boolean }) => {
	const info = describeLopuCodeBlock(block);
	return (
		<Box className="lopuCode" data-lang={block.lang || undefined} border={LOPU_UI.border} borderRadius={LOPU_UI.radiusMd} bg={LOPU_UI.surfaceAlt} overflow="hidden" minW={0}>
			<Flex align="center" gap={2} px={2.5} py={1} borderBottom={LOPU_UI.border} minH="30px">
				<Text as="span" sx={lopuEyebrowSx}>
					{info.label}
				</Text>
				{info.lines > 1 ? (
					<Text as="span" fontSize="10px" color={LOPU_UI.faint}>
						{info.lines} lines
					</Text>
				) : null}
				<Box flex={1} />
				{info.copyable ? <CopyButton text={info.clipboardText} label="Copy code" /> : null}
			</Flex>
			<Box
				as="pre"
				m={0}
				px={3}
				py={2}
				fontFamily={LOPU_UI.fontMono}
				fontSize={compact ? '11.5px' : '12px'}
				lineHeight="1.55"
				overflowX="auto"
				whiteSpace="pre"
				color={LOPU_UI.ink}
				sx={{ WebkitOverflowScrolling: 'touch' }}
			>
				{block.text}
				{caret || block.open ? <StreamingCaret /> : null}
			</Box>
		</Box>
	);
};

const BlockView = ({ block, caret, compact }: { block: LopuMdBlock; caret: boolean; compact: boolean }) => {
	const body = compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody;
	switch (block.kind) {
		case 'heading': {
			const size = block.level === 1 ? (compact ? '15px' : '17px') : block.level === 2 ? (compact ? '14px' : '15px') : body;
			return (
				<Text as={`h${block.level + 2}` as 'h3' | 'h4' | 'h5'} fontSize={size} fontWeight={700} color={LOPU_UI.ink} lineHeight="1.35" letterSpacing="-0.01em" whiteSpace="pre-wrap" overflowWrap="anywhere">
					<InlineRun inlines={block.inlines} />
					{caret ? <StreamingCaret /> : null}
				</Text>
			);
		}
		case 'list': {
			return (
				<Box as={block.ordered ? 'ol' : 'ul'} pl="1.4em" my={0} sx={{ '& > li': { marginBottom: '3px' }, '& > li::marker': { color: LOPU_UI.muted } }}>
					{block.items.map((item, index) => (
						<Box as="li" key={index} fontSize={body} lineHeight="1.6" color={LOPU_UI.ink} whiteSpace="pre-wrap" overflowWrap="anywhere">
							<InlineRun inlines={item} />
							{caret && index === block.items.length - 1 ? <StreamingCaret /> : null}
						</Box>
					))}
				</Box>
			);
		}
		case 'code':
			return <CodeBlock block={block} caret={caret} compact={compact} />;
		case 'paragraph':
		default:
			return (
				<Text fontSize={body} lineHeight="1.6" color={LOPU_UI.ink} whiteSpace="pre-wrap" overflowWrap="anywhere" my={0}>
					<InlineRun inlines={block.inlines} />
					{caret ? <StreamingCaret /> : null}
				</Text>
			);
	}
};

export const LopuMarkdown = ({ text, caret = false, compact = false }: { text: string; caret?: boolean; compact?: boolean }) => {
	const blocks = React.useMemo(() => parseLopuMarkdown(text), [text]);
	if (!blocks.length) return caret ? <StreamingCaret /> : null;
	return (
		<Box className="lopuMarkdown" display="flex" flexDirection="column" rowGap={compact ? 1.5 : 2} minW={0}>
			{blocks.map((block, index) => (
				<BlockView key={index} block={block} caret={caret && index === blocks.length - 1} compact={compact} />
			))}
		</Box>
	);
};
