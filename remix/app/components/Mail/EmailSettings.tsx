import React from 'react';
import { GoogleMailConnect } from './GoogleMailConnect';
import { hasNativeMailSync } from '~/mail/native';
import { Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useMailWorkspace } from '~/mail/useMailWorkspace';
import type { MailWorkspace } from '~/mail/workspace.client';
import { useLopu } from '~/components/Lopu/useLopu';
import { RainbowButton, SettingsSection } from '~/components/Settings/SettingsSection';
import { useMail } from '~/mail/useMail';
import type { MailAccount } from '~/mail/model';
import { MailAccountEditor, newMailAccount } from './MailAccountEditor';
export function EmailSettings() {
	const { identity, workspace } = useMailWorkspace();
	return workspace ? (
		<EmailSettingsScope key={identity} workspace={workspace} />
	) : (
		<Text>Email settings are unavailable while the workspace is changing. Reopen them once your workspace is ready.</Text>
	);
}
function EmailSettingsScope({ workspace }: { workspace: MailWorkspace }) {
	const ownerId = workspace.scope.kind === 'account' ? workspace.scope.ownerId : '';
	const mail = useMail(workspace),
		lopu = useLopu();
	const [draft, setDraft] = React.useState<MailAccount | null>(null),
		[token, setToken] = React.useState(''),
		[remove, setRemove] = React.useState<string | null>(null);
	React.useEffect(() => {
		if (mail.error) lopu({ title: 'Email', description: mail.error, status: 'error' });
	}, [mail.error, lopu]);
	return (
		<Flex direction="column" gap={4} minW={0}>
			<SettingsSection
				eyebrow="Email accounts"
				description={
					mail.anonymous
						? 'Save mail settings and read saved messages in this browser without a Thingtime account. Direct app sync or a paired local connector connects to your mail provider only when you choose Sync.'
						: 'Connect as many accounts as you need. Choose cloud storage, a device copy, both, or pause syncing while keeping your saved mail. API relay requires a connected Thingtime account.'
				}
			>
				<Flex gap={2} wrap="wrap">
					<RainbowButton onClick={() => setDraft(newMailAccount(!mail.anonymous))} isDisabled={!mail.ready || mail.busy}>
						Add email account
					</RainbowButton>
					<Button as={Link} to="/mail">
						Open Mail
					</Button>
					<Button onClick={mail.refresh} isDisabled={!mail.ready || mail.busy}>
						Refresh accounts
					</Button>
				</Flex>
				{mail.cloudAvailable ? (
					<GoogleMailConnect ownerId={ownerId} onConnected={mail.refresh} />
				) : (
					<Text fontSize="sm">
						Sign in and reconnect for Google authorization, cloud storage or Thingtime API relay. Device mail remains available separately.
					</Text>
				)}
				{!mail.data.state.accounts.length && <Text fontSize="sm">Your connected accounts will appear here.</Text>}
				{mail.data.state.accounts.map((account) => (
					<Flex key={account.id} direction="column" gap={2} py={3} borderBottom="1px solid var(--tt-border, #ececef)">
						<Text fontWeight="600" overflowWrap="anywhere">
							{account.name}
						</Text>
						<Text fontSize="sm" overflowWrap="anywhere">
							{account.address}
						</Text>
						<Text fontSize="xs" color="var(--tt-muted)">
							{account.provider === 'gmail' ? 'Gmail · Google authorization' : Object.keys(account.servers).join(' + ').toUpperCase()} ·{' '}
							{account.sync.cloud ? 'Cloud' : ''}
							{account.sync.cloud && account.sync.local ? ' + ' : ''}
							{account.sync.local
								? account.sync.transport === 'relay'
									? 'Device via API relay'
									: account.sync.transport === 'native'
									? 'Direct device sync'
									: 'Device via connector'
								: ''}
							{!account.sync.cloud && !account.sync.local ? 'Sync paused' : ''}
						</Text>
						<Flex gap={2} wrap="wrap">
							<Button size="sm" isDisabled={mail.busy} onClick={() => setDraft(account)}>
								Edit
							</Button>
							<Button
								size="sm"
								isDisabled={mail.busy}
								onClick={() => (account.provider === 'gmail' ? mail.discover(account.id) : mail.sync(account.id))}
							>
								Sync folders
							</Button>
							<Button size="sm" isDisabled={mail.busy} onClick={() => setRemove(account.id)}>
								Remove
							</Button>
						</Flex>
						{remove === account.id && (
							<Flex direction="column" gap={2}>
								<Text fontSize="sm">Remove this account and its Thingtime mail cache? Mail on your provider’s server stays untouched.</Text>
								<Flex gap={2}>
									<Button
										colorScheme="red"
										size="sm"
										isDisabled={mail.busy}
										onClick={async () => {
											if (await mail.remove('mail-account', account.id)) setRemove(null);
										}}
									>
										Remove account
									</Button>
									<Button size="sm" onClick={() => setRemove(null)}>
										Keep account
									</Button>
								</Flex>
							</Flex>
						)}
					</Flex>
				))}
			</SettingsSection>
			{draft && (
				<MailAccountEditor
					allowCloud={!mail.anonymous}
					key={draft.id}
					account={draft}
					busy={mail.busy}
					onSave={mail.saveAccount}
					onCancel={() => setDraft(null)}
				/>
			)}
			<SettingsSection
				eyebrow="Optional local connector"
				description="Pair this browser with the connector running on your computer. It connects directly to your email servers and keeps credentials out of Thingtime’s cloud."
			>
				<Text fontSize="sm">
					{hasNativeMailSync()
						? 'This app includes direct mail sync: choose Directly from this app in the account settings. '
						: mail.anonymous
						? 'Pair a local connector to sync from this browser without a Thingtime account. '
						: 'Choose Thingtime API relay to sync without installing anything. '}
					For the separate connector option, start the connector with your Thingtime origin and a random pairing token, then enter that token here.
					Setup instructions are in the project README’s Incoming mail section.
				</Text>
				<FormControl>
					<FormLabel>Pairing token</FormLabel>
					<Input
						type="password"
						autoComplete="off"
						value={token}
						onChange={(event) => setToken(event.target.value)}
						placeholder={mail.data.connectorToken ? 'This browser is paired' : 'Connector pairing token'}
					/>
				</FormControl>
				<Button
					alignSelf="start"
					isDisabled={!token || mail.busy || !mail.ready}
					onClick={async () => {
						if (await mail.pair(token)) {
							setToken('');
							lopu({ title: 'Local mail connector paired', status: 'success' });
						}
					}}
				>
					Save pairing
				</Button>
				<Text fontSize="xs" color="var(--tt-muted)">
					Your browser may ask permission to reach the local network. The connector listens only on 127.0.0.1:17879 and accepts your paired origin and
					token.
				</Text>
			</SettingsSection>
			<Text fontSize="xs" color="var(--tt-muted)">
				Offline reading keeps your synced messages on this browser while device storage is available. Sync runs when you press Sync; receiving new
				mail requires a network connection. Large messages are marked as partial. Gmail accounts connected with Google also support drafts, sending
				and mailbox actions.
			</Text>
			{mail.busy && (
				<Text role="status" fontSize="sm">
					Updating mail… Your saved mail remains available.
				</Text>
			)}
		</Flex>
	);
}
