import React from 'react';
import { Badge, Box, Button, Flex, Icon, Input, Text, Textarea } from '@chakra-ui/react';
import { Play, ShieldAlert } from 'lucide-react';

import type { ApiEndpointDoc, ApiRequestExample } from '~/docs/apiDocs';
import { CodeBlock, type CodeLanguage } from './docsCode';

// Live "Try it" runner for /docs/api request examples. Every request fires a
// same-origin fetch with the viewer's own session cookie — that is the point:
// logged-out runs surface the documented 401 as a teaching moment. The path is
// always the documented endpoint constant; only the query string and JSON body
// are editable, and edited input that tries to point anywhere else (an
// absolute URL / protocol-relative URL) is rejected before fetch. Nothing ever
// auto-runs: requests start from an explicit click, and mutation methods take
// a two-step confirm.

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Longer bodies still fully copyable via the copy button on the source
// response — but the highlighter tokenizes every rendered line, so cap what we
// paint to keep huge payloads from freezing the docs page.
const MAX_RENDERED_CHARS = 20000;

type TryItResult = {
  bodyText: string;
  contentType: string;
  headers: Array<[string, string]>;
  language: CodeLanguage;
  ms: number;
  status: number;
  statusText: string;
  truncated: boolean;
};

const serializeQuery = (query: ApiRequestExample['query']) => {
  const params = new URLSearchParams();

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  });

  return params.toString();
};

const seedBody = (body: unknown) => {
  if (body === undefined) return '';
  if (typeof body === 'string') return body;

  return JSON.stringify(body, null, 2);
};

const responseLanguage = (contentType: string, bodyText: string): CodeLanguage => {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml') || contentType.includes('html')) return 'html';
  if (!contentType && bodyText.startsWith('<')) return 'html';

  return 'text';
};

const statusColorScheme = (status: number) => (status >= 400 ? 'red' : status >= 300 ? 'yellow' : 'green');

export function ApiTryIt({ doc, example }: { doc: ApiEndpointDoc; example: ApiRequestExample }) {
  const isMutation = MUTATION_METHODS.has(example.method);
  const showQueryInput = example.method === 'GET' || example.query !== undefined;
  const showBodyInput = example.body !== undefined;
  const [queryText, setQueryText] = React.useState(() => serializeQuery(example.query));
  const [bodyText, setBodyText] = React.useState(() => seedBody(example.body));
  const [inputError, setInputError] = React.useState('');
  const [runError, setRunError] = React.useState('');
  const [armed, setArmed] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<TryItResult | null>(null);
  const [showHeaders, setShowHeaders] = React.useState(false);

  const clearFeedback = React.useCallback(() => {
    setInputError('');
    setRunError('');
  }, []);

  const run = React.useCallback(async () => {
    if (running) return;

    setInputError('');
    setRunError('');
    setArmed(false);

    // Same-origin rail: the path is the documented endpoint constant; the only
    // user-controlled request-line input is the query string, and anything that
    // reads as an absolute or protocol-relative URL is rejected outright.
    const trimmedQuery = queryText.trim().replace(/^\?+/, '');

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedQuery) || trimmedQuery.startsWith('//') || trimmedQuery.includes('://')) {
      setInputError('Absolute URLs are not allowed — the runner only calls this same-origin Thingtime path.');
      return;
    }

    const requestPath = trimmedQuery ? `${doc.endpoint}?${trimmedQuery}` : doc.endpoint;
    let resolved: URL;

    try {
      resolved = new URL(requestPath, window.location.origin);
    } catch {
      setInputError('That query string does not form a valid URL.');
      return;
    }

    // Belt and braces: never let an edited request leave this origin.
    if (resolved.origin !== window.location.origin || !resolved.pathname.startsWith('/api')) {
      setInputError('The runner only calls same-origin /api paths.');
      return;
    }

    const includeBody = showBodyInput && example.method !== 'GET';
    let outgoingBody = '';

    if (includeBody) {
      const trimmedBody = bodyText.trim();

      if (trimmedBody) {
        try {
          JSON.parse(trimmedBody);
        } catch (error) {
          setInputError(`Body is not valid JSON — ${error instanceof Error ? error.message : 'unparseable input'}.`);
          return;
        }

        outgoingBody = trimmedBody;
      }
    }

    setRunning(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);
    const startedAt = performance.now();

    try {
      const response = await fetch(resolved.pathname + resolved.search, {
        method: example.method,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, application/atom+xml;q=0.9, */*;q=0.8',
          ...(outgoingBody ? { 'Content-Type': 'application/json' } : {})
        },
        ...(outgoingBody ? { body: outgoingBody } : {})
      });
      const ms = Math.round(performance.now() - startedAt);
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const raw = await response.text();
      let rendered = raw;

      if (contentType.includes('json') || (!contentType && raw.trim().startsWith('{'))) {
        try {
          rendered = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          // Leave non-parseable bodies as raw text.
        }
      }

      const truncated = rendered.length > MAX_RENDERED_CHARS;

      if (truncated) {
        rendered = rendered.slice(0, MAX_RENDERED_CHARS);
      }

      const headers: Array<[string, string]> = [];

      response.headers.forEach((value, key) => headers.push([key, value]));

      setResult({
        bodyText: rendered,
        contentType,
        headers,
        language: responseLanguage(contentType, rendered.trimStart()),
        ms,
        status: response.status,
        statusText: response.statusText,
        truncated
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setRunError('The request timed out after 30 seconds and was aborted. No retry was attempted.');
      } else {
        setRunError(
          'The request could not be sent (network error). Check your connection — the dev server may be hot-rebuilding.'
        );
      }

      void error;
    } finally {
      window.clearTimeout(timeoutId);
      setRunning(false);
    }
  }, [bodyText, doc.endpoint, example.method, queryText, running, showBodyInput]);

  const onRunClick = React.useCallback(() => {
    if (running) return;

    if (isMutation && !armed) {
      setArmed(true);
      return;
    }

    void run();
  }, [armed, isMutation, run, running]);

  return (
    <Box
      bg="var(--tt-surface-alt, #f7f7f9)"
      border="1px solid"
      borderColor="var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-sm, 9px)"
      mt={2}
      p={3}
    >
      <Flex align="center" gap={2} mb={2} wrap="wrap">
        <Icon as={Play} boxSize={3.5} color="var(--tt-docs-accent, #008060)" />
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700">
          Try it — runs as you, live
        </Text>
        <Badge colorScheme={statusColorScheme(result ? result.status : 200)} hidden={!result}>
          {result ? `HTTP ${result.status}${result.statusText ? ` ${result.statusText}` : ''}` : ''}
        </Badge>
        {result ? <Badge colorScheme="gray">{result.ms} ms</Badge> : null}
      </Flex>

      {showQueryInput ? (
        <Box mb={2}>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
            Query string
          </Text>
          <Input
            bg="var(--tt-card, #ffffff)"
            fontFamily="mono"
            fontSize="13px"
            onChange={(event) => {
              setQueryText(event.target.value);
              clearFeedback();
            }}
            placeholder="key=value&other=value"
            size="sm"
            value={queryText}
          />
        </Box>
      ) : null}

      {showBodyInput ? (
        <Box mb={2}>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
            JSON body
          </Text>
          <Textarea
            bg="var(--tt-card, #ffffff)"
            fontFamily="mono"
            fontSize="13px"
            minH="90px"
            onChange={(event) => {
              setBodyText(event.target.value);
              clearFeedback();
            }}
            rows={Math.min(10, bodyText.split('\n').length + 1)}
            size="sm"
            value={bodyText}
          />
        </Box>
      ) : null}

      {inputError ? (
        <Text color="red.500" fontSize="sm" mb={2}>
          {inputError}
        </Text>
      ) : null}

      <Flex align="center" gap={2} wrap="wrap">
        <Button
          colorScheme={armed ? 'red' : undefined}
          isLoading={running}
          leftIcon={<Icon as={armed ? ShieldAlert : Play} boxSize={3.5} />}
          loadingText="Running"
          onClick={onRunClick}
          size="sm"
          variant={armed ? 'solid' : 'outline'}
        >
          {armed ? 'Really run' : isMutation ? 'Run — modifies data' : 'Run'}
        </Button>
        {armed ? (
          <>
            <Button onClick={() => setArmed(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm">
              This will really {example.method === 'DELETE' ? 'delete' : 'create or modify'} data on your account.
            </Text>
          </>
        ) : null}
      </Flex>

      {runError ? (
        <Text color="red.500" fontSize="sm" mt={2}>
          {runError}
        </Text>
      ) : null}

      {result ? (
        <Box mt={3}>
          <CodeBlock language={result.language}>
            {result.bodyText || '(empty response body)'}
          </CodeBlock>
          {result.truncated ? (
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" mt={1}>
              Response truncated at {MAX_RENDERED_CHARS.toLocaleString()} characters for display.
            </Text>
          ) : null}
          <Button mt={2} onClick={() => setShowHeaders((current) => !current)} size="xs" variant="ghost">
            {showHeaders ? 'Hide response headers' : `Show response headers (${result.headers.length})`}
          </Button>
          {showHeaders ? (
            <CodeBlock language="text" maxH="200px">
              {result.headers.map(([key, value]) => `${key}: ${value}`).join('\n') || '(no exposed headers)'}
            </CodeBlock>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
