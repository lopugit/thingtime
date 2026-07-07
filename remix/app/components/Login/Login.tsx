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

export const Login = (props) => {
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
				navigate('/');
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

	if (loading) {
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
					width="340px"
					maxWidth="100%"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-xl, 20px)"
					boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
					padding={9}
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
							Thingtime · Login
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
							Welcome back ✨
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
						Login ✨
					</Button>

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
				</Flex>
			</form>
		</>
	);
};
