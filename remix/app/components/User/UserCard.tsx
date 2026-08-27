import { Box, Flex, Text } from '@chakra-ui/react';

import type { CurrentUser } from '~/hooks/useCurrentUser';
import { RAINBOW } from '~/theme/rainbow';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

// Canonical gradient now lives in ~/theme/rainbow (runtime-themed via CSS
// vars); re-exported here for existing importers (welcome, profile, DevKit).
export { RAINBOW };

// Rainbow-bordered white card showing a user's identity. `children` is the
// action area (e.g. a Log out button, a Continue button).
export const UserCard = ({ user, children }: { user: NonNullable<CurrentUser>; children?: React.ReactNode }) => (
  <Box
    p="2px"
    borderRadius="22px"
    background={RAINBOW}
    maxWidth="360px"
    width="100%"
    boxShadow="var(--tt-shadow-toast, 0 10px 34px rgba(0,0,0,0.12))"
  >
    <Flex bg="var(--tt-card, white)" borderRadius="20px" p={6} direction="column" gap={3}>
      <Text fontSize="3xl" lineHeight={1}>
        🦄
      </Text>
      <Text fontSize="xl" fontWeight="700" wordBreak="break-word">
        {getUserDisplayName(user)}
      </Text>
      <Text fontSize="sm" color="gray.500" wordBreak="break-word">
        {getUserIdentityDetail(user)}
      </Text>
      {!user.temporary && (
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
      )}
      {children}
    </Flex>
  </Box>
);
