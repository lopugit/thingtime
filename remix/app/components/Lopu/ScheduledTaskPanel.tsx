import React from 'react';
import { Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { CARD_STYLES } from '~/theme/card';

export function ScheduledTaskPanel({ thingId }: { thingId: string }) {
	const [data, setData] = React.useState<any>(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
	const epoch = React.useRef(0);
	const request = React.useCallback(async (body?: unknown) => {
		const sequence = epoch.current;
		setBusy(true); setError('');
		try {
			await requireThingtimeCapability('api.lopu-reminders', '1.1.0');
			if (body) {
				const response = await fetch('/api/v1/lopu/reminders', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
				const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || 'Could not update schedule.');
			}
			const response = await fetch(`/api/v1/lopu/reminders?thingId=${encodeURIComponent(thingId)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
			const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load schedule.');
			if (sequence === epoch.current) setData(result);
		} catch (failure) { if (sequence === epoch.current) setError(failure instanceof Error ? failure.message : 'Please retry.'); }
		finally { if (sequence === epoch.current) setBusy(false); }
	}, [thingId]);
	React.useEffect(() => { epoch.current++; setData(null); void request(); return () => { epoch.current++; }; }, [request]);
	const task = data?.reminder;
	return <Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0}>
		<Flex align="center" justify="space-between" wrap="wrap" gap={3}><Heading as="h2" size="sm">Scheduled task</Heading><Button size="sm" isDisabled={busy} onClick={() => void request()}>Refresh task</Button></Flex>
		{task ? <Stack mt={3} spacing={3}>
			<Text>{task.mode === 'assistant' ? 'Fresh AI update' : task.mode === 'message' ? 'Lopu chat reminder' : 'Notification'} · {task.runStatus === 'needs-attention' ? 'Needs attention — interrupted run will not be replayed' : !task.nextRunAt ? 'Completed' : task.enabled ? 'Active' : 'Paused'}</Text>
			<Text fontSize="sm">{task.cron ? `${task.cron} · ${task.timeZone}` : task.everyMinutes ? `Every ${task.everyMinutes} minutes` : 'One time'}{task.nextRunAt ? ` · Next: ${new Date(task.nextRunAt).toLocaleString()}` : ''}</Text>
			<Text fontSize="sm" color="var(--tt-muted)">Checked every five minutes. Missed runs skip forward. Pausing stops future starts; an already-started run may finish. AI updates use your normal account/provider allowance and cannot perform additional mutations.</Text>
			<Button size="sm" alignSelf="start" isDisabled={busy || !task.nextRunAt || task.runStatus === 'needs-attention'} onClick={() => void request({ op: 'set-enabled', id: task.id, enabled: !task.enabled })}>{task.enabled ? 'Pause' : 'Resume'}</Button>
			{task.destinationChatId || task.chatId ? <Link to={`/lopu/${encodeURIComponent(task.destinationChatId || task.chatId)}`}>Open destination conversation</Link> : null}
			{data.relatedThings.length ? <Box><Text fontWeight="semibold">Linked Things</Text>{data.relatedThings.map((thing: any) => <Text key={thing.id} overflowWrap="anywhere"><Link to={`/thing/${encodeURIComponent(thing.id)}`}>{thing.title}</Link></Text>)}</Box> : null}
			<Box><Text fontWeight="semibold">Recent runs</Text>{!data.runs.length ? <Text fontSize="sm">No runs yet.</Text> : data.runs.map((run: any) => <Flex key={run.id} gap={2} wrap="wrap" my={2} fontSize="sm"><Link to={`/thing/${encodeURIComponent(run.id)}`}>{run.scheduledAt} · {run.status}</Link><Link to={`/lopu/${encodeURIComponent(run.chatId)}`}>Conversation</Link></Flex>)}</Box>
		</Stack> : null}
		{error ? <Text role="alert" color="red.500" mt={3}>{error}</Text> : null}
	</Box>;
}
