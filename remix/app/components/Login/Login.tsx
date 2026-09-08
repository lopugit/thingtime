import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, Spinner, InputGroup, InputRightElement, Box } from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { isPasskeyCancel, passkeyErrorMessage, passkeysSupported, useAccountHints, usePasskeyAuth, usePasskeyAutofill } from '~/hooks/usePasskeys';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import { consumeAuthReturnTo } from '~/utils/authReturn';
import { AccountHintRow } from '../Account/AccountHints';
import { useThingtime } from '../Thingtime/useThingtime';
import { useLopu } from '../Lopu/useLopu';
import { Icon } from '../Icon/Icon';
import { Thingtime } from '../Thingtime/Thingtime';

// import bcrypt from 'bcrypt';

// Prism input look: soft alt-surface fill, hairline focus border (the theme
// suppresses focus rings globally, so focus reads as a subtle bg shift).
const inputSx = {
	background: 'var(--tt-surface-alt, #f5f5f7)',
	border: '1px solid transparent',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	outline: 'none',
	transition: 'background 150ms ease, border-color 150ms ease',
	'&::placeholder': {
		color: 'var(--tt-muted, #9a9aa6)'
	},
	'&:focus': {
		background: 'var(--tt-card, #ffffff)',
		borderColor: 'var(--tt-border, #ececef)'
	}
};

// Zero-prop on the /login page. Embedded mode (account switcher "Add an
// account") renders the same form inside a host surface: no navigation on
// success (onSuccess gets the user — the login API already merged the account
// into the switcher roster), modal-safe loading, and the register cross-link
// becomes an in-place mode toggle via onSwitchMode.
export const Login = (props) => {
	const { embedded, onSuccess, onSwitchMode } = props || {};

	const { thingtime } = useThingtime();

	const devMode = thingtime?.devKit?.devMode;
	const defaultTestUsername = thingtime?.devKit?.testUsers?.default?.username || '';
	const defaultTestPassword = thingtime?.devKit?.testUsers?.default?.password || '';

	// ?u=<username> — the auto-login popup's "continue as" prefill.
	const [searchParams] = useSearchParams();
	const prefilledUsername = (!embedded && searchParams.get('u')) || '';

	const [username, setUsername] = useState(prefilledUsername || (devMode ? defaultTestUsername : ''));
	const [password, setPassword] = useState(devMode && !prefilledUsername ? defaultTestPassword : '');

	const [passwordVisible, setPasswordVisible] = useState(devMode ? true : false);

	React.useEffect(() => {
		// if devMode is true, set username and password to testUsers
		if (devMode && !username && !password) {
			setUsername(defaultTestUsername);
			setPassword(defaultTestPassword);
			setPasswordVisible(true);
		}
	}, [defaultTestPassword, defaultTestUsername, devMode, password, username]);

	const [loading, setLoading] = useState(false);

	// email 2FA: after a valid password on a 2FA account the API returns a
	// challenge instead of a session — the form swaps into code mode until the
	// emailed 6-digit code completes the login (or the user goes back)
	const [otpChallenge, setOtpChallenge] = useState(null);
	const [otpCode, setOtpCode] = useState('');

	const api = useApi();

	const login = api.v1.login;

	const [loginResp, setLoginResp] = React.useState();

	const lopu = useLopu();
	const navigate = useNavigate();

	const passwordInputRef = React.useRef(null);

	// Shared landing for every successful login (password, passkey button,
	// passkey autofill): toast + host callback or return-to navigation.
	const handleLoggedIn = React.useCallback(
		(user) => {
			lopu({
				title: `Welcome back, ${user?.username || 'friend'}! ✨`,
				status: 'success',
				duration: 5000,
			});
			if (onSuccess) {
				onSuccess(user);
			} else {
				navigate(consumeAuthReturnTo('/'), { replace: true });
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[onSuccess, navigate]
	);

	const { loginWithPasskey, cancelPasskey } = usePasskeyAuth();
	const [passkeyLoading, setPasskeyLoading] = React.useState(false);

	// Conditional UI: while the form is idle, one background ceremony arms the
	// browser's own passkey autofill (Safari/iCloud Keychain, Chrome, 1Password
	// surface their popup on the username field). Resolves only if the user
	// picks a passkey there. Standalone /login only — the embedded "Add
	// account" form renders while ALREADY signed in, where an armed background
	// request just invites surprise passkey popups (the modal 🔑 button still
	// works there).
	usePasskeyAutofill(!otpChallenge && !embedded && !loading && !passkeyLoading, (resp) => handleLoggedIn(resp?.user), (error) => {
		lopu({ title: 'Passkey sign-in failed', description: passkeyErrorMessage(error), status: 'error', duration: 6000 });
	});

	const handlePasskeyLogin = async () => {
		if (passkeyLoading) return;
		setPasskeyLoading(true);
		try {
			const resp = await loginWithPasskey();
			if (resp?.ok) handleLoggedIn(resp.user);
		} catch (err) {
			// The user explicitly clicked the button, so even a "cancelled"
			// outcome gets gentle feedback: the browser reports a failed
			// cross-device (QR/Bluetooth) handoff with the SAME error as a user
			// cancel, and dead air after scanning a QR reads as broken.
			if (err?.name === 'AbortError') return;
			if (isPasskeyCancel(err)) {
				lopu({
					title: 'Passkey sign-in didn’t complete 🤏',
					description: passkeyErrorMessage(err),
					status: 'info',
					duration: 5000,
				});
			} else {
				lopu({
					title: 'Passkey login failed',
					description: passkeyErrorMessage(err),
					status: 'error',
					duration: 6000,
				});
			}
		} finally {
			setPasskeyLoading(false);
		}
	};

	// Accounts signed in on other Thingtime deployments (cross-deployment
	// hints) — picking one prefills the username and focuses the password.
	const { hints } = useAccountHints();
	const hintSuggestions = hints.filter((hint) => !hint.alreadyHere);
	const pickHint = (hint) => {
		setUsername(hint.user.username);
		setPassword('');
		try {
			passwordInputRef.current?.focus();
		} catch {
			// focus is best-effort
		}
	};

	// DevKit prefill: fills the form when devKit.loginPrefill changes (_ts)
	const loginPrefill = thingtime?.devKit?.loginPrefill;
	React.useEffect(() => {
		if (loginPrefill?._ts) {
			if (typeof loginPrefill.username === 'string') setUsername(loginPrefill.username);
			if (typeof loginPrefill.password === 'string') setPassword(loginPrefill.password);
			setPasswordVisible(true);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loginPrefill?._ts]);

	const handleLogin = async (e) => {
		e?.preventDefault();

		// Don't spend a challenge attempt on an empty/short code — the server
		// increments the attempt counter before comparing, so a stray submit
		// would burn one of the five tries against a still-valid challenge.
		if (otpChallenge && otpCode.trim().length < 6) {
			lopu({ title: 'Enter the 6-digit code from your email', status: 'info', duration: 4000 });
			return;
		}

		cancelPasskey();
		setLoading(true);

		try {
			const resp = otpChallenge
				? await login({ challenge: otpChallenge, code: otpCode.trim() })
				: await login({ username, password });
			setLoginResp(resp);

			if (resp?.ok && resp?.requiresOtp) {
				// no session yet — the emailed code is the second half of this login
				setOtpChallenge(resp.challenge);
				setOtpCode('');
				lopu({
					title: 'Check your email 💌',
					description: 'We sent a 6-digit security code to finish logging in.',
					status: 'info',
					duration: 8000,
				});
			} else if (resp?.ok) {
				lopu({
					title: `Welcome back, ${resp.user?.username || username}! ✨`,
					status: 'success',
					duration: 5000,
				});
				if (onSuccess) {
					onSuccess(resp.user);
				} else {
					navigate(consumeAuthReturnTo('/'), { replace: true });
				}
			} else {
				lopu({
					title: otpChallenge ? 'Code rejected' : 'Login failed',
					description: resp?.error || 'Invalid username or password',
					status: 'error',
					duration: 6000,
				});
			}
		} catch (err) {
			// asyncFetcher throws the parsed { ok:false, error } payload on !ok
			// responses (401 bad code, 429 exhausted attempts) — surface it
			const message = err?.error;
			lopu({
				title: message ? (otpChallenge ? 'Code rejected' : 'Login failed') : 'Network error',
				description: message || 'Could not reach the server. Please try again.',
				status: 'error',
				duration: 6000,
			});
			// Only bounce back to the password step when the challenge itself is
			// dead — keyed off the server's STABLE reason code, not error copy.
			// 'challenge_invalid' (expired/consumed) and 'too_many_attempts' (the
			// challenge's own attempt limit) kill the challenge; the login
			// rate-limiter's 429 carries NO reason (challenge stays valid), and
			// 'wrong_code' lets the user retry — neither bounces.
			if (otpChallenge && (err?.reason === 'challenge_invalid' || err?.reason === 'too_many_attempts')) {
				setOtpChallenge(null);
				setOtpCode('');
			}
		} finally {
			setLoading(false);
		}
	};

	const persistent = devMode ? (
		<>
			<Flex>
				<Thingtime value={loginResp}></Thingtime>
			</Flex>
		</>
	) : null;

	// Embedded hosts keep the form mounted (Button isLoading below) — swapping
	// in this full-viewport spinner would blow up a modal.
	if (loading && !embedded) {
		return (
			<>
				<Flex flexDir="column" alignItems="center" justifyContent="center" height="100vh" width="100%">
					{persistent}
					<Spinner
						sx={{
							'@keyframes rotate': {
								'0%': { transform: 'rotate(0deg)' },
								'100%': { transform: 'rotate(360deg)' }
							},
							animation: 'rotate 2s linear infinite, var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
						}}
						background={RAINBOW}
						// rainbow gradient border
						backgroundSize="calc(100px + 200%)"
						color="transparent"
						size="xl"
					/>
				</Flex>
			</>
		);
	}

	return (
		<>
			<form onSubmit={handleLogin}>
				<Flex
					flexDirection="column"
					gap={4}
					width={embedded ? '100%' : '340px'}
					maxWidth="100%"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius={embedded ? 'var(--tt-radius-md, 12px)' : 'var(--tt-radius-xl, 20px)'}
					boxShadow={embedded ? 'none' : 'var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))'}
					padding={embedded ? 5 : 9}
				>
					<Flex flexDirection="column" gap={1} paddingBottom={1}>
						<Box
							fontFamily="mono"
							fontSize="11px"
							fontWeight="600"
							letterSpacing="0.14em"
							textTransform="uppercase"
							color="var(--tt-muted, #9a9aa6)"
						>
							{embedded ? 'Thingtime · Add account' : 'Thingtime · Login'}
						</Box>
						<Box
							as="h1"
							fontFamily="heading"
							fontSize="2xl"
							fontWeight="700"
							letterSpacing="-0.02em"
							background={RAINBOW_TEXT}
							backgroundSize="calc(100px + 200%)"
							sx={{
								WebkitBackgroundClip: 'text',
								backgroundClip: 'text',
								WebkitTextFillColor: 'transparent',
								animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
							}}
						>
							{otpChallenge ? 'Check your email 💌' : embedded ? 'Add an account ✨' : 'Welcome back ✨'}
						</Box>
					</Flex>

					{otpChallenge ? (
						<>
							<Box fontSize="sm" color="var(--tt-muted, #9a9aa6)">
								This account has email 2FA on — enter the 6-digit code we just emailed to finish logging in.
							</Box>
							<FormControl>
								<Input
									sx={inputSx}
									onChange={(e) => setOtpCode(e?.target?.value)}
									placeholder="🔢 6-digit code"
									inputMode="numeric"
									autoComplete="one-time-code"
									maxLength={6}
									value={otpCode}
									autoFocus
								/>
							</FormControl>
						</>
					) : (
						<>
							{hintSuggestions.length ? (
								<Flex
									flexDirection="column"
									background="var(--tt-surface-alt, #f5f5f7)"
									borderRadius="var(--tt-radius-md, 12px)"
									padding={2}
									gap={0}
								>
									<Box
										fontSize="10px"
										fontFamily="mono"
										fontWeight="600"
										letterSpacing="0.1em"
										textTransform="uppercase"
										color="var(--tt-muted, #9a9aa6)"
										paddingX={2}
										paddingTop={1}
									>
										Signed in elsewhere on Thingtime
									</Box>
									{hintSuggestions.slice(0, 3).map((hint) => (
										<AccountHintRow key={hint.user.id} hint={hint} onPick={pickHint} pickLabel="Use" />
									))}
								</Flex>
							) : null}

							<FormControl>
								<Input
									sx={inputSx}
									onChange={(e) => setUsername(e?.target?.value)}
									placeholder="💌 Username"
									type="username"
									// "webauthn" opts this field into the browser's conditional
									// passkey autofill (iCloud Keychain / 1Password popup)
									autoComplete="username webauthn"
									value={username}
								/>
							</FormControl>

							<FormControl>
								<InputGroup>
									<Input
										ref={passwordInputRef}
										sx={inputSx}
										onChange={(e) => setPassword(e?.target?.value)}
										placeholder="Password 🔑"
										type={passwordVisible ? 'text' : 'password'}
										autoComplete="current-password"
										value={password}
									/>
									<InputRightElement>
										<Box cursor="pointer" onClick={() => setPasswordVisible(!passwordVisible)} opacity={passwordVisible ? 1 : 0.5}>
											<Icon name={passwordVisible ? '🔓' : '🔒'} />
										</Box>
									</InputRightElement>
								</InputGroup>
								{/* optional showpassword button/icon */}
							</FormControl>
						</>
					)}

					<Button
						sx={{
							animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
						}}
						type="submit"
						isLoading={embedded ? loading : undefined}
						loadingText="Logging in…"
						display="flex"
						justifyContent="center"
						width="100%"
						color="white"
						fontFamily="heading"
						fontWeight="600"
						// Add rainbow animation background gradient right to left
						background={RAINBOW}
						backgroundSize="calc(100px + 200%)"
						borderRadius="var(--tt-radius-md, 12px)"
						_hover={{
							opacity: 0.9
						}}
						cursor="pointer"
						transition="all 150ms ease-in-out"
						paddingX={4}
						paddingY={2}
					>
						{otpChallenge ? 'Verify code ✨' : embedded ? 'Add account ✨' : 'Login ✨'}
					</Button>

					{passkeyLoading ? <Button type="button" variant="ghost" size="sm" onClick={cancelPasskey}>Cancel passkey sign-in</Button> : null}
					{!otpChallenge && passkeysSupported() ? (
						<Button
							type="button"
							onClick={handlePasskeyLogin}
							isLoading={passkeyLoading}
							loadingText="Waiting for your passkey…"
							display="flex"
							justifyContent="center"
							width="100%"
							variant="outline"
							fontFamily="heading"
							fontWeight="600"
							color="var(--tt-text, #5a5a66)"
							borderColor="var(--tt-border, #ececef)"
							borderRadius="var(--tt-radius-md, 12px)"
							_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
							cursor="pointer"
							transition="all 150ms ease-in-out"
							paddingX={4}
							paddingY={2}
						>
							Sign in with a passkey 🔑
						</Button>
					) : null}

					{otpChallenge ? (
						<Box
							as="button"
							type="button"
							onClick={() => {
								setOtpChallenge(null);
								setOtpCode('');
							}}
							textAlign="left"
							fontSize="xs"
							color="var(--tt-muted, #9a9aa6)"
							transition="color 150ms ease"
							cursor="pointer"
							_hover={{ color: 'var(--tt-text, #5a5a66)' }}
						>
							← Back to password login
						</Box>
					) : onSwitchMode ? (
						<Box
							as="button"
							type="button"
							onClick={onSwitchMode}
							textAlign="left"
							fontSize="xs"
							color="var(--tt-muted, #9a9aa6)"
							transition="color 150ms ease"
							cursor="pointer"
							_hover={{ color: 'var(--tt-text, #5a5a66)' }}
						>
							Need an account? Register
						</Box>
					) : (
						<Flex justifyContent="space-between" gap={2}>
							<RouterLink to="/register">
								<Box
									fontSize="xs"
									color="var(--tt-muted, #9a9aa6)"
									transition="color 150ms ease"
									_hover={{ color: 'var(--tt-text, #5a5a66)' }}
								>
									Need an account? Register
								</Box>
							</RouterLink>
							<RouterLink to="/reset-password">
								<Box
									fontSize="xs"
									color="var(--tt-muted, #9a9aa6)"
									transition="color 150ms ease"
									_hover={{ color: 'var(--tt-text, #5a5a66)' }}
								>
									Forgot password?
								</Box>
							</RouterLink>
						</Flex>
					)}
				</Flex>
			</form>
		</>
	);
};
