import { Flex, Text, Button, Box } from '@chakra-ui/react';
import { useNavigate, useLocation } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { UserCard, RAINBOW } from '~/components/User/UserCard';

export default function Welcome() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const verificationLink = (location.state as any)?.verificationLink as string | undefined;

  if (!user) return null;

  return (
    <Flex minHeight="100vh" width="100%" align="center" justify="center" direction="column" px={4} gap={5}>
      <Flex direction="column" align="center" gap={1} textAlign="center">
        <Text
          fontSize="2xl"
          fontWeight="800"
          backgroundImage={RAINBOW}
          sx={{ WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          Welcome to Thingtime! 🎉
        </Text>
        <Text fontSize="sm" color="gray.500">
          Your account is ready, {user.displayName || user.username} ✨🦄
        </Text>
      </Flex>

      <UserCard user={user}>
        {!user.emailVerified && (
          <Text fontSize="xs" color="gray.500">
            📬 We sent a verification link to your email.
          </Text>
        )}
        {verificationLink && (
          <Box
            as="a"
            href={verificationLink}
            fontSize="xs"
            fontWeight="700"
            color="purple.500"
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
          fontWeight="bold"
          backgroundImage={RAINBOW}
          backgroundSize="calc(100px + 400%)"
          _hover={{ opacity: 0.9 }}
          borderRadius={10}
        >
          Let's go →
        </Button>
      </UserCard>
    </Flex>
  );
}
