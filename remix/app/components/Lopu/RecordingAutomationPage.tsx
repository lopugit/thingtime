import React from 'react';
import { Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Menu, MenuButton, MenuList, MenuItem, Select, Switch, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from './useLopu';
import { DEFAULT_RECORDING_SETTINGS, type RecordingSettings } from '~/api/utils/lopu/recordingsCore';
import { supportsRecordingAutomation, supportsPersonalRecordingSettings } from './recordingsCapabilities';
import type { RecordingConnectionChoice } from '~/api/utils/lopu/recordingsConnections';
import type { PersonalRecordingDevice } from '~/api/utils/lopu/personalRecordingDevices';

type RecordingData = {
	ownerId: string;
	settings: RecordingSettings;
	provider: { configured: boolean; name: string; transcription: boolean; analysis: boolean; choices: RecordingConnectionChoice[];
		devices?: PersonalRecordingDevice[]; device?: PersonalRecordingDevice | null };
	jobs: Array<{
		id: string;
		postId: string;
		filename: string;
		status: string;
		runtimeDeviceId?: string | null;
		handoffStatus: string | null;
		handoffChatId: string | null;
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
	const [personalSupported, setPersonalSupported] = React.useState(false);
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
			setPersonalSupported(supportsPersonalRecordingSettings(manifest, window.location.origin));
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
		setPersonalSupported(false);
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
			if ((body as any)?.settings?.runtimeDeviceId !== undefined && !supportsPersonalRecordingSettings(manifest, window.location.origin))
				throw new Error('Personal recording devices are not supported on this domain yet.');
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
	const moveProvider = (key: 'transcriptionProviders' | 'analysisProviders', index: number, offset: number) => {
		const ids = [...settings[key]];
		[ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
		void patch({ [key]: ids });
	};

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
							{settings.runtimeDeviceId
								? 'When enabled, recordings download to your selected personal device for local transcription. Only transcript text is sent to native Claude Code on that device. There is no automatic fallback to cloud API credentials. '
								: 'When enabled, your recording audio and transcript are sent to your selected AI providers. If a selected connection is unavailable, the next connection in that stage’s list is tried. '}
							Transcripts are posted as private comments. Generated notes and todos stay private. This does not buy anything, contact anyone, or carry out the tasks.
						</Text>
						<Text mt={2} fontSize="sm" role="status">
							{current
								? current.provider.configured
									? `${settings.runtimeDeviceId ? 'Personal device paired' : 'Provider configured'} · M4A, MP3, WAV or WebM · up to 24 MiB per recording`
									: 'Select a paired recording device or configured connections for the enabled stages.'
								: 'Checking connection…'}
						</Text>
						<FormControl mt={5}>
							<FormLabel htmlFor="recording-processor">Recording processor</FormLabel>
							<Select id="recording-processor" value={settings.runtimeDeviceId || ''} isDisabled={busy || !current || !personalSupported}
								onChange={(event) => void patch({ runtimeDeviceId: event.target.value || null })}>
								<option value="">AI provider waterfall</option>
								{settings.runtimeDeviceId && !current?.provider.devices?.some((device) => device.id === settings.runtimeDeviceId)
									? <option value={settings.runtimeDeviceId}>Selected device unavailable — choose another</option> : null}
								{current?.provider.devices?.map((device) => <option key={device.id} value={device.id}>{device.name} — {device.online ? 'seen recently' : 'offline'}</option>)}
							</Select>
							<Text fontSize="sm" mt={2}>
								{!personalSupported ? 'This domain needs the personal recording update before a device can be selected.'
									: 'Choose a paired personal worker for local audio transcription and text-only Claude Code. Existing jobs keep their processor until you explicitly retry them with the new selection.'}
							</Text>
							{personalSupported && !current?.provider.devices?.length ? <Text fontSize="sm" mt={2}>
								No personal recording worker is paired yet. <Link to="/devices">Manage your devices</Link>. Ordinary Watch or phone connections are not recording workers.
							</Text> : null}
							{settings.runtimeDeviceId ? <Text fontSize="sm" mt={2} role="status">
								{current?.provider.device
									? `${current.provider.device.name}: ${current.provider.device.online ? 'contacted Thingtime recently' : 'offline — recordings will wait'}.${current.provider.device.lastSeenAt ? ` Last seen ${new Date(current.provider.device.lastSeenAt).toLocaleString()}.` : ''} Pairing does not confirm AI usage allowance.`
									: 'The selected worker is unavailable or revoked. Choose another worker, or explicitly switch to the provider waterfall.'}
							</Text> : null}
						</FormControl>
						{!settings.runtimeDeviceId ? <Box mt={5}>
							<Text as="h3" fontWeight="bold">
								AI credential waterfall
							</Text>
							<Text fontSize="sm" mt={2}>
								Choose up to four connections per stage, in order. Personal keys stay in your Secure Vault; platform keys stay server-side. Only your
								selected connections are used.
							</Text>
							<Link to="/settings">Manage API connections in Settings → Secure Vault</Link>
							{(['transcription', 'analysis'] as const).map((stage) => {
								const key = stage === 'transcription' ? 'transcriptionProviders' : 'analysisProviders';
								const selected = settings[key];
								const choices = current?.provider.choices || [];
								const available = choices.filter((choice) => choice[stage] && !selected.includes(choice.id));
								const label = stage === 'transcription' ? 'Audio transcription' : 'Notes and todos';
								return (
									<Box key={stage} mt={4}>
										<Text fontWeight="semibold">{label}</Text>
										{stage === 'transcription' ? (
											<Text fontSize="xs" color="var(--tt-muted)">
												OpenAI API connections support audio. Claude API connections are available for notes and todos, not transcription.
											</Text>
										) : null}
										{selected.map((id, index) => {
											const choice = choices.find((entry) => entry.id === id);
											return (
												<Flex key={id} gap={2} mt={2} align="center" flexWrap="wrap">
													<Text fontSize="sm" flex="1" minW="120px" overflowWrap="anywhere">
														{index + 1}. {choice?.name || 'Unavailable connection'}
														{choice && !choice.configured ? ' (not configured)' : ''}
													</Text>
													<Button
														size="xs"
														aria-label={`Move ${label} connection ${index + 1} up`}
														isDisabled={busy || index === 0}
														onClick={() => moveProvider(key, index, -1)}
													>
														↑
													</Button>
													<Button
														size="xs"
														aria-label={`Move ${label} connection ${index + 1} down`}
														isDisabled={busy || index === selected.length - 1}
														onClick={() => moveProvider(key, index, 1)}
													>
														↓
													</Button>
													<Button
														size="xs"
														aria-label={`Remove ${label} connection ${index + 1}`}
														isDisabled={busy || selected.length === 1}
														onClick={() => void patch({ [key]: selected.filter((entry) => entry !== id) })}
													>
														Remove
													</Button>
												</Flex>
											);
										})}
										<Select
											mt={2}
											aria-label={`Add ${label} connection`}
											value=""
											isDisabled={busy || !current || selected.length >= 4 || !available.length}
											onChange={(event) => {
												if (event.target.value)
													void patch({
														[key]: [...selected.filter((id) => choices.some((choice) => choice.id === id && choice[stage])), event.target.value]
													});
											}}
										>
											<option value="">Add a fallback connection…</option>
											{available.map((choice) => (
												<option key={choice.id} value={choice.id}>
													{choice.name}
												</option>
											))}
										</Select>
										<Text fontSize="xs" mt={1} color="var(--tt-muted)">
											{current?.provider[stage]
												? 'Connection configured; availability is checked when processing.'
												: 'No compatible connection configured for this stage.'}
										</Text>
									</Box>
								);
							})}
						</Box> : null}
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
											<Badge>{job.runtimeDeviceId ? 'Personal device' : 'AI providers'}</Badge>
											<Menu>
												<MenuButton as={Button} size="xs" variant="outline" aria-label={`Actions for ${job.filename}`}>•••</MenuButton>
												<MenuList>
													<MenuItem isDisabled={busy || !settings.enabled || !!job.handoffStatus} onClick={() => {
														if (window.confirm('Send this transcript to Lopu to act on its instructions? Lopu may create Things and reminders. Other sensitive actions still require confirmation in the conversation.')) void change({ op: 'send-to-lopu', postId: job.postId });
													}}>🦄 Send to Lopu</MenuItem>
												</MenuList>
											</Menu>
										</Flex>
										{job.handoffStatus && <Text fontSize="sm" mt={2}>Lopu: {job.handoffStatus}. {job.handoffChatId && <Link to={`/lopu/${encodeURIComponent(job.handoffChatId)}`}>Open conversation →</Link>}</Text>}
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
												Retry with selected processor
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
