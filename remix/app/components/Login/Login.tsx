import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, Spinner, InputGroup, InputRightElement, Box } from '@chakra-ui/react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
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


	const [username, setUsername] = useState(devMode ? thingtime?.devKit?.testUsers?.default?.username : '');
	const [password, setPassword] = useState(devMode ? thingtime?.devKit?.testUsers?.default?.password : '');

	const [passwordVisible, setPasswordVisible] = useState(devMode ? true : false);

	React.useEffect(() => {
		// if devMode is true, set username and password to testUsers
		if (devMode && !username && !password) {
			setUsername(thingtime?.devKit?.testUsers?.default?.username || '');
			setPassword(thingtime?.devKit?.testUsers?.default?.password || '');
			setPasswordVisible(true);
		}
	}, [devMode]);

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
					navigate('/');
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
			// dead (expired/consumed, or its own attempts exhausted). Match the
			// specific server phrasings — NOT the login rate-limiter's "Too many
			// login attempts" 429, which shares the word "attempts" but leaves the
			// challenge valid, and NOT "Invalid security code" (let them retry).
			if (otpChallenge && err?.error && /no longer valid|request a new code/i.test(err.error)) {
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
							<FormControl>
								<Input
									sx={inputSx}
									onChange={(e) => setUsername(e?.target?.value)}
									placeholder="💌 Username"
									type="username"
									value={username}
								/>
							</FormControl>

							<FormControl>
								<InputGroup>
									<Input
										sx={inputSx}
										onChange={(e) => setPassword(e?.target?.value)}
										placeholder="Password 🔑"
										type={passwordVisible ? 'text' : 'password'}
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
