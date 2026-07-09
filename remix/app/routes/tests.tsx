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
  Text,
  Textarea
} from '@chakra-ui/react';
import { CheckCircle2, ChevronDown, ChevronRight, Play, RotateCcw, XCircle } from 'lucide-react';

import { apiTestGroups, apiTests } from '~/tests/api/apiTests';
import {
  formatRequestPayload,
  resolveApiTestBody,
  runApiTest,
  type ApiTestContext,
  type ApiTestDefinition,
  type ApiTestResult
} from '~/tests/api/apiTestRunner';

const PAGE_MAX_WIDTH = '1120px';

type ResultMap = Record<string, ApiTestResult>;
type RunOptions = {
  allowMutating?: boolean;
};

type EmailTestConfig = ApiTestContext['email'];

const EMPTY_BODY_LABEL = 'No request body.';

const groupLabel = (group: string) => group.charAt(0).toUpperCase() + group.slice(1);

const statusColor = (status?: string) => {
  if (status === 'pass') return '#0F766E';
  if (status === 'fail') return '#B91C1C';
  return '#52525B';
};

const visibleCheckboxSx = {
  '& .chakra-checkbox__control': {
    background: '#ffffff !important',
    border: '2px solid #3F3F46 !important',
    boxShadow: '0 0 0 1px #ffffff !important',
    color: '#ffffff !important'
  },
  '& .chakra-checkbox__control[data-checked]': {
    background: '#3182CE !important',
    borderColor: '#3182CE !important',
    boxShadow: 'none !important'
  },
  '& .chakra-checkbox__control[data-focus-visible]': {
    boxShadow: '0 0 0 3px rgba(49, 130, 206, 0.35)'
  }
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

const createApiTestContext = (email?: EmailTestConfig): ApiTestContext => ({
  origin: typeof window === 'undefined' ? '' : window.location.origin,
  email
});

const createPayloadTexts = (email?: EmailTestConfig) => {
  const context = createApiTestContext(email);

  return Object.fromEntries(
    apiTests.map((test) => [test.id, formatRequestPayload(resolveApiTestBody(test, context))])
  );
};

const createPayloadParseResult = (test: ApiTestDefinition, message: string, rawPayload: string): ApiTestResult => ({
  id: test.id,
  status: 'fail',
  httpStatus: null,
  durationMs: 0,
  details: `Request payload JSON is invalid: ${message}`,
  preview: rawPayload
});

export default function TestsPage() {
  const [group, setGroup] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [includeMutating, setIncludeMutating] = React.useState(false);
  const [runningIds, setRunningIds] = React.useState<Set<string>>(new Set());
  const [results, setResults] = React.useState<ResultMap>({});
  const [emailConfig, setEmailConfig] = React.useState<EmailTestConfig>();
  const [payloadTexts, setPayloadTexts] = React.useState<Record<string, string>>(() => createPayloadTexts());
  const [editedPayloadIds, setEditedPayloadIds] = React.useState<Set<string>>(new Set());
  const [expandedPayloadIds, setExpandedPayloadIds] = React.useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let active = true;

    fetch('/api/v1/email/config', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!active || !body?.email) return;
        setEmailConfig(body.email);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!emailConfig) return;
    const nextPayloadTexts = createPayloadTexts(emailConfig);
    setPayloadTexts((current) => {
      const next = { ...current };
      for (const [testId, text] of Object.entries(nextPayloadTexts)) {
        if (!editedPayloadIds.has(testId)) next[testId] = text;
      }
      return next;
    });
  }, [editedPayloadIds, emailConfig]);

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

  const togglePayload = React.useCallback((testId: string) => {
    setExpandedPayloadIds((current) => {
      const next = new Set(current);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  }, []);

  const toggleSelected = React.useCallback((testId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(testId);
      else next.delete(testId);
      return next;
    });
  }, []);

  const resetPayload = React.useCallback((test: ApiTestDefinition) => {
    const text = formatRequestPayload(resolveApiTestBody(test, createApiTestContext(emailConfig)));
    setPayloadTexts((current) => ({ ...current, [test.id]: text }));
    setEditedPayloadIds((current) => {
      const next = new Set(current);
      next.delete(test.id);
      return next;
    });
  }, [emailConfig]);

  const updatePayloadText = React.useCallback((testId: string, value: string) => {
    setPayloadTexts((current) => ({ ...current, [testId]: value }));
    setEditedPayloadIds((current) => new Set([...current, testId]));
  }, []);

  const getRunBody = React.useCallback(
    (test: ApiTestDefinition, context: ApiTestContext) => {
      if (test.body === undefined) return { ok: true as const, body: undefined };

      if (editedPayloadIds.has(test.id)) {
        const rawPayload = payloadTexts[test.id] ?? '';
        const trimmedPayload = rawPayload.trim();
        if (!trimmedPayload) return { ok: true as const, body: undefined };

        try {
          return { ok: true as const, body: JSON.parse(trimmedPayload) };
        } catch (error) {
          return {
            ok: false as const,
            result: createPayloadParseResult(test, error instanceof Error ? error.message : String(error), rawPayload)
          };
        }
      }

      const body = resolveApiTestBody(test, context);
      const text = formatRequestPayload(body);
      setPayloadTexts((current) => (current[test.id] === text ? current : { ...current, [test.id]: text }));
      return { ok: true as const, body };
    },
    [editedPayloadIds, payloadTexts]
  );

  const runTests = React.useCallback(async (tests: ApiTestDefinition[], options: RunOptions = {}) => {
    const allowMutating = options.allowMutating ?? includeMutating;
    const runnable = tests.filter((test) => allowMutating || !test.mutates);
    const context = createApiTestContext(emailConfig);

    for (const test of runnable) {
      setRunningIds((current) => new Set([...current, test.id]));
      try {
        const payload = getRunBody(test, context);
        const result = payload.ok
          ? await runApiTest(test, context, {
              bodyOverride: payload.body,
              hasBodyOverride: test.body !== undefined
            })
          : payload.result;
        setResults((current) => ({ ...current, [test.id]: result }));
      } finally {
        setRunningIds((current) => {
          const next = new Set(current);
          next.delete(test.id);
          return next;
        });
      }
    }
  }, [emailConfig, getRunBody, includeMutating]);

  const runOne = React.useCallback((test: ApiTestDefinition) => runTests([test], { allowMutating: true }), [runTests]);

  const runSelected = React.useCallback(() => {
    const selectedTests = apiTests.filter((test) => selectedIds.has(test.id));
    return runTests(selectedTests, { allowMutating: true });
  }, [runTests, selectedIds]);

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
              Run all safe API checks, selected tests, a filtered subset, a route group, or one test at a time.
            </Text>
            {emailConfig ? (
              <Flex mt={3} gap={2} wrap="wrap">
                <Badge colorScheme={emailConfig.provider === 'ses' ? 'green' : 'gray'}>
                  email: {emailConfig.provider}
                </Badge>
                {emailConfig.sesSandbox ? (
                  <Badge colorScheme="orange">SES sandbox throttle: {emailConfig.sandboxSendDelayMs || 1000}ms</Badge>
                ) : null}
                <Badge colorScheme="gray">test recipient: {emailConfig.testRecipient}</Badge>
              </Flex>
            ) : null}
          </Box>

          <Flex gap={2} wrap="wrap">
            <Button leftIcon={<Play size={16} />} colorScheme="gray" onClick={() => runTests(visibleTests)} isDisabled={!visibleTests.length}>
              Run visible
            </Button>
            <Button leftIcon={<Play size={16} />} colorScheme="blue" onClick={runSelected} isDisabled={!selectedIds.size}>
              Run selected
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
            <Checkbox
              isChecked={includeMutating}
              onChange={(event) => setIncludeMutating(event.target.checked)}
              sx={visibleCheckboxSx}
            >
              Include mutating tests
            </Checkbox>
          </Flex>
          <Flex align="end" gap={2} wrap="wrap">
            <Badge colorScheme="green">{summary.passed} passed</Badge>
            <Badge colorScheme={summary.failed ? 'red' : 'gray'}>{summary.failed} failed</Badge>
            <Badge colorScheme="gray">{visibleTests.length} visible</Badge>
            <Badge colorScheme={selectedIds.size ? 'blue' : 'gray'}>{selectedIds.size} selected</Badge>
          </Flex>
        </SimpleGrid>

        <Flex gap={2} wrap="wrap">
          {apiTestGroups.map((testGroup) => (
            <Button key={testGroup} size="sm" variant="outline" onClick={() => runGroup(testGroup)}>
              Run {groupLabel(testGroup)}
            </Button>
          ))}
          {selectedIds.size ? (
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Clear selected
            </Button>
          ) : null}
        </Flex>

        <Stack spacing={3}>
          {visibleTests.map((test) => {
            const result = results[test.id];
            const running = runningIds.has(test.id);
            const Icon = result?.status === 'pass' ? CheckCircle2 : result?.status === 'fail' ? XCircle : Play;
            const payloadExpanded = expandedPayloadIds.has(test.id);
            const hasEditableBody = test.body !== undefined;
            const payloadText = payloadTexts[test.id] ?? '';
            const selected = selectedIds.has(test.id);

            return (
              <Box key={test.id} border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} gap={3} direction={{ base: 'column', md: 'row' }}>
                  <Flex gap={3} align="flex-start">
                    <Checkbox
                      isChecked={selected}
                      onChange={(event) => toggleSelected(test.id, event.target.checked)}
                      aria-label={`Select ${test.name}`}
                      pt="2px"
                      size="lg"
                      sx={visibleCheckboxSx}
                    />
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

                <Box mt={3} pl={{ base: 0, md: 14 }}>
                  <Flex gap={2} align="center" wrap="wrap">
                    <Button
                      size="xs"
                      variant="ghost"
                      leftIcon={payloadExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      onClick={() => togglePayload(test.id)}
                    >
                      Payload
                    </Button>
                    {hasEditableBody ? (
                      <Button size="xs" variant="ghost" onClick={() => resetPayload(test)}>
                        Reset
                      </Button>
                    ) : null}
                    {editedPayloadIds.has(test.id) ? <Badge colorScheme="blue">edited</Badge> : null}
                  </Flex>

                  {payloadExpanded ? (
                    hasEditableBody ? (
                      <Textarea
                        mt={2}
                        value={payloadText}
                        onChange={(event) => updatePayloadText(test.id, event.target.value)}
                        spellCheck={false}
                        fontFamily="mono"
                        fontSize="xs"
                        minH="128px"
                        resize="vertical"
                        bg="gray.50"
                        borderColor="gray.200"
                        whiteSpace="pre"
                        overflowX="auto"
                      />
                    ) : (
                      <Box
                        as="pre"
                        mt={2}
                        p={3}
                        borderRadius="6px"
                        bg="gray.50"
                        color="gray.500"
                        fontSize="xs"
                        overflowX="auto"
                      >
                        {EMPTY_BODY_LABEL}
                      </Box>
                    )
                  ) : null}
                </Box>

                {result ? (
                  <Box mt={3} pl={{ base: 0, md: 14 }}>
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
                        overflowY="auto"
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
