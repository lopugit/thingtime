import { Box, Heading, Text } from '@chakra-ui/react';
import React from 'react';

import { MigrationsPanel } from '~/components/Schemas/MigrationsPanel';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';

const PAGE_MAX_WIDTH = '920px';

// /migrations — the admin database-migrations console (Dev drawer →
// Migrations). It used to sit at the bottom of /docs/schemas; the panel
// itself (collection census, dry runs, migration runs) is unchanged.
export default function MigrationsRoute() {
  const user = useCurrentUser();

  return (
    <Box
      bg="var(--tt-surface, #fafafb)"
      display="flex"
      justifyContent="center"
      minH="100vh"
      minW={0}
      pb={{ base: 6, md: 10 }}
      pt={{ base: 28, md: 32 }}
      px={{ base: 3, md: 12 }}
      w="100%"
    >
      <Box as="main" data-testid="migrations-shell" maxW={PAGE_MAX_WIDTH} w="100%">
        {user?.isAdmin ? (
          <MigrationsPanel />
        ) : (
          <Box {...CARD_STYLES} p={5}>
            <Heading as="h3" fontSize="lg" mb={2}>
              Database migrations
            </Heading>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7">
              The migrations console — collection schema census, dry runs, and pending migrations — is admin-only.
              Sign in with an admin account to use it.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
