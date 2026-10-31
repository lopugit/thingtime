import React from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';
import { InviteProfileFields, type InviteProfile } from './InviteProfileFields';
import { inviteRequest } from './inviteClient';
import { useLopu } from '~/components/Lopu/useLopu';
export const InviteSignup = () => {
	const token = useLocation().hash.slice(1);
	const [profile, setProfile] = React.useState<InviteProfile>({ username: '', displayName: '', avatarUrl: null });
	const [originalAvatar, setOriginalAvatar] = React.useState<string | null>(null);
	const [invite, setInvite] = React.useState<any>(null);
	const [password, setPassword] = React.useState('');
	const [email, setEmail] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [photoBusy, setPhotoBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const navigate = useNavigate();
	const lopu = useLopu();
	React.useEffect(() => {
		let active = true;
		setInvite(null);
		setError('');
		// The fragment is never sent in HTTP URLs or referrers. Keep it until
		// signup succeeds so root-data remounts and refreshes can reopen the invite.
		void inviteRequest({ intent: 'preview', token })
			.then(({ invite: data }) => {
				if (!active) return;
				setInvite(data);
				setProfile({ username: data.username, displayName: data.displayName, avatarUrl: data.avatarUrl });
				setOriginalAvatar(data.avatarUrl);
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
		};
	}, [token]);
	return (
		<Flex minH="100vh" w="100%" justify="center" align="center" px={4} py={12} bg="var(--tt-surface)">
			<Box w="100%" maxW="480px" p={{ base: 5, md: 8 }} bg="var(--tt-card)" border="1px solid var(--tt-border)" borderRadius="20px">
				<Text as="h1" fontSize="2xl" fontWeight={700}>
					You’re invited 🎁
				</Text>
				{!invite && !error && <Text mt={4}>Opening your invite…</Text>}
				{invite && (
					<>
						<Text my={4}>Your new account comes with {invite.credits} gifted credits. Keep these profile details or make them your own.</Text>
						<form
							onSubmit={async (event) => {
								event.preventDefault();
								if (busy || photoBusy) return;
								setBusy(true);
								setError('');
								try {
									await inviteRequest(
										{
											inviteToken: token,
											username: profile.username,
											displayName: profile.displayName,
											...(profile.avatarUrl !== originalAvatar ? { avatarUrl: profile.avatarUrl } : {}),
											password,
											...(email ? { email } : {})
										},
										true
									);
									window.dispatchEvent(new Event('thingtime:root-data-refresh'));
									lopu({ title: 'Welcome to Thingtime 🥰', description: 'Your account and gift are ready.', status: 'success' });
									navigate('/welcome', { replace: true });
								} catch (e) {
									const message = (e as Error).message;
									setError(message);
									lopu({ title: 'Could not finish signup', description: message, status: 'error' });
								} finally {
									setBusy(false);
								}
							}}
						>
							<InviteProfileFields value={profile} onChange={setProfile} disabled={busy} onPreparingChange={setPhotoBusy} />
							<FormControl mt={4} isRequired>
								<FormLabel htmlFor="invite-password">Choose your password</FormLabel>
								<Input
									id="invite-password"
									type="password"
									minLength={6}
									maxLength={200}
									autoComplete="new-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									disabled={busy}
								/>
							</FormControl>
							<FormControl mt={4}>
								<FormLabel htmlFor="invite-email">Email (optional)</FormLabel>
								<Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={busy} />
								<Text fontSize="xs" mt={2}>
									Include an email if you’d like password recovery.
								</Text>
							</FormControl>
							<Button type="submit" w="100%" mt={5} isDisabled={photoBusy} isLoading={busy}>
								Create my account
							</Button>
						</form>
					</>
				)}
				{error && (
					<Text role="alert" mt={4}>
						{error}
					</Text>
				)}
			</Box>
		</Flex>
	);
};
