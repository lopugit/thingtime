import { Box, Heading, Text } from '@chakra-ui/react';
import React from 'react';

import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { MigrationsPanel } from '~/components/Schemas/MigrationsPanel';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';

// /migrations — the admin database-migrations console (Dev drawer →
// Migrations). It used to sit at the bottom of /docs/schemas; the panel
// itself (collection census, dry runs, migration runs) is unchanged.
export default function MigrationsRoute() {
  const user = useCurrentUser();

  return (
    <PageShell width={920}>
      <PageHeader
        eyebrow="Thingtime · schema versions"
        title="Migrations 🛠️"
        variant="ink"
      />
      <Box as="main" data-testid="migrations-shell" minW={0} w="100%">
        {user?.isAdmin ? (
          <MigrationsPanel />
        ) : (
          <Box {...CARD_STYLES} p={5}>
            <Heading as="h3" color="var(--tt-ink, #16161a)" fontSize="lg" mb={2}>
              Database migrations
            </Heading>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7">
              The migrations console — collection schema census, dry runs, and pending migrations — is admin-only.
              Sign in with an admin account to use it.
            </Text>
          </Box>
        )}
      </Box>
    </PageShell>
  );
}
