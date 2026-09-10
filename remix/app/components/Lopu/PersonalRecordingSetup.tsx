import React from 'react';
import { Box, Button, Code, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useLopu } from './useLopu';
import { requestRecordingPairing, type RecordingPairingChallenge } from './recordingPairing';

// Parent keys this component by account: changing account unmounts it, aborts
// requests, and discards the one-time secret. Never persist it in a browser cache.
export function PersonalRecordingSetup({ ownerId, username, disabled }: { ownerId: string; username: string; disabled: boolean }) {
	const [open, setOpen] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [challenge, setChallenge] = React.useState<RecordingPairingChallenge | null>(null);
	const [revealed, setRevealed] = React.useState(false);
	const [copied, setCopied] = React.useState(false);
	const [expired, setExpired] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const active = React.useRef<AbortController | null>(null);
	const lopu = useLopu();
	const clear = () => { active.current?.abort(); active.current = null; setBusy(false); setChallenge(null); setRevealed(false); setCopied(false); };
	React.useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
	React.useEffect(() => {
		if (!challenge) return;
		const timer = setTimeout(() => { setChallenge(null); setRevealed(false); setCopied(false); setExpired(true); }, Math.max(0, challenge.expiresAt - Date.now()));
		return () => clearTimeout(timer);
	}, [challenge]);
	const generate = async () => {
		if (disabled || active.current) return;
		const controller = new AbortController(); active.current = controller;
		const timer = setTimeout(() => controller.abort(), 20_000);
		setBusy(true); setError(null); setExpired(false);
		try {
			const next = await requestRecordingPairing({ origin: window.location.origin, ownerId, signal: controller.signal });
			if (active.current === controller && !controller.signal.aborted) { setChallenge(next); setRevealed(false); setCopied(false); }
		} catch {
			if (active.current === controller) setError('Setup could not start. Refresh your sign-in and connection, then try again. This domain must support recording pairing.');
		} finally {
			clearTimeout(timer);
			if (active.current === controller) { active.current = null; setBusy(false); }
		}
	};
	const copy = async () => {
		if (!challenge || challenge.expiresAt <= Date.now()) { clear(); setExpired(true); return; }
		try { await navigator.clipboard.writeText(challenge.secret); setCopied(true); }
		catch { lopu({ title: 'Could not copy setup secret', description: 'Reveal it and copy it manually into your own Mac terminal.', status: 'error' }); }
	};
	return <Box mt={3} minW={0}>
		<Button size="sm" variant="outline" isDisabled={disabled} onClick={() => { if (open) clear(); setOpen(!open); setError(null); setExpired(false); }}
			aria-expanded={open} aria-controls="personal-recording-setup">{open ? 'Hide and clear setup' : 'Pair a Mac for recordings'}</Button>
		{open ? <Box id="personal-recording-setup" mt={3} p={[3, 4]} borderWidth="1px" borderRadius="12px" minW={0}>
			<Text as="h3" fontWeight="semibold">Connect your own Mac to @{username}</Text>
			<Text mt={2} fontSize="sm">Your Mac transcribes audio locally and sends only transcript text to its signed-in Claude Code account. Keep the worker running when you want it to process recordings.</Text>
			<Text mt={2} fontSize="sm">First configure the Mac worker’s Whisper model, ffmpeg and native Claude Code paths. Run <Code>npm run recordings:worker -- --help</Code> for setup commands.</Text>
			<Text mt={3} fontSize="sm">In the Thingtime checkout’s remix folder, run:</Text>
			<Code display="block" p={3} mt={2} whiteSpace="pre-wrap" overflowWrap="anywhere">npm run recordings:worker -- pair --origin {typeof window === 'undefined' ? '' : window.location.origin}</Code>
			<Text mt={2} fontSize="sm">Create a one-time secret below and paste it into the terminal’s hidden prompt. Anyone with this secret can pair a device to your account until it expires. Only use it on your own trusted computer; never send it in a chat.</Text>
			{challenge ? <FormControl mt={3}>
				<FormLabel htmlFor="recording-pairing-secret">One-time setup secret</FormLabel>
				<Input id="recording-pairing-secret" type={revealed ? 'text' : 'password'} value={challenge.secret} readOnly autoComplete="off" spellCheck={false} fontFamily="mono" fontSize="sm" />
				<Flex mt={2} gap={2} flexWrap="wrap">
					<Button size="sm" onClick={() => void copy()}>{copied ? 'Copied — paste in terminal' : 'Copy setup secret'}</Button>
					<Button size="sm" variant="outline" onClick={() => { if (challenge.expiresAt > Date.now()) setRevealed(!revealed); else { clear(); setExpired(true); } }}>{revealed ? 'Hide secret' : 'Reveal secret'}</Button>
				</Flex>
				<Text mt={2} fontSize="sm">Expires at {new Date(challenge.expiresAt).toLocaleTimeString()}. Hiding this panel clears the displayed secret, but the server challenge remains valid until used or expired.</Text>
			</FormControl> : <Button mt={3} size="sm" isDisabled={busy || disabled} onClick={() => void generate()}>{busy ? 'Creating setup secret…' : 'Create one-time setup secret'}</Button>}
			{expired ? <Text mt={2} fontSize="sm" role="status">The setup secret expired and was cleared. Create a fresh one if needed.</Text> : null}
			{error ? <Text mt={2} fontSize="sm" role="status">{error}</Text> : null}
			<Text mt={3} fontSize="sm">After pairing, refresh status, select this computer above, then enable Automatic Watch recordings. Pairing alone does not enable processing. You can revoke the computer in <Link to="/devices">Devices</Link>.</Text>
			<Code display="block" p={3} mt={2} whiteSpace="pre-wrap" overflowWrap="anywhere">npm run recordings:worker -- run --origin {typeof window === 'undefined' ? '' : window.location.origin}</Code>
		</Box> : null}
	</Box>;
}
