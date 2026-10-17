import React from 'react';
import { hasNativeMailSync } from '~/mail/native';
import { Button, Checkbox, Flex, FormControl, FormLabel, Input, Select, Text } from '@chakra-ui/react';
import { RainbowButton, SettingsSection } from '~/components/Settings/SettingsSection';
import type { MailAccount, MailProtocol, MailServer } from '~/mail/model';
const defaultServer = (protocol: MailProtocol, address: string): MailServer => ({
	host: '',
	port: protocol === 'imap' ? 993 : 995,
	security: 'tls',
	username: address
});
export const newMailAccount = (): MailAccount => ({
	id: crypto.randomUUID(),
	name: '',
	address: '',
	revision: 0,
	servers: { imap: defaultServer('imap', '') },
	sync: { cloud: false, local: true, transport: hasNativeMailSync() ? 'native' : 'relay' }
});
export function MailAccountEditor({
	account,
	busy,
	onSave,
	onCancel
}: {
	account: MailAccount;
	busy: boolean;
	onSave: (account: MailAccount) => Promise<unknown>;
	onCancel: () => void;
}) {
	const [expanded, setExpanded] = React.useState(true);
	const [draft, setDraft] = React.useState<MailAccount>(() => structuredClone(account));
	const field = (protocol: MailProtocol, name: keyof MailServer, value: string | number) =>
		setDraft((current) => ({ ...current, servers: { ...current.servers, [protocol]: { ...current.servers[protocol], [name]: value } } }));
	return (
		<SettingsSection
			open={expanded}
			onToggle={setExpanded}
			eyebrow={account.revision ? 'Edit email account' : 'Connect an email account'}
			description="Use your provider’s mail server settings and app password. Mail sync never deletes or moves messages on your server."
		>
			<Flex
				as="form"
				direction="column"
				gap={4}
				onSubmit={async (event) => {
					event.preventDefault();
					if (await onSave(draft)) onCancel();
				}}
			>
				<FormControl isRequired>
					<FormLabel>Account name</FormLabel>
					<Input
						value={draft.name}
						maxLength={160}
						onChange={(event) => setDraft({ ...draft, name: event.target.value })}
						placeholder="Personal, work, a little side project…"
					/>
				</FormControl>
				<FormControl isRequired>
					<FormLabel>Email address</FormLabel>
					<Input
						type="email"
						autoComplete="email"
						value={draft.address}
						maxLength={320}
						onChange={(event) => setDraft({ ...draft, address: event.target.value })}
					/>
				</FormControl>
				{(['imap', 'pop3'] as const).map((protocol) => {
					const server = draft.servers[protocol];
					return (
						<Flex key={protocol} direction="column" gap={3} border="1px solid var(--tt-border, #ececef)" borderRadius="12px" p={4}>
							<Checkbox
								isChecked={!!server}
								onChange={(event) =>
									setDraft({
										...draft,
										servers: { ...draft.servers, [protocol]: event.target.checked ? defaultServer(protocol, draft.address) : undefined }
									})
								}
							>
								{protocol.toUpperCase()}
							</Checkbox>
							{server && (
								<>
									<Text fontSize="xs" color="var(--tt-muted)">
										{protocol === 'imap'
											? 'Read folders and inboxes from your account.'
											: 'Read the account’s single POP3 inbox. Messages stay on the server.'}
									</Text>
									<FormControl isRequired>
										<FormLabel>Server hostname</FormLabel>
										<Input
											value={server.host}
											autoCapitalize="none"
											placeholder={protocol === 'imap' ? 'imap.example.com' : 'pop.example.com'}
											onChange={(event) => field(protocol, 'host', event.target.value)}
										/>
									</FormControl>
									<Flex gap={3} wrap="wrap">
										<FormControl flex="1" minW="160px">
											<FormLabel>Connection security</FormLabel>
											<Select
												value={server.security}
												onChange={(event) => {
													const security = event.target.value as MailServer['security'];
													setDraft({
														...draft,
														servers: {
															...draft.servers,
															[protocol]: {
																...server,
																security,
																port: protocol === 'imap' ? (security === 'tls' ? 993 : 143) : security === 'tls' ? 995 : 110
															}
														}
													});
												}}
											>
												<option value="tls">TLS</option>
												<option value="starttls">STARTTLS (required)</option>
											</Select>
										</FormControl>
										<FormControl width="100px">
											<FormLabel>Port</FormLabel>
											<Input value={server.port} isReadOnly />
										</FormControl>
									</Flex>
									<FormControl isRequired>
										<FormLabel>Username</FormLabel>
										<Input
											value={server.username}
											autoComplete="off"
											autoCapitalize="none"
											onChange={(event) => field(protocol, 'username', event.target.value)}
										/>
									</FormControl>
									<FormControl>
										<FormLabel>App password</FormLabel>
										<Input
											type="password"
											autoComplete="new-password"
											value={server.password || ''}
											placeholder={account.revision ? 'Leave blank to keep saved password' : 'Your provider’s app password'}
											onChange={(event) => {
												const value = event.target.value;
												setDraft({ ...draft, servers: { ...draft.servers, [protocol]: { ...server, password: value || undefined } } });
											}}
										/>
									</FormControl>
								</>
							)}
						</Flex>
					);
				})}
				<Flex direction="column" gap={3}>
					<Text fontWeight="600">Where should this account sync?</Text>
					<Checkbox isChecked={draft.sync.cloud} onChange={(event) => setDraft({ ...draft, sync: { ...draft.sync, cloud: event.target.checked } })}>
						Through Thingtime’s cloud
					</Checkbox>
					<Text fontSize="xs" color="var(--tt-muted)">
						Your app password and synced mail are encrypted in your Thingtime account. Works in browsers and native apps without a local connector.
					</Text>
					<Checkbox isChecked={draft.sync.local} onChange={(event) => setDraft({ ...draft, sync: { ...draft.sync, local: event.target.checked } })}>
						Keep a copy on this device
					</Checkbox>
					<Text fontSize="xs" color="var(--tt-muted)">
						Your device keeps an encrypted offline copy. Choose how it connects below.
					</Text>
					{draft.sync.local && (
						<FormControl>
							<FormLabel>Device sync connection</FormLabel>
							<Select
								value={draft.sync.transport || 'connector'}
								onChange={(event) =>
									setDraft({ ...draft, sync: { ...draft.sync, transport: event.target.value as NonNullable<MailAccount['sync']['transport']> } })
								}
							>
								{(hasNativeMailSync() || draft.sync.transport === 'native') && (
									<option value="native">Directly from this app{hasNativeMailSync() ? '' : ' — unavailable in this app'}</option>
								)}
								<option value="relay">Thingtime API relay — no installation</option>
								<option value="connector">Paired local connector</option>
							</Select>
							<Text fontSize="xs" color="var(--tt-muted)" mt={2}>
								{draft.sync.transport === 'relay'
									? 'Your app password and mail pass through this Thingtime server for each sync. The relay does not save them; your encrypted copy stays on this device. Cloud sync, if also enabled, saves a separate encrypted cloud copy.'
									: draft.sync.transport === 'native'
									? 'The Thingtime app connects directly to your mail server. No pairing or separate tool is needed. Credentials and mail stay on this device unless you also enable cloud sync.'
									: 'Connect directly from your computer using a paired connector. Device sync does not send credentials or mail through Thingtime’s servers.'}
							</Text>
						</FormControl>
					)}
				</Flex>
				<Flex gap={2} wrap="wrap">
					<RainbowButton type="submit" isDisabled={busy}>
						Save account
					</RainbowButton>
					<Button onClick={onCancel} isDisabled={busy}>
						Cancel
					</Button>
				</Flex>
			</Flex>
		</SettingsSection>
	);
}
