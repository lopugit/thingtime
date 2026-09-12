import React from 'react';
import { Badge, Box, Button, Checkbox, Collapse, Flex, Heading, Stack, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

type Message = { id: string; question: string; answer: string | null; status: string; createdAt: string; updatedAt: string };
type Conversation = { online: boolean; supported: boolean; active: boolean; lastSeenAt: string | null; messages: Message[] };
export function StackRunChat({ runId }: { runId: string }) {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const [open, setOpen] = React.useState(false);
	const [autoRefresh, setAutoRefresh] = React.useState(true);
	const [data, setData] = React.useState<Conversation | null>(null);
	const [error, setError] = React.useState('');
	const [question, setQuestion] = React.useState('');
	const [sending, setSending] = React.useState(false);
	const [retry, setRetry] = React.useState<{ requestId: string; question: string } | null>(null);
	const busy = React.useRef(false);
	const mounted = React.useRef(true);
	React.useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = React.useCallback(async () => {
		if (busy.current) return;
		busy.current = true;
		try {
			await requireThingtimeCapability('api.admin-ci-stack-chat', '1.0.0');
			const result = await apiRef.current.v1.admin.ciStackChat(runId);
			if (!result?.ok) throw new Error('Run chat could not be refreshed.');
			if (mounted.current) {
				setData((current) => {
					const messages = new Map<string, Message>(result.messages.map((row: Message) => [row.id, row]));
					// A GET started before Send may finish later. Preserve acknowledged writes
					// and newer reply states instead of flashing back to an older snapshot.
					for (const row of current?.messages ?? []) {
						const incoming = messages.get(row.id);
						if (!incoming || Date.parse(row.updatedAt) > Date.parse(incoming.updatedAt)) messages.set(row.id, row);
					}
					return { ...result, messages: [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50) };
				});
				setError('');
			}
		} catch {
			if (mounted.current) setError('Run chat is unavailable on this deployment, or its latest status could not be loaded.');
		} finally {
			busy.current = false;
		}
	}, [runId]);
	React.useEffect(() => {
		if (!open) return;
		void load();
		if (!autoRefresh) return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === 'visible') void load();
		}, 10_000);
		return () => window.clearInterval(timer);
	}, [open, autoRefresh, load]);
	const send = async () => {
		if (sending || (!question.trim() && !retry)) return;
		const payload = retry ?? { requestId: crypto.randomUUID(), question: question.trim() };
		setSending(true);
		setRetry(payload);
		try {
			await requireThingtimeCapability('api.admin-ci-stack-chat', '1.0.0');
			const result = await apiRef.current.v1.admin.sendCiStackQuestion({ runId, ...payload });
			if (!result?.ok) throw new Error(result?.error || 'Message could not be sent.');
			if (!mounted.current) return;
			setData((current) =>
				current ? { ...current, messages: [...current.messages.filter((row) => row.id !== result.message.id), result.message] } : current
			);
			setQuestion('');
			setRetry(null);
			void load();
		} catch {
			if (mounted.current)
				lopu({
					title: 'Message delivery is unconfirmed',
					description: 'Retry uses the same message ID so it cannot create a duplicate question.',
					status: 'error'
				});
		} finally {
			if (mounted.current) setSending(false);
		}
	};
	const status = error
		? 'Status unavailable'
		: !data
		? 'Not connected'
		: !data.supported
		? 'Responder not connected'
		: !data.active
		? 'Run ended'
		: data.online
		? 'Responder online'
		: 'Responder offline';
	return (
		<Box mt={4} p={4} border="1px solid var(--tt-border, #e7e7eb)" borderRadius="lg" bg="var(--tt-card, #fff)">
			<Button variant="ghost" size="sm" px={0} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={`stack-chat-${runId}`}>
				<Heading size="xs">Ask Lopu about this run {open ? '−' : '+'}</Heading>
			</Button>
			<Collapse in={open}>
				<Box id={`stack-chat-${runId}`} pt={3}>
					<Flex gap={2} wrap="wrap" align="center" justify="space-between">
						<Badge colorScheme={data?.online && !error ? 'green' : 'gray'}>{status}</Badge>
						<Checkbox size="sm" isChecked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}>
							Auto-refresh replies
						</Checkbox>
					</Flex>
					<Text fontSize="xs" opacity={0.7} mt={2}>
						Ask what is happening, what is blocking a target, or what comes next. Lopu answers alongside the merge workers using their reported state.
						Chat does not change or restart the merge plan. Questions and replies are visible to CI administrators and retained for 90 days.
					</Text>
					{error ? (
						<Text role="status" fontSize="sm" mt={3}>
							{error}
						</Text>
					) : null}
					{data && !data.supported ? (
						<Text fontSize="sm" mt={3}>
							This run has not connected a chat responder. It may use an older controller, or responder setup may have failed. Check the progress job;
							an older run needs a fresh start after the controller update.
						</Text>
					) : null}
					{data?.lastSeenAt ? (
						<Text fontSize="xs" opacity={0.65} mt={2}>
							Responder last seen {new Date(data.lastSeenAt).toLocaleString()}
						</Text>
					) : null}
					<Stack
						role="log"
						aria-label="Run conversation"
						aria-live="polite"
						spacing={4}
						my={4}
						maxH="360px"
						overflowY="auto"
						overscrollBehavior="contain"
						overflowWrap="anywhere"
					>
						{!data?.messages.length ? (
							<Text fontSize="sm" opacity={0.65}>
								No messages in this run yet.
							</Text>
						) : (
							data.messages.map((message) => (
								<Box key={message.id} borderBottom="1px solid var(--tt-border, #e7e7eb)" pb={3}>
									<Text fontSize="xs" fontWeight="bold">
										Admin · {new Date(message.createdAt).toLocaleTimeString()}
									</Text>
									<Text fontSize="sm" whiteSpace="pre-wrap" mt={1}>
										{message.question}
									</Text>
									<Text fontSize="xs" fontWeight="bold" mt={3}>
										Lopu ·{' '}
										{!data.active && ['queued', 'answering'].includes(message.status)
											? 'Run ended before delivery'
											: message.status === 'queued'
											? data.online
												? 'Waiting for responder'
												: 'Waiting · responder offline'
											: message.status === 'answering'
											? data.online
												? 'Answering'
												: 'Delivery interrupted · responder offline'
											: message.status === 'failed'
											? 'Could not answer'
											: 'Answered'}
									</Text>
									<Text fontSize="sm" whiteSpace="pre-wrap" mt={1}>
										{message.answer ??
											(!data.active
												? 'No reply was received before this run ended or was replaced.'
												: message.status === 'answering'
												? 'Reading the latest run snapshot…'
												: 'Your question is saved. The responder checks for messages about every 30 seconds.')}
									</Text>
								</Box>
							))
						)}
					</Stack>
					<Textarea
						aria-label="Question for Lopu about this run"
						placeholder="What are you waiting for?"
						maxLength={2000}
						value={question}
						onChange={(e) => setQuestion(e.target.value)}
						isDisabled={sending || Boolean(retry)}
						minH="88px"
					/>
					<Flex gap={2} mt={2} wrap="wrap" justify="space-between" align="center">
						<Text fontSize="xs" opacity={0.6}>
							{question.length}/2,000 · Replies may take a couple of minutes.
						</Text>
						<Flex gap={2}>
							<Button size="sm" variant="ghost" onClick={() => void load()}>
								Refresh
							</Button>
							<Button
								size="sm"
								onClick={() => void send()}
								isLoading={sending}
								isDisabled={!retry && (!data?.online || Boolean(error) || !question.trim())}
							>
								{retry ? 'Retry same message' : 'Send question'}
							</Button>
						</Flex>
					</Flex>
				</Box>
			</Collapse>
		</Box>
	);
}
