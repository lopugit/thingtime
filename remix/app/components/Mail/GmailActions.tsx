import React from 'react';
import { Button, Flex, FormControl, FormLabel, Input, Select, Text } from '@chakra-ui/react';
import { mailRequest } from '~/mail/client';
import type { LocalGmailDraft } from '~/mail/googleModel';
import type { MailAccount, MailFolder, MailMessage } from '~/mail/model';
import type { useMail } from '~/mail/useMail';
import { GmailComposer, newGmailDraft } from './GmailComposer';
type Mail = ReturnType<typeof useMail>;
export function GmailWorkspace({ ownerId, mail }: { ownerId: string; mail: Mail }) {
	const accounts = mail.data.state.accounts.filter((account) => account.provider === 'gmail');
	const [accountId, setAccountId] = React.useState(''),
		[draft, setDraft] = React.useState<LocalGmailDraft | null>(null);
	const [drafts, setDrafts] = React.useState<{ id: string; subject: string }[]>([]),
		[cursor, setCursor] = React.useState<string | null>(null);
	const [error, setError] = React.useState(''),
		[notice, setNotice] = React.useState(''),
		[busy, setBusy] = React.useState(false),
		[label, setLabel] = React.useState(''),
		[labelId, setLabelId] = React.useState('');
	const epoch = React.useRef(0),
		controller = React.useRef(new AbortController());
	React.useEffect(() => {
		const generation = epoch;
		controller.current = new AbortController();
		return () => {
			generation.current++;
			controller.current.abort();
		};
	}, []);
	const account = draft
		? accounts.find((account) => account.id === draft.accountId)
		: accounts.find((account) => account.id === accountId) || accounts[0];
	if (!account)
		return draft ? (
			<Flex>
				<Text>This draft’s Gmail account is no longer connected.</Text>
				<Button onClick={() => setDraft(null)}>Close draft</Button>
			</Flex>
		) : null;
	async function load(id?: string, older = false) {
		if (busy || !account) return;
		const version = epoch.current;
		setBusy(true);
		setError('');
		try {
			const result = await mailRequest(
				ownerId,
				{ operation: 'google-drafts', id: account.id, ...(id ? { draftId: id } : {}), ...(older && cursor ? { cursor } : {}) },
				{},
				controller.current.signal
			);
			if (version !== epoch.current) return;
			if (result.draft) {
				if (!result.draft.editable)
					throw new Error('This draft contains rich formatting, attachments or more text than this editor supports. Open Gmail to preserve it.');
				const local = mail.data.composeDrafts.find((draft) => draft.accountId === account.id && draft.googleId === result.draft.id);
				setDraft(local || { ...newGmailDraft(account.id), ...result.draft, id: crypto.randomUUID(), googleId: result.draft.id });
			} else {
				setDrafts(older ? [...drafts, ...result.drafts] : result.drafts);
				setCursor(result.nextCursor);
			}
		} catch (cause) {
			if (version === epoch.current) setError(cause instanceof Error ? cause.message : 'Gmail drafts could not be opened.');
		} finally {
			if (version === epoch.current) setBusy(false);
		}
	}
	return (
		<Flex direction="column" gap={3} minW={0}>
			{draft ? (
				<GmailComposer
					key={draft.id}
					ownerId={ownerId}
					account={account}
					initial={draft}
					saveLocal={mail.saveCompose}
					onClose={(sent) => {
						setDraft(null);
						if (sent) setNotice('Email sent through Gmail.');
					}}
				/>
			) : (
				<>
					<FormControl>
						<FormLabel>Gmail account</FormLabel>
						<Select
							value={account.id}
							onChange={(event) => {
								epoch.current++;
								setBusy(false);
								setAccountId(event.target.value);
								setDrafts([]);
								setCursor(null);
								setError('');
								setLabelId('');
							}}
						>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.address}
								</option>
							))}
						</Select>
					</FormControl>
					<Flex gap={2} wrap="wrap">
						<Button onClick={() => setDraft(newGmailDraft(account.id))}>Compose email</Button>
						<Button isDisabled={busy} onClick={() => load()}>
							Gmail drafts
						</Button>
						<Button
							as="a"
							href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(account.address)}#drafts`}
							target="_blank"
							rel="noopener noreferrer"
						>
							Open Gmail
						</Button>
					</Flex>
					{mail.data.composeDrafts
						.filter((draft) => draft.accountId === account.id)
						.map((draft) => (
							<Button
								key={draft.id}
								justifyContent="start"
								whiteSpace="normal"
								overflowWrap="anywhere"
								height="auto"
								minH={10}
								onClick={() => setDraft(draft)}
							>
								Device draft: {draft.subject || '(No subject)'}
							</Button>
						))}
					{drafts.map((draft) => (
						<Button
							key={draft.id}
							justifyContent="start"
							whiteSpace="normal"
							overflowWrap="anywhere"
							height="auto"
							minH={10}
							isDisabled={busy}
							onClick={() => load(draft.id)}
						>
							Gmail draft: {draft.subject}
						</Button>
					))}
					{cursor && (
						<Button isDisabled={busy} onClick={() => load(undefined, true)}>
							More Gmail drafts
						</Button>
					)}
					<Flex gap={2} wrap="wrap">
						<Select aria-label="Gmail label to rename" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
							<option value="">Create a label</option>
							{mail.data.state.folders
								.filter((folder) => folder.accountId === account.id && folder.path.startsWith('Label_'))
								.map((folder) => (
									<option key={folder.id} value={folder.path}>
										{folder.name}
									</option>
								))}
						</Select>
						<Input
							aria-label="Gmail label name"
							value={label}
							maxLength={225}
							placeholder="Label name"
							onChange={(event) => setLabel(event.target.value)}
						/>
						<Button
							isDisabled={mail.busy || !label.trim()}
							onClick={async () => {
								if (
									await mail.googleAction(account.id, {
										action: labelId ? 'label-rename' : 'label-create',
										name: label,
										...(labelId ? { labelId } : {})
									})
								) {
									setLabel('');
									await mail.discover(account.id);
								}
							}}
						>
							{labelId ? 'Rename label' : 'Create label'}
						</Button>
					</Flex>
				</>
			)}
			{notice && <Text role="status">{notice}</Text>}
			{error && <Text role="alert">{error}</Text>}
		</Flex>
	);
}
export function GmailMessageActions({ mail, message, account }: { mail: Mail; message: MailMessage; account: MailAccount }) {
	const [labelId, setLabelId] = React.useState(''),
		[confirmTrash, setConfirmTrash] = React.useState(false);
	const folder = mail.data.state.folders.find((folder) => folder.id === message.folderId);
	const labels = mail.data.state.folders.filter((folder) => folder.accountId === account.id && folder.path.startsWith('Label_'));
	const act = (action: string) =>
		mail.googleAction(account.id, { action, remoteId: message.remoteId, ...(action.startsWith('label-') ? { labelId } : {}) });
	return (
		<Flex direction="column" gap={2} my={3}>
			<Flex gap={2} wrap="wrap">
				<Button size="sm" isDisabled={mail.busy} onClick={() => act(message.unread ? 'read' : 'unread')}>
					Mark {message.unread ? 'read' : 'unread'}
				</Button>
				<Button size="sm" isDisabled={mail.busy} onClick={() => act('archive')}>
					Archive
				</Button>
				{folder?.path === 'TRASH' ? (
					<Button size="sm" isDisabled={mail.busy} onClick={() => act('untrash')}>
						Restore from Trash
					</Button>
				) : (
					<Button size="sm" isDisabled={mail.busy} onClick={() => setConfirmTrash(true)}>
						Move to Trash
					</Button>
				)}
			</Flex>
			{confirmTrash && (
				<Flex gap={2} wrap="wrap" align="center">
					<Text fontSize="sm">Move this message to Gmail Trash?</Text>
					<Button
						size="sm"
						isDisabled={mail.busy}
						onClick={async () => {
							if (await act('trash')) setConfirmTrash(false);
						}}
					>
						Confirm Trash
					</Button>
					<Button size="sm" onClick={() => setConfirmTrash(false)}>
						Keep message
					</Button>
				</Flex>
			)}
			{!!labels.length && (
				<Flex gap={2} wrap="wrap">
					<Select aria-label="Message label" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
						<option value="">Choose label</option>
						{labels.map((label) => (
							<option key={label.id} value={label.path}>
								{label.name}
							</option>
						))}
					</Select>
					<Button size="sm" isDisabled={!labelId || mail.busy} onClick={() => act('label-add')}>
						Add label
					</Button>
					<Button size="sm" isDisabled={!labelId || mail.busy} onClick={() => act('label-remove')}>
						Remove label
					</Button>
				</Flex>
			)}
		</Flex>
	);
}
