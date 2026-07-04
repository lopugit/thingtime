import React from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { CheckCircle2, Play, RotateCcw, XCircle } from 'lucide-react';

import { apiTestGroups, apiTests } from '~/tests/api/apiTests';
import { runApiTest, type ApiTestDefinition, type ApiTestResult } from '~/tests/api/apiTestRunner';

const PAGE_MAX_WIDTH = '1120px';

type ResultMap = Record<string, ApiTestResult>;
type RunOptions = {
  allowMutating?: boolean;
};

const groupLabel = (group: string) => group.charAt(0).toUpperCase() + group.slice(1);

const statusColor = (status?: string) => {
  if (status === 'pass') return '#0F766E';
  if (status === 'fail') return '#B91C1C';
  return '#52525B';
};

const testMatches = (test: ApiTestDefinition, group: string, query: string, includeMutating: boolean) => {
  if (!includeMutating && test.mutates) return false;
  if (group !== 'all' && test.group !== group) return false;

  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [test.id, test.name, test.description, test.path, test.group]
    .join(' ')
    .toLowerCase()
    .includes(needle);
};

export default function TestsPage() {
  const [group, setGroup] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [includeMutating, setIncludeMutating] = React.useState(false);
  const [runningIds, setRunningIds] = React.useState<Set<string>>(new Set());
  const [results, setResults] = React.useState<ResultMap>({});

  const visibleTests = React.useMemo(
    () => apiTests.filter((test) => testMatches(test, group, query, includeMutating)),
    [group, includeMutating, query]
  );

  const summary = React.useMemo(() => {
    const visibleResults = visibleTests.map((test) => results[test.id]).filter(Boolean);
    const passed = visibleResults.filter((result) => result.status === 'pass').length;
    const failed = visibleResults.filter((result) => result.status === 'fail').length;
    return { passed, failed, total: visibleResults.length };
  }, [results, visibleTests]);

  const runTests = React.useCallback(async (tests: ApiTestDefinition[], options: RunOptions = {}) => {
    const allowMutating = options.allowMutating ?? includeMutating;
    const runnable = tests.filter((test) => allowMutating || !test.mutates);
    const context = { origin: window.location.origin };

    for (const test of runnable) {
      setRunningIds((current) => new Set([...current, test.id]));
      const result = await runApiTest(test, context);
      setResults((current) => ({ ...current, [test.id]: result }));
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(test.id);
        return next;
      });
    }
  }, [includeMutating]);

  const runOne = React.useCallback((test: ApiTestDefinition) => runTests([test], { allowMutating: true }), [runTests]);

  const runGroup = React.useCallback((testGroup: string) => {
    const groupTests = apiTests.filter((test) => test.group === testGroup);
    return runTests(groupTests);
  }, [runTests]);

  return (
    <Box width="100%" px={{ base: 4, md: 8 }} pt={{ base: 20, md: 10 }} pb={{ base: 6, md: 10 }}>
      <Stack spacing={6} width="100%" maxW={PAGE_MAX_WIDTH} mx="auto">
        <Flex
          direction={{ base: 'column', md: 'row' }}
          justify="space-between"
          align={{ base: 'flex-start', md: 'flex-end' }}
          gap={4}
        >
          <Box>
            <Heading size="lg" letterSpacing="0">API tests</Heading>
            <Text mt={2} color="gray.600" fontSize="sm">
              Run all safe API checks, a filtered subset, a route group, or one test at a time.
            </Text>
          </Box>

          <Flex gap={2} wrap="wrap">
            <Button leftIcon={<Play size={16} />} colorScheme="gray" onClick={() => runTests(visibleTests)} isDisabled={!visibleTests.length}>
              Run visible
            </Button>
            <Button leftIcon={<Play size={16} />} variant="outline" onClick={() => runTests(apiTests, { allowMutating: false })}>
              Run all safe
            </Button>
            <Button leftIcon={<RotateCcw size={16} />} variant="ghost" onClick={() => setResults({})}>
              Clear
            </Button>
          </Flex>
        </Flex>

        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <Box>
            <Text fontSize="xs" fontWeight="700" color="gray.600" mb={1}>Group</Text>
            <Select value={group} onChange={(event) => setGroup(event.target.value)}>
              <option value="all">All groups</option>
              {apiTestGroups.map((testGroup) => (
                <option key={testGroup} value={testGroup}>{groupLabel(testGroup)}</option>
              ))}
            </Select>
          </Box>
          <Box>
            <Text fontSize="xs" fontWeight="700" color="gray.600" mb={1}>Search</Text>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="route, group, or test" />
          </Box>
          <Flex align="end">
            <Checkbox isChecked={includeMutating} onChange={(event) => setIncludeMutating(event.target.checked)}>
              Include mutating tests
            </Checkbox>
          </Flex>
          <Flex align="end" gap={2} wrap="wrap">
            <Badge colorScheme="green">{summary.passed} passed</Badge>
            <Badge colorScheme={summary.failed ? 'red' : 'gray'}>{summary.failed} failed</Badge>
            <Badge colorScheme="gray">{visibleTests.length} visible</Badge>
          </Flex>
        </SimpleGrid>

        <Flex gap={2} wrap="wrap">
          {apiTestGroups.map((testGroup) => (
            <Button key={testGroup} size="sm" variant="outline" onClick={() => runGroup(testGroup)}>
              Run {groupLabel(testGroup)}
            </Button>
          ))}
        </Flex>

        <Stack spacing={3}>
          {visibleTests.map((test) => {
            const result = results[test.id];
            const running = runningIds.has(test.id);
            const Icon = result?.status === 'pass' ? CheckCircle2 : result?.status === 'fail' ? XCircle : Play;

            return (
              <Box key={test.id} border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} gap={3} direction={{ base: 'column', md: 'row' }}>
                  <Flex gap={3} align="flex-start">
                    <Box color={statusColor(result?.status)} pt="2px">
                      <Icon size={18} />
                    </Box>
                    <Box>
                      <Flex gap={2} align="center" wrap="wrap">
                        <Heading size="sm" letterSpacing="0">{test.name}</Heading>
                        <Badge>{groupLabel(test.group)}</Badge>
                        <Badge colorScheme={test.method === 'GET' ? 'blue' : 'purple'}>{test.method}</Badge>
                        {test.mutates ? <Badge colorScheme="orange">mutates</Badge> : null}
                      </Flex>
                      <Text mt={1} fontSize="sm" color="gray.600">{test.description}</Text>
                      <Text mt={1} fontSize="xs" color="gray.500">{test.path}</Text>
                    </Box>
                  </Flex>

                  <Button size="sm" leftIcon={<Play size={14} />} onClick={() => runOne(test)} isLoading={running}>
                    Run
                  </Button>
                </Flex>

                {result ? (
                  <Box mt={3} pl={{ base: 0, md: 8 }}>
                    <Flex gap={2} wrap="wrap" align="center">
                      <Badge colorScheme={result.status === 'pass' ? 'green' : 'red'}>{result.status}</Badge>
                      <Badge colorScheme="gray">HTTP {result.httpStatus ?? 'n/a'}</Badge>
                      <Badge colorScheme="gray">{result.durationMs}ms</Badge>
                    </Flex>
                    <Text mt={2} fontSize="sm">{result.details}</Text>
                    {result.preview ? (
                      <Box
                        as="pre"
                        mt={2}
                        p={3}
                        borderRadius="6px"
                        bg="gray.50"
                        color="gray.700"
                        fontSize="xs"
                        overflowX="auto"
                        maxH="180px"
                      >
                        {result.preview}
                      </Box>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </Box>
  );
}
