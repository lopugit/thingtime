import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { timelineScopeKey, type TimelineEvent } from '../../timeline/contract';
import { parsePublishedVersionPreview, type PublishedVersionPreview, type VersionRequest } from '../../timeline/publishedVersion';
import { timelineDisplayChanges, timelineChangeLabel, timelineValueLabel, type TimelineChange } from '../../timeline/changes';

/** One change of the Changes tab. The same box shows a recorded before/after
 * and, in Compare with now, this version against the Thing today. */
export function HistoryChangeBox({ change, labels }: { change: TimelineChange; labels: readonly [string, string] }) {
	return (
		<Box mb={3} p={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg">
			<Text fontWeight="600" mb={2} overflowWrap="anywhere">
				{timelineChangeLabel(change.path)}
			</Text>
			<Text fontSize="sm" color="var(--tt-muted)" noOfLines={4} overflowWrap="anywhere">
				{labels[0]}: {timelineValueLabel(change.before, change.path)}
			</Text>
			<Text fontSize="sm" mt={1} noOfLines={4} overflowWrap="anywhere">
				{labels[1]}: {timelineValueLabel(change.after, change.path)}
			</Text>
		</Box>
	);
}

/** Compare with now is a read-only restore preview: the server resolves the
 * version's full content (including split snapshots) and the live Thing, and
 * nothing is applied. The result is fenced by scope and event: a reply for an
 * earlier selection never paints over the current one. */
export function useTimelineCompareNow(event: TimelineEvent | null) {
	const { connection } = useTimelineSession();
	const api = useApi();
	const key = connection && event ? `${timelineScopeKey(connection.scope)}:${event.id}` : '';
	const [state, setState] = React.useState<{ key: string; preview: PublishedVersionPreview | null; error: string; busy: boolean }>({ key: '', preview: null, error: '', busy: false });
	const keyRef = React.useRef(key); keyRef.current = key;
	const pending = React.useRef<string | null>(null);
	const alive = React.useRef(true);
	React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
	const compare = async () => {
		// Only the same event's comparison is debounced; selecting another event starts its own
		// request, and the key fence below keeps an earlier reply from painting over it.
		if (!connection || !event || pending.current === key) return;
		const started = key;
		pending.current = started;
		setState({ key: started, preview: null, error: '', busy: true });
		try {
			await connection.sync.pushPending();
			const query: VersionRequest = { command: 'preview-version', mode: 'restore', eventId: event.id, recover: true, choices: {}, componentMode: 'current', componentChoices: {} };
			const result = await api.v1.timeline.version(connection.scope, query);
			if (result?.ok === false || !result?.preview) throw new Error(result?.error || 'Could not compare this version with now.');
			const preview = parsePublishedVersionPreview(result.preview, event.id, event.thingId, query);
			if (alive.current && keyRef.current === started) setState({ key: started, preview, error: '', busy: false });
		} catch (failure: any) {
			// The page-dependency refusal is a known gap of this comparison, not of the version.
			const message = failure?.status === 422 && /dependencies/i.test(failure?.error || failure?.message || '')
				? 'Compare with now is not available for this page version yet.'
				: failure?.error || failure?.message || 'Could not compare this version with now.';
			if (alive.current && keyRef.current === started) setState({ key: started, preview: null, error: message, busy: false });
		} finally { if (pending.current === started) pending.current = null; }
	};
	const clear = () => setState({ key: '', preview: null, error: '', busy: false });
	const current = state.key === key ? state : null;
	return { enabled: !!connection && !!event, preview: current?.preview ?? null, error: current?.error ?? '', busy: current?.busy ?? false, compare, clear };
}

/** Then = this version, Now = the Thing today. Page-ness comes from the
 * preview's `thingtime`, because preview sides carry only restorable content. */
export function TimelineCompareNow({ preview }: { preview: PublishedVersionPreview }) {
	const page = !!preview.thingtime?.includes('webpage');
	const changes = React.useMemo(() => (preview.current ? timelineDisplayChanges(preview.incoming, preview.current, { page }) : []), [preview, page]);
	const componentsDiffer = !!preview.components && JSON.stringify(preview.components.incoming) !== JSON.stringify(preview.components.current);
	return (
		<Box data-testid="timeline-compare-now" mb={3}>
			<Text fontWeight="600" fontSize="sm">
				Then and now
			</Text>
			<Text fontSize="xs" color="var(--tt-muted)" mb={2}>
				This version compared with the Thing as it is now. Read-only: nothing is changed.
			</Text>
			{preview.current === null ? (
				<Text role="status" fontSize="sm" mb={3}>
					This Thing no longer exists now.
				</Text>
			) : !changes.length ? (
				<Text role="status" fontSize="sm" mb={3}>
					This version matches the Thing as it is now.
				</Text>
			) : null}
			{componentsDiffer ? (
				<Text fontSize="sm" mb={3}>
					Page components also differ between then and now. Review this version with Restore to see its recorded components.
				</Text>
			) : null}
			{changes.map((change, index) => (
				<HistoryChangeBox key={index} change={change} labels={['Then', 'Now']} />
			))}
		</Box>
	);
}
