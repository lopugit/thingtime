import React from 'react';
import { Box, Button, Flex, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { apiErrorMessage } from '../../hooks/apiFailure';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';
import type { HistoryCard } from '../../timeline/browserModel';
import { TIMELINE_NOTE_MAX_CHARS, isTimelineNoteText, normalizeTimelineNoteText, parseTimelineNoteResult, type HistoryNoteView, type TimelineNoteCommand } from '../../timeline/notes';

const WHO = { owner: 'You said', lopu: 'Lopu said', system: 'Thingtime' } as const;
const attention = (failure: HistoryNoteView['failure']) => (failure ? `Needs attention · ${failure.message}` : '');

/** One contextual message. Owner notes are plain surface bubbles, Lopu's carry
 * the gradient border, system lines are dashed and muted. Line breaks are kept. */
export function HistoryMessageBubble({ who, text, status = 'accepted', failure = null, children }: {
	who: 'owner' | 'lopu' | 'system'; text: string; status?: HistoryNoteView['status']; failure?: HistoryNoteView['failure']; children?: React.ReactNode;
}) {
	const state = status === 'pending' ? attention(failure) || 'Saved on this device' : status === 'removing' ? attention(failure) || 'Removing…' : '';
	return <div className={`history-message ${who} ${status}`}>
		<span className="history-message-who">{WHO[who]}</span>
		<div className="history-message-text">{who === 'lopu' ? <div>{text}</div> : text}</div>
		{state ? <span className="history-message-state">{state}</span> : null}
		{children}
	</div>;
}

/** The derived system line first, then the notes in the order given. Rows and
 * stops render this inside a button, so `actions` stays undefined there. */
export function HistoryMessages({ card, compact = false, actions }: { card: HistoryCard; compact?: boolean; actions?: (view: HistoryNoteView) => React.ReactNode }) {
	if (!card.system && !card.notes.length) return null;
	return <div className={`history-messages${compact ? ' compact' : ''}`}>
		{card.system ? <HistoryMessageBubble who="system" text={card.system} /> : null}
		{card.notes.map(view => <HistoryMessageBubble key={view.note.id} who={view.note.author} text={view.note.text} status={view.status} failure={view.failure}>{actions?.(view)}</HistoryMessageBubble>)}
	</div>;
}

/** Mounted by scope/event identity. Notes queue locally first and sync with
 * the event; Lopu's explanation is requested directly and stored on success. */
export function HistoryMessageComposer({ card }: { card: HistoryCard }) {
	const { connection } = useTimelineSession(); const api = useApi();
	const { event } = card.row;
	const [value, setValue] = React.useState('');
	const [busy, setBusy] = React.useState(false); const [thinking, setThinking] = React.useState(false);
	const [notice, setNotice] = React.useState(''); const [error, setError] = React.useState('');
	const [online, setOnline] = React.useState(() => typeof navigator === 'undefined' || navigator.onLine);
	const alive = React.useRef(true); const working = React.useRef(false); const explaining = React.useRef<AbortController | null>(null);
	React.useEffect(() => {
		alive.current = true;
		const changed = () => setOnline(navigator.onLine);
		window.addEventListener('online', changed); window.addEventListener('offline', changed);
		return () => { alive.current = false; explaining.current?.abort(); window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
	}, []);
	const queue = async (command: TimelineNoteCommand) => {
		if (!connection || working.current) return;
		const noun = command.command === 'remove-note' ? 'removal' : 'note';
		working.current = true; setBusy(true); setError(''); setNotice('');
		try {
			await connection.notes.enqueue(command);
			if (!alive.current) return;
			if (command.command === 'add-note') setValue('');
			window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			if (!connection.verified) { setNotice(`Saved on this device. This ${noun} will sync when you reconnect.`); return; }
			await connection.sync.pushPending();
			const remaining = (await connection.notes.queued()).find(row => row.command.operationId === command.operationId);
			if (alive.current) {
				setNotice(remaining ? `Saved on this device. This ${noun} is waiting for the next sync.` : command.command === 'remove-note' ? 'Note removed from your account.' : 'Note saved to your account.');
				window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			}
		} catch (failure: any) { if (alive.current) { setError(failure?.error || failure?.message || `The ${noun} is still on this device. Retry syncing to check its result.`); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); } }
		finally { working.current = false; if (alive.current) setBusy(false); }
	};
	const explain = async () => {
		if (!connection?.verified || working.current) return;
		const command = { command: 'explain-change', operationId: crypto.randomUUID(), eventId: event.id, thingId: event.thingId } as const;
		const controller = new AbortController(); explaining.current = controller;
		working.current = true; setThinking(true); setError(''); setNotice('');
		try {
			const result = parseTimelineNoteResult(await api.v1.timeline.note(connection.scope, command, { signal: controller.signal }), connection.scope.ownerId, command);
			if (!('note' in result)) throw new Error('Lopu did not return an explanation.');
			await connection.notes.accept([result.note]);
			if (alive.current) { setNotice('Lopu explained this change.'); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
		} catch (failure) { if (alive.current && !controller.signal.aborted) setError(apiErrorMessage(failure, 'Lopu could not explain this change right now. Try again in a moment.')); }
		finally { working.current = false; if (explaining.current === controller) explaining.current = null; if (alive.current) setThinking(false); }
	};
	const operationFor = async (view: HistoryNoteView) => view.status === 'removing'
		? (await connection!.notes.queued()).find(row => row.command.command === 'remove-note' && row.command.noteId === view.note.id)?.command.operationId ?? null
		: view.note.id.slice('note-'.length);
	const settle = async (view: HistoryNoteView, mode: 'retry' | 'dismiss') => {
		if (!connection || working.current) return;
		working.current = true; setBusy(true); setError(''); setNotice('');
		try {
			const operationId = await operationFor(view);
			if (!operationId) throw new Error('This note command is no longer queued.');
			if (mode === 'retry') await connection.notes.retryRejected(operationId); else await connection.notes.dismissRejected(operationId);
			window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			if (mode === 'retry' && connection.verified) {
				await connection.sync.pushPending();
				const remaining = (await connection.notes.queued()).find(row => row.command.operationId === operationId);
				if (alive.current) { setNotice(remaining ? 'Saved on this device. This note is waiting for the next sync.' : 'Note synced to your account.'); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
			} else if (alive.current) setNotice(mode === 'retry' ? 'Saved on this device. This note will sync when you reconnect.' : 'Note command cancelled. Your change remains in History.');
		} catch (failure: any) { if (alive.current) { setError(failure?.error || failure?.message || 'Could not update this note.'); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); } }
		finally { working.current = false; if (alive.current) setBusy(false); }
	};
	const text = normalizeTimelineNoteText(value);
	const pendingEvent = card.row.status === 'pending';
	const explainCaption = !connection?.verified || !online ? 'Reconnect to ask Lopu' : pendingEvent ? 'Sync this change first' : '';
	const actions = (view: HistoryNoteView) => view.failure
		? <Flex className="history-message-actions"><Button size="xs" variant="outline" isDisabled={busy || thinking} onClick={() => void settle(view, 'retry')}>Retry</Button><Button size="xs" variant="ghost" isDisabled={busy || thinking} onClick={() => void settle(view, 'dismiss')}>Dismiss</Button></Flex>
		: view.status === 'accepted'
		? <Flex className="history-message-actions"><Button size="xs" variant="ghost" isDisabled={!connection || busy || thinking} onClick={() => void queue({ command: 'remove-note', operationId: crypto.randomUUID(), noteId: view.note.id })}>Remove</Button></Flex>
		: null;
	return <Box minW={0}>
		<HistoryMessages card={card} actions={actions} />
		{!card.system && !card.notes.length ? <Text fontSize="sm" color="var(--tt-muted)">No messages yet. Add a note or ask Lopu.</Text> : null}
		<Box mt={3}>
			<label htmlFor={`history-note-${event.id}`} className="history-message-who" style={{ display: 'block', marginBottom: 4 }}>Add a note to this change</label>
			<Textarea id={`history-note-${event.id}`} aria-label="Add a note to this change" placeholder="Why did this change? Future you will thank you…" size="sm" rows={3} maxLength={TIMELINE_NOTE_MAX_CHARS} value={value} isDisabled={!connection || busy} onChange={change => setValue(change.target.value)} />
			<Flex justify="space-between" align="center" gap={2} mt={1} wrap="wrap">
				<Text fontSize="xs" color="var(--tt-muted)">{text.length} / {TIMELINE_NOTE_MAX_CHARS}</Text>
				<Flex gap={2} wrap="wrap">
					<Button size="sm" isLoading={busy} isDisabled={!connection || !isTimelineNoteText(text) || thinking} onClick={() => void queue({ command: 'add-note', operationId: crypto.randomUUID(), eventId: event.id, thingId: event.thingId, text })}>Save note</Button>
					<Button size="sm" variant="outline" isLoading={thinking} loadingText="Lopu is thinking…" isDisabled={!!explainCaption || busy} onClick={() => void explain()}>Ask Lopu to explain</Button>
				</Flex>
			</Flex>
			{explainCaption ? <Text fontSize="xs" color="var(--tt-muted)" mt={1}>{explainCaption}</Text> : null}
			{notice ? <Text role="status" fontSize="sm" mt={2}>{notice}</Text> : null}
			{error ? <Text role="alert" fontSize="sm" mt={2} overflowWrap="anywhere">{error}</Text> : null}
		</Box>
	</Box>;
}
