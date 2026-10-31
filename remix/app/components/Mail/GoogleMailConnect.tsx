import React from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { mailRequest } from '~/mail/client';
/** The initiating signed-in tab confirms the address; the external browser never receives Thingtime credentials. */
export function GoogleMailConnect({ ownerId, onConnected }: { ownerId: string; onConnected: () => Promise<unknown> }) {
	const key = `thingtime:gmail-connect:${location.origin}:${ownerId}`;
	const [flowId, setFlowId] = React.useState(() => {
		try {
			return sessionStorage.getItem(key) || '';
		} catch {
			return '';
		}
	});
	const [authorizeUrl, setAuthorizeUrl] = React.useState(''),
		[address, setAddress] = React.useState('');
	const [busy, setBusy] = React.useState(false),
		[error, setError] = React.useState('');
	const active = React.useRef(true),
		working = React.useRef(false),
		abort = React.useRef(new AbortController());
	React.useEffect(() => {
		active.current = true;
		abort.current = new AbortController();
		return () => {
			active.current = false;
			abort.current.abort();
		};
	}, []);
	const remember = (id: string) => {
		setFlowId(id);
		try {
			id ? sessionStorage.setItem(key, id) : sessionStorage.removeItem(key);
		} catch {}
	};
	async function act(operation: string) {
		if (working.current) return;
		working.current = true;
		setBusy(true);
		setError('');
		try {
			const result = await mailRequest(ownerId, { operation, flowId, address }, {}, abort.current.signal);
			if (!active.current) return;
			if (result.flowId) {
				remember(result.flowId);
				setAuthorizeUrl(result.authorizeUrl);
			}
			if (result.status === 'ready') setAddress(result.address);
			if (result.status === 'complete' || result.status === 'cancelled') {
				remember('');
				setAuthorizeUrl('');
				setAddress('');
				if (result.status === 'complete') await onConnected();
			}
		} catch (cause) {
			if (active.current) setError(cause instanceof Error ? cause.message : 'Could not connect Gmail.');
		} finally {
			working.current = false;
			if (active.current) setBusy(false);
		}
	}
	const actRef = React.useRef(act);
	actRef.current = act;
	React.useEffect(() => {
		if (!flowId) return;
		const check = () => {
			if (document.visibilityState === 'visible') void actRef.current('google-status');
		};
		window.addEventListener('focus', check);
		document.addEventListener('visibilitychange', check);
		check();
		return () => {
			window.removeEventListener('focus', check);
			document.removeEventListener('visibilitychange', check);
		};
	}, [flowId]);
	return (
		<Flex direction="column" gap={2} py={3}>
			{!flowId ? (
				<Button alignSelf="start" onClick={() => act('google-begin')} isDisabled={busy}>
					Connect Gmail with Google
				</Button>
			) : (
				<>
					{address ? (
						<>
							<Text overflowWrap="anywhere">
								Connect <strong>{address}</strong> to this Thingtime account?
							</Text>
							<Button alignSelf="start" onClick={() => act('google-finish')} isDisabled={busy}>
								Confirm Gmail account
							</Button>
						</>
					) : (
						<>
							<Text fontSize="sm">Choose your Google account, allow Gmail access, then return here.</Text>
							{authorizeUrl && (
								<Button as="a" alignSelf="start" href={authorizeUrl} target="_blank" rel="noopener noreferrer">
									Continue with Google
								</Button>
							)}
							<Button alignSelf="start" onClick={() => act('google-status')} isDisabled={busy}>
								I’ve finished with Google
							</Button>
						</>
					)}
					<Button
						alignSelf="start"
						variant="ghost"
						onClick={async () => {
							await act('google-cancel');
						}}
						isDisabled={busy}
					>
						Cancel connection
					</Button>
					{error && (
						<Button
							alignSelf="start"
							variant="ghost"
							onClick={() => {
								remember('');
								setAddress('');
								setAuthorizeUrl('');
								setError('');
							}}
						>
							Start again
						</Button>
					)}
				</>
			)}
			<Text fontSize="xs" color="var(--tt-muted)">
				No app password needed. Thingtime saves your Google authorization encrypted and uses it to read and manage mail, save drafts, and send
				messages when you choose those actions. Messages start with a device copy; you can enable cloud storage in Edit. This does not sign you in to
				a different Thingtime account.
			</Text>
			{error && (
				<Text role="alert" fontSize="sm">
					{error}
				</Text>
			)}
		</Flex>
	);
}
