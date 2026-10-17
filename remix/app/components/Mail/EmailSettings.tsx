import React from 'react';
import { Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { RainbowButton, SettingsSection } from '~/components/Settings/SettingsSection';
import { useMail } from '~/mail/useMail';
import type { MailAccount } from '~/mail/model';
import { MailAccountEditor, newMailAccount } from './MailAccountEditor';
export function EmailSettings() {
	const user = useCurrentUser();
	return user && !user.temporary && user.accountKind !== 'service' ? (
		<EmailSettingsScope key={user.id} ownerId={user.id} />
	) : (
		<Text>Sign in to connect your email accounts.</Text>
	);
}
function EmailSettingsScope({ ownerId }: { ownerId: string }) {
	const mail = useMail(ownerId),
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
				description="Connect as many accounts as you need. Choose cloud sync, local sync, both, or pause syncing while keeping your saved mail."
			>
				<Flex gap={2} wrap="wrap">
					<RainbowButton onClick={() => setDraft(newMailAccount())} isDisabled={!mail.ready || mail.busy}>
						Add email account
					</RainbowButton>
					<Button as={Link} to="/mail">
						Open Mail
					</Button>
					<Button onClick={mail.refresh} isDisabled={!mail.ready || mail.busy}>
						Refresh accounts
					</Button>
				</Flex>
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
							{Object.keys(account.servers).join(' + ').toUpperCase()} · {account.sync.cloud ? 'Cloud' : ''}
							{account.sync.cloud && account.sync.local ? ' + ' : ''}
							{account.sync.local ? 'Local' : ''}
							{!account.sync.cloud && !account.sync.local ? 'Sync paused' : ''}
						</Text>
						<Flex gap={2} wrap="wrap">
							<Button size="sm" isDisabled={mail.busy} onClick={() => setDraft(account)}>
								Edit
							</Button>
							<Button size="sm" isDisabled={mail.busy} onClick={() => mail.sync(account.id)}>
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
			{draft && <MailAccountEditor key={draft.id} account={draft} busy={mail.busy} onSave={mail.saveAccount} onCancel={() => setDraft(null)} />}
			<SettingsSection
				eyebrow="Local connector"
				description="Pair this browser with the connector running on your computer. It connects directly to your email servers and keeps credentials out of Thingtime’s cloud."
			>
				<Text fontSize="sm">
					Start the connector with your Thingtime origin and a random pairing token, then enter that token here. Setup instructions are in the project
					README’s Incoming mail section.
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
				Offline reading keeps up to 2,000 recently synced messages on this browser. Sync runs when you press Sync; receiving new mail requires a
				network connection. Large messages are marked as partial. Email sending is not part of this inbox feature.
			</Text>
			{mail.busy && (
				<Text role="status" fontSize="sm">
					Updating mail… Your saved mail remains available.
				</Text>
			)}
		</Flex>
	);
}
