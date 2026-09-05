import React from 'react';
import { Box, Button, Flex, Input, Spinner, Switch, Text } from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';

import { AdminRowQueryControls, useAdminRowQuery } from './AdminRowQueryControls';
import type { AdminRowField } from './adminRowQuery';
import { PRConflictResolverModelWaterfallEditor } from './PRConflictResolverModelWaterfallEditor';

// Admin-only control panel (rendered from SettingsPage when user.isAdmin).
// Lets admins choose the conflict resolver model order, tune global rate
// limits, and grant/revoke admin on other users. Every action re-checks admin
// server-side; this UI is just the surface.

type Rule = { limit: number; windowMs: number; enabled: boolean };
type Config = Record<string, Rule>;
type AdminRow = {
  id: string;
  username: string;
  displayName: string | null;
  email?: string;
  isAdmin: boolean;
  envAdmin: boolean;
  createdAt?: string | null;
};
type RateLimitRow = Rule & { endpoint: string; label: string };

const eyebrow = {
  fontFamily: 'var(--tt-font-mono, ui-monospace, Menlo, monospace)',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--tt-muted, #9a9aa6)'
};

const ENDPOINT_LABELS: Record<string, string> = {
  'things.react': 'Reactions',
  'things.comment': 'Comments',
  'mongodb.query': 'MongoDB queries'
};

const RATE_LIMIT_QUERY_FIELDS: readonly AdminRowField<RateLimitRow>[] = [
  { id: 'endpoint', label: 'Endpoint', kind: 'string' },
  { id: 'label', label: 'Label', kind: 'string' },
  { id: 'limit', label: 'Limit', kind: 'number' },
  { id: 'windowMs', label: 'Window milliseconds', kind: 'number' },
  { id: 'enabled', label: 'Enabled', kind: 'boolean' }
];

const ADMIN_QUERY_FIELDS: readonly AdminRowField<AdminRow>[] = [
  { id: 'id', label: 'User ID', kind: 'string' },
  { id: 'username', label: 'Username', kind: 'string' },
  { id: 'displayName', label: 'Display name', kind: 'string' },
  { id: 'email', label: 'Email', kind: 'string' },
  { id: 'isAdmin', label: 'Admin', kind: 'boolean' },
  { id: 'envAdmin', label: 'Environment admin', kind: 'boolean' },
  { id: 'createdAt', label: 'Created time', kind: 'date' }
];

const rateLimitQueryRowId = (row: RateLimitRow) => row.endpoint;
const adminQueryRowId = (row: AdminRow) => row.id;

const RateLimitEditor = () => {
  const api = useApi();
  const lopu = useLopu();
  const [config, setConfig] = React.useState<Config | null>(null);
  const [endpoints, setEndpoints] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  const rateLimitRows = React.useMemo<RateLimitRow[]>(
    () =>
      config
        ? endpoints.flatMap((endpoint) => {
            const rule = config[endpoint];
            return rule ? [{ endpoint, label: ENDPOINT_LABELS[endpoint] || endpoint, ...rule }] : [];
          })
        : [],
    [config, endpoints]
  );
  const rateLimitQuery = useAdminRowQuery({
    rows: rateLimitRows,
    fields: RATE_LIMIT_QUERY_FIELDS,
    getRowId: rateLimitQueryRowId,
    initialSort: { field: 'endpoint', direction: 'asc' }
  });

  React.useEffect(() => {
    let cancelled = false;
    apiRef.current.v1.admin
      .rateLimits()
      .then((resp: any) => {
        if (cancelled || !resp?.ok) return;
        setConfig(resp.config);
        setEndpoints(resp.endpoints || Object.keys(resp.config || {}));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (name: string, next: Partial<Rule>) =>
    setConfig((prev) => (prev ? { ...prev, [name]: { ...prev[name], ...next } } : prev));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const resp = await apiRef.current.v1.admin.setRateLimits(config);
      if (resp?.ok) {
        setConfig(resp.config);
        lopu({ title: 'Rate limits saved ✨', status: 'success', duration: 5000 });
      } else {
        lopu({ title: 'Could not save rate limits', description: resp?.error, status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: 'Could not save rate limits', description: err?.error, status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <Flex justifyContent="center" padding={3}>
        <Spinner size="sm" />
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" rowGap={3}>
      <Text sx={eyebrow}>Rate limits</Text>
      <AdminRowQueryControls
        ariaLabel="Query rate limit rules"
        fields={RATE_LIMIT_QUERY_FIELDS}
        onChange={rateLimitQuery.setQuery}
        resultCount={rateLimitQuery.rows.length}
        searchPlaceholder="Search endpoint, label, limit, window, or state…"
        totalCount={rateLimitRows.length}
        value={rateLimitQuery.query}
      />
      {rateLimitQuery.rows.map(({ endpoint: name }) => {
        const rule = config[name];
        if (!rule) return null;
        return (
          <Flex
            key={name}
            alignItems="center"
            columnGap={2}
            rowGap={1}
            flexWrap="wrap"
            padding={2}
            borderRadius="var(--tt-radius-sm, 9px)"
            background="var(--tt-surface-alt, #f5f5f7)"
          >
            <Text fontSize="sm" fontWeight={600} minWidth="90px" color="var(--tt-ink, #16161a)">
              {ENDPOINT_LABELS[name] || name}
            </Text>
            <Flex alignItems="center" columnGap={1}>
              <Input
                size="xs"
                width="64px"
                type="number"
                value={rule.limit}
                onChange={(e) => patch(name, { limit: Math.max(1, Math.floor(Number(e.target.value) || 0)) })}
                aria-label={`${name} limit`}
              />
              <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                per
              </Text>
              <Input
                size="xs"
                width="64px"
                type="number"
                value={Math.round(rule.windowMs / 1000)}
                onChange={(e) => patch(name, { windowMs: Math.max(1, Math.floor(Number(e.target.value) || 0)) * 1000 })}
                aria-label={`${name} window seconds`}
              />
              <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                sec
              </Text>
            </Flex>
            <Flex alignItems="center" columnGap={1} marginLeft="auto">
              <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                {rule.enabled ? 'On' : 'Off'}
              </Text>
              <Switch
                size="sm"
                isChecked={rule.enabled}
                onChange={(e) => patch(name, { enabled: e.target.checked })}
                aria-label={`${name} enabled`}
              />
            </Flex>
          </Flex>
        );
      })}
      {rateLimitRows.length > 0 && rateLimitQuery.rows.length === 0 ? (
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          No rate-limit rules match this query.
        </Text>
      ) : null}
      <Flex>
        <Button size="xs" variant="outline" isLoading={saving} onClick={save}>
          Save rate limits 💾
        </Button>
      </Flex>
    </Flex>
  );
};

const AdminManager = () => {
  const api = useApi();
  const lopu = useLopu();
  const me = useCurrentUser();
  const [admins, setAdmins] = React.useState<AdminRow[]>([]);
  const [adminsLimit, setAdminsLimit] = React.useState(200);
  const [adminsCapped, setAdminsCapped] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<AdminRow[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  const adminQuery = useAdminRowQuery({
    rows: admins,
    fields: ADMIN_QUERY_FIELDS,
    getRowId: adminQueryRowId,
    initialSort: { field: 'username', direction: 'asc' }
  });

  const refresh = React.useCallback(async (q?: string) => {
    try {
      const resp = await apiRef.current.v1.admin.users(q ? { q } : undefined);
      if (resp?.ok) {
        setAdmins(resp.admins || []);
        setAdminsLimit(Number(resp.limit) || 200);
        setAdminsCapped(resp.totalCapped === true);
        if (q !== undefined) setResults(resp.results || []);
      }
    } catch {
      // leave last-known
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const search = async () => {
    await refresh(query.trim());
  };

  const setAdmin = async (row: AdminRow, admin: boolean) => {
    setBusyId(row.id);
    try {
      const resp = await apiRef.current.v1.admin.setAdmin({ userId: row.id, admin });
      if (resp?.ok) {
        lopu({
          title: admin ? `@${row.username} is now an admin ✨` : `@${row.username} is no longer an admin`,
          status: 'success',
          duration: 5000
        });
        await refresh(query.trim() || undefined);
      } else {
        lopu({ title: 'Could not update admin', description: resp?.error, status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: 'Could not update admin', description: err?.error, status: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const row = (r: AdminRow) => (
    <Flex key={r.id} alignItems="center" columnGap={2} padding={2} borderRadius="var(--tt-radius-sm, 9px)" _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}>
      <Box minWidth={0} flex="1 1 auto">
        <Text fontSize="sm" fontWeight={600} noOfLines={1} color="var(--tt-ink, #16161a)">
          {r.displayName || r.username}
          {r.envAdmin && (
            <Text as="span" fontSize="xs" color="var(--tt-muted, #9a9aa6)" fontWeight={400}>
              {' '}· env admin
            </Text>
          )}
        </Text>
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>
          @{r.username}
        </Text>
      </Box>
      {r.isAdmin ? (
        <Button
          size="xs"
          variant="outline"
          isLoading={busyId === r.id}
          isDisabled={r.envAdmin || r.id === me?.id}
          title={r.envAdmin ? 'Env-allowlist admins can’t be demoted here' : r.id === me?.id ? 'You can’t demote yourself' : undefined}
          onClick={() => setAdmin(r, false)}
        >
          Demote
        </Button>
      ) : (
        <Button size="xs" variant="outline" isLoading={busyId === r.id} onClick={() => setAdmin(r, true)}>
          Promote
        </Button>
      )}
    </Flex>
  );

  return (
    <Flex flexDirection="column" rowGap={3}>
      <Text sx={eyebrow}>Admins</Text>
      {adminsCapped ? (
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          Showing the newest {adminsLimit} admins. Filters apply to this bounded roster snapshot.
        </Text>
      ) : null}
      <AdminRowQueryControls
        ariaLabel="Query current admins"
        fields={ADMIN_QUERY_FIELDS}
        onChange={adminQuery.setQuery}
        resultCount={adminQuery.rows.length}
        searchPlaceholder="Search every admin field…"
        totalCount={admins.length}
        value={adminQuery.query}
      />
      <Flex flexDirection="column" rowGap={0}>
        {admins.length ? (
          adminQuery.rows.length ? (
            adminQuery.rows.map(row)
          ) : (
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
              No admins match this query.
            </Text>
          )
        ) : (
          <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
            No DB-flagged admins yet.
          </Text>
        )}
      </Flex>

      <Text sx={eyebrow}>Promote a user</Text>
      <Flex columnGap={2}>
        <Input
          size="sm"
          placeholder="🔍 username or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
          sx={{ background: 'var(--tt-surface-alt, #f5f5f7)', border: '1px solid transparent', borderRadius: 'var(--tt-radius-sm, 9px)' }}
        />
        <Button size="sm" variant="outline" onClick={search} flexShrink={0}>
          Search
        </Button>
      </Flex>
      {results.length > 0 && <Flex flexDirection="column" rowGap={0}>{results.map(row)}</Flex>}
    </Flex>
  );
};

export const AdminPanel = () => (
  <Flex flexDirection="column" rowGap={5}>
    <PRConflictResolverModelWaterfallEditor />
    <RateLimitEditor />
    <AdminManager />
  </Flex>
);
