import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import React, { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW_TEXT } from '~/theme/rainbow';

// Landing page for emailed verification links — the API route
// (/api/v1/auth/verify-email) burns the token and redirects here with
// ?state=success|already|used|expired|invalid|missing (+ &email= on expired).

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

const COPY = {
  success: {
    emoji: '🎉',
    title: 'Your email is verified!',
    body: 'Thank you — your account is all set. Welcome to Thingtime.',
    showResend: false
  },
  already: {
    emoji: '✨',
    title: 'Already verified',
    body: 'This account has already been verified — you are good to go.',
    showResend: false
  },
  used: {
    emoji: '✨',
    title: 'Already verified',
    body: 'This verification link was already used. If that was you, you are all set.',
    showResend: false
  },
  expired: {
    emoji: '⏳',
    title: 'This verification link has expired',
    body: 'Links are valid for 24 hours. Send yourself a fresh one below.',
    showResend: true
  },
  invalid: {
    emoji: '🤔',
    title: 'This verification link is not valid',
    body: 'The link may be incomplete or very old. Enter your email to get a new one.',
    showResend: true
  },
  missing: {
    emoji: '🤔',
    title: 'This verification link is not valid',
    body: 'The link may be incomplete or very old. Enter your email to get a new one.',
    showResend: true
  }
};

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const state = searchParams.get('state') || 'missing';
  // own-property check — a bare COPY[state] lookup would resolve inherited
  // prototype members (?state=__proto__, constructor, toString) to a truthy
  // value, skip the || fallback, and render a blank card.
  const copy = Object.prototype.hasOwnProperty.call(COPY, state) ? COPY[state] : COPY.missing;

  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [sending, setSending] = useState(false);
  const [devLink, setDevLink] = useState(null);

  const api = useApi();
  const lopu = useLopu();

  const resend = async (e) => {
    e?.preventDefault();
    if (!email || sending) return;
    setSending(true);
    try {
      const resp = await api.v1.auth.resendVerification({ email });
      setDevLink(resp?.verificationLink || null);
      lopu({
        title: 'Verification email sent 💌',
        description: `If ${email} has an unverified Thingtime account, a fresh link is on its way.`,
        status: 'success'
      });
    } catch (err) {
      lopu({ title: 'Could not send the email', description: 'Please try again in a moment.', status: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      minHeight="100vh"
      background="var(--tt-surface, #fafafb)"
      paddingX={4}
      paddingY={12}
    >
      <Flex
        direction="column"
        alignItems="center"
        gap={4}
        maxWidth="420px"
        width="100%"
        background="var(--tt-card, #ffffff)"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        paddingX={8}
        paddingY={10}
        textAlign="center"
      >
        <Text fontSize="4xl" lineHeight={1} aria-hidden>
          {copy.emoji}
        </Text>
        <Text
          as="h1"
          fontSize="2xl"
          fontWeight={700}
          letterSpacing="-0.02em"
          color="transparent"
          background={RAINBOW_TEXT}
          backgroundSize="calc(100px + 200%)"
          backgroundClip="text"
          sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
        >
          {copy.title}
        </Text>
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
          {copy.body}
        </Text>

        {copy.showResend ? (
          <Flex as="form" onSubmit={resend} direction="column" gap={3} width="100%" marginTop={2}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              sx={inputSx}
              required
            />
            <Button type="submit" isLoading={sending} width="100%">
              Send a new verification link
            </Button>
            {devLink ? (
              <Button as="a" href={devLink} variant="outline" size="sm" width="100%">
                Dev: open new verification link
              </Button>
            ) : null}
          </Flex>
        ) : (
          <Button as={RouterLink} to="/login" width="100%" marginTop={2}>
            Continue to login
          </Button>
        )}

        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          Wrong place?{' '}
          <Box as={RouterLink} to="/" display="inline" textDecoration="underline">
            Back to Thingtime
          </Box>
        </Text>
      </Flex>
    </Flex>
  );
}
