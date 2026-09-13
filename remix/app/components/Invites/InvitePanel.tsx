import { refreshLopuAccount } from '~/components/Lopu/useLopuAccount';
import React from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { InviteProfileFields, type InviteProfile } from './InviteProfileFields';
import { inviteRequest } from './inviteClient';
import { useLopu } from '~/components/Lopu/useLopu';
export const InvitePanel = () => {
	const [profile, setProfile] = React.useState<InviteProfile>({ username: '', displayName: '', avatarUrl: null });
	const [credits, setCredits] = React.useState('0');
	const [busy, setBusy] = React.useState(false);
	const [photoBusy, setPhotoBusy] = React.useState(false);
	const [url, setUrl] = React.useState('');
	const [invites, setInvites] = React.useState<any[]>([]);
	const [error, setError] = React.useState('');
	const lopu = useLopu();
	const refresh = React.useCallback(async () => {
		const data = await inviteRequest({ intent: 'list' });
		setInvites(data.invites);
		await refreshLopuAccount();
	}, []);
	React.useEffect(() => {
		void refresh().catch((e) => setError(e.message));
	}, [refresh]);
	const failure = (e: any) => {
		setError(e.message);
		lopu({ title: 'Invite request failed', description: e.message, status: 'error' });
	};
	return (
		<Box id="gift-invites" width="100%" maxW="620px" mx="auto" minW={0}>
			<Text as="h2" fontSize="xl" fontWeight={600}>
				Invite someone with a gift 🎁
			</Text>
			<Text mt={2} mb={5} fontSize="sm" color="var(--tt-muted)">
				Set up their profile and choose credits to gift. They can change everything and choose their own password. Each link works once and expires in
				30 days.
			</Text>
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (busy || photoBusy) return;
					setBusy(true);
					setError('');
					try {
						const data = await inviteRequest({ intent: 'create', ...profile, credits: Number(credits) });
						setUrl(data.url);
						await refresh();
						lopu({ title: 'Your invite is ready 🎁', description: 'Copy the link below and share it with your friend.', status: 'success' });
					} catch (e) {
						failure(e);
					} finally {
						setBusy(false);
					}
				}}
			>
				<InviteProfileFields value={profile} onChange={setProfile} disabled={busy} onPreparingChange={setPhotoBusy} />
				<FormControl mt={4} isRequired>
					<FormLabel htmlFor="invite-credits">Credits to gift</FormLabel>
					<Input
						id="invite-credits"
						type="number"
						min="0"
						max="10000"
						step="0.000001"
						value={credits}
						onChange={(e) => setCredits(e.target.value)}
						disabled={busy}
					/>
					<Text mt={2} fontSize="xs">
						The gift is deducted now and held for signup. Cancel an unused invite to return it. Expired gifts are returned automatically.
					</Text>
				</FormControl>
				<Button type="submit" mt={4} isDisabled={photoBusy} isLoading={busy}>
					Create invite link
				</Button>
			</form>
			{url && (
				<Box mt={5} p={4} border="1px solid var(--tt-border)" borderRadius="12px" minW={0}>
					<Text fontWeight={600}>Your invite link</Text>
					<Text fontSize="xs" my={2}>
						Save this link now; it is shown only in this session. Anyone with it can claim the gift.
					</Text>
					<Input aria-label="Created invite link" value={url} isReadOnly onFocus={(e) => e.target.select()} />
					<Button
						mt={2}
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(url);
								lopu({ title: 'Invite link copied', status: 'success' });
							} catch {
								lopu({ title: 'Select and copy the link above', status: 'info' });
							}
						}}
					>
						Copy link
					</Button>
				</Box>
			)}
			{error && (
				<Text role="alert" mt={3} fontSize="sm">
					{error}
				</Text>
			)}
			{invites.length > 0 && (
				<Box mt={6}>
					<Text fontWeight={600}>Your invites</Text>
					{invites.map((invite) => (
						<Flex key={invite.id} py={3} gap={3} align="center" borderBottom="1px solid var(--tt-border)" minW={0}>
							<Box flex={1} minW={0}>
								<Text overflowWrap="anywhere">
									{invite.displayName || 'Invite'} · {invite.credits} credits
								</Text>
								<Text fontSize="xs">
									{invite.status} · expires {new Date(invite.expiresAt).toLocaleDateString()}
								</Text>
							</Box>
							{invite.status === 'pending' && (
								<Button
									size="sm"
									isDisabled={busy}
									onClick={async () => {
										setBusy(true);
										try {
											await inviteRequest({ intent: 'cancel', id: invite.id });
											setUrl('');
											await refresh();
										} catch (e) {
											failure(e);
										} finally {
											setBusy(false);
										}
									}}
								>
									Cancel
								</Button>
							)}
						</Flex>
					))}
				</Box>
			)}
		</Box>
	);
};
