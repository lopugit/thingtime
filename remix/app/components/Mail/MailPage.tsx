import React from 'react';
import { GmailWorkspace, GmailMessageActions } from './GmailActions';
import { Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useMailWorkspace } from '~/mail/useMailWorkspace';
import type { MailWorkspace } from '~/mail/workspace.client';
import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { RainbowButton, SettingsSection } from '~/components/Settings/SettingsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { useMail } from '~/mail/useMail';
import { selectMailMessages, type MailInbox } from '~/mail/model';
export function MailPage() {
	const { identity, workspace } = useMailWorkspace();
	return (
		<PageShell width={1280}>
			{workspace ? (
				<MailScope key={identity} workspace={workspace} />
			) : (
				<>
					<PageHeader eyebrow="Your things, connected" title="Mail" subtitle="All your inboxes, together." />
					<Text>Mail is unavailable while the workspace is changing. Reopen it once your workspace is ready.</Text>
					<Button as={Link} to="/login" alignSelf="start">
						Sign in
					</Button>
				</>
			)}
		</PageShell>
	);
}
function MailScope({ workspace }: { workspace: MailWorkspace }) {
	const ownerId = workspace.scope.kind === 'account' ? workspace.scope.ownerId : '';
	const mail = useMail(workspace),
		lopu = useLopu();
	const [selection, setSelection] = React.useState('all'),
		[search, setSearch] = React.useState(''),
		[messageId, setMessageId] = React.useState<string | null>(null);
	const [draft, setDraft] = React.useState<MailInbox | null>(null),
		[limit, setLimit] = React.useState(50),
		[remove, setRemove] = React.useState(false);
	const state = mail.data.state;
	const proxy = state.inboxes.find((inbox) => inbox.id === selection);
	const title =
		selection === 'all'
			? 'All inboxes'
			: proxy?.name ||
			  state.accounts.find((account) => account.id === selection)?.name ||
			  state.folders.find((folder) => folder.id === selection)?.name ||
			  'Inbox';
	const messages = selectMailMessages(state, selection).filter((message) =>
		`${message.subject} ${message.from} ${message.text}`.toLowerCase().includes(search.toLowerCase())
	);
	const message = messages.find((item) => item.id === messageId);
	React.useEffect(() => {
		if (mail.error) lopu({ title: 'Mail sync', description: mail.error, status: 'error' });
	}, [mail.error, lopu]);
	const select = (id: string) => {
		setSelection(id);
		setMessageId(null);
		setLimit(50);
		setRemove(false);
	};
	return (
		<>
			<PageHeader
				eyebrow="Your things, connected"
				title="Mail"
				subtitle="A little more together. Every account, every inbox."
				after={
					<Button as={Link} to="/settings/email" size="sm">
						Email settings
					</Button>
				}
			/>
			{mail.anonymous && (
				<Text fontSize="sm">
					Mail stays in this browser’s anonymous workspace. Connect directly from the app or pair a local connector in Email settings.
				</Text>
			)}
			<GmailWorkspace ownerId={ownerId} mail={mail} />
			<Flex gap={4} direction={{ base: 'column', md: 'row' }} align="start" minW={0}>
				<Flex as="nav" aria-label="Mail inboxes" direction="column" gap={2} width={{ base: '100%', md: '240px' }} flexShrink={0} minW={0}>
					<Button onClick={() => select('all')} variant={selection === 'all' ? 'solid' : 'ghost'} justifyContent="start">
						All inboxes
					</Button>
					<Text fontSize="xs" color="var(--tt-muted)" mt={3}>
						PROXY INBOXES
					</Text>
					{state.inboxes.map((inbox) => (
						<Button
							key={inbox.id}
							onClick={() => select(inbox.id)}
							variant={selection === inbox.id ? 'solid' : 'ghost'}
							justifyContent="start"
							whiteSpace="normal"
							height="auto"
							minH={10}
							py={2}
							overflowWrap="anywhere"
						>
							{inbox.name}
						</Button>
					))}
					<Button
						onClick={() => setDraft({ id: crypto.randomUUID(), name: '', revision: 0, folderIds: [] })}
						size="sm"
						isDisabled={!mail.ready || mail.busy}
					>
						Create proxy inbox
					</Button>
					<Text fontSize="xs" color="var(--tt-muted)" mt={3}>
						ACCOUNTS
					</Text>
					{state.accounts.map((account) => (
						<Box key={account.id} minW={0}>
							<Button
								width="100%"
								onClick={() => select(account.id)}
								justifyContent="start"
								variant={selection === account.id ? 'solid' : 'ghost'}
								height="auto"
								minH={10}
								py={2}
								whiteSpace="normal"
								overflowWrap="anywhere"
							>
								{account.name}
							</Button>
							{state.folders
								.filter((folder) => folder.accountId === account.id)
								.map((folder) => (
									<Button
										key={folder.id}
										onClick={() => select(folder.id)}
										width="100%"
										size="sm"
										variant={selection === folder.id ? 'solid' : 'ghost'}
										justifyContent="start"
										pl={5}
										height="auto"
										minH={9}
										py={2}
										whiteSpace="normal"
										overflowWrap="anywhere"
									>
										{folder.name}
										{Object.keys(account.servers).length > 1 ? ` (${folder.protocol.toUpperCase()})` : ''}
									</Button>
								))}
						</Box>
					))}
					{!state.accounts.length && (
						<Button as={Link} to="/settings/email">
							Connect an account
						</Button>
					)}
				</Flex>
				<Flex direction="column" gap={4} flex={1} minW={0} width="100%">
					{draft && (
						<SettingsSection
							eyebrow="Create a proxy inbox"
							description="Choose folders from any connected accounts. This view combines their messages without moving or copying mail on your servers."
						>
							<FormControl>
								<FormLabel>Inbox name</FormLabel>
								<Input
									autoFocus
									value={draft.name}
									maxLength={160}
									placeholder="Work, friends, everything lovely…"
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
								/>
							</FormControl>
							<Flex direction="column" gap={3} maxH="320px" overflowY="auto" p={1}>
								{state.accounts.map((account) => (
									<Box key={account.id}>
										<Text fontWeight="600" mb={2}>
											{account.name}
										</Text>
										<Flex direction="column" gap={2}>
											{state.folders
												.filter((folder) => folder.accountId === account.id)
												.map((folder) => (
													<Checkbox
														key={folder.id}
														isChecked={draft.folderIds.includes(folder.id)}
														onChange={(event) =>
															setDraft({
																...draft,
																folderIds: event.target.checked ? [...draft.folderIds, folder.id] : draft.folderIds.filter((id) => id !== folder.id)
															})
														}
													>
														{folder.name} · {folder.protocol.toUpperCase()}
													</Checkbox>
												))}
										</Flex>
									</Box>
								))}
							</Flex>
							{!state.folders.length && <Text>Connect an account in Email settings, then sync to discover its folders.</Text>}
							<Flex gap={2} wrap="wrap">
								<RainbowButton
									isDisabled={!draft.name.trim() || !draft.folderIds.length || mail.busy}
									onClick={async () => {
										if (await mail.saveInbox(draft)) {
											select(draft.id);
											setDraft(null);
										}
									}}
								>
									Save inbox
								</RainbowButton>
								<Button onClick={() => setDraft(null)} isDisabled={mail.busy}>
									Cancel
								</Button>
							</Flex>
						</SettingsSection>
					)}
					<SettingsSection eyebrow={title}>
						<Flex gap={2} wrap="wrap">
							<Button onClick={() => mail.sync(selection)} isDisabled={!mail.ready || mail.busy || !state.accounts.length}>
								Sync inbox
							</Button>
							<Button onClick={() => mail.sync(selection, true)} isDisabled={!mail.ready || mail.busy || !state.accounts.length}>
								Load older mail
							</Button>
							{proxy && (
								<>
									<Button onClick={() => setDraft(proxy)} isDisabled={mail.busy}>
										Edit proxy inbox
									</Button>
									<Button onClick={() => setRemove(true)} isDisabled={mail.busy}>
										Remove view
									</Button>
								</>
							)}
						</Flex>
						{remove && proxy && (
							<Flex gap={2} align="center" wrap="wrap">
								<Text fontSize="sm">Remove this view? Source messages stay where they are.</Text>
								<Button
									size="sm"
									onClick={async () => {
										if (await mail.remove('mail-inbox', proxy.id)) select('all');
									}}
									isDisabled={mail.busy}
								>
									Remove proxy inbox
								</Button>
								<Button size="sm" onClick={() => setRemove(false)}>
									Cancel
								</Button>
							</Flex>
						)}
						<Input
							aria-label="Search saved mail"
							placeholder="Search saved mail…"
							value={search}
							onChange={(event) => {
								setSearch(event.target.value);
								setLimit(50);
							}}
						/>
						<Text fontSize="xs" color="var(--tt-muted)" role="status">
							{mail.busy ? 'Syncing… Saved messages remain available.' : `${messages.length} saved messages · available offline on this browser`}
						</Text>
						{mail.error && (
							<Text fontSize="sm" color="var(--tt-muted)" whiteSpace="pre-wrap">
								{mail.error}
							</Text>
						)}
						{message ? (
							<Box overflowWrap="anywhere">
								<Button size="sm" mb={4} onClick={() => setMessageId(null)}>
									Back to inbox
								</Button>
								<Text as="h2" fontSize="xl" fontWeight="600">
									{message.subject}
								</Text>
								<Text mt={2} fontSize="sm">
									From: {message.from || 'Not available'}
								</Text>
								<Text fontSize="sm">To: {message.to || 'Not available'}</Text>
								<Text fontSize="xs" color="var(--tt-muted)">
									{message.date ? new Date(message.date).toLocaleString() : 'Date not available'}
								</Text>
								<Text fontSize="xs" mt={2}>
									{state.accounts.find((account) => account.id === message.accountId)?.name} ·{' '}
									{state.folders.find((folder) => folder.id === message.folderId)?.name}
								</Text>
								{state.accounts.find((account) => account.id === message.accountId)?.provider === 'gmail' && (
									<GmailMessageActions
										key={message.id}
										mail={mail}
										message={message}
										account={state.accounts.find((account) => account.id === message.accountId)!}
									/>
								)}
								{message.truncated && (
									<Text fontSize="sm" mt={3}>
										This is a partial message. Open the original with your email provider to read everything.
									</Text>
								)}
								{!!message.attachmentCount && (
									<Text fontSize="sm" mt={2}>
										{message.attachmentCount} attachment(s) · open with your provider to download
									</Text>
								)}
								<Text whiteSpace="pre-wrap" mt={5} fontSize="sm" lineHeight="1.8">
									{message.text || 'This message has no text content.'}
								</Text>
							</Box>
						) : (
							<>
								{!messages.length && (
									<Box py={8}>
										<Text fontSize="lg">A little room for your mail.</Text>
										<Text mt={2} fontSize="sm" color="var(--tt-muted)">
											{state.accounts.length
												? 'Sync this inbox to bring in messages, or choose another folder.'
												: 'Connect your first email account in Settings to get started.'}
										</Text>
									</Box>
								)}
								{messages.slice(0, limit).map((item) => (
									<Button
										key={item.id}
										variant="ghost"
										height="auto"
										width="100%"
										p={3}
										display="block"
										textAlign="left"
										whiteSpace="normal"
										borderBottom="1px solid var(--tt-border, #ececef)"
										onClick={() => setMessageId(item.id)}
									>
										<Flex gap={3} justify="space-between" wrap="wrap">
											<Text fontWeight={item.unread ? '700' : '400'} overflowWrap="anywhere">
												{item.from || 'Unknown sender'}
											</Text>
											<Text fontSize="xs" color="var(--tt-muted)">
												{item.date ? new Date(item.date).toLocaleDateString() : ''}
											</Text>
										</Flex>
										<Text mt={1} fontWeight="600" overflowWrap="anywhere">
											{item.subject}
										</Text>
										<Text mt={1} fontSize="xs" noOfLines={2} color="var(--tt-muted)">
											{item.text}
										</Text>
										<Text mt={2} fontSize="xs" color="var(--tt-muted)">
											{state.accounts.find((account) => account.id === item.accountId)?.name} ·{' '}
											{state.folders.find((folder) => folder.id === item.folderId)?.name}
										</Text>
									</Button>
								))}
								{messages.length > limit && <Button onClick={() => setLimit(limit + 50)}>Show more saved mail</Button>}
							</>
						)}
					</SettingsSection>
				</Flex>
			</Flex>
		</>
	);
}
