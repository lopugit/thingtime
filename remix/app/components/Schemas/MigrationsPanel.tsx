import React from 'react';
import { Badge, Box, Button, Flex, Heading, Icon, Stack, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';
import { Database, FlaskConical, Play } from 'lucide-react';

import { useDismissLopu, useLopu } from '~/components/Lopu/useLopu';
import { apiAdminErrorDetail, apiDiagnosticThingId, apiErrorMessage, hasUnknownMutationOutcome } from '~/hooks/apiFailure';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';
import { actionableAdoptionIssues, formatGenerationBytes, generationIndexRatio } from './migrationUiCore';

type CollectionCensus = {
  collection: string;
  physical: string;
  currentVersion: number;
  total: number;
  versions: Record<string, number>;
  pendingMigrations: string[];
};

type CollectionGeneration = {
  collection: string;
  physical: string;
  version: number | null;
  docs: number;
  current: boolean;
  stale: boolean;
  // storage census (older servers omit these — render as unknown, never 0)
  dataBytes?: number;
  storageBytes?: number;
  indexBytes?: number;
  indexes?: number;
};

type Migration = {
  id: string;
  collection: string;
  fromVersion: number;
  toVersion: number;
  title: string;
  description: string;
  destructive: boolean;
  pending: number;
};

type MigrationReport = {
  dryRun: boolean;
  matched: number;
  migrated: number;
  created: number;
  skipped: number;
  notes: string[];
};

type MigrationsStatus = {
  collections: CollectionCensus[];
  generations: CollectionGeneration[];
  adoptionIssues: string[];
  migrations: Migration[];
};

const versionsSummary = (versions: Record<string, number>) =>
  Object.entries(versions || {})
    .map(([version, count]) => `${version.startsWith('v') ? version : `v${version}`}: ${count}`)
    .join(' · ');

const reportSummary = (report?: Partial<MigrationReport>) => {
	const counts = `matched ${report?.matched ?? 0} · migrated ${report?.migrated ?? 0} · created ${report?.created ?? 0} · skipped ${
		report?.skipped ?? 0
	}`;

  return report?.notes?.length ? `${counts} — ${report.notes.join(' · ')}` : counts;
};

// Admin-only census of collection schema versions + one-click (well,
// two-click — non-dry runs confirm inline) migration runner.
export function MigrationsPanel() {
  const { v1 } = useApi();
  // the useApi bindings are stable useCallbacks — safe effect deps
  const { migrations: getMigrations, migrationsRun } = v1.admin;
  const lopu = useLopu();
	const dismissLopu = useDismissLopu();
	const currentUser = useCurrentUser();
  const [status, setStatus] = React.useState<MigrationsStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [runningKey, setRunningKey] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

	React.useEffect(() => () => dismissLopu(), [currentUser?.id, currentUser?.isAdmin, dismissLopu]);

  const fetchStatus = React.useCallback(async () => {
    try {
      const data = await getMigrations();
      setStatus({
        collections: data?.collections || [],
        generations: data?.generations || [],
        adoptionIssues: data?.adoptionIssues || [],
        migrations: data?.migrations || []
      });
      setError(null);
      return true;
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load migration status'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [getMigrations]);

  React.useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const runMigration = React.useCallback(
    async (migration: Migration, dryRun: boolean) => {
      setRunningKey(`${migration.id}:${dryRun ? 'dry' : 'run'}`);
      setConfirmId(null);

      try {
        // the inline Really run? step IS the confirmation — destructive
        // migrations additionally require the API to hear it explicitly
        const result = await migrationsRun({ migration: migration.id, dryRun, confirm: !dryRun });

        lopu({
          title: dryRun ? `Dry run: ${migration.id}` : 'Migration complete',
          description: reportSummary(result?.report),
          status: 'success'
        });
        await fetchStatus();
      } catch (err: any) {
        // A real migration may have applied an idempotent subset before a
        // network/5xx failure. Refresh what remains instead of leaving stale
        // pending counts on screen; dry runs never mutate target documents and
        // need no status refresh.
        if (!dryRun && hasUnknownMutationOutcome(err)) await fetchStatus();
				const adminDetail = apiAdminErrorDetail(err);
				const diagnosticThingId = apiDiagnosticThingId(err);
        lopu({
          title: dryRun ? `Dry run failed: ${migration.id}` : `Migration failed: ${migration.id}`,
					description:
						adminDetail || apiErrorMessage(err, dryRun ? 'Thingtime could not preview this migration.' : 'Thingtime could not run this migration.'),
					status: 'error',
					duration: adminDetail || diagnosticThingId ? 60_000 : undefined,
					announceDescription: !adminDetail,
					descriptionLabel: adminDetail ? 'Full redacted migration error' : undefined,
					link: diagnosticThingId
						? {
								label: 'View full migration diagnostic',
								href: `/thing/${encodeURIComponent(diagnosticThingId)}`
						  }
						: undefined
        });
      } finally {
        setRunningKey(null);
      }
    },
    [fetchStatus, lopu, migrationsRun]
  );

  const busy = runningKey !== null;
  const visibleAdoptionIssues = status
    ? actionableAdoptionIssues(status.adoptionIssues, status.migrations)
    : [];

  return (
    <Box as="section" id="database-migrations" minW={0} scrollMarginTop="112px">
      <Flex align="center" gap={2} mb={2} wrap="wrap">
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" letterSpacing="0.14em" textTransform="uppercase">
          Admin
        </Text>
        <Badge colorScheme="orange">admin only</Badge>
      </Flex>

      <Flex align="center" gap={3} mb={2}>
        <Icon as={Database} boxSize={5} color="var(--tt-docs-accent, #008060)" />
        <Heading as="h3" fontSize={{ base: 'xl', md: '2xl' }} letterSpacing="0">
          Database migrations
        </Heading>
      </Flex>
      <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" maxW="760px" mb={5}>
        Collection schema census and pending migrations. Dry runs report what would change without mutating migration target documents.
      </Text>

      {loading ? (
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="sm">
          Loading migration status…
        </Text>
      ) : null}

      {error ? (
        <Box {...CARD_STYLES} p={4}>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm">
            {error}
          </Text>
          <Button
            mt={3}
            onClick={() => {
              setLoading(true);
              fetchStatus();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </Box>
      ) : null}

      {status ? (
        <Stack spacing={5}>
          {visibleAdoptionIssues.length ? (
            <Box {...CARD_STYLES} borderColor="var(--tt-warning, #d69e2e)" p={4}>
              <Flex align="center" gap={2} mb={1}>
                <Badge colorScheme="orange">adoption</Badge>
                <Text fontSize="sm" fontWeight="700">
                  Legacy collections not yet adopted
                </Text>
              </Flex>
              {visibleAdoptionIssues.map((issue) => (
                <Text color="var(--tt-text, #5a5a66)" fontFamily="mono" fontSize="xs" key={issue} mt={1}>
                  {issue}
                </Text>
              ))}
            </Box>
          ) : null}

          <Box {...CARD_STYLES} overflow="hidden">
            <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" px={5} py={4}>
              <Heading as="h4" fontSize="md">
                Collections census
              </Heading>
            </Box>
            <Box overflowX="auto">
              <Table minW="720px" size="sm">
                <Thead>
                  <Tr>
                    <Th>Collection</Th>
                    <Th>Physical</Th>
                    <Th>Current</Th>
                    <Th isNumeric>Docs</Th>
                    <Th>Versions</Th>
                    <Th>Pending</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {status.collections.map((entry) => (
                    <Tr key={entry.collection}>
                      <Td fontFamily="mono" fontSize="xs" fontWeight="700" whiteSpace="nowrap">
                        {entry.collection}
                      </Td>
                      <Td color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" whiteSpace="nowrap">
                        {entry.physical}
                      </Td>
                      <Td>
                        <Badge colorScheme="blue">v{entry.currentVersion}</Badge>
                      </Td>
                      <Td fontFamily="mono" fontSize="xs" isNumeric>
                        {entry.total}
                      </Td>
                      <Td color="var(--tt-text, #5a5a66)" fontFamily="mono" fontSize="xs" whiteSpace="nowrap">
                        {versionsSummary(entry.versions) || '—'}
                      </Td>
                      <Td>
                        {entry.pendingMigrations?.length ? (
                          <Badge colorScheme="orange" title={entry.pendingMigrations.join(', ')}>
                            {entry.pendingMigrations.length} pending
                          </Badge>
                        ) : (
                          <Badge colorScheme="green">up to date</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </Box>

          <Box {...CARD_STYLES} overflow="hidden">
            <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" px={5} py={4}>
              <Heading as="h4" fontSize="md">
                Storage generations
              </Heading>
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" mt={1}>
								Every physical collection on the server with its storage census. Stale generations are what drop-stale-collection-generations removes once nothing needs them; an index total far above the document bytes means rebuild-things-indexes has storage to reclaim.
              </Text>
            </Box>
            <Box overflowX="auto">
              <Table minW="880px" size="sm">
                <Thead>
                  <Tr>
                    <Th>Physical collection</Th>
                    <Th>Collection</Th>
                    <Th>Generation</Th>
                    <Th isNumeric>Docs</Th>
                    {/* bytes, not a count — `Docs` beside it is the count */}
                    <Th isNumeric>Doc bytes</Th>
                    <Th isNumeric>On disk</Th>
                    <Th isNumeric>Index bytes · count</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {status.generations.map((generation) => (
                    <Tr key={generation.physical}>
                      <Td fontFamily="mono" fontSize="xs" fontWeight="700" whiteSpace="nowrap">
                        {generation.physical}
                      </Td>
                      <Td fontFamily="mono" fontSize="xs" whiteSpace="nowrap">
                        {generation.collection}
                      </Td>
                      <Td>
                        <Badge colorScheme={generation.version === null ? 'purple' : 'blue'}>
                          {generation.version === null ? 'legacy' : `v${generation.version}`}
                        </Badge>
                      </Td>
                      <Td fontFamily="mono" fontSize="xs" isNumeric>
                        {generation.docs}
                      </Td>
                      <Td fontFamily="mono" fontSize="xs" isNumeric whiteSpace="nowrap">
                        {formatGenerationBytes(generation.dataBytes)}
                      </Td>
                      <Td fontFamily="mono" fontSize="xs" isNumeric whiteSpace="nowrap">
                        {formatGenerationBytes(generation.storageBytes)}
                      </Td>
                      <Td fontFamily="mono" fontSize="xs" isNumeric whiteSpace="nowrap">
                        {formatGenerationBytes(generation.indexBytes)}
                        {typeof generation.indexes === 'number' ? ` · ${generation.indexes}` : ''}
                        {(() => {
                          const ratio = generationIndexRatio(generation);
                          return ratio !== null && ratio > 8 && (generation.indexBytes ?? 0) > 64 * 1024 * 1024 ? (
                            <Badge colorScheme="orange" ml={2}>
                              {ratio === Infinity ? '∞' : `${Math.round(ratio)}×`} docs
                            </Badge>
                          ) : null;
                        })()}
                      </Td>
                      <Td>
                        {generation.current ? (
                          <Badge colorScheme="green">current</Badge>
                        ) : generation.stale ? (
                          <Badge colorScheme="orange">stale</Badge>
                        ) : (
                          <Badge colorScheme="purple">ahead</Badge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </Box>

          {status.migrations.length ? (
            <Stack spacing={4}>
              {status.migrations.map((migration) => {
                const confirming = confirmId === migration.id;

                return (
                  <Box {...CARD_STYLES} key={migration.id} minW={0} p={{ base: 4, md: 5 }}>
                    <Flex align="center" gap={2} mb={2} wrap="wrap">
                      <Badge
                        bg="var(--tt-docs-accent-soft, #d7f5df)"
                        borderRadius="sm"
                        color="var(--tt-docs-accent-ink, #0f5132)"
                        fontFamily="mono"
                        px={2}
                        textTransform="none"
                      >
                        {migration.collection}
                      </Badge>
                      {migration.toVersion ? (
                        <Badge colorScheme="blue">
                          v{migration.fromVersion} → v{migration.toVersion}
                        </Badge>
                      ) : null}
                      {migration.destructive ? <Badge colorScheme="red">destructive</Badge> : null}
                      <Badge colorScheme={migration.pending ? 'orange' : 'green'}>{migration.pending} pending</Badge>
                    </Flex>

                    <Heading as="h4" fontSize="md">
                      {migration.title}
                    </Heading>
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" mt={1}>
                      {migration.id}
                    </Text>
                    <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" mt={2}>
                      {migration.description}
                    </Text>

                    <Flex align="center" gap={2} mt={4} wrap="wrap">
                      <Button
                        isDisabled={busy || confirming}
                        isLoading={runningKey === `${migration.id}:dry`}
                        leftIcon={<Icon as={FlaskConical} boxSize={4} />}
                        onClick={() => runMigration(migration, true)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Dry run
                      </Button>
                      {confirming ? (
                        <>
                          <Text fontSize="sm" fontWeight="700">
                            Really run?
                          </Text>
													<Button colorScheme="red" isDisabled={busy} onClick={() => runMigration(migration, false)} size="sm" type="button">
                            Confirm
                          </Button>
													<Button isDisabled={busy} onClick={() => setConfirmId(null)} size="sm" type="button" variant="ghost">
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          bg="var(--tt-docs-accent, #008060)"
                          color="white"
                          _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
                          isDisabled={busy}
                          isLoading={runningKey === `${migration.id}:run`}
                          leftIcon={<Icon as={Play} boxSize={4} />}
                          onClick={() => setConfirmId(migration.id)}
                          size="sm"
                          type="button"
                        >
                          Run migration
                        </Button>
                      )}
                    </Flex>
                  </Box>
                );
              })}
            </Stack>
          ) : (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
              No migrations registered.
            </Text>
          )}
        </Stack>
      ) : null}
    </Box>
  );
}
