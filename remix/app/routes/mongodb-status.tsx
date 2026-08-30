import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useLoaderData, useRevalidator } from 'react-router';
import type { MongoConnectionStatus } from '~/api/utils/mongodb/status';
import { MongoEndpointConfig } from '~/components/MongoDB/MongoEndpointConfig';
import { CARD_STYLES } from '~/theme/card';

import { PageHeader, PageShell } from '../components/Layout/PageShell';

const MONO_FONT = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Flex
    justifyContent="space-between"
    columnGap={6}
    py={2.5}
    _notFirst={{ borderTop: '1px solid var(--tt-border-light, #f0f0f2)' }}
  >
    <Text
      color="var(--tt-muted, #9a9aa6)"
      fontFamily={MONO_FONT}
      fontSize="11px"
      letterSpacing="0.12em"
      textTransform="uppercase"
    >
      {label}
    </Text>
    <Text
      color="var(--tt-ink, #16161a)"
      fontSize="sm"
      fontFamily={MONO_FONT}
      textAlign="right"
      wordBreak="break-word"
    >
      {value ?? '—'}
    </Text>
  </Flex>
);

export default function MongoStatusPage() {
  const status = useLoaderData() as MongoConnectionStatus;
  const revalidator = useRevalidator();

  const connected = status.connected;
  const checking = revalidator.state === 'loading';

  return (
    <PageShell width={760}>
      <PageHeader
        eyebrow="Thingtime · database"
        title="MongoDB 🌱"
        subtitle={
          <>
            This page checks the live MongoDB connection through the Thingtime API
            (<Text as="span" fontFamily={MONO_FONT}>/api/v1/mongodb/status</Text>).
          </>
        }
        after={
          <Flex alignItems="center" columnGap={3} flexWrap="wrap" rowGap={2}>
            <Flex alignItems="center" columnGap={2}>
              <Box
                width="8px"
                height="8px"
                borderRadius="2px"
                backgroundColor={connected ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-danger, #d6455a)'}
                flexShrink={0}
              />
              <Text
                color="var(--tt-muted, #9a9aa6)"
                fontFamily={MONO_FONT}
                fontSize="11px"
                fontWeight={600}
                letterSpacing="0.12em"
                textTransform="uppercase"
              >
                {connected ? 'Connected' : 'Disconnected'}
              </Text>
            </Flex>
            {status.custom && (
              <Box
                backgroundColor="var(--tt-accent-tint, #fff5fa)"
                color="var(--tt-accent, hotpink)"
                borderRadius="var(--tt-radius-pill, 999px)"
                fontFamily={MONO_FONT}
                fontSize="10px"
                fontWeight={600}
                letterSpacing="0.08em"
                textTransform="uppercase"
                px={2.5}
                py={1}
              >
                Custom endpoint
              </Box>
            )}
          </Flex>
        }
      />

      <Box {...CARD_STYLES} px={5} py={3}>
        <Row label="Host" value={status.host} />
        <Row label="Database" value={status.dbName} />
        <Row label="Ping" value={typeof status.pingMs === 'number' ? `${status.pingMs} ms` : null} />
        <Row label="Collections" value={typeof status.collections === 'number' ? status.collections : null} />
        <Row label="Last checked" value={new Date(status.checkedAt).toLocaleString()} />
        {status.error && (
          <Row
            label="Error"
            value={
              <Text as="span" color="var(--tt-danger, #d6455a)" fontSize="xs">
                {status.error}
              </Text>
            }
          />
        )}
        <Flex borderTop="1px solid var(--tt-border-light, #f0f0f2)" pt={3} pb={1}>
          <Button
            size="sm"
            onClick={() => revalidator.revalidate()}
            isLoading={checking}
            loadingText="Re-checking…"
          >
            Re-check connection
          </Button>
        </Flex>
      </Box>

      <Box {...CARD_STYLES} p={5}>
        <MongoEndpointConfig />
      </Box>
    </PageShell>
  );
}
