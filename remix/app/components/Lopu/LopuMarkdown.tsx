import React from 'react';
import { Box, Text } from '@chakra-ui/react';

import { parseLopuMarkdown, type LopuInline, type LopuMdBlock } from './lopuTurnCore';

// Lopu's bubble text: the tiny markdown-ish grammar from lopuTurnCore
// (paragraphs, headings, bullet/numbered lists, inline code, bold/italic,
// fenced code) drawn through React text nodes ONLY — there is no HTML sink
// here, so a model that emits markup shows the literal characters. Streaming
// aware: an open fence keeps growing as a code block and the caret rides the
// last line.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';
const INK = 'var(--tt-ink, #16161a)';

const InlineRun = ({ inlines }: { inlines: LopuInline[] }) => (
	<>
		{inlines.map((inline, index) => {
			if (inline.kind === 'code') {
				return (
					<Box
						as="code"
						key={index}
						fontFamily={MONO}
						fontSize="0.9em"
						bg="var(--tt-surface-alt, #f5f5f7)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="6px"
						px="4px"
						py="1px"
						whiteSpace="pre-wrap"
						overflowWrap="anywhere"
					>
						{inline.text}
					</Box>
				);
			}
			if (inline.kind === 'strong') {
				return (
					<Box as="strong" key={index} fontWeight={700}>
						{inline.text}
					</Box>
				);
			}
			if (inline.kind === 'em') {
				return (
					<Box as="em" key={index} fontStyle="italic">
						{inline.text}
					</Box>
				);
			}
			return <React.Fragment key={index}>{inline.text}</React.Fragment>;
		})}
	</>
);

export const StreamingCaret = () => (
	<Box as="span" ml="1px" color="var(--tt-faint, #b6b6c0)" sx={{ animation: 'tt-blink 1s steps(1) infinite' }} aria-hidden="true">
		▍
	</Box>
);

const BlockView = ({ block, caret }: { block: LopuMdBlock; caret: boolean }) => {
	switch (block.kind) {
		case 'heading': {
			const size = block.level === 1 ? 'lg' : block.level === 2 ? 'md' : 'sm';
			return (
				<Text as={`h${block.level + 2}` as 'h3' | 'h4' | 'h5'} fontSize={size} fontWeight={700} color={INK} lineHeight="1.35" whiteSpace="pre-wrap" overflowWrap="anywhere">
					<InlineRun inlines={block.inlines} />
					{caret ? <StreamingCaret /> : null}
				</Text>
			);
		}
		case 'list': {
			return (
				<Box as={block.ordered ? 'ol' : 'ul'} pl="1.4em" my={0} sx={{ '& > li': { marginBottom: '2px' } }}>
					{block.items.map((item, index) => (
						<Box as="li" key={index} fontSize="sm" lineHeight="1.6" color={INK} whiteSpace="pre-wrap" overflowWrap="anywhere">
							<InlineRun inlines={item} />
							{caret && index === block.items.length - 1 ? <StreamingCaret /> : null}
						</Box>
					))}
				</Box>
			);
		}
		case 'code': {
			return (
				<Box
					as="pre"
					fontFamily={MONO}
					fontSize="12px"
					lineHeight="1.55"
					bg="var(--tt-surface-alt, #f5f5f7)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="10px"
					px={3}
					py={2}
					my={0}
					overflowX="auto"
					whiteSpace="pre"
					color={INK}
					data-lang={block.lang || undefined}
				>
					{block.lang ? (
						<Box as="span" display="block" fontSize="10px" letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" mb={1}>
							{block.lang}
						</Box>
					) : null}
					{block.text}
					{caret || block.open ? <StreamingCaret /> : null}
				</Box>
			);
		}
		case 'paragraph':
		default:
			return (
				<Text fontSize="sm" lineHeight="1.6" color={INK} whiteSpace="pre-wrap" overflowWrap="anywhere" my={0}>
					<InlineRun inlines={block.inlines} />
					{caret ? <StreamingCaret /> : null}
				</Text>
			);
	}
};

export const LopuMarkdown = ({ text, caret = false }: { text: string; caret?: boolean }) => {
	const blocks = React.useMemo(() => parseLopuMarkdown(text), [text]);
	if (!blocks.length) return caret ? <StreamingCaret /> : null;
	return (
		<Box display="flex" flexDirection="column" rowGap={2} minW={0}>
			{blocks.map((block, index) => (
				<BlockView key={index} block={block} caret={caret && index === blocks.length - 1} />
			))}
		</Box>
	);
};
