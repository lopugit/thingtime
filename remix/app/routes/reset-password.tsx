import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import React, { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW_TEXT } from '~/theme/rainbow';

// One page, two modes. Without ?token= it's the "forgot password" form
// (POST /api/v1/auth/password-reset — the response is neutral by design, so
// the copy never confirms an account exists). With ?token= — the link from
// the reset email — it collects the new password and burns the token via
// /api/v1/auth/password-reset/confirm, which also revokes every live session.

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

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const handleRequest = async (e) => {
    e?.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await api.v1.auth.passwordReset.request({ email: email.trim() });
      setRequested(true);
    } catch (err) {
      lopu({
        title: 'Could not send the reset email',
        description: err?.error || 'Please try again in a moment.',
        status: 'error',
        duration: 6000
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e) => {
    e?.preventDefault();
    if (password.length < 6) {
      lopu({ title: 'Password must be at least 6 characters', status: 'error', duration: 5000 });
      return;
    }
    if (password !== confirmPassword) {
      lopu({ title: 'Passwords don’t match', status: 'error', duration: 5000 });
      return;
    }
    setLoading(true);
    try {
      const resp = await api.v1.auth.passwordReset.confirm({ token, password });
      if (resp?.ok) {
        lopu({
          title: 'Password updated 🎉',
          description: 'Every other session was signed out — log in with your new password.',
          status: 'success',
          duration: 8000
        });
        navigate('/login');
      } else {
        lopu({ title: 'Reset failed', description: resp?.error, status: 'error', duration: 6000 });
      }
    } catch (err) {
      lopu({
        title: 'Reset failed',
        description: err?.error || 'Could not reach the server. Please try again.',
        status: 'error',
        duration: 6000
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      width="100%"
      minHeight="100vh"
      background="var(--tt-surface, #fafafb)"
      padding={6}
    >
      <Flex
        flexDirection="column"
        gap={4}
        width="380px"
        maxWidth="100%"
        background="var(--tt-card, #ffffff)"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-xl, 20px)"
        boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
        padding={9}
      >
        <Box
          fontFamily="mono"
          fontSize="11px"
          fontWeight="600"
          letterSpacing="0.14em"
          textTransform="uppercase"
          color="var(--tt-muted, #9a9aa6)"
        >
          Thingtime · Password reset
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
          {token ? 'Choose a new password 🔑' : 'Forgot your password? 💌'}
        </Box>

        {token ? (
          <form onSubmit={handleConfirm}>
            <Flex flexDirection="column" gap={4}>
              <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
                Set a new password for your account. This link works once and signs out every other session.
              </Text>
              <Input
                sx={inputSx}
                type="password"
                placeholder="New password 🔑"
                value={password}
                onChange={(e) => setPassword(e?.target?.value)}
                autoFocus
              />
              <Input
                sx={inputSx}
                type="password"
                placeholder="New password again 🔁"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e?.target?.value)}
              />
              <Button type="submit" isLoading={loading} loadingText="Saving…" width="100%">
                Set new password ✨
              </Button>
              <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                Link expired or already used?{' '}
                <RouterLink to="/reset-password">
                  <Box as="span" textDecoration="underline">
                    Request a new one
                  </Box>
                </RouterLink>
                .
              </Text>
            </Flex>
          </form>
        ) : requested ? (
          <Flex flexDirection="column" gap={4}>
            <Text fontSize="sm">
              📮 If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. It works once
              and expires in an hour.
            </Text>
            <RouterLink to="/login">
              <Box fontSize="xs" color="var(--tt-muted, #9a9aa6)" _hover={{ color: 'var(--tt-text, #5a5a66)' }}>
                ← Back to login
              </Box>
            </RouterLink>
          </Flex>
        ) : (
          <form onSubmit={handleRequest}>
            <Flex flexDirection="column" gap={4}>
              <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
                Enter your account email and we’ll send a single-use reset link.
              </Text>
              <Input
                sx={inputSx}
                type="email"
                placeholder="💌 Email"
                value={email}
                onChange={(e) => setEmail(e?.target?.value)}
                autoFocus
              />
              <Button type="submit" isLoading={loading} loadingText="Sending…" width="100%">
                Email me a reset link ✨
              </Button>
              <RouterLink to="/login">
                <Box fontSize="xs" color="var(--tt-muted, #9a9aa6)" _hover={{ color: 'var(--tt-text, #5a5a66)' }}>
                  ← Back to login
                </Box>
              </RouterLink>
            </Flex>
          </form>
        )}
      </Flex>
    </Flex>
  );
}
