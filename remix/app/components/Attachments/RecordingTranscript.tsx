import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { createRecordingTranscriptClient } from './recordingTranscriptClient';

const client = createRecordingTranscriptClient(async (ownerId, ids, signal) => {
	await requireThingtimeCapability('api.lopu-recordings', '1.7.0');
	if (signal.aborted) return {};
	const response = await fetch(`/api/v1/lopu/recordings?transcriptAttachmentIds=${encodeURIComponent(ids.join(','))}`, {
		credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal
	});
	if (response.status === 401 || response.status === 403) return {};
	if (!response.ok) throw new Error('Transcript lookup unavailable');
	const data = await response.json();
	if (data.ownerId !== ownerId || data.ok !== true) return {};
	return Object.fromEntries((Array.isArray(data.transcripts) ? data.transcripts : []).flatMap((row: any) =>
		ids.includes(row?.attachmentId) && typeof row.text === 'string' && row.text.length <= 60_000 ? [[row.attachmentId, row.text]] : []));
});

export const TranscriptQuote = ({ text, compact = false }: { text: string; compact?: boolean }) => {
	const [expanded, setExpanded] = React.useState(false);
	const quoteId = React.useId();
	const long = text.length > 480 || text.split('\n').length > 6;
	if (!text.trim()) return null;
	return <Box mt={3} minW={0} width="100%" userSelect="text" data-recording-transcript
		onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
		<Box as="blockquote" m={0} borderLeft="2px solid var(--tt-border, #ececef)" pl={3} py={1} color="var(--tt-text, #62626f)">
			<Text fontSize="10px" letterSpacing="0.08em" textTransform="uppercase" mb={1} color="var(--tt-muted, #9a9aa6)">Transcript</Text>
			<Text id={quoteId} fontSize={compact ? 'xs' : 'sm'} fontStyle="italic" lineHeight="1.7" whiteSpace="pre-wrap" overflowWrap="anywhere"
				noOfLines={long && !expanded ? 5 : undefined}>{text}</Text>
		</Box>
		{long && <Button size="xs" variant="ghost" mt={1} ml={2} aria-expanded={expanded} aria-controls={quoteId}
			onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }}>
			{expanded ? 'Show less' : 'Show full transcript'}
		</Button>}
	</Box>;
};

let mountedReaders = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
const refresh = () => { if (document.visibilityState === 'visible') client.refreshAll(); };

const OwnedRecordingTranscript = ({ ownerId, attachmentId, compact }: { ownerId: string; attachmentId: string; compact: boolean }) => {
	const key = JSON.stringify([ownerId, attachmentId]);
	const [result, setResult] = React.useState<{ key: string; text: string | null }>();
	React.useEffect(() => {
		if (!ownerId || !attachmentId || !/^[a-zA-Z0-9_-]{1,160}$/.test(attachmentId)) return;
		return client.subscribe(ownerId, attachmentId, (text) => setResult({ key, text }));
	}, [ownerId, attachmentId, key]);
	React.useEffect(() => {
		if (mountedReaders++ === 0) {
			window.addEventListener('focus', refresh);
			document.addEventListener('visibilitychange', refresh);
			refreshTimer = setInterval(refresh, 60_000);
		}
		return () => {
			if (--mountedReaders === 0) {
				clearInterval(refreshTimer);
				window.removeEventListener('focus', refresh);
				document.removeEventListener('visibilitychange', refresh);
			}
		};
	}, []);
	return result?.key === key && result.text ? <TranscriptQuote key={key} text={result.text} compact={compact} /> : null;
};

export const RecordingTranscript = ({ attachmentId, compact = false }: { attachmentId?: string; compact?: boolean }) => {
	const user = useCurrentUser();
	return user && !user.temporary && attachmentId
		? <OwnedRecordingTranscript key={JSON.stringify([user.id, attachmentId])} ownerId={user.id} attachmentId={attachmentId} compact={compact} /> : null;
};
