import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, InputGroup, InputRightElement, Box, Text, useToast } from '@chakra-ui/react';
import { Link as RemixLink } from '@remix-run/react';

import { useApi } from '~/hooks/useApi';
import { Icon } from '../Icon/Icon';

const inputSx = {
  '&::placeholder': {
    color: 'greys.dark'
  }
};

export const Register = (props) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);

  const api = useApi();
  const register = api.v1.auth.register;
  const toast = useToast();

  const handleRegister = async (e) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const r = await register({ username, password, email });
      setResp(r);

      if (r?.ok) {
        toast({
          title: 'Account created 🎉',
          description: r.verificationLink
            ? 'Check your email to verify — or use the link below.'
            : 'Check your email to verify your account.',
          status: 'success',
          duration: 7000,
          isClosable: true,
          position: 'top'
        });
      } else {
        toast({
          title: 'Registration failed',
          description: r?.error || 'Something went wrong. Please try again.',
          status: 'error',
          duration: 7000,
          isClosable: true,
          position: 'top'
        });
      }
    } catch (err) {
      toast({
        title: 'Network error',
        description: 'Could not reach the server. Please try again.',
        status: 'error',
        duration: 7000,
        isClosable: true,
        position: 'top'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleRegister}>
      <Flex flexDirection="column" gap={4} width="255px" maxWidth="100%">
        <FormControl>
          <Input
            sx={inputSx}
            background="grey"
            border="none"
            borderRadius="5px"
            outline="none"
            onChange={(e) => setUsername(e?.target?.value)}
            placeholder="💌 Username"
            value={username}
          />
        </FormControl>

        <FormControl>
          <InputGroup>
            <Input
              sx={inputSx}
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
        </FormControl>

        {/* email lives below the password field, required from signup */}
        <FormControl>
          <Input
            sx={inputSx}
            background="grey"
            border="none"
            borderRadius="5px"
            outline="none"
            onChange={(e) => setEmail(e?.target?.value)}
            placeholder="📧 Email"
            type="email"
            value={email}
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
          isLoading={loading}
          loadingText="Creating account…"
          display="Flex"
          justifyContent="flex-start"
          width="100%"
          color="white"
          fontWeight="bold"
          background="chakras.violet"
          backgroundSize="calc(100px + 400%)"
          bgGradient="linear-gradient(to right, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)"
          borderRadius={6}
          _hover={{ opacity: 0.9 }}
          cursor="pointer"
          transition="all 150ms ease-in-out"
          paddingX={4}
          paddingY={2}
        >
          Create account ✨
        </Button>

        {resp?.ok === false && (
          <Text color="red.400" fontSize="sm">
            {resp.error}
          </Text>
        )}

        {resp?.ok && (
          <Flex flexDirection="column" gap={1} fontSize="xs">
            <Text>🎉 Account created! Check your email to verify.</Text>
            {resp.verificationLink && (
              <Box
                as="a"
                href={resp.verificationLink}
                color="blue.400"
                textDecoration="underline"
                wordBreak="break-all"
              >
                (dev) Verify now →
              </Box>
            )}
          </Flex>
        )}

        <RemixLink to="/login">
          <Text fontSize="xs" opacity={0.7}>
            Already have an account? Log in
          </Text>
        </RemixLink>
      </Flex>
    </form>
  );
};
