import React, { useState } from 'react';
import { Flex, Button, FormControl, Input, InputGroup, InputRightElement, Box, Text } from '@chakra-ui/react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import { useThingtime } from '../Thingtime/useThingtime';
import { useLopu } from '../Lopu/useLopu';
import { Icon } from '../Icon/Icon';

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

// Zero-prop on the /register page. Embedded mode (account switcher "Register a
// new account") skips the /welcome navigation on success — onSuccess gets the
// user (the register API already merged the new account into the switcher
// roster) — and the login cross-link becomes an in-place toggle via
// onSwitchMode.
export const Register = (props) => {
  const { embedded, onSuccess, onSwitchMode } = props || {};

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);

  const api = useApi();
  const register = api.v1.auth.register;
  const lopu = useLopu();
  const navigate = useNavigate();

  // DevKit prefill: fills the form when devKit.registerPrefill changes (_ts)
  const { thingtime } = useThingtime();
  const prefill = thingtime?.devKit?.registerPrefill;

  React.useEffect(() => {
    if (prefill?._ts) {
      if (typeof prefill.username === 'string') setUsername(prefill.username);
      if (typeof prefill.password === 'string') setPassword(prefill.password);
      if (typeof prefill.email === 'string') setEmail(prefill.email);
      setPasswordVisible(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?._ts]);

  const handleRegister = async (e) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const r = await register({ username, password, email });
      setResp(r);

      if (r?.ok) {
        lopu({
          title: `Welcome, ${r.user?.username || username}! 🎉`,
          description: 'Your account is ready. Check your email to verify it.',
          status: 'success',
          duration: 8000,
          link: r.verificationLink ? { label: '🔗 Verify your email now (dev)', href: r.verificationLink } : undefined
        });
        if (onSuccess) {
          onSuccess(r.user, r);
        } else {
          // off to the welcome page (carry the dev verify link along)
          navigate('/welcome', { state: { verificationLink: r.verificationLink } });
        }
      } else {
        lopu({
          title: 'Registration failed',
          description: r?.error || 'Something went wrong. Please try again.',
          status: 'error',
          duration: 7000,
        });
      }
    } catch (err) {
      lopu({
        title: 'Network error',
        description: 'Could not reach the server. Please try again.',
        status: 'error',
        duration: 7000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleRegister}>
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
            {embedded ? 'Thingtime · New account' : 'Thingtime · Register'}
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
            {embedded ? 'Register a new account 🦄' : 'Create your account 🦄'}
          </Box>
        </Flex>

        <FormControl>
          <Input
            sx={inputSx}
            onChange={(e) => setUsername(e?.target?.value)}
            placeholder="💌 Username"
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
        </FormControl>

        {/* email lives below the password field, required from signup */}
        <FormControl>
          <Input
            sx={inputSx}
            onChange={(e) => setEmail(e?.target?.value)}
            placeholder="📧 Email"
            type="email"
            value={email}
          />
        </FormControl>

        <Button
          sx={{
            animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
          }}
          type="submit"
          isLoading={loading}
          loadingText="Creating account…"
          display="flex"
          justifyContent="center"
          width="100%"
          color="white"
          fontFamily="heading"
          fontWeight="600"
          background={RAINBOW}
          backgroundSize="calc(100px + 200%)"
          borderRadius="var(--tt-radius-md, 12px)"
          _hover={{ opacity: 0.9 }}
          cursor="pointer"
          transition="all 150ms ease-in-out"
          paddingX={4}
          paddingY={2}
        >
          Create account ✨
        </Button>

        {resp?.ok === false && (
          <Text color="var(--tt-danger, #d6455a)" fontSize="sm">
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
                color="var(--tt-link, #2f8fd6)"
                textDecoration="underline"
                wordBreak="break-all"
              >
                (dev) Verify now →
              </Box>
            )}
          </Flex>
        )}

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
            Already have an account? Log in
          </Box>
        ) : (
          <RouterLink to="/login">
            <Text
              fontSize="xs"
              color="var(--tt-muted, #9a9aa6)"
              transition="color 150ms ease"
              _hover={{ color: 'var(--tt-text, #5a5a66)' }}
            >
              Already have an account? Log in
            </Text>
          </RouterLink>
        )}
      </Flex>
    </form>
  );
};
