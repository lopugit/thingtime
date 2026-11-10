import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Box, Button, Flex, Heading, Input, Text } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';

type ErrorLog = { id: string; message: string; source: string; createdAt: string; detail: string; route?: string; method?: string; requestId?: string; provider?: string; code?: string; status?: number; providerType?: string; providerRequestId?: string; retryAfter?: string; attempt?: number };
export const ERROR_LOG_REQUIREMENTS = { 'api.admin-error-logs': '1.0.0' } as const;

export const ErrorLogsPage = () => {
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [result, setResult] = useState<{ owner: string; items: ErrorLog[]; nextCursor: string | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const load = async (before = '') => {
    const run = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    if (!user?.isAdmin) return;
    setBusy(true); setError('');
    try {
      for (const [feature, version] of Object.entries(ERROR_LOG_REQUIREMENTS)) await requireThingtimeCapability(feature, version);
      if (controller.signal.aborted) return;
      const response = await fetch('/api/v1/admin/error-logs?' + new URLSearchParams({ q, before }), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setResult(null);
        throw new Error(response.status === 401 || response.status === 403 ? 'A current admin account is required.' : 'Error logs are temporarily unavailable. Try refreshing.');
      }
      const data = await response.json();
      if (run !== generation.current || controller.signal.aborted) return;
      setResult(previous => ({ owner: user.id, items: before && previous?.owner === user.id ? [...previous.items, ...data.items] : data.items, nextCursor: data.nextCursor }));
    } catch (e) {
      if (run === generation.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Error logs are temporarily unavailable.');
    } finally { if (run === generation.current) setBusy(false); }
  };
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => { clearTimeout(timer); generation.current++; abort.current?.abort(); };
  }, [q, refresh, user?.id, user?.isAdmin]);
  const visible = user?.isAdmin && result?.owner === user.id ? result : null;
  return <Box width="100%" minWidth={0} minHeight="100vh" bg="var(--tt-surface, #fafafb)" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))" pb={20}>
    <Box maxWidth="1000px" mx="auto" px={4} py={6} minWidth={0}>
      <Button as={Link} to="/things" size="sm" variant="outline" mb={5}>Back to Things</Button>
      <Heading size="lg" mb={3}>Error logs</Heading>
      <Text color="var(--tt-muted)" mb={5}>Admin-only Things · retained for 7 days. Search by message, source, provider, route, error code or request ID. Capture is bounded during outages; these records may not include every failure.</Text>
      {!user?.isAdmin ? <Text role="alert">Sign in with an admin account to view error logs.</Text> : <>
        <Flex gap={3} mb={5} wrap="wrap">
          <Input flex="1 1 240px" minWidth={0} aria-label="Search error logs" placeholder="Search error logs…" maxLength={160} value={q} onChange={e => setParams({ logs: '1', ...(e.target.value ? { q: e.target.value } : {}) }, { replace: true })} />
          <Button variant="outline" onClick={() => setRefresh(x => x + 1)} isDisabled={busy}>Refresh</Button>
        </Flex>
        <Text role="status" mb={3}>{busy ? 'Checking for error logs…' : visible ? `${visible.items.length} error log${visible.items.length === 1 ? '' : 's'} shown` : ''}</Text>
        {error && <Text role="alert" mb={4}>{error}</Text>}
        {!busy && visible?.items.length === 0 && <Text>No error logs match this search.</Text>}
        <Flex direction="column" gap={4}>
          {visible?.items.map(item => <Box key={item.id} border="1px solid var(--tt-border, #e8e8ee)" borderRadius="12px" p={4} bg="var(--tt-card, white)" minWidth={0} overflowWrap="anywhere">
            <Flex justify="space-between" gap={2} wrap="wrap" mb={2}><Text fontWeight={700}>{item.source}{item.provider ? ` · ${item.provider}` : ''}{item.status ? ` · ${item.status}` : ''}</Text><Text fontSize="sm">{new Date(item.createdAt).toLocaleString()}</Text></Flex>
            <Text mb={2}>{item.message}</Text>
            {item.route && <Text fontSize="sm" mb={2}>{item.method} {item.route}</Text>}
            <Box as="details">
              <Box as="summary" cursor="pointer" py={2}>View error details</Box>
              <Text fontSize="sm" mb={2}>Thing: {item.id}</Text>
              {item.requestId && <Text fontSize="sm">Request: {item.requestId}</Text>}
              {item.providerRequestId && <Text fontSize="sm">Provider request: {item.providerRequestId}</Text>}
              {item.code && <Text fontSize="sm">Code: {item.code}</Text>}
              {item.providerType && <Text fontSize="sm">Type: {item.providerType}</Text>}
              {item.retryAfter && <Text fontSize="sm">Retry after: {item.retryAfter}</Text>}
              {item.attempt && <Text fontSize="sm">Attempt: {item.attempt}</Text>}
              <Box as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="12px" mt={3} p={3} bg="var(--tt-surface, #fafafb)" borderRadius="8px">{item.detail}</Box>
            </Box>
          </Box>)}
        </Flex>
        {visible?.nextCursor && <Button mt={5} isDisabled={busy} onClick={() => void load(visible.nextCursor!)}>Load older errors</Button>}
      </>}
    </Box>
  </Box>;
};
