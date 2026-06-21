import { Badge, Box, Button, Container, Divider, Flex, Heading, Text } from '@chakra-ui/react';
import { useLoaderData, useRevalidator } from '@remix-run/react';
import { json } from '@vercel/remix';

import { getMongoStatus } from '~/api/utils/mongodb/status';

// Runs the MongoDB connection check through the Thingtime API layer.
export const loader = async () => {
  const status = await getMongoStatus();
  return json(status);
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Flex justifyContent="space-between" columnGap={6} py={2}>
    <Text color="gray.500" fontSize="sm">
      {label}
    </Text>
    <Text fontSize="sm" fontFamily="mono" textAlign="right" wordBreak="break-word">
      {value ?? '—'}
    </Text>
  </Flex>
);

export default function MongoStatusPage() {
  const status = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const connected = status.connected;
  const checking = revalidator.state === 'loading';

  return (
    <Container maxWidth="container.sm" py={24}>
      <Flex flexDirection="column" rowGap={6}>
        <Flex alignItems="center" columnGap={3}>
          <Box
            width="14px"
            height="14px"
            borderRadius="full"
            backgroundColor={connected ? 'green.400' : 'red.400'}
            flexShrink={0}
          />
          <Heading size="lg">MongoDB Connection Status</Heading>
        </Flex>

        <Badge
          alignSelf="flex-start"
          colorScheme={connected ? 'green' : 'red'}
          fontSize="md"
          px={3}
          py={1}
          borderRadius="md"
        >
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>

        <Text color="gray.500" fontSize="sm">
          This page checks the live MongoDB connection through the Thingtime API
          (<Text as="span" fontFamily="mono">/api/v1/mongodb/status</Text>).
        </Text>

        <Divider />

        <Box>
          <Row label="Host" value={status.host} />
          <Row label="Database" value={status.dbName} />
          <Row label="Ping" value={typeof status.pingMs === 'number' ? `${status.pingMs} ms` : null} />
          <Row label="Collections" value={typeof status.collections === 'number' ? status.collections : null} />
          <Row label="Last checked" value={new Date(status.checkedAt).toLocaleString()} />
          {status.error && (
            <Row
              label="Error"
              value={
                <Text as="span" color="red.400" fontSize="xs">
                  {status.error}
                </Text>
              }
            />
          )}
        </Box>

        <Divider />

        <Flex>
          <Button
            size="sm"
            onClick={() => revalidator.revalidate()}
            isLoading={checking}
            loadingText="Re-checking…"
          >
            Re-check connection
          </Button>
        </Flex>
      </Flex>
    </Container>
  );
}
