import React from 'react';
import { Box, Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';

import { toolGlyph, toolLabel, toolLinks, type LopuToolActivity } from './lopuTurnCore';

// One tool activity inside Lopu's bubble (design note §3.2): a friendly label
// for the tool, a spinner while it streams/runs, ✓ / 🌧️ when it lands, the
// executor's summary, and links to what it made (/builder?page=, /components/,
// /actions/) plus "Undo" for a page patch whose draft is still mounted.

const MUTED = 'var(--tt-muted, #9a9aa6)';

const StatusGlyph = ({ status }: { status: LopuToolActivity['status'] }) => {
	if (status === 'streaming' || status === 'running') return <Spinner size="xs" speed="0.8s" color="var(--tt-accent, #7c6cff)" thickness="2px" />;
	if (status === 'ok') {
		return (
			<Text as="span" fontSize="xs" fontWeight={700} color="var(--tt-success, #2f9e6b)" aria-label="done">
				✓
			</Text>
		);
	}
	return (
		<Text as="span" fontSize="xs" aria-label="failed">
			🌧️
		</Text>
	);
};

const patchCaption = (activity: LopuToolActivity): string | null => {
	if (!activity.patch) return null;
	const count = activity.patch.ops.length;
	return `${count} change${count === 1 ? '' : 's'} · ${activity.patch.persisted ? 'saved' : 'draft'}`;
};

export const LopuToolCard = ({
	activity,
	canUndo = false,
	onUndo
}: {
	activity: LopuToolActivity;
	canUndo?: boolean;
	onUndo?: (toolId: string) => void;
}) => {
	const links = React.useMemo(() => toolLinks(activity), [activity]);
	const busy = activity.status === 'streaming' || activity.status === 'running';
	const summary = activity.result?.summary || (activity.status === 'error' && !activity.result ? 'This step did not finish.' : '');
	const caption = patchCaption(activity);

	return (
		<Box
			className="lopuToolCard"
			data-tool={activity.name}
			data-status={activity.status}
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="12px"
			bg="var(--tt-surface-alt, #f5f5f7)"
			px={3}
			py={2}
			minW={0}
		>
			<Flex align="center" gap={2} minW={0}>
				<Text as="span" fontSize="sm" lineHeight={1} aria-hidden="true">
					{toolGlyph(activity.name)}
				</Text>
				<Text fontSize="xs" fontWeight={600} color="var(--tt-ink, #16161a)" isTruncated>
					{toolLabel(activity.name, activity.status)}
				</Text>
				{caption ? (
					<Text fontSize="10px" color={MUTED} fontFamily="var(--tt-font-mono, monospace)" letterSpacing="0.04em" flexShrink={0}>
						{caption}
					</Text>
				) : null}
				<Box flex={1} />
				<StatusGlyph status={activity.status} />
			</Flex>
			{summary ? (
				<Text fontSize="xs" color={activity.status === 'error' ? 'var(--tt-danger, #d64545)' : MUTED} mt={1} noOfLines={busy ? 2 : 4} whiteSpace="pre-wrap" overflowWrap="anywhere">
					{summary}
				</Text>
			) : null}
			{links.length || canUndo ? (
				<Flex gap={3} mt={1.5} wrap="wrap" align="center">
					{links.map((link) => (
						<Box
							as={RouterLink}
							key={link.href}
							to={link.href}
							fontSize="xs"
							fontWeight={700}
							color="var(--tt-accent, #7c6cff)"
							textDecoration="underline"
							textUnderlineOffset="2px"
							overflowWrap="anywhere"
						>
							{link.label} →
						</Box>
					))}
					{canUndo && onUndo ? (
						<Button size="xs" variant="ghost" height="22px" px={2} onClick={() => onUndo(activity.id)} title="Put the page back the way it was">
							↩︎ Undo
						</Button>
					) : null}
				</Flex>
			) : null}
		</Box>
	);
};
