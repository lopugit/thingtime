import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, Spinner, Link, InputGroup, InputRightElement, Box } from '@chakra-ui/react';
import { Link as RemixLink, useFetcher } from '@remix-run/react';

import { useApi } from '~/hooks/useApi';
import { useThingtime } from '../Thingtime/useThingtime';
import { Icon } from '../Icon/Icon';
import { Thingtime } from '../Thingtime/Thingtime';

// import bcrypt from 'bcrypt';

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

	const handleLogin = async (e) => {
		e?.preventDefault();

		setLoading(true);

		// TODO: hash before sending to server

		// const hashedPassword = bcrypt.hashSync(password);

		const loginResp = await login({ username, password });

		setLoginResp(loginResp);

		if (loginResp) {
		} else {
			console.error('no loginResp', loginResp);
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
							'@keyframes moving-rainbow': {
								'0%': { backgroundPosition: '0 0' },
								'100%': { backgroundPosition: 'calc(100px + 400%) 0' }
							},
							'@keyframes rotate': {
								'0%': { transform: 'rotate(0deg)' },
								'100%': { transform: 'rotate(360deg)' }
							},
							animation: 'rotate 2s linear infinite, moving-rainbow 40s infinite linear'
						}}
						bgGradient="linear-gradient(to right, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)"
						// rainbow gradient border
						backgroundSize="calc(100px + 400%)"
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
				<Flex flexDirection="column" gap={4} width="255px" maxWidth="100%">
					<FormControl>
						<Input
							sx={{
								'&::placeholder': {
									color: 'greys.dark'
									// color: "white",
								}
							}}
							background="grey"
							border="none"
							borderRadius="5px"
							outline="none"
							onChange={(e) => setUsername(e?.target?.value)}
							placeholder="💌 Username"
							type="username"
							value={username}
						/>
					</FormControl>

					<FormControl>
						<InputGroup>
							<Input
								sx={{
									'&::placeholder': {
										color: 'greys.dark'
										// color: "white",
									}
								}}
								background="grey"
								border="none"
								borderRadius="5px"
								outline="none"
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
							'@keyframes moving-rainbow': {
								'0%': { backgroundPosition: '0 0' },
								'100%': { backgroundPosition: 'calc(100px + 400%) 0' }
							},
							animation: 'moving-rainbow 40s infinite linear'
						}}
						type="submit"
						display="Flex"
						justifyContent="flex-start"
						width="100%"
						color="white"
						fontWeight="bold"
						background="chakras.violet"
						backgroundSize="calc(100px + 400%)"
						// Add rainbow animation background gradient right to left
						bgGradient="linear-gradient(to right, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)"
						borderRadius={6}
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

					<RemixLink to="/register">
						<Box fontSize="xs" opacity={0.7}>
							Need an account? Register
						</Box>
					</RemixLink>
				</Flex>
			</form>
		</>
	);
};
