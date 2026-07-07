import { Flex, Text, Button, Box } from '@chakra-ui/react';
import { useNavigate, useLocation } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { UserCard, RAINBOW } from '~/components/User/UserCard';
import { RAINBOW_TEXT } from '~/theme/rainbow';

export default function Welcome() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const verificationLink = (location.state as any)?.verificationLink as string | undefined;

  if (!user) return null;

  return (
    <Flex
      minHeight="100vh"
      width="100%"
      align="center"
      justify="center"
      direction="column"
      px={4}
      gap={5}
      background="var(--tt-surface, #fafafb)"
    >
      <Flex direction="column" align="center" gap={1} textAlign="center">
        <Text
          fontSize="2xl"
          fontWeight="800"
          fontFamily="heading"
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
          Welcome to Thingtime! 🎉
        </Text>
        <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
          Your account is ready, {user.displayName || user.username} ✨🦄
        </Text>
      </Flex>

      <UserCard user={user}>
        {!user.emailVerified && (
          <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
            📬 We sent a verification link to your email.
          </Text>
        )}
        {verificationLink && (
          <Box
            as="a"
            href={verificationLink}
            fontSize="xs"
            fontWeight="700"
            color="var(--tt-rainbow-5, #a555e8)"
            textDecoration="underline"
            wordBreak="break-all"
          >
            🔗 Verify your email now (dev)
          </Box>
        )}
        <Button
          mt={2}
          onClick={() => navigate('/')}
          color="white"
          fontFamily="heading"
          fontWeight="600"
          background={RAINBOW}
          backgroundSize="calc(100px + 200%)"
          sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
          _hover={{ opacity: 0.9 }}
          borderRadius="var(--tt-radius-md, 12px)"
        >
          Let's go →
        </Button>
      </UserCard>
    </Flex>
  );
}
