import { LopuTaskRing, useAiBackgroundTasks } from './LopuTaskRing';
import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { PageShell, PageHeader } from '~/components/Layout/PageShell';
import type { AiBackgroundTask } from '~/api/utils/lopu/backgroundTaskCore';
import { getAiTaskState, getServerAiTaskState, readAiTaskOutput, refreshAiTasks, stopAiTask, subscribeAiTasks } from './aiTasks.client';
import { useLopuChat } from './useLopuChat';
import { useLopu } from './useLopu';
import { LOPU_UI } from './lopuTheme';

const resultText = (output: string, contentType: string) => {
	if (!contentType.includes('ndjson')) {
		try {
			const result = JSON.parse(output);
			return String(result.text || result.error || 'Task completed.');
		} catch {
			return output;
		}
	}
	let text = '';
	for (const line of output.split('\n')) {
		try {
			const event = JSON.parse(line);
			if (event.type === 'delta' || event.type === 'quote') text += event.text || '';
		} catch {
			/* incomplete last frame */
		}
	}
	return text || 'No reply text has been saved yet.';
};
const TaskRow = ({ task, title }: { task: AiBackgroundTask; title?: string }) => {
	const lopu = useLopu();
	const [opened, setOpened] = React.useState(false),
		[result, setResult] = React.useState(''),
		[busy, setBusy] = React.useState(false);
	const inspect = async () => {
		setOpened(!opened);
		if (opened) return;
		try {
			const saved = await readAiTaskOutput(task);
			setResult(
				saved
					? resultText(saved.output, saved.task.contentType)
					: 'This saved result is unavailable or has expired. Chat replies remain in the conversation.'
			);
		} catch {
			lopu({ title: 'The saved result is temporarily unavailable. Try again.', status: 'error' });
		}
	};
	const stop = async () => {
		setBusy(true);
		try {
			await stopAiTask(task.id);
		} catch {
			lopu({ title: 'Could not stop this task. Try again.', status: 'error' });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Box border={LOPU_UI.border} borderRadius="16px" p={[4, 5]} bg={LOPU_UI.card} minW={0}>
			<Flex gap={3} align="center" minW={0}>
				<LopuTaskRing task={task} size={24} />
				<Box flex={1} minW={0}>
					<Text fontWeight={600} overflowWrap="anywhere">
						{title || task.label}
					</Text>
					<Text fontSize="sm" color={LOPU_UI.muted}>
						{task.stage} · {new Date(task.createdAt).toLocaleString()}
					</Text>
				</Box>
			</Flex>
			{task.error ? (
				<Text mt={3} fontSize="sm" color={LOPU_UI.muted}>
					{task.error}
				</Text>
			) : null}
			<Flex gap={2} mt={3} wrap="wrap">
				{task.chatId ? (
					<Button as={Link} to={`/lopu/${encodeURIComponent(task.chatId)}`} size="sm" variant="outline">
						{task.status === 'needs-attention' || task.status === 'stopped' ? 'Review and continue' : 'Open chat'}
					</Button>
				) : null}
				<Button size="sm" variant="ghost" onClick={() => void inspect()} aria-expanded={opened}>
					{opened ? 'Hide result' : 'View result'}
				</Button>
				{task.status === 'running' ? (
					<Button size="sm" variant="ghost" onClick={() => void stop()} isDisabled={busy}>
						{busy ? 'Stopping…' : 'Stop'}
					</Button>
				) : null}
			</Flex>
			{opened ? (
				<Box as="pre" mt={3} whiteSpace="pre-wrap" overflowWrap="anywhere" fontFamily="inherit" fontSize="sm" maxH="360px" overflowY="auto">
					{result || 'Reading saved result…'}
				</Box>
			) : null}
		</Box>
	);
};
export const LopuBackgroundTasks = () => {
	const chat = useLopuChat();
	const tasks = useAiBackgroundTasks();
	const taskState = React.useSyncExternalStore(subscribeAiTasks, getAiTaskState, getServerAiTaskState);
	const lopu = useLopu();
	const [filter, setFilter] = React.useState('running');
	const active = tasks.filter((task) => task.status === 'running');
	const visible =
		filter === 'all'
			? tasks
			: tasks.filter((task) => (filter === 'attention' ? task.status === 'needs-attention' || task.status === 'stopped' : task.status === 'running'));
	return (
		<PageShell width={860}>
			<PageHeader
				eyebrow="Lopu"
				title="Background tasks"
				subtitle="Lopu keeps working while you explore. Come back here to see progress or pick up an interrupted reply."
			/>
			<Box maxW="840px" mx="auto" width="100%" pb={8}>
				<Flex gap={2} mb={5} wrap="wrap" role="group" aria-label="Task filter">
					{(
						[
							['running', `Running (${active.length})`],
							['attention', 'Needs attention'],
							['all', 'Recent']
						] as const
					).map(([value, label]) => (
						<Button
							key={value}
							size="sm"
							variant={filter === value ? 'solid' : 'outline'}
							onClick={() => setFilter(value)}
							aria-pressed={filter === value}
						>
							{label}
						</Button>
					))}
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void refreshAiTasks().catch(() => lopu({ title: 'Task status is temporarily unavailable. Try again.', status: 'error' }))}
					>
						Refresh
					</Button>
				</Flex>
				{taskState === 'unavailable' ? (
					<Text mb={4} role="status">
						Task status is temporarily unavailable. Saved results stay visible; use Refresh to reconnect.
					</Text>
				) : null}
				{!chat.viewer.signedIn ? (
					<Text>Sign in to see your background tasks.</Text>
				) : visible.length ? (
					<Flex direction="column" gap={3}>
						{visible.map((task) => (
							<TaskRow key={task.id} task={task} title={chat.chats.find((item) => item.id === task.chatId)?.name} />
						))}
					</Flex>
				) : (
					<Box border={LOPU_UI.border} borderRadius="16px" p={6}>
						<Text fontWeight={600}>
							{filter === 'running' ? (taskState === 'ready' ? 'Nothing running right now' : 'Checking task status…') : 'No tasks here yet'}
						</Text>
						<Text mt={2} color={LOPU_UI.muted}>
							Start a chat, voice reply, musing or AI completion. You can leave its page while Lopu works.
						</Text>
						<Button as={Link} to="/lopu" mt={4} size="sm" variant="outline">
							Open Lopu
						</Button>
					</Box>
				)}
				<Text mt={5} fontSize="sm" color={LOPU_UI.muted}>
					The rings show the current stage. Long or interrupted replies keep their saved output so you can review and continue.
				</Text>
			</Box>
		</PageShell>
	);
};
