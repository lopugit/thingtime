import React from 'react';
import { Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Select, Switch, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from './useLopu';
import { DEFAULT_RECORDING_SETTINGS, type RecordingSettings } from '~/api/utils/lopu/recordingsCore';
import { supportsRecordingAutomation } from './recordingsCapabilities';

type RecordingData = {
	ownerId: string;
	settings: RecordingSettings;
	provider: { configured: boolean; name: string };
	jobs: Array<{
		id: string;
		postId: string;
		filename: string;
		status: string;
		error: string | null;
		attempts: number;
		commentIds: string[];
		resultIds: string[];
	}>;
	todos: Array<{ id: string; title: string; completed: boolean; reminders: boolean; sourcePostId: string }>;
};

const panel = { border: '1px solid var(--tt-border, #ececef)', borderRadius: '16px', background: 'var(--tt-card, white)', p: [4, 6] };
const jsonRequest = async (path: string, body?: unknown) => {
	// Some supported WebViews (and the app's fetch polyfill) have AbortController
	// but not AbortSignal.timeout. Keep the timeout without relying on that static.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	try {
		const response = await fetch(path, {
			credentials: 'same-origin',
			cache: 'no-store',
			signal: controller.signal,
			...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
		});
		const result = await response.json();
		if (!response.ok || result.ok === false) throw new Error(result.error || 'Thingtime could not finish this request.');
		return result;
	} finally {
		clearTimeout(timer);
	}
};

export function RecordingAutomationPage() {
	const user = useCurrentUser();
	const userId = user?.id;
	const lopu = useLopu();
	const [data, setData] = React.useState<RecordingData | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);
	const [postId, setPostId] = React.useState('');
	const [zone, setZone] = React.useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
	const generation = React.useRef(0);
	const requestActive = React.useRef<symbol | null>(null);
	const mutationActive = React.useRef(false);
	const zoneOwner = React.useRef<string | null>(null);
	const current = data?.ownerId === userId ? data : null;
	const settings = current?.settings || DEFAULT_RECORDING_SETTINGS;

	const load = React.useCallback(async () => {
		if (!userId || requestActive.current || mutationActive.current) return;
		const requestToken = Symbol();
		requestActive.current = requestToken;
		const seq = generation.current;
		try {
			const manifest = await jsonRequest('/.well-known/thingtime-capabilities.json');
			if (!supportsRecordingAutomation(manifest, window.location.origin))
				throw new Error('Recording automation is not available on this Thingtime domain yet.');
			const next = await jsonRequest('/api/v1/lopu/recordings');
			if (seq !== generation.current || next.ownerId !== userId) return;
			setData(next);
			setError(null);
			setCheckedAt(new Date());
			if (zoneOwner.current !== userId) {
				setZone(next.settings.timeZone);
				zoneOwner.current = userId;
			}
		} catch (failure) {
			if (seq === generation.current) setError(failure instanceof Error ? failure.message : 'Connection failed. Please refresh.');
		} finally {
			if (requestActive.current === requestToken) requestActive.current = null;
		}
	}, [userId]);

	React.useEffect(() => {
		generation.current++;
		requestActive.current = null;
		mutationActive.current = false;
		zoneOwner.current = null;
		setData(null);
		setError(null);
		setCheckedAt(null);
		setBusy(false);
		void load();
		const timer = setInterval(() => {
			if (!document.hidden) void load();
		}, 15_000);
		return () => {
			generation.current++;
			clearInterval(timer);
		};
	}, [load]);

	const change = async (body: unknown, optimistic?: (previous: RecordingData) => RecordingData) => {
		if (busy || !current) return;
		const previous = current;
		const seq = ++generation.current;
		mutationActive.current = true;
		setBusy(true);
		if (optimistic) setData(optimistic(current));
		try {
			const manifest = await jsonRequest('/.well-known/thingtime-capabilities.json');
			if (!supportsRecordingAutomation(manifest, window.location.origin)) throw new Error('Recording automation is not supported on this domain.');
			const next = await jsonRequest('/api/v1/lopu/recordings', body);
			if (generation.current !== seq || next.ownerId !== userId) return;
			setData(next);
			setError(null);
			setCheckedAt(new Date());
		} catch (failure) {
			if (generation.current !== seq) return;
			setData(previous);
			lopu({
				title: 'Recording update did not save',
				description: failure instanceof Error ? failure.message : 'Please try again.',
				status: 'error'
			});
		} finally {
			if (generation.current === seq) {
				mutationActive.current = false;
				setBusy(false);
			}
		}
	};

	const patch = (value: Partial<RecordingSettings>) =>
		change({ op: 'settings', settings: value }, (previous) => ({ ...previous, settings: { ...previous.settings, ...value } }));

	return (
		<PageShell width={760}>
			<PageHeader
				eyebrow="Lopu · Apple Watch"
				title="Record it. Remember it. 🦄"
				subtitle="Private recordings become transcripts, useful notes and todos — with daily reminders until you tick them off."
			/>
			{!user || user.temporary ? (
				<Box {...panel}>
					<Text mb={3}>Sign in to manage your Watch recordings.</Text>
					<Button as={Link} to="/login">
						Sign in
					</Button>
				</Box>
			) : (
				<>
					<Flex justify="space-between" align="center" gap={3} flexWrap="wrap">
						<Text fontSize="sm">
							Connected account: <strong>@{user.username}</strong>
						</Text>
						<Button size="sm" variant="outline" onClick={() => void load()}>
							Refresh status
						</Button>
					</Flex>
					{error ? (
						<Text role="status" color="var(--tt-text)">
							{error}
						</Text>
					) : null}
					<Box {...panel}>
						<Flex align="center" justify="space-between" gap={4}>
							<Box>
								<Text as="h2" fontWeight="bold">
									Automatic Watch recordings
								</Text>
								<Text fontSize="sm" color="var(--tt-muted)">
									New uploads only. Existing recordings can be added below.
								</Text>
							</Box>
							<Switch
								aria-label="Automatic Watch recordings"
								isChecked={settings.enabled}
								isDisabled={busy || !current || (!current.provider.configured && !settings.enabled)}
								onChange={(event) => void patch({ enabled: event.target.checked, ...(event.target.checked ? { timeZone: zone } : {}) })}
							/>
						</Flex>
						<Text mt={4} fontSize="sm">
							When enabled, your recording audio and transcript are sent to Thingtime’s configured OpenAI provider. Transcripts are posted as private
							comments. Generated notes and todos stay private. This does not buy anything, contact anyone, or carry out the tasks.
						</Text>
						<Text mt={2} fontSize="sm" role="status">
							{current
								? current.provider.configured
									? 'Provider configured · M4A, MP3, WAV or WebM · up to 24 MiB per recording'
									: 'Transcription is not configured on this domain yet.'
								: 'Checking connection…'}
						</Text>
						<Flex direction="column" gap={4} mt={5}>
							{(
								[
									['createTodos', 'Create todos from clear instructions'],
									['createNotes', 'Create notes for useful topics'],
									['dailyReminders', 'Send daily reminders for unfinished todos']
								] as const
							).map(([key, label]) => (
								<Checkbox
									key={key}
									isChecked={settings[key]}
									isDisabled={busy || !current}
									onChange={(event) => void patch({ [key]: event.target.checked })}
								>
									{label}
								</Checkbox>
							))}
							<Flex gap={4} direction={['column', 'row']}>
								<FormControl flex={1} minWidth={0}>
									<FormLabel fontSize="sm">Reminder time zone</FormLabel>
									<Input
										boxSizing="border-box"
										width="100%"
										value={zone}
										onChange={(event) => setZone(event.target.value)}
										aria-label="Reminder time zone"
									/>
									<Button mt={2} size="sm" variant="outline" isDisabled={busy || !current} onClick={() => void patch({ timeZone: zone })}>
										Save time zone
									</Button>
									<Text fontSize="xs" mt={1}>
										Saved: {settings.timeZone}
									</Text>
								</FormControl>
								<FormControl flex={1} minWidth={0}>
									<FormLabel fontSize="sm">Daily reminder time</FormLabel>
									<Select
										boxSizing="border-box"
										aria-label="Daily reminder time"
										value={settings.reminderHour}
										isDisabled={busy || !current}
										onChange={(event) => void patch({ reminderHour: Number(event.target.value) })}
									>
										{Array.from({ length: 24 }, (_, hour) => (
											<option key={hour} value={hour}>
												{String(hour).padStart(2, '0')}:00
											</option>
										))}
									</Select>
									<Text fontSize="xs" mt={2}>
										Around this time in your selected time zone. Notification preferences also apply.
									</Text>
								</FormControl>
							</Flex>
						</Flex>
					</Box>
					<Box {...panel}>
						<Text as="h2" fontWeight="bold" mb={3}>
							Your recording todos
						</Text>
						{current?.todos.length ? (
							<Flex direction="column" gap={4}>
								{current.todos.map((todo) => (
									<Box key={todo.id}>
										<Checkbox
											isChecked={todo.completed}
											isDisabled={busy}
											onChange={(event) =>
												void change({ op: 'todo', id: todo.id, completed: event.target.checked }, (previous) => ({
													...previous,
													todos: previous.todos.map((item) => (item.id === todo.id ? { ...item, completed: !item.completed } : item))
												}))
											}
										>
											<Text as="span" textDecoration={todo.completed ? 'line-through' : undefined} overflowWrap="anywhere">
												{todo.title}
											</Text>
										</Checkbox>
										<Flex mt={1} ml={6} gap={3} align="center" flexWrap="wrap">
											<Link to={`/thing/${encodeURIComponent(todo.id)}`}>Open Thing</Link>
											<Button
												size="xs"
												variant="ghost"
												isDisabled={busy}
												onClick={() => void change({ op: 'todo', id: todo.id, reminders: !todo.reminders })}
											>
												{todo.reminders ? 'Pause reminders' : 'Resume reminders'}
											</Button>
										</Flex>
									</Box>
								))}
							</Flex>
						) : (
							<Text fontSize="sm" color="var(--tt-muted)">
								Todos from your recordings will appear here. Complete one to stop its daily reminders.
							</Text>
						)}
					</Box>
					<Box {...panel}>
						<Text as="h2" fontWeight="bold" mb={3}>
							Recording activity
						</Text>
						{current?.jobs.length ? (
							<Flex direction="column" gap={4}>
								{current.jobs.map((job) => (
									<Box key={job.id}>
										<Flex gap={2} align="baseline" flexWrap="wrap">
											<Link to={`/post/${encodeURIComponent(job.postId)}`}>
												<Text overflowWrap="anywhere">{job.filename}</Text>
											</Link>
											<Badge>{job.status}</Badge>
										</Flex>
										{job.error ? (
											<Text fontSize="sm" mt={1}>
												{job.error}
											</Text>
										) : null}
										{job.status === 'done' ? (
											<Text fontSize="sm" color="var(--tt-muted)">
												{job.commentIds.length} transcript comment{job.commentIds.length === 1 ? '' : 's'} · {job.resultIds.length} Things created
											</Text>
										) : null}
										{['failed', 'retry', 'paused'].includes(job.status) ? (
											<Button size="sm" mt={2} isDisabled={busy || !settings.enabled} onClick={() => void change({ op: 'retry', id: job.id })}>
												Retry recording
											</Button>
										) : null}
									</Box>
								))}
							</Flex>
						) : (
							<Text fontSize="sm" color="var(--tt-muted)">
								No recordings queued yet. Upload a private recording from your Watch after enabling automation.
							</Text>
						)}
						<Text mt={4} fontSize="xs" color="var(--tt-muted)">
							{checkedAt
								? `Last checked ${checkedAt.toLocaleTimeString()}. New uploads are picked up automatically within a few minutes.`
								: 'Checking recording activity…'}
						</Text>
					</Box>
					<Box {...panel}>
						<FormControl>
							<FormLabel>Process an existing Watch recording</FormLabel>
							<Text fontSize="sm" mb={3}>
								Paste the post ID or its Thingtime post link. Re-queuing an already processed recording will not duplicate its Things.
							</Text>
							<Input
								aria-label="Existing recording post"
								placeholder="watch-upload-… or a post link"
								value={postId}
								onChange={(event) => setPostId(event.target.value)}
							/>
							<Button
								mt={3}
								isDisabled={busy || !settings.enabled || !postId.trim()}
								onClick={() => {
									let id = postId.trim();
									try {
										const url = new URL(id);
										if (url.origin !== window.location.origin) throw new Error();
										id = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
									} catch {
										/* raw ids are validated by the server */
									}
									void change({ op: 'queue', postId: id });
								}}
							>
								Queue recording
							</Button>
						</FormControl>
					</Box>
				</>
			)}
		</PageShell>
	);
}
