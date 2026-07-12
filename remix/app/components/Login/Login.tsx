import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, Spinner, InputGroup, InputRightElement, Box } from '@chakra-ui/react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import { consumeAuthReturnTo } from '~/utils/authReturn';
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

	const [username, setUsername] = useState(devMode ? defaultTestUsername : '');
	const [password, setPassword] = useState(devMode ? defaultTestPassword : '');

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

		setLoading(true);

		try {
			const resp = await login({ username, password });
			setLoginResp(resp);

			if (resp?.ok) {
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
					title: 'Login failed',
					description: resp?.error || 'Invalid username or password',
					status: 'error',
					duration: 6000,
				});
			}
		} catch (err) {
			lopu({
				title: 'Network error',
				description: 'Could not reach the server. Please try again.',
				status: 'error',
				duration: 6000,
			});
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
							{embedded ? 'Add an account ✨' : 'Welcome back ✨'}
						</Box>
					</Flex>

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
						{embedded ? 'Add account ✨' : 'Login ✨'}
					</Button>

					{onSwitchMode ? (
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
					)}
				</Flex>
			</form>
		</>
	);
};
