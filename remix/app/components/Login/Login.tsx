import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, Spinner, Link } from '@chakra-ui/react';
import { useFetcher } from '@remix-run/react';

import { useApi } from '~/hooks/useApi';

export const Login = (props) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);

  const api = useApi();

  const login = api.v1.login;

  const handleLogin = async (e) => {
    e?.preventDefault();

    setLoading(true);

    const loginResp = await login({ username, password });

    if (loginResp) {
      console.log('nik loginResp', loginResp);
    } else {
      console.error('nik no loginResp', loginResp);
    }

    console.log('nik username', username);
    console.log('nik password', password);
  };

  if (loading) {
    return (
      <Flex alignItems="center" justifyContent="center" height="100vh" width="100%">
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
              placeholder="Email 💌"
              type="email"
              value={username}
            />
          </FormControl>

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
              onChange={(e) => setPassword(e?.target?.value)}
              placeholder="Password 🔑"
              type="password"
              value={password}
            />
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
        </Flex>
      </form>
    </>
  );
};
