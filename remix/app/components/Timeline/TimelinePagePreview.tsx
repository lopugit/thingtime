import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import type { TimelineEvent } from '../../timeline/contract';
import { useCapturedComponents } from '../../timeline/useCapturedComponents';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { useApi } from '../../hooks/useApi';
import { buildComponentsByRef, type ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import { TimelinePageCanvas } from './TimelinePageCanvas';
import { sanitizeWebpageBlocks } from '../../schemas/registry';

export function TimelinePagePreview({ event }: { event: TimelineEvent }) {
	const value = event.after?.value as any;
	const valid = ['thing-content', 'webpage-draft'].includes(event.after?.adapter ?? '') && Array.isArray(value?.crystal?.blocks);
	const [open, setOpen] = React.useState(false);
	if (!valid) return null;
	return (
		<Box mb={3}>
			<Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
				{open ? 'Hide page preview' : 'Preview page'}
			</Button>
			{open ? <PagePreview event={event} blocks={value.crystal.blocks} /> : null}
		</Box>
	);
}
function PagePreview({ event, blocks }: { event: TimelineEvent; blocks: unknown }) {
	const history = useCapturedComponents(event, blocks);
	const session = useTimelineSession();
	const api = useApi();
	const [current, setCurrent] = React.useState<ComponentsByRef | null>(null);
	const [mode, setMode] = React.useState<'recorded' | 'current'>('recorded');
	const [error, setError] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const controller = React.useRef<AbortController | null>(null);
	React.useEffect(() => () => controller.current?.abort(), []);
	const sanitized = sanitizeWebpageBlocks(blocks);
	if (!sanitized.ok)
		return (
			<Text role="status" mt={2}>
				This page version cannot be rendered safely. Its original data remains available.
			</Text>
		);
	const previewCurrent = async () => {
		if (!session.connection || busy) return;
		const attempt = new AbortController();
		controller.current = attempt;
		setBusy(true);
		setError('');
		try {
			const result = await api.v1.webpages.resolveComponents(session.connection.scope, sanitized.blocks, { signal: attempt.signal });
			if (attempt.signal.aborted) return;
			if (!result?.ok) throw new Error(result?.error || 'Could not load current components.');
			setCurrent(buildComponentsByRef(result));
			setMode('current');
		} catch (error: any) {
			if (!attempt.signal.aborted) setError(error?.error || error?.message || 'Could not load current components.');
		} finally {
			if (!attempt.signal.aborted) setBusy(false);
		}
	};
	return (
		<Box mt={3} minW={0}>
			<Text fontSize="sm" role="status">
				{mode === 'current'
					? 'Previewing current component definitions.'
					: history.loading
					? 'Loading recorded component definitions…'
					: history.missing.length
					? 'Some component definitions were not recorded for this version.'
					: 'Using the component definitions recorded with this version.'}{' '}
				Live data and actions are paused. Media and appearance may change independently.
			</Text>
			<Flex gap={2} wrap="wrap" my={2}>
				{mode === 'current' ? (
					<Button size="xs" onClick={() => setMode('recorded')}>
						Use recorded components
					</Button>
				) : (
					<Button size="xs" variant="ghost" isLoading={busy} onClick={() => void previewCurrent()}>
						Preview current components
					</Button>
				)}
				{history.error ? (
					<Button size="xs" onClick={history.retry}>
						Retry recorded components
					</Button>
				) : null}
			</Flex>
			{error || history.error ? (
				<Text fontSize="sm" role="status">
					{error || history.error}
				</Text>
			) : null}
			<TimelinePageCanvas blocks={sanitized.blocks} components={mode === 'current' ? current ?? {} : history.components} />
		</Box>
	);
}
