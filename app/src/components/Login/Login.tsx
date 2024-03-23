import React, { useState } from 'react';
import { Flex, Button, FormControl, Input } from '@chakra-ui/react';

export const Login = (props) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (props) => {
    // handle login

    const { username, password } = props;

    console.log('nik username', username);
    console.log('nik password', password);
  };

  return (
    <>
      <form>
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
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="username"
              value={email}
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
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
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
            Login
          </Button>
        </Flex>
      </form>
    </>
  );
};
