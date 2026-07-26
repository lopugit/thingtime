import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';

import type { MongoQuerySuccess } from '~/api/utils/mongodb/queryContract';
import { useLopu } from '~/components/Lopu/useLopu';
import { displayMongoResultValue, serializeMongoResultsCsv, tabulateMongoResults } from './resultExport';

type Props = {
  response: MongoQuerySuccess | null;
  running: boolean;
  error: string | null;
  onClear: () => void;
};

const downloadText = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const RawResults = ({ response, running, error, onClear }: Props) => {
  const lopu = useLopu();
  const [view, setView] = React.useState<'json' | 'table'>('json');

  const tabular = React.useMemo(() => tabulateMongoResults(response?.results || []), [response]);
  const tabularRows = tabular.rows;
  const exportColumns = tabular.columns;

  // Keep rendered tables compact; downloads retain every returned field.
  const columns = React.useMemo(() => exportColumns.slice(0, 12), [exportColumns]);

  const jsonText = React.useMemo(() => JSON.stringify(response?.results || [], null, 2), [response]);

  const copyResults = async () => {
    await navigator.clipboard.writeText(jsonText);
    lopu({ title: 'Results copied 📋', status: 'success', duration: 3500 });
  };

  const exportCsv = () => {
    if (!response || !exportColumns.length) return;
    const csv = serializeMongoResultsCsv(response.results);
    downloadText(`thingtime-${response.collection}-${response.operation}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <Flex
      flexDirection="column"
      rowGap={4}
      minWidth={0}
      padding={{ base: 4, md: 5 }}
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-lg, 16px)"
      background="var(--tt-card, #ffffff)"
      boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
    >
      <Flex alignItems="flex-start" gap={3} flexWrap="wrap">
        <Box>
          <Text fontSize="xs" fontWeight={700} letterSpacing="0.1em" textTransform="uppercase" color="var(--tt-muted, #777783)">
            Results
          </Text>
          <Text fontSize="lg" fontWeight={700} color="var(--tt-ink, #16161a)">
            {response ? `${response.collection}.${response.operation}` : 'Ready when you are'}
          </Text>
        </Box>
        {running ? (
          <Badge marginLeft="auto" colorScheme="purple" variant="subtle">
            {response ? 'Refreshing…' : 'Running…'}
          </Badge>
        ) : null}
      </Flex>

      {error ? (
        <Box
          role="alert"
          padding={3}
          border="1px solid"
          borderColor="red.200"
          borderRadius="var(--tt-radius-md, 12px)"
          background="red.50"
          color="red.700"
        >
          <Text fontSize="sm" fontWeight={700}>
            Query could not run
          </Text>
          <Text fontSize="sm" wordBreak="break-word">
            {error}
          </Text>
        </Box>
      ) : null}

      {response ? (
        <>
          <Flex gap={2} flexWrap="wrap">
            <Badge variant="subtle">{response.resultCount} returned</Badge>
            <Badge variant="subtle">{response.durationMs} ms</Badge>
            {response.explain ? <Badge colorScheme="blue">Execution plan</Badge> : null}
            {response.truncated ? <Badge colorScheme="orange">Truncated safely</Badge> : null}
            {response.redactedFields ? <Badge colorScheme="purple">{response.redactedFields} secrets redacted</Badge> : null}
          </Flex>

          <Flex gap={2} flexWrap="wrap">
            <Button size="xs" variant={view === 'json' ? 'solid' : 'outline'} onClick={() => setView('json')}>
              JSON
            </Button>
            <Button
              size="xs"
              variant={view === 'table' ? 'solid' : 'outline'}
              isDisabled={!columns.length}
              onClick={() => setView('table')}
            >
              Table
            </Button>
            <Button size="xs" variant="outline" onClick={copyResults}>
              Copy results
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => downloadText(`thingtime-${response.collection}-${response.operation}.json`, jsonText, 'application/json')}
            >
              Export JSON
            </Button>
            <Button size="xs" variant="outline" isDisabled={!exportColumns.length} onClick={exportCsv}>
              Export CSV
            </Button>
            <Button size="xs" variant="ghost" marginLeft={{ base: 0, md: 'auto' }} onClick={onClear}>
              Clear
            </Button>
          </Flex>

          {view === 'table' && columns.length ? (
            <Box overflowX="auto" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)">
              <Table size="sm">
                <Thead>
                  <Tr>
                    {columns.map((column) => (
                      <Th key={column} fontFamily="mono" fontSize="10px" whiteSpace="nowrap">
                        {column}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {tabularRows.map((row, index) => (
                    <Tr key={index}>
                      {columns.map((column) => (
                        <Td key={column} maxWidth="320px" fontFamily="mono" fontSize="xs" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                          {displayMongoResultValue(row[column])}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          ) : (
            <Box
              as="pre"
              margin={0}
              maxHeight="720px"
              overflow="auto"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              padding={{ base: 3, md: 4 }}
              fontFamily="mono"
              fontSize="12px"
              lineHeight={1.65}
              color="var(--tt-text, #4f4f5b)"
              background="var(--tt-surface, #fafafb)"
              border="1px solid var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-md, 12px)"
            >
              {jsonText}
            </Box>
          )}
        </>
      ) : (
        <Flex
          minHeight="180px"
          alignItems="center"
          justifyContent="center"
          textAlign="center"
          padding={6}
          border="1px dashed var(--tt-border, #dcdce3)"
          borderRadius="var(--tt-radius-md, 12px)"
          background="var(--tt-surface, #fafafb)"
        >
          <Box maxWidth="420px">
            <Text fontSize="2xl" paddingBottom={2}>
              🔎
            </Text>
            <Text fontWeight={700}>Build a query, then run it.</Text>
            <Text fontSize="sm" color="var(--tt-muted, #777783)">
              Start with a bounded find on things, or choose an operation above. Your last result stays visible while the next query runs.
            </Text>
          </Box>
        </Flex>
      )}
    </Flex>
  );
};
