import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useRevalidator } from 'react-router';

import type { MongoConnectionStatus } from '~/api/utils/mongodb/status';
import { CARD_STYLES } from '~/theme/card';
import { PageHeader } from '../Layout/PageShell';
import { MongoEndpointConfig } from './MongoEndpointConfig';

// The /mongodb-status page decomposed into standalone, pixel-identical
// SECTIONS — the same components render the route AND its site-doc blocks
// (see Builder/nativeSections.tsx), so "every element within a native block
// is a builder block" holds with zero duplicated markup. Sections own their
// data through one shared, module-cached fetch (optimistic-render house
// rule: last-known state paints instantly, a background refetch reconciles)
// instead of the old navigation-blocking route loader.

const MONO_FONT = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

// ---- shared data: one fetch, every section subscribes -----------------------

let statusCache: MongoConnectionStatus | null = null;
let statusInflight: Promise<void> | null = null;
const statusListeners = new Set<() => void>();

const notifyStatus = () => statusListeners.forEach((listener) => listener());

const fetchStatus = (): Promise<void> => {
  if (!statusInflight) {
    statusInflight = fetch('/api/v1/mongodb/status-data', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    })
      .then(async (response) => {
        if (!response.ok) return;
        statusCache = (await response.json()) as MongoConnectionStatus;
      })
      .catch(() => {
        // keep last-known state — the page stays useful offline
      })
      .finally(() => {
        statusInflight = null;
        notifyStatus();
      });
  }
  return statusInflight;
};

// Pre-data placeholder (the old blocking loader made this state impossible;
// now it only shows on a true cold start with nothing cached).
const FALLBACK_STATUS: MongoConnectionStatus = {
  connected: false,
  host: null,
  dbName: null,
  custom: false,
  pingMs: null,
  collections: null,
  replicaSet: null,
  checkedAt: '',
  error: null
};

export const useMongoStatusData = () => {
  const [, force] = React.useReducer((tick: number) => tick + 1, 0);
  const [checking, setChecking] = React.useState(false);
  const revalidator = useRevalidator();

  React.useEffect(() => {
    statusListeners.add(force);
    // render cached state instantly; refresh in the background
    fetchStatus();
    return () => {
      statusListeners.delete(force);
    };
  }, []);

  // MongoEndpointConfig announces a data-plane switch via
  // revalidator.revalidate() (it used to refresh this page's route loader).
  // Bridge that signal into a background status refetch so the readout still
  // follows the active endpoint.
  React.useEffect(() => {
    if (revalidator.state === 'loading') fetchStatus();
  }, [revalidator.state]);

  const recheck = React.useCallback(async () => {
    setChecking(true);
    await fetchStatus();
    setChecking(false);
  }, []);

  const status: MongoConnectionStatus = statusCache || FALLBACK_STATUS;

  return { status, checking, recheck, loaded: !!statusCache };
};

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

// ---- the sections -----------------------------------------------------------

export const MongoStatusHeaderSection = () => {
  const { status } = useMongoStatusData();
  const connected = status.connected;

  return (
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
  );
};

export const MongoStatusConnectionSection = () => {
  const { status, checking, recheck } = useMongoStatusData();

  return (
    <Box {...CARD_STYLES} px={5} py={3}>
      <Row label="Host" value={status.host} />
      <Row label="Database" value={status.dbName} />
      <Row label="Ping" value={typeof status.pingMs === 'number' ? `${status.pingMs} ms` : null} />
      <Row label="Collections" value={typeof status.collections === 'number' ? status.collections : null} />
      <Row label="Last checked" value={status.checkedAt ? new Date(status.checkedAt).toLocaleString() : null} />
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
          onClick={recheck}
          isLoading={checking}
          loadingText="Re-checking…"
        >
          Re-check connection
        </Button>
      </Flex>
    </Box>
  );
};

export const MongoStatusEndpointSection = () => (
  <Box {...CARD_STYLES} p={5}>
    <MongoEndpointConfig />
  </Box>
);

// Local ordered section list — the route renders this directly until the
// central registry (Builder/nativeSections.tsx) picks the page up.
export const MONGODB_STATUS_SECTIONS: Array<{
  key: string;
  title: string;
  Component: React.ComponentType;
}> = [
  { key: 'mongodb-status-header', title: 'MongoDB header', Component: MongoStatusHeaderSection },
  { key: 'mongodb-status-connection', title: 'Connection readout', Component: MongoStatusConnectionSection },
  { key: 'mongodb-status-endpoint', title: 'Data endpoint config', Component: MongoStatusEndpointSection }
];
