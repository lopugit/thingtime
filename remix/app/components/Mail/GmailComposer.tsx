import React from 'react';
import { Button, Flex, FormControl, FormLabel, Input, Text, Textarea } from '@chakra-ui/react';
import { MailRequestError, mailRequest } from '~/mail/client';
import { emptyGmailCompose, type LocalGmailDraft } from '~/mail/googleModel';
import type { MailAccount } from '~/mail/model';
export function GmailComposer({
	ownerId,
	account,
	initial,
	saveLocal,
	onClose
}: {
	ownerId: string;
	account: MailAccount;
	initial: LocalGmailDraft;
	saveLocal: (draft: LocalGmailDraft, remove?: boolean) => Promise<LocalGmailDraft>;
	onClose: (sent?: boolean) => void;
}) {
	const [draft, setDraft] = React.useState(initial),
		[error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false),
		[review, setReview] = React.useState(false),
		[discard, setDiscard] = React.useState(false);
	const current = React.useRef(initial),
		revision = React.useRef(initial.localRevision),
		queue = React.useRef(Promise.resolve()),
		failure = React.useRef<unknown>(null);
	const active = React.useRef(true),
		controller = React.useRef(new AbortController());
	React.useEffect(() => {
		active.current = true;
		controller.current = new AbortController();
		return () => {
			active.current = false;
			controller.current.abort();
		};
	}, []);
	function persist(next: LocalGmailDraft) {
		current.current = next;
		setDraft(next);
		queue.current = queue.current.then(async () => {
			if (failure.current) return;
			try {
				const saved = await saveLocal({ ...next, localRevision: revision.current });
				revision.current = saved.localRevision;
			} catch (cause) {
				failure.current = cause;
				if (active.current) setError(cause instanceof Error ? cause.message : 'Draft could not be saved on this device.');
			}
		});
		return queue.current;
	}
	const initialDraft = React.useRef(initial),
		persistRef = React.useRef(persist);
	persistRef.current = persist;
	React.useEffect(() => {
		void persistRef.current(initialDraft.current);
	}, []);
	async function perform(send: boolean) {
		if (busy || failure.current) return;
		setBusy(true);
		setError('');
		try {
			await queue.current;
			if (failure.current) throw failure.current;
			const value = current.current;
			const writeId = (send ? value.sendWriteId : value.saveWriteId) || crypto.randomUUID();
			const pending = { ...value, ...(send ? { sendWriteId: writeId } : { saveWriteId: writeId }) };
			await persist(pending);
			if (failure.current) throw failure.current;
			const result = await mailRequest(
				ownerId,
				{
					operation: 'google-action',
					id: account.id,
					revision: account.revision,
					writeId,
					mutation: {
						action: send ? 'send' : 'draft-save',
						compose: pending,
						...(pending.googleId ? { draftId: pending.googleId, messageId: pending.messageId } : {})
					}
				},
				{},
				controller.current.signal
			);
			if (!active.current) return;
			if (send) {
				await saveLocal({ ...pending, localRevision: revision.current }, true);
				onClose(true);
			} else {
				await persist({ ...pending, googleId: result.draftId, messageId: result.messageId, saveWriteId: undefined });
				setReview(false);
			}
		} catch (cause) {
			if (active.current) {
				if (
					cause instanceof MailRequestError &&
					(cause.actionOutcome === 'not-applied' || cause.status === 400 || cause.status === 413 || cause.status === 429)
				)
					await persist({ ...current.current, saveWriteId: undefined, sendWriteId: undefined });
				setError(cause instanceof Error ? cause.message : 'Gmail did not confirm this action. Check Gmail before trying a new action.');
			}
		} finally {
			if (active.current) setBusy(false);
		}
	}
	const locked = busy || !!draft.sendWriteId || !!draft.saveWriteId || !!failure.current;
	return (
		<Flex direction="column" gap={3} border="1px solid var(--tt-border)" borderRadius="12px" p={4} minW={0}>
			<Text fontWeight="600" overflowWrap="anywhere">
				Compose · {account.address}
			</Text>
			{(['to', 'cc', 'bcc', 'subject'] as const).map((field) => (
				<FormControl key={field}>
					<FormLabel>{field === 'subject' ? 'Subject' : field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc'}</FormLabel>
					<Input
						value={draft[field]}
						isDisabled={locked}
						maxLength={field === 'subject' ? 500 : 4000}
						onChange={(event) => {
							setReview(false);
							void persist({ ...current.current, [field]: event.target.value });
						}}
					/>
				</FormControl>
			))}
			<Text fontSize="xs">Separate email addresses with commas. Drafts here use plain text.</Text>
			<FormControl>
				<FormLabel>Message</FormLabel>
				<Textarea
					value={draft.text}
					isDisabled={locked}
					minH="220px"
					maxLength={30000}
					onChange={(event) => {
						setReview(false);
						void persist({ ...current.current, text: event.target.value });
					}}
				/>
			</FormControl>
			<Text fontSize="xs">Edits save encrypted on this device. Save to Gmail makes the draft available in Gmail and on your other devices.</Text>
			<Flex gap={2} wrap="wrap">
				<Button isDisabled={busy || !!draft.sendWriteId || !!failure.current} onClick={() => perform(false)}>
					{draft.saveWriteId ? 'Check previous save' : 'Save draft to Gmail'}
				</Button>
				<Button
					isDisabled={busy || !draft.googleId || !!draft.saveWriteId || !!failure.current}
					onClick={() => (draft.sendWriteId ? perform(true) : setReview(true))}
				>
					{draft.sendWriteId ? 'Check previous send' : 'Review and send'}
				</Button>
				<Button
					isDisabled={busy}
					onClick={async () => {
						await queue.current;
						if (!failure.current) onClose();
					}}
				>
					Close and keep draft
				</Button>
			</Flex>
			<Button alignSelf="start" variant="ghost" isDisabled={busy} onClick={() => setDiscard(true)}>
				Discard device draft
			</Button>
			{discard && (
				<Flex direction="column" gap={2}>
					<Text fontSize="sm">
						Remove this device copy? Any saved Gmail draft stays in Gmail. If a send was uncertain, check Gmail Sent before composing another copy.
					</Text>
					<Button
						alignSelf="start"
						onClick={async () => {
							try {
								await queue.current;
								if (failure.current) throw failure.current;
								await saveLocal({ ...current.current, localRevision: revision.current }, true);
								onClose();
							} catch (cause) {
								if (active.current) setError(cause instanceof Error ? cause.message : 'Draft could not be removed.');
							}
						}}
					>
						Discard device copy
					</Button>
					<Button alignSelf="start" onClick={() => setDiscard(false)}>
						Keep draft
					</Button>
				</Flex>
			)}
			{review && (
				<Flex direction="column" gap={2} p={3} border="1px solid var(--tt-border)">
					<Text overflowWrap="anywhere">
						Send “{draft.subject || '(No subject)'}” from {account.address} to {draft.to || '(no To recipients)'}
						{draft.cc ? `; Cc: ${draft.cc}` : ''}
						{draft.bcc ? `; Bcc: ${draft.bcc}` : ''}?
					</Text>
					<Button alignSelf="start" isDisabled={busy} onClick={() => perform(true)}>
						Send email
					</Button>
					<Button alignSelf="start" variant="ghost" onClick={() => setReview(false)}>
						Keep editing
					</Button>
				</Flex>
			)}
			{error && (
				<Text role="alert" fontSize="sm">
					{error}
				</Text>
			)}
			{(draft.sendWriteId || draft.saveWriteId) && !busy && (
				<Text fontSize="sm">
					This action has not been confirmed. The same request will be checked without automatically sending or creating another copy. Check Gmail
					before composing another message.
				</Text>
			)}
		</Flex>
	);
}
export const newGmailDraft = (accountId: string): LocalGmailDraft => ({
	...emptyGmailCompose(),
	id: crypto.randomUUID(),
	accountId,
	localRevision: 0
});
