import { Box, Flex, Text } from '@chakra-ui/react';

import type { CurrentUser } from '~/hooks/useCurrentUser';

export const RAINBOW = 'linear-gradient(120deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)';

// Rainbow-bordered white card showing a user's identity. `children` is the
// action area (e.g. a Log out button, a Continue button).
export const UserCard = ({ user, children }: { user: NonNullable<CurrentUser>; children?: React.ReactNode }) => (
  <Box
    p="2px"
    borderRadius="22px"
    backgroundImage={RAINBOW}
    maxWidth="360px"
    width="100%"
    boxShadow="0 10px 34px rgba(0,0,0,0.12)"
  >
    <Flex bg="white" borderRadius="20px" p={6} direction="column" gap={3}>
      <Text fontSize="3xl" lineHeight={1}>
        🦄
      </Text>
      <Text fontSize="xl" fontWeight="700" wordBreak="break-word">
        {user.displayName || user.username}
      </Text>
      <Text fontSize="sm" color="gray.500" wordBreak="break-word">
        @{user.username}
      </Text>
      <Text fontSize="sm" wordBreak="break-word">
        {user.email}{' '}
        {user.emailVerified ? (
          <Text as="span" color="green.500">
            ✅ verified
          </Text>
        ) : (
          <Text as="span" color="red.300">
            ✉️ unverified
          </Text>
        )}
      </Text>
      {children}
    </Flex>
  </Box>
);
