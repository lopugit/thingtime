import React from 'react';
import {
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
import { CARD_STYLES } from '~/theme/card';

import { PageHeader, PageShell } from '../components/Layout/PageShell';

type ResultMap = Record<string, ApiTestResult>;
type RunOptions = {
  allowMutating?: boolean;
};

const EMPTY_BODY_LABEL = 'No request body.';

const MONO_FONT = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const CHIP_TONES = {
  neutral: {
    bg: 'var(--tt-surface-alt, #f5f5f7)',
    color: 'var(--tt-muted, #9a9aa6)'
  },
  positive: {
    bg: 'var(--tt-positive-soft, rgba(88, 202, 112, 0.14))',
    color: 'var(--tt-positive, #2f8f4f)'
  },
  danger: {
    bg: 'rgba(214, 69, 90, 0.12)',
    color: 'var(--tt-danger, #d6455a)'
  },
  accent: {
    bg: 'var(--tt-accent-tint, #fff5fa)',
    color: 'var(--tt-accent, hotpink)'
  },
  link: {
    bg: 'rgba(47, 143, 214, 0.12)',
    color: 'var(--tt-link, #2f8fd6)'
  },
  warning: {
    bg: 'var(--tt-surface-alt, #f5f5f7)',
    color: 'var(--tt-muted, #9a9aa6)',
    dot: 'var(--tt-warning, #ffbc48)'
  }
} as const;

type ChipTone = keyof typeof CHIP_TONES;

const Chip = (props: { tone?: ChipTone; children: React.ReactNode }) => {
  const tone = CHIP_TONES[props.tone ?? 'neutral'];
  const dot = 'dot' in tone ? tone.dot : undefined;

  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      columnGap="6px"
      bg={tone.bg}
      color={tone.color}
      borderRadius="var(--tt-radius-pill, 999px)"
      px={2}
      py="2px"
      fontFamily={MONO_FONT}
      fontSize="10px"
      fontWeight={600}
      letterSpacing="0.06em"
      textTransform="uppercase"
      whiteSpace="nowrap"
    >
      {dot ? (
        <Box as="span" width="6px" height="6px" borderRadius="2px" bg={dot} flexShrink={0} />
      ) : null}
      {props.children}
    </Box>
  );
};

const groupLabel = (group: string) => group.charAt(0).toUpperCase() + group.slice(1);

const statusColor = (status?: string) => {
  if (status === 'pass') return 'var(--tt-positive, #2f8f4f)';
  if (status === 'fail') return 'var(--tt-danger, #d6455a)';
  return 'var(--tt-muted, #9a9aa6)';
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

type EmailTestConfig = ApiTestContext['email'];

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

  // email test context — sanitized provider/sandbox/test-recipient config the
  // email-group tests use for recipients and SES sandbox throttling
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

  // Once the email config lands, refresh the generated payloads that reference
  // it. Depend on emailConfig ALONE — depending on editedPayloadIds would
  // re-run this on every keystroke and re-randomize every unedited payload
  // (uniqueSuffix/Math.random churn); read the edited set inside the functional
  // update instead so an edited payload is never clobbered.
  const editedPayloadIdsRef = React.useRef(editedPayloadIds);
  editedPayloadIdsRef.current = editedPayloadIds;
  React.useEffect(() => {
    if (!emailConfig) return;
    const nextPayloadTexts = createPayloadTexts(emailConfig);
    setPayloadTexts((current) => {
      const next = { ...current };
      for (const [testId, text] of Object.entries(nextPayloadTexts)) {
        if (!editedPayloadIdsRef.current.has(testId)) next[testId] = text;
      }
      return next;
    });
  }, [emailConfig]);

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

  const resetPayload = React.useCallback(
    (test: ApiTestDefinition) => {
      const text = formatRequestPayload(resolveApiTestBody(test, createApiTestContext(emailConfig)));
      setPayloadTexts((current) => ({ ...current, [test.id]: text }));
      setEditedPayloadIds((current) => {
        const next = new Set(current);
        next.delete(test.id);
        return next;
      });
    },
    [emailConfig]
  );

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
    <PageShell width={1180}>
      <PageHeader
        eyebrow="Thingtime · API suite"
        title="API tests ✅"
        variant="ink"
        subtitle="Run all safe API checks, selected tests, a filtered subset, a route group, or one test at a time."
        after={
          <Flex gap={2} wrap="wrap">
            <Button leftIcon={<Play size={16} />} onClick={() => runTests(visibleTests)} isDisabled={!visibleTests.length}>
              Run visible
            </Button>
            <Button leftIcon={<Play size={16} />} onClick={runSelected} isDisabled={!selectedIds.size}>
              Run selected
            </Button>
            <Button leftIcon={<Play size={16} />} variant="outline" onClick={() => runTests(apiTests, { allowMutating: false })}>
              Run all safe
            </Button>
            <Button leftIcon={<RotateCcw size={16} />} variant="ghost" onClick={() => setResults({})}>
              Clear
            </Button>
          </Flex>
        }
      />

      <Stack spacing={6} width="100%">
        {emailConfig ? (
          <Flex gap={2} wrap="wrap">
            <Chip tone={emailConfig.provider === 'ses' ? 'positive' : 'neutral'}>
              email: {emailConfig.provider}
            </Chip>
            {emailConfig.sesSandbox ? (
              <Chip tone="warning">SES sandbox throttle: {emailConfig.sandboxSendDelayMs || 1000}ms</Chip>
            ) : null}
            <Chip>test recipient: {emailConfig.testRecipient}</Chip>
          </Flex>
        ) : null}

        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <Box>
            <Text fontSize="11px" fontWeight="600" fontFamily={MONO_FONT} letterSpacing="0.12em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" mb={1}>Group</Text>
            <Select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              border="1px solid"
              borderColor="var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-sm, 9px)"
            >
              <option value="all">All groups</option>
              {apiTestGroups.map((testGroup) => (
                <option key={testGroup} value={testGroup}>{groupLabel(testGroup)}</option>
              ))}
            </Select>
          </Box>
          <Box>
            <Text fontSize="11px" fontWeight="600" fontFamily={MONO_FONT} letterSpacing="0.12em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" mb={1}>Search</Text>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="route, group, or test"
              border="1px solid"
              borderColor="var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-sm, 9px)"
            />
          </Box>
          <Flex align="end">
            <Checkbox isChecked={includeMutating} onChange={(event) => setIncludeMutating(event.target.checked)}>
              Include mutating tests
            </Checkbox>
          </Flex>
          <Flex align="end" gap={2} wrap="wrap">
            <Chip tone="positive">{summary.passed} passed</Chip>
            <Chip tone={summary.failed ? 'danger' : 'neutral'}>{summary.failed} failed</Chip>
            <Chip>{visibleTests.length} visible</Chip>
            <Chip tone={selectedIds.size ? 'accent' : 'neutral'}>{selectedIds.size} selected</Chip>
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
              <Box
                key={test.id}
                {...CARD_STYLES}
                p={4}
              >
                <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} gap={3} direction={{ base: 'column', md: 'row' }}>
                  <Flex gap={3} align="flex-start">
                    <Checkbox
                      isChecked={selected}
                      onChange={(event) => toggleSelected(test.id, event.target.checked)}
                      aria-label={`Select ${test.name}`}
                      pt="2px"
                    />
                    <Box color={statusColor(result?.status)} pt="2px">
                      <Icon size={18} />
                    </Box>
                    <Box>
                      <Flex gap={2} align="center" wrap="wrap">
                        <Heading size="sm" letterSpacing="0" color="var(--tt-ink, #16161a)">{test.name}</Heading>
                        <Chip>{groupLabel(test.group)}</Chip>
                        <Chip tone={test.method === 'GET' ? 'link' : 'accent'}>{test.method}</Chip>
                        {test.mutates ? <Chip tone="warning">mutates</Chip> : null}
                      </Flex>
                      <Text mt={1} fontSize="sm" color="var(--tt-text, #5a5a66)">{test.description}</Text>
                      <Text mt={1} fontSize="xs" color="var(--tt-muted, #9a9aa6)" fontFamily={MONO_FONT}>{test.path}</Text>
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
                    {editedPayloadIds.has(test.id) ? <Chip tone="accent">edited</Chip> : null}
                  </Flex>

                  {payloadExpanded ? (
                    hasEditableBody ? (
                      <Textarea
                        mt={2}
                        value={payloadText}
                        onChange={(event) => updatePayloadText(test.id, event.target.value)}
                        spellCheck={false}
                        fontFamily={MONO_FONT}
                        fontSize="xs"
                        minH="128px"
                        resize="vertical"
                        bg="var(--tt-surface-alt, #f5f5f7)"
                        borderColor="var(--tt-border, #ececef)"
                        borderRadius="var(--tt-radius-sm, 9px)"
                        whiteSpace="pre"
                        overflowX="auto"
                      />
                    ) : (
                      <Box
                        as="pre"
                        mt={2}
                        p={3}
                        borderRadius="var(--tt-radius-xs, 7px)"
                        bg="var(--tt-surface-alt, #f5f5f7)"
                        color="var(--tt-muted, #9a9aa6)"
                        fontFamily={MONO_FONT}
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
                      <Chip tone={result.status === 'pass' ? 'positive' : 'danger'}>{result.status}</Chip>
                      <Chip>HTTP {result.httpStatus ?? 'n/a'}</Chip>
                      <Chip>{result.durationMs}ms</Chip>
                    </Flex>
                    <Text mt={2} fontSize="sm" color="var(--tt-text, #5a5a66)">{result.details}</Text>
                    {result.preview ? (
                      <Box
                        as="pre"
                        mt={2}
                        p={3}
                        borderRadius="var(--tt-radius-xs, 7px)"
                        bg="var(--tt-surface-alt, #f5f5f7)"
                        color="var(--tt-text, #5a5a66)"
                        fontFamily={MONO_FONT}
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
    </PageShell>
  );
}
